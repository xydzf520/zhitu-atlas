const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { installArchive, sha256 } = require("../scripts/atlas-install.cjs");
test('release manifests and the displayed client version stay consistent', () => {
  const pkg=require('../package.json'),ui=require('../packages/ui/package.json'),info=require('../packages/ui/src/common/build-info.json');
  assert.equal(pkg.version,ui.version);assert.equal(info.version,pkg.version);
  assert.ok(fs.readFileSync('packages/ui/src/common/brand.ts','utf8').includes(pkg.version));
  const notes=fs.readFileSync('packages/ui/src/common/release-notes.ts','utf8');
  assert.equal(notes.match(/version: '([^']+)'/)[1],pkg.version);
});
test("atomic package upgrade and rollback preserve the old archive; corrupt inputs never replace it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-install-"));
  try {
    fs.mkdirSync(path.join(dir, "resources"));
    fs.writeFileSync(path.join(dir, "zhitu-atlas"), "fixture executable");
    const target = path.join(dir, "resources/app.asar"),
      source = path.join(dir, "candidate.asar");
    fs.writeFileSync(target, "old application");
    fs.writeFileSync(source, "new application");
    const oldHash = sha256(target),
      newHash = sha256(source);
    assert.throws(
      () =>
        installArchive({ source, appDir: dir, expectedHash: "0".repeat(64) }),
      /校验失败/,
    );
    assert.equal(sha256(target), oldHash);
    const result = installArchive({
      source,
      appDir: dir,
      expectedHash: newHash,
    });
    assert.equal(sha256(target), newHash);
    assert.equal(sha256(result.backup), oldHash);
    assert.equal(
      installArchive({ source, appDir: dir, expectedHash: newHash }).changed,
      false,
    );
    installArchive({
      source: result.backup,
      appDir: dir,
      expectedHash: oldHash,
    });
    assert.equal(sha256(target), oldHash);
    assert.equal(sha256(target + ".backup-" + newHash), newHash);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
