<template>
  <section class="opportunity-intelligence">
    <section v-show="section === 'job'" aria-label="岗位详情">
      <h3>岗位基本信息</h3>
      <dl class="job-facts">
        <div>
          <dt>薪资待遇</dt>
          <dd>
            {{
              job.salaryDesc ||
              (job.salaryLow && job.salaryHigh ? `${job.salaryLow}–${job.salaryHigh}K` : '待核实')
            }}{{ job.salaryMonth && !job.salaryDesc ? ` · ${job.salaryMonth}薪` : '' }}
          </dd>
        </div>
        <div>
          <dt>经验要求</dt>
          <dd>{{ job.experienceName || '待核实' }}</dd>
        </div>
        <div>
          <dt>学历要求</dt>
          <dd>{{ job.degreeName || '待核实' }}</dd>
        </div>
        <div>
          <dt>融资阶段</dt>
          <dd>{{ job.stageName || '待核实' }}</dd>
        </div>
        <div class="address">
          <dt>工作地址</dt>
          <dd>{{ job.address || '待补充' }}</dd>
        </div>
      </dl>
      <p class="muted" v-if="job.activeStatus">
        招聘者状态：{{ job.activeStatus }} · 观测于
        {{ time(job.observedAt) }}。活跃状态不代表录用意愿。
      </p>
      <p class="muted" v-if="job.detailAt">
        详情采集：{{ time(job.detailAt) }} · 采集时间不代表岗位发布时间
      </p>
      <div v-if="job.workAddresses?.length > 1" class="location-candidates">
        <b>多个工作地点，需核实适用地址</b>
        <ul>
          <li v-for="address in job.workAddresses" :key="address">{{ address }}</li>
        </ul>
      </div>
      <div class="section-heading">
        <h3>招聘正文</h3>
        <span class="muted">保留招聘方原意，未推断缺失条件</span>
      </div>
      <StructuredText
        :source="job.description"
        empty="当前尚无 JD。请在 BOSS 打开此岗位详情，再更新本地记录。"
      />
      <details v-if="assessment" class="rule-assessment">
        <summary>规则匹配依据与待核实项</summary>
        <p class="muted">规则分反映关键词与经历关联，不代表录用概率。</p>
        <h4>经历关联依据</h4>
        <ul>
          <li v-for="r in assessment.reasons" :key="r">{{ r }}</li>
        </ul>
        <h4>待核实</h4>
        <ul>
          <li v-for="q in assessment.questions" :key="q">{{ q }}</li>
        </ul>
      </details>
    </section>
    <section v-show="section === 'analysis'" aria-label="DeepSeek 岗位深度分析">
      <h3>DeepSeek 岗位深度分析</h3>
      <p class="muted">逐项说明招聘要求、经历依据、缺口与行动建议。</p>
      <button :disabled="analyzing || !job.description" @click="analyze">
        {{
          analyzing ? '正在分析…' : analysis ? '重新分析匹配与面试准备' : '分析匹配、缺口与面试准备'
        }}
      </button>
      <p v-if="analysisError" class="error" role="alert">{{ analysisError }}</p>
      <p v-if="!analysis" class="empty" role="status">
        {{
          analyzing
            ? '正在读取招聘要求并匹配已确认经历，请稍候。'
            : job.description
              ? '点击上方按钮生成分析报告；结果按六个部分展示。'
              : '岗位正文待补充，暂时无法生成分析。'
        }}
      </p>
      <AnalysisReport
        v-if="analysis"
        :result="analysis"
        :evidence="evidence"
        :outdated="analysisOutdated"
      />
    </section>
    <section v-show="section === 'greeting'" aria-label="匹配招呼">
      <p v-if="stale" class="muted">保存的草稿对应旧资料或旧 JD，请重新生成后使用。</p>
      <p v-if="draftError" class="error" role="alert">{{ draftError }}</p>
      <GreetingComposer
        :job="job"
        :evidence="evidence"
        :profile-version="profileVersion"
        :saved="!!profileVersion && !!job.description"
        :inherited-outdated="stale"
        v-model="draft"
      />
      <button :disabled="!draftReady || !hasDraft || saving" @click="save">
        {{ saving ? '保存中…' : '保存此岗位草稿' }}</button
      ><span class="muted"> {{ hasDraft ? '有未保存的草稿修改' : '草稿已与本机记录一致' }}</span>
    </section>
    <section v-show="section === 'history'" aria-label="历史快照">
      <div class="section-heading">
        <h3>岗位变更与最近快照</h3>
        <button
          v-if="accountId && job.encryptJobId"
          :disabled="historyLoading"
          @click="loadHistory"
        >
          {{ historyLoading ? '读取中…' : '重新读取快照' }}
        </button>
      </div>
      <p class="muted">最多保留最近 20 次变更，每次阅读一份；采集时间不代表发布时间。</p>
      <p v-if="historyError" class="error" role="alert">
        {{ historyError }} · 可重新读取，已显示内容会保留。
      </p>
      <p v-if="!accountId || !job.encryptJobId" class="empty">
        此机会尚未关联可读取的 BOSS 岗位快照。
      </p>
      <p v-else-if="historyLoading && !history" class="empty" role="status">正在读取岗位快照…</p>
      <p v-else-if="history && !history.length" class="empty">尚无已采集详情快照。</p>
      <template v-if="history?.length">
        <label class="snapshot-selector"
          >选择采集记录<select v-model="selectedHistory" aria-label="选择岗位快照">
            <option v-for="(r, i) in history" :key="i" :value="i">
              {{ i === 0 ? '最近一次 · ' : '' }}{{ time(r.observedAt) }} · {{ r.job.jobName }}
            </option>
          </select></label
        >
        <article v-if="selectedSnapshot" class="snapshot" :key="selectedHistory">
          <h4>{{ selectedSnapshot.job.jobName }}</h4>
          <dl class="job-facts">
            <div>
              <dt>当时薪资</dt>
              <dd>{{ selectedSnapshot.job.salaryDesc || '未知' }}</dd>
            </div>
            <div class="address">
              <dt>当时地址</dt>
              <dd>{{ selectedSnapshot.job.address || '未知' }}</dd>
            </div>
          </dl>
          <p class="snapshot-change">
            {{
              selectedHistory + 1 < history.length
                ? changedFields.length
                  ? '相较前次采集，变更字段：' + changedFields.join('、')
                  : '与前次采集相比，主要岗位字段未变化。'
                : '这是当前可见的最早快照，没有更早记录可比较。'
            }}
          </p>
          <StructuredText :source="selectedSnapshot.job.description" empty="此快照没有 JD 正文。" />
        </article>
      </template>
    </section>
  </section>
</template>
<script setup lang="ts">
import { useAITasks } from '../../composables/atlasTasks'
const runAITask = useAITasks()
import { ref, computed, onMounted, watch } from 'vue'
import type { CareerEvidence } from '../../../../common/career'
import StructuredText from './StructuredText.vue'
import AnalysisReport from './AnalysisReport.vue'
import { snapshotChanges } from '../../../../common/structured-output'
import GreetingComposer from './GreetingComposer.vue'
const props = defineProps<{
  id: string
  section: string
  assessment?: { reasons: string[]; questions: string[] } | null
  job: any
  accountId?: string
  profileVersion: string
  evidence: CareerEvidence[]
}>()
const history = ref<any[]>(),
  historyError = ref(''),
  historyLoading = ref(false),
  selectedHistory = ref(0),
  analysisBasis = ref(''),
  sharedAnalysis = ref(false),
  savedAnalysisOutdated = ref(false),
  analysis = ref<any>(),
  analysisError = ref(''),
  analyzing = ref(false),
  draft = ref(''),
  baseline = ref(''),
  draftRevision = ref(''),
  draftReady = ref(false),
  draftError = ref(''),
  saving = ref(false),
  stale = ref(false)
const hasDraft = computed(() => draft.value !== baseline.value)
const time = (v: string) => (v ? new Date(v).toLocaleString('zh-CN') : '时间未知')
const basis = () =>
  JSON.stringify([
    props.profileVersion,
    props.job.jobName,
    props.job.companyName,
    props.job.description,
    props.job.salaryDesc,
    props.job.address
  ])
const selectedSnapshot = computed(() => history.value?.[selectedHistory.value])
const changedFields = computed(() =>
  selectedSnapshot.value
    ? snapshotChanges(selectedSnapshot.value.job, history.value?.[selectedHistory.value + 1]?.job)
    : []
)
const analysisOutdated = computed(
  () => !!analysis.value && (savedAnalysisOutdated.value || analysisBasis.value !== basis())
)
watch(
  () => props.section,
  (value) => {
    if (value === 'history' && !history.value) loadHistory()
  }
)
async function loadHistory() {
  if (historyLoading.value || !props.accountId || !props.job.encryptJobId) return
  historyLoading.value = true
  historyError.value = ''
  try {
    history.value = await electron.ipcRenderer.invoke('career-boss-job-history', {
      accountId: props.accountId,
      jobId: props.job.encryptJobId
    })
  } catch (e) {
    historyError.value = String(e)
  } finally {
    historyLoading.value = false
  }
}
async function analyze() {
  analyzing.value = true
  analysisError.value = ''
  const initial = basis()
  try {
    const result = await runAITask(
      sharedAnalysis.value ? 'career-discovery-analyze' : 'career-ai-analyze',
      {
        job: JSON.parse(JSON.stringify(props.job)),
        accountId: props.accountId,
        jobId: props.job.encryptJobId,
        baseProfileVersion: props.profileVersion,
        profileVersion: props.profileVersion,
        refresh: !!analysis.value
      }
    )
    if (initial !== basis()) throw Error('资料或岗位已变化，请重新分析')
    analysis.value = result
    savedAnalysisOutdated.value = false
    analysisBasis.value = initial
  } catch (e) {
    analysisError.value = String(e)
  } finally {
    analyzing.value = false
  }
}
async function save() {
  if (!hasDraft.value) return true
  saving.value = true
  draftError.value = ''
  try {
    const result = await electron.ipcRenderer.invoke('career-opportunity-draft-save', {
      id: props.id,
      text: draft.value,
      basis: basis(),
      baseRevision: draftRevision.value
    })
    baseline.value = draft.value
    draftRevision.value = result.revision
    stale.value = false
    return true
  } catch (e) {
    draftError.value = String(e)
    return false
  } finally {
    saving.value = false
  }
}
onMounted(async () => {
  if (props.accountId && props.job.encryptJobId) {
    try {
      const row = await electron.ipcRenderer.invoke('career-discovery-detail', {
        accountId: props.accountId,
        jobId: props.job.encryptJobId
      })
      sharedAnalysis.value = true
      if (row?.item?.analysis) {
        analysis.value = row.item.analysis
        analysisBasis.value = basis()
        savedAnalysisOutdated.value = row.analysisOutdated
        analysisError.value = row.item.analysisError || ''
      }
    } catch {
      /* Legacy imported jobs can still be analyzed with their saved JD. */
    }
  }
  try {
    const result = await electron.ipcRenderer.invoke('career-opportunity-draft-load', {
      id: props.id
    })
    draft.value = baseline.value = result.value?.text || ''
    draftRevision.value = result.revision
    stale.value = !!result.value && result.value.basis !== basis()
    draftReady.value = true
  } catch (e) {
    draftError.value = String(e)
  }
})
defineExpose({ hasDraft, save })
</script>
<style scoped>
.opportunity-intelligence {
  min-width: 0;
}
h3 {
  font-size: 16px;
  margin: 0 0 14px;
}
h4 {
  font-size: 14px;
  margin: 16px 0 10px;
}
.job-facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin: 0 0 14px;
  background: var(--el-fill-color-extra-light);
  border: 1px solid var(--el-border-color-lighter);
  padding: 16px;
  border-radius: 10px;
}
.job-facts dt {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-bottom: 5px;
}
.job-facts dd {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.job-facts .address {
  grid-column: 1 / -1;
}
.muted {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.8;
}
.section-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin: 24px 0 14px;
}
.section-heading h3 {
  margin: 0;
}
button {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 7px;
  padding: 10px 14px;
  margin: 12px 0;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.empty {
  padding: 30px 18px;
  background: var(--el-fill-color-extra-light);
  color: var(--el-text-color-secondary);
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.8;
}
.error {
  color: var(--el-color-danger);
  font-size: 13px;
}
.snapshot-selector {
  display: grid;
  gap: 8px;
  font-size: 13px;
  margin: 20px 0;
}
.snapshot-selector select {
  font: inherit;
  padding: 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 7px;
  width: 100%;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
}
.snapshot-change {
  padding: 12px 14px;
  margin: 16px 0 !important;
  font-size: 13px;
  background: var(--el-color-primary-light-9);
  border-radius: 7px;
  color: var(--el-color-primary);
}
.rule-assessment {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--el-border-color);
  font-size: 14px;
  line-height: 1.8;
}
summary {
  cursor: pointer;
  color: var(--el-color-primary);
}
.location-candidates {
  font-size: 13px;
  line-height: 1.8;
  margin-top: 12px;
}
@media (max-width: 700px) {
  .job-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
