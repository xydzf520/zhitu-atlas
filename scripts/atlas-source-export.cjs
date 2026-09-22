// Export reviewed working source without Git history, dependencies, builds or user data.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { sourceFiles, checkRepository, assertPublicBuild } = require('./atlas-public-check.cjs');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function exportSource(output, root = path.resolve(__dirname, '..')) {
  const dest = path.resolve(output);
  if (fs.existsSync(dest)) throw Error('源码输出目录已存在，请使用新目录');
  const check = checkRepository(root);
  if (check.issues.length) throw Error('当前源码未通过私有内容检查：' + JSON.stringify(check.issues));
  const files = [...new Set(sourceFiles(root))].filter(name => name !== 'SOURCE_MANIFEST.json');
  const stage = dest + '.next-' + crypto.randomBytes(6).toString('hex');
  const manifest = [];
  try {
    fs.mkdirSync(stage, { recursive: true });
    for (const name of files.sort()) {
      const input = path.join(root, name);
      if (!fs.existsSync(input)) continue;
      if (fs.lstatSync(input).isSymbolicLink() || !fs.lstatSync(input).isFile()) throw Error('源码不接受链接或特殊文件');
      if (name.split('/').some(p => ['..', '.git', 'node_modules', 'artifacts', 'out', 'web-dist', 'private', 'storage'].includes(p))) throw Error('源码路径不适合分发');
      const target = path.join(stage, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(input, target); fs.chmodSync(target, fs.statSync(input).mode & 0o777);
      manifest.push({ path: name, sha256: sha(target) });
    }
    assertPublicBuild(stage);
    fs.writeFileSync(path.join(stage, 'SOURCE_MANIFEST.json'), JSON.stringify({
      product: 'zhitu-atlas', version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
      scope: 'Working source snapshot; excludes Git history, installed dependencies and local data', files: manifest
    }, null, 2) + '\n');
    fs.renameSync(stage, dest);
    return { directory: dest, files: manifest.length, manifestSha256: sha(path.join(dest, 'SOURCE_MANIFEST.json')) };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
module.exports = { exportSource };
if (require.main === module) {
  try {
    if (!process.argv[2]) throw Error('请指定新的源码输出目录');
    console.log(JSON.stringify(exportSource(process.argv[2])));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
