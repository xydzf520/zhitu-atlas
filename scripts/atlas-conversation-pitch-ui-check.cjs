// Synthetic completions exercise UI races; the fixture never uses real credentials.
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
    calls = [],
    sends = [];
  let complete = false,
    insufficient = false,
    changed = false;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", async (r) => {
    if (!r.url().endsWith("/atlas-api/rpc")) return r.continue();
    const b = JSON.parse(r.postData() || "{}"),
      respond = (data) =>
        r.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data }),
        });
    if (
      /career-reply-command|career-contact-start|career-reply-resolve/.test(
        b.channel,
      )
    )
      sends.push(b.channel);
    if (b.channel === "career-task-create") {
      calls.push(b.payload);
      return respond({ taskId: String(calls.length - 1) });
    }
    if (b.channel === "career-task-get") {
      const c = calls[Number(b.payload.id)],
        text =
          "结合岗位对企业技能平台的需求，负责企业技能平台的需求分析、能力复用与上线。这些经历可以用于梳理业务场景和平台需求，期待进一步了解这个岗位的工作重点。";
      return respond(
        !complete
          ? { state: "running" }
          : {
              state: "completed",
              result: insufficient
                ? { text: "", reason: "证据不足，请补充相关经历" }
                : {
                    text,
                    basis: c.payload.baseBasis,
                    profileVersion: "fixture-v1",
                    job: { jobName: "AI产品负责人" },
                    matches: [
                      {
                        requirement:
                          "负责企业AI平台产品规划、需求分析和能力复用",
                        evidenceTitle: "企业AI平台",
                        evidenceQuote:
                          "负责企业技能平台的需求分析、能力复用与上线。",
                        relevance: "平台建设经历对应需求分析与能力复用。",
                      },
                    ],
                    gaps: ["行业场景仍需进一步沟通"],
                  },
            },
      );
    }
    if (b.channel === "career-conversation-pitch-context" && changed) {
      const response = await fetch(r.url(), {
          method: "POST",
          headers: r.headers(),
          body: r.postData(),
        }),
        v = await response.json();
      v.data.basis = "new-context-version";
      return respond(v.data);
    }
    return r.continue();
  });
  const click = async (text, scope = "") =>
    page.evaluate(
      (text, scope) => {
        const b = [...document.querySelectorAll(scope + " button")].find(
          (e) =>
            e.textContent.trim() === text && e.getBoundingClientRect().height,
        );
        if (!b) throw Error("找不到按钮：" + text);
        b.click();
      },
      text,
      scope,
    );
  const open = async (id) => {
    await page.evaluate(
      (id) =>
        [...document.querySelectorAll(".conversation-row")]
          .find((e) => e.textContent.includes("招聘者 " + id))
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
  const ready = () =>
    page.waitForFunction(
      () => !document.querySelector(".pitch-primary")?.disabled,
    );
  try {
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(
      "http://127.0.0.1:5194/desktop.html#/main-layout/CareerDashboard?view=replies",
    );
    await page.waitForSelector(".conversation-row");
    await open("c");
    await ready();
    assert.equal(
      await page.$eval(
        ".regular-reply .draft-actions button",
        (e) => e.disabled,
      ),
      true,
    );
    assert.equal(calls.length, 0);
    checks.push("无招聘者文本回复时匹配话术仍可生成，打开会话不自动调用模型");
    await click("生成岗位匹配话术");
    await page.waitForFunction(() =>
      document.querySelector(".pitch-primary").textContent.includes("正在匹配"),
    );
    await open("b");
    complete = true;
    await new Promise((r) => setTimeout(r, 2400));
    assert.equal(await page.$(".conversation-pitch textarea"), null);
    await open("c");
    await page.waitForSelector(".atlas-ai-review-dialog", { visible: true });
    await ready();
    assert.equal(calls[0].channel, "career-conversation-pitch");
    assert.equal(calls[0].payload.jobId, "job-c");
    assert.ok(calls[0].payload.baseBasis);
    assert.equal("job" in calls[0].payload, false);
    checks.push("迟到结果不串会话，回到对应联系人后自动弹出确认窗口");
    assert.match(
      await page.$eval(".atlas-ai-review-dialog", (e) => e.textContent),
      /已确认原文/,
    );
    assert.equal(
      await page.$eval(
        ".atlas-ai-review-dialog .el-button--primary",
        (e) => e.disabled,
      ),
      true,
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
        ".conversation-pitch .review-actions",
        (e) => e.textContent,
      ),
      /已由本人确认/,
    );
    checks.push("必须勾选核对后才能确认，确认仅保存草稿不发送");
    changed = true;
    await click("复制话术", ".conversation-pitch");
    await page.waitForSelector(".atlas-ai-review-dialog", { visible: true });
    await page.waitForFunction(() =>
      document
        .querySelector(".review-error")
        ?.textContent.includes("最新消息已变化"),
    );
    assert.match(
      await page.$eval(
        ".conversation-pitch .review-actions",
        (e) => e.textContent,
      ),
      /待本人确认/,
    );
    checks.push("复制前重新核对服务端依据，后台变化使原确认失效并拦截使用");
    changed = false;
    await click("稍后再确认");
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".atlas-ai-review-dialog")
          ?.getBoundingClientRect().height,
    );
    await click("核对并确认话术");

    await page.waitForSelector(".atlas-ai-review-dialog", { visible: true });
    await page.$eval(".atlas-ai-review-dialog textarea", (e) => {
      e.value = "本人编辑后的匹配话术";
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(
      await page.$eval(
        ".atlas-ai-review-dialog .el-button--primary",
        (e) => e.disabled,
      ),
      true,
    );
    await page.click(".atlas-ai-review-dialog .el-checkbox");
    await page.$eval(".atlas-ai-review-dialog textarea", (e) => {
      e.value += "。";
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(
      await page.$eval(
        ".atlas-ai-review-dialog input[type=checkbox]",
        (e) => e.checked,
      ),
      false,
    );
    checks.push("已确认文字被编辑后确认失效，勾选后继续修改也必须再次核对");
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({
      path: "artifacts/conversation-pitch/pitch-dialog-1920.png",
    });
    await page.setViewport({ width: 1280, height: 720 });
    await page.screenshot({
      path: "artifacts/conversation-pitch/pitch-dialog-1280.png",
    });
    await click("稍后再确认");
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".atlas-ai-review-dialog")
          ?.getBoundingClientRect().height,
    );
    await open("b");
    await open("c");
    assert.match(
      await page.$eval(".pitch-preview", (e) => e.textContent),
      /本人编辑后的匹配话术/,
    );
    await page.reload();
    await page.waitForSelector(".conversation-row");
    await open("c");
    await page.waitForSelector(".pitch-preview");
    assert.equal(
      await page.$eval(".pitch-preview", (e) => e.textContent),
      "本人编辑后的匹配话术。",
    );
    checks.push(
      "取消确认保留编辑，切换联系人和刷新后仍保留，确认窗口不反复弹出",
    );
    insufficient = true;
    await ready();
    await click("重新生成岗位匹配话术");
    await page.waitForFunction(() =>
      document.querySelector(".pitch-error")?.textContent.includes("证据不足"),
    );
    assert.equal(
      await page.$eval(".pitch-preview", (e) => e.textContent),
      "本人编辑后的匹配话术。",
    );
    checks.push("证据不足不回退通用模板，保留已有编辑");
    insufficient = false;
    changed = true;
    await click("更新依据", ".conversation-pitch");
    await page.waitForFunction(() =>
      document
        .querySelector(".conversation-pitch")
        ?.textContent.includes("下面是旧话术"),
    );
    checks.push("资料或 JD 版本变更后明确标记旧话术");
    changed = false;
    await open("d");
    await page.waitForFunction(() =>
      document
        .querySelector(".conversation-pitch")
        ?.textContent.includes("尚未关联岗位"),
    );
    assert.equal(await page.$eval(".pitch-primary", (e) => e.disabled), true);
    checks.push("未关联岗位时明确补齐入口，不生成虚构匹配");
    await open("c");
    await ready();
    await page.screenshot({ path: "artifacts/conversation-pitch/ui-1920.png" });
    await page.setViewport({ width: 1280, height: 720 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "artifacts/conversation-pitch/ui-1280.png" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    checks.push("两种屏幕布局可读、无页面横向溢出");
    assert.deepEqual(errors, []);
    assert.deepEqual(sends, []);
    checks.push("生成、编辑和切换均未调用发送接口");
    fs.writeFileSync(
      "artifacts/conversation-pitch/ui-check.json",
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
