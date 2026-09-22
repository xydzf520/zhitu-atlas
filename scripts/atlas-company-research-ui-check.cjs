const puppeteer = require("puppeteer"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const out = path.resolve("artifacts/company-research-20260920/ui");
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage(),
    errors = [],
    checks = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", (r) =>
    r.url().startsWith("http://127.0.0.1:5196") || r.url().startsWith("data:")
      ? r.continue()
      : r.abort(),
  );
  try {
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(
      "http://127.0.0.1:5196/desktop.html#/main-layout/CareerDashboard?view=replies",
    );
    await page.waitForSelector(".conversation-row");
    await page.click(".conversation-row");
    await page.waitForSelector(".research-open");
    await page.click(".research-open");
    await page.waitForSelector(".research-summary");
    assert.ok(
      await page.$eval(".research-summary", (e) =>
        e.textContent.includes("确认企业主体"),
      ),
    );
    checks.push("打开来源化企业报告");
    assert.equal(await page.$$eval(".research-card", (a) => a.length), 4);
    checks.push("四类企业事实卡");
    assert.ok(
      await page.$eval(".research-card:nth-child(3)", (e) =>
        e.textContent.includes("待核实"),
      ),
    );
    checks.push("未知客户不补造");
    assert.ok(
      await page.$eval(".change", (e) => e.textContent.includes("生产协同")),
    );
    checks.push("新回复修正记录");
    await page.click(".source-chips button");
    assert.equal(await page.$$eval(".source-detail[open]", (a) => a.length), 1);
    checks.push("引用跳转来源");
    await page.click(".research-actions input[type=checkbox]");
    await page.waitForFunction(
      () =>
        document.querySelector(".research-actions input[type=checkbox]")
          .checked,
    );
    checks.push("自动修正启停保存");
    for (const width of [1280, 1920]) {
      await page.setViewport({ width, height: width === 1280 ? 720 : 1080 });
      await page.$eval(".el-dialog__body", (e) => (e.scrollTop = 0));
      await page.waitForFunction(
        () =>
          Number(
            getComputedStyle(
              document.querySelector(".company-research-dialog").parentElement,
            ).opacity,
          ) > 0.99 &&
          Number(
            getComputedStyle(
              document
                .querySelector(".company-research-dialog")
                .closest(".el-overlay"),
            ).opacity,
          ) > 0.99,
      );
      await page.screenshot({
        path: path.join(out, "research-" + width + ".png"),
        fullPage: false,
      });
      assert.ok(
        await page.$eval(
          ".company-research-dialog",
          (e) => e.getBoundingClientRect().width <= innerWidth,
        ),
      );
      assert.ok(
        await page.$eval(
          ".research-body",
          (e) => e.scrollWidth <= e.clientWidth + 1,
        ),
      );
      checks.push(width + "布局无横向溢出");
    }
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () =>
        !document.querySelector(".company-research-dialog") ||
        getComputedStyle(
          document
            .querySelector(".company-research-dialog")
            .closest(".el-overlay"),
        ).display === "none",
    );
    checks.push("键盘退出报告");
    assert.equal(errors.length, 0);
    console.log(JSON.stringify({ checks, errors, passed: true }, null, 2));
    fs.writeFileSync(
      path.join(out, "result.json"),
      JSON.stringify({ checks, errors, passed: true }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
