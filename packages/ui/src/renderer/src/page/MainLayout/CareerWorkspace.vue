<template>
  <div class="career-page" v-loading="loading">
    <header class="career-header">
      <div>
        <span class="eyebrow">CAREER WORKSPACE</span>
        <h1>简历与求职资料</h1>
        <p>{{ state.profile.headline || '用真实经历，找到值得投入的机会' }}</p>
      </div>
      <div class="actions">
        <ElButton :disabled="dirty || !loaded" @click="exportDocx">导出 Word</ElButton
        ><ElButton @click="showHistory">版本历史</ElButton
        ><ElButton @click="openBoss">前往 BOSS 简历</ElButton
        ><ElButton type="primary" :loading="saving" :disabled="!loaded || !dirty" @click="save()"
          >保存资料</ElButton
        >
      </div>
    </header>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <p class="profile-save-state" role="status">
      {{ dirty ? '● 有未保存的修改' : loaded ? '● 已保存到本机资料库' : '正在读取资料…'
      }}<span v-if="loaded"
        >当前资料版本 {{ profileVersion.slice(0, 8) }} · BOSS 在线简历需单独保存核对</span
      >
    </p>
    <ElButton v-if="activeTab !== 'profile'" class="profile-back" @click="activeTab = 'profile'"
      >← 返回简历与资料</ElButton
    >
    <ElDialog v-model="historyOpen" title="资料版本" width="640px"
      ><p class="muted">恢复会生成新版本，现有历史继续保留。</p>
      <details v-if="migration?.legacy">
        <summary>迁移参考：旧简历已保留，当前资料为唯一来源</summary>
        <p>{{ migration.note }}</p>
        <pre class="migration-text">{{ JSON.stringify(migration.legacy.content, null, 2) }}</pre>
      </details>
      <article v-for="v in versions" :key="v.id" class="opportunity-title">
        <p>版本 {{ v.version }} · {{ new Date(v.createdAt).toLocaleString() }}</p>
        <ElButton @click="restoreVersion(v.id)">恢复此版本</ElButton>
      </article>
      <ElEmpty v-if="!versions.length" description="保存资料后会记录版本"
    /></ElDialog>
    <ElTabs v-model="activeTab" :class="{ 'profile-tabs': activeTab === 'profile' }">
      <ElTabPane label="岗位评估" name="match">
        <div class="match-grid">
          <section class="panel">
            <h2>放入一份职位描述</h2>
            <p class="muted">可从职位库点击「个人匹配」，或直接粘贴 BOSS 的岗位要求。</p>
            <ElForm label-position="top" :disabled="saving">
              <div class="two-col">
                <ElFormItem label="职位名称"
                  ><ElInput v-model="job.jobName" placeholder="例如：AI 产品负责人" /></ElFormItem
                ><ElFormItem label="公司"
                  ><ElInput v-model="job.companyName" placeholder="公司名称"
                /></ElFormItem>
              </div>
              <div class="two-col">
                <ElFormItem label="工作地点"
                  ><ElInput v-model="job.address" placeholder="城市 / 具体办公地点" /></ElFormItem
                ><ElFormItem label="月薪范围（K，可留空）"
                  ><div class="salary-range">
                    <ElInputNumber
                      :model-value="job.salaryLow ?? undefined"
                      @update:model-value="(v) => (job.salaryLow = v ?? null)"
                      :min="1"
                      :max="1000"
                      :controls="false"
                      aria-label="月薪下限"
                    /><span>—</span
                    ><ElInputNumber
                      :model-value="job.salaryHigh ?? undefined"
                      @update:model-value="(v) => (job.salaryHigh = v ?? null)"
                      :min="1"
                      :max="1000"
                      :controls="false"
                      aria-label="月薪上限"
                    /></div
                ></ElFormItem>
              </div>
              <ElFormItem label="完整 JD"
                ><ElInput
                  v-model="job.description"
                  type="textarea"
                  :rows="12"
                  placeholder="粘贴职责、任职要求、团队信息。描述越完整，评估依据越充分。"
              /></ElFormItem>
            </ElForm>
            <details v-if="job.description" class="jd-preview">
              <summary>分区预览岗位正文</summary>
              <StructuredText :source="job.description" />
            </details>
            <ElAlert
              v-if="jobError"
              :title="jobError"
              type="error"
              :closable="false"
              class="draft"
            /><ElButton
              type="primary"
              :loading="saving"
              :disabled="!loaded || !job.jobName.trim() || !job.companyName.trim()"
              @click="addOpportunity"
              >{{ dirty ? '保存修改并加入清单' : '加入跟进清单' }}</ElButton
            >
            <p class="muted">公司与职位名称为必填；未知薪资可留空。评估草稿暂存于当前窗口。</p>
          </section>
          <section class="panel result-panel">
            <div class="score">
              <div>
                <b>岗位初筛与核实清单</b>
                <p>
                  {{ assessment.questions.length }} 项条件待核实 ·
                  {{ assessment.reasons.length }} 条经历关联线索
                </p>
              </div>
            </div>
            <p class="muted">规则初筛与 AI 结论分开展示，经历以本人确认状态为准。</p>
            <h3>可以重点展示</h3>
            <ul v-if="assessment.reasons.length">
              <li v-for="reason in assessment.reasons" :key="reason">{{ reason }}</li>
            </ul>
            <p v-else class="muted">补充岗位与个人经历后显示依据。</p>
            <h3>需要进一步核实</h3>
            <ul>
              <li v-for="question in assessment.questions" :key="question">{{ question }}</li>
            </ul>
            <GreetingComposer
              :job="job"
              :evidence="state.profile.evidence"
              :profile-version="profileVersion"
              :saved="loaded && !dirty"
              v-model="messageDraft"
            />
          </section>
        </div>
      </ElTabPane>
      <ElTabPane label="个人资料与简历" name="profile">
        <ProfileEditor
          :profile="state.profile"
          :disabled="saving || !loaded"
          :dirty="dirty"
          @copy="copy"
          @remove-evidence="removeEvidence"
        />
      </ElTabPane>
      <ElTabPane label="AI 深度分析" name="ai"
        ><section class="panel">
          <p class="muted">使用「岗位评估」中填写的 JD 和已确认经历；生成建议不会直接发送。</p>
          <ElButton type="primary" :loading="analyzing" :disabled="dirty" @click="analyze"
            >使用 DeepSeek 分析当前岗位</ElButton
          >
          <p v-if="dirty">请先保存资料，使分析与资料版本一致。</p>
          <template v-if="ai"
            ><AnalysisReport
              :result="ai"
              :evidence="profileEvidence(state.profile)"
              :outdated="analysisOutdated"
            />
            <h2>首条招呼</h2>
            <p class="muted">通过岗位评估中的招呼流程，按招聘要求选择经历并审校后生成。</p>
            <ElButton @click="activeTab = 'match'">生成与审校首条招呼</ElButton></template
          >
        </section></ElTabPane
      >
      <ElTabPane :label="`机会跟进（${state.opportunities.length}）`" name="track">
        <section class="panel">
          <p class="muted">记录沟通进展、面试问题与下一次跟进日期，修改后点击「保存资料」。</p>
          <ElEmpty v-if="!state.opportunities.length" description="先评估岗位，再加入跟进清单"
            ><ElButton type="primary" @click="activeTab = 'match'"
              >评估第一个岗位</ElButton
            ></ElEmpty
          >
          <article v-for="item in state.opportunities" :key="item.id" class="opportunity">
            <div class="opportunity-title">
              <h2>
                {{ item.job.jobName }} <small>{{ item.job.companyName }}</small>
              </h2>
              <ElTag v-if="isFollowUpDue(item, today)" type="warning">待跟进</ElTag
              ><ElButton link type="primary" @click="review(item.job)">重新评估</ElButton>
            </div>
            <div class="two-col">
              <ElSelect v-model="item.stage" aria-label="跟进阶段"
                ><ElOption
                  v-for="stage in careerStages"
                  :key="stage"
                  :value="stage"
                  :label="stage" /></ElSelect
              ><ElDatePicker
                v-model="item.nextDate"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="下次跟进日期"
                @change="item.nextDate ||= ''"
              />
            </div>
            <ElInput
              v-model="item.note"
              type="textarea"
              :rows="3"
              placeholder="记录团队情况、面试反馈和下次行动"
              class="draft"
            />
          </article>
        </section>
      </ElTabPane>
    </ElTabs>
    <div v-if="removedEvidence" class="undo-bar" role="status">
      已移除「{{ removedEvidence.item.title || '未命名经历' }}」<ElButton
        link
        type="primary"
        @click="undoEvidence"
        >撤销</ElButton
      >
    </div>
    <div v-if="dirty" class="workspace-savebar" role="status">
      <div>
        <b>有未保存的修改</b
        ><small>保存后供岗位分析与话术引用；不会自动更新 BOSS 或发送消息。</small>
      </div>
      <div class="actions">
        <ElButton :disabled="saving" @click="reloadSaved">放弃修改并重新读取</ElButton
        ><ElButton type="primary" :loading="saving" @click="save()">保存全部修改</ElButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { profileEvidence } from '../../../../common/career'
import { useAITasks } from '../../composables/atlasTasks'
const runAITask = useAITasks()
import AnalysisReport from '../../components/career/AnalysisReport.vue'
import StructuredText from '../../components/career/StructuredText.vue'
import ProfileEditor from '../../components/career/ProfileEditor.vue'
import { computed, onActivated, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ElAlert,
  ElButton,
  ElDatePicker,
  ElDialog,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElSelect,
  ElTabPane,
  ElTabs,
  ElTag
} from 'element-plus'
import {
  assessCareerJob,
  careerStages,
  emptyCareerState,
  isFollowUpDue,
  validateCareerState,
  type CareerJob,
  type CareerEvidence
} from '../../../../common/career'
import GreetingComposer from '../../components/career/GreetingComposer.vue'
import { useDraftProtection } from '../../composables/useDraftProtection'
import { localDay } from '../../../../common/dashboard'
const state = ref(emptyCareerState())
const historyOpen = ref(false),
  versions = ref<any[]>([]),
  migration = ref<any>(null)
async function showHistory() {
  try {
    const data = await electron.ipcRenderer.invoke('career-profile-history')
    versions.value = data.versions
    migration.value = data.migration
    historyOpen.value = true
  } catch (e) {
    error.value = String(e)
  }
}
async function restoreVersion(id: string) {
  try {
    await ElMessageBox.confirm('恢复此资料版本？当前未保存的修改将被替换。', '恢复资料', {
      confirmButtonText: '恢复此版本',
      cancelButtonText: '保留当前资料'
    })
    await electron.ipcRenderer.invoke('career-profile-restore', {
      id,
      baseRevision: revision.value
    })
    await loadSnapshot()
    historyOpen.value = false
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') error.value = String(e)
  }
}
async function exportDocx() {
  try {
    const file = await electron.ipcRenderer.invoke('career-profile-docx')
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = file.filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  } catch (e) {
    error.value = String(e)
  }
}
const profileVersion = ref('')
const revision = ref(''),
  jobError = ref('')
const removedEvidence = ref<{ item: CareerEvidence; index: number } | null>(null)
const loading = ref(true),
  loaded = ref(false),
  saving = ref(false),
  error = ref(''),
  saved = ref('')
const route = useRoute(),
  router = useRouter()
const activeTab = computed({
  get: () =>
    ['match', 'track', 'ai'].includes(String(route.query.tab))
      ? String(route.query.tab)
      : 'profile',
  set: (tab) => {
    router.replace({
      path: '/main-layout/CareerWorkspace',
      query: { ...route.query, tab: tab === 'profile' ? undefined : tab }
    })
  }
})
const ai = ref<any>(null),
  analyzing = ref(false),
  aiBasis = ref('')
const analysisOutdated = computed(
  () => !!ai.value && aiBasis.value !== JSON.stringify([state.value.profile, job.value])
)
async function analyze() {
  analyzing.value = true
  error.value = ''
  try {
    aiBasis.value = JSON.stringify([state.value.profile, job.value])
    ai.value = await runAITask('career-ai-analyze', {
      job: JSON.parse(JSON.stringify(job.value))
    })
  } catch (e) {
    error.value = String(e)
  } finally {
    analyzing.value = false
  }
}
const job = ref<CareerJob>({
  jobName: '',
  companyName: '',
  description: '',
  address: '',
  salaryLow: null,
  salaryHigh: null
})
const messageDraft = ref('')
const today = localDay()
const dirty = computed(() => loaded.value && JSON.stringify(state.value) !== saved.value)
const assessment = computed(() => assessCareerJob(job.value, state.value.profile))
function normalizeSalary() {
  if (!Number.isFinite(state.value.profile.minimumMonthlyK))
    state.value.profile.minimumMonthlyK = null
}
async function loadSnapshot() {
  const snapshot = await electron.ipcRenderer.invoke('career-workspace-snapshot')
  validateCareerState(snapshot.state)
  state.value = snapshot.state
  saved.value = JSON.stringify(snapshot.state)
  revision.value = snapshot.revision
  profileVersion.value = snapshot.profileVersion
  loaded.value = true
}
async function save() {
  if (!loaded.value || saving.value) return false
  saving.value = true
  error.value = ''
  try {
    normalizeSalary()
    validateCareerState(state.value)
    const payload = JSON.stringify(state.value)
    const snapshot = await electron.ipcRenderer.invoke('career-workspace-save', {
      state: payload,
      baseRevision: revision.value
    })
    revision.value = snapshot.revision
    profileVersion.value = snapshot.profileVersion
    saved.value = JSON.stringify(snapshot.state)
    if (JSON.stringify(state.value) === payload) state.value = snapshot.state
    removedEvidence.value = null
    ElMessage.success('资料已保存，新分析将使用此版本')
    return true
  } catch (e) {
    error.value = `保存失败，当前修改已保留：${String(e)}`
    return false
  } finally {
    saving.value = false
  }
}
async function reloadSaved() {
  try {
    await ElMessageBox.confirm(
      '放弃当前页面尚未保存的资料修改，读取本机最新版本。',
      '重新读取资料',
      { confirmButtonText: '重新读取', cancelButtonText: '保留修改', type: 'warning' }
    )
    await loadSnapshot()
    error.value = ''
    removedEvidence.value = null
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') error.value = '读取失败，当前编辑内容仍保留。'
  }
}
function removeEvidence(index: number) {
  removedEvidence.value = { item: state.value.profile.evidence[index], index }
  state.value.profile.evidence.splice(index, 1)
}
function undoEvidence() {
  if (removedEvidence.value) {
    state.value.profile.evidence.splice(removedEvidence.value.index, 0, removedEvidence.value.item)
    removedEvidence.value = null
  }
}
useDraftProtection(dirty, save)
function consumeJob() {
  const incoming = sessionStorage.getItem('career-selected-job')
  if (!incoming) return
  try {
    const value = JSON.parse(incoming)
    if (typeof value.jobName !== 'string' || typeof value.description !== 'string')
      throw new Error('格式错误')
    review(value)
    sessionStorage.removeItem('career-selected-job')
  } catch {
    ElMessage.error('职位导入失败，请手动粘贴 JD')
  }
}
function review(value: CareerJob) {
  job.value = { ...value }
  activeTab.value = 'match'
  messageDraft.value = ''
}
async function addOpportunity() {
  if (!loaded.value || saving.value || !job.value.jobName.trim() || !job.value.companyName.trim())
    return
  jobError.value = ''
  const existing = state.value.opportunities.find((o) =>
    job.value.encryptJobId
      ? o.job.encryptJobId === job.value.encryptJobId
      : o.job.jobName.trim().toLowerCase() === job.value.jobName.trim().toLowerCase() &&
        o.job.companyName.trim().toLowerCase() === job.value.companyName.trim().toLowerCase()
  )
  if (existing) {
    activeTab.value = 'track'
    ElMessage.info('此岗位已在跟进清单中')
    return
  }
  const item = {
    id: crypto.randomUUID(),
    job: {
      ...job.value,
      jobName: job.value.jobName.trim(),
      companyName: job.value.companyName.trim()
    },
    stage: '待评估' as const,
    nextDate: '',
    note: '',
    createdAt: new Date().toISOString()
  }
  try {
    validateCareerState({ ...state.value, opportunities: [item, ...state.value.opportunities] })
  } catch (e) {
    jobError.value = String(e)
    return
  }
  state.value.opportunities.unshift(item)
  if (await save()) activeTab.value = 'track'
  else {
    state.value.opportunities = state.value.opportunities.filter((o) => o.id !== item.id)
    jobError.value = '尚未加入清单。请处理上方保存提示，评估内容仍保留。'
  }
}
async function copy(value: string) {
  try {
    await electron.ipcRenderer.invoke('career-copy-text', value)
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败，请选中文本手动复制')
  }
}
function openBoss() {
  electron.ipcRenderer.send('open-external-link', 'https://www.zhipin.com/web/user/')
}
function shortcut(event: KeyboardEvent) {
  if (
    route.path.endsWith('/CareerWorkspace') &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 's'
  ) {
    event.preventDefault()
    if (dirty.value) save()
  }
}
watch(
  [job, messageDraft],
  () => {
    try {
      sessionStorage.setItem(
        'atlas-assessment-draft',
        JSON.stringify({ job: job.value, message: messageDraft.value })
      )
    } catch {
      /* The working form remains usable if session storage is unavailable. */
    }
  },
  { deep: true }
)
onMounted(async () => {
  window.addEventListener('keydown', shortcut)
  try {
    const draft = JSON.parse(sessionStorage.getItem('atlas-assessment-draft') || 'null')
    if (
      draft?.job &&
      typeof draft.job.jobName === 'string' &&
      typeof draft.job.companyName === 'string' &&
      typeof draft.job.description === 'string'
    ) {
      job.value = draft.job
      messageDraft.value = typeof draft.message === 'string' ? draft.message : ''
    }
  } catch {
    /* Ignore an invalid cached draft. */
  }
  try {
    await loadSnapshot()
  } catch (e) {
    error.value = `资料读取失败，保存已禁用以保护原文件：${String(e)}`
  } finally {
    loading.value = false
    consumeJob()
  }
})
onActivated(async () => {
  if (loaded.value && !dirty.value && !saving.value) {
    try {
      await loadSnapshot()
    } catch (e) {
      error.value = `资料同步失败：${String(e)}`
    }
  }
  consumeJob()
})
onBeforeUnmount(() => window.removeEventListener('keydown', shortcut))
</script>

<style scoped>
.profile-tabs :deep(> .el-tabs__header) {
  display: none;
}
.profile-save-state {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  color: var(--el-color-success);
  font-size: 12px;
  margin: 18px 0 0;
}
.profile-save-state span {
  color: var(--el-text-color-secondary);
}
.profile-back {
  margin: 18px 0;
}

.shared-direction {
  padding: 18px;
  background: var(--el-color-primary-light-9);
  border-radius: 9px;
  margin: 18px 0;
  font-size: 13px;
}
.shared-direction p {
  line-height: 1.8;
}
.evidence {
  border-left: 3px solid var(--el-color-warning) !important;
}
.evidence.verified {
  border-left-color: var(--el-color-success) !important;
}
.evidence-milestone {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-bottom: 16px;
}
.evidence-milestone span {
  color: var(--el-color-primary);
  font-size: 20px;
}
.evidence-milestone small {
  margin-left: auto;
  color: var(--el-text-color-secondary);
}
.migration-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 360px;
  overflow: auto;
  font: inherit;
}
.career-page {
  height: 100%;
  overflow: auto;
  padding: 28px 32px;
  box-sizing: border-box;
  background: var(--atlas-bg);
  color: var(--el-text-color-primary);
}
.career-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}
.eyebrow {
  color: var(--el-color-primary);
  font-size: 11px;
  letter-spacing: 2px;
  font-weight: 700;
}
h1 {
  font-size: 27px;
  margin: 8px 0;
}
h2 {
  font-size: 17px;
  margin: 0 0 16px;
}
h3 {
  font-size: 14px;
  margin: 24px 0 10px;
}
p {
  line-height: 1.6;
}
.career-header p {
  color: var(--el-text-color-secondary);
  margin: 0;
}
.actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
.actions .el-button + .el-button {
  margin-left: 0;
}
.overview {
  display: flex;
  align-items: center;
  gap: 35px;
  padding: 21px 0;
  margin: 12px 0;
  border-bottom: 1px solid var(--el-border-color-light);
}
.overview b {
  font-size: 22px;
  padding-right: 6px;
}
.overview small {
  margin-left: auto;
  color: var(--el-text-color-secondary);
}
.match-grid {
  display: grid;
  grid-template-columns: minmax(340px, 1.05fr) minmax(300px, 1fr);
  gap: 20px;
}
.panel {
  padding: 24px;
  background: var(--atlas-panel);
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.two-col > * {
  min-width: 0;
}
.score {
  display: flex;
  gap: 20px;
  align-items: center;
}
.score strong {
  font-size: 48px;
  color: var(--el-color-success);
}
.score b {
  font-size: 19px;
}
.score p {
  margin: 5px 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
ul {
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.9;
}
.draft {
  margin: 12px 0;
}
.full-width {
  width: 100%;
}
.evidence,
.opportunity {
  border-top: 1px solid var(--el-border-color-light);
  padding: 22px 0;
}
.el-form h2 {
  margin-top: 28px;
}
.opportunity-title {
  display: flex;
  align-items: baseline;
  gap: 18px;
}
.opportunity-title h2 {
  flex: 1;
}
.opportunity-title small {
  font-size: 13px;
  margin-left: 12px;
  color: var(--el-text-color-secondary);
}
@media (max-width: 1050px) {
  .match-grid {
    grid-template-columns: 1fr;
  }
  .career-header {
    align-items: flex-start;
  }
  .migration-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 360px;
    overflow: auto;
    font: inherit;
  }
  .career-page {
    padding: 20px;
  }
}
.salary-range {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.salary-range .el-input-number {
  width: calc(50% - 13px);
}
.workspace-savebar {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  margin-top: 22px;
  padding: 16px 20px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 10px;
  box-shadow: 0 -10px 30px rgba(30, 55, 90, 0.08);
  font-size: 13px;
}
.workspace-savebar small {
  display: block;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 5px;
}
.undo-bar {
  display: flex;
  align-items: center;
  gap: 15px;
  padding: 12px 20px;
  color: var(--el-color-success);
  font-size: 13px;
}
.career-header .actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}
@media (max-width: 760px) {
  .two-col {
    grid-template-columns: 1fr;
  }
  .overview {
    flex-wrap: wrap;
    gap: 14px;
  }
  .overview small {
    margin-left: 0;
    flex-basis: 100%;
  }
  .career-header,
  .workspace-savebar {
    flex-direction: column;
    align-items: flex-start;
  }
  .match-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .career-page {
    padding: 18px;
  }
  .panel {
    padding: 18px;
  }
  .actions {
    flex-wrap: wrap;
  }
  .workspace-savebar .actions {
    gap: 8px;
  }
  .workspace-savebar {
    padding: 12px;
  }
}
</style>
