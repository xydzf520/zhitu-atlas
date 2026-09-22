<template>
  <section class="storage-panel" aria-label="存储管理">
    <header>
      <div>
        <h2>存储与数据健康</h2>
        <p>业务历史保留，重复分析共享正文。整理只回收无引用正文和已过期的备份临时文件。</p>
      </div>
      <ElButton :loading="busy" @click="load">更新占用</ElButton>
    </header>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <p v-if="!data && !error" role="status">正在检查本机存储…</p>
    <template v-if="data">
      <div class="storage-metrics">
        <article>
          <span>业务数据库</span><b>{{ bytes(data.databaseBytes) }}</b
          ><small>岗位、对话、资料与历史</small>
        </article>
        <article>
          <span>AI 分析正文</span><b>{{ data.analysis.count }} 份</b
          ><small
            >{{ data.analysis.references }} 处引用 · 避免重复正文约
            {{ bytes(data.analysis.savedPayloadBytes) }}</small
          >
        </article>
        <article>
          <span>简历附件</span><b>{{ bytes(data.attachmentBytes) }}</b
          ><small>与资料版本分别保存</small>
        </article>
        <article>
          <span>备份临时文件</span><b>{{ bytes(data.temporaryBackupBytes) }}</b
          ><small>整理时回收过期且未使用的文件</small>
        </article>
      </div>
      <p>
        最近生成备份：{{
          data.lastBackup?.at ? new Date(data.lastBackup.at).toLocaleString('zh-CN') : '暂无记录'
        }}<span v-if="data.lastBackup">
          · {{ bytes(data.lastBackup.size) }} · 请确认已下载保存</span
        >
      </p>
      <div class="storage-actions">
        <ElButton :disabled="busy" @click="check">校验数据与关联</ElButton
        ><ElButton :disabled="busy" @click="maintain">整理可回收数据</ElButton>
      </div>
      <p v-if="notice" role="status">{{ notice }}</p>
      <table>
        <caption>
          已存业务记录 · 跨账号总数，不代表平台全部历史
        </caption>
        <tbody>
          <tr v-for="(label, key) in labels" :key="key">
            <th>{{ label }}</th>
            <td>{{ data.counts[key] }}</td>
          </tr>
        </tbody>
      </table>
      <details>
        <summary>存储详情与整理范围</summary>
        <p>
          当前结构版本 {{ data.schema }}；写入日志 {{ bytes(data.walBytes) }}；库内可复用空闲页
          {{ bytes(data.freeBytes) }}。日志由数据库管理，不能手动删除。
        </p>
        <p>
          无引用的分析正文 {{ data.analysis.orphan.count }} 份，约
          {{
            bytes(data.analysis.orphan.bytes)
          }}。已引用的报告、聊天、发送凭据、个人资料和历史版本不会被此操作删除。
        </p>
        <p>程序安装包与开发构建产物单独管理，不计入业务数据库。</p>
      </details>
    </template>
  </section>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElAlert, ElButton, ElMessageBox } from 'element-plus'
const data = ref<any>(),
  busy = ref(false),
  error = ref(''),
  notice = ref('')
const labels: Record<string, string> = {
  platform_jobs: '岗位',
  platform_conversations: '会话',
  platform_messages: '消息',
  profile_versions: '资料版本',
  task_runs: '任务记录',
  send_attempts: '发送凭据',
  platform_job_history: '岗位变更',
  events: '事件历史'
}
const bytes = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MiB`
    : n >= 1024
      ? `${(n / 1024).toFixed(1)} KiB`
      : `${n || 0} B`
const call = (c: string, p?: unknown) => electron.ipcRenderer.invoke(c, p)
async function run(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') error.value = String(e)
  } finally {
    busy.value = false
  }
}
const load = () =>
  run(async () => {
    data.value = await call('career-storage-overview')
  })
const check = () =>
  run(async () => {
    const r = await call('career-storage-check')
    notice.value = `${r.ok ? '校验通过' : '发现异常，请保留数据并核对备份'} · ${r.scope}`
  })
const maintain = () =>
  run(async () => {
    await ElMessageBox.confirm(
      '仅回收无引用的分析正文和超过 24 小时且未使用的备份临时文件，保留业务历史。',
      '整理存储',
      { confirmButtonText: '整理', cancelButtonText: '取消' }
    )
    const r = await call('career-storage-maintain', { confirm: true })
    data.value = r.overview
    notice.value = `已回收 ${r.removedAnalysisBodies} 份无引用正文和 ${bytes(r.removedTemporaryBytes)} 临时文件；数据库空闲页可供后续写入复用。`
  })
onMounted(load)
</script>
<style scoped>
.storage-panel {
  line-height: 1.7;
}
.storage-panel header {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: center;
}
.storage-panel h2 {
  margin: 0;
}
.storage-panel p,
.storage-panel small {
  color: var(--el-text-color-secondary);
}
.storage-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin: 22px 0;
}
.storage-metrics article {
  display: grid;
  gap: 10px;
  background: var(--el-fill-color-light);
  padding: 20px;
  border-radius: 10px;
}
.storage-metrics b {
  font-size: 24px;
}
.storage-metrics small {
  font-size: 12px;
}
.storage-actions {
  display: flex;
  gap: 12px;
}
.storage-panel table {
  width: 100%;
  border-collapse: collapse;
  margin: 24px 0;
}
.storage-panel caption {
  text-align: left;
  color: var(--el-text-color-secondary);
  margin-bottom: 12px;
}
.storage-panel th,
.storage-panel td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color);
}
.storage-panel th {
  font-weight: 500;
}
.storage-panel summary {
  cursor: pointer;
  color: var(--el-color-primary);
}
@media (max-width: 1200px) {
  .storage-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 650px) {
  .storage-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
