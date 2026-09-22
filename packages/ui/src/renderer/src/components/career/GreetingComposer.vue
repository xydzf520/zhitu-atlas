<template>
  <section class="greeting-composer">
    <h3>DeepSeek 匹配招呼</h3>
    <p class="muted">从这份招聘要求中选择重点，用简历里的相关经历说明你为什么适合。</p>
    <ElSelect
      v-model="preferred"
      class="full-width"
      aria-label="招呼重点经历"
      :disabled="generating"
      placeholder="自动选择最相关经历"
      clearable
    >
      <ElOption
        v-for="e in evidence"
        :key="e.id"
        :value="e.id!"
        :label="e.title + (e.confirmed ? ' · 已确认' : ' · 待核对')"
      />
    </ElSelect>
    <div class="actions">
      <ElButton
        type="primary"
        :loading="generating"
        :disabled="!saved || !profileVersion"
        @click="generate(false)"
        >DeepSeek 生成匹配招呼</ElButton
      >
      <ElButton v-if="result" :disabled="generating || !saved" @click="generate(true)"
        >重新生成</ElButton
      >
    </div>
    <p v-if="!saved" class="muted">请先保存资料，让招呼对应当前简历版本。</p>
    <p v-if="generating" class="muted" role="status">正在匹配招聘要求与经历，并检查事实和措辞……</p>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="result">
      <ElAlert
        v-if="outdated"
        title="岗位或资料已变化，请重新生成；原稿仍保留在下方。"
        type="warning"
        :closable="false"
      />
      <p class="generation-meta">
        {{ result.model }} · {{ result.cached ? '复用本岗位已审校结果' : '本次生成' }} ·
        {{ result.text.length }} 字
      </p>
      <h4 class="output-heading">
        招聘要求与自荐依据 <small>{{ result.matches.length }} 项</small>
      </h4>
      <article
        v-for="(match, index) in result.matches"
        :key="match.evidenceId + match.requirement"
        class="matched-fact"
      >
        <h4>
          <span>{{ String(index + 1).padStart(2, '0') }}</span
          >{{ match.requirement }}
        </h4>
        <dl>
          <div>
            <dt>为什么匹配</dt>
            <dd>{{ match.relevance }}</dd>
          </div>
          <div>
            <dt>已引用经历</dt>
            <dd>
              <blockquote>{{ match.evidenceQuote }}</blockquote>
              <small
                >来源：{{
                  evidence.find((e) => e.id === match.evidenceId)?.title || '旧版本经历'
                }}</small
              >
            </dd>
          </div>
        </dl>
      </article>
      <ElAlert
        v-if="result.decision === 'insufficient'"
        title="这份岗位缺少足够匹配依据，未生成新的自荐招呼。"
        type="warning"
        :closable="false"
      />
      <p v-else class="quality-line">已检查：经历依据 · 岗位相关性 · 简洁程度 · 无重要事项承诺</p>
      <ProjectEvidenceCards :projects="result.projects" />
      <h4 v-if="result.reviewReasons.length" class="output-heading">审校结论</h4>
      <ul v-if="result.reviewReasons.length">
        <li v-for="reason in result.reviewReasons" :key="reason">{{ reason }}</li>
      </ul>
      <section v-if="result.gaps.length" class="greeting-gaps">
        <h4>需要进一步核实</h4>
        <ul>
          <li v-for="gap in result.gaps" :key="gap">{{ gap }}</li>
        </ul>
      </section>
    </template>
    <div class="draft-heading">
      <h4>招呼草稿 · 可编辑</h4>
      <small>{{ modelValue.length }} 字</small>
    </div>
    <ElInput
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)"
      type="textarea"
      :autosize="{ minRows: 5 }"
      class="draft"
      aria-label="匹配招呼草稿"
      placeholder="生成后可在这里核对和调整语气"
    />
    <AiDraftReview
      v-if="modelValue"
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)"
      v-model:confirmation="confirmation"
      :basis="basis()"
      :request-open="reviewPending"
      @opened="reviewPending = false"
      :available="saved && !outdated && !generating"
      disabled-reason="岗位或资料已变化，请保存资料并重新生成。"
      :context="job.companyName + ' · ' + job.jobName"
      title="确认匹配招呼"
      :verify="verifyGreeting"
    >
      <article v-for="match in result?.matches || []" :key="match.evidenceId + match.requirement">
        <b>{{ match.requirement }}</b>
        <p>{{ match.evidenceQuote }}</p>
        <p>{{ match.relevance }}</p>
      </article>
      <p v-if="edited">你已调整原稿，请重新核对事实。</p>
    </AiDraftReview>
    <p class="muted">
      此处只生成预览，不会联系招聘方。自动任务还会核对已确认经历、账号、消息状态与发送限额。
    </p>
  </section>
</template>
<script setup lang="ts">
import ProjectEvidenceCards from './ProjectEvidenceCards.vue'
import { useAITasks } from '../../composables/atlasTasks'
const runAITask = useAITasks()
import { computed, ref } from 'vue'
import { ElAlert, ElButton, ElInput, ElSelect, ElOption } from 'element-plus'
import AiDraftReview from './AiDraftReview.vue'
import type { CareerJob, CareerEvidence } from '../../../../common/career'
import type { GreetingResult } from '../../../../common/greeting'
const props = defineProps<{
  job: CareerJob
  evidence: CareerEvidence[]
  profileVersion: string
  saved: boolean
  modelValue: string
  inheritedOutdated?: boolean
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
const confirmation = ref(''),
  reviewPending = ref(false)
const generating = ref(false),
  preferred = ref(''),
  error = ref(''),
  result = ref<GreetingResult | null>(null),
  resultBasis = ref('')
const basis = () => JSON.stringify([props.job, props.profileVersion, preferred.value])
const outdated = computed(() =>
  result.value ? resultBasis.value !== basis() || !props.saved : !!props.inheritedOutdated
)
const edited = computed(() => !!result.value?.text && props.modelValue !== result.value.text)
async function verifyGreeting() {
  const snapshot = await electron.ipcRenderer.invoke('career-workspace-snapshot')
  if (snapshot.profileVersion !== props.profileVersion)
    throw Error('个人资料已有新版本，请重新读取资料并生成招呼。')
}
async function generate(refresh: boolean) {
  if (generating.value || !props.saved) return
  generating.value = true
  error.value = ''
  const initial = basis()
  try {
    const next: GreetingResult = await runAITask('career-greeting-generate', {
      job: JSON.parse(JSON.stringify(props.job)),
      preferredEvidenceId: preferred.value,
      baseProfileVersion: props.profileVersion,
      refresh
    })
    if (initial !== basis() || !props.saved)
      throw Error('生成期间岗位或资料已变化，原草稿已保留。请重新生成。')
    result.value = next
    resultBasis.value = initial
    if (next.text) {
      emit('update:modelValue', next.text)
      confirmation.value = ''
      reviewPending.value = true
    }
  } catch (e) {
    error.value = String(e)
  } finally {
    generating.value = false
  }
}
</script>
<style scoped>
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 14px 0;
}
.full-width {
  width: 100%;
}
.draft {
  margin: 14px 0;
}
.muted,
.generation-meta,
small {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.7;
}
.matched-fact {
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  padding: 14px;
  margin: 12px 0;
}
.matched-fact p,
li,
blockquote {
  font-size: 13px;
  line-height: 1.7;
}
.matched-fact b {
  font-size: 13px;
}
blockquote {
  margin: 8px 0;
  padding-left: 12px;
  border-left: 2px solid var(--el-color-primary-light-7);
  color: var(--el-text-color-secondary);
}
.quality-line {
  font-size: 12px;
  color: var(--el-color-success);
}
ul {
  padding-left: 18px;
}
details {
  font-size: 12px;
}
h3 {
  font-size: 16px;
  margin: 0 0 12px;
}
h4 {
  font-size: 14px;
  margin: 0 0 12px;
}
.output-heading {
  margin: 22px 0 12px;
}
.matched-fact h4 {
  display: flex;
  gap: 12px;
}
.matched-fact h4 span {
  color: var(--el-color-primary);
}
dl,
dd {
  margin: 0;
}
dl > div {
  display: grid;
  grid-template-columns: 75px minmax(0, 1fr);
  gap: 10px;
  margin-top: 10px;
  font-size: 14px;
  line-height: 1.8;
}
dt {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
blockquote {
  margin-top: 0;
}
.greeting-gaps {
  padding: 16px;
  border: 1px solid var(--el-color-warning-light-5);
  border-radius: 8px;
  margin-top: 18px;
  background: var(--el-color-warning-light-9);
}
.draft-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 24px 0 0;
}
.draft-heading h4 {
  margin: 0;
}
</style>
