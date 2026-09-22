<template>
  <section class="operations">
    <header>
      <div>
        <h2>
          {{
            section === 'data'
              ? '存储与数据管理'
              : section === 'pipeline'
                ? '面试与 Offer'
                : '发送控制与结果核验'
          }}
        </h2>
        <p>
          {{
            section === 'data'
              ? '查看数据占用、导入岗位，或制作可恢复的加密备份。'
              : '统一限额与暂停，重要事项保留人工确认。'
          }}
        </p>
      </div>
      <ElButton :loading="busy" @click="load">更新状态</ElButton>
    </header>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElAlert v-if="notice" :title="notice" type="success" :closable="false" />
    <ElTabs v-model="tab">
      <ElTabPane v-if="section === 'data'" label="存储管理" name="storage"
        ><StoragePanel v-if="tab === 'storage'"
      /></ElTabPane>
      <ElTabPane v-if="section === 'tasks'" label="发送控制" name="tasks">
        <template v-if="tasks"
          ><h3>
            {{ tasks.policy.paused ? '自动发送已暂停' : '自动发送已启用，等待条件核验' }}
          </h3>
          <p>
            BOSS
            实际发送流程待账号验证；猎聘目前支持文件导入，自动连接尚未实现。页面未登录、经历未确认或条件缺失时不会发送。恢复备份后需重新开启。
          </p>
          <div class="fields">
            <label
              >两平台每日自动发送上限<ElInputNumber
                v-model="policy.dailyLimit"
                :min="1"
                :max="100" /></label
            ><label
              >每日首条招呼上限<ElInputNumber
                v-model="policy.firstContactLimit"
                :min="0"
                :max="policy.dailyLimit" /></label
            ><label>开始时间<ElInputNumber v-model="policy.startHour" :min="0" :max="23" /></label
            ><label>结束时间<ElInputNumber v-model="policy.endHour" :min="1" :max="24" /></label>
          </div>
          <ElCheckbox v-model="policy.outbound">匹配后自动联系新招聘者</ElCheckbox>
          <div class="actions">
            <ElButton :disabled="busy || !policyDirty" @click="savePolicy(tasks.policy.paused)"
              >保存策略</ElButton
            ><ElButton type="primary" :disabled="busy" @click="savePolicy(false)"
              >保存并启用</ElButton
            ><ElButton :disabled="busy" @click="pauseAll">暂停发送</ElButton>
          </div>
          <p v-if="tasks.lastError">任务已停止：{{ tasks.lastError.reason }}</p>
          <p v-if="tasks.outboundBlocked">最近拦截：{{ tasks.outboundBlocked.reason }}</p>
          <details v-if="tasks.outboundDraft">
            <summary>最近自动任务生成的匹配招呼（平台发送结果单独核实）</summary>
            <p>{{ tasks.outboundDraft.job.companyName }} · {{ tasks.outboundDraft.job.jobName }}</p>
            <p>{{ tasks.outboundDraft.text }}</p>
            <small>{{ tasks.outboundDraft.model }} · {{ tasks.outboundDraft.createdAt }}</small>
          </details>
          <p>{{ tasks.leases.length }} 个页面正在处理 · 最近 {{ tasks.sends.length }} 次发送尝试</p>
          <ElTable :data="tasks.sends" max-height="300"
            ><ElTableColumn prop="platform" label="平台" width="90" /><ElTableColumn
              prop="kind"
              label="动作"
              width="120"
            /><ElTableColumn prop="status" label="结果" width="100" /><ElTableColumn
              prop="updated_at"
              label="更新时间"
            /><ElTableColumn label="结果核实" width="320"
              ><template #default="{ row }"
                ><template v-if="['sending', 'uncertain'].includes(row.status)"
                  ><ElButton link @click="resolveAttempt(row, 'sent')">已发送</ElButton
                  ><ElButton link @click="resolveAttempt(row, 'not-sent')">未发送</ElButton
                  ><ElButton link @click="resolveAttempt(row, 'unknown')"
                    >仍不确定</ElButton
                  ></template
                ></template
              ></ElTableColumn
            ></ElTable
          >
        </template>
      </ElTabPane>
      <ElTabPane v-if="section === 'pipeline'" label="面试与 Offer" name="pipeline"
        ><p>{{ pipeline?.definition }}</p>
        <p v-if="pipeline?.stats">
          阶段统计分母 {{ pipeline.stats.total }} 个机会 · 首次日期未知
          {{ pipeline.stats.withoutDate }} 个
        </p>
        <h3 v-if="pipeline?.offers.length">Offer 对比</h3>
        <ElTable v-if="pipeline?.offers.length" :data="pipeline.offers"
          ><ElTableColumn label="企业 / 岗位"
            ><template #default="{ row }"
              >{{ row.opportunity.job.companyName }} / {{ row.opportunity.job.jobName }}</template
            ></ElTableColumn
          ><ElTableColumn label="固定税前年薪 K"
            ><template #default="{ row }">{{
              row.fixedAnnualK ?? '待确认'
            }}</template></ElTableColumn
          ><ElTableColumn label="含已填奖金 K"
            ><template #default="{ row }">{{
              row.totalAnnualK ?? '待确认'
            }}</template></ElTableColumn
          ><ElTableColumn label="工作地点"
            ><template #default="{ row }">{{
              row.body.location || '待确认'
            }}</template></ElTableColumn
          ><ElTableColumn label="答复截止"
            ><template #default="{ row }">{{ row.body.date || '待定' }}</template></ElTableColumn
          ></ElTable
        ><ElEmpty
          v-if="!pipeline?.related.length"
          description="从机会详情添加面试、Offer 或待办"
        /><ElTable v-else :data="pipeline.related"
          ><ElTableColumn label="公司"
            ><template #default="{ row }">{{
              row.opportunity.job.companyName
            }}</template></ElTableColumn
          ><ElTableColumn label="类型"
            ><template #default="{ row }">{{ kindLabels[row.kind] }}</template></ElTableColumn
          ><ElTableColumn label="事项"
            ><template #default="{ row }">{{ row.body.title }}</template></ElTableColumn
          ><ElTableColumn label="时间"
            ><template #default="{ row }">{{ row.body.date || '待定' }}</template></ElTableColumn
          ><ElTableColumn label="状态"
            ><template #default="{ row }">{{
              row.body.completed ? '已完成' : '跟进中'
            }}</template></ElTableColumn
          ></ElTable
        ></ElTabPane
      >
      <ElTabPane v-if="section === 'data'" label="岗位导入" name="import"
        ><p>
          支持 CSV 列：公司名称、职位名称、职位描述、地址、月薪下限K、月薪上限K；JSON
          支持岗位数组。可附加平台、账号ID、来源ID、来源链接；三项来源标识齐全时按来源去重，否则仅跳过内容完全相同的行。导入先预览，重复行跳过。
        </p>
        <p><ElButton @click="downloadImportTemplate">下载空白 CSV 模板</ElButton><ElButton @click="downloadImportExample">下载虚构 JSON 示例</ElButton></p>
        <input type="file" accept=".csv,.json" @change="readImport" /><ElButton
          :disabled="!importText || busy"
          @click="previewImport"
          >预览导入</ElButton
        ><template v-if="importPreview"
          ><p>
            新增 {{ importPreview.newCount }} · 重复 {{ importPreview.duplicateCount }} · 错误
            {{ importPreview.errors.length }}
          </p>
          <p v-for="e in importPreview.errors" :key="e.row">第 {{ e.row }} 行：{{ e.error }}</p>
          <ElTable :data="importPreview.rows.slice(0, 20)"
            ><ElTableColumn label="公司"
              ><template #default="{ row }">{{ row.job.companyName }}</template></ElTableColumn
            ><ElTableColumn label="岗位"
              ><template #default="{ row }">{{ row.job.jobName }}</template></ElTableColumn
            ></ElTable
          ><ElButton
            type="primary"
            :disabled="busy || !!importPreview.errors.length || !importPreview.newCount"
            @click="commitImport"
            >确认导入</ElButton
          ></template
        ></ElTabPane
      >
      <ElTabPane v-if="section === 'data'" label="加密备份" name="backup"
        ><p>
          包含资料、机会、沟通历史、Atlas 工作台设置和附件。新版以分块加密传输，原始数据上限 512
          MiB，兼容旧备份。迁移不包含登录 Cookie 和 API 密钥；恢复后全部任务保持暂停。
        </p>
        <ElInput
          v-model="password"
          type="password"
          show-password
          autocomplete="new-password"
          placeholder="备份密码，至少 10 位"
        />
        <div class="actions">
          <ElButton :disabled="busy || password.length < 10" @click="exportBackup"
            >生成加密备份</ElButton
          ><input type="file" accept=".atlas" @change="readBackup" /><ElButton
            :disabled="busy || !backupFile || password.length < 10"
            @click="previewBackup"
            >解密并预览</ElButton
          >
        </div>
        <template v-if="backupPreview"
          ><p>备份时间 {{ backupPreview.createdAt }} · 附件 {{ backupPreview.attachments }} 个</p>
          <p>恢复会替换当前业务数据，请先导出当前备份。</p>
          <ElButton type="danger" :disabled="busy" @click="restoreBackup"
            >确认恢复此备份</ElButton
          ></template
        ></ElTabPane
      >
    </ElTabs>
  </section>
</template>
<script setup lang="ts">
import { opportunityTemplate, opportunityExample } from '../../../../common/import-template'
function downloadImportFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const downloadImportTemplate = () => downloadImportFile('atlas-jobs-template.csv', opportunityTemplate, 'text/csv;charset=utf-8')
const downloadImportExample = () => downloadImportFile('atlas-jobs-example-fictional.json', JSON.stringify(opportunityExample, null, 2), 'application/json')
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import StoragePanel from './StoragePanel.vue'
import { useDraftProtection } from '../../composables/useDraftProtection'
import {
  ElAlert,
  ElButton,
  ElCheckbox,
  ElEmpty,
  ElInput,
  ElInputNumber,
  ElMessageBox,
  ElTabPane,
  ElTabs,
  ElTable,
  ElTableColumn
} from 'element-plus'
const props = withDefaults(defineProps<{ section?: 'tasks' | 'data' | 'pipeline' }>(), {
  section: 'data'
})
const tab = ref(props.section === 'data' ? 'storage' : props.section),
  tasks = ref<any>(null),
  pipeline = ref<any>(null),
  policy = ref<any>({}),
  busy = ref(false),
  error = ref(''),
  notice = ref('')
const password = ref(''),
  backupFile = ref<File | null>(null),
  backupTransfer = ref(''),
  backupPreview = ref<any>(null),
  importText = ref(''),
  importFormat = ref('csv'),
  importPreview = ref<any>(null)
const savedPolicy = ref('')
const policyDirty = computed(
  () => !!savedPolicy.value && JSON.stringify(policy.value) !== savedPolicy.value
)
useDraftProtection(
  policyDirty,
  async () => {
    await savePolicy(tasks.value.policy.paused)
    return !policyDirty.value
  },
  '任务策略'
)
const kindLabels: Record<string, string> = { interview: '面试', offer: 'Offer', todo: '待办' }
const call = (name: string, payload?: unknown) => electron.ipcRenderer.invoke(name, payload)
async function act(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await fn()
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') error.value = String(e)
  } finally {
    busy.value = false
  }
}
async function readState() {
  if (props.section === 'data') return
  tasks.value = await call('career-tasks-load')
  policy.value = { ...tasks.value.policy }
  savedPolicy.value = JSON.stringify(policy.value)
  pipeline.value = await call('career-pipeline-summary')
}
const load = () =>
  act(async () => {
    if (policyDirty.value)
      await ElMessageBox.confirm('重新读取会放弃未保存的任务策略。', '任务策略', {
        confirmButtonText: '重新读取',
        cancelButtonText: '继续编辑'
      })
    await readState()
  })
const savePolicy = (paused: boolean) =>
  act(async () => {
    await call('career-tasks-policy', {
      policy: { ...policy.value, paused },
      baseRevision: tasks.value.policyRevision
    })
    await readState()
    notice.value = '任务策略已保存'
  })
const pauseAll = () =>
  act(async () => {
    await call('career-tasks-pause')
    await readState()
    notice.value = '已暂停所有新的自动发送；正在发送的消息将保留结果记录'
  })
const resolveAttempt = (row: any, result: string) =>
  act(async () => {
    await ElMessageBox.confirm(
      `请核实 ${row.platform} 会话 ${row.recipient_id} 的这条内容：${row.text}。标记为“${result === 'sent' ? '已发送' : result === 'not-sent' ? '未发送' : '仍不确定'}”？未发送记录也不会自动重试。`,
      '核实发送结果'
    )
    await call('career-send-resolve', { id: row.id, result, updatedAt: row.updated_at })
    await readState()
    notice.value = '核实结果已保存'
  })
const encodeChunk = (buffer: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < buffer.length; i += 8192)
    binary += String.fromCharCode(...buffer.subarray(i, i + 8192))
  return btoa(binary)
}
const exportBackup = () =>
  act(async () => {
    notice.value = '正在建立一致性快照并分块加密…'
    const file = await call('career-backup-create-transfer', { password: password.value }),
      chunks: Uint8Array[] = []
    try {
      let offset = 0
      while (offset < file.size) {
        const part = await call('career-backup-download-chunk', { id: file.id, offset })
        if (part.next <= offset) throw Error('备份下载未继续，请重新导出')
        chunks.push(Uint8Array.from(atob(part.base64), (c) => c.charCodeAt(0)))
        offset = part.next
        notice.value = `正在下载备份 ${Math.round((offset / file.size) * 100)}%`
      }
      const url = URL.createObjectURL(new Blob(chunks, { type: 'application/octet-stream' })),
        a = document.createElement('a')
      a.href = url
      a.download = file.filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
      notice.value = '加密备份已发起下载，请确认文件保存并妥善保管密码'
    } finally {
      await call('career-backup-close-transfer', { id: file.id })
    }
  })
async function readBackup(e: Event) {
  backupPreview.value = null
  if (backupTransfer.value) {
    const id = backupTransfer.value
    backupTransfer.value = ''
    void call('career-backup-close-transfer', { id }).catch(() => {})
  }
  const file = (e.target as HTMLInputElement).files?.[0] || null
  if (file && file.size > 514 * 1024 * 1024) {
    error.value = '文件超过 514 MiB'
    backupFile.value = null
    return
  }
  backupFile.value = file
}
async function uploadBackup() {
  if (backupTransfer.value) return backupTransfer.value
  const file = backupFile.value
  if (!file) throw Error('请选择备份文件')
  const t = await call('career-backup-begin-upload', { size: file.size })
  try {
    let offset = 0
    while (offset < file.size) {
      const buffer = new Uint8Array(await file.slice(offset, offset + t.chunkSize).arrayBuffer())
      const r = await call('career-backup-upload-chunk', {
        id: t.id,
        offset,
        base64: encodeChunk(buffer)
      })
      offset = r.next
      notice.value = `上传备份 ${Math.round((offset / file.size) * 100)}%`
    }
    backupTransfer.value = t.id
    return t.id
  } catch (e) {
    await call('career-backup-close-transfer', { id: t.id })
    throw e
  }
}
const previewBackup = () =>
  act(async () => {
    const id = await uploadBackup()
    notice.value = '正在解密并核对数据库、附件及关联…'
    backupPreview.value = await call('career-backup-preview-transfer', {
      id,
      password: password.value
    })
    notice.value = '预览通过；尚未覆盖当前资料'
  })
const restoreBackup = () =>
  act(async () => {
    await ElMessageBox.confirm(
      '用此备份替换当前业务数据？恢复后全部自动任务保持暂停。',
      '恢复备份',
      { type: 'warning' }
    )
    await call('career-backup-restore-transfer', {
      id: backupTransfer.value,
      password: password.value,
      confirm: true
    })
    await call('career-backup-close-transfer', { id: backupTransfer.value })
    password.value = ''
    backupTransfer.value = ''
    backupFile.value = null
    backupPreview.value = null
    await readState()
    notice.value = '恢复成功。请重新打开资料和机会页面，所有任务当前暂停'
  })
async function readImport(e: Event) {
  importPreview.value = null
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  if (f.size > 8 * 1024 * 1024) {
    error.value = '文件超过 8MB'
    return
  }
  importFormat.value = f.name.endsWith('.json') ? 'json' : 'csv'
  importText.value = await f.text()
}
const previewImport = () =>
  act(async () => {
    importPreview.value = await call('career-import-preview', {
      text: importText.value,
      format: importFormat.value
    })
  })
const commitImport = () =>
  act(async () => {
    const r = await call('career-import-commit', {
      text: importText.value,
      format: importFormat.value,
      baseRevision: importPreview.value.revision
    })
    notice.value = `已导入 ${r.added} 条，跳过 ${r.skipped} 条重复记录`
    importPreview.value = null
  })
onBeforeUnmount(() => {
  if (backupTransfer.value)
    void call('career-backup-close-transfer', { id: backupTransfer.value }).catch(() => {})
})
onMounted(load)
</script>
<style scoped>
.operations {
  border: 1px solid var(--el-border-color);
  border-radius: 14px;
  background: var(--atlas-panel);
  padding: 24px;
  margin-top: 24px;
}
.operations header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.operations h2 {
  margin: 10px 0;
}
.operations p {
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}
.operations .fields {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin: 20px 0;
}
.operations label {
  font-size: 12px;
  display: grid;
  gap: 8px;
  color: var(--el-text-color-secondary);
}
.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
  margin: 20px 0;
}
.overline {
  font-size: 10px;
  color: var(--el-color-primary);
  letter-spacing: 1.5px;
}
@media (max-width: 950px) {
  .operations .fields {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
