const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  vm = require("node:vm"),
  { buildSync } = require("esbuild");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-agents-test-")),
  bundle = path.join(root, "api.cjs");
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: [
      "atlas-agents",
      "atlas-deepseek",
      "atlas-ai",
      "atlas-greeting",
      "atlas-store",
      "atlas-profile",
      "career-workspace-service",
      "atlas-boss-sync",
      "career-boss-data",
      "atlas-backup",
      "atlas-policy",
      "atlas-tasks",
    ]
      .map((n) => `export * from './packages/ui/src/main/features/${n}'`)
      .join("\n"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});
process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
const plain = (v) => JSON.parse(JSON.stringify(v));
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
        providerApiSecret: "isolated-secret",
        providerCompleteApiUrl: "https://api.deepseek.com",
      },
    ]),
  );
  const calls = [],
    state = { reply: { ok: true }, fetch: null },
    m = { exports: {} };
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
      fetch: async (url, opts) => {
        calls.push(JSON.parse(opts.body));
        if (state.fetch) return state.fetch(opts);
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: { content: JSON.stringify(state.reply) },
                finish_reason: "stop",
              },
            ],
            usage: { total_tokens: 24 },
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
    (n, f) => h.set(n, f),
    () => {},
  );
  a.registerAgents((n, f) => h.set(n, f));
  const call = (n, p) => h.get(n)({}, p),
    s = call("career-workspace-snapshot");
  s.state.profile.evidence = [
    {
      id: "e1",
      title: "企业平台",
      text: "我主导企业平台的产品规划与需求分析，推进产品从方案到上线交付。",
      keywords: ["产品", "平台"],
      source: "隔离测试",
      confirmed: true,
    },
  ];
  call("career-workspace-save", {
    state: JSON.stringify(s.state),
    baseRevision: s.revision,
  });
  a.saveBossSnapshot({ account: { id: "account-a", name: "测试" }, items: [] });
  a.initializePolicy();
  const save = (id, changes) => {
    const c = a.agentConfig(id);
    return a.saveAgent({
      id,
      baseRevision: c.revision,
      prompt: c.prompt,
      enabled: c.enabled,
      ...changes,
    });
  };
  return { a, state, calls, call, save, close: () => a.closeAtlas() };
}
const job = {
  companyName: "隔离企业",
  jobName: "企业平台产品经理",
  description:
    "负责企业平台产品规划与需求分析，推动产品从方案到上线交付。".repeat(5),
  address: "上海",
  salaryHigh: 50,
};
const analysis = () => ({
  recommendation: {
    decision: "consider",
    reason: "具备平台规划经历",
    nextStep: "核对职责",
  },
  businessGoal: "企业平台建设",
  requirements: [
    {
      requirement: "产品规划",
      evidenceIds: ["e1"],
      assessment: "已确认",
      status: "met",
      essential: false,
    },
  ],
  strengths: ["平台经历"],
  gaps: [],
  questions: [],
  draft: "",
  resumeSuggestions: [],
});
test("catalog covers ten actual model steps and distinguishes deterministic operations", () => {
  const f = fixture(),
    s = f.a.agentOverview();
  assert.equal(s.agents.length, 11);
  assert.ok(s.agents.every((a) => a.enabled && a.defaultPrompt.length > 10));
  assert.equal(s.deterministic.length, 3);
  assert.equal(
    s.agents.find((a) => a.id === "greeting-review").label,
    "话术事实审校",
  );
  f.close();
});
test("edited prompt reaches the gateway and actual immutable snapshot, without credentials or injected resume", async () => {
  const f = fixture();
  f.save("reply", {
    prompt: "请用自然且简洁的中文回答，先说明当前可以讨论的职责。",
  });
  const a = f.a.resolveAgent("reply");
  await f.a.deepseekJson(
    f.a.deepseekConfig(),
    "ignored legacy prompt",
    { privateResume: "不存入提示词记录" },
    new AbortController().signal,
    { kind: "reply", agent: a },
  );
  assert.ok(f.calls[0].messages[0].content.startsWith(a.prompt));
  assert.match(f.calls[0].messages[0].content, /不可由自定义提示词解除/);
  const row = f.a.agentCalls().items[0];
  assert.equal(row.version, 2);
  const detail = f.a.agentCallDetail({ id: row.id });
  assert.equal(detail.prompt.system, f.calls[0].messages[0].content);
  assert.ok(!JSON.stringify(detail).includes("不存入提示词记录"));
  f.save("reply", {
    prompt: "改为只讨论岗位需求和企业平台实践，保持简洁和客观。",
  });
  assert.equal(f.a.agentCallDetail({ id: row.id }).prompt.system, a.system);
  assert.ok(!JSON.stringify(f.a.agentOverview()).includes("isolated-secret"));
  f.close();
});
test("cross-window edit is rejected and saved configuration stays intact", () => {
  const f = fixture(),
    c = f.a.agentConfig("analysis");
  f.save("analysis", { prompt: c.prompt + "\n先列出关键缺口。" });
  assert.throws(
    () =>
      f.a.saveAgent({
        id: "analysis",
        baseRevision: c.revision,
        prompt: c.prompt + "另一个草稿",
        enabled: true,
      }),
    /另一个窗口/,
  );
  assert.ok(f.a.agentConfig("analysis").prompt.endsWith("先列出关键缺口。"));
  assert.equal(
    f.call("career-agent-history", { id: "analysis" })[0].version,
    1,
  );
  f.close();
});
test("disabled Agent blocks manual calls and does not spend model budget", async () => {
  const f = fixture();
  f.save("analysis", { enabled: false });
  await assert.rejects(f.a.analyzeJob({ job }), /已停用/);
  await assert.rejects(
    f.a.deepseekJson(
      f.a.deepseekConfig(),
      "test",
      {},
      new AbortController().signal,
      { kind: "analysis" },
    ),
    /已停用/,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.a.agentCalls().total, 0);
  f.close();
});
test("prompt changes invalidate analysis cache and previously accepted result version", async () => {
  const f = fixture();
  f.state.reply = analysis();
  const first = await f.a.analyzeJob({ job }),
    same = await f.a.analyzeJob({ job });
  assert.equal(same.cached, true);
  assert.equal(f.calls.length, 1);
  f.save("analysis", {
    prompt: f.a.agentConfig("analysis").prompt + "\n优先说明实际业务目标。",
  });
  assert.notEqual(first.promptVersion, f.a.currentAnalysisPromptVersion());
  const next = await f.a.analyzeJob({ job });
  assert.equal(next.cached, false);
  assert.equal(f.calls.length, 2);
  f.save("analysis", { enabled: false });
  await assert.rejects(f.a.analyzeJob({ job }), /已停用/);
  assert.equal(f.calls.length, 2);
  f.close();
});
test("writer and reviewer record separate model agents and review disable prevents new greetings", async () => {
  const f = fixture();
  let step = 0;
  f.state.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(
              ++step % 2
                ? {
                    decision: "draft",
                    opening: "您好，了解到岗位关注企业平台的产品规划与需求分析",
                    closing: "discuss",
                    matches: [
                      {
                        requirementId: "r0",
                        evidenceId: "e1",
                        relevance:
                          "企业平台规划经历直接对应岗位的产品规划与上线工作",
                      },
                    ],
                    gaps: [],
                  }
                : {
                    grounded: true,
                    relevant: true,
                    concise: true,
                    noCommitments: true,
                    issues: [],
                  },
            ),
          },
          finish_reason: "stop",
        },
      ],
      usage: { total_tokens: 24 },
    }),
  });
  const result = await f.a.generateGreeting({ job });
  const ids = f.a.agentCalls().items.map((c) => c.agentId);
  assert.ok(ids.includes("greeting") && ids.includes("greeting-review"));
  assert.equal(f.a.greetingCurrent(result, job), true);
  f.save("greeting-review", { enabled: false });
  assert.equal(f.a.greetingCurrent(result, job), false);
  await assert.rejects(f.a.generateGreeting({ job }), /已停用/);
  assert.equal(f.calls.length, 2);
  f.close();
});
test("disable during active request cancels the request and records cancellation", async () => {
  const f = fixture();
  let entered;
  const ready = new Promise((r) => (entered = r));
  f.state.fetch = (opts) =>
    new Promise((resolve, reject) => {
      entered();
      opts.signal.addEventListener(
        "abort",
        () => reject(Object.assign(Error("cancel"), { name: "AbortError" })),
        { once: true },
      );
    });
  const pending = f.a.deepseekJson(
    f.a.deepseekConfig(),
    "test",
    {},
    new AbortController().signal,
    { kind: "reply" },
  );
  await ready;
  f.save("reply", { enabled: false });
  await assert.rejects(pending, /已停用/);
  assert.equal(f.a.agentCalls().items[0].status, "cancelled");
  assert.equal(
    f.a.atlasDb().prepare("SELECT count(*) n FROM leases").get().n,
    0,
  );
  f.close();
});
test("prompt changed while a model returns cannot overwrite stored analysis", async () => {
  const f = fixture();
  let finish, entered;
  const ready = new Promise((r) => (entered = r));
  f.state.fetch = () =>
    new Promise((r) => {
      finish = r;
      entered();
    });
  const pending = f.a.analyzeJob({ job });
  await ready;
  f.save("analysis", {
    prompt: f.a.agentConfig("analysis").prompt + "\n优先列出问题。",
  });
  finish({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: { content: JSON.stringify(analysis()) },
          finish_reason: "stop",
        },
      ],
    }),
  });
  await assert.rejects(pending, /提示词已更新/);
  assert.equal(
    f.a
      .atlasDb()
      .prepare("SELECT count(*) n FROM documents WHERE key LIKE 'atlas-ai/%'")
      .get().n,
    0,
  );
  f.close();
});
test("waiting model call rechecks enablement and never reaches fetch after disable", async () => {
  const f = fixture(),
    owner = f.a.acquireLease("model:official-deepseek");
  const pending = f.a.deepseekJson(
    f.a.deepseekConfig(),
    "test",
    {},
    new AbortController().signal,
    { kind: "reply" },
  );
  f.save("reply", { enabled: false });
  f.a.releaseLease("model:official-deepseek", owner);
  await assert.rejects(pending, /已停用/);
  assert.equal(f.calls.length, 0);
  f.close();
});
test("historical calls do not pretend to know prompts and account isolation applies to details", async () => {
  const f = fixture(),
    db = f.a.atlasDb();
  db.prepare("INSERT INTO ai_calls VALUES(?,?,?,?,?,?,?,?,?,?)").run(
    "old",
    "account-a",
    "greeting",
    "2026-01-01",
    0,
    "deepseek-flash",
    "completed",
    null,
    1,
    "2026-01-01",
  );
  assert.equal(f.a.agentCallDetail({ id: "old" }).prompt, null);
  f.a.saveBossSnapshot({
    account: { id: "account-b", name: "另一个账号" },
    items: [],
  });
  assert.equal(f.a.agentCalls().total, 0);
  assert.throws(() => f.a.agentCallDetail({ id: "old" }), /不存在|不属于/);
  f.close();
});
test("prompt validation blocks accidental credentials and malformed updates", () => {
  const f = fixture();
  assert.throws(
    () =>
      f.save("reply", {
        prompt: "请使用密钥 sk-12345678901234567890 调用接口",
      }),
    /密钥/,
  );
  assert.throws(() => f.save("reply", { prompt: "短" }), /10–20000/);
  assert.throws(() => f.save("reply", { enabled: "true" }), /启用状态/);
  f.close();
});
test("encrypted migration retains prompts versions and historical call snapshots", async () => {
  const f = fixture();
  f.save("reply", {
    prompt: "先理解招聘者的问题，再用已确认经历提供简洁的答复。",
  });
  await f.a.deepseekJson(
    f.a.deepseekConfig(),
    "test",
    {},
    new AbortController().signal,
    { kind: "reply" },
  );
  const id = f.a.agentCalls().items[0].id,
    system = f.a.agentCallDetail({ id }).prompt.system,
    b = f.a.exportEncryptedBackup("agent-backup-password");
  f.save("reply", { enabled: false });
  f.a.restoreEncryptedBackup({
    password: "agent-backup-password",
    base64: b.base64,
    confirm: true,
  });
  assert.equal(f.a.agentConfig("reply").enabled, true);
  assert.equal(f.a.agentCallDetail({ id }).prompt.system, system);
  assert.equal(f.a.runtimePolicy().paused, true);
  f.close();
});

test('restoring default creates a new version without overwriting earlier call snapshots',async()=>{
 const f=fixture(),original=f.a.agentConfig('reply');
 await f.a.deepseekJson(f.a.deepseekConfig(),'ignored',{},new AbortController().signal,{kind:'reply'});
 const first=f.a.agentCalls().items[0].id;
 f.save('reply',{prompt:original.prompt+'\n简洁表达。'});f.save('reply',{prompt:original.prompt});
 await f.a.deepseekJson(f.a.deepseekConfig(),'ignored',{},new AbortController().signal,{kind:'reply'});
 assert.equal(f.a.agentCallDetail({id:first}).prompt.version,1);
 assert.equal(f.a.agentCalls().items[0].version,3);
 assert.equal(f.a.agentCallDetail({id:f.a.agentCalls().items[0].id}).prompt.version,3);
 assert.notEqual(f.a.agentVersion('reply-base',['reply']),'reply-base');f.close();
});
test('abandoned model calls stop appearing as currently running',()=>{
 const f=fixture();f.a.atlasDb().prepare('INSERT INTO ai_calls VALUES(?,?,?,?,?,?,?,?,?,?)').run('abandoned','account-a','reply','2000-01-01',0,'deepseek-flash','running',null,0,'2000-01-01');
 assert.equal(f.a.agentOverview().agents.find(a=>a.id==='reply').running,0);
 assert.equal(f.a.agentCalls().items[0].status,'interrupted');f.close();
});
