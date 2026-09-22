// Isolated Electron DOM fixture: all HTTPS traffic is intercepted locally.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { app, session } = require("electron");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas13-native-"));
app.setPath("userData", path.join(root, "electron"));
process.env.ATLAS_DATA_ROOT = path.join(root, "data");
const api = require(path.resolve(process.argv[2])),
  checks = [];
let opened = 0,
  sent = 0,
  adapter;
const jd =
  "负责App产品规划与用户需求分析，主导多产品融合和产品上线落地，负责跨团队协作及业务指标分析。制定产品路线图并根据用户反馈持续迭代。熟悉用户体验设计和商业目标拆解，能够把复杂场景转化为清晰的需求与产品方案。";
const detail = {
  jobInfo: {
    encryptId: "job",
    jobName: "App产品负责人",
    postDescription: jd,
    address: "上海市徐汇区",
    cityName: "上海",
    salaryDesc: "40-60K",
  },
  bossInfo: { encryptBossId: "boss", name: "招聘者" },
  brandComInfo: { encryptBrandId: "company", brandName: "隔离测试企业" },
};
const escape = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
const jobs = `<html><body><div class="page-jobs-main"><a href="https://www.zhipin.com/job_detail/job.html">目标岗位</a></div><div class="job-detail-box"><button class="op-btn op-btn-chat">立即沟通</button></div><script>const user={encryptUserId:'account',name:'测试用户'};document.querySelector('.page-jobs-main').__vue__={$store:{state:{userInfo:user}},jobList:[]};document.querySelector('.job-detail-box').__vue__={$store:{state:{userInfo:user}},data:${escape(detail)}};document.querySelector('a').onclick=e=>e.preventDefault();document.querySelector('button').onclick=()=>fetch('/fixture/open');</script></body></html>`;
function chat() {
  return `<html><body><div class="main-wrap"><div class="chat-user"><div class="user-list-content"><ul role="group"><li role="listitem">招聘者</li></ul></div></div><div class="chat-conversation"><div class="message-content"><div class="chat-record"></div></div><div class="message-controls"><div contenteditable="true" class="chat-input"></div><div class="chat-op"><button class="btn-send">发送</button></div></div></div></div><script>const friend={encryptBossId:'boss',name:'招聘者',brandName:'隔离测试企业',encryptJobId:'job'},messages=[{mid:'default',isSelf:true,type:'text',text:'您好，期待交流',time:Date.now(),status:2}];const q=s=>document.querySelector(s);q('.main-wrap').__vue__={$store:{state:{userInfo:{encryptUserId:'account',name:'测试用户'}}}};q('li').__vue__={source:friend};q('.chat-user').__vue__={list:[friend]};q('.chat-conversation').__vue__={selectedFriend$:friend};q('.chat-record').__vue__={boss:friend,list$:messages};q('.btn-send').onclick=()=>{const text=q('.chat-input').textContent;messages.push({mid:'personalized',isSelf:true,type:'text',text,time:Date.now(),status:2});q('.chat-input').textContent='';fetch('/fixture/sent')};</script></body></html>`;
}
(async () => {
  await app.whenReady();
  const ses = session.fromPartition("atlas13-native-fixture");
  await ses.protocol.handle("https", (request) => {
    const u = new URL(request.url);
    if (u.hostname !== "www.zhipin.com")
      throw Error("External requests blocked");
    if (u.pathname === "/fixture/open") {
      opened++;
      return new Response("{}");
    }
    if (u.pathname === "/fixture/sent") {
      sent++;
      return new Response("{}");
    }
    return new Response(
      u.pathname.startsWith("/web/geek/chat") ? chat() : jobs,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  });
  const state = api.emptyCareerState();
  state.profile = {
    name: "测试",
    headline: "",
    summary: "",
    resumeText: "",
    targetRoles: ["App产品负责人"],
    preferredCities: ["上海"],
    minimumMonthlyK: 40,
    evidence: [
      {
        id: "e",
        title: "App规划",
        confirmed: true,
        text: "我主导 App 多产品融合、产品规划与需求分析，并推动业务上线落地。",
        keywords: ["App"],
        source: "隔离测试",
      },
      {
        id: "e2",
        title: "需求",
        confirmed: true,
        text: "负责用户需求分析及产品上线。",
        keywords: ["需求"],
        source: "隔离测试",
      },
    ],
  };
  api.atlasWrite("career-workspace.json", state);
  api.initializePolicy();
  api.canonicalProfile();
  api.atlasWrite("career-boss-sync.json", {
    account: { id: "account", name: "隔离测试" },
    items: [],
  });
  api.atlasWrite("atlas-contact-authorization", { accountId: "account" });
  api.setRuntime({ paused: false, outbound: true, startHour: 0, endHour: 23 });
  api.setAllAutomationPaused(false);
  fs.mkdirSync(path.join(root, "data/config"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "data/config/llm.json"),
    JSON.stringify([
      {
        enabled: true,
        model: "deepseek-flash",
        providerApiSecret: "fixture-only",
        providerCompleteApiUrl: "https://api.deepseek.com/chat/completions",
      },
    ]),
  );
  global.fetch = async (_url, opts) => {
    const p = JSON.parse(opts.body),
      d = JSON.parse(p.messages[1].content),
      value = d.draft
        ? {
            grounded: true,
            relevant: true,
            concise: true,
            noCommitments: true,
            issues: [],
          }
        : {
            decision: "draft",
            opening: "您好，了解到贵司重视App规划与多产品融合",
            closing: "discuss",
            matches: [
              {
                requirementId: "r0",
                evidenceId: "e",
                evidenceQuote: state.profile.evidence[0].text,
                relevance: "产品规划与融合经历直接关联岗位需求。",
              },
            ],
            gaps: [],
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
        usage: { total_tokens: 20 },
      }),
    };
  };
  api.ingestBossJobs(
    "account",
    { code: 0, zpData: detail },
    "/wapi/zpgeek/job/detail.json",
  );
  const job = api.contactJob("account", "job");
  api.atlasWrite(api.discoveryItemKey("account", "job"), {
    accountId: "account",
    jobId: "job",
    status: "new",
    analysisBasis: api.contactJobBasis(job),
    analysis: {
      profileVersion: api.profileHistory()[0].id,
      model: "deepseek-flash",
      promptVersion: api.currentAnalysisPromptVersion(),
      analysis: {
        recommendation: { decision: "consider" },
        requirements: [
          {
            essential: true,
            status: "met",
            evidenceIds: ["e"],
            requirement: "产品规划",
            assessment: "已确认",
          },
        ],
      },
    },
  });
  const id = api.enqueueContact("account", job).id;
  adapter = new api.NativeContactAdapter(ses, async () => ({
    busy: false,
    epoch: 0,
  }));
  await api.contactTick(adapter);
  let row = api.contactRun(id);
  assert.equal(row.state, 'awaiting_confirmation');assert.equal(opened,0);assert.equal(sent,0);
  checks.push('生成后等待本人确认，未触碰平台开聊或发送');
  api.contactAction({accountId:'account',id,revision:row.revision,action:'approve',text:row.body.greeting.text,confirmed:true});
  await api.contactTick(adapter);row=api.contactRun(id);
  if (row.state !== "cooling")
    console.log(
      JSON.stringify({
        expected: row.body.job,
        actual: api.contactJob("account", "job"),
        basis: row.body.jobBasis,
        currentBasis: api.contactJobBasis(api.contactJob("account", "job")),
      }),
    );
  assert.equal(row.state, "cooling", row.body.reason);
  assert.equal(opened, 1);
  assert.equal(sent, 0);
  assert.equal(api.contactSummary().counts.completed, 0);
  checks.push("普通沟通只建立会话，平台默认招呼回读后进入冷却，未计完成");
  // Simulate ten elapsed minutes in the isolated fixture only.
  api
    .atlasDb()
    .prepare("UPDATE send_attempts SET created_at=? WHERE id=?")
    .run(new Date(Date.now() - 601000).toISOString(), row.body.attemptId);
  api.saveContact(id, { nextAt: new Date(Date.now() - 1000).toISOString() });
  await api.contactTick(adapter);
  row = api.contactRun(id);
  assert.equal(row.state, "completed", row.body.reason);
  assert.equal(sent, 1);
  assert.equal(row.body.proof.messageId, "personalized");
  assert.match(row.body.proof.text, /我主导 App/);
  checks.push(
    "Electron 原生 insertText 写入定制段落，点击发送并回读唯一消息标识",
  );
  await api.contactTick(adapter);
  assert.equal(opened, 1);
  assert.equal(sent, 1);
  checks.push("重复运行不会重复开聊或发送");
  assert.equal(api.contactSummary().counts.completed, 1);
  assert.equal(api.contactSummary().counts.messages, 2);
  assert.equal(api.contactSummary().quota.used, 2);
  checks.push("默认招呼和定制说明均计额度，只有定制说明计联系成功");
  assert.equal(
    api.atlasDb().prepare("SELECT count(*) n FROM opportunities").get().n,
    1,
  );
  assert.equal(
    api.atlasDb().prepare("SELECT count(*) n FROM opportunity_links").get().n,
    2,
  );
  checks.push("成功后企业、岗位、招聘者与阶段关联");
  adapter.dispose();
  api.closeAtlas();
  const result = {
    passed: true,
    checks: checks.length,
    details: checks,
    externalNetworkRequests: 0,
  };
  fs.writeFileSync(
    process.env.ATLAS_CONTACT_CHECK_OUTPUT || path.join(root, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  app.exit(0);
})().catch((e) => {
  console.error(e.stack);
  adapter?.dispose();
  api.closeAtlas();
  app.exit(1);
});
