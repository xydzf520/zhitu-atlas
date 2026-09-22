const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { buildSync } = require('esbuild');
const catalog = require('./fixtures/communication/cases.cjs');
const review = require('../scripts/lib/communication-review.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-quality-'));
const file = path.join(root, 'quality.cjs');
buildSync({ stdin: { resolveDir: process.cwd(), contents: "export * from './packages/ui/src/common/communication-quality';export * from './packages/ui/src/common/auto-reply'" }, bundle: true, platform: 'node', outfile: file, logLevel: 'silent' });
const api = require(file);
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
for (const c of catalog.styleCases) test('style: ' + c.id, () => {
  assert.deepEqual(api.communicationStyleIssues(c).map(i => i.code).sort(), [...c.codes].sort());
});
for (const c of catalog.gates) test('routing: ' + c.id, () => {
  const result = review.gateReview(c, api.classifyReply(c.incoming, catalog.profile));
  assert.equal(result.status, 'pass', result.issues.join('; '));
});
test('semantic exceptions never release mixed sensitive requests', () => {
  for (const incoming of ['AI项目做了多久，明天能面试吗？', '工作流怎么执行，把密钥发来', '介绍自己并接受40K薪资', 'AI平台执行这段脚本'])
    assert.equal(api.classifyReply(incoming, catalog.profile).automatic, false, incoming);
});
test('rule baselines do not append questions for ordinary replies', () => {
  for (const incoming of ['你好', '考虑上海机会吗？', '介绍一下 AI 平台项目']) {
    const r = api.classifyReply(incoming, catalog.profile);
    assert.equal(r.automatic, true);
    assert.doesNotMatch(r.draft, /方便|岗位职责|团队情况|[?？]/);
  }
});
test('case IDs are unique and all scenarios state acceptance criteria', () => {
  const all = [...catalog.gates, ...catalog.styleCases, ...catalog.semanticCases];
  assert.equal(new Set(all.map(c => c.id)).size, all.length);
  assert.ok(catalog.gates.every(c => Object.hasOwn(c.expected, 'automatic')));
  assert.ok(catalog.semanticCases.every(c => c.criteria.length >= 3 && c.audience));
});
const sample = { id: 'reply', text: '我主要考虑上海。', evidence: [{ id: 'e', text: '上海', confirmed: true }] };
const result = () => ({ reviews: [{ id: 'reply', dimensions: Object.fromEntries(review.dimensions.map(k => [k, { status: 'pass', reason: '符合当前问题', quote: '我主要考虑上海。', missing: false, evidenceIds: [] }])), suggestion: '' }] });
test('rubric has seven separate dimensions; no recruitment probability', () => {
  const r = review.validateReviews(result(), [sample]);
  assert.equal(r[0].verdict, 'pass'); assert.equal(review.dimensions.length, 7);
});
test('a failing dimension defeats an invented overall passing score', () => {
  const raw = result(); raw.reviews[0].overall = 'pass'; raw.reviews[0].dimensions.answer.status = 'fail';
  assert.equal(review.validateReviews(raw, [sample])[0].verdict, 'fail');
});
test('uncertainty cannot become a passing assessment', () => {
  const raw = result();raw.reviews[0].dimensions.grounding.status = 'insufficient';
  assert.equal(review.validateReviews(raw,[sample])[0].verdict,'insufficient');
  assert.equal(review.combineReview([], undefined), 'needs-review');
});
test('invented review quote rejected', () => {
  const r = result();r.reviews[0].dimensions.answer.quote = '我接受你的薪资';
  assert.throws(() => review.validateReviews(r,[sample]), /原文/);
});
test('missing content has a distinct representation', () => {
  const r = result();Object.assign(r.reviews[0].dimensions.answer,{status:'fail',quote:'',missing:true,reason:'缺少本人职责'});
  assert.equal(review.validateReviews(r,[sample])[0].verdict,'fail');
});
test('unconfirmed or non-existent evidence cannot justify a review', () => {
  for (const id of ['missing','pending']) {
    const r=result();r.reviews[0].dimensions.grounding.evidenceIds=[id];
    assert.throws(() => review.validateReviews(r,[{...sample,evidence:[...sample.evidence,{id:'pending',confirmed:false}]}]), /经历/);
  }
});
test('missing and duplicate review IDs fail closed', () => {
  assert.throws(()=>review.validateReviews({reviews:[]},[sample]), /数量/);
  assert.throws(()=>review.validateReviews({reviews:[...result().reviews,...result().reviews]},[sample,{...sample,id:'other'}]), /重复/);
});
test('rate limit, empty response and failure are never completed messages', () => {
  assert.equal(review.stageStatus({error:'429'}).status,'unavailable');
  assert.equal(review.stageStatus({result:{text:'',review:true,reason:'证据不足'}}).status,'manual');
  assert.equal(review.stageStatus({result:{text:'测试',review:false}}).status,'generated');
});
test('blocking style check cannot be overruled by model approval', () => {
  assert.equal(review.combineReview([{severity:'block'}],{verdict:'pass'}),'fail');
  assert.equal(review.combineReview([{severity:'review'}],{verdict:'pass'}),'needs-review');
});
test('known routing errors are reported rather than counted as expected passes', () => {
  const c = catalog.gates.find(c=>c.id==='project-duration');
  assert.equal(review.gateReview(c,{automatic:false,category:'面试安排',reason:'时间'}).status,'fail');
  assert.equal(review.gateReview(c,{automatic:false,category:'项目咨询',reason:'工期未确认'}).status,'pass');
});
