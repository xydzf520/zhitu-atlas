// Isolated source-linked enterprise report. No real credentials, BOSS account or search requests.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { buildSync } = require("esbuild");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-research-ui-"));
process.env.ATLAS_DATA_ROOT = root;
const bundle = path.join(root, "api.cjs");
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: [
      "atlas-server",
      "atlas-store",
      "atlas-service",
      "atlas-company-research",
      "career-boss-data",
      "atlas-boss-sync",
    ]
      .map((n) => `export * from './packages/ui/src/main/features/${n}'`)
      .join("\n"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});
const a = require(bundle),
  h = a.createAtlasHandlers(),
  s = h.get("career-workspace-snapshot")();
s.state.profile.evidence = [
  {
    id: "e1",
    title: "企业平台建设",
    text: "负责企业产品的规划、需求分析与跨团队交付。",
    confirmed: true,
    source: "隔离样例",
    keywords: ["平台"],
  },
];
h.get("career-workspace-save")(
  {},
  { state: JSON.stringify(s.state), baseRevision: s.revision },
);
a.saveBossSnapshot({
  account: { id: "fixture", name: "隔离账户" },
  items: [
    {
      bossId: "b",
      companyName: "澄明智能科技",
      bossName: "招聘者",
      encryptJobId: "j",
      lastIsSelf: false,
      lastText: "可以发一下简历吗？我们目前更看重生产协同业务。",
      unreadCount: 1,
    },
  ],
});
a.ingestBossJobs(
  "fixture",
  {
    code: 0,
    zpData: {
      jobInfo: {
        encryptId: "j",
        jobName: "企业AI产品负责人",
        postDescription:
          "负责生产协同与企业AI产品，建立产品规划、需求分析和交付闭环。".repeat(
            5,
          ),
        address: "上海市徐汇区",
        salaryDesc: "40-60K",
      },
      bossInfo: { encryptBossId: "b" },
      brandComInfo: { brandName: "澄明智能科技" },
    },
  },
  "/wapi/zpgeek/job/detail.json",
);
a.saveBossSnapshot({
  account: { id: "fixture", name: "隔离账户" },
  items: [],
  conversation: {
    bossId: "b",
    identityVerified: true,
    messages: [
      {
        mid: "m1",
        isSelf: false,
        type: "text",
        text: "可以发一下简历吗？我们目前更看重生产协同业务。",
        time: Date.now(),
      },
    ],
  },
});
const c = a.companyResearchSnapshot({ accountId: "fixture", bossId: "b" }),
  at = new Date().toISOString();
const report = {
  identity: {
    status: "ambiguous",
    reason:
      "公开名称存在同名主体，目前无法将官网与招聘主体完全对应，需要核实法律主体。",
    sourceIds: ["W0", "M0"],
  },
  summary: "先确认企业主体，再围绕生产协同的实际业务目标沟通。",
  facts: [
    {
      topic: "业务",
      text: "招聘者表示当前业务重点是生产协同。",
      sourceIds: ["M0"],
    },
    {
      topic: "产品",
      text: "公开网页介绍了面向企业的生产信息协同产品，是否属于本次招聘主体待核实。",
      sourceIds: ["W0"],
    },
    {
      topic: "地点",
      text: "JD 工作地点为上海市徐汇区，具体办公楼与注册地址尚未明确。",
      sourceIds: ["J0"],
    },
  ],
  inferences: [
    {
      text: "该岗位可能更侧重业务流程落地，而非纯模型算法研发。",
      confidence: "有限",
      sourceIds: ["M0", "J0"],
      verify: "确认岗位考核是否围绕流程效率、使用覆盖和产品交付。",
    },
  ],
  connections: [
    {
      text: "你可以突出企业平台规划、需求分析与跨团队交付经历，结合生产协同需求解释可迁移的方法。",
      evidenceIds: ["e1"],
      sourceIds: ["J0", "M0"],
    },
  ],
  changes: [
    {
      before: "初步认为岗位重点在通用AI平台。",
      after: "招聘者补充后，将业务重点修正为生产协同。",
      reason: "新消息提供了更具体的业务范围，但尚未证明实际客户和落地规模。",
      sourceIds: ["M0"],
    },
  ],
  questions: ["招聘主体的公司全称是什么？", "当前优先解决哪一类生产协同问题？"],
  nextStep: "先核实主体和职责，再决定如何发送针对性的简历。",
};
a.atlasWrite("atlas-company-research/" + a.fingerprint(["fixture", "b"]), {
  accountId: "fixture",
  bossId: "b",
  autoUpdate: false,
  latest: {
    id: "report-2",
    at,
    basis: c.basis,
    incoming: "fixture",
    company: c.company,
    report,
    sources: [
      {
        id: "M0",
        kind: "recruiter",
        title: "招聘者最新回复",
        text: "可以发一下简历吗？我们目前更看重生产协同业务。",
        at,
      },
      {
        id: "J0",
        kind: "jd",
        title: "企业AI产品负责人",
        text: "负责生产协同与企业AI产品；工作地点上海市徐汇区。",
        at,
      },
      {
        id: "W0",
        kind: "web",
        title: "公开企业产品介绍（隔离样例）",
        url: "https://example.com",
        text: "企业生产信息协同产品，用于隔离交互验收。",
        at,
        readAt: at,
      },
    ],
    searches: [{ query: "澄明智能科技 业务", at, results: 1, cached: false }],
    notices: ["这是隔离验收样例，无真实搜索或发送。"],
    toolNames: ["search_company_public", "read_company_public"],
    evidence: s.state.profile.evidence,
  },
  history: [
    { id: "report-1", at, report: { summary: "此前业务重点尚待核实。" } },
  ],
});
a.startAtlasServer(path.resolve("packages/ui/web-dist"), 5196).then(
  (server) => {
    console.log("Research UI fixture: http://127.0.0.1:5196/desktop.html");
    process.on("SIGTERM", () =>
      server.close(() => {
        a.closeAtlas();
        fs.rmSync(root, { recursive: true, force: true });
        process.exit(0);
      }),
    );
  },
);
