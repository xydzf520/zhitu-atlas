const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{randomBytes}=require('node:crypto');
const a=require('../scripts/atlas-public-check.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-public-check-'));
after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('scanner catches actual-looking keys, passwords and private paths without printing their values',()=>{
 const key='sk-'+randomBytes(24).toString('hex'),password=randomBytes(16).toString('base64url');
 for(const [file,text]of[['config.ts',`const apiKey = "${key}"`],['README.md',`password: '${password}'`],['test.cjs',key]]){
  const issues=a.scanText(file,text);assert.ok(issues.length);assert.ok(!JSON.stringify(issues).includes(key));assert.ok(!JSON.stringify(issues).includes(password));
 }
 for(const p of ['private/models.json','config/llm.json','storage/atlas.db','resume.docx','.env.local','old/secrets.json','archive.atlas'])assert.ok(a.pathFinding(p));
 assert.equal(a.pathFinding('.env.example'),null);assert.deepEqual(a.scanText('fixture.ts','providerApiSecret: "fixture-not-a-real-key"'),[]);
});
test('ignored files are not source, but a force-tracked private file and a historical secret are caught',()=>{
 const dir=fs.mkdtempSync(path.join(root,'repo-')),git=(...args)=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
 git('init');git('config','user.name','Atlas test');git('config','user.email','test@example.invalid');
 fs.writeFileSync(path.join(dir,'.gitignore'),'private/\n');fs.mkdirSync(path.join(dir,'private'));fs.writeFileSync(path.join(dir,'private/models.json'),'[]');
 assert.equal(a.checkRepository(dir).issues.length,0);git('add','-f','private/models.json');assert.ok(a.checkRepository(dir).issues.some(i=>i.rule==='private-file'));
 git('rm','--cached','private/models.json');const key='user_'+randomBytes(35).toString('hex');fs.writeFileSync(path.join(dir,'config.js'),`const key = '${key}'`);git('add','config.js','.gitignore');git('commit','-m','fixture snapshot');fs.writeFileSync(path.join(dir,'config.js'),'const key = null');git('add','config.js');git('commit','-m','remove from latest');
 assert.equal(a.checkRepository(dir).issues.length,0);const history=a.checkRepository(dir,true);assert.ok(history.issues.some(i=>i.object));assert.ok(!JSON.stringify(history).includes(key));
});
test('packaging rejects private files even when they are nested in otherwise valid build output',()=>{
 const dir=fs.mkdtempSync(path.join(root,'build-'));fs.mkdirSync(path.join(dir,'web'));fs.writeFileSync(path.join(dir,'web/app.js'),'console.log("ready")');assert.equal(a.assertPublicBuild(dir).issues.length,0);
 fs.mkdirSync(path.join(dir,'web/private'));fs.writeFileSync(path.join(dir,'web/private/models.json'),'[]');assert.throws(()=>a.assertPublicBuild(dir),/私有文件/);
});
test('downloaded source works without Git and still rejects credentials and retired map assets',()=>{
 const dir=fs.mkdtempSync(path.join(root,'archive-'));
 fs.writeFileSync(path.join(dir,'package.json'),'{"name":"zhitu-atlas"}');
 fs.mkdirSync(path.join(dir,'node_modules'));fs.writeFileSync(path.join(dir,'node_modules/noise.js'),'fixture');
 assert.equal(a.checkRepository(dir).checkedFiles,1);
 assert.throws(()=>a.checkRepository(dir,true),/不含 Git 历史/);
 fs.mkdirSync(path.join(dir,'private'));fs.writeFileSync(path.join(dir,'private/maps.json'),'{}');
 assert.ok(a.checkRepository(dir).issues.some(i=>i.rule==='private-file'));
 assert.equal(a.pathFinding('packages/ui/src/common/data/map-boundaries.json'),'map-redistribution-unresolved');
});
