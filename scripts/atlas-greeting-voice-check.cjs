// 使用合成履历与合成 JD 的招呼语冒烟测试，不代表用户真实经历或实际话术质量。
// 即使 --real 也只是调用真实模型，输入仍为合成数据。
// 真实资料的 HR / 用人负责人评估请使用 atlas-communication-evaluation.cjs。
// 用法：
//   node scripts/atlas-greeting-voice-check.cjs --real            # 调用项目配置的真实模型
//   node scripts/atlas-greeting-voice-check.cjs --mock            # 离线模拟模型（CI/回归）
//   node scripts/atlas-greeting-voice-check.cjs --real --out=artifacts/greeting-voice
// 说明：--real 会消耗真实模型额度；每个招呼含“写作 + 独立审校”两次调用。
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  vm = require("node:vm"),
  { buildSync } = require("esbuild");

const {evaluationSource,copyEvaluationConfig}=require('./lib/evaluation-config.cjs');
const real = process.argv.includes("--real");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const outDir = path.resolve(outArg ? outArg.slice(6) : "artifacts/greeting-voice");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-voice-")),
  bundle = path.join(root, "api.cjs");
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents: [
      "atlas-store",
      "atlas-profile",
      "atlas-greeting",
      "atlas-agents",
      "atlas-tasks",
      "atlas-portfolio",
      "atlas-ai",
      "atlas-model-config",
      "atlas-model-transport",
      "atlas-deepseek",
      "atlas-discovery-state",
      "atlas-boss-sync",
      "career-boss-data",
      "career-workspace-service",
      "atlas-policy",
      "atlas-conversation-pitch",
    ]
      .map((s) => `export * from './packages/ui/src/main/features/${s}'`)
      .join("\n") +
    "\nexport * from './packages/ui/src/common/career'" +
    "\nexport * from './packages/ui/src/common/greeting'" +
    "\nexport * from './packages/ui/src/common/portfolio'",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
});
process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));

const home = fs.mkdtempSync(path.join(root, "home-")),
  config = path.join(home, ".local/share/zhitu-atlas/config");
fs.mkdirSync(config, { recursive: true });
if (real) {
  copyEvaluationConfig(evaluationSource(),path.dirname(config));
} else {
  fs.writeFileSync(
    path.join(config, "llm.json"),
    JSON.stringify([
      {
        enabled: true,
        model: "deepseek-flash",
        providerApiSecret: "fixture-key",
        providerCompleteApiUrl: "https://api.deepseek.com/chat/completions",
      },
    ]),
  );
}

// --mock：返回写实但固定的“模型”输出，用于离线回归；--real：走项目真实模型。
const mockFetch = async (url, opts) => {
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  const isReview = String(body.messages?.[0]?.content || "").includes("审校员");
  const value = isReview
    ? { grounded: true, relevant: true, concise: true, noCommitments: true, issues: [] }
    : {
        decision: "draft",
        matches: [{ requirementId: "r0", evidenceId: "app", evidenceQuote: "我主导 C 端 App 从 0 到 1 建设，统筹需求评审与上线，产品日活 8 万、累计用户 300 万。", relevance: "从 0 到 1 建设与多端协同经历，对应该岗位的产品规划与交付需求。" }],
        opening: "看到这个岗位要把 C 端产品从零立起来并推动多端一致",
        closing: "discuss",
        gaps: [],
      };
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(value) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
    }),
  };
};
const fetchImpl = real ? (url, opts) => fetch(url, opts) : mockFetch;

const m = { exports: {} };
vm.runInNewContext(
  "(function(require,module,exports){" + fs.readFileSync(bundle, "utf8") + "\n})",
  {
    Buffer,
    process: { ...process, env: { ...process.env, ATLAS_DATA_ROOT: undefined } },
    Date,
    URL,
    fetch: fetchImpl,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  },
)((k) => (k === "node:os" ? { homedir: () => home } : require(k)), m, m.exports);
const api = m.exports;

// —— 合成测试履历（仅供隔离测试，指标不得写入真实简历或发送给招聘者）——
const evidence = [
  { id: "app", title: "C 端 App 产品", text: "我主导 C 端 App 从 0 到 1 建设，统筹需求评审与上线，产品日活 8 万、累计用户 300 万。", keywords: ["App", "C端", "从0到1"], source: "本人", confirmed: true },
  { id: "saas", title: "B 端 SaaS 平台", text: "负责企业 SaaS 平台的产品规划与需求分析，推动多产品线能力复用与交付。", keywords: ["SaaS", "企业", "B端", "平台"], source: "本人", confirmed: true },
  { id: "growth", title: "数据驱动增长", text: "通过分析产品使用数据制定迭代路线，搭建增长实验体系，核心流程转化率提升 35%。", keywords: ["数据", "增长", "转化"], source: "本人", confirmed: true },
];
const handlers = new Map();
api.registerCareerWorkspace((k, f) => handlers.set(k, f), () => {});
let snap = handlers.get("career-workspace-snapshot")();
snap.state.profile = {
  name: "董正",
  headline: "产品负责人",
  summary: "",
  resumeText: evidence.map((e) => e.text).join("\n"),
  targetRoles: ["产品经理", "产品负责人"],
  preferredCities: ["上海"],
  minimumMonthlyK: 40,
  evidence,
};
handlers.get("career-workspace-save")({}, { state: JSON.stringify(snap.state), baseRevision: snap.revision });
api.initializePolicy();
api.setRuntime({ paused: false, outbound: true, startHour: 0, endHour: 23 });
api.setAllAutomationPaused(false);

// —— 多个差异化 JD 场景 ——
const scenarios = [
  { tag: "C端AI产品", job: { jobName: "AI 产品经理（C 端）", companyName: "星河智能", address: "上海", salaryHigh: 60, description: "负责 C 端 AI 助手从 0 到 1 的产品规划与需求分析，主导多产品融合和上线落地。通过分析用户使用数据制定迭代路线，推动多端体验一致性，协调研发、设计与运营团队，对业务目标与产品规模做出清晰说明。" } },
  { tag: "B端SaaS产品", job: { jobName: "SaaS 产品经理", companyName: "云枢科技", address: "上海", salaryHigh: 55, description: "负责企业级 SaaS 平台的产品规划与需求分析，抽象多产品线通用能力并推动复用，深度参与从需求评审到上线交付的全过程；服务中大型客户，与销售、实施协同达成续约与增购目标，对平台易用性与交付效率做出清晰说明。" } },
  { tag: "增长产品", job: { jobName: "增长产品经理", companyName: "潮汐数据", address: "上海", salaryHigh: 50, description: "以数据驱动增长，负责核心注册、激活与留存链路的产品优化，设计并运行增长实验，分析漏斗与转化数据并制定迭代路线；与运营、研发协同提升关键指标，对业务目标与当前规模做出清晰说明，重视真实的实验结论。" } },
  { tag: "数据平台产品", job: { jobName: "数据平台产品经理", companyName: "数澜科技", address: "上海", salaryHigh: 55, description: "负责企业数据平台的产品规划与需求分析，抽象数据接入、建模与可视化能力并推动多业务线复用；深度参与从需求评审到上线交付全过程，服务内部数据消费者，与数据工程、算法协同提升数据易用性与交付效率。" } },
  { tag: "策略产品", job: { jobName: "策略产品经理", companyName: "潮汐数据", address: "上海", salaryHigh: 55, description: "负责内容推荐与分发策略的产品化，基于用户行为数据制定策略迭代路线，设计并评估策略实验，平衡用户体验与业务指标；与算法、工程协同落地，对策略效果与核心指标做出清晰说明，重视真实的实验结论。" } },
];

(async () => {
  const lines = [];
  const push = (s) => { lines.push(s); console.log(s); };
  push(`# 合成履历招呼语冒烟报告（${real ? "真实模型，合成输入" : "模拟模型，合成输入"}）`);
  push('> 以下人物、经历指标及岗位均为测试样例，不能作为用户真实话术的评估依据。');
  push(`> 生成时间：${new Date().toISOString()}　模型：${(() => { try { return api.deepseekConfig().model } catch { return "?" } })()}`);
  push(`> 评估视角：以下每条请以“收到招呼的 BOSS/HR”身份判断：像不像真人写的？有没有模板味/AI 味？\n`);
  for (const sc of scenarios) {
    push(`## ${sc.tag}｜${sc.job.companyName} · ${sc.job.jobName}`);
    try {
      const r = await api.generateGreeting({ job: sc.job, purpose: "preview" });
      const allEndings = Object.values(api.GREETING_ENDINGS).flat();
      const ending = allEndings.find((e) => r.text.endsWith(e)) || "（未匹配到固定结尾）";
      push("**招呼全文：**");
      push("> " + r.text.replace(/\n/g, "\n> "));
      push(`- 选用结尾：「${ending}」`);
      push(`- 引用经历：${r.matches.map((x) => x.evidenceId).join("、") || "无"}　字数：${r.text.length}　审校：grounded=${r.quality.grounded} relevant=${r.quality.relevant} concise=${r.quality.concise} noCommitments=${r.quality.noCommitments}`);
      push(`- reviewReasons：${r.reviewReasons?.join("；") || "无"}`);
    } catch (e) {
      push(`**生成失败：** ${e.message}`);
    }
    push("");
  }
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `greeting-voice-${real ? "real" : "mock"}-${Date.now()}.md`);
  fs.writeFileSync(file, lines.join("\n"));
  console.log(`\n报告已写入：${file}`);
  api.closeAtlas?.();
})().catch((e) => { console.error(e); process.exit(1); });
