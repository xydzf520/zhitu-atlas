const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  vm = require("node:vm"),
  { buildSync } = require("esbuild");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-discovery-test-")),
  bundle = path.join(root, "api.cjs");
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents:
      [
        "atlas-store",
        "atlas-profile",
        "atlas-discovery",
        "atlas-discovery-state",
        "atlas-boss-sync",
        "career-boss-data",
        "career-workspace-service",
        "atlas-ai",
        "atlas-backup",
      ]
        .map((n) => `export * from './packages/ui/src/main/features/${n}'`)
        .join("\n") + "\nexport * from './packages/ui/src/common/discovery'",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});
process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
const jd =
  "负责企业AI平台产品规划、需求分析与用户体验设计，推动技能复用和产品迭代。主导跨团队的项目交付，结合数据分析制定产品发展方向。任职要求：有AI产品和平台产品管理经验，善于拆解业务需求，具备团队沟通能力。";
const answer = {
  recommendation: {
    decision: "consider",
    reason: "企业平台经历与产品职责相关，待本人核实。",
    nextStep: "确认职责后准备联系。",
  },
  businessGoal: "建设企业AI技能平台",
  requirements: [
    {
      requirement: "AI平台产品",
      assessment: "平台经历待本人确认",
      evidenceIds: ["e1"],
    },
  ],
  strengths: ["平台需求分析经历待本人确认"],
  gaps: ["团队规模待核实"],
  questions: ["平台使用场景是什么"],
  resumeSuggestions: ["补充职责边界"],
  draft: "",
};
function fixture() {
  const home = fs.mkdtempSync(path.join(root, "f-")),
    config = path.join(home, ".local/share/zhitu-atlas/config");
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(
    path.join(config, "llm.json"),
    JSON.stringify([
      {
        enabled: true,
        model: "deepseek-flash",
        providerApiSecret: "fixture-only",
        providerCompleteApiUrl: "https://api.deepseek.com",
      },
    ]),
  );
  const state = { calls: [], error: false, answer };
  const m = { exports: {} };
  vm.runInNewContext(
    "(function(require,module,exports){" +
      fs.readFileSync(bundle, "utf8") +
      "\n})",
    {
      Buffer,
      process,
      Date,
      URL,
      URLSearchParams,
      AbortController,
      AbortSignal,
      setTimeout,
      clearTimeout,
      fetch: async (u, o) => {
        state.calls.push(JSON.parse(o.body));
        assert.equal(o.redirect, "error");
        if (state.error) return { ok: false, status: 429 };
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: { content: JSON.stringify(state.answer) },
                finish_reason: "stop",
              },
            ],
            usage: { total_tokens: 90 },
          }),
        };
      },
    },
  )(
    (k) => (k === "node:os" ? { homedir: () => home } : require(k)),
    m,
    m.exports,
  );
  const a = m.exports,
    h = new Map();
  a.registerCareerWorkspace(
    (k, f) => h.set(k, f),
    () => {},
  );
  a.registerDiscovery((k, f) => h.set(k, f));
  const call = (n, p) => h.get(n)({}, p),
    s = call("career-workspace-snapshot");
  Object.assign(s.state.profile, {
    name: "测试",
    targetRoles: ["AI产品负责人"],
    preferredCities: ["上海"],
    minimumMonthlyK: 40,
    evidence: [
      {
        id: "e1",
        confirmed: false,
        title: "AI平台",
        text: "负责企业AI技能平台需求分析",
        source: "测试",
        keywords: ["AI", "平台"],
      },
    ],
  });
  call("career-workspace-save", {
    state: JSON.stringify(s.state),
    baseRevision: s.revision,
  });
  a.saveBossSnapshot({ account: { id: "u1", name: "测试" }, items: [] });
  return {
    a,
    call,
    home,
    state,
    seed: (id = "j1", extra = {}) =>
      a.ingestBossJobs(
        "u1",
        {
          code: 0,
          zpData: {
            jobList: [
              {
                encryptId: id,
                jobName: "AI产品负责人",
                brandName: "企业" + id,
                postDescription: jd,
                salaryDesc: "40-60K",
                cityName: "上海",
                address: "上海市徐汇区",
                ...extra,
              },
            ],
          },
        },
        "/wapi/zpgeek/search/joblist.json",
      ),
  };
}
test("discovery distinguishes requirements to verify, exclusions and unconfirmed matches", () => {
  const f = fixture();
  f.seed();
  f.seed("low", { salaryDesc: "20-30K" });
  f.seed("remote", { cityName: "杭州", address: "杭州市西湖区" });
  f.seed("missing", { salaryDesc: "面议", postDescription: "" });
  const d = f.a.discoveryList({ filter: "all" });
  assert.equal(d.counts.total, 4);
  assert.equal(d.counts.priority, 0); // Unconfirmed evidence no longer raises initial eligibility.
  assert.equal(d.items.find(r=>r.job.encryptJobId === "j1").assessment.bucket, "possible");
  assert.equal(d.counts.excluded, 2);
  assert.equal(d.counts.verify, 1);
  assert.equal(d.items.find(r=>r.job.encryptJobId === "j1").assessment.provisional, true);
  assert.equal(d.recommendations.length, 0); // Unanalysed jobs must not masquerade as AI recommendations.
  f.a.closeAtlas();
});
test("search deduplicates and account isolation rejects a stale account", () => {
  const f = fixture();
  f.seed();
  f.seed();
  assert.equal(f.a.discoveryList().total, 1);
  f.a.saveBossSnapshot({ account: { id: "u2", name: "其他" }, items: [] });
  assert.equal(f.a.discoveryList().total, 0);
  assert.throws(
    () =>
      f.call("career-discovery-decision", {
        accountId: "u1",
        jobId: "j1",
        status: "following",
      }),
    /账号/,
  );
  f.a.closeAtlas();
});
test("discovery pool does not mark searched jobs as contacted and promotion is idempotent", () => {
  const f = fixture();
  f.seed();
  assert.equal(
    f.a.enrichSyncedRecords({}, f.a.readBossSync()).applications.length,
    0,
  );
  let row = f.a.discoveryList().items[0];
  const result = f.call("career-discovery-decision", {
    accountId: "u1",
    jobId: "j1",
    status: "following",
    baseRevision: row.item.revision,
  });
  assert.equal(result.opportunityId, "boss:u1:job:j1");
  assert.equal(
    f.a.enrichSyncedRecords({}, f.a.readBossSync()).applications.length,
    1,
  );
  row = f.a.discoveryList({ filter: "following" }).items[0];
  f.call("career-discovery-decision", {
    accountId: "u1",
    jobId: "j1",
    status: "following",
    baseRevision: row.item.revision,
  });
  const s = f.call("career-workspace-snapshot");
  assert.equal(s.state.opportunities.length, 1);
  assert.equal(s.state.opportunities[0].stage, "计划联系");
  assert.equal(s.state.opportunities[0].job.address, "上海市徐汇区");
  assert.equal(
    f.a.atlasDb().prepare("SELECT COUNT(*) n FROM send_attempts").get().n,
    0,
  );
  f.a.closeAtlas();
});
test("dismiss can be undone and concurrent decision keeps newer state", () => {
  const f = fixture();
  f.seed();
  const rev = f.a.discoveryList().items[0].item.revision;
  f.call("career-discovery-decision", {
    accountId: "u1",
    jobId: "j1",
    status: "dismissed",
    baseRevision: rev,
  });
  assert.throws(
    () =>
      f.call("career-discovery-decision", {
        accountId: "u1",
        jobId: "j1",
        status: "following",
        baseRevision: rev,
      }),
    /另一个窗口/,
  );
  const row = f.a.discoveryList({ filter: "dismissed" }).items[0];
  f.call("career-discovery-decision", {
    accountId: "u1",
    jobId: "j1",
    status: "new",
    baseRevision: row.item.revision,
  });
  assert.equal(f.a.discoveryList().total, 1);
  f.a.closeAtlas();
});
test("discovery AI labels provisional evidence, reuses unchanged JD cache, preserves result on failure", async () => {
  const f = fixture();
  f.seed();
  const p = {
    accountId: "u1",
    jobId: "j1",
    profileVersion: f.a.discoveryList().profileVersion,
  };
  const first = await f.a.analyzeDiscoveredJob(p);
  assert.equal(first.provisional, true);
  assert.equal(first.evidenceConfirmation.e1, false);
  assert.match(f.state.calls[0].messages[0].content, /待核实/);
  assert.equal(f.state.calls[0].max_tokens, 393216);
  assert.equal(first.maxOutputTokens, 393216);
  assert.equal(f.state.calls[0].thinking.type, "enabled");
  assert.equal(f.state.calls[0].reasoning_effort, "max");
  assert.equal(first.contextWindowTokens, 1048576);
  f.seed();
  await f.a.analyzeDiscoveredJob(p);
  assert.equal(f.state.calls.length, 1);
  f.state.error = true;
  await assert.rejects(
    f.a.analyzeDiscoveredJob({ ...p, refresh: true }),
    /受限/,
  );
  const row = f.a.discoveryList().items[0];
  assert.equal(row.item.analysis.analysis.businessGoal, answer.businessGoal);
  assert.match(row.item.analysisError, /受限/);
  await assert.rejects(f.a.analyzeJob({ job: row.job }), /确认经历/);
  f.a.closeAtlas();
});
test("AI evidence injection and stale JD are rejected or visibly outdated", async () => {
  const f = fixture();
  f.seed();
  await f.a.analyzeDiscoveredJob({ accountId: "u1", jobId: "j1" });
  f.seed("j1", { postDescription: jd + "附加要求：英语沟通。" });
  assert.equal(f.a.discoveryList().items[0].analysisOutdated, true);
  f.state.answer = {
    ...answer,
    requirements: [
      { requirement: "技能", assessment: "满足", evidenceIds: ["made-up"] },
    ],
  };
  await assert.rejects(
    f.a.analyzeDiscoveredJob({ accountId: "u1", jobId: "j1", refresh: true }),
    /不存在的经历/,
  );
  f.a.closeAtlas();
});
test("one run per account, pause snoozes automatic restart and disabling auto pauses automatic work", () => {
  const f = fixture();
  const run = f.a.startDiscovery({ accountId: "u1" });
  assert.throws(() => f.a.startDiscovery({ accountId: "u1" }), /已有一轮/);
  f.call("career-discovery-pause", { accountId: "u1", runId: run.id });
  assert.equal(f.a.discoveryRun().state, "paused");
  assert.equal(f.a.atlasDb().prepare("SELECT state FROM task_runs WHERE id=?").get('discovery:'+f.a.discoveryRun().id).state, 'paused');
  assert.equal(f.a.atlasRead("atlas-discovery-schedule/u1").pausedByUser, true);
  assert.equal(
    f.a.updateDiscoveryRun("u1", run.id, { state: "running" }),
    false,
  );
  const next = f.a.startDiscovery({ accountId: "u1" });
  f.a.updateDiscoveryRun("u1", next.id, { automatic: true });
  const d = f.a.discoveryList();
  f.call("career-discovery-settings", {
    settings: { ...d.settings, autoRecommend: false },
    baseRevision: d.settingsRevision,
  });
  assert.equal(f.a.discoveryRun().state, "paused");
  f.a.closeAtlas();
});
test("encrypted migration preserves recommendations but never restarts active discovery", async () => {
  const f = fixture();
  f.seed();
  await f.a.analyzeDiscoveredJob({ accountId: "u1", jobId: "j1" });
  f.a.startDiscovery({ accountId: "u1" });
  f.a.atlasWrite("atlas-discovery-worker", { available: true });
  const b = f.a.exportEncryptedBackup("test-password-123");
  f.a.restoreEncryptedBackup({
    password: "test-password-123",
    base64: b.base64,
    confirm: true,
  });
  assert.equal(f.a.discoveryRun().state, "paused");
  assert.equal(f.a.discoverySettings().autoRecommend, false);
  assert.equal(f.a.atlasRead("atlas-discovery-worker", null), null);
  assert.equal(
    f.a.discoveryList().items[0].item.analysis.analysis.businessGoal,
    answer.businessGoal,
  );
  f.a.closeAtlas();
});
test("settings enforce search budgets and Shanghai time bounds", () => {
  const f = fixture(),
    s = f.a.discoverySettings();
  assert.throws(
    () => f.a.validateDiscoverySettings({ ...s, recommendTime: "21:00" }),
    /09:00/,
  );
  assert.throws(
    () => f.a.validateDiscoverySettings({ ...s, aiLimit: 31 }),
    /限制/,
  );
  const v = f.a.validateDiscoverySettings({
    ...s,
    maxJobs: 2,
    detailLimit: 5,
    aiLimit: 3,
  });
  assert.equal(v.detailLimit, 2);
  assert.equal(v.aiLimit, 2);
  f.a.closeAtlas();
});
test("AI priority distinguishes skipped jobs and sharing preserves the same saved analysis", async () => {
  const f = fixture();
  f.seed();
  f.seed("j2");
  f.state.answer = {
    ...answer,
    recommendation: {
      decision: "skip",
      reason: "必要专业经验缺少证据",
      nextStep: "先补充相关经历",
    },
  };
  await f.a.analyzeDiscoveredJob({ accountId: "u1", jobId: "j1" });
  assert.equal(
    f.a
      .discoveryList()
      .recommendations.some((r) => r.job.encryptJobId === "j1"),
    false,
  );
  let row = f.a.discoveryList({ filter: "all", jobId: "j1" }).items[0];
  f.call("career-discovery-decision", {
    accountId: "u1",
    jobId: "j1",
    status: "following",
    baseRevision: row.item.revision,
  });
  const saved = f.call("career-discovery-detail", {
    accountId: "u1",
    jobId: "j1",
  });
  assert.equal(saved.item.analysis.analysis.recommendation.decision, "skip");
  assert.equal(saved.item.status, "following");
  assert.equal(saved.analysisOutdated, false);
  f.a.closeAtlas();
});
test("already contacted jobs are excluded from new recommendations before dashboard is visited", () => {
  const f = fixture();
  f.seed();
  f.a.saveBossSnapshot({
    account: { id: "u1", name: "测试" },
    items: [
      {
        bossId: "b1",
        encryptJobId: "j1",
        bossName: "招聘者",
        companyName: "企业",
      },
    ],
  });
  const d = f.a.discoveryList();
  assert.equal(d.counts.new, 0);
  assert.equal(d.counts.following, 1);
  assert.equal(d.recommendations.length, 0);
  const row = f.a.discoveryList({ filter: "following" }).items[0];
  f.call("career-discovery-decision", {
    accountId: "u1",
    jobId: "j1",
    status: "following",
    baseRevision: row.item.revision,
  });
  assert.equal(
    f.call("career-workspace-snapshot").state.opportunities.length,
    0,
  );
  f.a.closeAtlas();
});
test("resuming AI reuses completed current reports, rejects duplicate execution, and preserves collected jobs", async () => {
  const f = fixture();
  f.seed();
  const run = f.a.startDiscovery({ accountId: "u1" });
  await f.a.analyzeDiscoveredJob({ accountId: "u1", jobId: "j1" });
  f.a.updateDiscoveryRun("u1", run.id, {
    state: "completed",
    phase: "done",
    jobIds: ["j1"],
    analyzedIds: ["j1"],
    errors: [{ ai: true, message: "timeout" }],
  });
  const resumed = f.call("career-discovery-retry-analysis", {
    accountId: "u1",
    runId: run.id,
  });
  assert.equal(resumed.jobIds.length, 1);
  assert.equal(resumed.analyzedIds.length, 1);
  assert.equal(resumed.errors.length, 0);
  assert.equal(resumed.phase, "ai");
  assert.throws(
    () =>
      f.call("career-discovery-retry-analysis", {
        accountId: "u1",
        runId: run.id,
      }),
    /仍在运行/,
  );
  assert.equal(f.state.calls.length, 1);
  f.a.closeAtlas();
});

test('unanalysed jobs do not gain priority by treating unknown hard requirements as satisfied', async () => {
  const f = fixture();
  f.seed('reviewed'); f.seed('unknown');
  f.state.answer = { ...answer, requirements: [{ ...answer.requirements[0], essential: true, status: 'verify' }] };
  await f.a.analyzeDiscoveredJob({ accountId: 'u1', jobId: 'reviewed' });
  const list = f.a.discoveryList({ filter: 'all' });
  assert.equal(list.items[0].job.encryptJobId, 'reviewed');
  assert.equal(list.recommendations.length, 1);
  assert.equal(list.recommendations[0].job.encryptJobId, 'reviewed');
  f.a.closeAtlas();
});

test('resume preserves unfinished detail phase and uses latest profile without repeating searches',()=>{
 const f=fixture();f.seed();const run=f.a.startDiscovery({accountId:'u1'});f.a.updateDiscoveryRun('u1',run.id,{phase:'detail',jobIds:['j1'],detailIds:[],detailSuccessIds:[],keywordIndex:4});
 f.call('career-discovery-pause',{accountId:'u1',runId:run.id});const snap=f.call('career-workspace-snapshot');snap.state.profile.summary='本人新增确认';f.call('career-workspace-save',{baseRevision:snap.revision,state:JSON.stringify(snap.state)});
 const next=f.call('career-discovery-resume',{accountId:'u1',runId:run.id});assert.equal(next.phase,'detail');assert.equal(next.keywordIndex,4);assert.deepEqual([...next.jobIds],['j1']);assert.notEqual(next.profileVersion,run.profileVersion);assert.equal(next.detailIds.length,0);
 assert.throws(()=>f.call('career-discovery-resume',{accountId:'u1',runId:run.id}),/勿重复/);assert.throws(()=>f.call('career-discovery-resume',{accountId:'other',runId:run.id}),/账号/);f.a.closeAtlas();
});

 test('recommended count, cards and list exclude followed and dismissed jobs consistently',async()=>{
  const f=fixture(); f.seed('keep');f.seed('follow');f.seed('dismiss');
  for(const jobId of ['keep','follow','dismiss'])await f.a.analyzeDiscoveredJob({accountId:'u1',jobId});
  for(const [jobId,status] of [['follow','following'],['dismiss','dismissed']]){
   const row=f.a.discoveryList({filter:'all',jobId}).items[0];f.call('career-discovery-decision',{accountId:'u1',jobId,status,baseRevision:row.item.revision});
  }
  const r=f.a.discoveryList({filter:'recommended'});assert.equal(r.counts.recommended,1);assert.equal(r.items.length,1);assert.equal(r.recommendations.length,1);assert.equal(r.items[0].job.encryptJobId,'keep');f.a.closeAtlas();
 });

test('targeted and recommended routes build distinct pages and retain their source filters', () => {
  const f=fixture(),a=f.a;
  const targeted=a.discoverySources(['targeted'],['AI产品','产品负责人'],['上海']);
  assert.equal(targeted.length,2); assert.ok(targeted.every(s=>new URL(s.url).searchParams.get('query')));
  const recommended=a.discoverySources(['recommended'],['AI产品'],['上海']);
  assert.equal(recommended.length,1); assert.equal(new URL(recommended[0].url).searchParams.has('query'),false);
  f.seed(); f.seed('both');
  a.markDiscovered('u1',[{encryptJobId:'both',jobName:'AI产品负责人'}],'BOSS 推荐');
  assert.equal(a.discoveryList({filter:'all',channel:'targeted'}).total,2);
  assert.equal(a.discoveryList({filter:'all',channel:'recommended'}).total,1);
  assert.equal(a.discoveryList({filter:'all'}).total,2);
  const run=f.call('career-discovery-start',{accountId:'u1',channels:['recommended']});
  assert.equal(run.channels.join(','),'recommended');
  assert.throws(()=>f.call('career-discovery-start',{accountId:'u1',channels:['targeted']}),/正在进行/);
  a.closeAtlas();
});

test('recommendation collection does not require search keywords, while targeted search still does',()=>{
 const f=fixture(),a=f.a;
 const s=a.discoverySettings();s.keywords=[];
 assert.doesNotThrow(()=>a.validateDiscoverySettings(s,true));
 assert.throws(()=>a.validateDiscoverySettings(s),/关键词/);
 a.atlasWrite('atlas-discovery-settings',s);
 const run=a.startDiscovery({accountId:'u1',channels:['recommended']});assert.equal(run.channels[0],'recommended');
 a.closeAtlas();
});
