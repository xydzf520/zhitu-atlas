// Exercise the production UI against the isolated fixture. AI completion is
// controlled here to verify asynchronous races; no provider or recruiter calls.
const puppeteer = require("puppeteer"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const output = path.resolve("artifacts/communication");
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await puppeteer.launch({
      executablePath: "/usr/bin/google-chrome",
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    }),
    page = await browser.newPage(),
    checks = [],
    errors = [],
    writes = [],
    tasks = [];
  const base =
    "http://127.0.0.1:5194/desktop.html#/main-layout/CareerDashboard?view=replies";
  let fixtureProfileVersion = "",
    allowCompletion = false,
    modelFailure = false,
    newMessage = false,
    failRead = false;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    if (!request.url().endsWith("/atlas-api/rpc")) return request.continue();
    const body = JSON.parse(request.postData() || "{}"),
      send = (data, status = 200) =>
        request.respond({
          status,
          contentType: "application/json",
          body: JSON.stringify(status === 200 ? { data } : { error: data }),
        });
    if (
      /career-reply-(command|resolve|settings-save|pause)$|career-contact-start/.test(
        body.channel,
      )
    )
      writes.push(body.channel);
    if (body.channel === "career-task-create") {
      tasks.push(body.payload);
      return send({ taskId: "ui-draft-" + tasks.length });
    }
    if (body.channel === "career-task-get")
      return send(
        !allowCompletion
          ? { state: "running" }
          : modelFailure
            ? { state: "failed", error: "隔离测试：模型暂不可用" }
            : {
                state: "completed",
                result: {
                  text: "我有企业产品规划与需求分析经验，可以结合业务场景推进平台建设，期待进一步了解团队需求。",
                  reason: "基于测试确认经历",
                  profileVersion: fixtureProfileVersion,
                },
              },
      );
    if (body.channel === "career-boss-conversations" && failRead)
      return send("隔离测试：读取失败", 500);
    if (
      body.channel === "career-boss-conversation" &&
      newMessage &&
      body.payload.bossId === "b"
    ) {
      const response = await fetch(request.url(), {
          method: "POST",
          headers: request.headers(),
          body: request.postData(),
        }),
        payload = await response.json();
      payload.data.messages.push({
        id: "new-incoming",
        type: "text",
        direction: "received",
        text: "补充一下：岗位主要做企业工作流。",
        sentAt: new Date().toISOString(),
      });
      payload.data.total++;
      return send(payload.data);
    }
    return request.continue();
  });
  const click = async (text, scope = "") =>
    page.evaluate(
      (text, scope) => {
        const element = [...document.querySelectorAll(scope + " button")].find(
          (b) =>
            b.textContent.trim() === text &&
            b.getBoundingClientRect().height > 0,
        );
        if (!element) throw Error("Button not found: " + text);
        element.click();
      },
      text,
      scope,
    );
  const open = async (id) => {
    await page.evaluate(
      (id) =>
        [...document.querySelectorAll(".conversation-row")]
          .find((b) => b.textContent.includes("招聘者 " + id))
          .click(),
      id,
    );
    await page.waitForFunction(
      (id) =>
        document
          .querySelector(".conversation-heading")
          ?.textContent.includes("招聘者 " + id) &&
        !document
          .querySelector(".message-toolbar")
          ?.textContent.includes("正在读取"),
      {},
      id,
    );
  };
  const visible = (sel) =>
    page.$eval(sel, (e) => e.getBoundingClientRect().height > 0);
  const waitDraft = () =>
    page.waitForSelector(".draft-composer textarea", { visible: true });
  try {
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(base);
    await page.waitForSelector(".conversation-row");
    fixtureProfileVersion = await page.evaluate(
      async () =>
        (await electron.ipcRenderer.invoke("career-workspace-snapshot"))
          .profileVersion,
    );
    await page.waitForFunction(() =>
      document
        .querySelector(".conversation-heading")
        ?.textContent.includes("招聘者 a"),
    );
    assert.equal(await visible(".reply-policy"), false);
    assert.equal(await visible(".reply-queue"), false);
    assert.equal(
      await page.$eval(".communication-diagnostics", (e) => e.open),
      false,
    );
    checks.push("会话页默认选中优先联系人，诊断收起，设置与发送记录分开");
    await click("处理 2 条待确认 →");
    await page.waitForFunction(
      () =>
        document.querySelector(".reply-queue").getBoundingClientRect().height >
        0,
    );
    assert.equal(
      await page.$eval(".conversation-scope", (e) =>
        e.textContent.includes("所选联系人"),
      ),
      true,
    );
    assert.equal(await page.$$eval(".reply-item", (e) => e.length), 2);
    assert.match(
      await page.$eval(".reply-queue", (e) => e.textContent),
      /对方消息/,
    );
    assert.match(
      await page.$eval(".reply-queue", (e) => e.textContent),
      /处理原因/,
    );
    checks.push(
      "联系人待确认数量准确，点击过滤到该联系人并区分消息、原因与回复",
    );
    await click("确认并排队");
    await page.waitForSelector(".el-message-box", { visible: true });
    assert.match(
      await page.$eval(".el-message-box", (e) => e.textContent),
      /请问面试方式/,
    );
    await page.keyboard.press("Escape");
    assert.equal(writes.length, 0);
    checks.push("确认发送仍有具体内容核对，取消确认不入队、不发送");
    await click("待发送 1", ".queue-tabs").catch(() =>
      page.evaluate(() =>
        [...document.querySelectorAll(".queue-tabs button")]
          .find((b) => b.textContent.includes("待发送"))
          .click(),
      ),
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".reply-item").length === 1,
    );
    await page.screenshot({
      path: path.join(output, "queue-1280.png"),
      fullPage: true,
    });
    await click("查看完整会话 →");
    await page.waitForFunction(
      () =>
        document.querySelector(".boss-inbox").getBoundingClientRect().height >
        0,
    );
    await open("b");
    await click("回复对方 / 跟进", ".draft-modes");
    await click("AI 起草回复");
    await page.waitForFunction(() =>
      document
        .querySelector(".draft-actions")
        ?.textContent.includes("AI 生成中"),
    );
    await open("c");
    allowCompletion = true;
    await new Promise((r) => setTimeout(r, 2400));
    assert.equal(await page.$(".draft-composer textarea"), null);
    await open("b");
    await waitDraft();
    await page.waitForSelector(".atlas-ai-review-dialog", { visible: true });
    assert.match(
      await page.$eval(".atlas-ai-review-dialog", (e) => e.textContent),
      /确认回复与跟进话术/,
    );
    await page.click(".atlas-ai-review-dialog .el-checkbox");
    await click("确认并保存话术");
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".atlas-ai-review-dialog")
          ?.getBoundingClientRect().height,
    );
    checks.push("慢速 AI 结果绑定账号和联系人，切换会话不会串草稿");
    assert.match(
      await page.$eval(".regular-reply .review-actions", (e) => e.textContent),
      /已由本人确认/,
    );
    checks.push("常规回复确认前重读资料与会话，通过后仅保存确认状态");
    await page.$eval(".draft-composer textarea", (e) => {
      e.value = "我的修改草稿，保留产品规划经历。";
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("自动回复设置", ".communication-tabs");
    assert.equal(await visible(".reply-policy"), true);
    await click("会话沟通", ".communication-tabs");
    assert.equal(
      await page.$eval(".draft-composer textarea", (e) => e.value),
      "我的修改草稿，保留产品规划经历。",
    );
    await open("c");
    await open("b");
    assert.equal(
      await page.$eval(".draft-composer textarea", (e) => e.value),
      "我的修改草稿，保留产品规划经历。",
    );
    await page.reload();
    await page.waitForSelector(".conversation-row");
    await open("b");
    await click("回复对方 / 跟进", ".draft-modes");
    await waitDraft();
    assert.equal(
      await page.$eval(".draft-composer textarea", (e) => e.value),
      "我的修改草稿，保留产品规划经历。",
    );
    checks.push("草稿编辑在切换联系人、功能页和刷新后保留");
    allowCompletion = false;
    await click("AI 起草回复");
    await page.waitForFunction(() =>
      document
        .querySelector(".draft-actions")
        ?.textContent.includes("AI 生成中"),
    );
    await page.$eval(".draft-composer textarea", (e) => {
      e.value = "生成期间又修改的内容";
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    allowCompletion = true;
    await page.waitForFunction(() =>
      document
        .querySelector(".draft-feedback")
        ?.textContent.includes("保留你的编辑"),
    );
    assert.equal(
      await page.$eval(".draft-composer textarea", (e) => e.value),
      "生成期间又修改的内容",
    );
    checks.push("AI 返回不能覆盖生成期间的本人编辑");
    modelFailure = true;
    await click("AI 起草回复");
    await page.waitForFunction(() =>
      document
        .querySelector(".draft-feedback")
        ?.textContent.includes("模型暂不可用"),
    );
    assert.equal(
      await page.$eval(".draft-composer textarea", (e) => e.value),
      "生成期间又修改的内容",
    );
    modelFailure = false;
    checks.push("模型失败明确提示并保留原草稿");
    newMessage = true;
    await open("c");
    await open("b");
    await page.waitForFunction(() =>
      document
        .querySelector(".draft-composer")
        ?.textContent.includes("会话已有新消息"),
    );
    checks.push("新消息使原草稿显示上下文过期提示");
    await click("更早", ".message-toolbar");
    await page.waitForFunction(() =>
      document
        .querySelector(".draft-composer")
        ?.textContent.includes("正在查看历史消息"),
    );
    assert.equal(
      await page.$eval(".draft-actions button", (e) => e.disabled),
      true,
    );
    checks.push("阅读历史分页时禁止使用旧消息生成回复");
    await click("更新", ".message-toolbar");
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".message-toolbar")
          ?.textContent.includes("正在读取"),
    );
    await page.select(".inbox-filters select", "waiting");
    await page.waitForFunction(
      () => document.querySelectorAll(".conversation-row").length === 1,
    );
    assert.match(
      await page.$eval(".inbox-list", (e) => e.textContent),
      /映山软件/,
    );
    await page.select(".inbox-filters select", "all");
    await page.waitForFunction(
      () => document.querySelectorAll(".conversation-row").length === 4,
    );
    await page.type(".inbox-filters input", "不存在的企业");
    await page.waitForFunction(() =>
      document
        .querySelector(".inbox-list")
        ?.textContent.includes("没有符合筛选"),
    );
    await click("查看全部", ".inbox-list");
    await page.waitForFunction(
      () => document.querySelectorAll(".conversation-row").length === 4,
    );
    checks.push("状态筛选、搜索空结果与一键恢复正常");
    failRead = true;
    await click("更新本地记录");
    await page.waitForSelector(".boss-inbox>.error-banner");
    assert.equal(await page.$$eval(".conversation-row", (e) => e.length), 4);
    failRead = false;
    await click("更新本地记录");
    await page.waitForFunction(
      () => !document.querySelector(".boss-inbox>.error-banner"),
    );
    checks.push("读取失败保留现有会话并支持重试");
    await page.focus(".conversation-row");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() =>
      document
        .querySelector(".conversation-heading")
        ?.textContent.includes("招聘者 a"),
    );
    checks.push("键盘可以选择联系人");
    for (const [width, height] of [
      [1280, 720],
      [1920, 1080],
    ]) {
      await page.setViewport({ width, height });
      await open("b");
      await page.screenshot({
        path: path.join(output, `inbox-${width}.png`),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.equal(
        await page.$eval(
          ".timeline",
          (e) => getComputedStyle(e).overflowY === "auto",
        ),
        true,
      );
      assert.equal(
        await page.$eval(
          ".inbox-list",
          (e) => getComputedStyle(e).overflowY === "auto",
        ),
        true,
      );
      checks.push(`${width}×${height} 无横向溢出，联系人和消息独立滚动`);
    }
    await click("自动回复设置", ".communication-tabs");
    await page.screenshot({
      path: path.join(output, "settings-1920.png"),
      fullPage: true,
    });
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    assert.equal(tasks[0].payload.accountId, "fixture-account");
    assert.equal(tasks[0].payload.bossId, "b");
    checks.push("全程不写发送策略、不确认发送、不联系真实招聘者");
    fs.writeFileSync(
      path.join(output, "ui-check.json"),
      JSON.stringify({ passed: checks.length, checks, errors }, null, 2),
    );
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
