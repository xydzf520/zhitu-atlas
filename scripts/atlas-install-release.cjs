// Verify and switch a complete release; current remains usable if validation or copying fails.
// The bundled Electron runtime otherwise presents .asar files as virtual directories.
// Installation must hash and copy the physical archive bytes.
if (process.versions.electron) process.noAsar = true;
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  os = require("node:os");
const hash = (p) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
function verifyRelease(directory, expected) {
  directory = fs.realpathSync(directory);
  const file = path.join(directory, "release-manifest.json");
  if (
    !fs.lstatSync(file).isFile() ||
    !/^[a-f0-9]{64}$/.test(expected) ||
    hash(file) !== expected
  )
    throw Error("发布清单校验失败");
  const manifest = JSON.parse(fs.readFileSync(file));
  if (
    manifest.product !== "zhitu-atlas" ||
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch ||
    !Array.isArray(manifest.files)
  )
    throw Error("发布包不适用于当前安装");
  const seen = new Set();
  for (const item of manifest.files) {
    if (
      typeof item.path !== "string" ||
      !item.path ||
      item.path.includes("\\") ||
      path.isAbsolute(item.path) ||
      item.path.split("/").some((p) => !p || p === ".." || p === ".") ||
      seen.has(item.path) ||
      !Number.isInteger(item.mode) ||
      item.mode < 0 ||
      item.mode > 0o777
    )
      throw Error("发布清单路径或权限无效");
    seen.add(item.path);
    let p = directory;
    for (const part of item.path.split("/")) {
      p = path.join(p, part);
      if (fs.lstatSync(p).isSymbolicLink()) throw Error("发布包不接受符号链接");
    }
    if (!fs.lstatSync(p).isFile() || hash(p) !== item.sha256)
      throw Error("发布文件校验失败：" + item.path);
  }
  if (!seen.has("zhitu-atlas") || !seen.has("resources/app.asar"))
    throw Error("发布包缺少主程序");
  return manifest;
}
function installRelease({
  releaseDirectory,
  installationRoot,
  expectedManifestHash,
}) {
  const manifest = verifyRelease(releaseDirectory, expectedManifestHash),
    root = path.resolve(installationRoot);
  fs.mkdirSync(root, { recursive: true });
  for (const pid of fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
    if (Number(pid) === process.pid) continue;
    try {
      if (fs.readlinkSync(`/proc/${pid}/exe`).startsWith(root + path.sep))
        throw Error("请先退出正在运行的职途 Atlas");
    } catch (e) {
      if (!["ENOENT", "EACCES", "EINVAL"].includes(e.code)) throw e;
    }
  }
  const lock = path.join(root, ".install.lock");
  let fd;
  try {
    fd = fs.openSync(lock, "wx", 0o600);
  } catch {
    throw Error(
      "另一个安装正在进行；若曾异常退出，确认没有安装进程后清除 .install.lock",
    );
  }
  const dest = path.join(root, "releases", expectedManifestHash.slice(0, 16)),
    current = path.join(root, "current");
  const stage = dest + ".next-" + crypto.randomBytes(5).toString("hex"),
    link = current + ".next-" + crypto.randomBytes(5).toString("hex");
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const previous = fs.existsSync(current) ? fs.readlinkSync(current) : null;
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(stage);
      for (const item of manifest.files) {
        const target = path.join(stage, item.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(
          path.join(releaseDirectory, item.path),
          target,
          fs.constants.COPYFILE_EXCL,
        );
        fs.chmodSync(target, item.mode);
      }
      fs.copyFileSync(
        path.join(releaseDirectory, "release-manifest.json"),
        path.join(stage, "release-manifest.json"),
      );
      fs.writeFileSync(path.join(stage, 'release-manifest.sha256'), expectedManifestHash + '\n');
      verifyRelease(stage, expectedManifestHash);
      fs.renameSync(stage, dest);
    } else verifyRelease(dest, expectedManifestHash);
    fs.symlinkSync(dest, link);
    fs.renameSync(link, current);
    return {
      version: manifest.version,
      directory: dest,
      executable: path.join(current, "zhitu-atlas"),
      previous,
      current,
    };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    fs.rmSync(link, { force: true });
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
module.exports = { installRelease, verifyRelease };
if (require.main === module) {
  try {
    const [source, expected, ...options] = process.argv.slice(2);
    let installationRoot = path.join(os.homedir(), '.local/share/zhitu-atlas-app');
    let applications = path.join(os.homedir(), '.local/share/applications');
    for (let i = 0; i < options.length; i += 2) {
      const value = options[i + 1];
      if (!value || /[\r\n]/.test(value)) throw Error('安装路径无效');
      if (options[i] === '--prefix') installationRoot = path.resolve(value);
      else if (options[i] === '--applications') applications = path.resolve(value);
      else throw Error('未知安装选项');
    }
    const result = installRelease({
      releaseDirectory: source,
      installationRoot,
      expectedManifestHash: expected,
    });
    const desktop = path.join(
      applications, "zhitu-atlas.desktop",
    );
    fs.mkdirSync(path.dirname(desktop), { recursive: true });
    const esc = (s) => s.replace(/%/g, '%%').replace(/(["\\`$])/g, "\\$1");
    fs.writeFileSync(
      desktop,
      `[Desktop Entry]\nType=Application\nName=职途 Atlas\nExec="${esc(result.executable)}" --ozone-platform=x11\nIcon=${result.directory}/resources/atlas-icon.png\nTerminal=false\nCategories=Office;\n`,
    );
    console.log('安装完成：可从应用菜单打开「职途 Atlas」。资料保存在本机独立目录。');
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
