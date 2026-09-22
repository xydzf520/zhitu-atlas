<template>
  <section class="conversation-pitch" aria-label="岗位匹配话术">
    <label v-if="jobs.length > 1" class="pitch-job"
      >话术对应岗位<select v-model="jobId" aria-label="选择话术对应岗位">
        <option value="">请选择本次沟通的岗位</option>
        <option v-for="j in jobs" :key="j.encryptJobId" :value="j.encryptJobId">
          {{ j.jobName }} · {{ j.companyName }}
        </option>
      </select></label
    >
    <p class="pitch-basis">
      {{ context?.jobName || '当前关联岗位' }} ·
      {{ context?.confirmedEvidenceCount ?? '—' }} 项已确认经历
    </p>
    <div class="pitch-actions">
      <button
        class="pitch-primary"
        :disabled="!context?.ready || loading || disabled || busy"
        @click="generate"
      >
        {{
          busy ? 'AI 正在匹配与审校…' : draft?.text ? '重新生成岗位匹配话术' : '生成岗位匹配话术'
        }}</button
      ><button :disabled="loading || busy" @click="refresh">
        {{ loading ? '核对依据中…' : '更新依据' }}</button
      ><RouterLink v-if="busy" to="/main-layout/CareerTasks">查看任务</RouterLink>
    </div>
    <p v-if="!context?.ready || disabled" class="pitch-hint">
      {{
        disabled
          ? '请等待最新会话读取完成；查看历史消息时先返回最新一页。'
          : context?.reason || '正在读取关联 JD 与个人经历…'
      }}
      <RouterLink
        v-if="context && !context.confirmedEvidenceCount"
        to="/main-layout/CareerWorkspace?tab=profile"
        >确认经历 →</RouterLink
      >
    </p>
    <p v-else-if="!draft?.text" class="pitch-hint">
      无需等待对方回复。AI 会挑选与 JD 最相关的 1–2 项经历，写出具体匹配点。
    </p>
    <p v-if="error" role="alert" class="pitch-error">{{ error }}</p>
    <p v-if="stale" class="pitch-error">
      岗位、资料或会话已更新，下面是旧话术，请更新生成后再使用。
    </p>
    <template v-if="draft?.text">
      <p class="pitch-preview">{{ draft.text }}</p>
      <AiDraftReview
        :key="key"
        v-model="draft.text"
        v-model:confirmation="draft.confirmation"
        :basis="JSON.stringify([key, draft.basis, context?.basis || draft.basis])"
        :request-open="draft.reviewPending"
        @opened="draft.reviewPending = false"
        :active="active !== false"
        :available="!!context?.ready && !stale && !loading && !disabled && !busy"
        :disabled-reason="
          stale ? '资料、JD 或会话已变化，请重新生成后确认。' : '正在核对最新依据，请稍候。'
        "
        :verify="verifyDraft"
        :context="draft.jobName"
        title="确认岗位匹配话术"
      >
        <article v-for="(m, i) in draft.matches" :key="i">
          <span>岗位要求</span>
          <p>{{ m.requirement }}</p>
          <span>{{ m.evidenceTitle }} · 已确认原文</span>
          <blockquote>{{ m.evidenceQuote }}</blockquote>
          <span>为什么相关</span>
          <p>{{ m.relevance }}</p>
        </article>
        <div v-if="draft.gaps?.length" class="pitch-gaps">
          <b>仍需核实</b>
          <ul>
            <li v-for="gap in draft.gaps" :key="gap">{{ gap }}</li>
          </ul>
        </div>
        <small
          >依据资料版本 {{ draft.profileVersion?.slice(0, 10) }} · {{ draft.jobName
          }}<br />修改后的话术需自行核对；生成与复制不会发送。</small
        >
      </AiDraftReview>
      <ProjectEvidenceCards :projects="draft.projects" />
    </template>
  </section>
</template>
<script setup lang="ts">
import ProjectEvidenceCards from './ProjectEvidenceCards.vue'
import { computed, ref, watch } from 'vue'
import AiDraftReview from './AiDraftReview.vue'
import { useAITasks } from '../../composables/atlasTasks'
const props = defineProps<{
  accountId: string
  bossId: string
  jobs: any[]
  conversation: any
  disabled?: boolean
  active?: boolean
}>()
const run = useAITasks(),
  jobId = ref(''),
  context = ref<any>(),
  loading = ref(false),
  errors = ref<Record<string, string>>({}),
  busyKeys = ref<Record<string, boolean>>({}),
  copied = ref(''),
  contextError = ref('')
const drafts = ref<Record<string, any>>({}),
  jobChoices = new Map<string, string>()
const conversationKey = computed(() => JSON.stringify([props.accountId, props.bossId]))
const key = computed(() => JSON.stringify([props.accountId, props.bossId, jobId.value]))
const draft = computed(() => drafts.value[key.value]),
  error = computed(() => contextError.value || errors.value[key.value] || ''),
  busy = computed(() => !!busyKeys.value[key.value])
const stale = computed(
  () => !!draft.value && !!context.value && draft.value.basis !== context.value.basis
)
try {
  const stored = JSON.parse(sessionStorage.getItem('atlas-conversation-pitches') || '{}')
  for (const [k, v] of Object.entries(stored))
    if (v && typeof (v as any).text === 'string') drafts.value[k] = v
} catch {}
watch(
  drafts,
  (value) => {
    try {
      sessionStorage.setItem('atlas-conversation-pitches', JSON.stringify(value))
    } catch {
      errors.value[key.value] = '当前窗口无法暂存，请复制话术后再离开。'
    }
  },
  { deep: true }
)
watch(
  [conversationKey, () => props.jobs],
  () => {
    const chosen = jobChoices.get(conversationKey.value)
    jobId.value =
      chosen && props.jobs.some((j) => j.encryptJobId === chosen)
        ? chosen
        : props.jobs.length === 1
          ? props.jobs[0].encryptJobId
          : ''
  },
  { immediate: true }
)
let sequence = 0
watch(
  [key, () => props.conversation, () => props.active],
  () => {
    copied.value = ''
    if (props.active !== false) void refresh()
    else {
      sequence++
      loading.value = false
    }
  },
  { immediate: true }
)
watch(jobId, (value) => {
  jobChoices.set(conversationKey.value, value)
})
async function refresh() {
  if (!props.accountId || !props.bossId || props.active === false) return
  const ticket = ++sequence,
    target = key.value
  loading.value = true
  context.value = undefined
  contextError.value = ''
  try {
    const next = await electron.ipcRenderer.invoke('career-conversation-pitch-context', {
      accountId: props.accountId,
      bossId: props.bossId,
      jobId: jobId.value
    })
    if (ticket === sequence && target === key.value) {
      context.value = next
      contextError.value = ''
    }
  } catch (e) {
    if (ticket === sequence) contextError.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (ticket === sequence) loading.value = false
  }
}
async function verifyDraft() {
  const current = await electron.ipcRenderer.invoke('career-conversation-pitch-context', {
    accountId: props.accountId,
    bossId: props.bossId,
    jobId: jobId.value
  })
  if (!current.ready || current.basis !== draft.value?.basis)
    throw Error('岗位、经历或最新消息已变化，请重新生成话术。')
}
async function generate() {
  if (!context.value?.ready || loading.value || busy.value || props.disabled) return
  const target = key.value,
    original = drafts.value[target]?.text,
    basis = context.value
  busyKeys.value[target] = true
  errors.value[target] = ''
  copied.value = ''
  try {
    const result = await run('career-conversation-pitch', {
      accountId: props.accountId,
      bossId: props.bossId,
      jobId: jobId.value,
      baseBasis: basis.basis
    })
    if (drafts.value[target]?.text !== original)
      throw Error('生成期间你修改了原话术，已保留你的编辑；新结果可在任务中心查看。')
    if (!result?.text) throw Error(result?.reason || '尚无足够匹配依据，原话术保留。')
    drafts.value[target] = {
      ...result,
      jobName: result.job?.jobName || basis.jobName,
      originalText: result.text,
      reviewPending: true,
      confirmation: ''
    }
  } catch (e) {
    errors.value[target] = e instanceof Error ? e.message : String(e)
  } finally {
    busyKeys.value[target] = false
  }
}
</script>
<style scoped>
.pitch-preview {
  white-space: pre-wrap;
  line-height: 1.8;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.conversation-pitch {
  font-size: 12px;
}
.pitch-basis {
  color: var(--el-text-color-secondary);
  margin: 10px 0;
  line-height: 1.6;
}
.pitch-actions,
.pitch-footer {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin: 9px 0;
}
.pitch-actions a {
  font-size: 11px;
}
.pitch-primary {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
button {
  font: inherit;
  border: 1px solid var(--el-border-color);
  border-radius: 7px;
  padding: 8px 10px;
  background: var(--atlas-panel);
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.pitch-hint,
.pitch-error {
  font-size: 12px;
  line-height: 1.7;
  margin: 8px 0;
}
.pitch-hint {
  color: var(--el-text-color-secondary);
}
.pitch-error {
  color: #986017;
}
textarea,
select {
  width: 100%;
  font: inherit;
  box-sizing: border-box;
  border: 1px solid var(--el-border-color);
  border-radius: 7px;
  padding: 10px;
  background: var(--atlas-panel);
  color: var(--el-text-color-primary);
}
textarea {
  resize: vertical;
  min-height: 105px;
  line-height: 1.8;
  max-height: 220px;
}
.pitch-footer {
  justify-content: space-between;
}
.pitch-footer small,
.pitch-evidence > small {
  font-size: 10px;
  color: var(--el-text-color-secondary);
  line-height: 1.7;
}
.pitch-evidence {
  border-top: 1px solid var(--el-border-color);
  margin-top: 12px;
  padding-top: 12px;
}
.pitch-evidence summary {
  cursor: pointer;
  color: var(--el-color-primary);
}
.pitch-evidence article {
  margin: 12px 0;
  padding: 12px;
  background: #f5f7fb;
  border-radius: 8px;
  line-height: 1.8;
}
.pitch-evidence article span {
  font-size: 10px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}
.pitch-evidence p {
  margin: 4px 0 10px;
}
.pitch-evidence blockquote {
  margin: 6px 0 10px;
  padding: 8px 10px;
  background: white;
  border-left: 2px solid var(--el-color-primary-light-7);
}
.pitch-gaps {
  font-size: 11px;
  line-height: 1.8;
}
.pitch-job {
  display: grid;
  gap: 6px;
  font-size: 11px;
  margin-top: 10px;
}
:global(.atlas-pitch-dialog) {
  max-height: 88vh;
  display: flex;
  flex-direction: column;
}
:global(.atlas-pitch-dialog .el-dialog__body) {
  min-height: 0;
  overflow: auto;
}
:global(.atlas-pitch-dialog textarea) {
  max-height: 240px;
  min-height: 130px;
}
</style>
