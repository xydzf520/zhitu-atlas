<template>
  <section v-if="coverage" class="sync-coverage" aria-label="BOSS 同步覆盖情况">
    <div class="coverage-heading">
      <div><strong>{{ automaticLabel }}</strong><span>{{ coverage.automatic?.message || '桌面工作台核实登录后开始读取' }}</span></div>
      <div class="coverage-actions">
        <button :disabled="saving || !coverage.accountId" @click="control({ action: 'sync-now' })">{{ saving ? '提交中…' : '立即同步' }}</button>
        <button :disabled="saving" @click="control({ enabled: !coverage.automatic?.enabled })">{{ coverage.automatic?.enabled ? '暂停读取' : '恢复读取' }}</button>
        <RouterLink to="/main-layout/CareerTasks?tab=sync">查看同步结果 →</RouterLink>
      </div>
    </div>
    <div class="coverage-numbers">
      <span>会话正文 <b>{{ coverage.conversationsWithMessages }} / {{ coverage.conversations }}</b></span>
      <span>消息 <b>{{ coverage.messages }}</b></span>
      <span>岗位详情 <b>{{ coverage.linkedDetails }} / {{ coverage.linkedJobs }}</b></span>
      <span>工作地址 <b>{{ coverage.addresses }} / {{ coverage.linkedJobs }}</b></span>
    </div>
    <p>{{ missing }} · 全部历史未验证<span v-if="coverage.automatic?.completedAt"> · 最近一轮结束 {{ time(coverage.automatic.completedAt) }}</span></p>
    <p v-if="notice || controlError" :role="controlError ? 'alert' : 'status'" :class="{ failure: controlError }">{{ controlError || notice }}</p>
  </section>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { bossCollectorLabel } from '../../../../common/career-ux'
const props = defineProps<{ coverage: any }>()
const emit = defineEmits<{ (e: 'changed'): void }>()
const saving = ref(false), controlError = ref(''), notice = ref('')
const automaticLabel = computed(() => bossCollectorLabel(props.coverage?.automatic))
const time = (s: string) => new Date(s).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
async function control(action: any) {
  saving.value = true; controlError.value = ''; notice.value = ''
  try {
    const s = await electron.ipcRenderer.invoke('career-boss-sync-control', { ...action, accountId: props.coverage.accountId })
    notice.value = s.enabled ? '已请求后台读取，结果会自动更新；前台 BOSS 页面保持不变。' : '已暂停新的后台读取，已有记录保留。'
    emit('changed')
  } catch (e: any) { controlError.value = e.message || '操作未完成，请重试。' }
  finally { saving.value = false }
}
const missing = computed(() => {
  const c = props.coverage
  if (!c?.linkedJobs) return '等待关联岗位'
  const fields = [c.linkedJobs - c.descriptions, c.linkedJobs - c.salaries, c.linkedJobs - c.addresses]
  return fields.some(n => n > 0) ? `待补齐：${Math.max(0, fields[0])} 个岗位要求、${Math.max(0, fields[1])} 个薪资、${Math.max(0, fields[2])} 个地址` : '当前关联岗位字段已齐备'
})
</script>
<style scoped>
.sync-coverage{margin:16px 0;padding:18px 20px;border:1px solid var(--el-border-color);border-radius:12px;background:var(--atlas-panel);font-size:12px;color:var(--el-text-color-regular)}
.coverage-heading{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.coverage-heading>div:first-child{display:grid;gap:7px}.coverage-heading strong{font-size:14px;color:var(--el-text-color-primary)}.coverage-heading span{font-size:12px;color:var(--el-text-color-secondary)}
.coverage-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.coverage-actions button{border:1px solid var(--el-border-color);background:var(--atlas-panel);color:var(--el-text-color-regular);border-radius:7px;padding:8px 12px;cursor:pointer;font:inherit}.coverage-actions button:first-child{color:var(--el-color-primary);background:var(--el-color-primary-light-9);border-color:var(--el-color-primary-light-7)}.coverage-actions a{color:var(--el-color-primary);padding:7px 5px}.coverage-actions button:disabled{opacity:.5;cursor:default}.coverage-actions button:hover:not(:disabled){border-color:var(--el-color-primary)}
.coverage-numbers{display:flex;gap:12px 24px;flex-wrap:wrap;margin:18px 0 12px}.coverage-numbers b{font-size:18px;margin-left:6px;font-variant-numeric:tabular-nums;color:var(--el-text-color-primary)}.sync-coverage p{font-size:12px;line-height:1.7;margin:8px 0 0;color:var(--el-text-color-secondary)}.sync-coverage .failure{color:var(--el-color-danger)}
</style>
