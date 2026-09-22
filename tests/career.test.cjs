const store=require('./fixture-store.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-career-test-'))
const target = path.join(dir, 'career.cjs')
buildSync({ entryPoints: ['packages/ui/src/common/career.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: target })
const { emptyCareerState, assessCareerJob, validateCareerState, draftCareerMessage, isFollowUpDue } = require(target)
process.on('exit', () => fs.rmSync(dir, {recursive:true, force:true}))
const profile = { ...emptyCareerState().profile, name: '候选人', targetRoles:['AI产品负责人'], preferredCities:['上海'], minimumMonthlyK:40, evidence:[{id:'e1',confirmed:true,title:'平台项目',text:'负责企业 AI 平台建设。',keywords:['AI','Agent','Skill'],source:'项目记录'}] }
test('AI short tokens do not match unrelated English words or empty keywords', () => {
 const p={...profile,evidence:[{...profile.evidence[0],keywords:['AI','']}]}
 assert.equal(assessCareerJob({jobName:'Retail product manager',companyName:'x',description:'retail details '.repeat(10)},p).matchedEvidence.length,0)
})
test('short JD remains incomplete and raises missing data',()=>{
 const r=assessCareerJob({jobName:'AI产品负责人',companyName:'x',description:'Agent'},profile)
 assert.equal(r.label,'信息不足');assert.ok(r.score<50);assert.ok(r.questions.includes('工作城市待核实'));assert.ok(r.questions.includes('薪资待核实'))
})
test('senior algorithm roles cannot be promoted solely by AI keywords',()=>{
 const r=assessCareerJob({jobName:'大模型算法负责人',companyName:'x',description:'AI 模型训练与算法研发，支持业务需求和上线指标。'.repeat(8),address:'北京',salaryHigh:30},profile)
 assert.ok(r.score<35);assert.ok(r.questions.some(q=>q.includes('算法研发')));assert.ok(r.questions.some(q=>q.includes('不一致')));assert.ok(r.questions.some(q=>q.includes('薪资上限')))
})
test('draft only uses the selected evidence and follow-ups exclude closed offers',()=>{
 const draft=draftCareerMessage({jobName:'AI产品经理'},profile.evidence[0]);assert.ok(draft.includes(profile.evidence[0].text));assert.ok(!draft.includes('提升50%'))
 assert.equal(isFollowUpDue({stage:'面试中',nextDate:'2026-09-15'},'2026-09-16'),true)
 assert.equal(isFollowUpDue({stage:'Offer',nextDate:'2026-09-15'},'2026-09-16'),false)
})
test('state rejects malformed dates, invalid pay, duplicates; accepts round trip',()=>{
 const s=emptyCareerState();s.profile=profile;validateCareerState(JSON.parse(JSON.stringify(s)))
 const item={id:'a',stage:'待评估',nextDate:'2026-02-30',note:'',job:{jobName:'AI产品经理',companyName:'x',description:'x'}}
 s.opportunities=[item];assert.throws(()=>validateCareerState(s));item.nextDate='2026-09-16';item.job.salaryHigh='NaN';assert.throws(()=>validateCareerState(s));delete item.job.salaryHigh;s.opportunities.push({...item});assert.throws(()=>validateCareerState(s))
})
test('IPC persistence round trips, backs up and preserves data after invalid save', async()=>{
 const ipcTarget=path.join(dir,'ipc.cjs')
 buildSync({entryPoints:['packages/ui/src/main/features/career-workspace-service.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:ipcTarget})
 const handlers={}, mod={exports:{}}
 const mockRequire=(name)=>name==='electron'?{ipcMain:{handle:(key,fn)=>handlers[key]=fn},clipboard:{writeText:()=>{}}}:name==='node:os'?{homedir:()=>dir}:require(name)
 require('node:vm').runInNewContext('(function(require,module,exports){'+fs.readFileSync(ipcTarget,'utf8')+'\n})', {Buffer,process})(mockRequire,mod,mod.exports)
 mod.exports.registerCareerWorkspace((key,fn)=>handlers[key]=fn,()=>{})
 const s=emptyCareerState();s.profile=profile
 handlers['career-workspace-save']({},{state:JSON.stringify(s),baseRevision:handlers['career-workspace-snapshot']().revision})
 assert.deepEqual(JSON.parse(JSON.stringify(handlers['career-workspace-load']())),s)
 s.profile.name='更新后的姓名';handlers['career-workspace-save']({},{state:JSON.stringify(s),baseRevision:handlers['career-workspace-snapshot']().revision})
 const filename=path.join(dir,'.local/share/zhitu-atlas/config/career-workspace.json')
 assert.ok(handlers['career-profile-history']().versions.length>=2)
 assert.equal(fs.statSync(path.join(dir,'.local/share/zhitu-atlas/storage/atlas.db')).mode & 0o777,0o600)
 assert.throws(()=>handlers['career-workspace-save']({},'{broken'))
 assert.equal(store.get(path.dirname(filename),'career-workspace.json').profile.name,'更新后的姓名')
 s.opportunities=[{id:'shared',stage:'待评估',nextDate:'',note:'',job:{jobName:'产品经理',companyName:'公司',description:'职责'}}]
 handlers['career-workspace-save']({},{state:JSON.stringify(s),baseRevision:handlers['career-workspace-snapshot']().revision})
 const prefsFile=path.join(dir,'.local/share/zhitu-atlas/config/career-dashboard.json')
 store.put(path.dirname(prefsFile),'career-dashboard.json',{version:1,overrides:{'manual:shared':{stage:'面试中',address:'上海浦东新区',note:'大屏备注',nextDate:'2026-09-20',updatedAt:new Date().toISOString()}}})
 const loaded=handlers['career-workspace-load']()
 assert.equal(loaded.opportunities[0].stage,'面试中');assert.equal(loaded.opportunities[0].job.address,'上海浦东新区')
 loaded.opportunities[0].stage='Offer';handlers['career-workspace-save']({},{state:JSON.stringify(loaded),baseRevision:handlers['career-workspace-snapshot']().revision})
 assert.equal(store.get(path.dirname(prefsFile),'career-dashboard.json').overrides['manual:shared'].stage,'Offer')

})

test('occupations share weights and title aliases; unrelated product titles get no special bonus',()=>{
 const roles=[['后端开发工程师','服务端开发工程师','接口'],['测试工程师','软件测试工程师','测试'],['运营经理','用户运营经理','运营'],['交互设计师','用户体验设计师','设计'],['会计','财务会计','财务'],['教师','数学老师','教学']];
 const scores=[];
 for(const [target,title,keyword] of roles){const p={...emptyCareerState().profile,targetRoles:[target],evidence:[{id:'e',confirmed:true,title:'虚构经历',text:'负责'+keyword,keywords:[keyword],source:'测试'}]};const jd={jobName:title,companyName:'虚构企业',description:('负责'+keyword+'相关工作，协同团队交付。').repeat(12)};const r=assessCareerJob(jd,p);assert.equal(r.alignment.status,'matched');assert.ok(r.score>=65);scores.push(r.score);assert.ok(assessCareerJob({...jd,jobName:'产品经理'},p).score<65)}
 assert.equal(new Set(scores).size,1);
})
test('unknown occupations remain reviewable and unconfirmed facts cannot raise automatic eligibility',()=>{
 const p={...profile,targetRoles:['文物修复师'],evidence:[{...profile.evidence[0],keywords:['修复'],confirmed:true}]};const jd={jobName:'古籍修复专员',companyName:'虚构',description:'修复古籍，保护原始材料并记录过程。'.repeat(12)};
 const r=assessCareerJob(jd,p);assert.equal(r.alignment.status,'unknown');assert.equal(r.label,'方向待核实');assert.ok(r.score<65);
 const direct={...jd,jobName:'文物修复师'};assert.ok(assessCareerJob(direct,p).score>=65);assert.ok(assessCareerJob(direct,{...p,evidence:p.evidence.map(e=>({...e,confirmed:false}))}).score<65);
})
