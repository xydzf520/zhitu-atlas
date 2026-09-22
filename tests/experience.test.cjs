const store=require('./fixture-store.cjs')
const {test}=require('node:test'),assert=require('node:assert/strict'),{buildSync}=require('esbuild'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-experience-'))
process.on('exit',()=>fs.rmSync(root,{recursive:true,force:true}))
function bundle(entry,name){const file=path.join(root,name);buildSync({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',outfile:file});return fs.readFileSync(file,'utf8')}
const service=bundle('packages/ui/src/main/features/atlas-service.ts','service.cjs'),core=bundle('packages/ui/src/common/career.ts','core.cjs'),ux=bundle('packages/ui/src/common/career-ux.ts','ux.cjs'),reply=bundle('packages/ui/src/common/auto-reply.ts','reply.cjs')
function evaluate(source,home){const m={exports:{}};vm.runInNewContext('(function(require,module,exports){'+source+'\n})',{Buffer,process,Date})(key=>key==='node:os'?{homedir:()=>home}:require(key),m,m.exports);return m.exports}
const {emptyCareerState,validateCareerState}=evaluate(core,root),{replyQueue,connectionSummary}=evaluate(ux,root),{classifyReply,defaultReplySettings}=evaluate(reply,root)
function fixture(fetch=async()=>({data:{databaseAvailable:true,applications:[]}})){
 const home=fs.mkdtempSync(path.join(root,'home-')),config=path.join(home,'.local/share/zhitu-atlas/config');fs.mkdirSync(config,{recursive:true});const create=()=>evaluate(service,home).createAtlasHandlers(fetch);let handlers=create()
 return {config,call:(name,payload)=>handlers.get(name)({},payload),reopen:()=>{handlers=create()},put:(name,value)=>{const file=path.join(config,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value))}}
}
test('stale workspace edits cannot overwrite a newer window or map progress',async()=>{
 const f=fixture(),s=emptyCareerState();s.profile.name='原资料';s.opportunities=[{id:'one',job:{jobName:'产品经理',companyName:'测试公司',description:''},stage:'待评估',nextDate:'',note:''}]
 f.call('career-workspace-save',{state:JSON.stringify(s),baseRevision:f.call('career-workspace-snapshot').revision})
 const left=f.call('career-workspace-snapshot'),right=f.call('career-workspace-snapshot');right.state.profile.name='新资料'
 const saved=f.call('career-workspace-save',{state:JSON.stringify(right.state),baseRevision:right.revision})
 left.state.profile.name='旧窗口';assert.throws(()=>f.call('career-workspace-save',{state:JSON.stringify(left.state),baseRevision:left.revision}),/另一个窗口/)
 assert.equal(f.call('career-workspace-load').profile.name,'新资料')
 const mapped=f.call('career-opportunity-save',{id:'manual:one',override:{stage:'面试中',note:'新反馈'},baseRevision:saved.revision})
 assert.throws(()=>f.call('career-workspace-save',{state:JSON.stringify(saved.state),baseRevision:saved.revision}),/另一个窗口/)
 const fresh=f.call('career-workspace-snapshot');assert.equal(fresh.state.opportunities[0].stage,'面试中');assert.equal(fresh.state.opportunities[0].note,'新反馈');assert.equal(fresh.revision,mapped.revision)
})
test('single-opportunity saves preserve other rows and active writer locks reject mutation',()=>{
 const f=fixture();let base=f.call('career-workspace-snapshot').revision
 base=f.call('career-opportunity-save',{id:'job:a',override:{stage:'已投递'},baseRevision:base}).revision
 base=f.call('career-opportunity-save',{id:'job:b',override:{stage:'面试中'},baseRevision:base}).revision
 const before=JSON.stringify(store.get(f.config,'career-dashboard.json'));assert.equal(JSON.parse(before).overrides['job:a'].stage,'已投递')
 f.put('.career-write.lock',process.pid)
 assert.throws(()=>f.call('career-opportunity-save',{id:'job:a',override:{stage:'Offer'},baseRevision:base}),/正在保存/)
 assert.equal(JSON.stringify(store.get(f.config,'career-dashboard.json')),before);fs.unlinkSync(path.join(f.config,'.career-write.lock'))
})
test('policy conflicts are visible and pause preserves limits without resuming old queues',()=>{
 const f=fixture();const a=f.call('career-reply-status'),b=f.call('career-reply-status')
 f.call('career-reply-settings-save',{settings:JSON.stringify({...a.replySettings,mode:'auto',dailyLimit:7}),baseRevision:a.settingsRevision})
 assert.throws(()=>f.call('career-reply-settings-save',{settings:JSON.stringify({...b.replySettings,dailyLimit:40}),baseRevision:b.settingsRevision}),/另一个窗口/)
 const stopped=f.call('career-reply-pause');assert.equal(stopped.settings.mode,'off');assert.equal(stopped.settings.dailyLimit,7)
})
test('confirmed queue survives reopening, rejects changed duplicate text, and dismissal works offline',()=>{
 const f=fixture(),id='a'.repeat(64);f.put('career-replies/'+id+'.json',{id,userId:'u',bossId:'b',company:'测试公司',person:'HR',incoming:'薪资期望',messageId:'m',receivedAt:1,createdAt:new Date().toISOString(),draft:'',reason:'本人确认',category:'薪资沟通',status:'review'})
 const c={id,action:'approve',text:'先了解具体职责。'};f.call('career-reply-command',c);f.reopen()
 assert.equal(f.call('career-reply-status').pendingCommands[id].text,c.text);assert.equal(f.call('career-reply-command',c),true)
 assert.throws(()=>f.call('career-reply-command',{...c,text:'不同内容'}),/不能重复/)
 f.call('career-reply-command',{id,action:'dismiss',text:''});f.reopen();const status=f.call('career-reply-status')
 assert.equal(status.replies[0].status,'dismissed');assert.equal(status.pendingCommands[id],undefined)
})
test('all unresolved replies remain visible even beyond the recent history cap',()=>{
 const f=fixture()
 for(let i=1;i<=350;i++){const id=i.toString(16).padStart(64,'0');f.put('career-replies/'+id+'.json',{id,userId:'u',status:i===1?'review':'sent',createdAt:new Date(1700000000000+i*1000).toISOString()})}
 const status=f.call('career-reply-status');assert.equal(status.replyTotal,350);assert.ok(status.replies.some(e=>e.status==='review'));assert.equal(status.replies.length,201)
})
test('database failure does not hide personal workspace or fabricate a connected state',async()=>{
 const f=fixture(async()=>{throw Error('sqlite unavailable')});const s=emptyCareerState();s.profile.name='已保存资料';f.call('career-workspace-save',{state:JSON.stringify(s),baseRevision:f.call('career-workspace-snapshot').revision})
 const d=await f.call('career-dashboard-load');assert.equal(d.workspace.profile.name,'已保存资料');assert.equal(d.connection.database,false);assert.equal(d.records.applications.length,0)
})
test('reply queue separates awaiting confirmation, approved, uncertain and completed items',()=>{
 const events=[{id:'done',status:'sent',createdAt:'2026-09-16',company:'甲'},{id:'waiting',status:'review',createdAt:'2026-08-01',company:'乙'},{id:'approved',status:'review',createdAt:'2026-09-15',company:'乙'},{id:'unknown',status:'uncertain',createdAt:'2026-09-14',company:'甲'}]
 const commands={approved:{action:'approve'}};const q=replyQueue(events,commands,'all');assert.equal(q.counts.attention,2);assert.equal(q.counts.queued,1);assert.equal(q.items[0].id,'unknown');assert.equal(q.items[1].id,'waiting')
 assert.equal(replyQueue(events,commands,'attention','乙').items.length,1)
})
test('connection status distinguishes stale collection, paused mode and time windows',()=>{
 const now=Date.parse('2026-09-16T22:00:00+08:00'),at=new Date(now).toISOString(),settings={...defaultReplySettings(),mode:'auto'}
 const s=connectionSummary({state:'connected',syncAt:at},{state:'connected',at,mode:'auto'},settings,now);assert.equal(s.collecting,true);assert.equal(s.replyLabel,'自动回复时段外')
 const stale=connectionSummary({state:'connected',syncAt:'2026-09-01'},{state:'connected',at:'2026-09-01'},settings,now);assert.equal(stale.live,false);assert.equal(stale.collecting,false)
 assert.equal(connectionSummary({}, {}, {...settings,mode:'off'},now).replyLabel,'回复助手已暂停')
})
test('unrelated project consultations stay manual and inverted salary ranges are rejected',()=>{
 const s=emptyCareerState();s.profile.evidence=[{title:'AI平台',text:'负责AI平台',keywords:['SkillForge'],source:'本人'}]
 assert.equal(classifyReply('你有游戏项目经验吗',s.profile).automatic,false)
 s.opportunities=[{id:'a',stage:'待评估',nextDate:'',note:'',job:{jobName:'产品经理',companyName:'公司',description:'',salaryLow:50,salaryHigh:30}}]
 assert.throws(()=>validateCareerState(s),/下限/)
})
