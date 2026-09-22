// Full packaged-client check with a fresh data root. No platform login or model credentials.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict'),
  { spawn } = require('node:child_process'),
  puppeteer = require('puppeteer');
const release = path.resolve(process.argv[2]),
  output = path.resolve(process.argv[3] || 'artifacts/independent-runtime-check');
fs.mkdirSync(output, { recursive: true });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-client-check-')),
  env = {
    ...process.env,
    ATLAS_DATA_ROOT: path.join(root, 'data'),
    ATLAS_PORT: process.env.ATLAS_CHECK_PORT || '5188'
  },
  sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let child, browser, webBrowser, modelServer;
const checks = [],
  errors = [];
async function until(fn) {
  for (let i = 0; i < 120; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(250);
  }
  throw Error('Runtime check timed out');
}
(async () => {
  const fd = fs.openSync(path.join(output, 'runtime.log'), 'w');
  child = spawn(
    path.join(release, 'zhitu-atlas'),
    [
      '--ozone-platform=x11',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9338'
    ],
    { env, stdio: ['ignore', fd, fd] }
  );
  fs.closeSync(fd);
  await until(() => fetch('http://127.0.0.1:9338/json/version').then((r) => r.ok));
  browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9338',
    defaultViewport: null
  });
  const page = await until(async () => {
    const p = (await browser.pages()).find((p) => p.url().includes('out/renderer'));
    return p && (await p.$('.atlas-shell')) ? p : null;
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const rpc = (channel, payload) =>
    page.evaluate((c, p) => window.electron.ipcRenderer.invoke(c, p), channel, payload);
  assert.equal(
    (await rpc('atlas-runtime-info')).version,
    JSON.parse(fs.readFileSync(path.join(release, 'release-manifest.json'), 'utf8')).version
  );
  assert.equal((await rpc('career-runtime-status')).protocol, 2);
  checks.push('packaged preload, IPC and managed backend');
  await assert.rejects(rpc('fetch-config-file-content'), /不可用/);
  checks.push('legacy file IPC unavailable');
  const state = await rpc('career-workspace-snapshot');
  assert.equal(state.state.profile.name, '');
  assert.equal((await rpc('career-policy-load')).value.automationPaused, true);
  assert.equal((await rpc('career-model-settings')).configured, false);
  await page.waitForSelector('.setup-guide');
  await page.evaluate(() =>
    Array.from(document.querySelectorAll('.setup-guide button'))
      .find((b) => b.textContent.includes('查看示例'))
      .click()
  );
  await page.waitForSelector('.demo-flow');
  assert.ok(await page.$('.demo-flow article'));
  await page.evaluate(() =>
    Array.from(document.querySelectorAll('.el-dialog button'))
      .find((b) => b.textContent.includes('关闭示例'))
      .click()
  );
  assert.equal((await rpc('career-workspace-snapshot')).state.profile.name, '');
  checks.push('fresh install paused; fictional preview never writes user data');
  state.state.profile.name = '隔离桌面验证';
  await rpc('career-workspace-save', {
    state: JSON.stringify(state.state),
    baseRevision: state.revision
  });
  webBrowser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox']
  });
  const web = await webBrowser.newPage();
  await web.goto(`http://127.0.0.1:${env.ATLAS_PORT}/desktop.html`);
  await web.waitForSelector('.atlas-shell');
  const name = await web.evaluate(async () => {
    const t = document.querySelector('meta[name="atlas-session"]').content;
    return (
      await (
        await fetch('/atlas-api/rpc', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-atlas-token': t },
          body: JSON.stringify({ channel: 'career-workspace-load' })
        })
      ).json()
    ).data.profile.name;
  });
  assert.equal(name, '隔离桌面验证');
  // Exercise map onboarding with synthetic tiles. No map account or real map request.
  let mapFailure = false, tileRequests = 0;
  const fixtureTile = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
  await web.setRequestInterception(true);
  web.on('request', async req => {
    if (req.url().endsWith('/atlas-api/rpc')) {
      let body; try { body = JSON.parse(req.postData() || '{}') } catch {}
      if (body?.channel === 'career-map-tile') {
        tileRequests++;
        return req.respond({ status: mapFailure ? 400 : 200, contentType: 'application/json',
          body: JSON.stringify(mapFailure ? { error: '隔离地图连接失败' } : { data: fixtureTile }) });
      }
    }
    return req.continue();
  });
  await web.waitForSelector('.map-connect-state');
  assert.equal((await rpc('career-map-settings')).configured, false);
  assert.equal(tileRequests, 0);
  await web.evaluate(() => location.hash = '/main-layout/CareerSettings?section=map');
  await web.waitForSelector('.map-settings input[type=password]');
  await web.type('.map-settings input[type=password]', '0123456789abcdef0123456789abcdef');
  const checksOnPage = await web.$$('.map-settings input[type=checkbox]');
  for (const checkbox of checksOnPage) await checkbox.click();
  await web.click('.map-settings button[type=submit]');
  await until(async () => (await rpc('career-map-settings')).configured);
  await until(async () => (await web.$eval('.map-settings input[type=password]', el => el.value)) === '');
  await web.evaluate(() => location.hash = '/main-layout/CareerDashboard');
  await until(async () => tileRequests > 0 && (await web.$$('.street-map img.leaflet-tile-loaded')).length > 0);
  for (const size of [{width:1280,height:720},{width:1920,height:1080}]) {
    await web.setViewport(size);
    await web.$eval('.map-shell', el => el.scrollIntoView({block:'center'}));
    await web.screenshot({path:path.join(output,'map-fixture-'+size.width+'.png')});
  }
  mapFailure = true;
  await web.evaluate(() => Array.from(document.querySelectorAll('.map-toolbar button')).find(b => b.textContent.includes('重新加载地图')).click());
  await until(async () => await web.$eval('.map-connect-state', el => el.textContent.includes('暂不可用')));
  assert.ok(await web.$('.address-panel[open]'));
  checks.push('map settings save privately; synthetic WMTS tiles render; failure keeps address access; no real map request');
  const currentMap = await rpc('career-map-settings');
  await rpc('career-map-settings-save',{revision:currentMap.revision,enabled:false,termsAccepted:false,clearKey:true});
  // New users can download an empty template and preview an example before committing.
  const sample = fs.readFileSync(path.join(release,'examples/jobs-fictional.json'),'utf8');
  const imported = await rpc('career-import-preview',{format:'json',text:sample});
  assert.equal(imported.newCount,2); assert.equal(imported.errors.length,0);
  assert.equal((await rpc('career-workspace-snapshot')).state.opportunities.length,0);
  assert.equal((await rpc('career-import-commit',{format:'json',text:sample,baseRevision:imported.revision})).added,2);
  const secondPreview = await rpc('career-import-preview',{format:'json',text:sample});
  assert.equal(secondPreview.newCount,0); assert.equal(secondPreview.duplicateCount,2);
  assert.equal((await rpc('career-workspace-snapshot')).state.opportunities.length,2);
  assert.equal((await rpc('career-policy-load')).value.automationPaused,true);
  checks.push('included import examples preview, commit and deduplicate without sending');
  await web.close();
  checks.push('desktop write and production web read share SQLite');
  const routes = [
    'CareerDashboard',
    'CareerDiscovery',
    'CareerDashboard?view=companies',
    'CareerDashboard?view=replies',
    'CareerWorkspace',
    'CareerTasks',
    'CareerSettings',
    'CareerSettings?section=start',
    'CareerAgents'
  ];
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 }
  ]) {
    await page.setViewport(size);
    for (let i = 0; i < routes.length; i++) {
      await page.evaluate((route) => {
        location.hash = '/main-layout/' + route;
      }, routes[i]);
      await sleep(500);
      assert.ok(
        await page.evaluate(
          () => document.querySelector('.atlas-route-content')?.textContent.trim().length > 20
        ),
        routes[i]
      );
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        routes[i] + ' overflow'
      );
      if (i === 0 || i === 6)
        await page.screenshot({
          path: path.join(output, `${i === 0 ? 'overview' : 'settings'}-${size.width}.png`)
        });
    }
  }
  checks.push('all existing screens and first-use guide at 1280×720 and 1920×1080');
  // Exercise the real settings UI and backend HTTP transport using a loopback-only fixture.
  const modelRequests = [];
  modelServer = require('node:http').createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models')
      return res.end(JSON.stringify({ data: [{ id: 'fixture-chat', object: 'model' }] }));
    if (req.url !== '/v1/chat/completions') {
      res.statusCode = 404;
      return res.end('{}');
    }
    let text = '';
    for await (const part of req) text += part;
    const body = JSON.parse(text);
    modelRequests.push({ body, authorization: req.headers.authorization });
    const roundTrip = body.messages.some(
      (m) => m.role === 'tool' && JSON.parse(m.content).answer === 'atlas-tool-ok'
    );
    const message = roundTrip
      ? { role: 'assistant', content: JSON.stringify({ ok: true, answer: 'atlas-tool-ok' }) }
      : {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'fixture-probe',
              type: 'function',
              function: { name: 'atlas_connection_probe', arguments: '{"value":7}' }
            }
          ]
        };
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: roundTrip ? 'stop' : 'tool_calls', message }],
        usage: { total_tokens: 20 }
      })
    );
  });
  await new Promise((r) => modelServer.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + modelServer.address().port + '/v1';
  await page.evaluate(() => (location.hash = '/main-layout/CareerSettings?section=model'));
  await page.waitForSelector('.model .fields input');
  const field = async (label, value) => {
    const h = await page.evaluateHandle(
      (text) =>
        Array.from(document.querySelectorAll('.model label'))
          .find((l) => l.textContent.includes(text))
          ?.querySelector('input'),
      label
    );
    assert.ok(h.asElement(), 'Missing field ' + label);
    await h.asElement().click({ clickCount: 3 });
    await page.keyboard.type(value);
    return h;
  };
  await field('Base URL', base);
  await field('默认模型', 'fixture-chat');
  await page.keyboard.press('Enter');
  const click = async (text) =>
    page.evaluate((t) => {
      const button = Array.from(document.querySelectorAll('.model button')).find((b) =>
        b.textContent.includes(t)
      );
      if (!button || button.disabled) throw Error('Button unavailable: ' + t);
      button.click();
    }, text);
  await click('保存模型配置');
  await until(async () => {
    const c = await rpc('career-model-settings');
    return c.configured && c.model === 'fixture-chat';
  });
  const cfg = await rpc('career-model-settings');
  assert.equal(cfg.generationOptions.maxOutputTokens, 4096);
  assert.equal(cfg.generationOptions.budgetMode, 'task');
  assert.equal(cfg.generationOptions.reasoning, 'default');
  assert.equal(JSON.stringify(cfg).includes('providerApiSecret'), false);
  await until(() =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('.model button')).some(
        (b) => b.textContent.includes('测试生成') && !b.disabled
      )
    )
  );
  await click('读取模型列表');
  await until(() =>
    page.evaluate(() => document.querySelector('.catalog')?.textContent.includes('1 个可选模型'))
  );
  await click('测试生成与工具调用');
  await until(async () => {
    const c = await rpc('career-model-settings');
    return c.verification?.generation && c.verification?.toolCalling;
  });
  assert.equal(modelRequests.length, 2);
  assert.ok(
    modelRequests.every(
      (r) => !r.authorization && r.body.max_tokens === 1024 && !r.body.reasoning_effort
    )
  );
  assert.equal((await rpc('career-policy-load')).value.automationPaused, true);
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 }
  ]) {
    await page.setViewport(size);
    await page.screenshot({ path: path.join(output, 'model-' + size.width + '.png') });
  }
  checks.push(
    'settings UI saves custom keyless model, reads catalog, verifies tool round-trip over HTTP, preserves automation pause'
  );
  const runtime = path.join(env.ATLAS_DATA_ROOT, 'storage/atlas-runtime.json'),
    old = JSON.parse(fs.readFileSync(runtime));
  process.kill(old.pid, 'SIGKILL');
  await until(() => {
    const v = JSON.parse(fs.readFileSync(runtime));
    return v.pid !== old.pid && v.protocol === 2;
  });
  await until(async () => await rpc('career-runtime-status'));
  assert.equal((await rpc('career-workspace-load')).profile.name, '隔离桌面验证');
  checks.push('managed backend crash recovery preserves data');
  const duplicate = spawn(path.join(release, 'zhitu-atlas'), ['--ozone-platform=x11'], {
    env,
    stdio: 'ignore'
  });
  const exit = await new Promise((r) => duplicate.once('exit', r));
  assert.equal(exit, 0);
  checks.push('second desktop instance reuses current window');
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, 'result.json'),
    JSON.stringify({ passed: true, checks, pageErrors: errors, realMessages: 0 }, null, 2)
  );
  console.log(JSON.stringify({ passed: true, checks }));
})()
  .catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (modelServer) await new Promise((r) => modelServer.close(r));
    if (webBrowser) await webBrowser.close();
    if (browser) await browser.disconnect();
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((r) => child.once('exit', r)), sleep(10000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
