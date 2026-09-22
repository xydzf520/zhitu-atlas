<template>
  <section class="sync-results" aria-label="同步结果与缺失清单">
    <header class="result-header"><div><h2>{{ report?.outcomeLabel || '正在核对同步结果…' }}</h2><p>按当前登录账号核对入库结果。列表读取结束、字段齐备与历史完整是三个不同状态。</p></div><button :disabled="loading" @click="load">{{ loading ? '核对中…' : '刷新结果' }}</button></header>
    <p v-if="error" class="result-error" role="alert">{{ error }}；已有结果保留，可重新读取。</p>
    <div class="result-status" v-if="report"><span>联系人列表：{{ report.coverage.automatic?.listFinished ? '已读取到页面末尾' : '末尾尚未确认' }}</span><span>待补齐会话：{{ report.missing }}</span><span>历史归档：未验证完整</span><span>核对时间：{{ time(report.checkedAt) }}</span></div>
    <div class="result-filters"><input v-model="query" aria-label="搜索同步结果" placeholder="搜索企业、联系人或岗位" @input="searchSoon"/><label><input v-model="onlyMissing" type="checkbox" @change="resetPage"/> 仅看缺失与异常</label><span>{{ report?.total || 0 }} 个会话</span></div>
    <div class="result-list" :aria-busy="loading">
      <article v-for="c in report?.items || []" :key="c.bossId">
        <header><div><h3>{{ c.companyName }}</h3><span>{{ c.bossName }} · {{ c.messages }} 条已采集消息</span></div><button @click="emit('conversation', c.bossId)">查看聊天记录 →</button></header>
        <p class="history-line">消息读取：{{ c.readAt ? time(c.readAt) : '等待读取' }} · {{ c.historyReason }}</p>
        <p v-if="c.skippedMessages" class="result-error">{{ c.skippedMessages }} 条消息缺少稳定 ID 或存在身份冲突，未强行入库。</p>
        <p v-if="c.missingJobId" class="result-error">平台尚未提供关联岗位 ID，不能猜测关联公司或地址。</p>
        <div v-for="j in c.jobs" :key="j.jobId" class="job-result">
          <div><strong>{{ j.jobName }}</strong><span class="field-status" :class="{ missing: j.missing.length }">{{ j.missing.length ? '待补齐 ' + j.missing.join('、') : '字段齐备' }}</span></div>
          <p>{{ j.address || (j.workAddresses.length > 1 ? j.workAddresses.join('；') : '工作地址未返回') }}</p>
          <p>{{ j.reason }}<span v-if="j.lastAttemptAt"> · 最近读取 {{ time(j.lastAttemptAt) }}</span></p>
          <button @click="emit('opportunity', j.jobId)">查看岗位、匹配与位置 →</button>
        </div>
      </article>
      <p v-if="report && !report.items.length" class="empty">{{ query || onlyMissing ? '当前条件下没有结果，可清除搜索或取消仅看缺失。' : '还没有账号数据。请在桌面 BOSS 工作台登录；已保存的数据会自动出现在这里。' }}</p>
    </div>
    <nav v-if="report && report.total > 20" aria-label="同步结果分页"><button :disabled="loading || page <= 1" @click="page--; load()">上一页</button><span>{{ page }} / {{ Math.ceil(report.total / 20) }}</span><button :disabled="loading || page * 20 >= report.total" @click="page++; load()">下一页</button></nav>
    <section class="capabilities"><h2>哪些数据已经接入</h2><div v-for="item in report?.capabilities || []" :key="item.name"><strong>{{ item.name }}</strong><b>{{ item.state }}</b><p>{{ item.detail }}</p></div></section>
    <p class="scope-note">后台打开会话可能让平台标为已读，Atlas 保留待查看提醒。读取不发送消息，不会自动更新在线简历或修改面试状态。</p>
  </section>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, onActivated, onDeactivated } from 'vue'
const emit = defineEmits<{ (e: 'conversation', id: string): void; (e: 'opportunity', id: string): void; (e: 'coverage', value: any): void }>()
const report = ref<any>(), loading = ref(false), error = ref(''), query = ref(''), onlyMissing = ref(false), page = ref(1)
let sequence = 0, timer: ReturnType<typeof setInterval> | undefined, debounce: ReturnType<typeof setTimeout> | undefined
const time = (s: string) => s ? new Date(s).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '尚未读取'
async function load() {
  const ticket = ++sequence; loading.value = true
  try {
    const next = await electron.ipcRenderer.invoke('career-boss-sync-report', { page: page.value, query: query.value, onlyMissing: onlyMissing.value })
    if (ticket !== sequence) return
    report.value = next; page.value = next.page; error.value = ''; emit('coverage', next.coverage)
  } catch(e: any) { if (ticket === sequence) error.value = e.message || '同步结果读取失败' }
  finally { if (ticket === sequence) loading.value = false }
}
function resetPage() { page.value = 1; void load() }
function searchSoon() { if (debounce) clearTimeout(debounce); debounce = setTimeout(resetPage, 250) }
function start() { if (timer) return; void load(); timer = setInterval(()=>{if(!document.hidden)void load()}, 10000) }
function stop() { sequence++; clearInterval(timer); timer = undefined; if (debounce) clearTimeout(debounce); loading.value = false }
onMounted(start)
onActivated(start)
onDeactivated(stop)
onBeforeUnmount(stop)
defineExpose({ refresh: load })
</script>
<style scoped>
.sync-results{font-size:13px}.result-header,.result-list article>header{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}.result-header h2,.capabilities h2{font-size:19px;margin:12px 0}.result-header p,.history-line,.scope-note{color:var(--el-text-color-secondary);line-height:1.8}.result-status{display:flex;gap:12px 24px;flex-wrap:wrap;padding:16px 0;color:var(--el-text-color-regular);font-size:12px}.result-filters{display:flex;gap:20px;align-items:center;padding:16px 0;flex-wrap:wrap}.result-filters>input{flex:1;min-width:200px;max-width:480px}.result-filters label{display:flex;gap:7px;align-items:center;cursor:pointer}.result-filters input[type=checkbox]{accent-color:var(--el-color-primary);width:16px;height:16px}.result-filters span{margin-left:auto;color:var(--el-text-color-secondary)}
.sync-results button{border:1px solid var(--el-border-color);background:var(--atlas-panel);color:var(--el-color-primary);padding:8px 12px;border-radius:7px;font:inherit;cursor:pointer}.sync-results button:hover:not(:disabled){background:var(--el-color-primary-light-9);border-color:var(--el-color-primary-light-7)}.result-list{display:grid;gap:14px}.result-list article{padding:20px;border:1px solid var(--el-border-color);background:var(--atlas-panel);border-radius:12px}.result-list h3{font-size:16px;margin:0 0 8px}.result-list header span{color:var(--el-text-color-secondary);font-size:12px}.history-line{margin:12px 0!important;font-size:12px}.job-result{background:var(--el-fill-color-light);padding:15px;border-radius:8px;margin-top:12px}.job-result>div{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.job-result p{font-size:12px;color:var(--el-text-color-secondary);line-height:1.8;margin:8px 0!important}.field-status{font-size:11px;padding:3px 7px;border-radius:5px;background:var(--el-color-success-light-9);color:var(--el-color-success)}.field-status.missing{color:var(--el-color-warning);background:var(--el-color-warning-light-9)}.result-error{color:var(--el-color-danger)!important;line-height:1.8}.capabilities{margin-top:26px}.capabilities>div{display:grid;grid-template-columns:140px 100px 1fr;gap:16px;padding:16px 0;border-bottom:1px solid var(--el-border-color)}.capabilities b{font-weight:500;color:var(--el-color-primary)}.capabilities p{color:var(--el-text-color-secondary);line-height:1.8}.sync-results nav{display:flex;justify-content:flex-end;align-items:center;gap:14px;margin:18px 0}.scope-note{margin-top:20px!important}.empty{padding:32px;text-align:center;color:var(--el-text-color-secondary)}@media(max-width:800px){.capabilities>div{grid-template-columns:1fr 100px}.capabilities p{grid-column:1/-1}}
</style>
