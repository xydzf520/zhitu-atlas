const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { collectLicenses } = require('../scripts/atlas-licenses.cjs');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-license-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), data);
  };
  const pkg = (name, version = '1.0.0', license = 'MIT') => {
    write(`node_modules/${name}/package.json`, JSON.stringify({ name, version, license }));
  };
  for (const name of ['vue', 'fflate']) {
    pkg(name);
    write(`node_modules/${name}/LICENSE`, 'fixture license');
  }
  pkg('example');
  const row = {
    name: 'example', version: '1.0.0', license: 'MIT', file: 'example.txt',
    source: 'https://example.org/exact-ref/LICENSE', method: 'upstream-license',
    sha256: sha('fixture supplemental license')
  };
  write('docs/licenses/example.txt', 'fixture supplemental license');
  const manifest = (rows) => write('docs/licenses/dependencies.json', JSON.stringify({ packages: rows }));
  const collect = () => {
    const output = path.join(root, 'out');
    const report = collectLicenses(output, root);
    return { report, rows: JSON.parse(fs.readFileSync(path.join(output, 'index.json'))).packages };
  };
  return { root, write, pkg, row, manifest, collect };
}
test('license collection retains attribution without treating AUTHORS or NOTICE as a license', (t) => {
  const f = fixture(t);
  f.write('node_modules/example/AUTHORS', 'Fixture authors');
  f.write('node_modules/example/NOTICE', 'Fixture attribution');
  const { report, rows } = f.collect();
  assert.deepEqual(report.missingTexts, ['example@1.0.0']);
  const row = rows.find((r) => r.name === 'example');
  assert.equal(row.files.length, 2);
  assert.equal(row.textOrigin, 'declaration-only');
});
test('exact-version supplements retain source and digest; other versions stay unresolved', (t) => {
  const f = fixture(t);
  f.manifest([f.row]);
  let result = f.collect();
  assert.deepEqual(result.report.missingTexts, []);
  assert.equal(result.rows.find((r) => r.name === 'example').supplemental.sha256, f.row.sha256);
  f.pkg('example', '2.0.0');
  result = f.collect();
  assert.deepEqual(result.report.missingTexts, ['example@2.0.0']);
  assert.equal(result.report.supplementalTexts, 0);
});
test('corrupt supplemental text and mismatching license declarations fail closed', (t) => {
  const f = fixture(t);
  f.manifest([f.row]);
  f.write('docs/licenses/example.txt', 'changed license');
  assert.throws(f.collect, /补充许可校验失败/);
  f.write('docs/licenses/example.txt', 'fixture supplemental license');
  f.pkg('example', '1.0.0', 'BSD-2-Clause');
  assert.throws(f.collect, /与包声明不一致/);
});
test('embedded license evidence is bound to the original README content', (t) => {
  const f = fixture(t);
  f.write('node_modules/example/README.md', 'fixture original readme');
  f.manifest([{ ...f.row, method: 'package-readme-license', sourceFile: 'README.md',
    sourceSha256: sha('fixture original readme') }]);
  assert.equal(f.collect().rows.find((r) => r.name === 'example').textOrigin, 'package-readme-license');
  f.write('node_modules/example/README.md', 'different package contents');
  assert.throws(f.collect, /包内许可来源校验失败/);
});
test('invalid supplemental paths and duplicate exact-version evidence are rejected', (t) => {
  const f = fixture(t);
  f.manifest([{ ...f.row, file: '../outside.txt' }]);
  assert.throws(f.collect, /路径或版本重复/);
  f.manifest([f.row, f.row]);
  assert.throws(f.collect, /路径或版本重复/);
});
test('workspace aliases of the same installed package do not inflate dependency counts', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'packages/ui/node_modules'), { recursive: true });
  fs.symlinkSync(path.join(f.root, 'node_modules/example'), path.join(f.root, 'packages/ui/node_modules/example'));
  assert.equal(f.collect().report.packages, 3);
});
