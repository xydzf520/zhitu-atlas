// Uses disposable synthetic data only. No platform actions or model calls.
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { performance } = require('node:perf_hooks'),
  { createRequire } = require('node:module');
const project = path.resolve(__dirname, '..'),
  req = createRequire(path.join(project, 'package.json')),
  { buildSync } = req('esbuild'),
  { DatabaseSync } = require('node:sqlite');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-history-scale-'));
process.env.ATLAS_DATA_ROOT = dir;
try {
  const bundle = path.join(dir, 'api.cjs');
  buildSync({
    absWorkingDir: project,
    stdin: {
      resolveDir: project,
      contents:
        "export * from './packages/ui/src/main/features/atlas-history-import';export * from './packages/ui/src/main/features/atlas-store'"
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    logLevel: 'silent'
  });
  const a = require(bundle);
  a.atlasDb();
  const source = new DatabaseSync(path.join(dir, 'storage/public.db'));
  source.exec(
    "CREATE TABLE user_info(encryptUserId TEXT,name TEXT);CREATE TABLE job_info(encryptJobId TEXT,encryptCompanyId TEXT,encryptBossId TEXT,jobName TEXT,description TEXT);CREATE TABLE company_info(encryptCompanyId TEXT,name TEXT);CREATE TABLE boss_info(encryptBossId TEXT,name TEXT);CREATE TABLE chat_startup_log(id INTEGER,encryptCurrentUserId TEXT,encryptJobId TEXT,date TEXT);CREATE TABLE chat_message_record(mid TEXT,encryptFromUserId TEXT,encryptToUserId TEXT,text TEXT,type TEXT,time TEXT);BEGIN;INSERT INTO user_info VALUES('a','测试甲'),('b','测试乙')"
  );
  const company = source.prepare('INSERT INTO company_info VALUES(?,?)'),
    boss = source.prepare('INSERT INTO boss_info VALUES(?,?)'),
    job = source.prepare('INSERT INTO job_info VALUES(?,?,?,?,?)'),
    contact = source.prepare('INSERT INTO chat_startup_log VALUES(?,?,?,?)'),
    message = source.prepare('INSERT INTO chat_message_record VALUES(?,?,?,?,?,?)');
  for (let i = 0; i < 50; i++) company.run('c' + i, '测试企业' + i);
  for (let i = 0; i < 100; i++) boss.run('b' + i, '测试招聘者' + i);
  for (let i = 0; i < 5000; i++) {
    job.run(
      'j' + i,
      'c' + (i % 50),
      'b' + (Math.floor(i / 2) % 100),
      '测试岗位' + i,
      '隔离职位说明'
    );
    contact.run(i, i % 2 ? 'b' : 'a', 'j' + i, '2026-09-20');
  }
  for (let i = 0; i < 50000; i++)
    message.run(
      'm' + i,
      'b' + (Math.floor(i / 2) % 100),
      i % 2 ? 'b' : 'a',
      '隔离消息' + i,
      'text',
      new Date(Date.UTC(2026, 8, 20) + i * 1000).toISOString()
    );
  source.exec('COMMIT');
  source.close();
  const start = performance.now();
  a.importHistoricalData();
  const importMs = performance.now() - start;
  const samples = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    const r = a.historicalApplications({ userId: 'a' });
    if (r.data.applications.length !== 2500) throw Error('incorrect application count');
    a.historyArchive({ unassigned: true, page: i + 1 });
    samples.push(performance.now() - t);
  }
  const jobs = a.atlasDb().prepare('SELECT count(*) n FROM platform_jobs').get().n,
    messages = a.atlasDb().prepare('SELECT count(*) n FROM platform_messages').get().n;
  if (jobs !== 5000 || messages !== 50000) throw Error('incorrect imported counts');
  const report = {
    jobs,
    messages,
    importMs: Math.round(importMs),
    combinedReadP95Ms: Math.round(samples.sort((a, b) => a - b)[18]),
    maxRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    syntheticData: true,
    realPlatformCalls: 0
  };
  a.closeAtlas();
  console.log(JSON.stringify(report));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
