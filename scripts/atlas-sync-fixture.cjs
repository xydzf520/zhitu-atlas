// Isolated production-UI fixture; never reads credentials or the user's databases.
const {buildSync}=require('esbuild'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-sync-ui-'));process.env.ATLAS_DATA_ROOT=root;
const file=path.join(root,'server.cjs');buildSync({stdin:{resolveDir:process.cwd(),contents:['atlas-server','atlas-service','atlas-store','atlas-boss-sync','career-boss-data'].map(n=>'export * from '+JSON.stringify(path.resolve('packages/ui/src/main/features/'+n+'.ts'))).join('\n')},bundle:true,platform:'node',format:'cjs',outfile:file});
const a=require(file),h=a.createAtlasHandlers(async()=>({data:{applications:[],databaseAvailable:true}})),call=(n,p)=>h.get(n)({},p),s=call('career-workspace-snapshot');
s.state.profile={name:'隔离验收用户',headline:'AI产品负责人',summary:'测试资料',targetRoles:['AI产品负责人'],preferredCities:['上海'],minimumMonthlyK:40,evidence:[{id:'fixture',confirmed:true,title:'企业AI平台',text:'负责企业技能平台的需求分析、能力复用与上线。',keywords:['AI','平台'],source:'隔离测试样例'}],resumeText:'仅用于界面验收的虚构资料'};
call('career-workspace-save',{state:JSON.stringify(s.state),baseRevision:s.revision});
const sample=[['a','澄明科技','明天下午能安排面试吗',false,1],['b','星河产品','可以介绍一下你的项目吗',false,2],['c','映山软件','您好，期待了解岗位职责',true,0],['d','海屿智能','',undefined,0]];
a.saveBossSnapshot({account:{id:'fixture-account',name:'测试账户'},items:sample.map(([id,company,text,self,unread])=>({bossId:id,bossName:'招聘者 '+id,companyName:company,encryptJobId:'job-'+id,lastText:text,lastIsSelf:self,unreadCount:unread,updateTime:Date.now()-10000}))});
for(const [id,company,text] of sample.slice(0,3)){
 a.ingestBossJobs('fixture-account',{code:0,zpData:{jobInfo:{encryptId:'job-'+id,jobName:'AI产品负责人',postDescription:'负责企业AI平台产品规划、需求分析和能力复用；与研发协作推进业务场景落地，持续收集反馈优化产品体验。'.repeat(3),address:'上海市徐汇区',salaryDesc:'40-60K·14薪'},bossInfo:{encryptBossId:id,name:'招聘者 '+id,activeTimeDesc:'刚刚活跃'},brandComInfo:{encryptBrandId:'company-'+id,brandName:company,stageName:'B轮'}}},'/wapi/zpgeek/job/detail.json');
 a.saveBossSnapshot({account:{id:'fixture-account',name:'测试账户'},items:[],conversation:{bossId:id,identityVerified:true,messages:[{mid:'sent-'+id,isSelf:true,type:'text',text:'您好，我有企业产品相关经历。',time:Date.now()-20000},{mid:'received-'+id,isSelf:false,type:'text',text,time:Date.now()-10000}]}});
}
const serverPromise=a.startAtlasServer(path.resolve('packages/ui/web-dist'),Number(process.env.ATLAS_FIXTURE_PORT)||5180);
serverPromise.then(server=>{console.log('Isolated sync UI ready on '+server.address().port);process.on('SIGTERM',()=>server.close(()=>{a.closeAtlas();fs.rmSync(root,{recursive:true,force:true});process.exit(0)}))});
