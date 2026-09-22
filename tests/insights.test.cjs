const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  vm = require("node:vm"),
  { buildSync } = require("esbuild"),
  { performance } = require("node:perf_hooks");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-insights-")),
  bundle = path.join(root, "api.cjs");
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents:
      [
        "atlas-insights",
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
      "\nexport * from './packages/ui/src/common/regions';export * from './packages/ui/src/common/insights';export * from './packages/ui/src/common/discovery'",
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
      Date,
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
  return { a, state, call, job, close: () => a.closeAtlas() };
}
test("national location resolution keeps ambiguous and contradictory addresses unverified", () => {
  const f = fixture(),
    a = f.a;
  for (const [address, city, district] of [
    ["北京市海淀区中关村", "北京", "海淀区"],
    ["深圳市南山区科技园", "深圳", "南山区"],
    ["成都市高新区", "成都", ""],
    ["陕西省西安市雁塔区", "西安", "雁塔区"],
    ["乌鲁木齐市天山区", "乌鲁木齐", "天山区"],
    ["上海浦东新区", "上海", "浦东新区"],
  ]) {
    const p = a.jobLocation({ address });
    assert.equal(p.city, city, address);
    if (district) assert.equal(p.district, district);
  }
  assert.equal(a.jobLocation({ address: "朝阳区产业园" }).city, "");
  assert.equal(
    a.jobLocation({ cityName: "上海", address: "北京市海淀区" }).reason,
    "地点信息冲突",
  );
  assert.equal(a.jobLocation({ address: "徐汇区某大厦" }).city, "上海");
  assert.equal(
    a.jobLocation({ address: "北京路888号", cityName: "上海" }).city,
    "上海",
  );
  assert.equal(a.jobLocation({ address: "上海市长宁区北京路" }).city, "上海");
  f.close();
});
test("city search codes and multi-city channels share one plan; missing city does not default to Shanghai", () => {
  const f = fixture(),
    a = f.a;
  assert.equal(
    new URL(a.discoverySearchUrl("产品经理", "北京")).searchParams.get("city"),
    "101010100",
  );
  assert.equal(
    new URL(a.discoverySearchUrl("产品经理", "深圳市")).searchParams.get(
      "city",
    ),
    "101280600",
  );
  assert.equal(
    a.discoverySources(
      ["targeted", "recommended"],
      ["产品"],
      ["北京", "上海", "北京市"],
    ).length,
    4,
  );
  assert.throws(() => a.discoverySources(["targeted"], ["产品"], []), /城市/);
  assert.throws(() => a.bossCityCode("不存在"), /识别/);
  assert.ok(a.validCoordinates(116.4, 39.9));
  assert.ok(a.validCoordinates(87.6, 43.8));
  assert.ok(!a.validCoordinates(181, 40));
  assert.ok(!a.validCoordinates(null, 40));
  f.close();
});
test("sample windows, account separation and salary unknowns are exact", () => {
  const f = fixture();
  f.job("sh");
  f.job("bj", {
    address: "北京市海淀区",
    cityName: "北京",
    salaryLow: 40,
    salaryHigh: 60,
  });
  f.job("unknown", {
    address: "",
    cityName: "",
    salaryLow: null,
    salaryHigh: null,
  });
  f.job("old", {}, "a", new Date(Date.now() - 40 * 86400000).toISOString());
  f.job("undated", {}, "a", "");
  f.job("foreign", {}, "other");
  const r = f.a.insightsOverview();
  assert.equal(r.stats.total, 3);
  assert.equal(r.stats.allStored, 5);
  assert.equal(r.stats.undated, 1);
  assert.equal(r.stats.salaryMedian, 45);
  assert.equal(r.stats.salaryUnknown, 1);
  assert.equal(r.stats.cities.length, 3);
  assert.equal(r.stats.analyzed, 0);
  assert.equal(f.a.insightsOverview({ days: 90 }).stats.total, 4);
  assert.equal(f.a.insightsOverview({ days: 0 }).stats.total, 5);
  assert.throws(() => f.a.insightsOverview({ days: 7 }), /30天/);
  f.close();
});
test("imports deduplicate by reliable source id and latest evidence is sampled first", () => {
  const f = fixture();
  f.job("j");
  const s = f.a.atlasRead("career-workspace.json");
  s.opportunities = [
    {
      id: "dup",
      platform: "boss",
      sourceId: "j",
      job: { description: "other" },
    },
    {
      id: "manual",
      job: {
        jobName: "导入岗位",
        companyName: "公司",
        description: text,
        address: "深圳市南山区",
      },
      createdAt: new Date(Date.now() + 1000).toISOString(),
    },
    { id: "manual", job: { jobName: "重复" } },
    { id: "foreign", accountId: "other", job: {} },
    { id: "unknown", platform: "boss", job: { jobName: "账号待归属" } },
  ];
  f.a.atlasWrite("career-workspace.json", s);
  const r = f.a.insightsOverview();
  assert.equal(r.stats.total, 2);
  assert.equal(r.stats.unassigned, 2);
  assert.match(r.sources.find((s) => s.kind === "job").label, /导入岗位/);
  assert.ok(r.sources.every((s) => s.text === undefined));
  f.close();
});
test("only current job analyses with confirmed evidence contribute to the matrix", () => {
  const f = fixture(),
    a = f.a,
    j = f.job();
  const report = {
    profileVersion: a.profileHistory()[0].id,
    model: a.analysisModel(),
    promptVersion: a.currentAnalysisPromptVersion(),
    analysis: {
      requirements: [
        { requirement: "产品规划", status: "met", evidenceIds: ["e1"] },
        { requirement: "产品规划", status: "met", evidenceIds: ["e1"] },
        { requirement: "行业背景", status: "met", evidenceIds: ["invented"] },
      ],
    },
  };
  const key = a.discoveryItemKey("a", "j");
  a.atlasWrite(key, {
    accountId: "a",
    jobId: "j",
    analysis: report,
    analysisBasis: a.contactJobBasis(j),
  });
  const r = a.insightsOverview();
  assert.equal(r.stats.analyzed, 1);
  assert.equal(r.stats.requirements.find((r) => r.name === "产品规划").met, 1);
  assert.equal(
    r.stats.requirements.find((r) => r.name === "行业背景").verify,
    1,
  );
  a.atlasWrite(key, {
    accountId: "a",
    jobId: "j",
    analysis: { ...report, profileVersion: "old" },
    analysisBasis: a.contactJobBasis(j),
  });
  assert.equal(a.insightsOverview().stats.analyzed, 0);
  f.close();
});
test("global agents use editable prompts and cache unchanged input without another model call", async () => {
  const f = fixture(),
    a = f.a;
  f.job();
  let agent = a.agentConfig("resume-review");
  a.saveAgent({
    id: "resume-review",
    baseRevision: agent.revision,
    enabled: true,
    prompt: agent.prompt + "\n优先说明跨团队交付。",
  });
  const r = await a.analyzeInsights("resume-review");
  assert.equal(r.findings[0].kind, "strength");
  assert.equal(f.state.calls.length, 1);
  assert.match(f.state.calls[0].messages[0].content, /跨团队交付/);
  assert.equal((await a.analyzeInsights("resume-review")).cached, true);
  assert.equal(f.state.calls.length, 1);
  assert.equal(a.insightsOverview().reports["resume-review"].stale, false);
  assert.equal(a.agentCalls().items[0].agentId, "resume-review");
  f.close();
});
test("invalid evidence or structure cannot replace a saved report", async () => {
  const f = fixture(),
    a = f.a;
  f.job();
  await a.analyzeInsights("resume-review");
  const before = a.insightsOverview().reports["resume-review"];
  f.state.answer.findings[0].sourceIds = ["invented"];
  await assert.rejects(
    a.analyzeInsights("resume-review", { refresh: true }),
    /引用|来源/,
  );
  assert.equal(
    a.insightsOverview().reports["resume-review"].createdAt,
    before.createdAt,
  );
  f.close();
});
test("strengths need confirmed evidence and market opportunity needs a job reference", () => {
  const f = fixture(),
    a = f.a;
  const s = a.insightsOverview().sources;
  assert.throws(
    () =>
      a.validateInsightReport(
        {
          ...f.state.answer,
          findings: [{ ...f.state.answer.findings[0], sourceIds: ["profile"] }],
        },
        s,
      ),
    /确认/,
  );
  assert.throws(
    () =>
      a.validateInsightReport(
        {
          ...f.state.answer,
          findings: [
            {
              ...f.state.answer.findings[0],
              kind: "opportunity",
              sourceIds: ["sample"],
            },
          ],
        },
        s,
      ),
    /岗位来源/,
  );
  assert.throws(
    () =>
      a.validateInsightReport({ ...f.state.answer, summary: "录用概率95%" }, s),
    /概率/,
  );
  assert.doesNotThrow(() =>
    a.validateInsightReport(
      { ...f.state.answer, limitations: ["不能估算录用概率。"] },
      s,
    ),
  );
  f.close();
});
test("account or job change during generation preserves old report and cache becomes stale", async () => {
  const f = fixture(),
    a = f.a;
  f.job();
  await a.analyzeInsights("resume-review");
  f.job("new");
  assert.equal(a.insightsOverview().reports["resume-review"].stale, true);
  f.state.run = async () => {
    f.job("during");
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
  await assert.rejects(a.analyzeInsights("resume-review"), /发生变化/);
  assert.equal(a.insightsOverview().reports["resume-review"].stale, true);
  a.saveBossSnapshot({ account: { id: "other" }, items: [] });
  assert.equal(a.insightsOverview().reports["resume-review"], null);
  f.close();
});
test("stale input is rejected before payment; disabled agents cannot generate", async () => {
  const f = fixture(),
    a = f.a;
  f.job();
  await assert.rejects(
    a.analyzeInsights("resume-review", { baseBasis: "old" }),
    /刷新/,
  );
  assert.equal(f.state.calls.length, 0);
  const c = a.agentConfig("resume-review");
  a.saveAgent({
    id: c.id,
    baseRevision: c.revision,
    prompt: c.prompt,
    enabled: false,
  });
  await assert.rejects(a.analyzeInsights("resume-review"), /停用/);
  assert.equal(f.state.calls.length, 0);
  f.close();
});
test("task identity is shared across windows, scoped by sample window, and cancellation does not send", () => {
  const f = fixture(),
    a = f.a;
  f.job();
  const input = {
      channel: "career-market-review",
      payload: { days: 30, baseBasis: a.insightsOverview().basis },
    },
    first = a.createTask(input),
    second = a.createTask(input);
  assert.equal(first.taskId, second.taskId);
  assert.equal(a.insightsOverview().tasks.length, 1);
  assert.equal(a.insightsOverview({ days: 90 }).tasks.length, 0);
  a.cancelTask(first.taskId);
  assert.equal(a.insightsOverview().tasks.length, 0);
  assert.equal(f.state.calls.length, 0);
  f.close();
});
test("market generation uses sampled JD and scoped counters without modifying direction or send authorization", async () => {
  const f = fixture(),
    a = f.a;
  f.job();
  const source = a.insightsOverview().sources.find((s) => s.kind === "job");
  f.state.answer.findings = [
    {
      title: "平台方向",
      detail: "样本包含平台产品职责。",
      kind: "opportunity",
      sourceIds: [source.id],
    },
  ];
  const before = JSON.stringify(a.careerPolicy());
  await a.analyzeInsights("market-review");
  const body = f.state.calls[0].messages.map((m) => m.content).join(" ");
  assert.match(body, /不是全国招聘市场/);
  assert.match(body, /产品规划/);
  assert.equal(JSON.stringify(a.careerPolicy()), before);
  f.close();
});
test("overview aggregates 5,000 jobs and limits AI sources to 60", () => {
  const f = fixture(),
    a = f.a;
  a.atlasTransaction(() => {
    for (let i = 0; i < 5000; i++)
      f.job("p" + i, {
        address: i % 2 ? "北京市海淀区" : "上海市徐汇区",
        cityName: i % 2 ? "北京" : "上海",
      });
  });
  const durations = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now(),
      r = a.insightsOverview();
    durations.push(performance.now() - start);
    assert.equal(r.stats.total, 5000);
    assert.equal(r.aiSampleCount, 60);
    assert.equal(r.sources.filter((s) => s.kind === "job").length, 60);
  }
  const p95 = durations.sort((a, b) => a - b)[4];
  console.log("insights 5000 sample max ms:", Math.round(p95));
  assert.ok(p95 < 1000, `aggregate too slow: ${p95}ms`);
  f.close();
});
test("empty installation gives actionable gaps and does not call the model", async () => {
  const f = fixture(),
    a = f.a,
    s = f.call("career-workspace-snapshot");
  s.state.profile.summary = "";
  s.state.profile.resumeText = "";
  s.state.profile.evidence = [];
  f.call("career-workspace-save", {
    state: JSON.stringify(s.state),
    baseRevision: s.revision,
  });
  assert.equal(a.insightsOverview().stats.salaryMedian, null);
  assert.ok(a.insightsOverview().actions.some((v) => v.id === "search"));
  await assert.rejects(a.analyzeInsights("resume-review"), /填写/);
  await assert.rejects(a.analyzeInsights("market-review"), /收集/);
  assert.equal(f.state.calls.length, 0);
  f.close();
});
test("cancelled generation retains previous result and releases the analysis lease", async () => {
  const f = fixture(),
    a = f.a;
  f.job();
  const r = await a.analyzeInsights("resume-review");
  f.state.run = (opts) =>
    new Promise((resolve, reject) => {
      opts.signal.addEventListener("abort", () => reject(Error("cancelled")), {
        once: true,
      });
    });
  const c = new AbortController(),
    request = a.analyzeInsights("resume-review", {
      refresh: true,
      signal: c.signal,
    });
  setTimeout(() => c.abort(), 10);
  await assert.rejects(request);
  assert.equal(
    a.insightsOverview().reports["resume-review"].createdAt,
    r.createdAt,
  );
  f.state.run = null;
  assert.equal((await a.analyzeInsights("resume-review")).cached, true);
  f.close();
});
test("tool evidence IDs normalize only to an exact source; hallucinated IDs still fail", () => {
  const f = fixture(),
    a = f.a;
  const answer = JSON.parse(JSON.stringify(f.state.answer));
  answer.findings[0].sourceIds = ["e1"];
  const report = a.validateInsightReport(answer, a.insightsOverview().sources);
  assert.equal(report.findings[0].sourceIds[0], "evidence:e1");
  assert.equal(answer.findings[0].sourceIds[0], "e1");
  answer.findings[0].sourceIds = ["平台经历"];
  assert.throws(
    () => a.validateInsightReport(answer, a.insightsOverview().sources),
    /引用/,
  );
  f.close();
});
test("global resume agent tool roundtrip uses the same canonical evidence IDs as the report", async () => {
  const f = fixture({ tools: true });
  f.job();
  f.state.run = async (opts) => {
    if (f.state.calls.length === 1)
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "read-1",
                    type: "function",
                    function: {
                      name: "atlas_read_confirmed_evidence",
                      arguments: JSON.stringify({ ids: ["evidence:e1"] }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { total_tokens: 20 },
        }),
      };
    const messages = JSON.parse(opts.body).messages;
    const tool = JSON.parse(messages.find((m) => m.role === "tool").content);
    assert.equal(tool.evidence[0].id, "evidence:e1");
    assert.ok(tool.evidence[0].text);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { content: JSON.stringify(f.state.answer) },
            finish_reason: "stop",
          },
        ],
        usage: { total_tokens: 20 },
      }),
    };
  };
  const r = await f.a.analyzeInsights("resume-review");
  assert.equal(r.usage.toolCalls, 1);
  assert.equal(r.findings[0].sourceIds[0], "evidence:e1");
  assert.equal(f.state.calls.length, 2);
  f.close();
});

test("market references resolve exact platform IDs without accepting other accounts or ambiguous IDs", async () => {
  const f = fixture(),
    a = f.a;
  f.job("platform-job");
  f.job("other-job", {}, "other-account");
  const sources = a.insightsOverview().sources,
    job = sources.find((s) => s.kind === "job");
  f.state.answer.findings[0] = {
    title: "平台产品机会",
    detail: "岗位需要平台交付经验，可核对相关经历。",
    kind: "opportunity",
    sourceIds: ["job:platform-job"],
  };
  const report = await a.analyzeInsights("market-review");
  assert.equal(report.findings[0].sourceIds[0], job.id);
  const input = JSON.parse(
    f.state.calls[0].messages.find((m) => m.role === "user").content,
  );
  assert.ok(
    input.sources
      .filter((s) => s.kind === "job")
      .every((s) => s.jobId === undefined),
  );
  assert.equal(input.sources.find((s) => s.kind === "job").id, job.id);
  f.state.answer.findings[0].sourceIds = ["job:other-job"];
  assert.throws(() => a.validateInsightReport(f.state.answer, sources), /引用/);
  f.state.answer.findings[0].sourceIds = ["job:platform-job"];
  assert.throws(
    () =>
      a.validateInsightReport(f.state.answer, [
        ...sources,
        { ...job, id: "job:another-canonical" },
      ]),
    /引用/,
  );
  f.close();
});
