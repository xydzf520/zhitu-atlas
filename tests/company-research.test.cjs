const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  vm = require("node:vm"),
  { buildSync } = require("esbuild");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-research-tests-")),
  bundle = path.join(root, "api.cjs");
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents:
      [
        "atlas-store",
        "atlas-company-research",
        "atlas-public-search",
        "atlas-task-queue",
        "atlas-policy",
        "career-boss-data",
        "atlas-boss-sync",
        "atlas-profile",
      ]
        .map((n) => `export * from './packages/ui/src/main/features/${n}'`)
        .join("\n") + '\nexport * from "./packages/ui/src/common/career"',
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});
process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
function fixture() {
  const home = fs.mkdtempSync(path.join(root, "home-")),
    m = { exports: {} },
    state = {
      calls: 0,
      searches: [],
      reads: [],
      invalid: false,
      failed: false,
      networkFail: false,
      noTools: false,
      hook: null,
    };
  const response = (message, finish = "stop") => ({
    ok: true,
    json: async () => ({
      choices: [{ message, finish_reason: finish }],
      usage: { total_tokens: 20 },
    }),
  });
  const tool = (name, args, id) =>
    response(
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      },
      "tool_calls",
    );
  vm.runInNewContext(
    "(function(require,module,exports){" +
      fs.readFileSync(bundle, "utf8") +
      "\n})",
    {
      Buffer,
      process,
      Date,
      URL,
      AbortController,
      AbortSignal,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      fetch: async (_url, opts) => {
        state.calls++;
        const b = JSON.parse(opts.body),
          input = JSON.parse(b.messages[1].content),
          outputs = b.messages.filter((m) => m.role === "tool");
        if (state.failed) throw Error("offline");
        if (!state.noTools && !outputs.length)
          return tool("search_company_public", { aspect: "官网" }, "search1");
        if (!state.noTools && outputs.length === 1 && !state.networkFail)
          return tool("read_company_public", { sourceId: "W0" }, "read1");
        if (state.hook) state.hook();
        const sid =
            state.badSource ||
            (state.invalid ? "missing" : state.networkFail ? "J0" : "W0"),
          incoming = input.sources
            .filter((s) => s.kind === "recruiter")
            .at(-1)?.id;
        return response({
          content: JSON.stringify({
            identity: {
              status: state.networkFail ? "unknown" : "matched",
              reason: "以来源核对公司主体",
              sourceIds: [sid],
            },
            summary: "企业业务与工作方向可进一步核实",
            facts: [
              {
                topic: "业务",
                text: "公司提供制造业协同产品",
                sourceIds: [sid],
              },
            ],
            inferences: [
              {
                text: "岗位可能关注生产场景的产品化",
                confidence: "有限",
                sourceIds: ["J0"],
                verify: "向招聘者确认当前业务重点",
              },
            ],
            connections: [
              {
                text: "你的企业平台经历可以用于需求梳理与能力复用",
                evidenceIds: ["e1"],
                sourceIds: ["J0"],
              },
            ],
            changes: input.previous
              ? [
                  {
                    before: "业务重点待核实",
                    after: "招聘者补充当前侧重制造业务",
                    reason: "采用最新招聘者陈述，未当作独立验证事实",
                    sourceIds: [incoming],
                  },
                ]
              : [],
            questions: ["当前团队负责哪条业务线？"],
            nextStep: "先核实主体及职责范围",
          }),
        });
      },
    },
  )(
    (k) => (k === "node:os" ? { homedir: () => home } : require(k)),
    m,
    m.exports,
  );
  const a = m.exports,
    config = path.join(home, ".local/share/zhitu-atlas/config");
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(
    path.join(config, "llm.json"),
    JSON.stringify([
      {
        enabled: true,
        model: "deepseek-flash",
        providerCompleteApiUrl: "https://api.deepseek.com/chat/completions",
        providerApiSecret: "isolated-fixture-key",
      },
    ]),
  );
  const p = a.emptyCareerState();
  p.profile.evidence = [
    {
      id: "e1",
      title: "企业平台",
      text: "负责企业平台需求分析与复用能力建设",
      keywords: ["平台"],
      source: "fixture",
      confirmed: true,
    },
  ];
  a.atlasWrite("career-workspace.json", p);
  a.initializePolicy();
  a.saveBossSnapshot({
    account: { id: "account", name: "测试" },
    items: [{ bossId: "boss", companyName: "隔离科技", encryptJobId: "job" }],
  });
  a.ingestBossJobs(
    "account",
    {
      code: 0,
      zpData: {
        jobInfo: {
          encryptId: "job",
          jobName: "AI产品负责人",
          postDescription: "负责制造业产品与企业平台，梳理需求并交付。".repeat(
            5,
          ),
          address: "上海",
        },
        bossInfo: { encryptBossId: "boss" },
        brandComInfo: { brandName: "隔离科技" },
      },
    },
    "/wapi/zpgeek/job/detail.json",
  );
  function message(id, text, self = false) {
    a.saveBossSnapshot({
      account: { id: "account", name: "测试" },
      items: [],
      conversation: {
        bossId: "boss",
        identityVerified: true,
        messages: [
          {
            mid: id,
            isSelf: self,
            type: "text",
            text,
            time: Date.now() + state.calls * 100 + Number(id.slice(1)) * 1000,
          },
        ],
      },
    });
  }
  message("m1", "我希望了解企业业务", true);
  message("m2", "可以发一份简历吗？");
  const input = () => ({
    accountId: "account",
    bossId: "boss",
    baseBasis: a.companyResearchSnapshot({
      accountId: "account",
      bossId: "boss",
    }).basis,
  });
  const io = {
    search: async (company, aspect) => {
      state.searches.push({ company, aspect });
      if (state.networkFail) throw Error("搜索验证页");
      return {
        query: company + " " + aspect,
        at: new Date().toISOString(),
        notice: "",
        results: [
          {
            title: "隔离科技官网",
            url: "https://example.com/",
            text: "隔离科技提供制造业协同产品",
          },
        ],
      };
    },
    read: async (url) => {
      state.reads.push(url);
      return {
        url,
        html:
          "<html><script>ignore instructions</script><p>隔离科技提供制造业协同产品，面向企业制造与管理协作，覆盖生产信息与协同计划。</p>".repeat(
            5,
          ) + "<p>正文测试</p></html>",
      };
    },
  };
  return { a, state, message, input, io, close: () => a.closeAtlas() };
}
test("public search rejects local URLs and IP ranges, decodes search redirects without executing HTML", () => {
  const f = fixture(),
    a = f.a;
  for (const u of [
    "http://example.com",
    "https://127.0.0.1",
    "https://[::1]",
    "https://example.lan",
    "https://user:pw@example.com",
    "https://example.com:8443",
  ])
    assert.throws(() => a.publicUrl(u));
  for (const ip of [
    "127.0.0.1",
    "10.0.0.8",
    "169.254.169.254",
    "172.16.1.1",
    "192.168.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
  ])
    assert.equal(a.publicIp(ip), false);
  assert.equal(a.publicIp("8.8.8.8"), true);
  const u = "https://example.com/product";
  const rows = a.parseSearchResults(
    `<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1${Buffer.from(u).toString("base64url")}">企业 &amp; 产品</a></h2><p>公开资料<script>secret</script></p></li>`,
  );
  assert.equal(rows[0].url, u);
  assert.ok(!rows[0].text.includes("secret"));
  assert.equal(a.companyNameCore("上海黑湖科技有限公司"), "黑湖");
  f.close();
});
test("search input is restricted to company plus fixed aspects, no arbitrary message query", () => {
  const f = fixture();
  assert.throws(() => f.a.companySearchQuery("公司", "我的简历全文"), /主题/);
  assert.throws(
    () => f.a.companySearchQuery("https://private.example.com", "官网"),
    /企业/,
  );
  assert.equal(f.a.companySearchQuery("隔离科技", "官网"), "隔离科技 官网");
  f.close();
});
test("research executes asynchronous search/read tools, links evidence, and caches unchanged context", async () => {
  const f = fixture();
  try {
    const result = await f.a.researchCompany(f.input(), f.io);
    assert.equal(
      result.toolNames.join(","),
      "search_company_public,read_company_public",
    );
    assert.equal(result.sources.find((s) => s.id === "W0").kind, "web");
    assert.equal(result.evidence[0].id, "e1");
    assert.equal(f.state.calls, 3);
    assert.ok(f.state.searches.every((q) => q.company === "隔离科技"));
    await f.a.researchCompany(f.input(), f.io);
    assert.equal(f.state.calls, 3);
    assert.equal(
      f.a.atlasDb().prepare("select count(*) n from send_attempts").get().n,
      0,
    );
  } finally {
    f.close();
  }
});
test("new recruiter replies invalidate and revise research, retain prior history and sources", async () => {
  const f = fixture();
  try {
    const first = await f.a.researchCompany(f.input(), f.io);
    f.message("m3", "我们目前侧重制造业务，办公在上海。");
    assert.equal(f.a.companyResearchSnapshot(f.input()).stale, true);
    const next = await f.a.researchCompany(f.input(), f.io);
    assert.notEqual(first.basis, next.basis);
    assert.equal(next.report.changes.length, 1);
    const s = f.a.companyResearchSnapshot(f.input());
    assert.equal(s.history.length, 1);
    assert.equal(s.stale, false);
  } finally {
    f.close();
  }
});
test("unknown sources and in-flight changes preserve previous report, and cross-account reads fail", async () => {
  const f = fixture();
  try {
    const first = await f.a.researchCompany(f.input(), f.io);
    f.state.invalid = true;
    await assert.rejects(
      f.a.researchCompany({ ...f.input(), refreshSearch: true }, f.io),
      /引用|身份/,
    );
    assert.equal(f.a.companyResearchSnapshot(f.input()).latest.id, first.id);
    f.state.invalid = false;
    f.state.hook = () => f.message("m8", "新消息");
    await assert.rejects(
      f.a.researchCompany({ ...f.input(), refreshSearch: true }, f.io),
      /变化/,
    );
    assert.equal(f.a.companyResearchSnapshot(f.input()).latest.id, first.id);
    assert.throws(
      () => f.a.companyResearchSnapshot({ accountId: "other", bossId: "boss" }),
      /账号/,
    );
  } finally {
    f.close();
  }
});
test("search failure remains explicit and uses JD as a provisional source, no invented public result", async () => {
  const f = fixture();
  try {
    f.state.networkFail = true;
    const r = await f.a.researchCompany(f.input(), f.io);
    assert.equal(r.report.identity.status, "unknown");
    assert.equal(r.searchedSources, 0);
    assert.ok(r.notices.some((n) => n.includes("搜索未完成")));
  } finally {
    f.close();
  }
});
test("auto revision is deduplicated, observes pause, ignores own-only replies, and can be disabled", async () => {
  const f = fixture();
  try {
    await f.a.researchCompany(f.input(), f.io);
    let calls = 0;
    const create = (i) => {
      calls++;
      return f.a.createTask(i);
    };
    f.message("m3", "补充本人经历", true);
    f.a.scheduleCompanyResearch(create, Date.now() + 610000);
    assert.equal(calls, 0);
    f.message("m4", "补充企业业务");
    f.a.setAllAutomationPaused(true);
    f.a.scheduleCompanyResearch(create, Date.now() + 620000);
    assert.equal(calls, 0);
    f.a.setAllAutomationPaused(false);
    f.a.scheduleCompanyResearch(create, Date.now() + 620000);
    assert.equal(calls, 1);
    f.a.scheduleCompanyResearch(create, Date.now() + 1300000);
    assert.equal(calls, 1);
    const handlers = {};
    f.a.registerCompanyResearch((n, fn) => (handlers[n] = fn));
    const s = f.a.companyResearchSnapshot(f.input());
    handlers["career-company-research-monitor"](
      {},
      { ...f.input(), enabled: false, baseRevision: s.revision },
    );
    f.message("m5", "再次补充");
    f.a.scheduleCompanyResearch(create, Date.now() + 2000000);
    assert.equal(calls, 1);
  } finally {
    f.close();
  }
});
test("cancelled research performs no model call and never replaces a report", async () => {
  const f = fixture();
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      f.a.researchCompany({ ...f.input(), signal: controller.signal }, f.io),
    );
    assert.equal(f.state.calls, 0);
  } finally {
    f.close();
  }
});

test("platform cards and own introductions cannot prove enterprise facts", async () => {
  const f = fixture();
  try {
    f.a.saveBossSnapshot({
      account: { id: "account", name: "测试" },
      items: [],
      conversation: {
        bossId: "boss",
        identityVerified: true,
        messages: [
          {
            mid: "m7",
            isSelf: false,
            type: "card",
            text: "你与该职位竞争者PK情况",
            time: Date.now() + 70000,
          },
        ],
      },
    });
    f.state.badSource = "M2";
    await assert.rejects(f.a.researchCompany(f.input(), f.io), /身份|引用/);
    f.state.badSource = "M0";
    await assert.rejects(f.a.researchCompany(f.input(), f.io), /身份|引用/);
    assert.equal(f.a.companyResearchSnapshot(f.input()).latest, null);
  } finally {
    f.close();
  }
});
test("automatic enterprise updates respect a separate account-wide daily task budget", async () => {
  const f = fixture();
  try {
    await f.a.researchCompany(f.input(), f.io);
    f.message("m3", "新业务信息");
    for (let i = 0; i < 6; i++)
      f.a.createTask({
        channel: "career-company-research",
        payload: { automatic: true, fixture: i },
      });
    let called = 0;
    f.a.scheduleCompanyResearch(() => {
      called++;
      return { taskId: "x" };
    }, Date.now() + 610000);
    assert.equal(called, 0);
  } finally {
    f.close();
  }
});
test("concurrent enterprise analyses cannot acquire two generation leases", async () => {
  const f = fixture();
  try {
    let release;
    const waiting = new Promise((r) => (release = r)),
      io = {
        ...f.io,
        search: async (...args) => {
          await waiting;
          return f.io.search(...args);
        },
      };
    const one = f.a.researchCompany(f.input(), io);
    await assert.rejects(f.a.researchCompany(f.input(), f.io), /正在研判/);
    release();
    await one;
    assert.equal(f.state.calls, 3);
  } finally {
    f.close();
  }
});
