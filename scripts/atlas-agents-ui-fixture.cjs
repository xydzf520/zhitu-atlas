// Production UI with isolated data and deterministic model responses. No BOSS or credentials.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{buildSync}=require('esbuild')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-agents-ui-'))
process.env.ATLAS_DATA_ROOT=root
fs.mkdirSync(path.join(root,'config'),{recursive:true})
fs.writeFileSync(path.join(root,'config/llm.json'),JSON.stringify([{enabled:true,model:'deepseek-flash',providerApiSecret:'isolated-model',providerCompleteApiUrl:'https://api.deepseek.com'}]))
global.fetch=async(url,opts)=>{
 if(!String(url).startsWith('https://api.deepseek.com'))throw Error('Fixture blocks external requests')
 const body=JSON.parse(opts.body)
 return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({recommendation:{decision:'consider',reason:'具备已确认的产品规划经历',nextStep:'核实具体职责'},businessGoal:'平台建设',requirements:[{requirement:'产品规划',evidenceIds:['fixture'],assessment:'经历已确认',status:'met',essential:false}],strengths:['平台规划'],gaps:[],questions:[],draft:'',resumeSuggestions:[]})},finish_reason:'stop'}],usage:{prompt_tokens:300,completion_tokens:120,total_tokens:420}})}
}
const file=path.join(root,'api.cjs')
buildSync({stdin:{resolveDir:process.cwd(),contents:['atlas-server','atlas-service','atlas-store','atlas-agents'].map(n=>`export * from './packages/ui/src/main/features/${n}'`).join('\n')},bundle:true,platform:'node',format:'cjs',outfile:file})
const a=require(file),handlers=a.createAtlasHandlers(),s=handlers.get('career-workspace-snapshot')()
s.state.profile.evidence=[{id:'fixture',title:'测试平台经历',text:'负责企业平台产品规划与需求分析，推进产品上线交付。',keywords:['产品','平台'],source:'隔离测试',confirmed:true}]
handlers.get('career-workspace-save')({}, {state:JSON.stringify(s.state),baseRevision:s.revision})
;(async()=>{
 const result=await handlers.get('career-ai-analyze')({}, {job:{jobName:'平台产品经理',description:'负责企业平台的产品规划与需求分析，推动产品从方案到上线交付。'.repeat(5)}})
 const server=await a.startAtlasServer(path.resolve('packages/ui/web-dist'),5198)
 console.log('Agent UI fixture ready on 5198; model responses are simulated; no real sends.')
 process.on('SIGTERM',()=>server.close(()=>{a.closeAtlas();fs.rmSync(root,{recursive:true,force:true});process.exit(0)}))
})().catch(e=>{console.error(e);process.exitCode=1})
