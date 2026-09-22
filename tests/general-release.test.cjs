const { test, after } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { buildSync } = require('esbuild');
const { copyEvaluationConfig } = require('../scripts/lib/evaluation-config.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-general-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const file = path.join(root, 'common.cjs');
buildSync({
  stdin: {
    resolveDir: process.cwd(),
    contents:
      "export * from './packages/ui/src/common/salary';export * from './packages/ui/src/common/setup';export * from './packages/ui/src/common/career';export * from './packages/ui/src/common/greeting';export * from './packages/ui/src/common/auto-reply'"
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: file,
  logLevel: 'silent'
});
const a = require(file);
test('setup distinguishes required local preparation from optional AI and platform connections', () => {
  const p = a.emptyCareerState().profile;
  let steps = a.setupSteps(p, false, false);
  assert.equal(steps.filter((s) => s.done).length, 0);
  assert.deepEqual(
    steps.filter((s) => s.optional).map((s) => s.id),
    ['model', 'platform']
  );
  p.resumeText = '示例经历';
  p.evidence = [{ confirmed: true }];
  p.targetRoles = ['护士'];
  p.preferredCities = ['南京'];
  steps = a.setupSteps(p, false, false);
  assert.ok(steps.filter((s) => !s.optional).every((s) => s.done));
  assert.equal(a.careerExamples.length, 4);
});
test('evaluation snapshots use current private config, preserve source and reject conflicts', () => {
  const source = path.join(root, 'source'),
    target = path.join(root, 'snapshot');
  fs.mkdirSync(path.join(source, 'private'), { recursive: true });
  fs.mkdirSync(path.join(source, 'config'));
  const current = JSON.stringify([{ enabled: true, providerApiSecret: 'fixture-model-key' }]);
  fs.writeFileSync(path.join(source, 'private/models.json'), current);
  copyEvaluationConfig(source, target);
  assert.equal(fs.readFileSync(path.join(source, 'private/models.json'), 'utf8'), current);
  assert.equal(fs.statSync(path.join(target, 'private/models.json')).mode & 0o777, 0o600);
  fs.writeFileSync(path.join(source, 'config/llm.json'), '[]');
  assert.throws(() => copyEvaluationConfig(source, path.join(root, 'conflict')), /冲突/);
  assert.throws(() => copyEvaluationConfig(source, source), /隔离/);
});

test('percentage rules preserve any metric scope without reserving 20 percent for one resume', () => {
  a.assertMetricScopes('活动转化率达到20%。', '活动转化率达到20%。');
  a.assertMetricScopes('深圳地区员工使用覆盖率为35%。', '深圳地区员工使用覆盖率为35%。');
  assert.throws(
    () => a.assertMetricScopes('全国员工使用覆盖率为35%。', '深圳地区员工使用覆盖率为35%。'),
    /指标口径/
  );
  assert.throws(() => a.assertMetricScopes('效率提升20%。', '活动转化率达到20%。'), /指标口径/);
});
test('routine location replies respect any selected city and never accept another city', () => {
  const p = { ...a.emptyCareerState().profile, preferredCities: ['成都'], targetRoles: ['会计'] };
  assert.equal(a.classifyReply('主要考虑哪个工作城市？', p).automatic, true);
  assert.equal(a.classifyReply('考虑远程工作吗？', p).automatic, false);
  assert.equal(a.classifyReply('考虑成都机会吗？', p).automatic, true);
  assert.match(a.classifyReply('考虑成都机会吗？', p).draft, /成都/);
  assert.equal(a.classifyReply('考虑上海机会吗？', p).automatic, false);
  assert.equal(a.classifyReply('考虑成都机会吗？', { ...p, preferredCities: [] }).automatic, false);
});

test('salary charts adapt to lower and higher pay samples with exclusive boundaries', () => {
  assert.deepEqual(a.salaryDistribution([]), []);
  for (const sample of [[3,4,5,6,8],[8,10,12,15,20],[25,30,40,50],[40,60,80,100]]) {
    const bands = a.salaryDistribution(sample);
    assert.equal(bands.reduce((n,b)=>n+b.count,0),sample.length);
    assert.ok(bands.filter(b=>b.count).length>=2);
  }
  assert.equal(a.salaryDistribution([4,6])[2].min,4);
  assert.equal(a.salaryDistribution([40,60])[2].min,40);
  assert.equal(a.salaryDistribution([0,-1,NaN,Infinity,5]).reduce((n,b)=>n+b.count,0),1);
});
