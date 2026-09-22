<template>
 <main class="task-page">
  <header><div><h1>任务中心</h1><p>同一账号共用执行队列。每一步都有状态、结果与处理入口。</p></div><ElButton @click="load">更新状态</ElButton></header>
  <ElAlert v-if="error" :title="error" type="error" :closable="false" />
  <section class="control panel"><div><h2>{{ data?.automationPaused ? '全部自动任务已暂停' : '自动任务允许运行' }}</h2><p>暂停全部：不派发新的搜索、采集、分析和发送。手动查看与编辑仍可使用。</p></div><ElButton :type="data?.automationPaused ? 'primary' : 'default'" @click="toggle">{{ data?.automationPaused ? '恢复自动任务' : '暂停全部自动任务' }}</ElButton></section>
  <ElTabs v-model="tab"><ElTabPane label="Agent 运行台" name="agents"><ExecutionWorkbench v-if="tab==='agents'" /></ElTabPane><ElTabPane label="执行队列" name="queue">
   <section class="panel"><h2>执行进度与联系结果</h2><p>搜索、详情和分析展示当前采集轮次；联系与核验展示当前账号的任务库存。</p><ol class="steps"><li v-for="(step,i) in steps" :key="step.label" :class="step.state"><span>{{ i+1 }}</span><strong>{{ step.label }}</strong><small>{{ step.text }}</small></li></ol><p>{{ data?.discovery?.message || '暂无发现任务。到机会发现启动一轮，或等待每日推荐。' }}</p><RouterLink to="/main-layout/CareerDiscovery">查看机会发现 →</RouterLink></section>
   <section class="panel"><div class="control"><h2>后台任务</h2><span>{{ data?.total || 0 }} 条任务 · 关闭页面后继续运行</span></div><p>排队：手动 {{ data?.queued?.manual || 0 }} 项 · 自动 {{ data?.queued?.automatic || 0 }} 项。手动优先；已开始的模型调用不会被抢占。</p><p v-if="!data?.items?.length" class="empty">尚无后台任务。岗位读取、同步、分析、招呼和发送核验会汇聚在这里。</p>
    <article v-for="t in data?.items" :key="t.id" class="task-row"><span :class="['state',t.state]">{{ states[t.state] || t.state }}</span><div><h3>{{ kinds[t.kind] || t.kind }}</h3><p>{{ t.error || t.step }}</p><small>{{ time(t.created_at) }} · {{ elapsed(t) }}</small></div><ElButton v-if="['queued','running'].includes(t.state) && t.kind.startsWith('career-')" @click="cancel(t)">取消</ElButton><ElButton v-if="t.state==='completed'" @click="open(t)">查看结果</ElButton></article>
    <nav v-if="data?.total>20"><ElButton :disabled="page===1" @click="page--;load()">上一页</ElButton><span>第 {{ page }} 页</span><ElButton :disabled="page*20>=data.total" @click="page++;load()">下一页</ElButton></nav>
   </section>
  </ElTabPane><ElTabPane label="发送控制与核验" name="sending"><AtlasOperations v-if="tab==='sending'" section="tasks" /></ElTabPane><ElTabPane label="同步覆盖与异常" name="sync"><BossSyncResults v-if="tab==='sync'" @conversation="conversation" @opportunity="opportunity" /></ElTabPane></ElTabs>
  <ElDialog v-model="resultOpen" title="任务结果" width="min(960px,calc(100vw - 32px))" class="task-result"><p>这里是任务执行时的结果快照。岗位和会话可能已变化，当前操作请回到机会发现或沟通中心核对。</p><InsightReport v-if="['resume-review','market-review'].includes(result?.kind)" :report="{...result,stale:resultOutdated}" @action="router.push('/main-layout/CareerInsights')"/><AnalysisReport v-else-if="result?.analysis" :result="result" :evidence="evidence" :outdated="resultOutdated" /><template v-else><p v-if="result?.text" class="result-text">{{ result.text }}</p><p v-if="result?.reason">{{ result.reason }}</p><p v-if="result?.after">扩展词：{{ result.after.join('、') || '保持核心词' }}</p><template v-if="result?.source && result?.actions"><p>{{ result.summary }}</p><ol><li v-for="a in result.actions" :key="a.id"><strong>{{ a.title }}</strong><p>{{ a.reason }}</p><RouterLink :to="a.destination">进入相关页面 →</RouterLink></li></ol></template><template v-if="result?.questions"><p>{{ result.focus }}</p><article v-for="(q,i) in result.questions" :key="i"><h3>{{ q.question }}</h3><p>{{ q.outline }}</p></article></template><details><summary>结果字段与来源</summary><pre>{{ JSON.stringify(result,null,2) }}</pre></details></template></ElDialog>
 </main>
</template>
<script setup lang="ts">
import ExecutionWorkbench from '../../components/career/ExecutionWorkbench.vue'
import InsightReport from '../../components/career/InsightReport.vue'
import { ref,computed,watch,onMounted,onActivated,onDeactivated,onBeforeUnmount } from 'vue'
import { useRoute,useRouter } from 'vue-router'
import { profileEvidence } from '../../../../common/career'
import { contactStates } from '../../../../common/contact'
import { ElAlert,ElButton,ElDialog,ElTabs,ElTabPane } from 'element-plus'
import AtlasOperations from '../../components/career/AtlasOperations.vue'
import BossSyncResults from '../../components/career/BossSyncResults.vue'
import AnalysisReport from '../../components/career/AnalysisReport.vue'
const route=useRoute(),router=useRouter(),tab=ref(String(route.query.tab||'agents')),data=ref<any>(),error=ref(''),page=ref(1),result=ref<any>(),resultOpen=ref(false),resultOutdated=ref(false),evidence=ref<any[]>([])
watch(()=>route.query.tab,v=>{tab.value=String(v || 'agents')})
const states:Record<string,string>={...contactStates,queued:'等待',running:'运行中',completed:'已完成',cancelled:'已取消',failed:'异常',interrupted:'待核实',review:'待人工核实',waiting:'等待',paused:'暂停'}
const kinds:Record<string,string>={'career-coordinator-plan':'求职协调安排','career-resume-review':'简历竞争力诊断','career-market-review':'市场机会研判','paper-simulation':'模拟盘评估','career-paper-analyze':'模拟盘 AI 预览','first-contact':'岗位自动联系','discovery-run':'搜索与详情补齐','boss-sync':'账号增量同步','send-first-contact':'首次联系','send-reply':'常规回复','send-follow-up':'跟进','career-ai-analyze':'岗位深度分析','career-discovery-analyze':'机会分析','career-greeting-generate':'匹配招呼','career-strategy-optimize':'搜索策略复盘','career-followup-draft':'待确认跟进草稿','career-reply-draft':'沟通建议','career-conversation-pitch':'会话岗位匹配话术','career-interview-prepare':'面试准备','career-company-research':'企业搜索与研判'}
const steps=computed(()=>{
 const r=data.value?.discovery,c=data.value?.contactCounts || {},n=(...keys:string[])=>keys.reduce((sum,k)=>sum+(c[k]||0),0)
 const collecting=r?.state==='running',analyzing=r?.state==='analyzing',finished=r?.state==='completed'
 return [
 {label:'搜索岗位',state:collecting?'running':r?.jobIds?.length?'done':'waiting',text:r?`${r.jobIds?.length||0} 个候选`:'等待启动'},
 {label:'补齐详情',state:collecting?'running':r?.detailIds?.length?'done':'waiting',text:`${r?.detailIds?.length||0} 个已处理`},
 {label:'分析匹配',state:analyzing?'running':finished?'done':'waiting',text:`${r?.analyzedIds?.length||0} 份分析`},
 {label:'准备联系',state:n('generating','opening','sending')?'running':'waiting',text:`待处理 ${n('queued','generating','ready','awaiting_confirmation')} · 冷却 ${n('cooling')}`},
 {label:'结果核验',state:n('verifying')?'running':n('completed')?'done':'waiting',text:`平台核验 ${n('completed')} · 人工确认 ${n('manual')} · 待处理 ${n('uncertain','review','failed')}`}]
})
let timer:ReturnType<typeof setInterval>|undefined,busy=false
async function load(){if(busy)return;busy=true;try{data.value=await electron.ipcRenderer.invoke('career-task-center',{page:page.value});error.value=''}catch(e){error.value=String(e)}finally{busy=false}}
async function toggle(){try{await electron.ipcRenderer.invoke('career-automation-pause',{paused:!data.value?.automationPaused});await load()}catch(e){error.value=String(e)}}
async function cancel(t:any){try{await electron.ipcRenderer.invoke('career-task-cancel',{id:t.id});await load()}catch(e){error.value=String(e)}}
async function open(t:any){try{const r=await electron.ipcRenderer.invoke('career-task-get',{id:t.id});result.value=r.result;resultOutdated.value=r.inputOutdated;const p=await electron.ipcRenderer.invoke('career-workspace-snapshot');evidence.value=profileEvidence(p.state.profile);resultOpen.value=true}catch(e){error.value=String(e)}}
const time=(v:string)=>new Date(v).toLocaleString('zh-CN')
const elapsed=(t:any)=>`${Math.max(0,Math.floor(((t.state==='running'?Date.now():Date.parse(t.updated_at))-Date.parse(t.created_at))/60000))} 分钟${t.state==='running'?' · 心跳 '+new Date(t.heartbeat_at).toLocaleTimeString('zh-CN'):''}`
const conversation=(id:string)=>router.push({path:'/main-layout/CareerDashboard',query:{view:'replies',conversation:id}})
const opportunity=(id:string)=>router.push({path:'/main-layout/CareerDashboard',query:{view:'companies',job:id}})
function start(){void load();if(!timer)timer=setInterval(()=>{if(!document.hidden)void load()},4000)}
function stop(){clearInterval(timer);timer=undefined}
onMounted(start);onActivated(start);onDeactivated(stop);onBeforeUnmount(stop)
</script>
<style scoped>
.task-page{height:100%;overflow:auto;padding:30px;box-sizing:border-box;font-size:13px}.task-page>header,.control{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}.task-page small{color:var(--el-text-color-secondary)}h1{font-size:28px;margin:12px 0}h2{font-size:18px}p{color:var(--el-text-color-secondary);line-height:1.8}.panel{padding:22px;border:1px solid var(--el-border-color);border-radius:12px;background:var(--atlas-panel);margin:20px 0}.steps{display:grid;grid-template-columns:repeat(5,1fr);padding:12px 0;list-style:none;gap:12px}.steps li{display:grid;gap:10px;border-top:3px solid var(--el-border-color);padding-top:16px}.steps li.done{border-color:var(--el-color-success)}.steps li.running{border-color:var(--el-color-primary)}.steps span{border-radius:50%;background:var(--el-fill-color-light);width:30px;height:30px;display:grid;place-items:center}.task-row{display:flex;gap:18px;padding:18px 0;border-top:1px solid var(--el-border-color);align-items:center}.task-row>div{flex:1;min-width:0}.task-row h3{font-size:14px;margin:0}.task-row p{margin:8px 0}.state{padding:6px 9px;border-radius:7px;background:var(--el-fill-color-light);white-space:nowrap}.state.running{background:var(--el-color-primary-light-9);color:var(--el-color-primary)}.state.failed,.state.interrupted{color:var(--el-color-warning-dark-2);background:var(--el-color-warning-light-9)}.state.completed{background:var(--el-color-success-light-9);color:var(--el-color-success)}nav{display:flex;gap:12px;justify-content:flex-end;align-items:center}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.result-text{white-space:pre-line;line-height:1.9}.empty{text-align:center;padding:30px}@media(max-width:800px){.steps{grid-template-columns:repeat(3,1fr)}.task-page{padding:20px}}
</style>
