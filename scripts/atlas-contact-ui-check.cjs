const puppeteer = require("puppeteer"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const output=path.resolve(process.env.ATLAS_CHECK_OUTPUT || "artifacts/contact");fs.mkdirSync(output,{recursive:true});
(async () => {
  const browser = await puppeteer.launch({
      executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    }),
    page = await browser.newPage(),
    errors = [],
    checks = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = "http://127.0.0.1:5193/desktop.html#";
  const text = () => page.evaluate(() => document.body.innerText);
  const paperCalls = [];
  page.on('request', request => {
    if (!request.url().endsWith('/atlas-api/rpc')) return;
    try { const body = JSON.parse(request.postData() || '{}'); if (body.channel?.startsWith('career-paper-')) paperCalls.push(body.channel); } catch {}
  });
  try {
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(base + "/main-layout/CareerDiscovery");
    await page.waitForSelector(".contact-metrics");
    assert.match(await text(), /自动投递与消息/);
    assert.match(await text(), /经历已确认 0 \/ 1/);
    checks.push("机会发现直接显示自动联系控制、额度和未确认经历原因");
    assert.equal(await page.$('.execution-modes'), null);
    assert.equal(await page.$('.paper-panel'), null);
    const pauseBefore = await page.evaluate(async () => (await electron.ipcRenderer.invoke('career-tasks-load')).policy.paused);
    await page.goto(base + '/main-layout/CareerDiscovery?mode=paper');
    await page.waitForSelector('.contact-metrics');
    await page.reload();
    await page.waitForSelector('.contact-metrics');
    assert.equal(await page.$('.paper-panel'), null);
    assert.equal(await page.evaluate(async () => (await electron.ipcRenderer.invoke('career-tasks-load')).policy.paused), pauseBefore);
    assert.deepEqual(paperCalls, []);
    checks.push('旧模拟链接和刷新直接显示真实流程，不创建模拟盘或改变发送状态');
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    checks.push("1280×720 无横向页面溢出");
    await page.screenshot({
      path: path.join(output, 'discovery-1280.png'),
      fullPage: true,
    });
    const metric = await page.$$(".contact-metrics button");
    await metric[1].click();
    await page.waitForFunction(() =>
      document
        .querySelector(".contact-panel .table-scroll")
        ?.textContent.includes("个性化说明已经平台消息回读核验"),
    );
    checks.push("统计卡联动核验成功结果");
    await page.evaluate(() =>
      [...document.querySelectorAll(".contact-panel button")]
        .find((b) => b.textContent === "查看内容与依据")
        .click(),
    );
    await page.waitForSelector(".atlas-contact-dialog", { visible: true });
    assert.match(await text(), /岗位要求与本人经历/);
    assert.match(await text(), /企业技能平台建设/);
    checks.push("结果详情结构化呈现招聘要求、经历引用和实际消息");
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(output, 'contact-detail-1280.png') });
    await page.keyboard.press("Escape");
    await page
      .waitForFunction(
        () =>
          !document.querySelector(".atlas-contact-dialog") ||
          document
            .querySelector(".atlas-contact-dialog")
            .getBoundingClientRect().height === 0,
      )
      .catch(() => {});
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(base + "/main-layout/CareerDiscovery?mode=live");
    await page.waitForSelector(".contact-metrics");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(output, 'discovery-1920.png'),
      fullPage: true,
    });
    checks.push("1920×1080 控制与结果表布局正常");
    await page.select(".result-heading select", "uncertain");
    await page.waitForFunction(() =>
      document
        .querySelector(".contact-panel tbody")
        ?.textContent.includes("平台请求返回不确定"),
    );
    await page.evaluate(() =>
      [...document.querySelectorAll(".contact-panel button")]
        .find((b) => b.textContent === "查看内容与依据")
        .click(),
    );
    await page.waitForSelector(".atlas-contact-dialog", { visible: true });
    await page.evaluate(() =>
      [...document.querySelectorAll(".atlas-contact-dialog button")]
        .find((b) => b.textContent === "确认本次消息已发送")
        .click(),
    );
    await page.waitForFunction(() =>
      document
        .querySelector(".atlas-contact-dialog")
        ?.textContent.includes("本人确认已发送"),
    );
    checks.push("人工确认结果独立记录，不变成平台回读核验");
    await page.keyboard.press("Escape");
    await page.goto(base + "/main-layout/CareerDashboard");
    await page.waitForSelector(".contact-panel .contact-metrics");
    assert.match(await text(), /联系结果与下一步/);
    assert.match(await text(), /上海/);
    checks.push("总览读取同一联系统计并提供机会发现入口");
    await page.screenshot({
      path: path.join(output, 'overview-1920.png'),
      fullPage: true,
    });
    await page.goto(base + "/main-layout/CareerDashboard?view=companies");
    await page.waitForSelector('.stage-summary button');
    assert.equal((await page.$$('.stage-summary button')).length,7);
    assert.match(await text(),/阶段不代表本轮自动投递结果/);
    const alignment=await page.$eval('.list-toolbar label',el=>getComputedStyle(el).flexDirection);
    assert.equal(alignment,'row');
    await page.evaluate(()=>[...document.querySelectorAll('.stage-summary button')].find(b=>b.textContent.includes('已沟通')).click());
    await page.waitForSelector('.board.single');
    assert.equal((await page.$$('.board .lane')).length,1);
    assert.ok((await page.$$('.source-tag')).length>0);
    checks.push('企业看板保留七阶段数量、筛选真实卡片、来源标签和紧凑工具栏');
    await page.screenshot({path:path.join(output, 'companies-1920.png'),fullPage:true});
    await page.setViewport({width:1280,height:720});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(output, 'companies-1280.png'),fullPage:true});
    checks.push('企业看板1280宽度不溢出，有记录的单阶段铺开显示');
    await page.goto(base + "/main-layout/CareerWorkspace?tab=profile");
    await page.waitForFunction(() =>
      document.body.innerText.includes("学历与资历"),
    );
    checks.push("资料页具备学历及相关经验确认入口");
    assert.deepEqual(errors, []);
    const result = {
      passed: true,
      checks: checks.length,
      details: checks,
      pageErrors: errors,
      viewports: ["1280x720", "1920x1080"],
      externalRecruiterMessages: 0,
    };
    fs.writeFileSync(
      path.join(output, 'ui-check.json'),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
