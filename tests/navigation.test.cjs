const { test, before } = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm'),
  { build } = require('esbuild');
const { createMemoryHistory } = require('vue-router');
let api;
before(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents:
        "export * from './packages/ui/src/common/navigation';export * from './packages/ui/src/renderer/src/router/createAtlasRouter'"
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false,
    plugins: [
      {
        name: 'isolated-pages',
        setup(build) {
          build.onLoad({ filter: /\.vue$/ }, () => ({
            contents: 'export default {name:"IsolatedPage"}',
            loader: 'js'
          }));
        }
      }
    ]
  });
  const m = { exports: {} };
  vm.runInNewContext('(function(require,module,exports){' + result.outputFiles[0].text + '\n})', {
    console
  })(require, m, m.exports);
  api = m.exports;
});
test('every retained bookmark resolves once to an Atlas page and preserves filters and anchors', async () => {
  for (const name of api.atlasBookmarkPaths) {
    const router = api.createAtlasRouter({}, createMemoryHistory());
    await router.push('/main-layout/' + name + '?account=fixture&view=unrelated#item');
    const route = router.currentRoute.value;
    assert.ok(Object.hasOwn(api.atlasPageTitles, route.path.split('/').pop()));
    assert.equal(route.query.account, 'fixture');
    assert.equal(route.hash, '#item');
    assert.equal(api.resolveAtlasNavigation(route.path, route.query, route.hash), null);
    if (['ReadNoReplyReminder', 'StartChatRecord'].includes(name))
      assert.equal(route.query.view, 'replies');
  }
});
test('task and sync links share one canonical destination and remove only obsolete query fields', async () => {
  const router = api.createAtlasRouter({}, createMemoryHistory());
  await router.push('/main-layout/CareerSettings?section=tasks&account=fixture');
  assert.equal(router.currentRoute.value.path, '/main-layout/CareerTasks');
  assert.deepEqual(router.currentRoute.value.query, { account: 'fixture' });
  await router.push('/main-layout/CareerDashboard?view=sync&account=fixture');
  assert.equal(router.currentRoute.value.path, '/main-layout/CareerTasks');
  assert.deepEqual(router.currentRoute.value.query, { account: 'fixture', tab: 'sync' });
});
test('page titles use the actual page, and unrelated query fields cannot relabel discovery', () => {
  assert.equal(
    api.atlasPageTitle('/main-layout/CareerDiscovery', { view: 'companies' }),
    '机会发现'
  );
  assert.equal(
    api.atlasPageTitle('/main-layout/CareerDashboard', { view: 'companies' }),
    '企业与进展'
  );
  assert.equal(api.atlasPageTitle('/main-layout/CareerDashboard', { view: 'replies' }), '沟通中心');
  for (const name of ['constructor', '__proto__', 'toString']) {
    assert.equal(api.resolveAtlasNavigation('/main-layout/' + name), null);
    assert.equal(api.atlasPageTitle('/main-layout/' + name), '全景总览');
  }
});

test('a second historical bookmark for the current page normalizes the address without remounting', async () => {
  const history = createMemoryHistory();
  const router = api.createAtlasRouter({}, history);
  await router.push('/main-layout/ReadNoReplyReminder');
  const component = router.currentRoute.value.matched.at(-1).components.default;
  history.push('/main-layout/StartChatRecord');
  await router.push('/main-layout/StartChatRecord');
  assert.equal(history.location, '/main-layout/CareerDashboard?view=replies');
  assert.equal(router.currentRoute.value.matched.at(-1).components.default, component);
});
