const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  vm = require("node:vm"),
  { buildSync } = require("esbuild");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-contact-")),
  bundle = path.join(root, "api.cjs");
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents:
      [
        "atlas-store",
        "atlas-profile",
        "atlas-contact",
        "atlas-discovery",
        "atlas-discovery-state",
        "atlas-policy",
        "atlas-tasks",
        "atlas-greeting",
        "atlas-ai",
        "atlas-boss-sync",
        "career-boss-data",
        "atlas-backup",
        "atlas-service",
      ]
        .map((n) => `export * from './packages/ui/src/main/features/${n}'`)
        .join("\n") +
      "\nexport * from './packages/ui/src/common/contact'\nexport * from './packages/ui/src/common/career'",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});
process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
const jd =
  "负责App产品规划与用户需求分析，主导多产品融合和产品上线落地，负责跨团队协作及业务指标分析。制定产品路线图并根据用户反馈持续迭代。熟悉用户体验设计和商业目标拆解，能够把复杂场景转化为清晰的需求与产品方案。";
function fixture() {
  const home = fs.mkdtempSync(path.join(root, "home-")),
    m = { exports: {} };
  let calls = 0,
    override;
  const fetch = async (_url, opts) => {
    calls++;
    const payload = JSON.parse(opts.body),
      data = JSON.parse(payload.messages[1].content);
    const value = override
      ? override(data)
      : data.draft
        ? {
            grounded: true,
            relevant: true,
            concise: true,
            noCommitments: true,
            issues: [],
          }
        : {
            decision: "draft",
            opening: "您好，关注到贵司重视App产品规划与多产品融合",
            closing: "discuss",
            matches: [
              {
                requirementId: "r0",
                evidenceId: "e1",
                evidenceQuote:
                  "我主导 App 多产品融合、产品规划与需求分析，并推动业务上线落地。",
                relevance: "多产品融合与规划经历对应当前岗位的业务需求。",
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
        usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
      }),
    };
  };
  vm.runInNewContext(
    "(function(require,module,exports){" +
      fs.readFileSync(bundle, "utf8") +
      "\n})",
    {
      Buffer,
      process: { ...process, env: { ...process.env, ATLAS_DATA_ROOT: home } },
      Date,
      URL,
      fetch,
      AbortController,
      AbortSignal,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    },
  )(require, m, m.exports);
  const a = m.exports;
  fs.mkdirSync(path.join(home, "config"), { recursive: true });
  fs.writeFileSync(
    path.join(home, "config/llm.json"),
    JSON.stringify([
      {
        enabled: true,
        model: "deepseek-flash",
        providerApiSecret: "test-fixture-only",
        providerCompleteApiUrl: "https://api.deepseek.com/chat/completions",
      },
    ]),
  );
  const state = a.emptyCareerState();
  state.profile = {
    name: "隔离测试",
    headline: "产品负责人",
    summary: "",
    resumeText: "",
    targetRoles: ["App产品负责人"],
    preferredCities: ["上海"],
    minimumMonthlyK: 40,
    evidence: [
      {
        id: "e1",
        title: "产品规划",
        text: "我主导 App 多产品融合、产品规划与需求分析，并推动业务上线落地。",
        keywords: ["App", "产品规划"],
        source: "隔离测试已确认经历",
        confirmed: true,
      },
      {
        id: "e2",
        title: "需求分析",
        text: "我负责用户需求分析，协调设计与研发团队落地产品方案。",
        keywords: ["用户需求"],
        source: "隔离测试",
        confirmed: true,
      },
    ],
  };
  a.atlasWrite("career-workspace.json", state);
  a.canonicalProfile();
  a.initializePolicy();
  a.atlasWrite("career-boss-sync.json", {
    account: { id: "a", name: "测试账号" },
    items: [],
  });
  a.atlasWrite("atlas-contact-authorization", { accountId: "a" });
  a.setRuntime({ paused: false, outbound: true, startHour: 0, endHour: 23 });
  a.setAllAutomationPaused(false);
  function job(id = "j", boss = "b", extra = {}) {
    const j = {
      encryptJobId: id,
      encryptBossId: boss,
      encryptCompanyId: "c",
      jobName: "App产品负责人",
      companyName: "隔离测试企业",
      description: jd,
      address: "上海市徐汇区",
      cityName: "上海",
      salaryDesc: "40-60K",
      salaryHigh: 60,
      salaryLow: 40,
      ...extra,
    };
    a.atlasDb()
      .prepare("INSERT OR REPLACE INTO platform_jobs VALUES('boss',?,?,?,?,?)")
      .run(
        "a",
        id,
        JSON.stringify(j),
        new Date().toISOString(),
        new Date().toISOString(),
      );
    analysis(j);
    return j;
  }
  function analysis(j, extra = {}) {
    a.atlasWrite(a.discoveryItemKey("a", j.encryptJobId), {
      accountId: "a",
      jobId: j.encryptJobId,
      status: "new",
      analysisBasis: a.contactJobBasis(j),
      analysis: {
        profileVersion: a.profileHistory()[0].id,
        model: "deepseek-flash",
        promptVersion: a.currentAnalysisPromptVersion(),
        analysis: {
          businessGoal: "产品落地",
          requirements: [
            {
              requirement: "产品规划与用户需求分析",
              essential: true,
              status: "met",
              evidenceIds: ["e1"],
              assessment: "已确认的产品规划经历",
            },
          ],
          recommendation: {
            decision: "consider",
            reason: "相关经历充分",
            nextStep: "联系",
          },
          ...extra,
        },
      },
    });
  }
  return {
    a,
    home,
    state,
    job,
    analysis,
    calls: () => calls,
    setFetch: (fn) => (override = fn),
    close: () => a.closeAtlas(),
  };
}
const noon = () =>
  Date.parse(
    new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }) +
      "T12:00:00+08:00",
  );
function proof(row, text = "平台默认招呼", at = Date.now()) {
  return {
    accountId: "a",
    recruiterId: row.recruiter_id,
    conversationId: row.recruiter_id,
    jobId: row.job_id,
    messageId: "m-" + Math.random(),
    text,
    sentAt: new Date(at).toISOString(),
  };
}
function prepare(f, j) {
  const { a } = f,
    id = a.enqueueContact("a", j).id;
  return a.contactRun(id);
}

async function approved(f, j) {
  const row = await f.a.prepareContact({ accountId: 'a', jobId: j.encryptJobId });
  assert.equal(row.state, 'awaiting_confirmation');
  return f.a.contactAction({ accountId: 'a', id: row.id, revision: row.revision,
    action: 'approve', text: row.body.greeting.text, confirmed: true });
}

test("one eligibility gate accepts confirmed evidence and both allowed recommendations", () => {
  const f = fixture(),
    j = f.job();
  assert.equal(f.a.contactMatch(j).eligible, true);
  f.analysis(j, { recommendation: { decision: "prioritize" } });
  assert.equal(f.a.contactMatch(j).eligible, true);
  for (const decision of ["verify", "skip"]) {
    f.analysis(j, { recommendation: { decision } });
    assert.equal(f.a.contactMatch(j).eligible, false);
  }
  f.close();
});
test("salary, city, missing recruiter and unconfirmed evidence cannot be overridden by AI", () => {
  const f = fixture();
  for (const extra of [
    { salaryHigh: 39 },
    { salaryHigh: null },
    { cityName: "北京", address: "北京" },
    { encryptBossId: "" },
  ])
    assert.equal(f.a.contactMatch(f.job("j", "b", extra)).eligible, false);
  const j = f.job();
  f.state.profile.evidence.forEach((e) => (e.confirmed = false));
  f.a.atlasWrite("career-workspace.json", f.state);
  f.analysis(j);
  assert.equal(f.a.contactMatch(j).eligible, false);
  f.close();
});
test("degree and experience are checked against confirmed facts, preferences are not blanket blocked", () => {
  const f = fixture();
  let j = f.job("j", "b", {
    degreeName: "本科",
    experienceName: "产品经验5年以上",
  });
  assert.equal(f.a.contactMatch(j).eligible, false);
  f.state.profile.qualifications = [
    {
      id: "degree",
      kind: "education",
      label: "学历",
      value: "全日制本科",
      confirmed: true,
      source: "本人核实",
    },
    {
      id: "years",
      kind: "experience",
      label: "产品经验",
      value: "8年",
      confirmed: true,
      source: "本人核实",
    },
  ];
  f.a.atlasWrite("career-workspace.json", f.state);
  f.analysis(j);
  assert.equal(f.a.contactMatch(j).eligible, true);
  j = f.job("j", "b", { degreeName: "硕士" });
  assert.equal(f.a.contactMatch(j).status, "excluded");
  j = f.job("j", "b", { description: jd + "硕士优先；管理经验3年优先。" });
  assert.equal(f.a.contactMatch(j).eligible, true);
  f.close();
});
test("unknown evidence, essential gaps and outdated analyses never enter contact queue", () => {
  const f = fixture(),
    j = f.job();
  f.analysis(j, {
    requirements: [
      {
        essential: true,
        status: "met",
        evidenceIds: ["invented"],
        requirement: "行业经验",
      },
    ],
  });
  assert.equal(f.a.contactMatch(j).eligible, false);
  f.analysis(j, {
    requirements: [
      {
        essential: true,
        status: "gap",
        evidenceIds: [],
        requirement: "行业经验",
      },
    ],
  });
  assert.equal(f.a.contactMatch(j).status, "excluded");
  f.analysis(j);
  j.description += "要求变化";
  assert.equal(f.a.contactMatch(j).fresh, false);
  f.close();
});
test("same recruiter deduplicates across jobs; different recruiters at one company remain separate", () => {
  const f = fixture(),
    a = f.a,
    j = f.job(),
    one = a.enqueueContact("a", j);
  assert.equal(one.created, true);
  assert.equal(a.enqueueContact("a", j).reused, true);
  assert.equal(a.enqueueContact("a", f.job("j2", "b")).id, one.id);
  assert.equal(a.enqueueContact("a", f.job("j3", "b2")).created, true);
  const related=a.atlasDb().prepare("SELECT body FROM opportunities WHERE id=?").get("boss:a:job:j2");
  assert.equal(JSON.parse(related.body).stage,"待评估");
  assert.equal(a.contactSummary().counts.completed,0);
  assert.equal(
    a.atlasDb().prepare("select count(*) n from contact_runs").get().n,
    2,
  );
  f.close();
});
test("existing conversations are routed to communication, not a new introduction", () => {
  const f = fixture(),
    j = f.job();
  f.a.saveBossSnapshot({
    account: { id: "a", name: "测试" },
    items: [{ bossId: "b", encryptJobId: "j", jobName: j.jobName }],
  });
  assert.match(f.a.enqueueContact("a", j).blocked[0], /已有会话/);
  f.close();
});
test("double-message reservations consume the shared cap and a duplicate reservation is idempotent", () => {
  const f = fixture(),
    a = f.a,
    r = prepare(f, f.job()),
    r2 = prepare(f, f.job("j2", "b2"));
  a.setRuntime({ dailyLimit: 2, firstContactLimit: 2 });
  const now = noon();
  assert.equal(a.reserveContact(r.id, 2, now), "");
  assert.equal(a.reserveContact(r.id, 2, now), "");
  assert.equal(a.contactQuota(now).reserved, 2);
  assert.match(a.reserveContact(r2.id, 1, now), /额度/);
  assert.match(
    a.claimSend(
      {
        id: "reply",
        platform: "boss",
        accountId: "a",
        recipientId: "other",
        kind: "reply",
        automatic: true,
        text: "回复",
      },
      now,
    ),
    /上限/,
  );
  f.close();
});
test("default greeting does not count as completion, matching text readback completes and links opportunity", async () => {
  const f = fixture(),
    a = f.a,
    now = noon(),
    r = await approved(f, f.job());
  assert.equal(a.reserveContact(r.id, 2, now), "");
  a.claimContactSend(r, "[平台默认招呼，等待回读]", "default", now);
  let next = a.verifyContactSend(r.id, proof(r, "您好", now), now);
  assert.equal(next.state, "cooling");
  assert.equal(a.contactSummary({ period: "all" }).counts.completed, 0);
  assert.equal(a.contactQuota(now).used, 1);
  assert.equal(a.contactQuota(now).reserved, 1);
  a.claimContactSend(next, r.body.greeting.text, "personalized", now + 600001);
  assert.throws(
    () =>
      a.verifyContactSend(
        r.id,
        proof(r, "其他内容", now + 600001),
        now + 600001,
      ),
    /未能核验/,
  );
  next = a.verifyContactSend(
    r.id,
    proof(r, r.body.greeting.text, now + 600001),
    now + 600001,
  );
  assert.equal(next.state, "completed");
  assert.equal(a.contactQuota(now).used, 2);
  assert.equal(a.contactQuota(now).reserved, 0);
  assert.equal(a.contactSummary({ period: "all" }).counts.completed, 1);
  assert.equal(
    JSON.parse(a.atlasDb().prepare("select body from opportunities").get().body)
      .stage,
    "已沟通",
  );
  f.close();
});
test("cooldown and insufficient end-of-day window prevent the second or partial send", async () => {
  const f = fixture(),
    a = f.a,
    r = await approved(f, f.job()),
    now = noon();
  a.setRuntime({ startHour: 9, endHour: 21 });
  assert.match(
    a.reserveContact(
      r.id,
      2,
      Date.parse(
        new Date(now).toLocaleDateString("sv-SE", {
          timeZone: "Asia/Shanghai",
        }) + "T20:55:00+08:00",
      ),
    ),
    /时段/,
  );
  a.reserveContact(r.id, 2, now);
  a.claimContactSend(r, "默认", "default", now);
  const next = a.verifyContactSend(r.id, proof(r, "默认", now), now);
  assert.throws(
    () => a.claimContactSend(next, r.body.greeting.text, "personalized", now + 1000),
    /冷却/,
  );
  assert.equal(a.contactQuota(now).reserved, 1);
  f.close();
});
test("wrong account, conversation, message id and time cannot verify a send", async () => {
  const f = fixture(),
    a = f.a,
    r = await approved(f, f.job()),
    now = noon();
  a.reserveContact(r.id, 1, now);
  a.claimContactSend(r, r.body.greeting.text, "personalized", now);
  for (const patch of [
    { accountId: "other" },
    { conversationId: "other" },
    { messageId: "" },
    { sentAt: new Date(now - 10000).toISOString() },
  ])
    assert.throws(
      () =>
        a.verifyContactSend(r.id, { ...proof(r, r.body.greeting.text, now), ...patch }, now),
      /未能核验/,
    );
  f.close();
});
test("full executor generates grounded text and only marks completed after adapter readback", async () => {
  const f = fixture(),
    a = f.a,
    r = await approved(f, f.job());
  let sends = 0;
  await a.contactTick({
    inspect: async () => ({ mode: "direct" }),
    send: async (row) => {
      sends++;
      return proof(row, row.body.greeting.text);
    },
    open: async () => {
      throw Error("unexpected");
    },
  });
  assert.equal(a.contactRun(r.id).state, "completed");
  assert.equal(sends, 1);
  assert.equal(f.calls(), 2);
  await a.contactTick({
    inspect: async () => {
      throw Error("must not inspect twice");
    },
  });
  assert.equal(sends, 1);
  f.close();
});
test("two simultaneous ticks cannot generate or send twice", async () => {
  const f = fixture(),
    a = f.a,
    r = await approved(f, f.job());
  let sends = 0;
  const adapter = {
    inspect: async () => ({ mode: "direct" }),
    send: async (row) => {
      sends++;
      return proof(row, row.body.greeting.text);
    },
  };
  await Promise.all([a.contactTick(adapter), a.contactTick(adapter)]);
  assert.equal(sends, 1);
  assert.equal(a.contactRun(r.id).state, "completed");
  f.close();
});
test("user draft stops operation; no platform send or quota consumption occurs", async () => {
  const f = fixture(),
    a = f.a,
    r = await approved(f, f.job());
  await a.contactTick({
    inspect: async () => ({ mode: "direct", draft: "本人正在写" }),
  });
  assert.equal(a.contactRun(r.id).state, "review");
  assert.equal(
    a.atlasDb().prepare("select count(*) n from send_attempts").get().n,
    0,
  );
  f.close();
});
test("timeout after send attempt stays uncertain and cannot be automatically retried", async () => {
  const f = fixture(),
    a = f.a,
    r = await approved(f, f.job());
  let sends = 0;
  const adapter = {
    inspect: async () => ({ mode: "direct" }),
    send: async () => {
      sends++;
      throw Error("timeout");
    },
  };
  await a.contactTick(adapter);
  assert.equal(a.contactRun(r.id).state, "uncertain");
  await a.contactTick(adapter);
  assert.equal(sends, 1);
  assert.equal(a.contactSummary().counts.completed, 0);
  const row = a.contactRun(r.id);
  a.contactAction({
    accountId: "a",
    id: r.id,
    revision: row.revision,
    action: "sent",
  });
  assert.equal(a.contactRun(r.id).state, "manual");
  assert.equal(a.contactSummary().counts.manual, 1);
  assert.equal(a.contactSummary().counts.completed, 0);
  f.close();
});
test("global pause and send pause prevent model generation and all new sends", async () => {
  const f = fixture(),
    a = f.a,
    r = prepare(f, f.job());
  a.setRuntime({ paused: true });
  await a.contactTick({
    inspect: async () => {
      throw Error("must not inspect");
    },
  });
  assert.equal(f.calls(), 0);
  a.setRuntime({ paused: false });
  a.setAllAutomationPaused(true);
  await a.contactTick({});
  assert.equal(a.contactRun(r.id).state, "queued");
  assert.equal(f.calls(), 0);
  f.close();
});
test("pause during AI or inspection prevents new platform actions", async () => {
  const f = fixture(),
    a = f.a,
    r = await approved(f, f.job());
  await a.contactTick({
    inspect: async () => {
      a.setRuntime({ paused: true });
      return { mode: "direct" };
    },
    send: async () => {
      throw Error("must not send");
    },
  });
  assert.equal(
    a.atlasDb().prepare("select count(*) n from send_attempts").get().n,
    0,
  );
  assert.equal(a.contactRun(r.id).state, "ready");
  f.close();
});
test("restoring contact history excludes reservations and starts paused without promoting success", () => {
  const f = fixture(),
    a = f.a,
    r = prepare(f, f.job());
  a.reserveContact(r.id, 2, noon());
  const backup = a.exportEncryptedBackup("isolated-password-123"),
    archive = a.inspectBackup({
      password: "isolated-password-123",
      base64: backup.base64,
    });
  assert.equal(archive.tables.contact_runs.length, 1);
  assert.equal(archive.tables.contact_reservations, undefined);
  a.setRuntime({ paused: true });
  a.restoreEncryptedBackup({
    password: "isolated-password-123",
    base64: backup.base64,
    confirm: true,
  });
  assert.equal(a.runtimePolicy().paused, true);
  assert.equal(
    a.atlasDb().prepare("select count(*) n from contact_reservations").get().n,
    0,
  );
  assert.equal(a.contactRun(r.id).state, "review");
  f.close();
});
test("same source repeated snapshots do not inflate source observations; cross-source duplicates are recorded", () => {
  const f = fixture(),
    a = f.a,
    payload = {
      code: 0,
      zpData: {
        jobList: [
          {
            encryptId: "source",
            jobName: "App产品负责人",
            brandName: "企业",
            encryptUserId: "boss",
          },
        ],
      },
    };
  a.ingestBossJobs("a", payload, "/wapi/zpgeek/search/joblist.json");
  a.ingestBossJobs("a", payload, "/wapi/zpgeek/search/joblist.json");
  a.ingestBossJobs("a", payload, "/wapi/zpgeek/pc/recommend/job/list.json");
  const rows = a.atlasDb().prepare("select * from job_observations").all();
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.change_kind === "new").length, 1);
  assert.equal(rows.filter((r) => r.change_kind === "duplicate").length, 1);
  f.close();
});

test("account authorization cannot silently transfer when a different account logs in", async () => {
  const f = fixture(),
    a = f.a;
  prepare(f, f.job());
  a.atlasWrite("atlas-contact-authorization", { accountId: "different" });
  await a.contactTick({
    inspect: async () => {
      throw Error("must not inspect");
    },
  });
  assert.equal(f.calls(), 0);
  assert.equal(a.contactSummary().authorized, false);
  f.close();
});
test("profile changes during page inspection invalidate the prepared greeting before clicking", async () => {
  const f = fixture(),
    a = f.a,
    r = await approved(f, f.job());
  await a.contactTick({
    inspect: async () => {
      f.state.profile.summary = "updated";
      a.atlasWrite("career-workspace.json", f.state);
      f.analysis(f.job());
      return { mode: "direct" };
    },
    send: async () => {
      throw Error("must not send");
    },
  });
  assert.equal(
    a.atlasDb().prepare("select count(*) n from send_attempts").get().n,
    0,
  );
  assert.equal(a.contactRun(r.id).state, "failed");
  f.close();
});

test("negative or progressed feedback blocks new first-contact regardless of AI recommendation", () => {
  const f = fixture(),
    a = f.a,
    j = f.job();
  for (const action of ["irrelevant", "ended", "progressed"]) {
    a.atlasWrite("atlas-feedback/" + a.fingerprint(["a", j.encryptJobId]), {
      action,
    });
    assert.equal(a.contactMatch(j).eligible, false);
    assert.ok(a.enqueueContact("a", j).blocked.length);
  }
  f.close();
});


test("outcome charts filter exactly their cohorts while pending includes older stock", () => {
 const f=fixture(),a=f.a,first=prepare(f,f.job('one','b1')),second=prepare(f,f.job('two','b2'));
 a.atlasDb().prepare("UPDATE contact_runs SET state='completed',body=json_set(body,'$.openedAt',?,'$.proof.sentAt',?) WHERE id=?").run(new Date().toISOString(),'2026-01-01T00:00:00Z',first.id);
 a.atlasDb().prepare("UPDATE contact_runs SET created_at='2020-01-01',state='ready' WHERE id=?").run(second.id);
 a.atlasDb().prepare("INSERT INTO platform_messages VALUES('boss','a','b1','reply',?,?,?)").run(JSON.stringify({direction:'received',type:'text',text:'您好'}),'2026-09-17T01:00:00Z',new Date().toISOString());
 assert.equal(a.contactResults({filter:'opened'}).total,1);
 assert.equal(a.contactResults({filter:'replied'}).total,1);
 assert.equal(a.contactResults({filter:'interviews'}).total,0);
 assert.equal(a.contactResults({filter:'pending'}).total,1);
 assert.equal(a.contactSummary().counts.replied,1);
 f.close();
});
test('generic tenure cannot satisfy AI tenure and preferred major cannot hide required degree', () => {
  const f=fixture();
  f.state.profile.qualifications=[{id:'years',kind:'experience',label:'产品经验',value:'10年以上产品经验（不等同AI专项经验年限）',confirmed:true,source:'本人简历'}];
  f.a.atlasWrite('career-workspace.json',f.state);
  const j=f.job('scope','boss',{experienceName:'5-10年',description:jd+'任职要求：3年以上AI产品经验；本科及以上学历，计算机专业优先。'});
  const checks=f.a.contactBaseMatch(j,f.state.profile);
  assert.equal(checks.find(c=>c.label==='必要 AI 相关经验').status,'verify');
  assert.equal(checks.find(c=>c.key==='degree').status,'verify');
  assert.equal(checks.find(c=>c.key==='experience').status,'met');
  assert.equal(f.a.contactMatch(j).eligible,false);
  f.close();
});

 test('generated first-contact wording cannot reach the platform until exact persisted approval', async () => {
  const f=fixture(), a=f.a, r=prepare(f,f.job()); let touches=0;
  const adapter={inspect:async()=>{touches++;return {mode:'direct'}},send:async row=>proof(row,row.body.greeting.text)};
  await a.contactTick(adapter); let row=a.contactRun(r.id);
  assert.equal(row.state,'awaiting_confirmation'); assert.equal(touches,0); assert.equal(f.calls(),2);
  await a.contactTick(adapter); assert.equal(touches,0); assert.equal(f.calls(),2);
  a.reserveContact(r.id,1,noon());
  assert.throws(()=>a.claimContactSend(row,row.body.greeting.text,'personalized',noon()),/尚未经本人确认/);
  assert.throws(()=>a.contactAction({accountId:'a',id:r.id,revision:row.revision,action:'approve',text:'tampered',confirmed:true}),/核对/);
  a.contactAction({accountId:'a',id:r.id,revision:row.revision,action:'approve',text:row.body.greeting.text,confirmed:true});
  assert.throws(()=>a.contactAction({accountId:'a',id:r.id,revision:row.revision,action:'approve',text:row.body.greeting.text,confirmed:true}),/已更新/);
  await a.contactTick(adapter); assert.equal(touches,1); assert.equal(a.contactRun(r.id).state,'completed'); f.close();
 });
 test('explicit wording preparation preserves send pause and confirmation expires on content change',async()=>{
  const f=fixture(),a=f.a,j=f.job();a.setRuntime({paused:true});
  const row=await a.prepareContact({accountId:'a',jobId:j.encryptJobId});assert.equal(a.runtimePolicy().paused,true);
  assert.equal(row.state,'awaiting_confirmation');assert.equal(a.atlasDb().prepare('SELECT count(*) n FROM send_attempts').get().n,0);
  const approved=a.contactAction({accountId:'a',id:row.id,revision:row.revision,action:'approve',text:row.body.greeting.text,confirmed:true});
  assert.equal(a.contactApprovalCurrent(approved),true);approved.body.greeting.text+='changed';
  a.atlasDb().prepare('UPDATE contact_runs SET body=? WHERE id=?').run(JSON.stringify(approved.body),row.id);
  assert.equal(a.contactApprovalCurrent(a.contactRun(row.id)),false);
  assert.throws(()=>a.claimContactSend(approved,approved.body.greeting.text,'personalized'),/尚未经本人确认/);f.close();
 });
 test('approval rejects changed profile and obsolete analysis without promoting the task',async()=>{
  const f=fixture(),a=f.a,j=f.job(),row=await a.prepareContact({accountId:'a',jobId:j.encryptJobId});
  f.state.profile.summary='changed';a.atlasWrite('career-workspace.json',f.state);
  assert.throws(()=>a.contactAction({accountId:'a',id:row.id,revision:row.revision,action:'approve',text:row.body.greeting.text,confirmed:true}),/变化/);
  assert.equal(a.contactRun(row.id).state,'awaiting_confirmation');f.close();
 });

test('non-full-time undergraduate never satisfies full-time requirement hidden behind metadata',()=>{
 const f=fixture(),a=f.a;
 f.state.profile.qualifications=[{id:'edu',kind:'education',label:'学历',value:'本科，非全日制',confirmed:true,source:'已登录本人BOSS资料'}];
 a.atlasWrite('career-workspace.json',f.state);
 let j=f.job('full','boss',{degreeName:'本科',description:jd+'必须具备全日制本科以上学历。'});
 assert.equal(a.contactMatch(j).checks.find(x=>x.key==='degree').status,'gap');
 j=f.job('part','boss2',{degreeName:'本科'});assert.equal(a.contactMatch(j).checks.find(x=>x.key==='degree').status,'met');
 f.state.profile.qualifications[0].value='本科';a.atlasWrite('career-workspace.json',f.state);
 j=f.job('unknown','boss3',{degreeName:'本科',description:jd+'要求全日制本科。'});assert.equal(a.contactMatch(j).checks.find(x=>x.key==='degree').status,'verify');f.close();
});
test('salary below floor explains exclusion without claiming the range qualifies',()=>{
 const f=fixture(),j=f.job('low','b',{salaryHigh:35});const c=f.a.contactMatch(j).checks.find(x=>x.key==='salary');
 assert.equal(c.status,'gap');assert.match(c.reason,/低于期望/);assert.doesNotMatch(c.reason,/区间符合/);f.close();
});

test('jobs without a street address use the same analysis basis in discovery and contact',()=>{
 const f=fixture(),a=f.a,j=f.job('city-only','boss',{address:''});
 const stored={...j};delete stored.address;
 a.atlasDb().prepare("UPDATE platform_jobs SET body=? WHERE account_id='a' AND source_id=?").run(JSON.stringify(stored),j.encryptJobId);
 const listed=a.capturedBossJobs('a').find(x=>x.encryptJobId===j.encryptJobId),contact=a.contactJob('a',j.encryptJobId);
 assert.equal(a.contactJobBasis(contact),a.contactJobBasis(listed));
 assert.equal(a.contactMatch(contact).eligible,true);f.close();
});

test('observed BOSS daily limit blocks further contact tasks only for that account and day',async()=>{
 const f=fixture(),a=f.a,j=f.job(),now=noon();prepare(f,j);
 assert.equal(a.recordPlatformContactLimit('a','升级权益可增加沟通次数',now),false);
 assert.equal(a.recordPlatformContactLimit('a','今日主动沟通人数已达上限',now),true);
 assert.equal(a.platformContactLimit('a',now).state,'exhausted');assert.equal(a.platformContactLimit('other',now).state,'unknown');assert.equal(a.platformContactLimit('a',now+86400000).state,'unknown');
 await a.contactTick({inspect:async()=>{throw Error('must not touch platform')}},now);assert.equal(f.calls(),0);f.close();
});

test('automatic consent completes the personalized send without per-message approval, with proof and source totals', async () => {
  const f = fixture(), a = f.a, j = f.job();
  a.markDiscovered('a', [j], 'BOSS 推荐');
  const revision = a.atlasRevision(['atlas-runtime']);
  const started = a.startContacts({accountId:'a', baseRevision:revision, controlRevision:a.atlasRevision(['atlas-runtime','atlas-contact-authorization']), channels:['recommended'], mode:'automatic', acknowledged:true});
  assert.equal(started.created, 1);
  let sent = 0;
  await a.contactTick({ inspect:async()=>({mode:'direct'}), send:async row=>{ sent++; assert.equal(row.body.approval.method,'automatic'); return proof(row,row.body.greeting.text,noon()); } }, noon());
  assert.equal(sent,1);
  const row = a.contactResults({period:'all',channel:'recommended'}).items[0];
  assert.equal(row.state,'completed');
  assert.equal(a.contactResults({period:'all',channel:'targeted'}).total,0);
  assert.equal(a.contactSummary({period:'all'}).channelStats.find(r=>r.channel==='recommended').completed,1);
  await a.contactTick({inspect:async()=>{throw Error('must not send twice')}},noon()+700000);
  assert.equal(sent,1);
  f.close();
});
test('source selection never grants automatic consent to another source or unknown history', async () => {
  const f=fixture(),a=f.a, target=f.job('t','bt'), rec=f.job('r','br'), unknown=f.job('u','bu');
  a.markDiscovered('a',[target],'BOSS 搜索'); a.markDiscovered('a',[rec],'BOSS 推荐');
  const unknownId=a.enqueueContact('a',unknown).id;
  const targetId=a.enqueueContact('a',target).id;
  a.startContacts({accountId:'a',baseRevision:a.atlasRevision(['atlas-runtime']),controlRevision:a.atlasRevision(['atlas-runtime','atlas-contact-authorization']),channels:['recommended'],mode:'automatic',acknowledged:true});
  const sent=[];
  await a.contactTick({inspect:async()=>({mode:'direct'}),send:async row=>{sent.push(row.job_id);return proof(row,row.body.greeting.text,noon())}},noon());
  assert.deepEqual(sent,['r']);
  assert.equal(a.contactRun(targetId).state,'queued'); assert.equal(a.contactRun(unknownId).state,'queued');
  assert.equal(a.contactSummary({period:'all'}).counts.completed,1);
  f.close();
});
test('switching automatic mode off while the adapter inspects invalidates automatic consent before sending', async () => {
  const f=fixture(),a=f.a,j=f.job();a.markDiscovered('a',[j],'BOSS 推荐');
  a.startContacts({accountId:'a',baseRevision:a.atlasRevision(['atlas-runtime']),controlRevision:a.atlasRevision(['atlas-runtime','atlas-contact-authorization']),channels:['recommended'],mode:'automatic',acknowledged:true});
  let sends=0;
  await a.contactTick({inspect:async()=>{a.atlasWrite('atlas-contact-authorization',{accountId:'a',mode:'review',channels:['recommended']});return {mode:'direct'}},send:async()=>{sends++}},noon());
  assert.equal(sends,0);assert.equal(a.contactSummary().counts.completed,0);f.close();
});
test('dual-source jobs retain both origins but enqueue only one recruiter introduction', () => {
  const f=fixture(),a=f.a,j=f.job(),j2=f.job('second','b');
  a.markDiscovered('a',[j],'BOSS 搜索');a.markDiscovered('a',[j,j2],'BOSS 推荐');
  const result=a.startContacts({accountId:'a',baseRevision:a.atlasRevision(['atlas-runtime']),controlRevision:a.atlasRevision(['atlas-runtime','atlas-contact-authorization']),channels:['targeted','recommended'],mode:'automatic',acknowledged:true});
  assert.equal(result.created,1);assert.equal(a.contactResults({period:'all'}).total,1);
  assert.equal(a.contactRun(a.contactResults({period:'all'}).items[0].id).body.channels.length>=1,true);
  f.close();
});
test('automatic mode needs explicit consent and valid channels; changing source cannot bypass stale policy revision',()=>{
  const f=fixture(),a=f.a,baseRevision=a.atlasRevision(['atlas-runtime']),controlRevision=a.atlasRevision(['atlas-runtime','atlas-contact-authorization']);
  assert.throws(()=>a.startContacts({accountId:'a',baseRevision,controlRevision,channels:['recommended'],mode:'automatic'}),/明确/);
  assert.throws(()=>a.startContacts({accountId:'a',baseRevision,controlRevision,channels:['invented'],mode:'automatic',acknowledged:true}),/来源/);
  a.startContacts({accountId:'a',baseRevision,controlRevision,channels:['recommended'],mode:'automatic',acknowledged:true});
  assert.throws(()=>a.startContacts({accountId:'a',baseRevision,controlRevision,channels:['targeted'],mode:'automatic',acknowledged:true}),/更新|冲突/);
  f.close();
});

test('automatic default greeting waits for cooldown, then verifies the personalized explanation only once',async()=>{
 const f=fixture(),a=f.a,j=f.job();a.markDiscovered('a',[j],'BOSS 推荐');
 a.startContacts({accountId:'a',baseRevision:a.atlasRevision(['atlas-runtime']),controlRevision:a.atlasRevision(['atlas-runtime','atlas-contact-authorization']),channels:['recommended'],mode:'automatic',acknowledged:true});
 let opened=0,sent=0;const adapter={inspect:async row=>({mode:row.body.openedAt?'existing':'default',latestMessageId:row.body.baselineMessageId}),open:async row=>{opened++;return proof(row,'平台默认招呼',noon())},send:async row=>{sent++;return proof(row,row.body.greeting.text,noon()+600001)}};
 await a.contactTick(adapter,noon());const id=a.contactResults({period:'all'}).items[0].id;
 assert.equal(a.contactRun(id).state,'cooling');assert.equal(a.contactSummary().counts.completed,0);
 await a.contactTick(adapter,noon()+1000);assert.equal(sent,0);
 await a.contactTick(adapter,noon()+600001);assert.equal(opened,1);assert.equal(sent,1);assert.equal(a.contactRun(id).state,'completed');f.close();
});
test('failed source-start rolls back automatic consent instead of silently enabling sends',()=>{
 const f=fixture(),a=f.a,h=new Map();a.registerDiscovery((k,fn)=>h.set(k,fn));
 const before=a.atlasRead('atlas-contact-authorization');
 const policy=a.atlasRead('atlas-career-policy');policy.discovery.coreKeywords=[];policy.discovery.extensionKeywords=[];a.atlasWrite('atlas-career-policy',policy);
 assert.throws(()=>h.get('career-discovery-contact-start')({}, {accountId:'a',baseRevision:a.atlasRevision(['atlas-runtime']),controlRevision:a.atlasRevision(['atlas-runtime','atlas-contact-authorization']),channels:['targeted'],mode:'automatic',acknowledged:true}),/关键词/);
 assert.equal(a.atlasRead('atlas-contact-authorization').at,before.at);assert.equal(a.atlasRead('atlas-contact-authorization').mode,before.mode);f.close();
});

test('explicitly approved individual opportunity remains executable alongside a selected automatic source',async()=>{
 const f=fixture(),a=f.a,j=f.job();const approvedRow=await approved(f,j);
 a.startContacts({accountId:'a',baseRevision:a.atlasRevision(['atlas-runtime']),controlRevision:a.atlasRevision(['atlas-runtime','atlas-contact-authorization']),channels:['recommended'],mode:'automatic',acknowledged:true});
 let sends=0;await a.contactTick({inspect:async()=>({mode:'direct'}),send:async row=>{sends++;return proof(row,row.body.greeting.text,noon())}},noon());
 assert.equal(sends,1);assert.equal(a.contactRun(approvedRow.id).state,'completed');f.close();
});
