const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const {
    installRelease,
    verifyRelease,
  } = require("../scripts/atlas-install-release.cjs"),
  root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-complete-release-"));
process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
const hash = (f) =>
  crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
function release(version) {
  const dir = fs.mkdtempSync(path.join(root, "release-"));
  fs.mkdirSync(path.join(dir, "resources"));
  fs.writeFileSync(path.join(dir, "zhitu-atlas"), "runtime-" + version);
  fs.writeFileSync(path.join(dir, "resources/app.asar"), "app-" + version);
  const file = path.join(dir, "release-manifest.json"),
    manifest = {
      product: "zhitu-atlas",
      version,
      platform: process.platform,
      arch: process.arch,
      files: ["zhitu-atlas", "resources/app.asar"].map((p) => ({
        path: p,
        sha256: hash(path.join(dir, p)),
        mode: p === "zhitu-atlas" ? 0o755 : 0o644,
      })),
    };
  fs.writeFileSync(file, JSON.stringify(manifest));
  return { dir, file, manifest, sha: hash(file) };
}
test("full runtime installation, upgrade and rollback switch verified releases atomically", () => {
  const v1 = release("one"),
    v2 = release("two"),
    installationRoot = path.join(root, "app");
  const install = (r) =>
    installRelease({
      releaseDirectory: r.dir,
      expectedManifestHash: r.sha,
      installationRoot,
    });
  const first = install(v1),
    second = install(v2);
  assert.equal(second.previous, first.directory);
  assert.equal(
    fs.readFileSync(path.join(second.current, "resources/app.asar"), "utf8"),
    "app-two",
  );
  const rollback = install(v1);
  assert.equal(rollback.directory, first.directory);
  assert.equal(
    fs.readFileSync(path.join(rollback.current, "resources/app.asar"), "utf8"),
    "app-one",
  );
  fs.writeFileSync(path.join(v2.dir, "resources/app.asar"), "corrupt");
  assert.throws(() => install(v2), /校验/);
  assert.equal(fs.readlinkSync(first.current), first.directory);
});
test("manifest traversal, linked parent directory and wrong platform cannot reach the installer", () => {
  const r = release("bad");
  r.manifest.files[0].path = "../other";
  fs.writeFileSync(r.file, JSON.stringify(r.manifest));
  assert.throws(() => verifyRelease(r.dir, hash(r.file)), /路径/);
  const link = release("linked"),
    outside = path.join(root, "outside");
  fs.renameSync(path.join(link.dir, "resources"), outside);
  fs.symlinkSync(outside, path.join(link.dir, "resources"));
  assert.throws(() => verifyRelease(link.dir, link.sha), /符号链接/);
  const platform = release("arch");
  platform.manifest.arch = "unknown";
  fs.writeFileSync(platform.file, JSON.stringify(platform.manifest));
  assert.throws(
    () => verifyRelease(platform.dir, hash(platform.file)),
    /不适用/,
  );
});
