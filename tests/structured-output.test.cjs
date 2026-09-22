const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { transformSync } = require("esbuild"),
  fs = require("node:fs");
const m = { exports: {} };
new Function(
  "module",
  "exports",
  transformSync(
    fs.readFileSync("packages/ui/src/common/structured-output.ts", "utf8"),
    { loader: "ts", format: "cjs" },
  ).code,
)(m, m.exports);
const { structureText, snapshotChanges } = m.exports;
const textOf = (sections) =>
  sections
    .flatMap((s) => s.blocks.map((b) => (b.marker || "") + b.text))
    .join("")
    .replace(/\s/g, "");
test("collapsed JD separates explicit headings and all consecutive items, including lost punctuation", () => {
  const input =
    "职位概述负责产品规划与增长。核心职责1. 深入分析业务数据，收集客户反馈。2. 定义产品路线图并验证需求。3. 优化体验，在竞争中积累优势4. 领导跨职能团队交付。5. 持续迭代。任职要求 1. 本科及以上学历。2. 5年以上产品经验。3. 熟悉PLG增长。加分项 1. CAD产品经验。2. 多端设计经验。我们提供：- 开放文化。- 团队支持。";
  const s = structureText(input);
  assert.deepEqual(
    s.map((x) => x.title),
    ["职位概述", "核心职责", "任职要求", "加分项", "我们提供"],
  );
  assert.deepEqual(
    s.map((x) => x.blocks.length),
    [1, 5, 3, 2, 2],
  );
  assert.equal(s.map((x) => x.raw).join(""), input);
  assert.equal(s[1].blocks[3].marker, "4.");
  assert.equal(s[2].blocks[1].text, "5年以上产品经验。");
});
test("salary, decimals, dates, URLs, and versions never become list delimiters", () => {
  const text =
    "1. 预算40.5K，负责版本v2.0，日期2026.09.17，参考 https://example.com/v3.1。2. 目标20%，团队25人。";
  const s = structureText(text);
  assert.equal(s[0].blocks.length, 2);
  assert.equal(textOf(s), text.replace(/\s/g, ""));
  for (const input of [
    "40.5K · 14薪",
    "2026.09.17",
    "https://example.com/a1.0",
    "5.0年以上经验",
  ])
    assert.equal(structureText(input)[0].blocks[0].kind, "paragraph");
});
test("headings mentioned inside a sentence are not fabricated sections", () => {
  const text = "我们希望你理解任职要求，并协助梳理岗位职责和团队目标。";
  const s = structureText(text);
  assert.equal(s.length, 1);
  assert.equal(s[0].title, "正文");
  assert.equal(s[0].blocks[0].text, text);
});
test("markdown, Chinese and parenthesized numbering are readable without executing markup", () => {
  const text =
    "## 团队使命\r\n让产品更好。\r\n【岗位职责】\n（一）需求分析\n（二）持续迭代\n任职要求：\n(1) 沟通\n(2) 协作\n<script>alert(1)</script>";
  const s = structureText(text);
  assert.equal(s[0].title, "团队使命");
  assert.deepEqual(
    s[1].blocks.map((b) => b.marker),
    ["（一）", "（二）"],
  );
  assert.equal(s.map((x) => x.raw).join(""), text);
  assert.ok(textOf(s).includes("<script>alert(1)</script>"));
  assert.deepEqual(
    structureText("任职要求：一、需求分析；二、持续迭代。")[0].blocks.map(
      (b) => b.marker,
    ),
    ["一、", "二、"],
  );
});
test("blank and unrecognized prose stay honest; long prose has no omitted content", () => {
  assert.deepEqual(structureText(" \n "), []);
  const input = "需要认真理解业务背景以及使用场景。".repeat(2500);
  const s = structureText(input);
  assert.equal(s[0].title, "正文");
  assert.ok(s[0].blocks.length > 1);
  assert.equal(textOf(s), input);
  assert.equal(s[0].raw, input);
});
test("snapshot changes compare fields against the preceding captured version only", () => {
  const prev = {
    description: "旧正文",
    salaryDesc: "40K",
    address: "上海",
    jobName: "产品经理",
  };
  assert.deepEqual(
    snapshotChanges(
      { ...prev, description: "新正文", salaryDesc: "50K" },
      prev,
    ),
    ["薪资", "岗位正文"],
  );
  assert.deepEqual(snapshotChanges(prev, prev), []);
  assert.deepEqual(snapshotChanges(prev), []);
});
test("structured reader never renders collected or model content as HTML", () => {
  for (const name of ["StructuredText", "AnalysisReport", "GreetingComposer"])
    assert.ok(
      !fs
        .readFileSync(
          `packages/ui/src/renderer/src/components/career/${name}.vue`,
          "utf8",
        )
        .includes("v-html"),
    );
});
test('resume sections preserve employer/project order and dates without splitting narrative mentions',()=>{
 const source='测试用户\n个人优势\n产品规划与管理\n工作经历\n甲公司 2021.03—2025.03\n负责工作经历信息管理和团队建设。\n项目经历\n技能平台 2025.03—2026.09\n教育背景\n测试专业';
 const s=structureText(source,'resume');
 assert.deepEqual(s.map(v=>v.title),['正文','个人优势','工作经历','项目经历','教育背景']);
 assert.equal(s.map(v=>v.raw).join(''),source);
 assert.match(s[2].blocks.map(v=>v.text).join(''),/甲公司 2021.03—2025.03.*负责工作经历/);
 assert.match(s[3].blocks[0].text,/技能平台 2025.03—2026.09/);
});
test('resume preview recognizes bold and markdown section headings without interpreting HTML',()=>{
 const source='**个人优势**\n真实成果\n## 企业 AI 系统\n<script>not executed</script>\n【工作经历】\n测试公司';
 const s=structureText(source,'resume');
 assert.deepEqual(s.map(v=>v.title),['个人优势','企业 AI 系统','工作经历']);
 assert.equal(s.map(v=>v.raw).join(''),source);
 assert.equal(s[1].blocks[0].text,'<script>not executed</script>');
});
