const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  vm = require("node:vm"),
  crypto = require("node:crypto"),
  { buildSync } = require("esbuild"),
  { DatabaseSync } = require("node:sqlite");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-independent-"));
process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
const source = buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: `export * from './packages/ui/src/main/features/atlas-installation';export * from './packages/ui/src/main/features/atlas-store';export * from './packages/ui/src/common/desktop-bridge'`,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
}).outputFiles[0].text;
function fixture() {
  const dir = fs.mkdtempSync(path.join(root, "case-")),
    from = path.join(dir, "old"),
    to = path.join(dir, "new"),
    m = { exports: {} };
  vm.runInNewContext("(function(require,module,exports){" + source + "\n})", {
    Buffer,
    process: { ...process, env: { ...process.env, ATLAS_DATA_ROOT: from } },
    Date,
    URL,
  })(require, m, m.exports);
  return { a: m.exports, dir, from, to };
}
const hash = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
test("independent data migration preserves linked records and attachments; pauses every execution path", async () => {
  const f = fixture(),
    db = f.a.atlasDb();
  f.a.atlasWrite("atlas-career-policy", {
    version: 7,
    automationPaused: false,
    sending: { paused: false, dailyLimit: 20 },
    replies: { mode: "auto" },
    discovery: { autoRecommend: true },
  });
  f.a.atlasWrite("career-auto-reply.json", { mode: "auto" });
  f.a.atlasWrite("atlas-boss-sync-settings", { enabled: true });
  db.exec(
    `INSERT INTO opportunities VALUES('opp','{"note":"保留本人备注"}',1);INSERT INTO related VALUES('rel','opp','interview','{}',1);INSERT INTO leases VALUES('account','lease',9999999999999);INSERT INTO send_attempts(id,platform,account_id,recipient_id,kind,automatic,status,text,created_at,updated_at) VALUES('sending','boss','a','b','first-contact',1,'sending','已准备的内容','now','now');INSERT INTO contact_runs VALUES('c','boss','a','j','b','sending','{"state":"sending"}',1,'now','now');INSERT INTO task_runs VALUES('t','career-ai-analyze','a','key','running','calling','{}',NULL,'','now','now','now')`,
  );
  f.a.closeAtlas();
  fs.mkdirSync(path.join(f.from, "attachments"));
  fs.writeFileSync(
    path.join(f.from, "attachments", "resume.docx"),
    "fixture attachment",
  );
  fs.mkdirSync(path.join(f.from, "config"));
  fs.writeFileSync(
    path.join(f.from, "config", "llm.json"),
    '{"key":"private-test"}',
  );
  fs.writeFileSync(path.join(f.from, "config", ".career-write.lock"), "stale");
  fs.mkdirSync(path.join(f.from, 'private'), { mode: 0o700 });
  fs.writeFileSync(path.join(f.from, 'private/models.json'), '[]', { mode: 0o600 });
  fs.mkdirSync(path.join(f.from, 'private/.models.lock'));
  fs.writeFileSync(path.join(f.from, 'private/.models.lock/owner.json'), JSON.stringify({pid:process.pid}));
  const original = hash(path.join(f.from, "storage/atlas.db"));
  assert.equal((await f.a.migrateInstallation(f.from, f.to)).migrated, true);
  assert.equal(hash(path.join(f.from, "storage/atlas.db")), original);
  const migrated = new DatabaseSync(path.join(f.to, "storage/atlas.db"), {
    readOnly: true,
  });
  const doc = (k) =>
    JSON.parse(
      migrated.prepare("SELECT value FROM documents WHERE key=?").get(k).value,
    );
  assert.equal(doc("atlas-career-policy").automationPaused, true);
  assert.equal(doc("atlas-career-policy").sending.paused, true);
  assert.equal(doc("atlas-career-policy").replies.mode, "off");
  assert.equal(doc("atlas-career-policy").sending.dailyLimit, 20);
  assert.equal(doc("atlas-boss-sync-settings").enabled, false);
  assert.equal(
    migrated.prepare("SELECT status FROM send_attempts").get().status,
    "uncertain",
  );
  assert.equal(
    migrated.prepare("SELECT state FROM task_runs").get().state,
    "interrupted",
  );
  assert.equal(
    migrated.prepare("SELECT state FROM contact_runs").get().state,
    "review",
  );
  assert.equal(migrated.prepare("SELECT count(*) n FROM leases").get().n, 0);
  assert.equal(
    migrated
      .prepare(
        "SELECT count(*) n FROM related JOIN opportunities ON opportunity_id=opportunities.id",
      )
      .get().n,
    1,
  );
  migrated.close();
  assert.equal(
    fs.readFileSync(path.join(f.to, "attachments/resume.docx"), "utf8"),
    "fixture attachment",
  );
  assert.equal(
    fs.existsSync(path.join(f.to, "config/.career-write.lock")),
    false,
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(f.to, "migration.json")),
  );
  assert.equal(fs.readFileSync(path.join(f.to, 'private/models.json'), 'utf8'), '[]');
  assert.equal(fs.statSync(path.join(f.to, 'private')).mode & 0o777, 0o700);
  assert.equal(fs.existsSync(path.join(f.to, 'private/.models.lock')), false);
  for (const item of manifest.files) {
    assert.equal(hash(path.join(f.to, item.file)), item.sha256);
    assert.equal(fs.statSync(path.join(f.to, item.file)).mode & 0o777, 0o600);
  }
  assert.equal(
    (await f.a.migrateInstallation(f.from, f.to)).reason,
    "target-exists",
  );
});
test("corrupt source, live runtime and unsafe source paths never create a partial destination", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.from, "storage"), { recursive: true });
  fs.writeFileSync(path.join(f.from, "storage/atlas.db"), "invalid sqlite");
  await assert.rejects(f.a.migrateInstallation(f.from, f.to));
  assert.equal(fs.existsSync(f.to), false);
  assert.equal(
    fs.readdirSync(f.dir).some((x) => x.includes(".migrating-")),
    false,
  );
  fs.writeFileSync(
    path.join(f.from, "storage/atlas-runtime.json"),
    JSON.stringify({ pid: process.pid }),
  );
  await assert.rejects(f.a.migrateInstallation(f.from, f.to), /先退出/);
  await assert.rejects(
    f.a.migrateInstallation(f.from, path.join(f.from, "nested")),
    /独立/,
  );
  const link = path.join(f.dir, "link");
  fs.symlinkSync(f.from, link);
  await assert.rejects(f.a.migrateInstallation(link, f.to), /符号链接/);
});
test("two simultaneous migrations cannot overwrite a completed installation", async () => {
  const f = fixture();
  f.a.atlasWrite("test", { note: "fixture" });
  f.a.closeAtlas();
  const results = await Promise.allSettled([
    f.a.migrateInstallation(f.from, f.to),
    f.a.migrateInstallation(f.from, f.to),
  ]);
  assert.equal(
    results.filter((r) => r.status === "fulfilled" && r.value.migrated).length,
    1,
  );
  assert.ok(fs.existsSync(path.join(f.to, "migration.json")));
  assert.equal(
    fs.readdirSync(f.dir).some((x) => x.includes(".migrating-")),
    false,
  );
});
test("desktop bridge has no arbitrary file/config or executable link surface", () => {
  const f = fixture();
  for (const c of [
    "fetch-config-file-content",
    "write-config-file-content",
    "exec",
    "open-file",
    "career-../secret",
    "career-",
  ])
    assert.equal(f.a.allowedInvoke(c), false);
  for (const c of [
    "career-workspace-load",
    "atlas-boss-open",
    "atlas-runtime-info",
  ])
    assert.equal(f.a.allowedInvoke(c), true);
  for (const u of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "http://example.com",
    "https://user:pass@example.com",
  ])
    assert.equal(f.a.publicLink(u), null);
  assert.equal(
    f.a.publicLink("https://github.com/example/demo-project"),
    "https://github.com/example/demo-project",
  );
});

test("JSON-only installs import execution settings paused without losing the original files", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.from, "config"), { recursive: true });
  fs.writeFileSync(
    path.join(f.from, "config/career-auto-reply.json"),
    JSON.stringify({ mode: "auto", dailyLimit: 20 }),
  );
  await f.a.migrateInstallation(f.from, f.to);
  const db = new DatabaseSync(path.join(f.to, "storage/atlas.db"), {
    readOnly: true,
  });
  assert.equal(
    JSON.parse(
      db
        .prepare(
          "SELECT value FROM documents WHERE key='career-auto-reply.json'",
        )
        .get().value,
    ).mode,
    "off",
  );
  db.close();
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(f.from, "config/career-auto-reply.json")),
    ).mode,
    "auto",
  );
});
