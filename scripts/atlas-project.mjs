import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const ui = path.join(root, 'packages/ui')
const require = createRequire(path.join(ui, 'package.json'))
const bin = (pkg, name) => path.join(path.dirname(require.resolve(pkg + '/package.json')), 'bin', name)
const major = Number(process.versions.node.split('.')[0])
if (major < 22) throw new Error('Atlas 需要 Node.js 22 或更新版本；推荐 Node.js 22.22.x。')
function run(args, cwd = ui) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
const tasks = {
  test() { run(['--test', ...fs.readdirSync(path.join(root, 'tests')).filter(n => n.endsWith('.test.cjs')).sort().map(n => 'tests/' + n)], root) },
  typecheck() {
    run([require.resolve('typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.node.json', '--composite', 'false'])
    run([require.resolve('vue-tsc/bin/vue-tsc.js'), '--noEmit', '-p', 'tsconfig.web.json', '--composite', 'false'])
  },
  build() {
    run(['scripts/atlas-public-check.cjs'], root)
    run(['scripts/atlas-runtime-audit.cjs'], root)
    run([bin('vite', 'vite.js'), 'build', '--config', 'web/vite.config.mjs'])
    run([bin('electron-vite', 'electron-vite.js'), 'build'])
    for (const output of ['out', 'web-dist']) run(['scripts/atlas-public-check.cjs', '--build', path.join(ui, output)], root)
  },
  dev() { run([bin('electron-vite', 'electron-vite.js'), 'dev']) },
  start() { run([bin('electron-vite', 'electron-vite.js'), 'preview']) },
  web() { run(['web/serve.mjs']) },
  check() { tasks.test(); tasks.typecheck(); tasks.build() }
}
const command = process.argv[2] || 'start'
if (!tasks[command]) throw new Error('可用命令：' + Object.keys(tasks).join(', '))
tasks[command]()
