const { test, after } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { performance } = require("node:perf_hooks"),
  { buildSync } = require("esbuild");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-execution-test-")),
  bundle = path.join(root, "api.cjs");
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents:
      [
        "atlas-execution",
        "atlas-execution-service",
        "atlas-store",
        "atlas-task-queue",
        "atlas-task-records",
        "atlas-deepseek",
        "atlas-agents",
        "atlas-policy",
        "atlas-profile",
        "atlas-backup",
        "atlas-tasks",
        "career-reply-store",
      ]
        .map((n) => `export * from './packages/ui/src/main/features/${n}'`)
        .join("\n") + "\nexport * from './packages/ui/src/common/career'",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});
const a = require(bundle);
after(() => {
  a.closeAtlas();
  fs.rmSync(root, { recursive: true, force: true });
});
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(root, "f-"));
  process.env.ATLAS_DATA_ROOT = dir;
  fs.mkdirSync(path.join(dir, "config"));
  fs.writeFileSync(
    path.join(dir, "config/llm.json"),
    JSON.stringify([
      {
        enabled: true,
        model: "deepseek-flash",
        providerApiSecret: "fixture-secret",
        providerCompleteApiUrl: "https://api.deepseek.com",
      },
    ]),
  );
  a.atlasWrite("career-boss-sync.json", { account: { id: "account-a" } });
  const state = a.emptyCareerState();
  state.profile.resumeText = "企业平台产品经历";
  state.profile.evidence = [
    {
      id: "e1",
      title: "平台产品",
      text: "负责平台规划与上线交付",
      keywords: ["产品"],
      source: "测试",
      confirmed: true,
    },
  ];
  a.atlasWrite("career-workspace.json", state);
  a.initializePolicy();
  t.after(() => {
    a.closeAtlas();
    delete process.env.ATLAS_DATA_ROOT;
  });
  return { db: a.atlasDb(), dir };
}
function task(
  channel = "career-reply-draft",
  payload = { incoming: "你好", bossId: "boss-a", accountId: "account-a" },
) {
  return a.createTask({ channel, payload });
}
function runOf(id) {
  return a.executionLink("task", id).run_id;
}
function pause(id, paused = true) {
  const r = a.executionRunRow(id);
  return a.controlExecution({
    id,
    baseRevision: r.revision,
    action: "pause",
    paused,
  });
}
function response(value) {
  return {
    ok: true,
    json: async () => ({
      choices: [
        { message: { content: JSON.stringify(value) }, finish_reason: "stop" },
      ],
      usage: { total_tokens: 24 },
    }),
  };
}
function network(t, fn) {
  const old = global.fetch;
  global.fetch = fn;
  t.after(() => (global.fetch = old));
}
function event(id = "a".repeat(64)) {
  return {
    id,
    userId: "account-a",
    bossId: "boss-a",
    company: "示例企业",
    person: "招聘者",
    incoming: "你好",
    messageId: "m1",
    receivedAt: Date.now(),
    createdAt: new Date().toISOString(),
    draft: "您好",
    reason: "待核对",
    category: "常规咨询",
    status: "review",
  };
}

test("task creation is idempotent and preserves blocked as a distinct state", (t) => {
  const { db } = fixture(t);
  const x = task(),
    same = task();
  assert.equal(x.taskId, same.taskId);
  assert.equal(a.executionList().total, 1);
  const input = {
    id: x.taskId,
    kind: "career-reply-draft",
    accountId: "account-a",
    state: "blocked",
    step: "等待额度",
  };
  a.executionTaskChanged(input);
  const before = db.prepare("SELECT count(*) n FROM execution_events").get().n;
  a.executionTaskChanged(input);
  assert.equal(
    db.prepare("SELECT count(*) n FROM execution_events").get().n,
    before,
  );
  assert.equal(a.executionDetail(runOf(x.taskId)).run.state, "blocked");
});
test("runtime views reject another account including events and controls", (t) => {
  fixture(t);
  const x = task(),
    id = runOf(x.taskId);
  a.atlasWrite("career-boss-sync.json", { account: { id: "account-b" } });
  assert.equal(a.executionList().total, 0);
  assert.throws(() => a.executionDetail(id), /不属于/);
  assert.throws(() => a.executionEvents({ id }), /不属于/);
  assert.throws(
    () =>
      a.controlExecution({
        id,
        baseRevision: 1,
        action: "pause",
        paused: true,
      }),
    /不属于/,
  );
});
test("paused queued task does not execute; resume uses the original task once", async (t) => {
  fixture(t);
  const x = task(),
    id = runOf(x.taskId);
  pause(id);
  let calls = 0;
  const stop = a.startTaskQueue(async () => {
    calls++;
    return { text: "您好" };
  });
  t.after(stop);
  await a.taskQueueTick();
  assert.equal(calls, 0);
  pause(id, false);
  await a.taskQueueTick();
  assert.equal(calls, 1);
  await a.taskQueueTick();
  assert.equal(calls, 1);
  assert.equal(a.executionDetail(id).run.state, "completed");
});
test("parent pause blocks child dispatch while unrelated manual work proceeds", async (t) => {
  fixture(t);
  a.recordTask({
    id: "discovery:d1",
    kind: "discovery-run",
    accountId: "account-a",
    state: "running",
    step: "搜索",
  });
  const child = task(),
    other = task("career-resume-review", {});
  a.parentExecution(child.taskId, "discovery:d1", "job-a", "discovery");
  pause(runOf("discovery:d1"));
  assert.equal(a.taskExecutionPaused(child.taskId), true);
  const calls = [];
  const stop = a.startTaskQueue(async (kind) => {
    calls.push(kind);
    return { summary: "完成" };
  });
  t.after(stop);
  await a.taskQueueTick();
  assert.deepEqual(calls, ["career-resume-review"]);
  assert.equal(
    a.executionDetail(runOf(child.taskId)).parent.id,
    runOf("discovery:d1"),
  );
  assert.equal(a.executionDetail(runOf(other.taskId)).parent, null);
});
test("writer and reviewer are separate child agents with actual model links", async (t) => {
  const { db } = fixture(t);
  const x = task();
  let calls = 0;
  network(t, async () => {
    calls++;
    return response({ text: "您好", evidenceIds: ["e1"] });
  });
  await a.withExecutionTask(x.taskId, async () => {
    await a.deepseekJson(
      a.deepseekConfig(),
      "",
      {},
      new AbortController().signal,
      { agent: a.resolveAgent("reply"), kind: "reply" },
    );
    await a.deepseekJson(
      a.deepseekConfig(),
      "",
      {},
      new AbortController().signal,
      { agent: a.resolveAgent("greeting-review"), kind: "greeting" },
    );
  });
  const d = a.executionDetail(runOf(x.taskId));
  assert.equal(calls, 2);
  assert.deepEqual(
    d.steps.filter((s) => s.actor !== "system").map((s) => s.actor),
    ["reply", "greeting-review"],
  );
  assert.equal(d.modelCalls.length, 2);
  assert.equal(db.prepare("SELECT count(*) n FROM send_attempts").get().n, 0);
  assert.equal(
    d.steps.find((s) => s.actor === "reply").output.validated,
    false,
  );
  assert.equal(d.evidence[0].id, "e1");
});
test("read tool has a completed child step; parameters and secrets are absent from logs", async (t) => {
  const { db } = fixture(t);
  const x = task();
  let requests = 0,
    used = 0;
  network(t, async () => {
    requests++;
    if (requests === 1)
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "tool1",
                    type: "function",
                    function: {
                      name: "atlas_probe",
                      arguments: '{"secret":"fixture-secret"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      };
    return response({ text: "完成" });
  });
  await a.withExecutionTask(x.taskId, () =>
    a.deepseekJson(a.deepseekConfig(), "", {}, new AbortController().signal, {
      kind: "reply",
      tools: [
        {
          name: "atlas_probe",
          description: "测试只读工具",
          parameters: { type: "object", properties: {} },
          run: async () => {
            used++;
            return { ok: true };
          },
        },
      ],
    }),
  );
  const d = a.executionDetail(runOf(x.taskId));
  const tools = d.steps.filter((s) => s.label === "工具：atlas_probe");
  assert.equal(tools.length, 1);
  assert.equal(tools[0].state, "completed");
  assert.equal(used, 1);
  assert.equal(requests, 2);
  assert.ok(tools[0].parent_id.startsWith("model:"));
  assert.ok(
    !JSON.stringify(
      db.prepare("SELECT * FROM execution_events").all(),
    ).includes("fixture-secret"),
  );
});
test("model network failure is recorded once without automatic replay", async (t) => {
  fixture(t);
  const x = task();
  let calls = 0;
  network(t, async () => {
    calls++;
    throw Error("fixture failure");
  });
  await assert.rejects(
    a.withExecutionTask(x.taskId, () =>
      a.deepseekJson(a.deepseekConfig(), "", {}, new AbortController().signal, {
        kind: "reply",
      }),
    ),
    /网络请求失败/,
  );
  assert.equal(calls, 1);
  assert.equal(
    a.executionDetail(runOf(x.taskId)).steps.find((s) => s.actor === "reply")
      .state,
    "failed",
  );
});
test("cache use records reuse and never invents a paid generation", (t) => {
  fixture(t);
  const x = task();
  a.withExecutionTask(x.taskId, () =>
    a.modelCacheHit("reply", "deepseek-flash", a.resolveAgent("reply")),
  );
  const d = a.executionDetail(runOf(x.taskId));
  assert.equal(d.modelCalls[0].status, "cached");
  assert.equal(d.modelCalls[0].usage.total_tokens, 0);
  assert.equal(d.steps.find((s) => s.actor === "reply").state, "cached");
});
test("cancelled running task cannot be revived by a late model result", async (t) => {
  fixture(t);
  const x = task();
  let resolve;
  const waiting = new Promise((r) => (resolve = r));
  const stop = a.startTaskQueue(async () => {
    a.cancelTask(x.taskId);
    resolve();
    return { text: "迟到结果" };
  });
  t.after(stop);
  await a.taskQueueTick();
  await waiting;
  assert.equal(a.taskRun(x.taskId).state, "cancelled");
  assert.equal(a.executionDetail(runOf(x.taskId)).run.state, "cancelled");
});
test("local reply dismissal survives stale worker writes", (t) => {
  fixture(t);
  const e = event();
  a.saveReplyEvent(e);
  const id = runOf("reply:" + e.id),
    r = a.executionRunRow(id);
  a.controlExecution({ id, baseRevision: r.revision, action: "cancel" });
  a.saveReplyEvent({ ...e, status: "queued", draft: "迟到草稿" });
  assert.equal(
    a.atlasRead("career-replies/" + e.id + ".json", null).status,
    "dismissed",
  );
  assert.equal(a.executionDetail(id).run.underlyingState, "skipped");
});
test("sends share reply trace and uncertain results are separate from generation", (t) => {
  fixture(t);
  const e = event();
  a.saveReplyEvent(e);
  a.setAllAutomationPaused(false);
  a.setRuntime({ paused: false });
  assert.equal(
    a.claimSend({
      id: e.id,
      platform: "boss",
      accountId: e.userId,
      recipientId: e.bossId,
      kind: "reply",
      automatic: false,
      text: "您好",
      context: { conversationId: e.bossId },
    }),
    "",
  );
  a.finishSend(e.id, "uncertain");
  const d = a.executionDetail(runOf("reply:" + e.id));
  assert.equal(d.sends.length, 1);
  assert.equal(d.sends[0].status, "uncertain");
  assert.equal(d.sends[0].proof.messageId, undefined);
  assert.equal(a.executionLink("task", "send:" + e.id).run_id, d.run.id);
});
test("pause before send claim prevents a platform reservation", (t) => {
  const { db } = fixture(t);
  const e = event();
  a.saveReplyEvent(e);
  a.setAllAutomationPaused(false);
  a.setRuntime({ paused: false });
  pause(runOf("reply:" + e.id));
  assert.equal(
    a.claimSend({
      id: e.id,
      platform: "boss",
      accountId: e.userId,
      recipientId: e.bossId,
      kind: "reply",
      automatic: false,
      text: "您好",
    }),
    "本条流程已暂停",
  );
  assert.equal(db.prepare("SELECT count(*) n FROM send_attempts").get().n, 0);
});
test("control revisions prevent cross-window overwrites", (t) => {
  fixture(t);
  const x = task(),
    id = runOf(x.taskId),
    r = a.executionRunRow(id);
  a.controlExecution({
    id,
    baseRevision: r.revision,
    action: "pause",
    paused: true,
  });
  assert.throws(
    () =>
      a.controlExecution({
        id,
        baseRevision: r.revision,
        action: "pause",
        paused: false,
      }),
    /已变化/,
  );
});
test("regeneration is explicit, scoped to text and leaves authorization unchanged", async (t) => {
  fixture(t);
  const x = task(),
    id = runOf(x.taskId);
  const stop = a.startTaskQueue(async () => ({ text: "您好" }));
  t.after(stop);
  await a.taskQueueTick();
  let r = a.executionRunRow(id);
  assert.throws(
    () =>
      a.controlExecution({
        id,
        baseRevision: r.revision,
        action: "regenerate",
        instruction: "简短些",
      }),
    /确认/,
  );
  const before = a.careerPolicy();
  const next = a.controlExecution({
    id,
    baseRevision: r.revision,
    action: "regenerate",
    instruction: "简短些",
    confirmNewCall: true,
  });
  assert.notEqual(next.taskId, x.taskId);
  assert.equal(a.taskRun(next.taskId).state, "queued");
  assert.deepEqual(a.careerPolicy(), before);
  assert.equal(a.executionDetail(next.executionId).parent.id, id);
  assert.throws(
    () =>
      a.controlExecution({
        id,
        baseRevision: r.revision,
        action: "regenerate",
        instruction: "简短些",
        confirmNewCall: true,
      }),
    /已变化/,
  );
});
test("incremental events have stable cursors and unchanged heartbeats add no events", (t) => {
  fixture(t);
  const x = task(),
    id = runOf(x.taskId);
  const first = a.executionEvents({ id });
  assert.ok(first.items.length);
  assert.equal(a.executionEvents({ id, after: first.cursor }).items.length, 0);
  a.executionTaskChanged({
    id: x.taskId,
    kind: "career-reply-draft",
    accountId: "account-a",
    state: "running",
    step: "处理中",
  });
  const second = a.executionEvents({ id, after: first.cursor });
  assert.equal(second.items.length, 1);
  assert.ok(second.cursor > first.cursor);
});
test("encrypted restore retains links and stops unfinished execution", (t) => {
  fixture(t);
  const x = task(),
    id = runOf(x.taskId);
  const data = a.exportEncryptedBackup("isolated-password-123");
  a.restoreEncryptedBackup({
    password: "isolated-password-123",
    base64: data.base64,
    confirm: true,
  });
  const d = a.executionDetail(id);
  assert.equal(d.run.paused, 1);
  assert.equal(d.run.underlyingState, "interrupted");
  assert.ok(d.links.some((l) => l.ref_id === x.taskId));
  assert.equal(a.allAutomationPaused(), true);
});
test("5000 runs and 50000 events remain paginated below one second P95", (t) => {
  const { db } = fixture(t),
    at = new Date().toISOString();
  a.atlasTransaction(() => {
    const insert = db.prepare(
      "INSERT INTO execution_runs(id,account_id,owner_kind,owner_id,title,object_kind,object_id,source,state,created_at,updated_at) VALUES(?,'account-a','task',?,'示例','job',?,'manual','completed',?,?)",
    );
    const event = db.prepare(
      "INSERT INTO execution_events(run_id,kind,state,summary,created_at) VALUES(?,'step','completed','完成',?)",
    );
    for (let i = 0; i < 5000; i++) {
      const id = "load-" + i;
      insert.run(id, id, "job-" + i, at, at);
      for (let n = 0; n < 10; n++) event.run(id, at);
    }
  });
  const timings = [];
  for (let i = 0; i < 30; i++) {
    let started = performance.now();
    const list = a.executionList({ page: i + 1, state: "all" });
    assert.equal(list.items.length, 20);
    a.executionEvents({ id: list.items[0].id });
    timings.push(performance.now() - started);
  }
  const p95 = timings.sort((a, b) => a - b)[28];
  assert.ok(p95 < 1000, "P95 " + p95);
  console.log("Execution pagination P95:", Math.round(p95), "ms");
});

test("one run is discoverable by both job and conversation without fuzzy association", (t) => {
  fixture(t);
  const x = task("career-reply-draft", {
    accountId: "account-a",
    bossId: "boss-a",
    jobId: "job-a",
    incoming: "你好",
  });
  assert.equal(
    a.executionList({ objectId: "job-a" }).items[0].id,
    runOf(x.taskId),
  );
  assert.equal(a.executionList({ objectId: "boss-a" }).total, 1);
  assert.equal(a.executionList({ objectId: "another-boss" }).total, 0);
});
test("cancelled reply stays skipped instead of advertising a resumable pause", (t) => {
  fixture(t);
  const e = event();
  a.saveReplyEvent(e);
  const id = runOf("reply:" + e.id);
  a.controlExecution({
    id,
    baseRevision: a.executionRunRow(id).revision,
    action: "cancel",
  });
  assert.equal(a.executionDetail(id).run.state, "skipped");
  assert.equal(a.executionList({ state: "active" }).total, 0);
});
test("abandoned sends update the same trace to uncertain without replay", (t) => {
  const { db } = fixture(t),
    e = event();
  a.saveReplyEvent(e);
  a.setAllAutomationPaused(false);
  a.setRuntime({ paused: false });
  assert.equal(
    a.claimSend({
      id: e.id,
      platform: "boss",
      accountId: e.userId,
      recipientId: e.bossId,
      kind: "reply",
      automatic: false,
      text: "您好",
    }),
    "",
  );
  db.prepare("UPDATE send_attempts SET updated_at=? WHERE id=?").run(
    new Date(Date.now() - 180000).toISOString(),
    e.id,
  );
  assert.equal(a.recoverAbandonedSends(), 1);
  const d = a.executionDetail(runOf("reply:" + e.id));
  assert.equal(
    d.steps.find((s) => s.id === "step:send:" + e.id).state,
    "uncertain",
  );
  assert.equal(d.sends[0].status, "uncertain");
  assert.equal(a.recoverAbandonedSends(), 0);
});
test("process restart interrupts outstanding model and tool steps without new calls", async (t) => {
  const { db } = fixture(t),
    x = task();
  db.prepare(
    "UPDATE task_runs SET state='running',heartbeat_at=? WHERE id=?",
  ).run(new Date(Date.now() - 180000).toISOString(), x.taskId);
  a.withExecutionTask(x.taskId, () =>
    a.beginModelExecution("old-model", "account-a", "reply", {}),
  );
  let called = 0;
  const stop = a.startTaskQueue(async () => {
    called++;
    return {};
  });
  t.after(stop);
  await a.taskQueueTick();
  const d = a.executionDetail(runOf(x.taskId));
  assert.equal(d.run.state, "interrupted");
  assert.ok(d.steps.every((s) => s.state === "interrupted"));
  assert.equal(called, 0);
});
test("schema 6 encrypted archive restores into 7 without fabricated historical traces", (t) => {
  const { db } = fixture(t);
  task();
  const password = "legacy-backup-password",
    backup = a.exportEncryptedBackup(password),
    clear = a.inspectBackup({ password, base64: backup.base64 });
  clear.tables.atlas_migrations = clear.tables.atlas_migrations.filter(
    (r) => r.version < 7,
  );
  for (const k of Object.keys(clear.tables))
    if (k.startsWith("execution_")) delete clear.tables[k];
  const c = require("node:crypto"),
    z = require("node:zlib"),
    salt = c.randomBytes(16),
    iv = c.randomBytes(12),
    key = c.scryptSync(password, salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }),
    cipher = c.createCipheriv("aes-256-gcm", key, iv),
    encrypted = Buffer.concat([
      cipher.update(z.gzipSync(Buffer.from(JSON.stringify(clear)))),
      cipher.final(),
    ]),
    base64 = Buffer.concat([
      Buffer.from("ATLASBK1"),
      salt,
      iv,
      cipher.getAuthTag(),
      encrypted,
    ]).toString("base64");
  a.restoreEncryptedBackup({ password, base64, confirm: true });
  assert.equal(
    db.prepare("SELECT max(version) v FROM atlas_migrations").get().v,
    7,
  );
  assert.equal(a.executionList().total, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM task_runs").get().n, 1);
  assert.equal(a.allAutomationPaused(), true);
});

test("terminal cancelled flow never offers resume and nested analysis evidence resolves original facts", (t) => {
  const { db } = fixture(t),
    x = task();
  pause(runOf(x.taskId));
  a.cancelTask(x.taskId);
  assert.equal(a.executionView(runOf(x.taskId)).capabilities.pause, false);
  const next = task("career-ai-analyze", {
      job: { encryptJobId: "nested-job", description: "产品职责" },
    }),
    profileVersion = db
      .prepare("SELECT id FROM profile_versions ORDER BY version DESC LIMIT 1")
      .get().id;
  db.prepare("UPDATE task_runs SET state='completed',result=? WHERE id=?").run(
    JSON.stringify({
      analysis: { requirements: [{ evidenceIds: ["e1", "unknown"] }] },
      profileVersion,
    }),
    next.taskId,
  );
  assert.deepEqual(
    a.executionDetail(runOf(next.taskId)).evidence.map((e) => e.id),
    ["e1"],
  );
});
