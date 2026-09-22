const { test, after } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { buildSync } = require('esbuild');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-map-config-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: "export * from './packages/ui/src/main/features/atlas-map';export * from './packages/ui/src/common/map-provider'" }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const key = '0123456789abcdef0123456789abcdef'; // synthetic fixture
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
function fixture(fetcher = async () => new Response(png, { headers: { 'content-type': 'image/png' } })) {
  const dir = fs.mkdtempSync(path.join(root, 'data-')), m = { exports: {} }, requests = [];
  vm.runInNewContext('(function(require,module,exports){' + bundle + '\n})', { Buffer, URL, URLSearchParams, Response, AbortSignal, process: { ...process, env: { ...process.env, ATLAS_DATA_ROOT: dir } }, fetch: async (...args) => { requests.push(args); return fetcher(...args) } })(require, m, m.exports);
  const a = m.exports;
  const configure = () => a.saveMapSettings({ revision: a.mapSettings().revision, enabled: true, termsAccepted: true, key });
  const tile = () => ({ layer: 'vec', z: 3, x: 6, y: 3, revision: a.mapSettings().revision });
  return { a, dir, requests, configure, tile };
}
test('fresh maps need no account; private keys never appear in read APIs and stale saves are rejected', async () => {
  const f = fixture(), old = f.a.mapSettings();
  assert.equal(old.configured, false);
  await assert.rejects(f.a.mapTile(f.tile()), /先在设置/);
  assert.equal(f.requests.length, 0);
  const saved = f.configure();
  assert.ok(!JSON.stringify(saved).includes(key));
  assert.equal(saved.includedInBackup, false);
  const file = path.join(f.dir, 'private/maps.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.throws(() => f.a.saveMapSettings({ revision: old.revision, enabled: false, termsAccepted: false }), /已变化/);
  assert.equal(JSON.parse(fs.readFileSync(file)).key, key);
  const cleared = f.a.saveMapSettings({ revision: saved.revision, enabled: false, termsAccepted: false, clearKey: true });
  assert.equal(cleared.hasKey, false);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(key));
});
test('map requests are restricted to official layers and valid coordinates, with no redirect', async () => {
  const f = fixture(); f.configure();
  for (const invalid of [{ z: 19 }, { x: -1 }, { y: 8 }, { layer: 'https://example.org' }, { revision: '' }, { x: 1.5 }])
    await assert.rejects(f.a.mapTile({ ...f.tile(), ...invalid }), /支持范围/);
  assert.equal(f.requests.length, 0);
  const result = await f.a.mapTile(f.tile());
  assert.ok(result.startsWith('data:image/png;base64,'));
  const [url, options] = f.requests[0];
  assert.equal(url.hostname, 't0.tianditu.gov.cn');
  assert.equal(url.searchParams.get('tk'), key);
  assert.equal(url.searchParams.get('TILEMATRIXSET'), 'w');
  assert.equal(options.redirect, 'error');
});
test('authorization text, fake images, oversized content and fetch errors never become map tiles or leak keys', async () => {
  for (const response of [
    () => new Response('{"error":"bad key"}', { headers: { 'content-type': 'application/json' } }),
    () => new Response('<script>fake</script>', { headers: { 'content-type': 'image/png' } }),
    () => new Response(png, { headers: { 'content-type': 'image/png', 'content-length': '1048577' } }),
    () => { throw Error('network error ' + key) }
  ]) {
    const f = fixture(response); f.configure();
    await assert.rejects(f.a.mapTile(f.tile()), e => !e.message.includes(key));
  }
});
test('identical in-flight tiles share a request; changes during a request invalidate its result', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve })); f.configure();
  const p = f.a.mapTile(f.tile()), q = f.a.mapTile(f.tile());
  assert.equal(f.requests.length, 1);
  f.a.saveMapSettings({ revision: f.a.mapSettings().revision, enabled: false, termsAccepted: false });
  finish(new Response(png, { headers: { 'content-type': 'image/png' } }));
  await Promise.all([assert.rejects(p, /已更新/), assert.rejects(q, /已更新/)]);
});
test('map service caps simultaneous network requests across windows', async () => {
  let pending = 0, peak = 0;
  const f = fixture(async () => { pending++; peak = Math.max(pending, peak); await new Promise(r => setTimeout(r, 5)); pending--; return new Response(png, { headers: { 'content-type': 'image/png' } }); });
  f.configure();
  await Promise.all(Array.from({ length: 20 }, (_, i) => f.a.mapTile({ ...f.tile(), z: 5, x: i })));
  assert.equal(peak, 8);
});
test('map private setting refuses symlinks and excludes unsupported key formats', () => {
  const f = fixture();
  assert.throws(() => f.a.saveMapSettings({ revision: f.a.mapSettings().revision, enabled: true, termsAccepted: true, key: 'bad' }), /32 位/);
  f.configure();
  const file = path.join(f.dir, 'private/maps.json'); fs.renameSync(file, file + '.original'); fs.symlinkSync(file + '.original', file);
  assert.throws(f.a.mapSettings, /安全读取/);
});
