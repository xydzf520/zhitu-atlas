// Inspect modules in a fresh web production build; do not infer inclusion from installation.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const { build } = await import(path.join(path.dirname(require.resolve('vite/package.json')), 'dist/node/index.js'));
const { collectLicenses } = require('./scripts/atlas-licenses.cjs');
const output = path.resolve(process.argv[2] || 'artifacts/license-audit/web.json');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-license-web-'));
const packages = new Map();
try {
  collectLicenses(path.join(stage, 'licenses'), root);
  const licenses = new Map(JSON.parse(fs.readFileSync(path.join(stage, 'licenses/index.json'))).packages
    .map((r) => [r.name + '@' + r.version, r]));
  await build({
    configFile: path.join(root, 'packages/ui/web/vite.config.mjs'),
    build: { outDir: path.join(stage, 'web') },
    plugins: [{
      name: 'atlas-license-modules',
      generateBundle(_options, bundle) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue;
          for (const [id, meta] of Object.entries(chunk.modules)) {
            if (!id.includes('/node_modules/') || id.startsWith('\0') || meta.renderedLength === 0) continue;
            let dir = path.dirname(id.split('?')[0]);
            while (path.dirname(dir) !== dir) {
              const file = path.join(dir, 'package.json');
              if (fs.existsSync(file)) {
                const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (pkg.name && pkg.version) {
                  const key = pkg.name + '@' + pkg.version;
                  const row = packages.get(key) || { name: pkg.name, version: pkg.version, license: pkg.license,
                    modules: 0, renderedLength: 0, textStatus: licenses.get(key)?.textStatus || 'review-required' };
                  row.modules++;
                  row.renderedLength += meta.renderedLength;
                  packages.set(key, row);
                  break;
                }
              }
              dir = path.dirname(dir);
            }
          }
        }
      }
    }]
  });
  const rows = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
  const missing = rows.filter((r) => r.textStatus !== 'included').map((r) => r.name + '@' + r.version);
  if (!rows.length) throw Error('未采集到网页依赖，不生成通过结论');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({
    scope: 'Emitted web JavaScript package modules only; excludes map data, CSS/assets, desktop main/preload and Electron native components.',
    packages: rows, missingTexts: missing
  }, null, 2) + '\n');
  console.log(JSON.stringify({ report: output, packages: rows.length, missingTexts: missing }));
  if (missing.length) process.exitCode = 1;
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
