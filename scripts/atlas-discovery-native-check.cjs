// All platform and model requests are local fixtures. Never uses real accounts.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { app, session, BrowserWindow } = require("electron");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-discovery-native-"));
app.setPath("userData", path.join(root, "electron"));
process.env.ATLAS_DATA_ROOT = path.join(root, "data");
const api = require(path.resolve(process.argv[2])),
  wait = (ms) => new Promise((r) => setTimeout(r, ms));
let reader,
  other,
  visible,
  requests = 0,
  aiCalls = 0,
  siteAccount = "account";
const checks = [],
  reads = [],
  now = new Date("2026-09-17T04:00:00Z");
const jd =
  "负责AI平台产品规划、需求分析、技能沉淀与复用，推动企业业务流程智能化。通过用户调研制定产品迭代路线，协调研发与运营进行产品交付。任职要求：拥有产品管理经验、需求拆解能力、业务理解能力和良好的跨团队沟通能力。";
const h = new Map();
api.registerCareerWorkspace(
  (k, f) => h.set(k, f),
  () => {},
);
api.registerDiscovery((k, f) => h.set(k, f));
const call = (n, p) => h.get(n)({}, p);
(async () => {
  await app.whenReady();
  const s = call("career-workspace-snapshot");
  Object.assign(s.state.profile, {
    targetRoles: ["AI产品负责人", "平台产品经理"],
    preferredCities: ["上海"],
    minimumMonthlyK: 40,
    evidence: [
      { id: "confirmed-related", confirmed: true, title: "已确认需求经历",
        text: "负责平台需求分析与团队协作", keywords: ["平台", "需求"], source: "fixture" },
      {
        id: "e",
        confirmed: false,
        title: "平台经历",
        text: "负责企业AI平台产品规划和需求分析",
        keywords: ["AI", "平台"],
        source: "fixture",
      },
    ],
  });
  call("career-workspace-save", {
    state: JSON.stringify(s.state),
    baseRevision: s.revision,
  });
  api.saveBossSnapshot({
    account: { id: "account", name: "隔离测试" },
    items: [],
  });
  fs.mkdirSync(path.join(root, "data/config"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "data/config/llm.json"),
    JSON.stringify([
      {
        enabled: true,
        model: "deepseek-flash",
        providerApiSecret: "fixture",
        providerCompleteApiUrl: "https://api.deepseek.com",
      },
    ]),
  );
  global.fetch = async () => {
    aiCalls++;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                recommendation: {
                  decision: "consider",
                  reason: "企业平台经历相关，待核实。",
                  nextStep: "核实职责。",
                },
                businessGoal: "企业平台产品",
                requirements: [
                  {
                    requirement: "AI平台产品",
                    assessment: "待本人确认",
                    evidenceIds: ["e"],
                  },
                ],
                strengths: ["平台经历待本人确认"],
                gaps: ["当前阶段待核实"],
                questions: ["业务目标是什么"],
                resumeSuggestions: ["补充职责"],
                draft: "",
              }),
            },
          },
        ],
        usage: { total_tokens: 100 },
      }),
    };
  };
  api.atlasWrite("atlas-discovery-settings", {
    ...api.discoverySettings(),
    maxJobs: 4,
    detailLimit: 3,
    aiLimit: 1,
    keywords: ["AI产品负责人", "平台产品经理"],
  });
  api.initializePolicy(); const policy=api.careerPolicy();policy.discovery.autoRecommend=true;policy.automationPaused=false;policy.discovery.adaptive=false;policy.discovery.maxJobs=4;policy.discovery.detailLimit=3;policy.discovery.aiLimit=1;api.atlasWrite('atlas-career-policy',policy);api.startTaskQueue(async(channel,payload)=>{if(channel==='career-discovery-analyze')return api.analyzeDiscoveredJob(payload);throw Error('unexpected task')});
  const site = session.fromPartition("persist:atlas-discovery-fixture");
  site.protocol.handle("https", (req) => {
    requests++;
    const url = new URL(req.url);
    reads.push(url.pathname + url.search);
    if (url.pathname.startsWith("/job_detail/")) {
      return new Response(
        '<!doctype html><meta charset="utf-8"><div class="job-primary"><h1>AI产品负责人</h1><span class="salary">40-60K</span></div><div class="job-sec-text">' +
          jd +
          '</div><div class="job-location"><div class="job-location-map" data-content="上海市徐汇区测试路"></div></div>',
        { headers: { "content-type": "text/html" } },
      );
    }
    const q = url.searchParams.get("query");
    const jobs = (q === "AI产品负责人" ? ["one", "two"] : ["two", "three"]).map(
      (id) => ({
        encryptId: id,
        jobName: "AI产品负责人",
        brandName: "企业" + id,
        salaryDesc: "40-60K",
        cityName: "上海",
        encryptUserId: "boss-" + id,
      }),
    );
    return new Response(
      '<!doctype html><meta charset="utf-8"><div class="page-jobs-main"><div class="job-list-container">岗位</div></div><script>document.querySelector(".page-jobs-main").__vue__=' +
        JSON.stringify({
          $store: { state: { userInfo: { encryptUserId: siteAccount } } },
          formData: { query: q },
          jobList: jobs,
        }) +
        "</script>",
      { headers: { "content-type": "text/html" } },
    );
  });
  visible = new BrowserWindow({ show: false });
  await visible.loadURL(
    "data:text/html;charset=utf-8,<textarea>保持我的草稿</textarea>",
  );
  const frontUrl = visible.webContents.getURL();
  let expected = "account", humanBusy = false;
  reader = new api.AtlasDiscoveryCollector(site, () => expected, false, async () => humanBusy);
  await reader.tick(new Date("2026-09-17T01:00:00Z"));
  assert.equal(requests, 0);
  checks.push("daily-schedule-waits-for-configured-time");
  humanBusy = true;
  await reader.tick(now);
  assert.equal(requests, 0);
  checks.push("human-activity-defers-automatic-platform-reads");
  humanBusy = false;
  await reader.tick(now);
  await wait(60);
  assert.equal(api.discoveryRun().automatic, true);
  other = new api.AtlasDiscoveryCollector(site, () => expected, false);
  const first = requests;
  await other.tick(now);
  assert.equal(requests, first);
  other.dispose();
  other = null;
  checks.push("single-worker-lease-across-windows");
  for (let n = 0; n < 60; n++) {
    await wait(40);
    await reader.tick(now);
    await api.taskQueueTick();
    if (api.discoveryRun().state === "completed") break;
  }
  const run = api.discoveryRun();
  if (run.state !== "completed")
    console.log(
      JSON.stringify({
        requests,
        reads,
        page: reader.view
          ? await reader.view.webContents.executeJavaScript(
              "(" + api.readDiscoveryPage.toString() + ")()",
            )
          : null,
        loaded: reader.loaded,
        owner: reader.owner,
      }),
    );
  assert.equal(run.state, "completed", JSON.stringify(run));
  assert.equal(run.jobIds.length, 3);
  assert.equal(run.detailSuccessIds.length, 3);
  assert.equal(aiCalls, 1);
  assert.equal(run.analyzedIds.length, 1);
  checks.push(
    "multiple-keywords-deduplicate-with-budgets",
    "normal-job-page-fills-jd-and-address",
    "automatic-deepseek-analysis-budget",
  );
  assert.equal(api.discoveryList().recommendations.length, 1);
  assert.equal(
    api.discoveryList().recommendations[0].item.analysis.provisional,
    true,
  );
  checks.push("proactive-ranked-recommendations-use-visible-evidence-status");
  assert.equal(
    api.enrichSyncedRecords({}, api.readBossSync()).applications.length,
    0,
  );
  checks.push("discovered-jobs-do-not-pollute-contacted-pipeline");
  const stopped = requests;
  await reader.tick(now);
  await reader.tick(now);
  assert.equal(requests, stopped);
  checks.push("daily-run-executes-once");
  assert.equal(visible.webContents.getURL(), frontUrl);
  assert.equal(
    await visible.webContents.executeJavaScript(
      'document.querySelector("textarea").value',
    ),
    "保持我的草稿",
  );
  assert.equal(
    api.atlasDb().prepare("SELECT COUNT(*) n FROM send_attempts").get().n,
    0,
  );
  checks.push("foreground-and-draft-preserved", "no-sending-capability");
  api.startDiscovery({ accountId: expected });
  await reader.tick(now);
  await wait(40);
  call("career-discovery-pause", {
    accountId: expected,
    runId: api.discoveryRun().id,
  });
  await reader.tick(now);
  const paused = requests;
  await reader.tick(now);
  assert.equal(requests, paused);
  assert.equal(api.discoveryRun().state, "paused");
  checks.push("pause-stops-new-platform-reads");
  api.startDiscovery({ accountId: expected });
  await reader.tick(now);
  await wait(40);
  const oldRun = api.discoveryRun();
  expected = "second";
  api.saveBossSnapshot({
    account: { id: expected, name: "另一个" },
    items: [],
  });
  api.atlasWrite("atlas-discovery-settings", {
    ...api.discoverySettings(),
    autoRecommend: false,
  });
  await reader.tick(now);
  assert.equal(api.discoveryRun("account").state, "blocked");
  assert.equal(api.discoveryList().counts.total, 0);
  checks.push("account-switch-blocks-old-run-even-without-new-run");
  api.startDiscovery({ accountId: expected });
  await reader.tick(now);
  await wait(50);
  reader.loadedAt = Date.now() - 21000;
  await reader.tick(now);
  assert.equal(api.discoveryRun().state, "blocked");
  const blocked = requests;
  await reader.tick(now);
  await reader.tick(now);
  assert.equal(requests, blocked);
  checks.push("unverified-account-is-not-collected-and-never-refresh-loops");
  reader.dispose();
  visible.destroy();
  api.closeAtlas();
  const report = {
    passed: true,
    checks: checks.length,
    details: checks,
    externalNetworkRequests: 0,
  };
  fs.writeFileSync(
    process.env.ATLAS_DISCOVERY_CHECK_OUTPUT,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  app.exit(0);
})().catch((e) => {
  console.error(e);
  reader?.dispose();
  other?.dispose();
  visible?.destroy();
  app.exit(1);
});
app.on("quit", () => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
});
