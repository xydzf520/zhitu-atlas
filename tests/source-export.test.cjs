const { test, after } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { exportSource } = require('../scripts/atlas-source-export.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-source-export-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
function source() {
  const dir = fs.mkdtempSync(path.join(root, 'source-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"zhitu-atlas","version":"fixture"}');
  fs.writeFileSync(path.join(dir, 'README.md'), 'fixture source');
  fs.mkdirSync(path.join(dir, 'node_modules')); fs.writeFileSync(path.join(dir, 'node_modules/noise.js'), 'dependency');
  return dir;
}
test('a history-free source export contains only source and an integrity manifest and can be re-exported', () => {
  const input = source(), output = path.join(root, 'public'), result = exportSource(output, input);
  assert.equal(result.files, 2);
  assert.ok(!fs.existsSync(path.join(output, '.git')));
  assert.ok(!fs.existsSync(path.join(output, 'node_modules')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'SOURCE_MANIFEST.json'))).files.length, 2);
  assert.equal(exportSource(path.join(root, 'public-again'), output).files, 2);
  assert.throws(() => exportSource(output, input), /已存在/);
});
test('credentials or retired map assets prevent source export rather than getting silently copied', () => {
  const input = source(); fs.mkdirSync(path.join(input, 'private')); fs.writeFileSync(path.join(input, 'private/maps.json'), '{}');
  assert.throws(() => exportSource(path.join(root, 'bad-private'), input), /私有内容检查/);
  fs.rmSync(path.join(input, 'private'), { recursive: true });
  const data = path.join(input, 'packages/ui/src/common/data'); fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'map-boundaries.json'), '{}');
  assert.throws(() => exportSource(path.join(root, 'bad-map'), input), /map-redistribution/);
});
