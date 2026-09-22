const { test } = require('node:test');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  vm = require('node:vm');
const { buildSync } = require('esbuild'),
  { DatabaseSync } = require('node:sqlite'),
  { createHash } = require('node:crypto'),
  { spawn } = require('node:child_process');
const source = buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents:
      "export * from './packages/ui/src/main/features/atlas-history-import';export * from './packages/ui/src/main/features/atlas-store';export * from './packages/ui/src/main/features/atlas-discovery-state'"
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false
}).outputFiles[0].text;
const plain = (v) => JSON.parse(JSON.stringify(v));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-history-rewrite-')),
    m = { exports: {} };
  vm.runInNewContext('(function(require,module,exports){' + source + '\n})', {
    Buffer,
    process: { ...process, env: { ...process.env, ATLAS_DATA_ROOT: dir } },
    Date,
    URL
  })(require, m, m.exports);
  const a = m.exports,
    db = a.atlasDb(),
    file = path.join(dir, 'storage/public.db'),
    old = new DatabaseSync(file);
  old.exec(
    `CREATE TABLE user_info(encryptUserId TEXT,name TEXT);CREATE TABLE job_info(encryptJobId TEXT,encryptCompanyId TEXT,encryptBossId TEXT,jobName TEXT,description TEXT);CREATE TABLE company_info(encryptCompanyId TEXT,name TEXT);CREATE TABLE boss_info(encryptBossId TEXT,name TEXT);CREATE TABLE chat_startup_log(id INTEGER,encryptCurrentUserId TEXT,encryptJobId TEXT,date TEXT);CREATE TABLE mark_as_not_suit_log(id INTEGER,encryptCurrentUserId TEXT,encryptJobId TEXT);CREATE TABLE chat_message_record(mid TEXT,encryptFromUserId TEXT,encryptToUserId TEXT,text TEXT,type TEXT,time TEXT,encryptCurrentUserId TEXT);INSERT INTO user_info VALUES('a','同名'),('b','同名');INSERT INTO company_info VALUES('ca','公司甲'),('cb','公司乙');INSERT INTO boss_info VALUES('recruiter','招聘者');INSERT INTO job_info VALUES('ja','ca','recruiter','产品甲','甲职责'),('jb','cb','recruiter','产品乙','乙职责');INSERT INTO chat_startup_log VALUES(1,'a','ja','2026-09-20'),(2,'b','jb','2026-09-19');`
  );
  function message(id, from, to, text, time, explicit = null) {
    old
      .prepare('INSERT INTO chat_message_record VALUES(?,?,?,?,?,?,?)')
      .run(id, from, to, text, 'text', time, explicit);
  }
  function closeSource() {
    try {
      old.close();
    } catch {}
  }
  t.after(() => {
    closeSource();
    a.closeAtlas();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    a,
    db,
    old,
    file,
    dir,
    message,
    closeSource,
    count: (table) => db.prepare('SELECT count(*) n FROM ' + table).get().n,
    conversation: (account) =>
      JSON.parse(
        db.prepare('SELECT body FROM platform_conversations WHERE account_id=?').get(account).body
      )
  };
}
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('unordered messages select the latest summary and job association stays within each account', (t) => {
  const f = fixture(t);
  f.message('new', 'recruiter', 'a', '甲的新消息', '2026-09-21T10:00:00Z');
  f.message('old', 'recruiter', 'a', '甲的旧消息', '2026-09-19T10:00:00Z');
  f.message('b', 'recruiter', 'b', '乙的消息', '2026-09-20T10:00:00Z');
  f.closeSource();
  const before = hash(f.file);
  f.a.importHistoricalData();
  const a = f.conversation('a'),
    b = f.conversation('b');
  assert.equal(a.lastText, '甲的新消息');
  assert.equal(a.encryptJobId, 'ja');
  assert.equal(a.companyName, '公司甲');
  assert.equal(b.encryptJobId, 'jb');
  assert.equal(b.companyName, '公司乙');
  assert.equal(a.autoReadVerified, false);
  assert.equal(hash(f.file), before);
});
test('several jobs for one recruiter remain explicit candidates instead of choosing the first', (t) => {
  const f = fixture(t);
  f.old.exec("INSERT INTO chat_startup_log VALUES(3,'a','jb','2026-09-21')");
  f.message('m', 'recruiter', 'a', '新消息', '2026-09-21');
  f.closeSource();
  f.a.importHistoricalData();
  const c = f.conversation('a');
  assert.equal(c.encryptJobId, '');
  assert.equal(c.jobName, '');
  assert.equal(c.companyName, '');
  assert.deepEqual(c.linkedJobIds.sort(), ['ja', 'jb']);
});
test('ambiguous participants and conflicting explicit ownership stay in the unassigned archive', (t) => {
  const f = fixture(t);
  f.message('both', 'a', 'b', '两个本机账号', '2026-09-21');
  f.message('none', 'stranger', 'unknown', '未知归属', '2026-09-21');
  f.message('conflict', 'recruiter', 'b', '错误归属', '2026-09-21', 'a');
  f.closeSource();
  f.a.importHistoricalData();
  assert.equal(f.count('platform_messages'), 0);
  assert.equal(f.count('platform_conversations'), 0);
  assert.equal(f.a.historyArchive({ unassigned: true, kind: 'chat_message_record' }).total, 3);
});
test('conflicting source IDs retain both raw records and do not fabricate a canonical message', (t) => {
  const f = fixture(t);
  f.message('duplicate', 'recruiter', 'a', '一种内容', '2026-09-20');
  f.message('duplicate', 'recruiter', 'a', '另一种内容', '2026-09-21');
  f.closeSource();
  const r = f.a.importHistoricalData();
  assert.equal(r.conflicts, 1);
  assert.equal(
    f.db
      .prepare("SELECT count(*) n FROM legacy_records WHERE source_table='chat_message_record'")
      .get().n,
    2
  );
  assert.equal(f.count('platform_messages'), 0);
  assert.equal(f.count('platform_conversations'), 0);
});
test('existing verified data, human notes and execution policy are not overwritten by import', (t) => {
  const f = fixture(t),
    now = '2026-09-22T01:00:00Z';
  f.message('m', 'recruiter', 'a', '历史文本', '2026-09-20');
  f.closeSource();
  const job = { jobName: '当前职位', note: '本人备注' },
    conversation = { lastText: '平台最新文本', autoReadVerified: true };
  f.db
    .prepare("INSERT INTO platform_jobs VALUES('boss','a','ja',?,?,?)")
    .run(JSON.stringify(job), now, now);
  f.db
    .prepare("INSERT INTO platform_conversations VALUES('boss','a','recruiter',?,?,?)")
    .run(JSON.stringify(conversation), now, now);
  const key = f.a.discoveryItemKey('a', 'ja');
  f.a.atlasWrite(key, { status: 'dismissed', note: '本人决定' });
  f.a.atlasWrite('atlas-runtime', { paused: true, dailyLimit: 20 });
  f.a.importHistoricalData();
  assert.deepEqual(f.conversation('a'), conversation);
  assert.deepEqual(
    JSON.parse(f.db.prepare("SELECT body FROM platform_jobs WHERE account_id='a'").get().body),
    job
  );
  assert.equal(f.a.atlasRead(key).status, 'dismissed');
  assert.deepEqual(plain(f.a.atlasRead('atlas-runtime')), { paused: true, dailyLimit: 20 });
  assert.equal(f.count('send_attempts'), 0);
  assert.equal(f.count('task_runs'), 0);
});
test('a failure rolls back the entire import and a later attempt succeeds without changing the source', (t) => {
  const f = fixture(t);
  f.message('m', 'recruiter', 'a', '消息', '2026-09-21');
  f.closeSource();
  const before = hash(f.file);
  f.db.exec(
    "CREATE TRIGGER fixture_abort BEFORE INSERT ON platform_messages BEGIN SELECT RAISE(ABORT,'fixture-stop'); END"
  );
  assert.throws(() => f.a.importHistoricalData(), /已回滚/);
  for (const table of [
    'legacy_records',
    'platform_jobs',
    'platform_messages',
    'platform_conversations'
  ])
    assert.equal(f.count(table), 0);
  assert.equal(f.a.atlasRead('atlas-unified-data', null), null);
  assert.equal(hash(f.file), before);
  f.db.exec('DROP TRIGGER fixture_abort');
  f.a.importHistoricalData();
  f.a.importHistoricalData();
  assert.equal(f.count('platform_messages'), 1);
  assert.equal(hash(f.file), before);
});
test('an earlier completed migration remains complete and is not replayed on upgrade', (t) => {
  const f = fixture(t);
  f.closeSource();
  const result = { completed: true, at: '2026-09-18', source: 'public.db' };
  f.a.atlasWrite('atlas-unified-data', result);
  assert.deepEqual(plain(f.a.importHistoricalData()), result);
  assert.equal(f.count('legacy_records'), 0);
});
test('unsafe restored paths and linked source files are rejected before reading data', (t) => {
  const f = fixture(t);
  f.closeSource();
  f.a.atlasWrite('atlas-restored-legacy', { file: '../public.db' });
  assert.throws(() => f.a.importHistoricalData(), /路径/);
  f.a.atlasWrite('atlas-restored-legacy', { file: 'linked.db' });
  fs.symlinkSync(f.file, path.join(f.dir, 'storage/linked.db'));
  assert.throws(() => f.a.importHistoricalData(), /独立文件/);
  assert.equal(f.count('legacy_records'), 0);
});
test('parallel import processes share one completion marker and do not duplicate records', async (t) => {
  const f = fixture(t);
  f.message('m', 'recruiter', 'a', '消息', '2026-09-21');
  f.closeSource();
  f.a.closeAtlas();
  const bundle = path.join(f.dir, 'import.cjs');
  fs.writeFileSync(bundle, source);
  const run = () =>
    new Promise((resolve, reject) => {
      const p = spawn(
        process.execPath,
        [
          '-e',
          'const a=require(process.argv[1]);try{const r=a.importHistoricalData();console.log(JSON.stringify(r));a.closeAtlas()}catch{process.exit(1)}',
          bundle
        ],
        { env: { ...process.env, ATLAS_DATA_ROOT: f.dir } }
      );
      let output = '';
      p.stdout.on('data', (v) => (output += v));
      p.on('error', reject);
      p.on('exit', (code) =>
        code === 0 ? resolve(JSON.parse(output)) : reject(Error('import process failed'))
      );
    });
  const [a, b] = await Promise.all([run(), run()]);
  assert.equal(a.completed, true);
  assert.equal(a.at, b.at);
  assert.equal(f.a.atlasDb().prepare('SELECT count(*) n FROM platform_messages').get().n, 1);
});
