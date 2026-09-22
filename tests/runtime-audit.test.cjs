const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const { auditRuntime, inspectGraph } = require('../scripts/atlas-runtime-audit.cjs');
const root = process.cwd();

test('desktop, service and preload use Atlas sources and declared runtime dependencies', () => {
  const result = auditRuntime(root);
  assert.deepEqual(result.workspaces, ['ui']);
  assert.equal(result.graphs.length, 3);
  assert.ok(result.graphs.every(graph => graph.inputCount > 0));
  assert.deepEqual(result.issues, []);
});

test('externalizing a removed execution package cannot hide it from the runtime audit', () => {
  const result = buildSync({
    stdin: { contents: "import 'geek-auto-start-chat-with-boss';", sourcefile: 'packages/ui/src/fixture.ts', resolveDir: root },
    bundle: true, platform: 'node', packages: 'external', metafile: true, write: false,
  });
  const report = inspectGraph(result.metafile, root, ['geek-auto-start-chat-with-boss']);
  assert.ok(report.issues.some(issue => issue.rule === 'unexpected-runtime-dependency'));
});

test('retired flow source is blocked while compatibility paths and platform URLs remain plain data', () => {
  const meta = { inputs: { 'packages/ui/src/main/flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/index.ts': {} }, outputs: { 'index.js': { imports: [] } } };
  assert.ok(inspectGraph(meta, root).issues.some(issue => issue.rule === 'non-atlas-runtime-input'));
  const result = buildSync({
    stdin: { contents: "export const route = 'GeekAutoStartChatWithBoss'; export const data = '.geekgeekrun'; export const platform = '/web/geek/jobs';", sourcefile: 'packages/ui/src/fixture.ts', resolveDir: root },
    bundle: true, platform: 'node', metafile: true, write: false,
  });
  assert.deepEqual(inspectGraph(result.metafile, root).issues, []);
});
