// Exercise the production web shell against scripts/atlas-model-ui-fixture.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const cases = [
  ['GeekAutoStartChatWithBoss?account=fixture', 'CareerDiscovery', '机会发现'],
  ['ReadNoReplyReminder', 'CareerDashboard?view=replies', '沟通中心'],
  ['StartChatRecord', 'CareerDashboard?view=replies', '沟通中心'],
  ['MarkAsNotSuitRecord', 'CareerDiscovery?filter=dismissed', '机会发现'],
  ['JobLibrary', 'CareerDiscovery?filter=all', '机会发现'],
  ['BossLibrary', 'CareerDashboard?view=companies', '企业与进展'],
  ['CompanyLibrary', 'CareerDashboard?view=companies', '企业与进展'],
  ['taskManager', 'CareerTasks', '任务中心'],
  ['CareerSettings?section=tasks&account=fixture', 'CareerTasks?account=fixture', '任务中心'],
  ['CareerDashboard?view=sync', 'CareerTasks?tab=sync', '任务中心']
];
async function main() {
  const output = path.resolve(process.env.ATLAS_CHECK_OUTPUT || 'artifacts/rewrite-0212/ui');
  fs.mkdirSync(output, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage(),
    errors = [],
    checks = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // The local fixture mocks server-side requests; do not fetch outside assets in the page.
  await page.setRequestInterception(true);
  page.on('request', (request) =>
    request.url().startsWith('http://127.0.0.1:5199/') || /^(data:|blob:)/.test(request.url())
      ? request.continue()
      : request.abort()
  );
  try {
    await page.setViewport({ width: 1280, height: 720 });
    for (const [input, expected, title] of cases) {
      await page.goto('http://127.0.0.1:5199/desktop.html#/main-layout/' + input, {
        waitUntil: 'domcontentloaded'
      });
      await page.waitForFunction(
        (title, expected) =>
          document.title === title + ' - 职途 Atlas' &&
          location.hash.split('?')[0] === '#/main-layout/' + expected.split('?')[0] &&
          document.querySelector('main')?.textContent.trim().length > 0,
        { timeout: 15000 },
        title,
        expected
      );
      const actual = new URL(page.url().split('#')[1], 'http://fixture');
      const target = new URL('/main-layout/' + expected, 'http://fixture');
      assert.equal(actual.pathname, target.pathname);
      for (const [key, value] of target.searchParams)
        assert.equal(actual.searchParams.get(key), value);
      if (input.includes('account=fixture'))
        assert.equal(actual.searchParams.get('account'), 'fixture');
      checks.push({ input, destination: actual.pathname + actual.search, title });
    }
    await page.screenshot({ path: path.join(output, 'shared-router-1280.png') });
    await page.setViewport({ width: 1920, height: 1080 });
    await page.screenshot({ path: path.join(output, 'shared-router-1920.png') });
    assert.deepEqual(errors, []);
    const report = { passed: true, checks, pageErrors: errors, realPlatformCalls: 0 };
    fs.writeFileSync(path.join(output, 'navigation-check.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'navigation-failure.png') });
    console.error(
      JSON.stringify({
        input: cases[checks.length]?.[0],
        url: page.url(),
        title: await page.title(),
        errors
      })
    );
    throw error;
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
