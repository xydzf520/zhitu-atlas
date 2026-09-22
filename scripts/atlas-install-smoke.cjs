// Install a complete package using only its runtime, then launch with a fresh local data root.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const release = path.resolve(process.argv[2]), output = path.resolve(process.argv[3] || 'artifacts/install-smoke');
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-first-install-'));
const toolsDir = path.join(temp, 'tools'); fs.mkdirSync(toolsDir);
for (const tool of ['id','dirname','env']) fs.symlinkSync('/usr/bin/' + tool, path.join(toolsDir, tool));
const port = process.env.ATLAS_CHECK_PORT || '5190';
const env = { ...process.env, PATH: toolsDir, ATLAS_DATA_ROOT: path.join(temp, 'data'), ATLAS_PORT: port };
let child;
(async () => {
  try {
    const installationRoot = path.join(temp, 'install with spaces');
    const result = execFileSync(path.join(release, 'install.sh'), ['--prefix', installationRoot, '--applications', path.join(temp, 'menu')], { env, encoding:'utf8' });
    const receipt = JSON.parse(result.trim().split('\n').at(-1));
    assert.equal(receipt.version, JSON.parse(fs.readFileSync(path.join(release,'release-manifest.json'))).version);
    assert.ok(fs.existsSync(path.join(temp, 'menu/zhitu-atlas.desktop')));
    const fd = fs.openSync(path.join(output, 'start.log'), 'w');
    child = spawn(path.join(receipt.directory, 'start.sh'), [], { env, stdio:['ignore',fd,fd] }); fs.closeSync(fd);
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}/desktop.html`); if (r.ok) { ready = true; break } } catch {}
      await new Promise(r => setTimeout(r,250));
    }
    assert.ok(ready,'installed launcher did not start service');
    const summary = { passed:true, version:receipt.version, systemNodeInPath:false, installedWithSpaces:true,
      desktopEntry:true, launcherStarted:true, port, scope:'Temporary installation and fresh data only' };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(summary,null,2));
    console.log(JSON.stringify(summary));
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(r => { const timer=setTimeout(r,5000); child.once('exit',()=>{clearTimeout(timer);r()}) });
    }
    fs.rmSync(temp, { recursive:true, force:true });
  }
})().catch(e => { console.error(e.message); process.exitCode=1 });
