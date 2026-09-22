const store=require('./fixture-store.cjs')
const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-data-test-'))
process.on('exit',()=>fs.rmSync(root,{recursive:true,force:true}))
function moduleAt(entry,name,home=root){const out=path.join(root,name);buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',outfile:out});const mod={exports:{}};vm.runInNewContext('(function(require,module,exports){'+fs.readFileSync(out,'utf8')+'\n})',{Buffer,process,Date,URL,AbortController,AbortSignal,setTimeout,clearTimeout,setInterval,clearInterval,fetch})(key=>key==='node:os'?{homedir:()=>home}:require(key),mod,mod.exports);return mod.exports}
const data=moduleAt('packages/ui/src/main/features/career-boss-data.ts','boss.cjs')
test('loaded conversations deduplicate, retain known fields and never mix accounts',()=>{
 data.saveBossSnapshot({account:{id:'a',name:'用户甲'},items:[{bossId:'b',companyName:'测试公司',jobName:'产品经理'},{bossId:'b',companyName:'测试公司'}]})
 data.saveBossSnapshot({account:{id:'a',name:'用户甲'},items:[{bossId:'b',companyName:''}]})
 assert.equal(data.readBossSync().items.length,1);assert.equal(data.readBossSync().items[0].jobName,'产品经理')
 data.saveBossSnapshot({account:{id:'b',name:'用户乙'},items:[]})
 assert.equal(data.readBossSync().items.length,0)
 assert.equal(data.saveBossSnapshot({account:{id:''},items:[]}),null);assert.equal(data.readBossSync().account.id,'b')
})
test('history merges with local jobs without inventing dates, stages or coordinates',()=>{
 const sync={account:{id:'me',name:'本人'},items:[{bossId:'boss',jobName:'AI产品经理',companyName:'某企业'}],updatedAt:new Date().toISOString()}
 const result=data.enrichSyncedRecords({applications:[],jobLibrary:[{encryptJobId:'job',encryptBossId:'boss',address:'上海徐汇区',description:'公开职责'}]},sync)
 assert.equal(result.applications.length,1);assert.equal(result.applications[0].firstContact,'');assert.equal(result.applications[0].encryptJobId,'job');assert.equal(result.applications[0].address,'上海徐汇区');assert.equal(result.jobLibrary,undefined)
 assert.equal(data.enrichSyncedRecords({...result,jobLibrary:[]},sync).applications.length,1)
 assert.equal(data.enrichSyncedRecords({accountId:'someone-else',applications:[]},sync).applications.length,0)
})
test('migrated contact history scopes by account ID even when display names are identical',()=>{
 const home=fs.mkdtempSync(path.join(root,'legacy-')),storage=path.join(home,'.local/share/zhitu-atlas/storage');fs.mkdirSync(storage,{recursive:true})
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(path.join(storage,'public.db'))
 db.exec(`CREATE TABLE user_info(encryptUserId TEXT,name TEXT);CREATE TABLE job_info(encryptJobId TEXT,encryptCompanyId TEXT,encryptBossId TEXT,jobName TEXT);CREATE TABLE chat_startup_log(id INTEGER,encryptCurrentUserId TEXT,encryptJobId TEXT,date TEXT);INSERT INTO user_info VALUES('a','同名'),('b','同名');INSERT INTO job_info VALUES('j','','','产品经理');INSERT INTO chat_startup_log VALUES(1,'a','j','2026-09-01'),(2,'a','j','2026-09-02');`);db.close()
 const api=moduleAt('packages/ui/src/main/features/atlas-history-import.ts','records.cjs',home)
 assert.equal(api.historicalApplications({userId:'b'}).data.applications.length,0)
 const a=api.historicalApplications({userId:'a'}).data;assert.equal(a.applications.length,1);assert.equal(a.applications[0].firstContact,'2026-09-01')
 assert.equal(api.historicalApplications({name:'同名'}).data.applications.length,0)
 assert.equal(api.historicalApplications({userId:"' OR 1=1 --"}).data.applications.length,0)
})
test('authenticated production API persists data, rejects other origins and retains one backend owner',async()=>{
 const home=fs.mkdtempSync(path.join(root,'home-')),config=path.join(home,'.local/share/zhitu-atlas/config');fs.mkdirSync(config,{recursive:true})
 fs.writeFileSync(path.join(config,'llm.json'),JSON.stringify([{enabled:true,model:'deepseek-flash',providerCompleteApiUrl:'https://api.deepseek.com',providerApiSecret:'test-secret-must-not-leak'}]))
 const {startAtlasServer,runtimeFile}=moduleAt('packages/ui/src/main/features/atlas-server.ts','api-service.cjs',home)
 const web=path.join(home,'web');fs.mkdirSync(web);fs.writeFileSync(path.join(web,'desktop.html'),'<html><head></head><body>Atlas</body></html>')
 const server=await startAtlasServer(web,0),connection=JSON.parse(fs.readFileSync(runtimeFile(),'utf8')),base='http://127.0.0.1:'+server.address().port
 const call=(channel,payload,origin=base,token=connection.token)=>fetch(base+'/atlas-api/rpc',{method:'POST',headers:{Origin:origin,'X-Atlas-Token':token,'Content-Type':'application/json'},body:JSON.stringify({channel,payload})})
 try {
 assert.equal((await call('career-workspace-load',undefined,'https://other.example')).status,403)
 assert.equal((await call('career-workspace-load',undefined,base,'')).status,403)
 const model=await call('career-dashboard-load'),body=await model.text();assert.equal(model.status,200);assert.ok(body.includes('deepseek-flash'));assert.ok(!body.includes('test-secret-must-not-leak'))
 for(const name of ['fetch-config-file-content','career-paper-analyze','career-paper-start','career-profile-legacy','career-policy-import-legacy'])assert.equal((await call(name)).status,404)
 const initial=await (await call('career-workspace-load')).json();initial.data.profile.name='本地往返验证'
 const saved=await call('career-workspace-save',{state:JSON.stringify(initial.data),baseRevision:(await (await call('career-workspace-snapshot')).json()).data.revision});assert.equal(saved.status,200)
 const loaded=await (await call('career-workspace-load')).json();assert.equal(loaded.data.profile.name,'本地往返验证');assert.equal(fs.statSync(path.join(config,'../storage/atlas.db')).mode&0o777,0o600)
 const page=await fetch(base+'/');assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);assert.match(await page.text(),/atlas-session/)
 assert.equal((await fetch(base+'/%00')).status,400)
 await assert.rejects(startAtlasServer(web,connection.port),{code:'EADDRINUSE'})
 assert.equal(JSON.parse(fs.readFileSync(runtimeFile(),'utf8')).token,connection.token)
 assert.equal((await call('career-runtime-status')).status,200)
 }finally{server.closeIdleConnections();await new Promise(r=>server.close(r))}
})
test('passive message-page collector saves loaded conversations without navigating or sending',async()=>{
 const home=fs.mkdtempSync(path.join(root,'collector-')),collector=moduleAt('packages/ui/src/main/features/career-data-sync.ts','collector.cjs',home)
 const page={isClosed:()=>false,url:()=> 'https://www.zhipin.com/web/geek/chat',evaluate:async()=>({account:{id:'me',name:'测试账户'},items:[{bossId:'b',companyName:'测试公司',jobName:'产品经理'}]})}
 await collector.syncCareerPage(page)
 const config=path.join(home,'.local/share/zhitu-atlas/config'),synced=store.get(config,'career-boss-sync.json')
 assert.equal(synced.items.length,1);assert.equal(synced.account.id,'me');assert.equal(fs.statSync(path.join(config,'../storage/atlas.db')).mode&0o777,0o600)
 page.url=()=> 'https://www.zhipin.com/web/user/'
 page.evaluate=async()=>{throw Error('must not inspect non-chat pages')}
 await collector.syncCareerPage(page)
 assert.equal(store.get(config,'career-boss-sync.json').items.length,1)
})
