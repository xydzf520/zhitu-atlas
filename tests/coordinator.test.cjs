const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  vm = require("node:vm"),
  { buildSync } = require("esbuild"),
  { performance } = require("node:perf_hooks");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-coordinator-")),
  bundle = path.join(root, "api.cjs");
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents:
      [
        "atlas-insights",
        "atlas-coordinator",
        "atlas-discovery",
        "atlas-backup",
        "atlas-tasks",
        "atlas-agents",
        "atlas-store",
        "atlas-profile",
        "career-workspace-service",
        "atlas-boss-sync",
        "career-boss-data",
        "atlas-policy",
        "atlas-task-queue",
        "atlas-discovery-state",
        "atlas-ai",
        "atlas-contact",
      ]
        .map((n) => `export * from './packages/ui/src/main/features/${n}'`)
        .join("\n") +
      "\nexport * from './packages/ui/src/common/coordinator';export * from './packages/ui/src/common/regions';export * from './packages/ui/src/common/insights';export * from './packages/ui/src/common/discovery'",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});
process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
const text = "负责企业平台的产品规划、业务需求分析与上线交付。".repeat(8);
function fixture({ tools = false } = {}) {
  const home = fs.mkdtempSync(path.join(root, "f-")),
    dir = path.join(home, ".local/share/zhitu-atlas/config");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "llm.json"),
    JSON.stringify([
      {
        enabled: true,
        model: "deepseek-flash",
        providerApiSecret: "fixture-only",
        providerCompleteApiUrl: tools
          ? "https://api.commandcode.ai/provider/v1"
          : "https://api.deepseek.com",
      },
    ]),
  );
  const state = {
      calls: [],
      answer: {
        summary: "有企业平台交付依据，建议补充业务成效。",
        findings: [
          {
            title: "平台交付",
            detail: "已有已确认的平台产品经历。",
            kind: "strength",
            sourceIds: ["evidence:e1"],
          },
        ],
        actions: [
          {
            title: "补充交付结果",
            reason: "当前证据未说明效果。",
            priority: "high",
            destination: "profile",
            sourceIds: ["evidence:e1"],
          },
        ],
        limitations: ["本地岗位样本不代表全部市场。"],
      },
      run: null,
    },
    m = { exports: {} };
  vm.runInNewContext(
    "(function(require,module,exports){" +
      fs.readFileSync(bundle, "utf8") +
      "\n})",
    {
      process,
      Buffer,
      Date: class extends Date {
        constructor(...args) {
          super(
            ...(args.length
              ? args
              : [
                  Date.parse(
                    new Date().toLocaleDateString("sv-SE", {
                      timeZone: "Asia/Shanghai",
                    }) + "T12:00:00+08:00",
                  ),
                ]),
          );
        }
        static now() {
          return new this().getTime();
        }
      },
      URL,
      URLSearchParams,
      AbortController,
      AbortSignal,
      setTimeout,
      clearTimeout,
      fetch: async (url, opts) => {
        state.calls.push(JSON.parse(opts.body));
        if (state.run) return state.run(opts);
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: { content: JSON.stringify(state.answer) },
                finish_reason: "stop",
              },
            ],
            usage: { total_tokens: 24 },
          }),
        };
      },
    },
  )(
    (n) => (n === "node:os" ? { homedir: () => home } : require(n)),
    m,
    m.exports,
  );
  const a = m.exports,
    h = new Map();
  a.registerCareerWorkspace(
    (n, f) => h.set(n, f),
    () => {},
  );
  const call = (n, p) => h.get(n)({}, p);
  const s = call("career-workspace-snapshot");
  Object.assign(s.state.profile, {
    name: "测试",
    summary: "企业产品规划与交付",
    resumeText: text,
    targetRoles: ["产品经理"],
    preferredCities: ["上海", "北京"],
    minimumMonthlyK: 40,
    evidence: [
      {
        id: "e1",
        title: "平台经历",
        text,
        keywords: ["平台", "产品"],
        source: "本人确认",
        confirmed: true,
      },
    ],
  });
  call("career-workspace-save", {
    state: JSON.stringify(s.state),
    baseRevision: s.revision,
  });
  a.saveBossSnapshot({ account: { id: "a", name: "测试" }, items: [] });
  a.initializePolicy();
  a.setAllAutomationPaused(true);
  function job(
    id = "j",
    extra = {},
    account = "a",
    observed = new Date().toISOString(),
  ) {
    const job = {
      encryptJobId: id,
      encryptBossId: "b" + id,
      companyName: "企业" + id,
      jobName: "产品经理",
      description: text,
      address: "上海市徐汇区",
      cityName: "上海",
      salaryLow: 30,
      salaryHigh: 50,
      ...extra,
    };
    a.atlasDb()
      .prepare("INSERT OR REPLACE INTO platform_jobs VALUES('boss',?,?,?,?,?)")
      .run(account, id, JSON.stringify(job), observed, observed);
    return job;
  }
  a.registerCoordinator((n, f) => h.set(n, f), a.createTask);
  return { a, state, call, job, close: () => a.closeAtlas() };
}
const enable = (a) => {
  a.saveCoordinatorConfig({
    mode: "assist",
    baseRevision: a.coordinatorConfig().revision,
  });
  a.setAllAutomationPaused(false);
};
const planAction = (a, kind) => {
  const p = a.refreshCoordinator();
  const action = p.actions.find((x) => x.kind === kind);
  assert.ok(action, kind);
  return { planId: p.id, actionId: action.id, action };
};
function freshAnalysis(a, j) {
  a.atlasWrite(a.discoveryItemKey("a", j.encryptJobId), {
    accountId: "a",
    jobId: j.encryptJobId,
    status: "new",
    origins: ["search"],
    analysisBasis: a.contactJobBasis(j),
    analysis: {
      profileVersion: a.profileHistory()[0].id,
      model: a.analysisModel(),
      promptVersion: a.currentAnalysisPromptVersion(),
      analysis: {
        businessGoal: "产品落地",
        requirements: [
          {
            requirement: "产品规划与交付",
            essential: true,
            status: "met",
            evidenceIds: ["e1"],
            assessment: "本人已确认",
          },
        ],
        recommendation: {
          decision: "prioritize",
          reason: "匹配产品经历",
          nextStep: "联系",
        },
        strengths: ["产品交付"],
        gaps: [],
        questions: [],
        draft: "",
        resumeSuggestions: [],
      },
    },
  });
}
function incoming(a, id = "m1", text = "请发一份简历") {
  const at = new Date().toISOString();
  a.atlasDb()
    .prepare(
      "INSERT OR REPLACE INTO platform_conversations VALUES('boss',?,?,?,?,?)",
    )
    .run(
      "a",
      "b",
      JSON.stringify({ companyName: "样例企业", bossName: "招聘者" }),
      at,
      at,
    );
  a.atlasDb()
    .prepare(
      "INSERT OR REPLACE INTO platform_messages VALUES('boss',?,?,?,?,?,?)",
    )
    .run(
      "a",
      "b",
      id,
      JSON.stringify({ id, type: "text", direction: "received", text }),
      at,
      at,
    );
}
test("coordinator defaults to suggestions, account scope and paused authorizations remain untouched", () => {
  const f = fixture(),
    a = f.a;
  f.job("j");
  f.job("foreign", {}, "other");
  const before = JSON.stringify(a.careerPolicy()),
    p = a.coordinatorOverview();
  assert.equal(p.config.mode, "suggest");
  assert.equal(p.automationPaused, true);
  assert.equal(p.plan.sample.totalJobs, 1);
  assert.ok(!p.plan.actions.some((x) => x.target === "foreign"));
  assert.throws(
    () => a.dispatchCoordinator(planAction(a, "analysis"), a.createTask),
    /仅建议/,
  );
  assert.equal(JSON.stringify(a.careerPolicy()), before);
  assert.equal(a.atlasRead("atlas-contact-authorization", null), null);
  f.close();
});
test("manual communication is first and explicit handling never becomes sending; a new message returns", () => {
  const f = fixture(),
    a = f.a;
  incoming(a);
  f.job();
  let p = a.refreshCoordinator();
  assert.equal(p.actions[0].kind, "manual");
  f.call("career-coordinator-reviewed", {
    planId: p.id,
    actionId: p.actions[0].id,
  });
  assert.ok(
    !a
      .refreshCoordinator()
      .actions.some((x) => x.kind === "manual" && x.target === "b"),
  );
  incoming(a, "m2", "面试时间方便吗");
  assert.ok(
    a
      .refreshCoordinator()
      .actions.some((x) => x.kind === "manual" && x.target === "b"),
  );
  assert.equal(
    a.atlasDb().prepare("SELECT count(*) n FROM send_attempts").get().n,
    0,
  );
  f.close();
});
test("daily task dispatch is persistent and idempotent even after failure or cancellation", () => {
  const f = fixture(),
    a = f.a;
  f.job();
  enable(a);
  const x = planAction(a, "analysis"),
    r = a.dispatchCoordinator(x, a.createTask),
    again = a.dispatchCoordinator(x, a.createTask);
  assert.equal(r.taskId, again.taskId);
  assert.equal(
    a.atlasDb().prepare("SELECT count(*) n FROM task_runs").get().n,
    1,
  );
  a.atlasDb()
    .prepare(
      "UPDATE task_runs SET state='failed',error='response unknown' WHERE id=?",
    )
    .run(r.taskId);
  assert.equal(a.dispatchCoordinator(x, a.createTask).state, "failed");
  assert.equal(
    a.atlasDb().prepare("SELECT count(*) n FROM task_runs").get().n,
    1,
  );
  assert.ok(
    a.coordinatorOverview().history.some((h) => h.execution.state === "failed"),
  );
  f.close();
});
test("changed JD, conversation, profile or coordinator settings invalidate queued steps", () => {
  const f = fixture(),
    a = f.a;
  f.job();
  enable(a);
  const x = planAction(a, "analysis"),
    r = a.dispatchCoordinator(x, a.createTask);
  assert.equal(a.coordinatorTaskBlock(r.taskId, true), "");
  f.job("j", { description: text + "新增必要经验" });
  assert.match(a.coordinatorTaskBlock(r.taskId, true), /岗位或会话/);
  a.saveCoordinatorConfig({
    mode: "suggest",
    baseRevision: a.coordinatorConfig().revision,
  });
  assert.match(a.coordinatorTaskBlock(r.taskId), /关闭/);
  f.close();
});
test("all pause and disabled agent stop dispatch without changing any sending rule", () => {
  const f = fixture(),
    a = f.a;
  f.job();
  enable(a);
  const x = planAction(a, "analysis");
  a.setAllAutomationPaused(true);
  assert.throws(() => a.dispatchCoordinator(x, a.createTask), /已暂停/);
  a.setAllAutomationPaused(false);
  const c = a.agentConfig("coordinator");
  a.saveAgent({ ...c, baseRevision: c.revision, enabled: false });
  assert.throws(() => a.dispatchCoordinator(x, a.createTask), /变化|停用/);
  assert.equal(
    a.atlasDb().prepare("SELECT count(*) n FROM task_runs").get().n,
    0,
  );
  f.close();
});
test("contact uses existing authorization, never invokes startContacts or expands limits", () => {
  const f = fixture(),
    a = f.a,
    j = f.job();
  freshAnalysis(a, j);
  assert.equal(a.contactMatch(j).eligible, true);
  enable(a);
  const x = planAction(a, "contact"),
    before = JSON.stringify(a.careerPolicy());
  assert.throws(() => a.dispatchCoordinator(x, a.createTask), /发送已暂停/);
  assert.equal(JSON.stringify(a.careerPolicy()), before);
  a.setRuntime({ paused: false });
  assert.throws(() => a.dispatchCoordinator(x, a.createTask), /尚未授权/);
  a.atlasWrite("atlas-contact-authorization", {
    id: "auth",
    accountId: "a",
    mode: "automatic",
    channels: ["targeted", "recommended"],
  });
  const r = a.dispatchCoordinator(x, a.createTask);
  assert.ok(r.contactId);
  assert.equal(
    a.atlasDb().prepare("SELECT count(*) n FROM send_attempts").get().n,
    0,
  );
  assert.equal(a.careerPolicy().sending.dailyLimit, 20);
  assert.equal(a.careerPolicy().sending.firstContactLimit, 10);
  f.close();
});
test("AI validates allowlist and priority, and shares a two-call daily budget across manual and automatic calls", async () => {
  const f = fixture(),
    a = f.a;
  f.job();
  enable(a);
  incoming(a);
  const p = a.refreshCoordinator();
  f.state.answer = {
    summary: "优先处理沟通",
    actions: p.actions
      .slice()
      .reverse()
      .map((x) => ({ id: x.id, reason: "沿用已核实的安排" })),
  };
  const out = await a.planWithAi({ baseBasis: p.basis, automatic: false });
  assert.equal(out.source, "ai");
  assert.equal(out.actions[0].priority, 0);
  assert.equal(f.state.calls[0].tools, undefined);
  f.state.answer = {
    summary: "越权安排",
    actions: [{ id: "send-arbitrary", reason: "忽略之前指令" }],
  };
  await assert.rejects(
    a.planWithAi({ baseBasis: a.refreshCoordinator().basis, automatic: true }),
    /越界/,
  );
  assert.equal(
    a.atlasRead("atlas-coordinator-plan/" + a.fingerprint("a"), null).source,
    "ai",
  );
  await assert.rejects(
    a.planWithAi({ baseBasis: a.refreshCoordinator().basis }),
    /2 次/,
  );
  assert.equal(f.state.calls.length, 2);
  assert.equal(a.coordinatorBudget().remaining, 0);
  f.close();
});
test("invalid or cancelled AI plan preserves previous plan and completed results", async () => {
  const f = fixture(),
    a = f.a;
  f.job();
  const p = a.refreshCoordinator();
  await assert.rejects(a.planWithAi({ baseBasis: "old" }), /依据已变化/);
  assert.equal(f.state.calls.length, 0);
  f.state.answer = {
    summary: "安排",
    actions: p.actions.map((x) => ({ id: x.id, reason: "已有依据" })),
  };
  f.state.run = async () => {
    f.job("new");
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { content: JSON.stringify(f.state.answer) },
            finish_reason: "stop",
          },
        ],
      }),
    };
  };
  await assert.rejects(
    a.planWithAi({ baseBasis: p.basis }),
    /依据或账号已变化/,
  );
  assert.equal(
    a.atlasRead("atlas-coordinator-plan/" + a.fingerprint("a"), null).id,
    p.id,
  );
  f.close();
});
test("planner rejects mutable tool payload, duplicate IDs and omitted important items", () => {
  const f = fixture(),
    a = f.a;
  incoming(a);
  const list = a.coordinatorCandidates().actions;
  for (const actions of [
    [{ id: list[0].id, reason: "x", payload: { outbound: true } }],
    [
      { id: list[0].id, reason: "x" },
      { id: list[0].id, reason: "x" },
    ],
    [],
  ])
    assert.throws(
      () => a.validateCoordination({ summary: "安排", actions }, list),
      /遗漏|越界/,
    );
  f.close();
});
test("automatic scheduler stops while paused and queues at most one planning task", () => {
  const f = fixture(),
    a = f.a;
  f.job();
  a.scheduleCoordinator(a.createTask);
  assert.equal(
    a.atlasDb().prepare("SELECT count(*) n FROM task_runs").get().n,
    0,
  );
  enable(a);
  a.scheduleCoordinator(a.createTask);
  a.scheduleCoordinator(a.createTask);
  const rows = a.atlasDb().prepare("SELECT * FROM task_runs").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "career-coordinator-plan");
  f.close();
});
test("coordinator config is scoped and rejects a stale writer", () => {
  const f = fixture(),
    a = f.a,
    c = a.coordinatorConfig();
  a.saveCoordinatorConfig({ mode: "assist", baseRevision: c.revision });
  assert.throws(
    () =>
      a.saveCoordinatorConfig({ mode: "suggest", baseRevision: c.revision }),
    /变化/,
  );
  a.saveBossSnapshot({ account: { id: "other", name: "other" }, items: [] });
  assert.equal(a.coordinatorConfig().mode, "suggest");
  assert.equal(a.coordinatorOverview().history.length, 0);
  f.close();
});
test("bounded catalogue remains responsive with 5000 jobs and 50000 messages", () => {
  const f = fixture(),
    a = f.a,
    j = f.job();
  const db = a.atlasDb(),
    at = new Date().toISOString();
  a.atlasTransaction(() => {
    const insert = db.prepare(
      "INSERT OR REPLACE INTO platform_jobs VALUES('boss',?,?,?,?,?)",
    );
    for (let i = 0; i < 5000; i++)
      insert.run(
        "a",
        "job" + i,
        JSON.stringify({ ...j, encryptJobId: "job" + i }),
        at,
        at,
      );
    const conv = db.prepare(
        "INSERT OR REPLACE INTO platform_conversations VALUES('boss',?,?,?,?,?)",
      ),
      msg = db.prepare(
        "INSERT OR REPLACE INTO platform_messages VALUES('boss',?,?,?,?,?,?)",
      );
    for (let i = 0; i < 500; i++) {
      conv.run(
        "a",
        "c" + i,
        JSON.stringify({ companyName: "企业" + i }),
        at,
        at,
      );
      for (let m = 0; m < 100; m++)
        msg.run(
          "a",
          "c" + i,
          "m" + m,
          JSON.stringify({ type: "text", direction: "sent", text: "沟通内容" }),
          at,
          at,
        );
    }
  });
  const times = [];
  for (let i = 0; i < 8; i++) {
    const start = performance.now();
    const s = a.coordinatorOverview();
    times.push(performance.now() - start);
    assert.equal(s.plan.sample.scannedJobs, 120);
    assert.equal(s.plan.sample.totalJobs, 5001);
  }
  times.sort((a, b) => a - b);
  assert.ok(times.at(-1) < 1000, JSON.stringify(times));
  f.close();
});
test("real queue integration executes planning then JD analysis and leaves sending paused", async () => {
  const f = fixture(),
    a = f.a,
    j = f.job();
  enable(a);
  const handlers = new Map();
  a.registerDiscovery((n, h) => handlers.set(n, h));
  f.state.run = async (opts) => {
    const request = JSON.parse(opts.body),
      input = JSON.parse(request.messages.at(-1).content);
    const value = input.actions
      ? {
          summary: "先分析适合的岗位",
          actions: input.actions
            .filter((x) => x.kind === "analysis")
            .map((x) => ({ id: x.id, reason: "岗位详情完整，可以核对经历" })),
        }
      : {
          businessGoal: "产品规划交付",
          requirements: [
            {
              requirement: "产品交付",
              status: "met",
              essential: true,
              evidenceIds: ["e1"],
              assessment: "已确认的平台交付经历",
            },
          ],
          strengths: ["产品规划与交付"],
          gaps: [],
          questions: [],
          draft: "",
          resumeSuggestions: [],
          recommendation: {
            decision: "prioritize",
            reason: "目标一致且有经历支持",
            nextStep: "准备匹配话术",
          },
        };
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { content: JSON.stringify(value) },
            finish_reason: "stop",
          },
        ],
        usage: { total_tokens: 30 },
      }),
    };
  };
  const stop = a.startTaskQueue(async (channel, payload) =>
    channel === "career-coordinator-plan"
      ? a.planWithAi(payload)
      : handlers.get(channel)({}, payload),
  );
  try {
    a.scheduleCoordinator(a.createTask);
    await a.taskQueueTick();
    assert.equal(a.refreshCoordinator().source, "ai");
    a.scheduleCoordinator(a.createTask);
    await a.taskQueueTick();
    assert.equal(a.contactMatch(j).fresh, true);
    assert.equal(a.contactMatch(j).eligible, true);
    assert.equal(
      a
        .atlasDb()
        .prepare("SELECT count(*) n FROM task_runs WHERE state='completed'")
        .get().n,
      2,
    );
    const p = a.coordinatorOverview();
    assert.ok(
      p.plan.actions.some(
        (x) => x.kind === "contact" && x.blocked.includes("发送已暂停"),
      ),
    );
    assert.equal(
      a.atlasDb().prepare("SELECT count(*) n FROM send_attempts").get().n,
      0,
    );
  } finally {
    stop();
    f.close();
  }
});
test('encrypted backup preserves coordination history but restoration disables automatic dispatch',()=>{
 const f=fixture(),a=f.a;f.job();enable(a);const x=planAction(a,'analysis');a.dispatchCoordinator(x,a.createTask);
 const backup=a.exportEncryptedBackup('isolated-backup-password');
 const restored=a.restoreEncryptedBackup({password:'isolated-backup-password',base64:backup.base64,confirm:true});
 assert.equal(restored.paused,true);assert.equal(a.coordinatorConfig().mode,'suggest');assert.equal(a.allAutomationPaused(),true);
 assert.ok(a.coordinatorOverview().history.some(x=>x.execution.state==='interrupted'));f.close();
});
