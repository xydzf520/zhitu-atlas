// Real configured-provider check, isolated from user data and all platform actions.
// Requires --real. Copies only the existing model configuration to a private temp directory.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { buildSync } = require("esbuild");
const {evaluationSource,copyEvaluationConfig}=require('./lib/evaluation-config.cjs');
async function main() {
  if (!process.argv.includes("--real"))
    throw Error("Use --real to allow the configured model diagnostic.");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-execution-model-")),
    out = path.resolve(
      process.argv.find((a) => a.startsWith("--out="))?.slice(6) ||
        "artifacts/agent-workbench-20260921/real-model.json",
    );
  let api, stop;
  const actualFetch = global.fetch,
    requests = [];
  try {
    fs.mkdirSync(path.join(root, "config"), { mode: 0o700 });
    copyEvaluationConfig(evaluationSource(),root);
    process.env.ATLAS_DATA_ROOT = root;
    const bundle = path.join(root, "api.cjs");
    buildSync({
      stdin: {
        resolveDir: process.cwd(),
        contents: [
          "atlas-store",
          "atlas-task-queue",
          "atlas-execution",
          "atlas-deepseek",
          "atlas-model-config",
          "atlas-policy",
        ]
          .map((n) => `export * from './packages/ui/src/main/features/${n}'`)
          .join("\n"),
      },
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: bundle,
      logLevel: "silent",
    });
    api = require(bundle);
    api.initializePolicy();
    api.setAllAutomationPaused(true);
    const config = api.modelConfig(),
      endpoint = new URL(config.url);
    global.fetch = async (url, opts = {}) => {
      const u = new URL(String(url));
      if (u.origin !== endpoint.origin || u.pathname !== endpoint.pathname)
        throw Error("Non-model request blocked");
      const r = await actualFetch(url, { ...opts, redirect: "error" });
      requests.push({ status: r.status });
      return r;
    };
    const task = api.createTask({
      channel: "career-model-test",
      payload: { baseRevision: config.revision },
    });
    stop = api.startTaskQueue((channel, payload) => {
      assert.equal(channel, "career-model-test");
      return api.testModel(payload);
    });
    await api.taskQueueTick();
    const result = api.taskRun(task.taskId),
      trace = api.executionDetail(result.executionId),
      tools = trace.steps.filter((s) => s.label.startsWith("工具："));
    const report = {
      model: config.model,
      state: result.state,
      result: result.result,
      error: result.error || undefined,
      requests,
      steps: trace.steps.map((s) => ({
        label: s.label,
        actor: s.actor,
        state: s.state,
        parent: !!s.parent_id,
      })),
      modelCalls: trace.modelCalls.map((c) => ({
        model: c.model,
        status: c.status,
        usage: c.usage,
      })),
      sends: api.atlasDb().prepare("SELECT count(*) n FROM send_attempts").get()
        .n,
      at: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
    fs.writeFileSync(out, JSON.stringify(report, null, 2), { mode: 0o600 });
    assert.equal(result.state, "completed", result.error);
    assert.equal(result.result.toolCalling, true);
    assert.ok(tools.length && tools.every((s) => s.state === "completed"));
    assert.equal(report.sends, 0);
    console.log(
      JSON.stringify({
        report: out,
        state: result.state,
        tools: tools.length,
        requests: requests.length,
        sends: report.sends,
      }),
    );
  } finally {
    stop?.();
    global.fetch = actualFetch;
    api?.closeAtlas();
    delete process.env.ATLAS_DATA_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
