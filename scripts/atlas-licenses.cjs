const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function supplementalLicenses(root) {
  const dir = path.join(root, 'docs/licenses'), file = path.join(dir, 'dependencies.json');
  if (!fs.existsSync(file)) return new Map();
  const result = new Map();
  for (const row of JSON.parse(fs.readFileSync(file, 'utf8')).packages) {
    const id = row.name + '@' + row.version;
    const resolved = path.resolve(dir, row.file);
    if (!resolved.startsWith(path.resolve(dir) + path.sep) || result.has(id))
      throw Error('补充许可路径或版本重复：' + id);
    if (!/^[a-f0-9]{64}$/.test(row.sha256) || digest(resolved) !== row.sha256)
      throw Error('补充许可校验失败：' + id);
    if (!/^https:\/\//.test(row.source)) throw Error('补充许可缺少来源：' + id);
    result.set(id, row);
  }
  return result;
}
function collectLicenses(output, root = path.resolve(__dirname, '..')) {
  fs.mkdirSync(output, { recursive: true });
  const supplements = supplementalLicenses(root);
  const seen = new Set(),
    rows = [];
  function moduleDirectory(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(dir, entry.name);
      if (entry.name.startsWith('@')) {
        moduleDirectory(file);
        continue;
      }
      let actual;
      try {
        actual = fs.realpathSync(file);
      } catch {
        continue;
      }
      if (seen.has(actual) || !fs.existsSync(path.join(actual, 'package.json'))) continue;
      seen.add(actual);
      const pkg = JSON.parse(fs.readFileSync(path.join(actual, 'package.json'), 'utf8'));
      const id = (pkg.name + '@' + pkg.version).replace(/[^A-Za-z0-9._@+-]/g, '_');
      const names = fs
        .readdirSync(actual)
        .filter(
          (n) =>
            /^(?:licen[cs]e|copying|notice|authors)(?:[._-].*)?$/i.test(n) &&
            fs.statSync(path.join(actual, n)).isFile()
        );
      const supplemental = supplements.get(pkg.name + '@' + pkg.version);
      const hasLicense = names.some((n) => /^(?:licen[cs]e|copying)(?:[._-].*)?$/i.test(n));
      const dest = path.join(output, id);
      if (names.length) {
        fs.mkdirSync(dest, { recursive: true });
        for (const n of names) fs.copyFileSync(path.join(actual, n), path.join(dest, n));
      }
      let applied = null;
      if (supplemental && !hasLicense) {
        if (supplemental.license !== (typeof pkg.license === 'string' ? pkg.license : pkg.license?.type))
          throw Error('补充许可与包声明不一致：' + id);
        if (supplemental.sourceFile &&
            (path.basename(supplemental.sourceFile) !== supplemental.sourceFile ||
             digest(path.join(actual, supplemental.sourceFile)) !== supplemental.sourceSha256))
          throw Error('包内许可来源校验失败：' + id);
        fs.mkdirSync(dest, { recursive: true });
        fs.copyFileSync(
          path.join(root, 'docs/licenses', supplemental.file),
          path.join(dest, 'LICENSE.supplemental.txt')
        );
        names.push('LICENSE.supplemental.txt');
        applied = supplemental;
      }
      rows.push({
        name: pkg.name,
        version: pkg.version,
        author: pkg.author || null,
        repository: pkg.repository || null,
        supplementalSource: applied?.source || null,
        supplemental: applied,
        license: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type || '未声明',
        files: names.map((n) => id + '/' + n),
        textStatus: hasLicense || applied ? 'included' : 'review-required',
        textOrigin: hasLicense ? 'package-file' : applied?.method || 'declaration-only'
      });
    }
  }
  const store = path.join(root, 'node_modules/.pnpm');
  if (fs.existsSync(store))
    for (const item of fs.readdirSync(store))
      moduleDirectory(path.join(store, item, 'node_modules'));
  moduleDirectory(path.join(root, 'node_modules'));
  moduleDirectory(path.join(root, 'packages/ui/node_modules'));
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  if (!rows.some((r) => r.name === 'vue') || !rows.some((r) => r.name === 'fflate'))
    throw Error('依赖许可清单不完整，请先安装锁文件依赖');
  fs.writeFileSync(
    path.join(output, 'index.json'),
    JSON.stringify(
      {
        scope:
          'All installed workspace dependencies, including build tooling; not a runtime dependency claim',
        packages: rows
      },
      null,
      2
    )
  );
  return {
    packages: rows.length,
    supplementalTexts: rows.filter((r) => r.supplemental).length,
    missingTexts: rows.filter((r) => r.textStatus === 'review-required').map((r) => r.name + '@' + r.version)
  };
}
module.exports = { collectLicenses };
if (require.main === module)
  console.log(
    JSON.stringify(collectLicenses(path.resolve(process.argv[2] || 'artifacts/licenses')))
  );
