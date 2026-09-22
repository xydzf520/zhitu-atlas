<template><section class="strategy"><header><div><h2>AI 动态优化</h2><p>保留核心词和硬条件，根据已确认经历与反馈调整扩展词。</p></div><ElButton :loading="busy" :disabled="(data?.usage.automaticStrategy || 0)>=(data?.usage.strategyLimit ?? 1)" @click="optimize">复盘搜索策略</ElButton></header><p v-if="error" role="alert">{{ error }}</p><div class="budget" v-if="data"><span>今日自动深度分析 <b>{{ data.usage.automaticAnalysis }} / {{ data.usage.analysisLimit }}</b></span><span>策略复盘 <b>{{ data.usage.automaticStrategy }} / {{ data.usage.strategyLimit }}</b></span><span>已收集反馈 <b>{{ data.feedbackCount }} 条</b></span></div><details v-if="data?.items.length"><summary>调整记录与撤销 · {{ data.items.length }} 次</summary><article v-for="r in data.items" :key="r.id"><time>{{ new Date(r.at).toLocaleString('zh-CN') }}</time><div class="diff"><span>{{ r.before.join('、') || '无扩展词' }}</span><span>→</span><b>{{ r.after.join('、') || '仅核心词' }}</b></div><p>{{ r.reason }}</p><p v-if="r.focus?.length">排序参考：{{ r.focus.join('；') }}</p><ElButton v-if="r.applied && !r.rejected" @click="undo(r)">撤销此次调整</ElButton><span v-else>已撤销，此偏好下不再重复应用</span></article></details><p v-else class="empty">尚无调整记录。反馈不足时依据目标和经历推荐，不从单次回复推断效果。</p><RouterLink v-if="busy" to="/main-layout/CareerTasks">后台正在执行，可到任务中心查看或取消 →</RouterLink></section></template>
<script setup lang="ts">
import {ref,onMounted} from 'vue'
import {ElButton} from 'element-plus'
import { useAITasks } from '../../composables/atlasTasks'
const runAITask = useAITasks()
const emit=defineEmits(['updated']),data=ref<any>(),busy=ref(false),error=ref('')
async function load(){try{data.value=await electron.ipcRenderer.invoke('career-strategy-history')}catch(e){error.value=String(e)}}
async function optimize(){busy.value=true;error.value='';try{await runAITask('career-strategy-optimize',{});await load();emit('updated')}catch(e){error.value=String(e)}finally{busy.value=false}}
async function undo(r:any){try{await electron.ipcRenderer.invoke('career-strategy-undo',{id:r.id,baseRevision:data.value.policyRevision});await load();emit('updated')}catch(e){error.value=String(e)}}
onMounted(load)
</script>
<style scoped>
.strategy{margin:24px 0;border:1px solid var(--el-border-color);background:var(--atlas-panel);padding:22px;border-radius:12px;font-size:13px}.strategy header{display:flex;justify-content:space-between;align-items:center;gap:20px}.strategy h2{font-size:18px;margin:0}.strategy p{line-height:1.8;color:var(--el-text-color-secondary)}.budget{display:flex;flex-wrap:wrap;gap:20px;background:var(--el-color-primary-light-9);padding:18px;border-radius:8px}.budget b{color:var(--el-color-primary);margin-left:8px}summary{cursor:pointer;color:var(--el-color-primary);margin-top:18px}.diff{display:flex;gap:15px;flex-wrap:wrap;margin-top:14px}article{padding:18px 0;border-bottom:1px solid var(--el-border-color)}time,.empty{color:var(--el-text-color-secondary);font-size:12px}
</style>
