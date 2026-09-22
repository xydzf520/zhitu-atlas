// Isolated production-UI fixture; never reads credentials or the user's databases.
const { buildSync } = require("esbuild"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-contact-ui-"));
process.env.ATLAS_DATA_ROOT = root;
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(
  path.join(root, "config/llm.json"),
  JSON.stringify([
    {
      enabled: true,
      model: "deepseek-flash",
      providerApiSecret: "local-fixture-only",
      providerCompleteApiUrl: "https://api.deepseek.com",
    },
  ]),
);
let analyses = 0;
global.fetch = async (url, opts) => {
  if (!String(url).startsWith("https://api.deepseek.com"))
    throw Error("Fixture blocks external requests");
  const body = JSON.parse(opts.body),
    system = body.messages[0].content,
    input = JSON.parse(body.messages[1].content);
  let value;
  if (system.includes("businessGoal")) {
    if (++analyses > 1) return { ok: false, status: 429 };
    value = {
      recommendation: {
        decision: "consider",
        reason: "平台需求分析与岗位方向相关，经历待本人确认。",
        nextStep: "先核实英语要求，再准备联系。",
      },
      businessGoal: "通过用户研究与产品迭代，提升专业工具的使用体验。",
      requirements: [
        {
          requirement: "跨职能推进产品交付",
          assessment: "平台需求与上线经历待本人确认，可进一步补充协作过程。",
          evidenceIds: ["fixture"],
        },
        {
          requirement: "英语沟通能力",
          assessment: "现有经历没有证据，需要核实。",
          evidenceIds: [],
        },
      ],
      strengths: ["企业平台产品规划与需求分析经历（待本人确认）"],
      gaps: ["英语沟通能力缺少已确认依据"],
      questions: ["如何定义平台需求的优先级？"],
      resumeSuggestions: ["补充需求判断过程，并明确个人负责范围。"],
      draft: "",
    };
  } else if (system.includes("审校员"))
    value = {
      grounded: true,
      relevant: true,
      concise: true,
      noCommitments: true,
      issues: [],
    };
  else
    value = {
      decision: "draft",
      opening: "您好，看到贵司关注产品规划与需求分析",
      matches: [
        {
          requirementId: input.requirements[0].id,
          evidenceId: input.evidence[0].id,
          relevance: "平台需求分析与产品交付经历可用于说明产品规划能力。",
        },
      ],
      closing: "discuss",
      gaps: ["英语沟通能力需要进一步核实"],
    };
  return {
    ok: true,
    json: async () => ({
      choices: [
        { message: { content: JSON.stringify(value) }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
    }),
  };
};
const structuredJD =
  "职位概述负责专业工具产品规划，推动用户研究和体验优化。核心职责1. 开展用户研究，发现业务机会。2. 定义路线图和迭代优先级。3. 优化用户体验，积累产品优势4. 协调设计、研发和运营交付。5. 持续观察功能表现。任职要求 1. 本科以上学历。2. 5年以上产品经验。3. 熟悉产品设计方法。4. 有PLG增长经验5. 熟悉数据分析。6. 结构化思维。7. 跨职能协作。8. 英语沟通能力。9. 关注体验细节。加分项1. CAD产品经验。2. 多端产品设计。我们提供：- 开放团队文化。- 完善福利。";
const file = path.join(root, "server.cjs");
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: [
      "atlas-server",
      "atlas-service",
      "atlas-store",
      "atlas-boss-sync",
      "career-boss-data",
      "atlas-contact",
    ]
      .map(
        (n) =>
          "export * from " +
          JSON.stringify(
            path.resolve("packages/ui/src/main/features/" + n + ".ts"),
          ),
      )
      .join("\n"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: file,
});
const a = require(file),
  h = a.createAtlasHandlers(async () => ({
    data: { applications: [], databaseAvailable: true },
  })),
  call = (n, p) => h.get(n)({}, p),
  s = call("career-workspace-snapshot");
s.state.profile = {
  name: "隔离验收用户",
  headline: "AI产品负责人",
  summary: "测试资料",
  targetRoles: ["AI产品负责人"],
  preferredCities: ["上海"],
  minimumMonthlyK: 40,
  evidence: [
    {
      id: "fixture",
      confirmed: false,
      title: "企业AI平台",
      text: "负责企业技能平台的需求分析、能力复用与上线。",
      keywords: ["AI", "平台"],
      source: "隔离测试样例",
    },
  ],
  resumeText: "仅用于界面验收的虚构资料",
};
call("career-workspace-save", {
  state: JSON.stringify(s.state),
  baseRevision: s.revision,
});
const sample = [
  ["a", "澄明科技", "明天下午能安排面试吗", false, 1],
  ["b", "星河产品", "可以介绍一下你的项目吗", false, 2],
  ["c", "映山软件", "您好，期待了解岗位职责", true, 0],
  ["d", "海屿智能", "", undefined, 0],
];
a.saveBossSnapshot({
  account: { id: "fixture-account", name: "测试账户" },
  items: sample.map(([id, company, text, self, unread]) => ({
    bossId: id,
    bossName: "招聘者 " + id,
    companyName: company,
    encryptJobId: "job-" + id,
    lastText: text,
    lastIsSelf: self,
    unreadCount: unread,
    updateTime: Date.now() - 10000,
  })),
});
for (const [id, company, text] of sample.slice(0, 3)) {
  a.ingestBossJobs(
    "fixture-account",
    {
      code: 0,
      zpData: {
        jobInfo: {
          encryptId: "job-" + id,
          jobName: "AI产品负责人",
          postDescription: structuredJD,
          address: "上海市徐汇区",
          salaryDesc: "40-60K·14薪",
        },
        bossInfo: {
          encryptBossId: id,
          name: "招聘者 " + id,
          activeTimeDesc: "刚刚活跃",
        },
        brandComInfo: {
          encryptBrandId: "company-" + id,
          brandName: company,
          stageName: "B轮",
        },
      },
    },
    "/wapi/zpgeek/job/detail.json",
  );
  a.saveBossSnapshot({
    account: { id: "fixture-account", name: "测试账户" },
    items: [],
    conversation: {
      bossId: id,
      identityVerified: true,
      messages: [
        {
          mid: "sent-" + id,
          isSelf: true,
          type: "text",
          text: "您好，我有企业产品相关经历。",
          time: Date.now() - 20000,
        },
        {
          mid: "received-" + id,
          isSelf: false,
          type: "text",
          text,
          time: Date.now() - 10000,
        },
      ],
    },
  });
}
a.ingestBossJobs(
  "fixture-account",
  {
    code: 0,
    zpData: {
      jobInfo: {
        encryptId: "job-a",
        jobName: "AI产品负责人",
        postDescription: structuredJD + "另有信息：需要与海外团队协作。",
        address: "上海市徐汇区漕溪北路",
        salaryDesc: "45-65K·14薪",
      },
      bossInfo: { encryptBossId: "a", name: "招聘者 a" },
      brandComInfo: { brandName: "澄明科技" },
    },
  },
  "/wapi/zpgeek/job/detail.json",
);
for (let i = 0; i < 24; i++)
  a.ingestBossJobs(
    "fixture-account",
    {
      code: 0,
      zpData: {
        jobList: [
          {
            encryptId: "discovery-" + i,
            jobName: "AI产品负责人",
            brandName: ["远帆智能", "澄宇软件", "星海科技"][i % 3] + i,
            postDescription: structuredJD,
            cityName: i === 3 ? "杭州" : "上海",
            address: "上海市浦东新区张江路",
            salaryDesc: i === 4 ? "25-30K" : i === 5 ? "面议" : "40-65K·14薪",
          },
        ],
      },
    },
    "/wapi/zpgeek/search/joblist.json",
  );
a.atlasWrite("atlas-discovery-worker", {
  available: true,
  accountId: "fixture-account",
  at: new Date().toISOString(),
});

const stamp=new Date().toISOString();
for(const [i,status] of ['completed','cooling','uncertain','failed','manual','queued'].entries()) {
  const id='contact-fixture-'+i,jobId='fixture-job-'+i,bossId='fixture-boss-'+i;
  const job={encryptJobId:jobId,encryptBossId:bossId,encryptCompanyId:'company-'+(i%2),jobName:'AI产品负责人',companyName:['澄明科技','远帆智能'][i%2],description:structuredJD,address:'上海市徐汇区漕溪北路',salaryHigh:65,bossName:'招聘者 '+i};
  const proof={accountId:'fixture-account',conversationId:bossId,recruiterId:bossId,jobId,messageId:'fixture-message-'+i,text:'您好，关注到贵司重视企业 AI 平台建设。我负责企业技能平台的需求分析、能力复用与上线，希望交流业务重点。',sentAt:stamp};
  const body={job,profileVersion:'fixture-profile',openedAt:['completed','cooling','manual'].includes(status)?stamp:null,conversationId:bossId,reason:{completed:'个性化说明已经平台消息回读核验',cooling:'已开聊，等待至少10分钟后补充个性化说明',uncertain:'平台请求返回不确定，未自动重试',failed:'模型超时，资料与原有分析保留',manual:'本人确认已发送',queued:'匹配通过，等待额度'}[status],phase:'personalized',attemptId:['uncertain','completed','manual'].includes(status)?id+'-send':undefined,proof:status==='completed'?proof:undefined,greeting:{text:proof.text,model:'deepseek-flash',matches:[{requirement:'企业技能平台建设',evidenceId:'fixture',evidenceQuote:'负责企业技能平台的需求分析、能力复用与上线。',relevance:'平台规划经历与岗位业务直接关联。'}]}};
  a.atlasDb().prepare("INSERT INTO contact_runs VALUES(?,'boss','fixture-account',?,?,?,?,1,?,?)").run(id,jobId,bossId,status,JSON.stringify(body),stamp,stamp);
  if(body.attemptId)a.atlasDb().prepare("INSERT INTO send_attempts VALUES(?,'boss','fixture-account',?,'first-contact',1,?,?,?,?,?,?)").run(body.attemptId,bossId,status==='uncertain'?'uncertain':'sent',proof.text,stamp,stamp,JSON.stringify({contactId:id,phase:'personalized',jobId}),JSON.stringify({method:status==='completed'?'platform':'manual'}));
  if(status==='completed')a.linkContactOpportunity(a.contactRun(id));
}
a.atlasWrite('atlas-contact-worker',{at:stamp,accountId:'fixture-account',available:true,verification:'隔离验收样例，未连接招聘平台'});

if (process.env.ATLAS_REVIEW_FIXTURE === '1') {
  const row = a.atlasDb().prepare("SELECT * FROM contact_runs WHERE state='completed' LIMIT 1").get();
  const body = JSON.parse(row.body);body.reason='请核对这段话术；尚未操作 BOSS';body.approval=null;
  a.atlasDb().prepare("UPDATE contact_runs SET state='awaiting_confirmation',body=?,revision=revision+1 WHERE id=?").run(JSON.stringify(body),row.id);
}
const serverPromise = a.startAtlasServer(
  path.resolve("packages/ui/web-dist"),
  Number(process.env.ATLAS_FIXTURE_PORT) || 5193,
);
serverPromise.then((server) => {
  console.log("Isolated structured UI ready on " + server.address().port);
  process.on("SIGTERM", () =>
    server.close(() => {
      a.closeAtlas();
      fs.rmSync(root, { recursive: true, force: true });
      process.exit(0);
    }),
  );
});
