// UI-only profile editing against an isolated fixture; never changes personal data.
const puppeteer = require("puppeteer"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
(async () => {
  const browser = await puppeteer.launch({
      executablePath: "/usr/bin/google-chrome",
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    }),
    page = await browser.newPage(),
    checks = [],
    errors = [],
    writes = [];
  let conflict = true,
    saved = {
      version: 1,
      opportunities: [],
      profile: {
        name: "隔离测试用户",
        headline: "AI 产品负责人",
        summary: "产品规划、团队管理与 AI 应用建设。",
        targetRoles: ["AI产品负责人"],
        preferredCities: ["上海"],
        minimumMonthlyK: 40,
        resumeText:
          "隔离测试用户\n个人优势\n产品规划与 AI 应用建设\n工作经历\n测试企业 2020—2025\n项目经历\n企业技能平台建设",
        evidence: [
          {
            id: "one",
            title: "企业AI平台",
            text: "负责企业技能平台的规划、设计与部署。",
            source: "本人核实",
            keywords: ["AI", "平台"],
            confirmed: true,
          },
          {
            id: "two",
            title: "产品增长",
            text: "跨团队推进产品持续优化。",
            source: "本人陈述",
            keywords: ["增长"],
            confirmed: false,
          },
        ],
        qualifications: [],
      },
    },
    version = 1;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (!r.url().endsWith("/atlas-api/rpc")) return r.continue();
    const b = JSON.parse(r.postData() || "{}"),
      respond = (data, status = 200) =>
        r.respond({
          status,
          contentType: "application/json",
          body: JSON.stringify(status === 200 ? { data } : { error: data }),
        });
    if (b.channel === "career-workspace-snapshot")
      return respond({
        state: saved,
        revision: "revision-" + version,
        profileVersion: "profile-" + version,
      });
    if (b.channel === "career-workspace-save") {
      writes.push(b.payload);
      if (conflict)
        return respond("版本冲突：另一窗口已保存，请核对后再保存。", 409);
      assert.equal(b.payload.baseRevision, "revision-" + version);
      saved = JSON.parse(b.payload.state);
      version++;
      return respond({
        state: saved,
        revision: "revision-" + version,
        profileVersion: "profile-" + version,
      });
    }
    if (b.channel === "career-task-create")
      return respond({ taskId: "greeting-fixture" });
    if (b.channel === "career-task-get")
      return respond({
        state: "completed",
        result: {
          text: "结合岗位关注的企业平台规划，我有产品需求分析与跨团队交付经历，可以结合实际业务场景梳理需求并推动产品上线，期待进一步沟通。",
          model: "isolated-model",
          matches: [
            {
              evidenceId: "two",
              requirement: "平台规划",
              relevance: "真实产品经验",
              evidenceQuote: "跨团队推进产品持续优化。",
            },
          ],
          gaps: [],
          reviewReasons: [],
          decision: "ready",
          profileVersion: "profile-" + version,
        },
      });
    return r.continue();
  });
  const click = async (text, scope = "") =>
    page.evaluate(
      (text, scope) => {
        const b = [...document.querySelectorAll(scope + " button")].find(
          (e) =>
            e.textContent.trim() === text && e.getBoundingClientRect().height,
        );
        if (!b) throw Error("按钮不存在:" + text);
        b.click();
      },
      text,
      scope,
    );
  const section = async (text) => {
    await page.evaluate(
      (text) =>
        [...document.querySelectorAll(".profile-navigation nav button")]
          .find((e) => e.textContent.includes(text))
          .click(),
      text,
    );
    await page.waitForFunction(
      (text) =>
        document.querySelector(".profile-content h2")?.textContent === text,
      {},
      text,
    );
  };
  const input = async (selector, text) =>
    page.$eval(
      selector,
      (e, text) => {
        e.value = text;
        e.dispatchEvent(new Event("input", { bubbles: true }));
      },
      text,
    );
  try {
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(
      "http://127.0.0.1:5194/desktop.html#/main-layout/CareerWorkspace",
    );
    await page.waitForSelector(".resume-document");
    assert.equal(await page.$(".resume-edit"), null);
    assert.equal(
      await page.$eval(
        ".profile-tabs > .el-tabs__header",
        (e) => getComputedStyle(e).display,
      ),
      "none",
    );
    checks.push("默认简历排版预览，重复岗位工具收起，资料分类清晰");
    await page.screenshot({
      path: "artifacts/conversation-pitch/profile-1920.png",
    });
    await page.setViewport({ width: 1280, height: 720 });
    await page.screenshot({
      path: "artifacts/conversation-pitch/profile-1280.png",
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    checks.push("1920 与 1280 布局无横向溢出");
    await section("个人定位与优势");
    await input('textarea[aria-label="个人优势"]', "修改后的长期职业优势");
    await section("简历全文");
    await click("编辑简历全文");
    await input(
      'textarea[aria-label="简历全文编辑"]',
      "隔离测试用户\n完整简历调整，公司与项目仍分开。",
    );
    await section("个人定位与优势");
    assert.equal(
      await page.$eval('textarea[aria-label="个人优势"]', (e) => e.value),
      "修改后的长期职业优势",
    );
    checks.push("分类切换保留编辑，个人优势与简历全文分别维护");
    assert.equal(
      await page.$$eval(
        ".career-header button",
        (buttons) =>
          buttons.find((b) => b.textContent === "导出 Word").disabled,
      ),
      true,
    );
    await click("保存资料", ".career-header");
    await page.waitForFunction(() =>
      document
        .querySelector(".career-page>.el-alert")
        ?.textContent.includes("当前修改已保留"),
    );
    assert.equal(
      await page.$eval('textarea[aria-label="个人优势"]', (e) => e.value),
      "修改后的长期职业优势",
    );
    conflict = false;
    await click("保存资料", ".career-header");
    await page.waitForFunction(
      () => !document.querySelector(".workspace-savebar"),
    );
    assert.equal(saved.profile.summary, "修改后的长期职业优势");
    assert.match(saved.profile.resumeText, /完整简历调整/);
    checks.push("版本冲突保留草稿，保存携带版本，保存前禁止导出旧 Word");
    await section("AI 可引用经历");
    await click("已确认", ".evidence-toolbar");
    await page.click(".profile-evidence summary");
    await input(
      'textarea[aria-label="经历事实与成果"]',
      "更新后的真实平台建设经历",
    );
    assert.equal(
      await page.$eval(
        ".profile-evidence input[type=checkbox]",
        (e) => e.checked,
      ),
      false,
    );
    assert.equal(
      await page.$eval('textarea[aria-label="经历事实与成果"]', (e) => e.value),
      "更新后的真实平台建设经历",
    );
    checks.push("已确认经历编辑后撤销确认，编辑卡片不会因筛选条件改变消失");
    await click("移除此项", ".profile-content");
    await click("撤销", ".undo-bar");
    await click("全部", ".evidence-toolbar");
    assert.equal(await page.$$(".profile-evidence").then((a) => a.length), 2);
    checks.push("移除经历可撤销恢复原内容与位置");
    await input(".evidence-toolbar input", "不存在的经历");
    await page.waitForSelector(".profile-content .el-empty");
    await input(".evidence-toolbar input", "");
    await click("待确认", ".evidence-toolbar");
    assert.equal(await page.$$(".profile-evidence").then((a) => a.length), 2);
    checks.push("经历支持搜索、空结果和状态筛选");
    await click("添加经历");
    await page.waitForSelector(
      '.profile-evidence[open] input[aria-label="经历名称"]',
    );
    assert.equal(
      await page.$eval(
        ".profile-evidence[open] input[type=checkbox]",
        (e) => e.disabled,
      ),
      true,
    );
    await click("移除此项", ".profile-evidence[open]");
    checks.push("新增空经历禁止直接确认");
    await section("学历与资历");
    await click("添加资历");
    assert.equal(
      await page.$eval(
        ".profile-evidence input[type=checkbox]",
        (e) => e.disabled,
      ),
      true,
    );
    await page.$$eval(".profile-evidence .el-form-item", (items) => {
      const e = items
        .find((i) => i.textContent.includes("资历名称"))
        .querySelector("input");
      e.value = "测试学历";
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(await page.$eval(".profile-evidence", (e) => e.open), true);
    await click("移除此项", ".profile-content");
    await click("撤销", ".profile-content");
    assert.equal(await page.$$(".profile-evidence").then((a) => a.length), 1);
    await click("移除此项", ".profile-content");
    checks.push("资历为空时不能确认，删除支持撤销");
    await section("求职方向");
    assert.match(
      await page.$eval(".direction-list", (e) => e.textContent),
      /40K/,
    );
    assert.equal(await page.$(".direction-list input"), null);
    checks.push("求职方向只读引用统一策略，修改入口跳转机会发现");
    await click("保存资料", ".career-header");
    await page.waitForFunction(
      () => !document.querySelector(".workspace-savebar"),
    );
    await page.goto(
      "http://127.0.0.1:5194/desktop.html#/main-layout/CareerWorkspace?tab=match",
    );
    await page.waitForSelector(".match-grid");
    assert.equal(
      await page.$eval(
        ".match-grid",
        (e) => e.getBoundingClientRect().height > 0,
      ),
      true,
    );
    await page.$eval('input[placeholder="例如：AI 产品负责人"]', (e) => {
      e.value = "AI 产品负责人";
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.$eval('input[placeholder="公司名称"]', (e) => {
      e.value = "测试公司";
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("DeepSeek 生成匹配招呼");
    await page.waitForSelector(".atlas-ai-review-dialog", { visible: true });
    assert.match(
      await page.$eval(".atlas-ai-review-dialog", (e) => e.textContent),
      /测试公司/,
    );
    await page.click(".atlas-ai-review-dialog .el-checkbox");
    await click("确认并保存话术");
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".atlas-ai-review-dialog")
          ?.getBoundingClientRect().height,
    );
    assert.match(
      await page.$eval(
        ".greeting-composer .review-actions",
        (e) => e.textContent,
      ),
      /已由本人确认/,
    );
    checks.push("手动岗位评估的 AI 招呼同样弹窗确认并核对资料版本");
    await click("返回简历与资料".replace("返回", "← 返回"));
    checks.push("旧岗位评估路由仍可用并可返回资料");
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      "artifacts/conversation-pitch/profile-ui-check.json",
      JSON.stringify({ passed: checks.length, checks, errors }, null, 2),
    );
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
  } catch (e) {
    console.error("页面错误", errors);
    console.error(
      (await page.$eval("body", (e) => e.textContent)).slice(-4000),
    );
    await page.screenshot({
      path: "artifacts/conversation-pitch/profile-failure.png",
    });
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
