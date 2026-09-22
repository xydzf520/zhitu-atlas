// Linux in-place application upgrade. Business-data backup is a separate prerequisite.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const sha256 = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function installArchive({ source, appDir, expectedHash }) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash || ""))
    throw Error("需要提供发布包 SHA-256");
  if (sha256(source) !== expectedHash)
    throw Error("发布包校验失败；原程序未改变");
  const dir = fs.realpathSync(appDir);
  if (!fs.existsSync(path.join(dir, "zhitu-atlas")))
    throw Error("该目录不是已安装的职途 Atlas");
  for (const pid of fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
    let exe;
    try {
      exe = fs.readlinkSync(`/proc/${pid}/exe`);
    } catch {
      continue;
    }
    if (exe.startsWith(dir + path.sep))
      throw Error("请先退出桌面与后台进程，原程序未改变");
  }
  const target = path.join(dir, "resources/app.asar");
  const previousHash = sha256(target);
  if (previousHash === expectedHash)
    return { changed: false, sha256: expectedHash };
  const backup = target + ".backup-" + previousHash;
  if (!fs.existsSync(backup))
    fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
  if (sha256(backup) !== previousHash)
    throw Error("原版本备份校验失败；原程序未改变");
  const staged = target + ".next-" + crypto.randomBytes(6).toString("hex");
  try {
    fs.copyFileSync(source, staged, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(staged, fs.statSync(target).mode & 0o777);
    if (sha256(staged) !== expectedHash)
      throw Error("写入校验失败；原程序未改变");
    const fd = fs.openSync(staged, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(staged, target);
    return { changed: true, sha256: expectedHash, previousHash, backup };
  } finally {
    fs.rmSync(staged, { force: true });
  }
}
module.exports = { installArchive, sha256 };
if (require.main === module) {
  const [source, appDir, expectedHash] = process.argv.slice(2);
  try {
    console.log(
      JSON.stringify(installArchive({ source, appDir, expectedHash })),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
