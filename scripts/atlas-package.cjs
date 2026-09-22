// Build a complete desktop runtime from the locked Electron dependency, never from an installed application.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { createPackage } = require("@electron/asar");
const sha256 = (p) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const { assertPublicBuild } = require('./atlas-public-check.cjs');
async function packageRelease(output) {
  const ui = path.resolve("packages/ui"),
    manifest = JSON.parse(fs.readFileSync(path.join(ui, "package.json"))),
    dest = path.resolve(
      output || `artifacts/releases/zhitu-atlas-${manifest.version}-linux`,
    );
  if (process.platform !== "linux")
    throw Error("此打包入口当前验证 Linux；其他平台需要独立验收");
  if (fs.existsSync(dest)) throw Error("输出目录已存在，请使用新的目录");
  for (const name of ['out', 'web-dist']) assertPublicBuild(path.join(ui, name));
  for (const name of [
    "out/main/index.js",
    "out/main/service.js",
    "web-dist/desktop.html",
    "resources/icon.png",
  ])
    if (!fs.existsSync(path.join(ui, name)))
      throw Error("缺少构建输出：" + name);
  const electron = path.join(
    path.dirname(require.resolve("electron/package.json")),
    "dist",
  );
  if (!fs.existsSync(path.join(electron, "electron")))
    throw Error("Electron 运行时未安装，请先完成依赖安装");
  const stage = dest + ".next-" + crypto.randomBytes(5).toString("hex"),
    app = stage + "-app";
  try {
    fs.cpSync(electron, stage, { recursive: true });
    fs.renameSync(
      path.join(stage, "electron"),
      path.join(stage, "zhitu-atlas"),
    );
    fs.mkdirSync(app, { recursive: true });
    for (const name of ["out", "web-dist"])
      fs.cpSync(path.join(ui, name), path.join(app, name), { recursive: true });
    fs.mkdirSync(path.join(app, "resources"));
    fs.copyFileSync(
      path.join(ui, "resources/icon.png"),
      path.join(app, "resources/icon.png"),
    );
    fs.writeFileSync(
      path.join(app, "package.json"),
      JSON.stringify(
        {
          name: "zhitu-atlas-desktop",
          productName: "职途 Atlas",
          version: manifest.version,
          main: "out/main/index.js",
          author: manifest.author,
          dependencies: { fflate: manifest.dependencies.fflate },
        },
        null,
        2,
      ),
    );
    fs.cpSync(
      path.resolve(path.dirname(require.resolve("fflate")), ".."),
      path.join(app, "node_modules/fflate"),
      { recursive: true },
    );
    assertPublicBuild(app);
    await createPackage(app, path.join(stage, "resources/app.asar"));
    fs.rmSync(path.join(stage, "resources/default_app.asar"), { force: true });
    fs.copyFileSync(
      path.join(ui, "resources/icon.png"),
      path.join(stage, "resources/atlas-icon.png"),
    );
    fs.mkdirSync(path.join(stage, "licenses"), { recursive: true });
    fs.copyFileSync(path.join(electron,'LICENSE'),path.join(stage,'licenses/Electron-LICENSE'));
    for (const name of ['LICENSE','THIRD_PARTY_NOTICES.md','SECURITY.md']) fs.copyFileSync(path.resolve(name),path.join(stage,name));
    const licenseReport=require('./atlas-licenses.cjs').collectLicenses(path.join(stage,'licenses/dependencies'));
    fs.writeFileSync(path.join(stage,'licenses/collection-report.json'),JSON.stringify(licenseReport,null,2));
    fs.mkdirSync(path.join(stage,'docs/licenses'),{recursive:true});
    for(const name of ['PROVENANCE.md','OPERATIONS.md','MAP_DATA_SOURCES.md','PRIVACY.md','GENERAL_RELEASE_022.md','LICENSE_AUDIT_20260922.md','DISTRIBUTION_0221.md','QUICK_START.md'])fs.copyFileSync(path.resolve('docs',name),path.join(stage,'docs',name));
    fs.cpSync(path.resolve('docs/licenses'),path.join(stage,'docs/licenses'),{recursive:true});
    fs.copyFileSync(path.resolve('scripts/atlas-install-release.cjs'),path.join(stage,'install.cjs'));
    for (const name of ['start.sh', 'install.sh']) {
      fs.copyFileSync(path.resolve('scripts/release', name), path.join(stage, name));
      fs.chmodSync(path.join(stage, name), 0o755);
    }
    fs.copyFileSync(path.resolve('docs/QUICK_START.md'), path.join(stage, 'START_HERE.md'));
    fs.cpSync(path.resolve('examples'), path.join(stage, 'examples'), { recursive: true });
    fs.writeFileSync(path.join(stage,'INSTALL.txt'),'Linux '+process.arch+'\n无需 sudo、Node.js 或额外浏览器。\n解压后：./start.sh\n安装到应用菜单：./install.sh\n首次使用见 START_HERE.md；示例文件在 examples/。\nRequires a Linux graphical desktop and system libraries; see docs/OPERATIONS.md.\nRun: ./start.sh | Install: ./install.sh\nVerify the downloaded archive against the separately published SHA256SUMS before installing.\n');
    fs.copyFileSync(path.resolve("docs/licenses/coordtransform.txt"), path.join(stage, "licenses/coordtransform.txt"));
    fs.copyFileSync(path.resolve("docs/MAP_DATA_SOURCES.md"), path.join(stage, "licenses/MAP_DATA_SOURCES.md"));
    const files = [];
    function walk(dir) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, item.name);
        if (item.isSymbolicLink()) throw Error("发布包不接受符号链接");
        if (item.isDirectory()) walk(p);
        else
          files.push({
            path: path.relative(stage, p),
            sha256: sha256(p),
            mode: fs.statSync(p).mode & 0o777,
          });
      }
    }
    walk(stage);
    fs.writeFileSync(
      path.join(stage, "release-manifest.json"),
      JSON.stringify(
        {
          product: "zhitu-atlas",
          version: manifest.version,
          platform: process.platform,
          arch: process.arch,
          files,
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(stage, 'release-manifest.sha256'), sha256(path.join(stage, 'release-manifest.json')) + '\n');
    fs.renameSync(stage, dest);
    return {
      directory: dest,
      version: manifest.version,
      manifestSha256: sha256(path.join(dest, "release-manifest.json")),
      archiveSha256: sha256(path.join(dest, "resources/app.asar")),
    };
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
module.exports = { packageRelease };
if (require.main === module)
  packageRelease(process.argv[2])
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
