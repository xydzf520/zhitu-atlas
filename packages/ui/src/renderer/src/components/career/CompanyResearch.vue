<template>
  <div class="company-research-entry">
    <button class="research-open" :disabled="!accountId || !bossId" @click="openReport">
      <span>企业研判</span><small>业务 · 地点 · 与我的关联 →</small>
    </button>
    <ElDialog
      v-model="visible"
      title="企业研判"
      width="min(1040px, calc(100vw - 32px))"
      append-to-body
      :close-on-click-modal="false"
      class="company-research-dialog"
    >
      <div class="research-body">
        <header class="research-header">
          <div>
            <h2>{{ data?.company || '当前企业' }}</h2>
            <p>公开资料 + 招聘者回复 + 你的已确认经历</p>
          </div>
          <span class="identity" :class="report?.identity?.status">{{ identityLabel }}</span>
        </header>
        <div class="research-actions">
          <button class="primary" :disabled="busy || !data?.ready" @click="generate(false)">
            {{
              busy
                ? '搜索与研判中…'
                : data?.latest
                  ? data.stale
                    ? '根据新信息更新'
                    : '查看当前研判'
                  : '搜索并生成研判'
            }}
          </button>
          <button v-if="data?.latest" :disabled="busy" @click="generate(true)">
            重新搜索并更新
          </button>
          <label v-if="data?.latest"
            ><input
              type="checkbox"
              :checked="data.autoUpdate"
              :disabled="busy"
              @change="toggleMonitor"
            />
            新回复自动修正</label
          >
        </div>
        <p class="scope">
          直接读取公开搜索网页，无需搜索 API
          密钥。搜索网站只收到企业名与业务主题。手动更新调用当前模型；公开搜索缓存 24 小时。
        </p>
        <p v-if="error" role="alert" class="research-warning">{{ error }}</p>
        <p v-if="!data?.ready && data?.reason" class="research-warning">{{ data.reason }}</p>
        <p v-if="busy" role="status" class="research-progress">
          {{ progress || '后台正在搜索资料并研判，切换页面后任务仍会保留。' }}
          <RouterLink to="/main-layout/CareerTasks">查看任务 →</RouterLink>
        </p>
        <p v-if="data?.stale" class="research-warning">
          当前研判依据已变化，旧结论保留供对照。新回复会按自动更新设置合并处理。
        </p>
        <p v-if="data?.latest && data.autoUpdate" class="scope">
          自动修正：{{
            data.autoBudget?.paused
              ? '全部自动任务已暂停'
              : `今日已用 ${data.autoBudget?.used || 0}/6 次`
          }}
          <template v-if="data.monitor?.task">
            · {{ data.monitor.task.error || data.monitor.task.step }}
            <RouterLink to="/main-layout/CareerTasks">查看任务 →</RouterLink></template
          >
        </p>
        <template v-if="report">
          <section class="research-summary">
            <b>{{ report.summary }}</b>
            <p>{{ report.identity.reason }}</p>
            <small
              >{{ time(data.latest.at) }} ·
              {{ data.latest.automatic ? '根据新回复自动更新' : '手动研判' }} ·
              企业研判不等于背景调查或录用判断</small
            >
          </section>
          <div class="research-grid">
            <section
              v-for="topic in ['业务', '产品', '客户', '地点']"
              :key="topic"
              class="research-card"
            >
              <h3>
                {{
                  { 业务: '企业做什么', 产品: '产品与服务', 客户: '服务谁', 地点: '企业在哪' }[
                    topic
                  ]
                }}
              </h3>
              <article
                v-for="(f, i) in report.facts.filter((r: any) => r.topic === topic)"
                :key="i"
              >
                <p>{{ f.text }}</p>
                <div class="source-chips">
                  <button v-for="id in f.sourceIds" :key="id" @click="showSource(id)">
                    {{ sourceLabel(id) }}
                  </button>
                </div>
              </article>
              <p v-if="!report.facts.some((r: any) => r.topic === topic)" class="scope">
                暂无足够来源，待核实
              </p>
            </section>
          </div>
          <section class="research-section">
            <h3>哪些业务与你有关</h3>
            <article v-for="(r, i) in report.connections" :key="i" class="connection-card">
              <span class="step">{{ i + 1 }}</span>
              <div>
                <p>{{ r.text }}</p>
                <small v-for="id in r.evidenceIds" :key="id"
                  >经历依据：{{ evidenceTitle(id) }}</small
                >
                <div class="source-chips">
                  <button v-for="id in r.sourceIds" :key="id" @click="showSource(id)">
                    {{ sourceLabel(id) }}
                  </button>
                </div>
              </div>
            </article>
            <p v-if="!report.connections.length" class="scope">
              尚无足够依据把企业业务与你的经历直接关联。
            </p>
          </section>
          <section class="research-section">
            <h3>AI 推断 · 与来源陈述分开</h3>
            <article v-for="(r, i) in report.inferences" :key="i" class="inference">
              <b>{{ r.confidence }}</b>
              <div>
                <p>{{ r.text }}</p>
                <small>如何核实：{{ r.verify }}</small>
                <div class="source-chips">
                  <button v-for="id in r.sourceIds" :key="id" @click="showSource(id)">
                    {{ sourceLabel(id) }}
                  </button>
                </div>
              </div>
            </article>
            <p v-if="!report.inferences.length" class="scope">没有足够依据形成进一步推断。</p>
          </section>
          <section v-if="report.changes.length" class="research-section">
            <h3>本次如何修正</h3>
            <article v-for="(r, i) in report.changes" :key="i" class="change">
              <small>此前：{{ r.before }}</small>
              <p>现在：{{ r.after }}</p>
              <small>原因：{{ r.reason }}</small>
              <div class="source-chips">
                <button v-for="id in r.sourceIds" :key="id" @click="showSource(id)">
                  {{ sourceLabel(id) }}
                </button>
              </div>
            </article>
          </section>
          <section class="research-next">
            <h3>下一步建议</h3>
            <p>{{ report.nextStep }}</p>
            <ul>
              <li v-for="q in report.questions" :key="q">{{ q }}</li>
            </ul>
            <small>简历发送、面试和薪资事项仍由你确认。</small>
          </section>
          <details class="research-section">
            <summary>搜索过程与局限</summary>
            <p v-for="(s, i) in data.latest.searches" :key="i">
              {{ s.query }} · {{ s.results }} 条来源 · {{ s.cached ? '缓存' : '本次搜索' }}
            </p>
            <p>模型工具：{{ data.latest.toolNames?.join('、') || '未追加工具调用' }}</p>
            <p v-for="n in data.latest.notices" :key="n" class="research-warning">{{ n }}</p>
            <p class="scope">
              正文可能需要登录或脚本加载；读取不到时保留摘要并标明局限，不绕过验证。办公地、注册地址及职位地点分别以来源为准。
            </p>
          </details>
          <section class="research-section">
            <h3>来源与依据</h3>
            <details
              v-for="s in citedSources"
              :id="'research-source-' + s.id"
              :key="s.id"
              :open="expandedSource === s.id"
              class="source-detail"
            >
              <summary>{{ sourceLabel(s.id) }} · {{ s.title }}</summary>
              <p class="scope">
                {{ time(s.readAt || s.at) }}
                {{ s.kind === 'search' ? '· 仅搜索摘要，未核实正文' : '' }}
              </p>
              <a v-if="s.url" :href="s.url" target="_blank" rel="noopener noreferrer"
                >打开原始网页 ↗</a
              >
              <p v-if="s.error" class="research-warning">{{ s.error }}</p>
              <p>{{ s.text }}</p>
            </details>
          </section>
          <details v-if="data.history.length" class="research-section">
            <summary>研判历史 · {{ data.history.length }} 个旧版本</summary>
            <p v-for="h in data.history" :key="h.id">{{ time(h.at) }} · {{ h.summary }}</p>
          </details>
          <p class="scope">
            {{ data.limits }}
            关闭本窗口不停止后台任务；自动更新可单独关闭，也受“暂停全部自动任务”控制。
          </p>
        </template>
        <div v-else-if="!busy" class="research-empty">
          <h3>先看企业，再决定怎么沟通</h3>
          <p>
            结合公开业务资料和这段会话，辨别企业身份、业务需求与你的经历关联。新回复到来后保留前后判断和修正原因。
          </p>
        </div>
      </div>
    </ElDialog>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { ElDialog } from 'element-plus'
import { useAITasks } from '../../composables/atlasTasks'
const props = defineProps<{
  accountId: string
  bossId: string
  conversation?: any
  active?: boolean
}>()
const visible = ref(false),
  data = ref<any>(),
  error = ref(''),
  busy = ref(false),
  progress = ref(''),
  expandedSource = ref('')
const run = useAITasks(),
  report = computed(() => data.value?.latest?.report)
const identityLabel = computed(
  () =>
    ({ matched: '企业身份有对应依据', ambiguous: '存在同名或主体歧义', unknown: '企业身份待核实' })[
      report.value?.identity?.status as string
    ] || '尚未研判'
)
const citedSources = computed(() => {
  const r = report.value
  if (!r) return []
  const ids = new Set([
    ...(r.identity.sourceIds || []),
    ...[...r.facts, ...r.inferences, ...r.connections, ...r.changes].flatMap(
      (v: any) => v.sourceIds
    )
  ])
  return (data.value.latest.sources || []).filter((s: any) => ids.has(s.id))
})
const args = () => ({ accountId: props.accountId, bossId: props.bossId })
let seq = 0,
  timer: ReturnType<typeof setInterval> | undefined
async function load() {
  const n = ++seq
  try {
    const result = await electron.ipcRenderer.invoke('career-company-research-load', args())
    if (n === seq) {
      data.value = result
    }
  } catch (e) {
    if (n === seq) error.value = String(e)
  }
}
async function openReport() {
  error.value = ''
  visible.value = true
  await load()
}
async function generate(refreshSearch: boolean) {
  if (!refreshSearch && data.value?.latest && !data.value.stale) return
  const selected = JSON.stringify(args())
  busy.value = true
  error.value = ''
  progress.value = '等待后台执行…'
  try {
    await run(
      'career-company-research',
      { ...args(), baseBasis: data.value.basis, refreshSearch },
      (t) => {
        if (JSON.stringify(args()) === selected) progress.value = t.step
      }
    )
    if (JSON.stringify(args()) === selected) await load()
  } catch (e) {
    if (JSON.stringify(args()) === selected) error.value = String(e)
  } finally {
    if (JSON.stringify(args()) === selected) busy.value = false
  }
}
async function toggleMonitor(e: Event) {
  try {
    data.value = await electron.ipcRenderer.invoke('career-company-research-monitor', {
      ...args(),
      enabled: (e.target as HTMLInputElement).checked,
      baseRevision: data.value.revision
    })
  } catch (e) {
    error.value = String(e)
    await load()
  }
}
function sourceLabel(id: string) {
  const s = data.value?.latest?.sources?.find((s: any) => s.id === id)
  return `${id} · ${
    (
      {
        jd: '岗位描述',
        recruiter: '招聘者陈述',
        self: '本人消息',
        platform: '平台卡片',
        search: '搜索摘要',
        web: '公开网页'
      } as any
    )[s?.kind] || '来源'
  }`
}
function evidenceTitle(id: string) {
  return data.value?.latest?.evidence?.find((e: any) => e.id === id)?.title || id
}
function time(v: string) {
  return v ? new Date(v).toLocaleString('zh-CN') : '时间未知'
}
async function showSource(id: string) {
  expandedSource.value = id
  await nextTick()
  document
    .getElementById('research-source-' + id)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
watch(
  () => [props.accountId, props.bossId],
  () => {
    seq++
    visible.value = false
    data.value = null
    busy.value = false
    error.value = ''
  }
)
watch(
  () => props.active,
  (v) => {
    if (v === false) visible.value = false
  }
)
watch(visible, (v) => {
  if (timer) clearInterval(timer)
  if (v)
    timer = setInterval(() => {
      if (!document.hidden && !busy.value) void load()
    }, 10000)
})
onBeforeUnmount(() => {
  seq++
  if (timer) clearInterval(timer)
})
</script>
<style scoped>
.research-open {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: #edf3ff;
  border: 1px solid #cbdcff;
  border-radius: 10px;
  padding: 10px 14px;
  color: #2458bb;
  cursor: pointer;
  text-align: left;
}
.research-open span {
  font-weight: 700;
}
.research-open small {
  font-size: 12px;
}
.research-body {
  color: #27384c;
  line-height: 1.7;
}
.research-header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: center;
}
.research-header h2 {
  margin: 0;
  font-size: 24px;
}
.research-header p,
.research-card p {
  margin: 6px 0;
}
.identity {
  background: #fff2db;
  border-radius: 20px;
  padding: 5px 12px;
  font-size: 12px;
}
.identity.matched {
  background: #e4f5ee;
  color: #176e51;
}
.research-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin: 16px 0;
}
.research-actions button {
  border: 1px solid #cbd8e9;
  background: white;
  border-radius: 8px;
  padding: 9px 14px;
  cursor: pointer;
}
.research-actions button.primary {
  background: #2c60c9;
  color: white;
  border-color: #2c60c9;
}
.research-actions button:disabled {
  opacity: 0.5;
  cursor: default;
}
.research-actions label {
  font-size: 13px;
}
.scope,
.research-body small {
  color: #65758a;
  font-size: 12px;
}
.research-warning {
  padding: 10px 14px;
  background: #fff6e7;
  color: #8a5718;
  border-radius: 8px;
}
.research-progress {
  background: #edf3ff;
  padding: 12px;
  border-radius: 8px;
}
.research-summary {
  border-left: 4px solid #3569d0;
  padding: 14px 20px;
  background: #f4f7fc;
  border-radius: 8px;
  margin: 18px 0;
}
.research-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.research-card {
  border: 1px solid #dfe7f2;
  border-radius: 12px;
  padding: 16px;
  min-width: 0;
}
.research-body h3 {
  font-size: 16px;
  margin: 0 0 12px;
}
.research-section {
  margin-top: 24px;
}
.source-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.source-chips button {
  border: 0;
  background: #edf3fb;
  color: #385d8b;
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 11px;
  cursor: pointer;
}
.connection-card,
.inference {
  display: flex;
  gap: 14px;
  border-bottom: 1px solid #e5ebf3;
  padding: 14px 0;
}
.connection-card p,
.inference p {
  margin: 0 0 6px;
}
.connection-card small {
  display: block;
}
.step {
  flex: 0 0 28px;
  height: 28px;
  border-radius: 50%;
  background: #e5f3ee;
  color: #147856;
  text-align: center;
}
.inference > b {
  white-space: nowrap;
  color: #886224;
  font-size: 12px;
}
.change {
  border-left: 2px solid #cbdcff;
  padding: 10px 16px;
  margin: 8px 0;
}
.change p {
  margin: 4px 0;
}
.research-next {
  background: #eff7f4;
  padding: 18px;
  border-radius: 12px;
  margin-top: 22px;
}
.research-next ul {
  padding-left: 20px;
}
.source-detail {
  border-bottom: 1px solid #e5ebf3;
  padding: 12px 0;
  overflow-wrap: anywhere;
}
.source-detail p {
  white-space: pre-wrap;
}
.research-body summary {
  cursor: pointer;
  color: #305786;
}
.research-empty {
  text-align: center;
  padding: 35px 15px;
  background: #f7f9fc;
  border-radius: 12px;
}
.research-empty p {
  max-width: 560px;
  margin: auto;
  color: #65758a;
}
@media (max-width: 700px) {
  .research-grid {
    grid-template-columns: 1fr;
  }
  .research-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
<style>
.company-research-dialog .el-dialog__body {
  max-height: 75vh;
  overflow-y: auto;
  padding-top: 8px;
}
</style>
