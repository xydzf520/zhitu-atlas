const fs = require('node:fs');
const path = require('node:path');
const { isBuiltin } = require('node:module');
const { buildSync } = require('esbuild');

const entries = [
  'packages/ui/src/main/index.ts',
  'packages/ui/src/main/service.ts',
  'packages/ui/src/preload/index.ts',
];
const retired = /geekgeekrun|geek-auto-start|run-core-of-geek|launch-bosszhipin-login-page|sqlite-plugin|dingtalk-plugin|(?:^|\/)laodeng(?:\/|$)|(?:^|\/)src\/main\/flow\//i;

// Inspect resolved modules, not string values: old route names and data paths
// are compatibility data and must not be confused with loaded execution code.
function inspectGraph(meta, root, dependencies = []) {
  const issues = [];
  const inputs = Object.keys(meta.inputs).map(file => path.relative(root, path.resolve(root, file)).replaceAll('\\', '/'));
  for (const file of inputs) {
    if (!file.startsWith('packages/ui/src/') || retired.test(file))
      issues.push({ rule: 'non-atlas-runtime-input', file });
  }
  const externals = [...new Set(Object.values(meta.outputs).flatMap(output => output.imports.filter(item => item.external).map(item => item.path)))].sort();
  for (const module of externals) {
    const allowed = module === 'electron' || isBuiltin(module) || dependencies.some(name => module === name || module.startsWith(name + '/'));
    if (!allowed || retired.test(module)) issues.push({ rule: 'unexpected-runtime-dependency', module });
  }
  return { inputCount: inputs.length, externals, issues };
}

function auditRuntime(root = path.resolve(__dirname, '..')) {
  root = path.resolve(root);
  const ui = JSON.parse(fs.readFileSync(path.join(root, 'packages/ui/package.json'), 'utf8'));
  const dependencies = Object.keys(ui.dependencies || {});
  const issues = [];
  const workspaces = fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter(item => item.isDirectory() && fs.existsSync(path.join(root, 'packages', item.name, 'package.json')))
    .map(item => item.name);
  for (const workspace of workspaces)
    if (workspace !== 'ui') issues.push({ rule: 'unexpected-workspace', workspace });
  for (const name of [...dependencies, ...Object.keys(ui.devDependencies || {})])
    if (retired.test(name)) issues.push({ rule: 'retired-package', module: name });
  const graphs = entries.map(entry => {
    const result = buildSync({
      absWorkingDir: root, entryPoints: [entry], bundle: true,
      platform: 'node', format: 'cjs', packages: 'external',
      metafile: true, write: false, logLevel: 'silent',
    });
    const graph = inspectGraph(result.metafile, root, dependencies);
    issues.push(...graph.issues.map(issue => ({ entry, ...issue })));
    return { entry, inputCount: graph.inputCount, externals: graph.externals };
  });
  return { workspaces, graphs, issues };
}

module.exports = { inspectGraph, auditRuntime };
if (require.main === module) {
  try {
    const report = auditRuntime();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.issues.length ? 1 : 0;
  } catch {
    console.error('运行依赖检查未完成，请检查入口、依赖安装与构建错误。');
    process.exitCode = 1;
  }
}
