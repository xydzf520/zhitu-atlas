const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parse,compileScript}=require('@vue/compiler-sfc'),{build}=require('esbuild'),{createSSRApp,h}=require('vue'),{renderToString}=require('@vue/server-renderer');

test('runtime summary subscribes by default, scopes queries, and honors explicit inactive state',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-summary-test-'));
 try{
  const file=path.resolve('packages/ui/src/renderer/src/components/career/ExecutionSummary.vue');
  const {descriptor}=parse(fs.readFileSync(file,'utf8'),{filename:file});
  const script=compileScript(descriptor,{id:'execution-summary-regression',inlineTemplate:true});
  const outfile=path.join(root,'component.cjs');
  await build({stdin:{contents:script.content,resolveDir:path.dirname(file),loader:'ts'},bundle:true,platform:'node',format:'cjs',outfile,plugins:[{name:'isolate-feed',setup(b){
   b.onResolve({filter:/^vue$/},()=>({path:require.resolve('vue'),external:true}));
   b.onResolve({filter:/composables\/executionFeed$/},()=>({path:'feed',namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import {ref} from 'vue';export const queries=[];export function useExecutionFeed(query){const value=query();globalThis.__atlasSummaryQuery=value;return {data:ref(value?{items:[],runningModels:0,automationPaused:true,sendingPaused:true}:null),error:ref('')}}`}));
  }}]});
  const component=require(outfile).default;
  const render=async(props)=>{const app=createSSRApp(component,props);app.component('RouterLink',{render(){return h('a',this.$slots.default())}});return renderToString(app)};
  assert.match(await render({}),/自动任务已暂停/);assert.deepEqual(globalThis.__atlasSummaryQuery,{state:'active',objectId:'',agentId:''});
  await render({objectId:'job-a',agentId:'analysis'});assert.deepEqual(globalThis.__atlasSummaryQuery,{state:'active',objectId:'job-a',agentId:'analysis'});
  await render({active:false});assert.equal(globalThis.__atlasSummaryQuery,null);
 }finally{delete globalThis.__atlasSummaryQuery;fs.rmSync(root,{recursive:true,force:true})}
});
