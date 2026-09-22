const {test,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {spawn}=require('node:child_process'),{randomBytes}=require('node:crypto'),{buildSync}=require('esbuild');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-private-config-'));
const source=buildSync({stdin:{resolveDir:process.cwd(),contents:['atlas-local-config','atlas-model-config','atlas-store','atlas-backup','atlas-backup-transfer','atlas-tasks'].map(n=>`export * from './packages/ui/src/main/features/${n}'`).join('\n')},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
after(()=>fs.rmSync(root,{recursive:true,force:true}));
function fixture(t,overrides={}){
 const dir=fs.mkdtempSync(path.join(root,'data-')),m={exports:{}};
 vm.runInNewContext('(function(require,module,exports){'+source+'\n})',{Buffer,process:{...process,env:{...process.env,ATLAS_DATA_ROOT:dir}},Date,URL,AbortController,AbortSignal,setTimeout,clearTimeout,setInterval,clearInterval,fetch:()=>{throw Error('test has no network')}})(name=>name==='node:fs'?{...fs,...overrides}:require(name),m,m.exports);
 const a=m.exports,legacy=path.join(dir,'config/llm.json');
 t.after(()=>a.closeAtlas());
 const configs=[{id:'fixture',enabled:true,providerCompleteApiUrl:'https://api.deepseek.com',model:'deepseek-flash',providerApiSecret:'fixture-'+randomBytes(24).toString('hex')}];
 function writeLegacy(value=configs){fs.mkdirSync(path.dirname(legacy),{recursive:true});fs.writeFileSync(legacy,JSON.stringify(value))}
 return {a,dir,legacy,configs,writeLegacy,privateFile:a.privateModelFile()};
}
test('existing local keys migrate without changing routing; public settings and SQLite contain no key',t=>{
 const f=fixture(t);f.writeLegacy();const key=f.configs[0].providerApiSecret;
 assert.equal(f.a.modelConfig().key,key);assert.equal(f.a.modelConfig().model,'deepseek-flash');
 assert.equal(fs.existsSync(f.legacy),false);assert.equal(f.a.modelConfig().key,key);
 assert.equal(fs.statSync(f.a.privateConfigDirectory()).mode&0o777,0o700);
 assert.equal(fs.statSync(f.privateFile).mode&0o777,0o600);
 const settings=f.a.modelSettings();assert.equal(settings.storage.localOnly,true);assert.equal(settings.storage.includedInBackup,false);
 assert.ok(!JSON.stringify(settings).includes(key));
 assert.ok(!JSON.stringify(f.a.atlasDb().prepare('SELECT * FROM documents').all()).includes(key));
});
test('interrupted migration retains source, cleans staging files, and resumes after an identical destination',t=>{
 const f=fixture(t,{renameSync(){throw Error('disk-full with private input')}});f.writeLegacy();
 assert.throws(()=>f.a.readLocalModelConfigs(),/保存未完成/);assert.ok(fs.existsSync(f.legacy));assert.ok(!fs.existsSync(f.privateFile));
 assert.equal(fs.readdirSync(f.a.privateConfigDirectory()).length,0);
 fs.writeFileSync(f.privateFile,JSON.stringify(f.configs),{mode:0o600});
 assert.equal(f.a.readLocalModelConfigs()[0].providerApiSecret,f.configs[0].providerApiSecret);assert.ok(!fs.existsSync(f.legacy));
});
test('conflicting legacy configuration never replaces an existing private key',t=>{
 const f=fixture(t);f.writeLegacy();f.a.readLocalModelConfigs();const initial=fs.readFileSync(f.privateFile);
 f.writeLegacy([{...f.configs[0],providerApiSecret:'fixture-conflicting-key'}]);
 assert.throws(()=>f.a.readLocalModelConfigs(),/冲突/);assert.deepEqual(fs.readFileSync(f.privateFile),initial);assert.ok(fs.existsSync(f.legacy));
});
test('corrupt config errors do not echo the JSON or reset a saved file',t=>{
 const f=fixture(t);f.writeLegacy();const content='{"providerApiSecret":"'+f.configs[0].providerApiSecret+'",broken';fs.writeFileSync(f.legacy,content);
 assert.throws(()=>f.a.modelSettings(),error=>/格式损坏/.test(error.message)&&!error.message.includes(f.configs[0].providerApiSecret));
 assert.equal(fs.readFileSync(f.legacy,'utf8'),content);assert.equal(fs.existsSync(f.privateFile),false);
});
test('private storage refuses Git worktrees, symlinks and hard-linked credential files',t=>{
 const f=fixture(t);fs.mkdirSync(path.join(f.dir,'.git'));assert.throws(()=>f.a.readLocalModelConfigs(),/源码仓库之外/);fs.rmdirSync(path.join(f.dir,'.git'));
 const outside=path.join(root,'outside-'+randomBytes(4).toString('hex'));fs.mkdirSync(outside);fs.symlinkSync(outside,f.a.privateConfigDirectory());
 assert.throws(()=>f.a.readLocalModelConfigs(),/符号链接/);fs.unlinkSync(f.a.privateConfigDirectory());fs.mkdirSync(f.a.privateConfigDirectory());
 const target=path.join(outside,'target.json');fs.writeFileSync(target,JSON.stringify(f.configs));fs.symlinkSync(target,f.privateFile);
 assert.throws(()=>f.a.readLocalModelConfigs(),/安全读取/);fs.unlinkSync(f.privateFile);fs.linkSync(target,f.privateFile);assert.throws(()=>f.a.readLocalModelConfigs(),/安全读取/);
});
test('saving or switching models leaves another provider unchanged and rejects stale edits',async t=>{
 const f=fixture(t);f.writeLegacy([...f.configs,{id:'other',enabled:false,model:'fixture-model',providerCompleteApiUrl:'https://api.commandcode.ai/provider/v1',providerApiSecret:'fixture-other-provider'}]);
 const old=f.a.modelSettings();await f.a.saveModelSettings({provider:'deepseek',model:'deepseek-pro',secret:'',baseRevision:old.revision});
 assert.equal(f.a.modelConfig().key,f.configs[0].providerApiSecret);assert.equal(f.a.readLocalModelConfigs().find(c=>c.id==='other').providerApiSecret,'fixture-other-provider');
 await assert.rejects(f.a.saveModelSettings({provider:'deepseek',model:'deepseek-flash',secret:'fixture-new-key',baseRevision:old.revision}),/已变化/);
 assert.equal(f.a.modelConfig().model,'deepseek-pro');
});
test('two processes cannot overwrite each other using the same config revision',async t=>{
 const f=fixture(t);f.writeLegacy();const revision=f.a.modelSettings().revision,bundle=path.join(f.dir,'api.cjs');fs.writeFileSync(bundle,source);
 async function save(id){return new Promise((resolve,reject)=>{const code=`const a=require(process.argv[1]);try{a.writeLocalModelConfigs([{id:process.argv[2]}],process.argv[3]);process.stdout.write('saved')}catch(e){process.stdout.write('blocked')}`;const child=spawn(process.execPath,['-e',code,bundle,id,revision],{env:{...process.env,ATLAS_DATA_ROOT:f.dir}});let out='';child.stdout.on('data',d=>out+=d);child.on('error',reject);child.on('exit',c=>c===0?resolve(out):reject(Error('child failed')));})}
 const results=await Promise.all([save('first'),save('second')]);assert.equal(results.filter(x=>x==='saved').length,1);assert.equal(results.filter(x=>x==='blocked').length,1);
});
test('a live writer lock is not stolen and leaves both copies untouched',t=>{
 const f=fixture(t);f.writeLegacy();fs.mkdirSync(f.a.privateConfigDirectory(),{recursive:true});const lock=path.join(f.a.privateConfigDirectory(),'.models.lock');fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid}));
 assert.throws(()=>f.a.readLocalModelConfigs(),/另一个本机进程/);assert.ok(fs.existsSync(f.legacy));assert.ok(fs.existsSync(path.join(lock,'owner.json')));
});
test('encrypted V1 and V2 backups never export the private model configuration',async t=>{
 const f=fixture(t);f.writeLegacy();f.a.modelConfig();const key=f.configs[0].providerApiSecret,password='fixture-backup-password';
 f.a.setRuntime({paused:true});const v1=f.a.exportEncryptedBackup(password),clear=f.a.inspectBackup({password,base64:v1.base64});assert.ok(!JSON.stringify(clear).includes(key));
 const v2=await f.a.createBackupTransfer({password});const chunks=[];for(let offset=0;offset<v2.size;){const c=f.a.downloadBackupChunk({id:v2.id,offset});chunks.push(Buffer.from(c.base64,'base64'));offset=c.next}
 const upload=f.a.beginBackupUpload({size:v2.size}),bytes=Buffer.concat(chunks);for(let offset=0;offset<bytes.length;offset+=upload.chunkSize)f.a.uploadBackupChunk({id:upload.id,offset,base64:bytes.subarray(offset,offset+upload.chunkSize).toString('base64')});
 const preview=await f.a.previewBackupTransfer({id:upload.id,password});assert.equal(preview.attachments,0);
 const clean=fixture(t),incoming=clean.a.beginBackupUpload({size:bytes.length});
 for(let offset=0;offset<bytes.length;offset+=incoming.chunkSize)clean.a.uploadBackupChunk({id:incoming.id,offset,base64:bytes.subarray(offset,offset+incoming.chunkSize).toString('base64')});
 clean.a.setRuntime({paused:true});await clean.a.restoreBackupTransfer({id:incoming.id,password,confirm:true});
 assert.equal(clean.a.modelSettings().configured,false);assert.equal(fs.existsSync(clean.privateFile),false);
 assert.ok(!JSON.stringify(clean.a.atlasDb().prepare('SELECT * FROM documents').all()).includes(key));
 clean.a.closeBackupTransfer({id:incoming.id});
 // Restoring business data must not replace this computer's independently configured key.
 await f.a.restoreBackupTransfer({id:upload.id,password,confirm:true});assert.equal(f.a.modelConfig().key,key);
 f.a.closeBackupTransfer({id:upload.id});f.a.closeBackupTransfer({id:v2.id});
});
