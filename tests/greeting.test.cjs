const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  vm = require("node:vm"),
  { buildSync } = require("esbuild");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-greeting-test-")),
  bundle = path.join(root, "agent.cjs");
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: [
      "atlas-store",
      "atlas-profile",
      "atlas-greeting",
      "career-workspace-service",
      "atlas-tasks",
      "atlas-boss-sync",
      "career-boss-data",
      "atlas-conversation-pitch",
      "atlas-portfolio",
    ]
      .map((s) => `export * from './packages/ui/src/main/features/${s}'`)
      .join("\n"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});
process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
const job = {
  jobName: "App产品负责人",
  companyName: "测试公司",
  address: "上海",
  salaryHigh: 60,
  description:
    "负责C端App从0到1建设及多产品融合，开展用户需求分析、产品规划与落地交付。通过分析产品使用数据制定迭代路线，推动多端用户体验一致性，协调研发、设计和运营团队。对岗位的业务目标与当前产品规模做出清晰说明，重视真实的项目成果。",
};
const evidence = {
  id: "app",
  confirmed: true,
  title: "App产品",
  text: "我主导 App 从0到1建设及多产品融合，产品日活2万、累计用户50万。",
  source: "本人",
  keywords: ["App", "C端"],
};
const draft = () => ({
  decision: "draft",
  matches: [
    {
      requirement: "负责C端App从0到1建设及多产品融合",
      evidenceId: "app",
      evidenceQuote: evidence.text,
      relevance: "从零建设与多产品整合经历直接对应岗位的产品建设需求。",
    },
  ],
  text: "您好，看到贵司关注 App 从0到1建设及多产品融合。我曾主导相关 App 产品建设，产品日活2万、累计用户50万，希望进一步交流这个岗位的目标与挑战。",
  gaps: ["产品当前业务目标待沟通"],
});
const review = () => ({
  grounded: true,
  relevant: true,
  concise: true,
  noCommitments: true,
  issues: [],
});
const writer = () => ({
  decision: "draft",
  matches: [
    {
      requirementId: "r0",
      evidenceId: "app",
      relevance: draft().matches[0].relevance,
    },
  ],
  opening: "您好，了解到贵司需要负责C端App从0到1建设及多产品融合",
  closing: "discuss",
  gaps: [],
});
const expectedText = (api) =>
  writer().opening + "。" + evidence.text + api.pickGreetingEnding("discuss", job);
function fixture(responder, confirmed = true, extra = {}) {
  const home = fs.mkdtempSync(path.join(root, "h-")),
    config = path.join(home, ".local/share/zhitu-atlas/config");
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(
    path.join(config, "llm.json"),
    JSON.stringify([
      {
        enabled: true,
        model: "deepseek-flash",
        providerCompleteApiUrl: "https://api.deepseek.com",
        providerApiSecret: "fixture-key",
      },
    ]),
  );
  const calls = [],
    m = { exports: {} };
  const fetch = async (url, opts) => {
    if (!opts.body) {
      assert.equal(url, 'https://api.github.com/repos/example/skillforge')
      assert.equal(opts.redirect, 'error')
      assert.equal(opts.headers.Authorization, undefined)
      return { ok: true, json: async () => responder('repository', calls, opts) }
    }
    const b = JSON.parse(opts.body),
      kind = b.messages[0].content.includes("审校员") ? "review" : "write";
    calls.push({ kind, body: b });
    assert.equal(opts.redirect, "error");
    assert.equal(b.thinking.type, "enabled");
    assert.equal(b.max_tokens, 393216);
    assert.equal(b.reasoning_effort, "max");
    const value = await responder(kind, calls, opts);
    if (value?.httpError) return { ok: false, status: value.httpError };
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                typeof value === "string" ? value : JSON.stringify(value),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
      }),
    };
  };
  vm.runInNewContext(
    "(function(require,module,exports){" +
      fs.readFileSync(bundle, "utf8") +
      "\n})",
    {
      Buffer,
      process,
      Date,
      URL,
      fetch,
      AbortController,
      AbortSignal,
      setTimeout,
      clearTimeout,
      ...extra,
    },
  )(
    (k) => (k === "node:os" ? { homedir: () => home } : require(k)),
    m,
    m.exports,
  );
  const api = m.exports,
    handlers = new Map();
  api.registerCareerWorkspace(
    (k, f) => handlers.set(k, f),
    () => {},
  );
  let s = handlers.get("career-workspace-snapshot")();
  s.state.profile = {
    name: "样例",
    headline: "产品负责人",
    summary: "",
    resumeText: evidence.text,
    targetRoles: ["App产品负责人"],
    preferredCities: ["上海"],
    minimumMonthlyK: 40,
    evidence: [{ ...evidence, confirmed }],
  };
  s = handlers.get("career-workspace-save")(
    {},
    { state: JSON.stringify(s.state), baseRevision: s.revision },
  );
  return {
    api,
    calls,
    config,
    s,
    save: (p) => {
      const now = handlers.get("career-workspace-snapshot")();
      return handlers.get("career-workspace-save")(
        {},
        {
          state: JSON.stringify({ ...now.state, profile: p }),
          baseRevision: now.revision,
        },
      );
    },
  };
}
const normal = (kind) => (kind === "write" ? writer() : review());

const project = { name: 'SkillForge', url: 'https://github.com/example/skillforge', scope: '负责产品规划和企业 AI 应用建设', limitations: '真实模型训练和替代 Harness 尚未验收' }
const repository = { private: false, visibility: 'public', size: 100, html_url: project.url, license: { spdx_id: 'Apache-2.0' } }
function attachProject(f) {
  let p = f.api.canonicalProfile()
  p.evidence[0].project = { ...project }
  f.save(p)
  assert.equal(f.api.canonicalProfile().evidence[0].confirmed, false)
  p = f.api.canonicalProfile(); p.evidence[0].confirmed = true; f.save(p)
}
test('project requires an actual public repository and license before adding a relevant link', async () => {
  const f = fixture(kind => kind === 'repository' ? repository : normal(kind))
  try {
    attachProject(f)
    const before = await f.api.generateGreeting({ job })
    assert.ok(!before.text.includes('https://'))
    assert.equal(before.projects[0].verified, false)
    const verified = await f.api.verifyPublicProject({ evidenceId: 'app', profileVersion: f.api.profileHistory()[0].id })
    assert.equal(verified.verified, true)
    assert.equal(f.api.greetingCurrent(before, job), false)
    const after = await f.api.generateGreeting({ job })
    assert.ok(after.text.endsWith('开源项目：' + project.url))
    assert.equal(after.projects[0].license, 'Apache-2.0')
    assert.ok(f.calls.some(c => JSON.stringify(c.body).includes(project.limitations)))
    assert.equal(after.readyForAutomation, false)
    assert.throws(() => f.api.validateGreetingDraft({ ...after, text: after.text.replace('github.com', 'evil.example') }, job, f.api.canonicalProfile().evidence, after.projects), /链接/)
    const recordKey = 'atlas-project-verification/' + f.api.fingerprint(project.url)
    const originalVersion = f.api.projectVersion()
    f.api.atlasWrite(recordKey, { ...verified, verifiedAt: new Date(Date.now() - 1000).toISOString() })
    assert.equal(f.api.projectVersion(), originalVersion, 'fresh verification alone must not invalidate every job analysis')
    assert.equal(f.api.greetingCurrent(after, job), true)
    f.api.atlasWrite(recordKey, { ...verified, verifiedAt: '2000-01-01T00:00:00Z' })
    assert.equal(f.api.greetingCurrent(after, job), false)
    assert.ok(!(await f.api.generateGreeting({ job })).text.includes('https://'))
  } finally { f.api.closeAtlas() }
})
test('private or unlicensed projects, forged profile verification, and unconfirmed contributions cannot add links', async () => {
  for (const repo of [{ ...repository, private: true }, { ...repository, license: null }, { ...repository, size: 0 }]) {
    const f = fixture(kind => kind === 'repository' ? repo : normal(kind))
    try {
      attachProject(f)
      const p = f.api.canonicalProfile(); p.evidence[0].project.verified = true; f.save(p)
      const v = await f.api.verifyPublicProject({ evidenceId: 'app', profileVersion: f.api.profileHistory()[0].id })
      assert.equal(v.verified, false)
      assert.ok(!(await f.api.generateGreeting({ job })).text.includes('https://'))
    } finally { f.api.closeAtlas() }
  }
  const f = fixture(kind => kind === 'repository' ? repository : normal(kind))
  try {
    attachProject(f)
    await f.api.verifyPublicProject({ evidenceId: 'app', profileVersion: f.api.profileHistory()[0].id })
    const p = f.api.canonicalProfile(); p.evidence[0].confirmed = false; f.save(p)
    assert.ok(!(await f.api.generateGreeting({ job })).text.includes('https://'))
  } finally { f.api.closeAtlas() }
})
test('a verified project unrelated to the selected experience is not advertised', async () => {
  const f = fixture(kind => kind === 'repository' ? repository : normal(kind))
  try {
    const p = f.api.canonicalProfile(); p.evidence.push({ ...evidence, id: 'other', title: '不相关项目', project })
    f.save(p)
    await f.api.verifyPublicProject({ evidenceId: 'other', profileVersion: f.api.profileHistory()[0].id })
    const result = await f.api.generateGreeting({ job })
    assert.equal(result.projects.length, 0)
    assert.ok(!result.text.includes('https://'))
  } finally { f.api.closeAtlas() }
})
test('project URLs reject internal hosts, credentials, query strings and stale profile versions', async () => {
  const f = fixture(normal)
  try {
    for (const url of ['http://127.0.0.1/repo', 'https://github.com.evil/example/repo', 'https://secret@github.com/example/repo', project.url + '?token=secret', 'https://github.com/example/repo/blob/main/README.md']) {
      const p = f.api.canonicalProfile(); p.evidence[0].project = { ...project, url }
      assert.throws(() => f.save(p))
    }
    attachProject(f)
    await assert.rejects(f.api.verifyPublicProject({ evidenceId: 'app', profileVersion: 'old' }), /资料已变化/)
  } finally { f.api.closeAtlas() }
})
test("greeting agent selects cited facts, reviews, caches, and invalidates changed jobs", async () => {
  const f = fixture(normal);
  try {
    let r = await f.api.generateGreeting({ job });
    assert.equal(r.text, expectedText(f.api));
    assert.equal(r.usage.calls, 2);
    assert.equal(r.readyForAutomation, false);
    assert.equal(f.api.greetingCurrent(r, job), true);
    assert.equal((await f.api.generateGreeting({ job })).cached, true);
    assert.equal(f.calls.length, 2);
    const changed = { ...job, description: job.description + "补充业务场景。" };
    assert.equal(f.api.greetingCurrent(r, changed), false);
    await f.api.generateGreeting({ job: changed });
    assert.equal(f.calls.length, 4);
    assert.ok(
      f.calls.every((c) => !JSON.stringify(c.body).includes("fixture-key")),
    );
  } finally {
    f.api.closeAtlas();
  }
});
test("unconfirmed facts support preview only; automatic preparation requires confirmed evidence", async () => {
  const f = fixture(normal, false);
  try {
    const p = await f.api.generateGreeting({ job });
    assert.equal(p.readyForAutomation, false);
    assert.match(p.reviewReasons.join(), /尚未本人确认/);
    await assert.rejects(
      f.api.generateGreeting({ job, purpose: "automatic" }),
      /尚无已确认/,
    );
    assert.equal(f.calls.length, 2);
    f.save({ ...f.s.state.profile, evidence: [evidence] });
    const r = await f.api.generateGreeting({ job, purpose: "automatic" });
    assert.equal(r.readyForAutomation, true);
  } finally {
    f.api.closeAtlas();
  }
});
test("invented numbers are repaired once before review rather than saved", async () => {
  let writes = 0;
  const f = fixture((kind) => {
    if (kind === "review") return review();
    const d = writer();
    if (++writes === 1) d.opening += "且关注900万用户";
    return d;
  });
  try {
    const r = await f.api.generateGreeting({ job });
    assert.equal(r.text.includes("900万"), false);
    assert.equal(f.calls.length, 3);
    assert.match(JSON.stringify(f.calls[1].body), /没有的数字/);
  } finally {
    f.api.closeAtlas();
  }
});
test("unknown evidence references fail closed after bounded repairs and release the generation lease", async () => {
  const f = fixture(() => ({
    ...writer(),
    matches: [{ ...writer().matches[0], evidenceId: "invented" }],
  }));
  try {
    await assert.rejects(f.api.generateGreeting({ job }), /多轮校验仍未通过/);
    assert.equal(f.calls.length, 3);
    assert.equal(
      f.api
        .atlasDb()
        .prepare(
          "SELECT count(*) n FROM documents WHERE key LIKE 'atlas-greeting-%'",
        )
        .get().n,
      0,
    );
    assert.equal(
      f.api.atlasDb().prepare("SELECT count(*) n FROM leases").get().n,
      0,
    );
  } finally {
    f.api.closeAtlas();
  }
});
test("semantic review can reject unsupported claims and require a revised draft", async () => {
  let reviews = 0;
  const f = fixture((kind) =>
    kind === "write"
      ? writer()
      : ++reviews === 1
        ? { ...review(), grounded: false, issues: ["请保持原文职责边界"] }
        : review(),
  );
  try {
    const r = await f.api.generateGreeting({ job });
    assert.equal(r.quality.grounded, true);
    assert.equal(f.calls.length, 4);
    assert.match(JSON.stringify(f.calls[2].body), /职责边界/);
  } finally {
    f.api.closeAtlas();
  }
});
test("unrelated requirements produce a gap explanation and no fabricated greeting", async () => {
  const f = fixture(() => ({
    decision: "insufficient",
    matches: [],
    text: "",
    gaps: ["未提供CUDA算法研发经历"],
  }));
  try {
    const r = await f.api.generateGreeting({ job });
    assert.equal(r.text, "");
    assert.equal(r.readyForAutomation, false);
    assert.equal(r.usage.calls, 1);
  } finally {
    f.api.closeAtlas();
  }
});
test("profile edits during generation discard stale results while preserving user data", async () => {
  let f;
  f = fixture((kind) => {
    if (kind === "review")
      f.save({ ...f.s.state.profile, headline: "本人刚修改的新定位" });
    return normal(kind);
  });
  try {
    await assert.rejects(f.api.generateGreeting({ job }), /生成期间资料已修改/);
    assert.equal(f.api.canonicalProfile().headline, "本人刚修改的新定位");
    assert.equal(
      f.api
        .atlasDb()
        .prepare(
          "SELECT count(*) n FROM documents WHERE key LIKE 'atlas-greeting-%'",
        )
        .get().n,
      0,
    );
  } finally {
    f.api.closeAtlas();
  }
});
test("two windows coalesce the same request through a lease, without duplicate model calls", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const f = fixture(async (kind) => {
    if (kind === "write") await gate;
    return normal(kind);
  });
  try {
    const first = f.api.generateGreeting({ job });
    await assert.rejects(f.api.generateGreeting({ job }), /正在生成/);
    release();
    await first;
    assert.equal(f.calls.length, 2);
  } finally {
    f.api.closeAtlas();
  }
});
test("quota errors preserve the previous approved draft and never silently use a template", async () => {
  let fail = false;
  const f = fixture((kind) => (fail ? { httpError: 429 } : normal(kind)));
  try {
    const first = await f.api.generateGreeting({ job });
    fail = true;
    await assert.rejects(
      f.api.generateGreeting({ job, refresh: true }),
      /调用受限/,
    );
    assert.equal(
      f.api.atlasRead("atlas-greeting-" + first.id).text,
      first.text,
    );
    assert.equal(f.calls.length, 3);
  } finally {
    f.api.closeAtlas();
  }
});
test("timeouts release leases and keep resume data intact", async () => {
  const f = fixture(
    (_, __, opts) =>
      new Promise((_, reject) =>
        opts.signal.addEventListener("abort", () => reject(Error("abort"))),
      ),
    true,
    { setTimeout: (fn, ms) => setTimeout(fn, ms === 2700000 ? 10 : ms) },
  );
  try {
    await assert.rejects(f.api.generateGreeting({ job }), /超时/);
    assert.equal(f.api.canonicalProfile().resumeText, evidence.text);
    assert.equal(
      f.api.atlasDb().prepare("SELECT count(*) n FROM leases").get().n,
      0,
    );
  } finally {
    f.api.closeAtlas();
  }
});
test("deterministic checks reject wrong coverage scope, invented requirements and commitments", () => {
  const f = fixture(normal);
  try {
    const d = draft();
    assert.throws(
      () =>
        f.api.validateGreetingDraft(
          { ...d, text: d.text + "我接受贵司薪资。" },
          job,
          [evidence],
        ),
      /承诺/,
    );
    assert.throws(
      () =>
        f.api.validateGreetingDraft(
          { ...d, matches: [{ ...d.matches[0], requirement: "要求博士学历" }] },
          job,
          [evidence],
        ),
      /引用无法对应/,
    );
    const e = {
      ...evidence,
      text: "我负责企业平台建设，南京地区员工使用覆盖率达到35%。",
    };
    assert.throws(
      () =>
        f.api.validateGreetingDraft(
          {
            ...d,
            matches: [{ ...d.matches[0], evidenceQuote: e.text }],
            text: "您好，看到贵司关注产品平台建设，我负责过企业平台并主导相关需求分析，目前全国员工覆盖率达到35%，希望进一步沟通贵司的团队目标。",
          },
          job,
          [e],
        ),
      /指标口径/,
    );
  } finally {
    f.api.closeAtlas();
  }
});
test("facts are inserted from saved evidence even if the model tries adding responsibilities", async () => {
  const f = fixture((kind) =>
    kind === "write"
      ? { ...writer(), text: "我还负责CUDA训练和增长运营，业绩提升99%。" }
      : review(),
  );
  try {
    const r = await f.api.generateGreeting({ job });
    assert.equal(r.text, expectedText(f.api));
    assert.doesNotMatch(r.text, /CUDA|99%|增长运营/);
  } finally {
    f.api.closeAtlas();
  }
});
test("one evidence can support two requirements without repeating the self introduction", async () => {
  const f = fixture((kind) =>
    kind === "write"
      ? {
          ...writer(),
          matches: [
            ...writer().matches,
            { ...writer().matches[0], requirementId: "r1" },
          ],
        }
      : review(),
  );
  try {
    const r = await f.api.generateGreeting({ job });
    assert.equal(r.matches.length, 2);
    assert.equal(r.text.split(evidence.text).length - 1, 1);
  } finally {
    f.api.closeAtlas();
  }
});
test("malformed model JSON fails without replacing a prior draft", async () => {
  let broken = false;
  const f = fixture((kind) => (broken ? "{bad-json" : normal(kind)));
  try {
    const first = await f.api.generateGreeting({ job });
    broken = true;
    await assert.rejects(
      f.api.generateGreeting({ job, refresh: true }),
      /格式无效/,
    );
    assert.equal(
      f.api.atlasRead("atlas-greeting-" + first.id).text,
      first.text,
    );
  } finally {
    f.api.closeAtlas();
  }
});
test('overlong selected quotations retain one whole grounded quote and still receive independent review', async () => {
  const one={...evidence,text:evidence.text+'我负责产品定位、需求规划、团队协作与上线验收，并根据用户反馈持续优化业务流程。'.repeat(2)};
  const two={...evidence,id:'second',title:'第二项',text:'我曾统筹多个软件与智能设备的产品规划，组织研发、设计与测试协作，完成版本上线并持续分析用户反馈。'.repeat(2)};
  const f=fixture(kind=>kind==='review'?review():{...writer(),matches:[{...writer().matches[0],evidenceQuote:one.text},{...writer().matches[0],evidenceId:two.id,evidenceQuote:two.text}]});
  try{
    f.save({...f.s.state.profile,evidence:[one,two]});
    const r=await f.api.generateGreeting({job});
    assert.equal(r.matches.length,1);assert.equal(r.matches[0].evidenceQuote,one.text);
    assert.ok(r.text.includes(one.text));assert.ok(r.text.length<=220);assert.equal(r.usage.calls,2);
    const reviewInput=JSON.parse(f.calls.find(x=>x.kind==='review').body.messages[1].content);
    assert.equal(reviewInput.selectedEvidence.length,1);assert.equal(reviewInput.draft.text,r.text);
  }finally{f.api.closeAtlas()}
});

function conversationFixture(f, description = job.description) {
  const account = { id: 'conversation-account', name: '测试账号' };
  f.api.saveBossSnapshot({account,items:[{bossId:'boss',bossName:'招聘者',companyName:job.companyName,encryptJobId:'job',jobName:job.jobName,lastText:'您好',lastIsSelf:true}]});
  f.api.ingestBossJobs(account.id,{code:0,zpData:{jobInfo:{encryptId:'job',jobName:job.jobName,postDescription:description,address:job.address,salaryDesc:'40-60K'},bossInfo:{encryptBossId:'boss'},brandComInfo:{encryptBrandId:'company',brandName:job.companyName}}},'/wapi/zpgeek/job/detail.json');
  f.api.saveBossSnapshot({account,items:[],conversation:{bossId:'boss',identityVerified:true,messages:[{mid:'outgoing',isSelf:true,type:'text',text:'您好，期待沟通。',time:Date.now()-10000}]}});
  return {accountId:account.id,bossId:'boss',jobId:'job'};
}
test('conversation pitch uses canonical JD and confirmed experience without an incoming message; reuses audited cache',async()=>{
 const f=fixture(normal);try{const input=conversationFixture(f),ctx=f.api.conversationPitchContext(input);assert.equal(ctx.ready,true);const result=await f.api.conversationPitch({...input,baseBasis:ctx.basis,job:{description:'伪造招聘要求'}});assert.equal(result.purpose,'conversation');assert.equal(result.readyForAutomation,false);assert.equal(result.matches[0].evidenceTitle,evidence.title);assert.equal(result.matches[0].evidenceQuote,evidence.text);assert.ok(result.text.includes(evidence.text));assert.equal(f.calls.length,2);const request=JSON.parse(f.calls[0].body.messages[1].content);assert.equal(request.job.description,job.description);assert.equal(request.conversationContext.messages.length,1);assert.equal(request.conversationContext.messages[0].direction,'sent');assert.ok(f.calls[0].body.messages[0].content.includes('已有会话'));const cached=await f.api.conversationPitch({...input,baseBasis:ctx.basis});assert.equal(cached.cached,true);assert.equal(f.calls.length,2)}finally{f.api.closeAtlas()}
});
test('conversation pitch rejects another account, unlinked job and stale basis before any paid call',async()=>{
 const f=fixture(normal);try{const input=conversationFixture(f);assert.throws(()=>f.api.conversationPitchContext({...input,accountId:'another'}),/账号已变化/);assert.throws(()=>f.api.conversationPitchContext({...input,jobId:'unlinked'}),/不属于/);await assert.rejects(f.api.conversationPitch({...input,baseBasis:'outdated'}),/已更新/);assert.equal(f.calls.length,0)}finally{f.api.closeAtlas()}
});
test('conversation pitch requires complete JD and confirmed experience',async()=>{
 const f=fixture(normal,false);try{const input=conversationFixture(f);assert.match(f.api.conversationPitchContext(input).reason,/已确认/);await assert.rejects(f.api.conversationPitch({...input,baseBasis:f.api.conversationPitchContext(input).basis}),/已确认/);conversationFixture(f,'产品岗位');assert.match(f.api.conversationPitchContext(input).reason,/JD 尚未补齐/);assert.equal(f.calls.length,0)}finally{f.api.closeAtlas()}
});
test('conversation pitch requires an explicit job when a conversation links multiple positions',()=>{
 const f=fixture(normal);try{const input=conversationFixture(f);f.api.ingestBossJobs(input.accountId,{code:0,zpData:{jobInfo:{encryptId:'job-two',jobName:'第二岗位',postDescription:job.description},bossInfo:{encryptBossId:'boss'},brandComInfo:{encryptBrandId:'company',brandName:job.companyName}}},'/wapi/zpgeek/job/detail.json');f.api.atlasDb().prepare("UPDATE platform_conversations SET body=json_set(body,'$.jobIds',json(?)) WHERE account_id=? AND source_id=?").run(JSON.stringify(['job','job-two']),input.accountId,input.bossId);const ctx=f.api.conversationPitchContext({...input,jobId:''});assert.equal(ctx.ready,false);assert.match(ctx.reason,/多个岗位/)}finally{f.api.closeAtlas()}
});
test('a new conversation message invalidates pitch cache and blocks an in-flight stale result',async()=>{
 let change=false;let f;f=fixture((kind)=>{if(kind==='review'&&change){f.api.saveBossSnapshot({account:{id:'conversation-account',name:'测试账号'},items:[],conversation:{bossId:'boss',identityVerified:true,messages:[{mid:'new-incoming',isSelf:false,type:'text',text:'目前更关心团队协作',time:Date.now()}]}})}return normal(kind)});try{const input=conversationFixture(f),ctx=f.api.conversationPitchContext(input);change=true;await assert.rejects(f.api.conversationPitch({...input,baseBasis:ctx.basis}),/会话发生变化/);change=false;const next=f.api.conversationPitchContext(input);assert.notEqual(next.basis,ctx.basis);await f.api.conversationPitch({...input,baseBasis:next.basis});assert.equal(f.calls.length,4)}finally{f.api.closeAtlas()}
});
test('insufficient JD experience produces gaps, never a generic pitch',async()=>{
 const f=fixture(()=>({decision:'insufficient',matches:[],opening:'',closing:'',gaps:['经历不能直接对应本岗位']}));try{const input=conversationFixture(f),ctx=f.api.conversationPitchContext(input),result=await f.api.conversationPitch({...input,baseBasis:ctx.basis});assert.equal(result.text,'');assert.equal(result.decision,'insufficient');assert.match(result.reason,/不能直接对应/);assert.equal(f.calls.length,1)}finally{f.api.closeAtlas()}
});

test('DOM job without company name resolves the company only from its linked conversation',async()=>{
 const f=fixture(normal);try{const input=conversationFixture(f);f.api.atlasDb().prepare("UPDATE platform_jobs SET body=json_remove(body,'$.companyName') WHERE account_id=? AND source_id=?").run(input.accountId,input.jobId);const ctx=f.api.conversationPitchContext(input);assert.equal(ctx.ready,true);assert.equal(ctx.companyName,job.companyName);assert.equal(ctx.companySource,'conversation');const result=await f.api.conversationPitch({...input,baseBasis:ctx.basis});assert.equal(result.job.companyName,job.companyName)}finally{f.api.closeAtlas()}
});


test('source excerpts are separated into readable sentences without changing factual words', () => {
 const f=fixture(normal);try{
  const text=f.api.composeGreeting('您好，岗位关注AI产品规划',['负责企业平台规划、反馈评测','统筹需求评审与上线，'],'方便进一步交流吗？');
  assert.equal(text,'您好，岗位关注AI产品规划。负责企业平台规划、反馈评测。另外，统筹需求评审与上线。方便进一步交流吗？');
  assert.equal(f.api.composeGreeting('您好。',['负责平台上线。','负责平台上线。'],'期待交流。'),'您好。负责平台上线。期待交流。');
 }finally{f.api.closeAtlas()}
});
test('opening questions are rejected and repaired before review, preserving the single closing invitation',async()=>{
 let attempts=0;
 const f=fixture(kind=>kind==='review'?review():{...writer(),opening:++attempts===1?'您好，想先了解团队当前的业务重点与产品落地阶段':writer().opening});
 try{const result=await f.api.generateGreeting({job});assert.equal(result.usage.calls,3);assert.ok(!result.text.includes('想先了解'));assert.ok(result.text.split('？').length-1<=1)}finally{f.api.closeAtlas()}
});

test('automatic greeting refreshes public project verification and includes the relevant GitHub URL',async()=>{
  const f=fixture(kind=>kind==='repository'?repository:normal(kind));
  try {attachProject(f);const r=await f.api.generateGreeting({job,purpose:'automatic'});
    assert.equal(r.readyForAutomation,true);assert.ok(r.text.endsWith('开源项目：'+project.url));assert.ok(r.text.length<=220);
  }finally{f.api.closeAtlas()}
});
test('automatic greeting does not silently omit a project whose public visibility cannot be verified',async()=>{
  const f=fixture(kind=>kind==='repository'?{...repository,private:true}:normal(kind));
  try {attachProject(f);await assert.rejects(f.api.generateGreeting({job,purpose:'automatic'}),/项目链接待核实/);assert.equal(f.calls.length,0)}finally{f.api.closeAtlas()}
});
test('project link space is reserved during repair rather than dropping the URL on long greetings',async()=>{
  let attempts=0;
  const f=fixture(kind=>{
    if(kind==='repository')return repository;if(kind==='review')return review();
    const v=writer();v.matches[0].evidenceQuote=attempts++===0?evidence.text+'我负责用户研究与产品规划。'.repeat(10):evidence.text;return v;
  });
  try{attachProject(f);let p=f.api.canonicalProfile();p.evidence[0].text=evidence.text+'我负责用户研究与产品规划。'.repeat(10);f.save(p);p=f.api.canonicalProfile();p.evidence[0].confirmed=true;f.save(p);
    const r=await f.api.generateGreeting({job,purpose:'automatic'});assert.ok(r.text.endsWith('开源项目：'+project.url));assert.ok(r.text.length<=220);assert.equal(attempts,2);
  }finally{f.api.closeAtlas()}
});

test('first greeting can end after its relevant evidence without any automatic question', async () => {
  const f=fixture(kind=>kind==='write'?{...writer(),closing:'none'}:review());
  try {
    const r=await f.api.generateGreeting({job});
    assert.equal(r.text,f.api.composeGreeting(writer().opening,[evidence.text],''));
    assert.doesNotMatch(r.text,/方便介绍|团队情况|[?？]/);
  } finally {f.api.closeAtlas()}
});
test('conversation introduction does not append another invitation even if model selects discuss', async () => {
  const f=fixture(normal);
  try {
    const r=await f.api.generateGreeting({job,purpose:'conversation',conversationContext:{accountId:'fixture',bossId:'fixture',messages:[]}});
    assert.equal(r.text,f.api.composeGreeting(writer().opening,[evidence.text],''));
    for(const key of ['scope','priorities'])assert.equal(f.api.pickGreetingEnding(key,job),'');
  } finally {f.api.closeAtlas()}
});
