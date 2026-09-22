const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  vm = require("node:vm"),
  { buildSync } = require("esbuild");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-review-fixes-")),
  bundle = path.join(root, "api.cjs");
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents:
      [
        "atlas-store",
        "atlas-pipeline",
        "atlas-task-queue",
        "atlas-agents",
        "atlas-policy",
        "atlas-ai",
        "atlas-portfolio",
        "atlas-insights",
        "atlas-discovery-state",
        "atlas-profile",
        "atlas-contact",
        "atlas-greeting",
        "atlas-service",
        "atlas-discovery",
      ]
        .map((x) => `export * from './packages/ui/src/main/features/${x}'`)
        .join("\n") +
      "\nexport * from './packages/ui/src/common/contact';export * from './packages/ui/src/common/regions';export * from './packages/ui/src/common/career'",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});
process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
function fixture(t) {
  const home = fs.mkdtempSync(path.join(root, "f-")),
    m = { exports: {} };
  const dir = path.join(home, ".local/share/zhitu-atlas/config");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "llm.json"),
    JSON.stringify([
      {
        enabled: true,
        model: "deepseek-flash",
        providerApiSecret: "fixture-only",
        providerCompleteApiUrl: "https://api.deepseek.com",
      },
    ]),
  );
  const calls = [];
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
        calls.push(JSON.parse(opts.body));
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    businessGoal: "交付产品",
                    requirements: [
                      {
                        requirement: "产品交付",
                        assessment: "有已确认经历",
                        evidenceIds: ["e"],
                        status: "met",
                        essential: false,
                      },
                    ],
                    strengths: [],
                    gaps: [],
                    questions: [],
                    resumeSuggestions: [],
                    draft: "",
                    recommendation: {
                      decision: "consider",
                      reason: "具备产品经历",
                      nextStep: "了解岗位",
                    },
                  }),
                },
                finish_reason: "stop",
              },
            ],
            usage: { total_tokens: 30 },
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
    state = a.emptyCareerState();
  Object.assign(state.profile, {
    targetRoles: ["产品经理"],
    preferredCities: ["上海"],
    minimumMonthlyK: 40,
    evidence: [
      {
        id: "e",
        title: "产品交付",
        text: "产品需求、管理与交付",
        source: "测试",
        keywords: ["产品"],
        confirmed: true,
      },
    ],
    qualifications: [
      {
        id: "edu",
        kind: "education",
        label: "学历",
        value: "本科 全日制",
        confirmed: true,
        source: "测试",
      },
      {
        id: "exp",
        kind: "experience",
        label: "产品经验",
        value: "10年产品经验",
        confirmed: true,
        source: "测试",
      },
    ],
  });
  a.atlasWrite("career-workspace.json", state);
  a.atlasWrite("career-boss-sync.json", { account: { id: "A" }, items: [] });
  a.initializePolicy();
  t.after(() => a.closeAtlas());
  const job = {
    companyName: "示例企业",
    jobName: "产品经理",
    description: "负责产品规划与需求分析、跨团队产品上线。".repeat(8),
    cityName: "上海",
    address: "上海市徐汇区",
    salaryLow: 40,
    salaryHigh: 50,
  };
  return {
    a,
    state,
    job,
    calls,
    opp: (id, accountId = "A", platform = "boss") => ({
      id,
      platform,
      accountId,
      sourceId: "j-" + id,
      stage: "计划联系",
      job,
      source: platform,
    }),
  };
}
test("degree alternatives and mandatory minima stay distinct from preferences", (t) => {
  const { a, state, job } = fixture(t);
  for (const [requirement, status] of [
    ["本科或硕士学历", "met"],
    ["本科/硕士学历", "met"],
    ["本科及以上，硕士优先", "met"],
    ["本科及以上硕士优先", "met"],
    ["硕士及以上学历", "gap"],
    ["本科及以上；必须硕士学历", "gap"],
  ]) {
    assert.equal(
      a
        .contactBaseMatch(
          { ...job, description: job.description + requirement },
          state.profile,
        )
        .find((c) => c.key === "degree")?.status,
      status,
      requirement,
    );
  }
  state.profile.qualifications[0].confirmed = false;
  assert.equal(
    a
      .contactBaseMatch({ ...job, degreeName: "本科或硕士" }, state.profile)
      .find((c) => c.key === "degree").status,
    "verify",
  );
});
test("independent experience clauses require independent confirmed evidence", (t) => {
  const { a, state, job } = fixture(t),
    j = {
      ...job,
      description: job.description + "3年以上产品经验及2年以上团队管理经验",
    };
  let checks = a
    .contactBaseMatch(j, state.profile)
    .filter((c) => c.key.startsWith("experience"));
  assert.equal(checks.length, 2);
  assert.equal(checks[0].status, "met");
  assert.equal(checks[1].status, "verify");
  assert.match(checks[1].reason, /2年以上团队管理/);
  state.profile.qualifications.push({
    id: "mgr",
    kind: "experience",
    label: "团队管理经验",
    value: "3年",
    confirmed: true,
    source: "本人确认",
  });
  checks = a
    .contactBaseMatch(j, state.profile)
    .filter((c) => c.key.startsWith("experience"));
  assert.ok(checks.every((c) => c.status === "met"));
  assert.deepEqual([...checks[1].evidenceIds], ["mgr"]);
  state.profile.qualifications[2].value = "1年";
  assert.equal(
    a.contactBaseMatch(j, state.profile).find((c) => c.key === "experience-1")
      .status,
    "gap",
  );
});
test("ambiguous alternatives in experience are not silently satisfied by one unrelated tenure", (t) => {
  const { a, state, job } = fixture(t);
  assert.equal(
    a
      .contactBaseMatch(
        { ...job, description: job.description + "3年产品经验或2年AI经验" },
        state.profile,
      )
      .find((c) => c.key === "experience").status,
    "verify",
  );
});
test("city and unique district must agree, shared districts and street names do not invent conflicts", (t) => {
  const { a, state, job } = fixture(t);
  assert.match(
    a.jobLocation({ cityName: "上海", address: "海淀区中关村" }).reason,
    /冲突/,
  );
  assert.equal(
    a
      .contactBaseMatch({ ...job, address: "海淀区中关村" }, state.profile)
      .find((c) => c.key === "city").status,
    "verify",
  );
  for (const address of ["北京路888号", "长宁区北京路", "海淀区路88号"])
    assert.equal(a.jobLocation({ cityName: "上海", address }).city, "上海");
  assert.equal(
    a.jobLocation({ cityName: "北京", address: "朝阳区产业园" }).city,
    "北京",
  );
  assert.equal(a.jobLocation({ address: "朝阳区产业园" }).city, "");
  assert.equal(a.jobLocation({ address: "海淀区中关村" }).city, "北京");
});
test("pipeline account scope protects detail, related, archive, merge, summary and state", (t) => {
  const { a, opp } = fixture(t);
  for (const o of [
    opp("a"),
    opp("b", "B"),
    opp("unknown", ""),
    opp("same"),
    opp("local", "", "manual"),
  ])
    a.indexOpportunity(o);
  assert.deepEqual(
    a.pipelineDetail("a").candidates.map((r) => r.id),
    ["same"],
  );
  assert.throws(() => a.pipelineDetail("b"), /账号/);
  assert.throws(() => a.pipelineDetail("unknown"), /归属/);
  assert.throws(
    () => a.setArchived({ id: "b", baseRevision: 1, archived: true }),
    /账号/,
  );
  assert.throws(
    () =>
      a.saveRelated({
        opportunityId: "b",
        kind: "todo",
        body: { title: "错误" },
      }),
    /账号/,
  );
  assert.throws(
    () =>
      a.mergeOpportunity({
        id: "b",
        targetId: "a",
        baseRevision: 1,
        targetRevision: 1,
      }),
    /账号/,
  );
  assert.throws(
    () =>
      a.mergeOpportunity({
        id: "local",
        targetId: "a",
        baseRevision: 1,
        targetRevision: 1,
      }),
    /平台/,
  );
  a.saveRelated({
    opportunityId: "a",
    kind: "offer",
    body: { title: "A", monthlyK: 40, salaryMonths: 12 },
  });
  a.atlasWrite("career-boss-sync.json", { account: { id: "B" }, items: [] });
  a.saveRelated({ opportunityId: "b", kind: "offer", body: { title: "B" } });
  a.atlasWrite("career-boss-sync.json", { account: { id: "A" }, items: [] });
  assert.equal(a.pipelineSummary().offers.length, 1);
  assert.equal(a.pipelineSummary().offers[0].body.title, "A");
  assert.equal(a.pipelineSummary().stats.total, 3);
  assert.equal(a.pipelineSummary().counts[0].total, 1);
  assert.equal(a.pipelineStates().b, undefined);
  a.mergeOpportunity({
    id: "same",
    targetId: "a",
    baseRevision: 1,
    targetRevision: 1,
  });
  assert.equal(a.pipelineDetail("a").merged.length, 1);
  a.undoMerge({ id: "same", baseRevision: 2 });
  assert.equal(a.pipelineDetail("a").merged.length, 0);
});
test("legacy foreign-account merged records never leak events or contacts", (t) => {
  const { a, opp } = fixture(t);
  a.indexOpportunity(opp("a"));
  a.indexOpportunity(opp("b", "B"));
  const b = { ...opp("b", "B"), mergedInto: "a" };
  a.atlasDb()
    .prepare("UPDATE opportunities SET body=? WHERE id=?")
    .run(JSON.stringify(b), "b");
  a.atlasDb()
    .prepare("INSERT INTO related VALUES(?,?,?,?,1)")
    .run("secret", "b", "todo", JSON.stringify({ title: "B private" }));
  assert.equal(a.pipelineDetail("a").merged.length, 0);
  assert.equal(a.pipelineDetail("a").related.length, 0);
});
test("unrelated prompt and search-word edits do not invalidate queued conversation drafts", (t) => {
  const { a } = fixture(t),
    r = a.createTask({
      channel: "career-conversation-pitch",
      payload: { bossId: "fixture" },
    }),
    c = a.agentConfig("market-review");
  a.saveAgent({
    id: "market-review",
    baseRevision: c.revision,
    prompt: c.prompt + "\n保持简洁。",
    enabled: true,
  });
  assert.equal(a.taskRun(r.taskId).inputOutdated, false);
  const p = a.careerPolicy();
  p.discovery.extensionKeywords = ["平台产品"];
  a.atlasWrite("atlas-career-policy", p);
  assert.equal(a.taskRun(r.taskId).inputOutdated, false);
  assert.equal(
    a.createTask({
      channel: "career-conversation-pitch",
      payload: { bossId: "fixture" },
    }).taskId,
    r.taskId,
  );
  const g = a.agentConfig("greeting-review");
  a.saveAgent({
    id: "greeting-review",
    baseRevision: g.revision,
    prompt: g.prompt + "\n严格核实。",
    enabled: true,
  });
  assert.equal(a.taskRun(r.taskId).inputOutdated, true);
});
test("queued calls still interrupt on relevant prompt edits and execute after unrelated edits", async (t) => {
  const { a } = fixture(t);
  let calls = 0;
  const stop = a.startTaskQueue(async () => {
    calls++;
    return { ok: true };
  });
  t.after(stop);
  const r = a.createTask({ channel: "career-ai-analyze", payload: {} }),
    c = a.agentConfig("market-review");
  a.saveAgent({
    id: "market-review",
    baseRevision: c.revision,
    prompt: c.prompt + "\n简洁。",
    enabled: true,
  });
  await a.taskQueueTick();
  assert.equal(calls, 1);
  assert.equal(a.taskRun(r.taskId).state, "completed");
  const r2 = a.createTask({ channel: "career-ai-analyze", payload: {} }),
    d = a.agentConfig("analysis");
  a.saveAgent({
    id: "analysis",
    baseRevision: d.revision,
    prompt: d.prompt + "\n核实。",
    enabled: true,
  });
  await a.taskQueueTick();
  assert.equal(calls, 1);
  assert.equal(a.taskRun(r2.taskId).state, "interrupted");
});
test("repository verification expiry keeps JD cache while invalidating outbound link basis", async (t) => {
  const { a, state, job, calls } = fixture(t);
  state.profile.evidence[0].project = {
    name: "示例项目",
    url: "https://github.com/example/example",
    scope: "产品规划及交付",
    limitations: "仅项目能力",
  };
  a.atlasWrite("career-workspace.json", state);
  const k =
      "atlas-project-verification/" +
      a.fingerprint(state.profile.evidence[0].project.url),
    verification = {
      url: state.profile.evidence[0].project.url,
      verified: true,
      verifiedAt: new Date().toISOString(),
      license: "MIT",
    };
  a.atlasWrite(k, verification);
  const first = await a.analyzeJob({ job, mode: "discovery" }),
    v = a.currentAnalysisPromptVersion(),
    g = a.currentGreetingPromptVersion();
  assert.equal(first.cached, false);
  a.atlasWrite(k, {
    ...verification,
    verifiedAt: new Date(Date.now() - 25 * 3600000).toISOString(),
  });
  assert.equal(a.currentAnalysisPromptVersion(), v);
  assert.notEqual(a.currentGreetingPromptVersion(), g);
  assert.equal(a.projectEvidence(a.canonicalProfile())[0].url, "");
  const second = await a.analyzeJob({ job, mode: "discovery" });
  assert.equal(second.cached, true);
  assert.equal(calls.length, 1);
  assert.equal(second.projects[0].url, "");
  state.profile.evidence[0].project.scope = "新的项目职责";
  a.atlasWrite("career-workspace.json", state);
  assert.notEqual(a.currentAnalysisPromptVersion(), v);
});
test("manual and file imports count current discovery analyses, stale and other accounts do not", (t) => {
  const { a, state, job } = fixture(t);
  state.opportunities = ["manual", "import"].map((platform, i) => ({
    id: "o" + i,
    platform,
    accountId: "A",
    stage: "待评估",
    job,
    createdAt: new Date().toISOString(),
  }));
  state.opportunities.push({
    id: "foreign",
    platform: "manual",
    accountId: "B",
    job,
    createdAt: new Date().toISOString(),
  });
  a.atlasWrite("career-workspace.json", state);
  const item = {
    analysisBasis: a.contactJobBasis(job),
    analysis: {
      profileVersion: a.profileHistory()[0].id,
      model: a.analysisModel(),
      promptVersion: a.currentAnalysisPromptVersion(),
      analysis: { requirements: [] },
    },
  };
  for (const id of ["o0", "o1", "foreign"])
    a.atlasWrite(a.discoveryItemKey("A", "local:" + id), {
      ...item,
      accountId: "A",
      jobId: "local:" + id,
    });
  let overview = a.insightsOverview();
  assert.equal(overview.stats.total, 2);
  assert.equal(overview.stats.analyzed, 2);
  a.atlasWrite(a.discoveryItemKey("A", "local:o1"), {
    ...item,
    accountId: "A",
    jobId: "local:o1",
    analysis: { ...item.analysis, promptVersion: "old" },
  });
  assert.equal(a.insightsOverview().stats.analyzed, 1);
});
test("opportunity draft service rejects cross-account reads and writes", (t) => {
  const { a, opp } = fixture(t),
    h = new Map();
  a.registerAtlasOperations((n, f) => h.set(n, f));
  a.indexOpportunity(opp("a"));
  a.indexOpportunity(opp("b", "B"));
  assert.ok(h.get("career-opportunity-draft-load")({}, { id: "a" }));
  assert.throws(
    () => h.get("career-opportunity-draft-load")({}, { id: "b" }),
    /账号/,
  );
  assert.throws(
    () =>
      h.get("career-opportunity-draft-save")(
        {},
        { id: "b", text: "错误草稿", basis: "fixture" },
      ),
    /账号/,
  );
  assert.equal(
    a.atlasRead("atlas-opportunity-draft-" + a.fingerprint("b"), null),
    null,
  );
});
test("full-time and unknown alternative qualifications stay conservative", (t) => {
  const { a, state, job } = fixture(t);
  state.profile.qualifications[0].value = "非全日制本科";
  assert.equal(
    a
      .contactBaseMatch(
        { ...job, description: job.description + "全日制本科或硕士学历" },
        state.profile,
      )
      .find((c) => c.key === "degree").status,
    "gap",
  );
  assert.equal(
    a
      .contactBaseMatch(
        { ...job, description: job.description + "本科或同等能力" },
        state.profile,
      )
      .find((c) => c.key === "degree").status,
    "verify",
  );
  const checks = a
    .contactBaseMatch(
      {
        ...job,
        description: job.description + "3年以上产品经验及2年以上管理经验优先",
      },
      state.profile,
    )
    .filter((c) => c.key.startsWith("experience"));
  assert.equal(checks.length, 1);
  assert.equal(checks[0].status, "met");
});
test("reply followup variant depends on followup prompt rather than reply prompt", (t) => {
  const { a } = fixture(t),
    r = a.createTask({
      channel: "career-reply-draft",
      payload: { followup: true },
    }),
    c = a.agentConfig("followup");
  a.saveAgent({
    id: "followup",
    baseRevision: c.revision,
    prompt: c.prompt + "\n核实依据。",
    enabled: true,
  });
  assert.equal(a.taskRun(r.taskId).inputOutdated, true);
});
test("repository re-verification timestamps do not invalidate global report basis", (t) => {
  const { a, state } = fixture(t);
  state.profile.evidence[0].project = {
    name: "项目",
    url: "https://github.com/example/example",
    scope: "产品交付",
    limitations: "需核实业务成果",
  };
  a.atlasWrite("career-workspace.json", state);
  const before = a.insightsOverview().basis,
    k =
      "atlas-project-verification/" +
      a.fingerprint(state.profile.evidence[0].project.url);
  a.atlasWrite(k, {
    url: state.profile.evidence[0].project.url,
    verified: true,
    verifiedAt: new Date().toISOString(),
    license: "MIT",
  });
  assert.equal(a.insightsOverview().basis, before);
});

test("one recruiter linked to multiple jobs remains one company contact", (t) => {
  const { a, opp } = fixture(t);
  for (const id of ["a", "b"]) {
    const o = opp(id);
    o.job = { ...o.job, encryptCompanyId: "company-1" };
    o.bossId = "recruiter-1";
    a.indexOpportunity(o);
  }
  assert.equal(a.pipelineDetail("a").companyOpportunities.length, 2);
  assert.equal(a.pipelineDetail("a").companyContacts.length, 1);
});
