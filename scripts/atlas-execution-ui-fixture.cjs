// Isolated UI fixture. Synthetic records only; no credentials, browser worker or external requests.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { buildSync } = require("esbuild");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-execution-ui-"));
process.env.ATLAS_DATA_ROOT = path.join(root, "data");
const bundle = path.join(root, "api.cjs");
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents:
      [
        "atlas-server",
        "atlas-store",
        "atlas-policy",
        "atlas-task-queue",
        "atlas-task-records",
        "atlas-execution",
        "atlas-agents",
        "career-reply-store",
        "atlas-tasks",
      ]
        .map((n) => `export * from './packages/ui/src/main/features/${n}'`)
        .join("\n") + "\nexport * from './packages/ui/src/common/career'",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});
const a = require(bundle),
  at = new Date().toISOString(),
  account = "fixture",
  db = a.atlasDb();
const state = a.emptyCareerState();
state.profile.name = "隔离界面验证";
state.profile.resumeText = "企业产品规划与交付。";
state.profile.evidence = [
  {
    id: "e1",
    title: "企业平台交付",
    text: "负责企业平台规划、业务分析和上线交付。",
    confirmed: true,
    source: "合成样例",
    keywords: ["产品"],
  },
];
a.atlasWrite("career-workspace.json", state);
a.atlasWrite("career-boss-sync.json", {
  account: { id: account, name: "隔离测试" },
});
a.initializePolicy();
a.setAllAutomationPaused(true);
const job = {
  encryptJobId: "job-ui",
  encryptBossId: "boss-ui",
  companyName: "青禾科技（样例）",
  jobName: "企业 AI 产品负责人",
  salaryLow: 40,
  salaryHigh: 60,
  cityName: "上海",
  address: "上海市",
  description: "负责企业 AI 应用规划和业务需求转化，推进产品上线。".repeat(8),
};
db.prepare("INSERT INTO platform_jobs VALUES('boss',?,?,?,?,?)").run(
  account,
  "job-ui",
  JSON.stringify(job),
  at,
  at,
);
db.prepare("INSERT INTO platform_conversations VALUES('boss',?,?,?,?,?)").run(
  account,
  "boss-ui",
  JSON.stringify({
    bossId: "boss-ui",
    bossName: "招聘者",
    companyName: job.companyName,
    jobName: job.jobName,
    jobId: "job-ui",
  }),
  at,
  at,
);
const parent = a.createTask({
  channel: "career-coordinator-plan",
  payload: { automatic: true },
});
db.prepare(
  "UPDATE task_runs SET state='completed',step='安排已完成',result=? WHERE id=?",
).run(
  JSON.stringify({ summary: "优先核对企业岗位，再准备联系。" }),
  parent.taskId,
);
a.executionTaskChanged({
  id: parent.taskId,
  kind: "career-coordinator-plan",
  accountId: account,
  state: "completed",
  step: "安排已完成，关联任务仍在处理",
});
const child = a.createTask({
  channel: "career-greeting-generate",
  payload: { job, automatic: true },
});
a.parentExecution(child.taskId, parent.taskId, "fixture-action");
db.prepare(
  "UPDATE task_runs SET state='running',step='正在审校' WHERE id=?",
).run(child.taskId);
a.executionTaskChanged({
  id: child.taskId,
  kind: "career-greeting-generate",
  accountId: account,
  state: "running",
  step: "正在审校匹配说明",
});
a.withExecutionTask(child.taskId, () => {
  const m = a.beginModelExecution("fixture-write", account, "greeting", {
    model: "隔离模型",
    version: 1,
    profileVersion: db
      .prepare("SELECT id FROM profile_versions ORDER BY version DESC LIMIT 1")
      .get().id,
    promptId: "fixture",
  });
  a.finishModelExecution(m, "completed", "已返回候选话术", {
    text: "您好，看到岗位需要企业 AI 应用规划经验。我曾负责企业平台的规划、业务分析和上线交付，这段经历与岗位要求相关。",
    evidenceIds: ["e1"],
    validated: false,
  });
  a.executionRule("事实检查", "completed", "经历引用有效", {
    evidenceIds: ["e1"],
    validated: true,
  });
  const review = a.beginModelExecution(
    "fixture-review",
    account,
    "greeting-review",
    { model: "隔离模型", version: 1 },
  );
  a.updateExecutionStep(review.stepId, "running", "正在核对相关性与候选人视角");
});
const e = {
  id: "b".repeat(64),
  userId: account,
  bossId: "boss-ui",
  company: job.companyName,
  person: "招聘者",
  incoming: "方便发一份简历吗？",
  messageId: "incoming-ui",
  receivedAt: Date.now(),
  createdAt: at,
  draft: "",
  reason: "简历附件需要本人确认",
  category: "简历发送",
  status: "review",
};
a.saveReplyEvent(e);
const complete = a.createTask({
  channel: "career-reply-draft",
  payload: {
    accountId: account,
    bossId: "boss-ui",
    incoming: "你在上海吗？",
    messageId: "m2",
    automatic: true,
  },
});
db.prepare("UPDATE task_runs SET state='completed',result=? WHERE id=?").run(
  JSON.stringify({
    text: "是的，我目前在上海。",
    reason: "直接回答地点问题",
    evidenceIds: [],
    profileVersion: db
      .prepare("SELECT id FROM profile_versions ORDER BY version DESC LIMIT 1")
      .get().id,
  }),
  complete.taskId,
);
a.executionTaskChanged({
  id: complete.taskId,
  kind: "career-reply-draft",
  accountId: account,
  state: "completed",
  step: "回复已生成，未发送",
});
// Maintain the synthetic waiting state only in this fixture, for responsive UI checks.
const heartbeat = setInterval(() => {
  db.prepare(
    "UPDATE task_runs SET heartbeat_at=? WHERE id=? AND state='running'",
  ).run(new Date().toISOString(), child.taskId);
  db.prepare(
    "UPDATE execution_steps SET heartbeat_at=? WHERE id='model:fixture-review' AND state='running'",
  ).run(new Date().toISOString());
}, 10000);
heartbeat.unref();
a.startAtlasServer(
  path.resolve("packages/ui/web-dist"),
  Number(process.argv[2]) || 5196,
).then((server) => {
  console.log(
    JSON.stringify({
      port: server.address().port,
      running: a.executionLink("task", child.taskId).run_id,
      completed: a.executionLink("task", complete.taskId).run_id,
    }),
  );
  process.on("SIGTERM", () =>
    server.close(() => {
      a.closeAtlas();
      fs.rmSync(root, { recursive: true, force: true });
      process.exit(0);
    }),
  );
});
