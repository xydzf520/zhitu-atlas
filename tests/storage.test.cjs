const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomBytes, createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { buildSync } = require("esbuild");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-storage-test-"));
const bundle = path.join(root, "api.cjs");
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: [
      "atlas-store",
      "atlas-migrations",
      "atlas-analysis-storage",
      "atlas-backup",
      "atlas-backup-transfer",
      "atlas-storage-health",
      "atlas-query-projection",
      "atlas-boss-sync",
      "career-boss-data",
      "atlas-discovery",
      "atlas-discovery-state",
      "atlas-task-queue",
      "career-workspace-service",
      "atlas-tasks",
    ]
      .map((n) => `export * from './packages/ui/src/main/features/${n}'`)
      .join("\n"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});
const a = require(bundle),
  originalRoot = process.env.ATLAS_DATA_ROOT;
after(() => {
  a.closeAtlas();
  if (originalRoot) process.env.ATLAS_DATA_ROOT = originalRoot;
  else delete process.env.ATLAS_DATA_ROOT;
  fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  a.closeAtlas();
  process.env.ATLAS_DATA_ROOT = fs.mkdtempSync(path.join(root, "data-"));
  const handlers = new Map();
  a.registerCareerWorkspace(
    (n, f) => handlers.set(n, f),
    () => {},
  );
  handlers.get("career-workspace-snapshot")({});
  a.saveBossSnapshot({
    account: { id: "account-a", name: "隔离测试" },
    items: [],
  });
  a.setRuntime({ paused: true });
  return { db: a.atlasDb(), dir: a.atlasRoot() };
}
const body = {
  businessGoal: "企业产品建设",
  requirements: [{ requirement: "平台产品", evidenceIds: ["e1"] }],
  strengths: ["产品经验"],
  draft: "测试结果",
};
const report = () => ({
  profileVersion: "v1",
  accountId: "account-a",
  model: "fixture",
  analysis: body,
});
function task(db, id, result) {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO task_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
    id,
    "career-ai-analyze",
    "account-a",
    id,
    "completed",
    "完成",
    "{}",
    JSON.stringify(result),
    "",
    now,
    now,
    now,
  );
}
function upload(bytes) {
  const t = a.beginBackupUpload({ size: bytes.length });
  for (let offset = 0; offset < bytes.length; offset += t.chunkSize)
    a.uploadBackupChunk({
      id: t.id,
      offset,
      base64: bytes.subarray(offset, offset + t.chunkSize).toString("base64"),
    });
  return t.id;
}
function download(t) {
  const chunks = [];
  let offset = 0;
  while (offset < t.size) {
    const c = a.downloadBackupChunk({ id: t.id, offset });
    chunks.push(Buffer.from(c.base64, "base64"));
    offset = c.next;
  }
  return Buffer.concat(chunks);
}
test("analysis bodies deduplicate without merging account metadata, revisions or tasks", () => {
  const { db } = fixture();
  a.atlasWrite("atlas-ai/a", report());
  a.atlasWrite("atlas-ai/b", {
    ...report(),
    accountId: "other",
    profileVersion: "v2",
  });
  a.atlasWrite("atlas-discovery-item/a", {
    jobId: "j1",
    note: "本人备注",
    analysis: report(),
  });
  task(db, "task", report());
  a.compactAnalysisData(db);
  assert.equal(
    db.prepare("SELECT count(*) n FROM analysis_contents").get().n,
    1,
  );
  assert.deepEqual(a.atlasRead("atlas-ai/a"), report());
  assert.equal(a.atlasRead("atlas-ai/b").profileVersion, "v2");
  assert.deepEqual(a.taskRun("task").result, report());
  assert.equal(a.atlasList("atlas-discovery-item")[0].note, "本人备注");
  const revision = db
    .prepare("SELECT revision FROM documents WHERE key='atlas-ai/a'")
    .get().revision;
  a.atlasWrite("atlas-ai/a", report());
  assert.equal(
    db.prepare("SELECT revision FROM documents WHERE key='atlas-ai/a'").get()
      .revision,
    revision,
  );
  assert.equal(a.storageOverview().analysis.references, 4);
  assert.ok(a.storageOverview().analysis.savedPayloadBytes > 0);
  const next = report();
  next.analysis = { ...body, businessGoal: "新的岗位目标" };
  a.atlasWrite("atlas-ai/a", next);
  assert.equal(
    a.taskRun("task").result.analysis.businessGoal,
    body.businessGoal,
  );
});
test("schema migration is reentrant and rolls back a broken analysis reference", () => {
  const { db } = fixture();
  a.atlasWrite("atlas-ai/a", report());
  const revision = db
    .prepare("SELECT revision FROM documents WHERE key='atlas-ai/a'")
    .get().revision;
  db.exec("DROP TABLE execution_subjects; DROP TABLE execution_events; DROP TABLE execution_links; DROP TABLE execution_steps; DROP TABLE execution_runs; DELETE FROM atlas_migrations WHERE version>=6");
  a.migrateAtlasSchema(db);
  a.migrateAtlasSchema(db);
  assert.equal(
    db.prepare("SELECT count(*) n FROM atlas_migrations").get().n,
    a.atlasSchemaVersion,
  );
  assert.equal(
    db.prepare("SELECT revision FROM documents WHERE key='atlas-ai/a'").get()
      .revision,
    revision,
  );
  db.exec(
    "DROP TABLE execution_subjects; DROP TABLE execution_events; DROP TABLE execution_links; DROP TABLE execution_steps; DROP TABLE execution_runs; DELETE FROM atlas_migrations WHERE version>=6; DELETE FROM analysis_contents",
  );
  assert.throws(() => a.migrateAtlasSchema(db), /分析正文缺失/);
  assert.equal(
    db.prepare("SELECT max(version) n FROM atlas_migrations").get().n,
    5,
  );
  assert.ok(
    db.prepare("SELECT value FROM documents WHERE key='atlas-ai/a'").get(),
  );
});
test("document families and history use indexes; nested paths retain exact prefix scope", () => {
  const { db } = fixture();
  for (const [key, value] of [
    ["atlas-ai/a", report()],
    ["atlas-ai-long/b", report()],
    ["atlas-ai/sub/a", report()],
  ])
    a.atlasWrite(key, value);
  assert.equal(a.atlasList("atlas-ai").length, 2);
  assert.equal(a.atlasList("atlas-ai/sub").length, 1);
  const plan = (sql) =>
    db
      .prepare("EXPLAIN QUERY PLAN " + sql)
      .all()
      .map((x) => x.detail)
      .join(" ");
  assert.match(
    plan(
      "SELECT value FROM documents WHERE substr(key,1,instr(key,'/')-1)='atlas-ai' ORDER BY updated_at DESC,key",
    ),
    /documents_family/,
  );
  assert.doesNotMatch(
    plan(
      "SELECT id FROM task_runs WHERE account_id='a' ORDER BY created_at DESC,id LIMIT 20",
    ),
    /TEMP B-TREE/,
  );
  assert.match(
    plan(
      "SELECT body FROM platform_messages WHERE platform='boss' AND account_id='a' AND conversation_id='b' ORDER BY sent_at DESC,source_id DESC LIMIT 50",
    ),
    /platform_messages_timeline/,
  );
});
test("projection rebuilds on another connection writing data, but not on paging", () => {
  const { db, dir } = fixture();
  let builds = 0;
  const page = () =>
    a
      .queryProjection(
        db,
        "conversations",
        JSON.stringify(a.storageStamp(db, ["atlas-test"])),
        () => {
          builds++;
          return { rows: [{ id: "1" }], counts: {} };
        },
        (r) => ({ id: r.id, search: "" }),
      )
      .page("1=1", [], 1, 20);
  page();
  page();
  assert.equal(builds, 1);
  const other = new DatabaseSync(path.join(dir, "storage/atlas.db"));
  other
    .prepare("INSERT INTO documents VALUES(?,?,1,?)")
    .run("atlas-test/changed", "{}", new Date().toISOString());
  other.close();
  page();
  assert.equal(builds, 2);
});
test("captured jobs above 5000 remain accessible and updated filters invalidate cached results", () => {
  const { db } = fixture();
  const now = new Date().toISOString();
  a.atlasTransaction(() => {
    const insert = db.prepare("INSERT INTO platform_jobs VALUES(?,?,?,?,?,?)");
    for (let i = 0; i < 5001; i++)
      insert.run(
        "boss",
        "account-a",
        "j" + i,
        JSON.stringify({
          encryptJobId: "j" + i,
          jobName: "AI产品负责人",
          companyName: "企业" + i,
          description: "负责企业AI产品与技能平台规划。",
          address: "上海市徐汇区",
          salaryLow: 40,
          salaryHigh: 60,
        }),
        now,
        now,
      );
  });
  assert.equal(a.capturedBossJobs().length, 5001);
  const begin = performance.now(),
    first = a.discoveryList({ filter: "all", page: 251 });
  const cold = performance.now() - begin;
  assert.equal(first.total, 5001);
  assert.equal(first.items.length, 1);
  const timings = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    a.discoveryList({ filter: "all", page: 1 + i, query: "企业" });
    timings.push(performance.now() - start);
  }
  const p95 = timings.sort((x, y) => x - y)[18];
  assert.ok(p95 < 1000, `warm page P95 ${p95}ms`);
  a.atlasWrite(a.discoveryItemKey("account-a", "j5000"), {
    accountId: "account-a",
    jobId: "j5000",
    status: "dismissed",
  });
  assert.equal(a.discoveryList({ filter: "dismissed" }).total, 1);
  a.saveBossSnapshot({
    account: { id: "other", name: "另一个账号" },
    items: [],
  });
  assert.equal(a.discoveryList({ filter: "all" }).total, 0);
  console.log(
    "storage benchmark 5001 jobs:",
    JSON.stringify({ coldMs: Math.round(cold), warmP95Ms: Math.round(p95) }),
  );
});
test("50000 messages use a paginated timeline with stable ordering", () => {
  const { db } = fixture(),
    now = new Date().toISOString();
  a.saveBossSnapshot({
    account: { id: "account-a" },
    items: [{ bossId: "b", companyName: "测试企业" }],
  });
  a.atlasTransaction(() => {
    const insert = db.prepare(
      "INSERT INTO platform_messages VALUES(?,?,?,?,?,?,?)",
    );
    for (let i = 0; i < 50000; i++)
      insert.run(
        "boss",
        "account-a",
        "b",
        String(i).padStart(5, "0"),
        JSON.stringify({
          id: String(i),
          text: "隔离测试消息",
          isSelf: false,
          type: "text",
        }),
        now,
        now,
      );
  });
  const times = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now(),
      r = a.bossConversationDetail({
        accountId: "account-a",
        bossId: "b",
        page: 1 + i,
      });
    assert.equal(r.total, 50000);
    assert.ok(r.messages.length <= 100);
    times.push(performance.now() - start);
  }
  const p95 = times.sort((x, y) => x - y)[18];
  assert.ok(p95 < 1000, `message P95 ${p95}ms`);
  console.log(
    "storage benchmark 50000 messages:",
    JSON.stringify({ p95Ms: Math.round(p95) }),
  );
});
test("chunked backup over the old 40MiB limit restores contents, attachments and paused tasks", async () => {
  const { db, dir } = fixture(),
    password = "storage-fixture-password";
  a.atlasWrite("atlas-ai/a", report());
  task(db, "task", report());
  db.prepare("UPDATE task_runs SET state='queued' WHERE id='task'").run();
  fs.mkdirSync(path.join(dir, "attachments"));
  fs.mkdirSync(path.join(dir, "config"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config/llm.json"),
    '{"secret":"fixture-secret-do-not-export"}',
  );
  const hashes = [];
  for (let i = 0; i < 3; i++) {
    const bytes = randomBytes(15 * 1024 * 1024);
    hashes.push(createHash("sha256").update(bytes).digest("hex"));
    fs.writeFileSync(path.join(dir, `attachments/${i}.pdf`), bytes);
  }
  const exported = await a.createBackupTransfer({ password }),
    bytes = download(exported);
  assert.ok(bytes.length > 40 * 1024 * 1024);
  assert.equal(bytes.subarray(0, 8).toString(), "ATLASBK2");
  a.closeBackupTransfer({ id: exported.id });
  fixture();
  const id = upload(bytes),
    before = a.storageOverview().counts;
  await assert.rejects(
    a.previewBackupTransfer({ id, password: "incorrect-password" }),
    /密码错误|备份损坏/,
  );
  assert.deepEqual(a.storageOverview().counts, before);
  const p = await a.previewBackupTransfer({ id, password });
  assert.equal(p.attachments, 3);
  assert.equal(p.counts.task_runs, 1);
  const restored = await a.restoreBackupTransfer({
    id,
    password,
    confirm: true,
  });
  assert.equal(restored.paused, true);
  assert.deepEqual(a.atlasRead("atlas-ai/a"), report());
  assert.equal(a.taskRun("task").state, "interrupted");
  assert.equal(a.runtimePolicy().paused, true);
  const restoredDir = path.join(
    a.atlasRoot(),
    a.atlasRead("atlas-restored-attachments").directory,
  );
  for (let i = 0; i < 3; i++)
    assert.equal(
      createHash("sha256")
        .update(fs.readFileSync(path.join(restoredDir, `${i}.pdf`)))
        .digest("hex"),
      hashes[i],
    );
  assert.equal(
    fs.existsSync(path.join(a.atlasRoot(), "config/llm.json")),
    false,
  );
  assert.equal(a.checkStorage().ok, true);
  a.closeBackupTransfer({ id });
});
test("corruption, truncation, reordered frames and incomplete uploads cannot replace live data", async () => {
  fixture();
  const password = "storage-fixture-password";
  a.atlasWrite("atlas-retain", { note: "不能丢失" });
  const t = await a.createBackupTransfer({ password }),
    good = download(t);
  const corrupt = Buffer.from(good);
  corrupt[corrupt.length - 6] ^= 1;
  const frameEnd = 28 + 4 + good.readUInt32BE(28),
    secondEnd = frameEnd + 4 + good.readUInt32BE(frameEnd);
  const reordered = Buffer.concat([
    good.subarray(0, 28),
    good.subarray(frameEnd, secondEnd),
    good.subarray(28, frameEnd),
    good.subarray(secondEnd),
  ]);
  for (const bytes of [corrupt, good.subarray(0, good.length - 1), reordered]) {
    const id = upload(bytes);
    await assert.rejects(
      a.restoreBackupTransfer({ id, password, confirm: true }),
    );
    assert.equal(a.atlasRead("atlas-retain").note, "不能丢失");
    a.closeBackupTransfer({ id });
  }
  const partial = a.beginBackupUpload({ size: good.length });
  a.uploadBackupChunk({
    id: partial.id,
    offset: 0,
    base64: good.subarray(0, 52).toString("base64"),
  });
  assert.throws(
    () =>
      a.uploadBackupChunk({
        id: partial.id,
        offset: 0,
        base64: good.subarray(0, 52).toString("base64"),
      }),
    /位置/,
  );
  await assert.rejects(
    a.previewBackupTransfer({ id: partial.id, password }),
    /完整上传/,
  );
  a.closeBackupTransfer({ id: partial.id });
  a.closeBackupTransfer({ id: t.id });
});
test("legacy encrypted backup remains readable through chunk transfer", async () => {
  fixture();
  const password = "storage-fixture-password";
  a.atlasWrite("atlas-ai/a", report());
  const legacy = a.exportEncryptedBackup(password),
    id = upload(Buffer.from(legacy.base64, "base64"));
  assert.equal(
    (await a.previewBackupTransfer({ id, password })).counts.analysis_contents,
    1,
  );
  assert.equal(
    (await a.restoreBackupTransfer({ id, password, confirm: true })).restored,
    true,
  );
  assert.deepEqual(a.atlasRead("atlas-ai/a"), report());
  a.closeBackupTransfer({ id });
});
test("transactional restore with missing body leaves all original records intact", () => {
  fixture();
  a.atlasWrite("atlas-ai/a", report());
  a.atlasWrite("atlas-keep", "original");
  const archive = a.inspectBackup({
    password: "storage-fixture-password",
    base64: a.exportEncryptedBackup("storage-fixture-password").base64,
  });
  archive.tables.analysis_contents = [];
  assert.throws(() => a.restoreBackupContents(archive, true), /分析正文缺失/);
  assert.equal(a.atlasRead("atlas-keep"), "original");
  assert.deepEqual(a.atlasRead("atlas-ai/a"), report());
});
test("maintenance removes only unreferenced bodies and expired temporary backups", () => {
  const { db, dir } = fixture();
  a.atlasWrite("atlas-ai/a", report());
  a.packAnalysis(db, {
    analysis: { ...body, businessGoal: "无人引用的旧结果" },
  });
  const live = a.beginBackupUpload({ size: 100 }),
    temp = path.join(dir, "backup-transfers");
  const stale = path.join(temp, "a".repeat(48) + ".upload"),
    crash = path.join(temp, "decode-" + "b".repeat(32));
  fs.writeFileSync(stale, "old");
  fs.mkdirSync(crash);
  fs.writeFileSync(path.join(crash, "0"), "old plaintext");
  const old = new Date(Date.now() - 48 * 3600000);
  fs.utimesSync(stale, old, old);
  fs.utimesSync(crash, old, old);
  const before = a.storageOverview().counts;
  assert.throws(() => a.maintainStorage({}), /确认/);
  const result = a.maintainStorage({ confirm: true });
  assert.equal(result.removedAnalysisBodies, 1);
  assert.ok(result.removedTemporaryBytes > 0);
  assert.deepEqual(result.overview.counts, before);
  assert.deepEqual(a.atlasRead("atlas-ai/a"), report());
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(crash), false);
  assert.ok(fs.existsSync(path.join(temp, live.id + ".upload")));
  a.closeBackupTransfer({ id: live.id });
});
