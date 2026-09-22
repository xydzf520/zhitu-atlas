<template>
  <section class="execution-workbench" aria-label="Agent 运行台">
    <header class="run-header">
      <div>
        <h2>Agent 运行台</h2>
        <p>
          {{ feed?.runningModels || 0 }} 次模型调用进行中<span v-if="feed?.automationPaused">
            · 自动任务已暂停</span
          ><span v-if="feed?.sendingPaused"> · 发送已暂停</span>
        </p>
      </div>
      <div class="filters">
        <label
          >查看<select v-model="filter" @change="page = 1">
            <option value="active">正在进行 / 待处理</option>
            <option value="all">全部运行</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
            <option value="uncertain">结果不确定</option>
          </select></label
        ><button @click="refresh">更新</button
        ><button v-if="feed && !feed.sendingPaused" @click="pauseSending">暂停发送</button
        ><RouterLink to="/main-layout/CareerAgents">Agent 配置</RouterLink>
      </div>
    </header>
    <p v-if="feedError || error" class="error" role="alert">{{ error || feedError }}</p>
    <p v-if="route.query.object || route.query.agent" class="scope">
      已按{{ route.query.object ? '岗位或会话' : 'Agent' }}筛选
      <button @click="clearFilters">清除筛选</button>
    </p>
    <div class="run-layout">
      <aside class="run-list" aria-label="工作列表">
        <p v-if="!feed">正在读取…</p>
        <p v-else-if="!feed.items.length" class="empty">
          此范围没有运行记录。新任务从机会发现或沟通中心发起；旧记录仍在执行队列和 Agent
          调用记录中。
        </p>
        <button
          v-for="r in feed?.items"
          :key="r.id"
          :aria-pressed="selected === r.id"
          class="run-item"
          @click="choose(r.id)"
        >
          <strong>{{ r.title }}</strong
          ><span :class="['state', r.state]">{{ label(r.state) }}</span
          ><small>{{ r.currentStep?.label || r.summary || '等待执行' }}</small
          ><small>{{ time(r.updated_at) }}</small>
        </button>
        <nav v-if="feed?.total > 20">
          <button :disabled="page <= 1" @click="page--">上一页</button><span>{{ page }}</span
          ><button :disabled="page * 20 >= feed.total" @click="page++">下一页</button>
        </nav>
      </aside>
      <div v-if="detail" class="run-detail">
        <header>
          <div>
            <small>{{ sourceLabel(detail.run.source) }}</small>
            <h3>{{ detail.run.title }}</h3>
            <p>
              <span :class="['state', detail.run.state]">{{ label(detail.run.state) }}</span>
              {{ detail.run.summary }}
            </p>
          </div>
          <RouterLink v-if="detail.run.destination" :to="detail.run.destination"
            >进入{{ detail.run.object_kind === 'conversation' ? '会话' : '相关页面' }} →</RouterLink
          >
        </header>
        <p v-if="detail.parent" class="parent">
          <button @click="choose(detail.parent.id)">上级安排：{{ detail.parent.title }}</button> ·
          {{ label(detail.parent.state) }}
        </p>
        <div v-if="detail.children.length" class="child-runs">
          <span>{{ detail.children.length }} 项关联工作</span
          ><button v-for="child in detail.children" :key="child.id" @click="choose(child.id)">
            {{ child.title }} · {{ label(child.state) }}
          </button>
        </div>
        <div class="workflow">
          <nav class="step-list" aria-label="Agent 与程序步骤">
            <button
              v-for="s in visibleSteps"
              :key="s.id"
              :aria-pressed="stepId === s.id"
              :class="['step', s.state, { child: !!s.parent_id }]"
              @click="stepId = s.id"
            >
              <span class="mark" aria-hidden="true">{{
                ['completed', 'cached'].includes(s.state)
                  ? '✓'
                  : ['failed', 'uncertain', 'review', 'blocked'].includes(s.state)
                    ? '!'
                    : s.state === 'running'
                      ? '●'
                      : '·'
              }}</span
              ><span
                >{{ s.label }}<small>{{ actorLabel(s.actor) }} · {{ label(s.state) }}</small></span
              ></button
            ><small v-if="detail.totalSteps > detail.steps.length"
              >仅展示最近读取的 {{ detail.steps.length }} 个步骤，完整顺序可查看运行记录。</small
            >
          </nav>
          <section class="step-detail">
            <div class="step-heading">
              <h4>{{ selectedStep?.label || '运行结果' }}</h4>
              <span v-if="selectedStep" :class="['state', selectedStep.state]">{{
                label(selectedStep.state)
              }}</span>
            </div>
            <p v-if="selectedStep" class="muted">
              {{ selectedStep.summary
              }}<span v-if="selectedStep.started_at"> · {{ elapsed(selectedStep) }}</span>
            </p>
            <p v-if="heartbeatStale" class="warning">
              最近心跳已超过 90 秒，执行状态待核实；不会据此自动重试。
            </p>
            <nav class="detail-tabs" aria-label="结果视图">
              <button
                v-for="t in tabs"
                :key="t.id"
                :aria-pressed="panel === t.id"
                @click="panel = t.id"
              >
                {{ t.title }}
              </button>
            </nav>
            <template v-if="panel === 'result'">
              <p v-if="detail.incoming" class="incoming">
                <small>对方原话</small>{{ detail.incoming }}
              </p>
              <p v-if="draftText" class="draft">
                <small>{{
                  detail.sends.length
                    ? '保存的内容（实际发送见下方凭据）'
                    : detail.result?.text
                      ? '已保存结果 · 不代表已发送'
                      : '模型候选内容 · 尚未完成全部业务检查'
                }}</small
                >{{ draftText }}
              </p>
              <p v-if="detail.profileStale" class="warning">
                个人资料已更新，此结果为历史版本；不能直接用于自动发送。
              </p>
              <AnalysisReport
                v-if="detail.result?.analysis"
                :result="detail.result"
                :evidence="detail.evidence"
                :outdated="detail.profileStale"
              />
              <InsightReport
                v-else-if="['resume-review', 'market-review'].includes(detail.result?.kind)"
                :report="detail.result"
              />
              <p v-else-if="detail.result?.summary">{{ detail.result.summary }}</p>
              <template v-if="detail.result?.report"
                ><h4>企业研判</h4>
                <p>{{ detail.result.report.summary }}</p>
                <p class="muted">{{ detail.result.report.identity?.reason }}</p>
                <article v-for="(f, i) in detail.result.report.facts" :key="'fact' + i">
                  <strong>{{ f.topic }}</strong>
                  <p>{{ f.text }}</p>
                </article>
                <h4>与经历的联系</h4>
                <p v-for="(c, i) in detail.result.report.connections" :key="'connection' + i">
                  {{ c.text }}
                </p>
                <details>
                  <summary>推断与待核实项</summary>
                  <article v-for="(c, i) in detail.result.report.inferences" :key="i">
                    <p>{{ c.text }}</p>
                    <small>如何核实：{{ c.verify }}</small>
                  </article>
                </details>
                <p>{{ detail.result.report.nextStep }}</p></template
              >
              <template v-if="detail.result?.actions && !detail.result?.kind"
                ><h4>安排的工作</h4>
                <article v-for="a in detail.result.actions" :key="a.id">
                  <strong>{{ a.title }}</strong>
                  <p>{{ a.reason }}</p>
                </article></template
              >
              <template
                v-if="Array.isArray(detail.result?.before) && Array.isArray(detail.result?.after)"
                ><h4>搜索词调整</h4>
                <p>此前：{{ detail.result.before.join('、') || '无扩展词' }}</p>
                <p>调整后：{{ detail.result.after.join('、') || '无扩展词' }}</p>
                <p>{{ detail.result.reason }}</p>
                <RouterLink to="/main-layout/CareerDiscovery"
                  >查看策略历史 / 撤销 →</RouterLink
                ></template
              >
              <template v-if="detail.result?.questions"
                ><h4>面试准备</h4>
                <article v-for="(q, i) in detail.result.questions" :key="i">
                  <strong>{{ q.question || q }}</strong>
                  <p>{{ q.outline }}</p>
                </article></template
              >
              <p
                v-if="
                  !draftText &&
                  !detail.result?.analysis &&
                  !detail.result?.summary &&
                  !detail.result?.report &&
                  !detail.result?.after &&
                  !detail.result?.questions &&
                  !detail.sends.length
                "
                class="muted"
              >
                {{
                  detail.result?.reason || '当前步骤还没有可展示的最终结果。可查看依据或运行记录。'
                }}
              </p>
              <section v-if="checks.length" class="checks">
                <h4>已记录的检查</h4>
                <div v-for="c in checks" :key="c.id">
                  <span :class="['state', c.state]">{{ label(c.state) }}</span
                  ><span>{{ c.label }} · {{ c.summary }}</span>
                </div>
              </section>
              <section v-if="detail.sends.length" class="receipts">
                <h4>实际发送与核验</h4>
                <article v-for="s in detail.sends" :key="s.id">
                  <strong>{{
                    s.proof?.method === 'manual'
                      ? '本人核实'
                      : s.status === 'sent' && s.proof?.messageId
                        ? '平台回读核验'
                        : s.status === 'uncertain'
                          ? '结果不确定'
                          : '发送尚未核验'
                  }}</strong>
                  <p>{{ s.text }}</p>
                  <small
                    >{{ time(s.updated_at) }} ·
                    {{
                      s.proof?.messageId ? '消息 ID：' + s.proof.messageId : '暂无平台消息凭据'
                    }}</small
                  >
                </article>
                <RouterLink to="/main-layout/CareerTasks?tab=sending">处理发送结果 →</RouterLink>
              </section>
            </template>
            <template v-else-if="panel === 'evidence'"
              ><h4>经历依据</h4>
              <p v-if="!detail.evidence.length" class="muted">
                当前步骤没有可还原的经历引用，或尚未生成引用；不推断为已确认。
              </p>
              <article v-for="e in detail.evidence" :key="e.id" class="fact">
                <strong>{{ e.title }} · {{ e.confirmed ? '当时已确认' : '未确认' }}</strong>
                <p>{{ e.text }}</p>
                <small>{{ e.source }}</small>
              </article>
              <template v-if="detail.result?.sources?.length"
                ><h4>岗位与公开资料来源</h4>
                <article v-for="source in detail.result.sources" :key="source.id" class="fact">
                  <strong>{{ source.title || source.label || source.id }}</strong>
                  <p>{{ source.excerpt || source.summary }}</p>
                  <small>{{ source.url || source.kind }}</small>
                </article></template
              >
              <p class="muted" v-if="detail.profileVersion">
                资料版本：{{ detail.profileVersion }}
              </p>
              <template v-if="selectedStep?.basis.model"
                ><h4>此次模型调用</h4>
                <p>
                  {{ selectedStep.basis.model }} · 提示词 v{{
                    selectedStep.basis.version || '未知'
                  }}
                </p>
                <RouterLink
                  :to="{
                    path: '/main-layout/CareerAgents',
                    query: { agent: selectedStep.actor, call: modelCallId }
                  }"
                  >查看实际提示词与调用记录 →</RouterLink
                >
                <p v-if="selectedCall" class="muted">
                  {{ selectedCall.usage?.requestCount ?? '未报告' }} 次请求 ·
                  {{ selectedCall.usage?.total_tokens ?? '未报告' }} tokens
                </p></template
              ></template
            >
            <template v-else
              ><ol class="events">
                <li v-for="e in events" :key="e.sequence">
                  <time>{{ time(e.created_at) }}</time
                  ><span>{{ e.summary }}</span
                  ><small>{{ label(e.state) }}</small>
                </li>
              </ol>
              <p v-if="!events.length" class="muted">暂无可还原的步骤记录。</p>
              <button v-if="moreEvents" @click="loadEvents">继续读取</button></template
            >
          </section>
        </div>
        <footer class="run-controls">
          <button
            v-if="detail.capabilities.pause"
            @click="control('pause', { paused: !detail.run.paused })"
            :disabled="busy"
          >
            {{ detail.run.paused ? '恢复本条后续步骤' : '暂停本条流程' }}</button
          ><button v-if="detail.capabilities.cancel" @click="control('cancel')" :disabled="busy">
            取消本次执行</button
          ><button v-if="detail.capabilities.regenerate" @click="regenerateOpen = true">
            调整并重新生成</button
          ><RouterLink v-if="detail.run.destination" :to="detail.run.destination"
            >编辑草稿 / 处理事项 →</RouterLink
          ><small>在途调用可能已经计费；已发出的消息不能撤回。</small>
        </footer>
      </div>
      <p v-else class="empty">
        {{ loading ? '正在读取运行详情…' : '选择一条工作，查看实际步骤、结果和需要处理的事项。' }}
      </p>
    </div>
    <ElDialog
      v-model="regenerateOpen"
      title="重新生成本次结果"
      width="min(600px,94vw)"
      :close-on-click-modal="false"
      ><label v-if="detail?.capabilities.instruction"
        >本次表达要求<textarea
          v-model="instruction"
          maxlength="600"
          placeholder="例如：只回答对方当前问题，重点说明相关项目经历"
        />
      </label>
      <p>
        将创建新的手动任务，可能产生模型用量。原结果保留；本次要求不改变经历事实、发送授权和全局设置。
      </p>
      <label><input type="checkbox" v-model="confirmNewCall" /> 我确认重新生成</label
      ><template #footer
        ><button @click="regenerateOpen = false">返回</button
        ><button :disabled="!confirmNewCall || busy" @click="regenerate">
          创建新任务
        </button></template
      ></ElDialog
    >
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch, onDeactivated, onActivated, onScopeDispose } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElDialog } from 'element-plus'
import { executionStates } from '../../../../common/execution'
import { AGENT_DEFINITIONS } from '../../../../common/agents'
import { useExecutionFeed } from '../../composables/executionFeed'
import AnalysisReport from './AnalysisReport.vue'
import InsightReport from './InsightReport.vue'
const route = useRoute(),
  router = useRouter(),
  filter = ref('active'),
  page = ref(1),
  selected = ref(''),
  detail = ref<any>(),
  error = ref(''),
  loading = ref(false),
  busy = ref(false),
  stepId = ref(''),
  panel = ref('result'),
  events = ref<any[]>([]),
  cursor = ref(0),
  moreEvents = ref(false),
  active = ref(true)
const regenerateOpen = ref(false),
  instruction = ref(''),
  confirmNewCall = ref(false)
const {
  data: feed,
  error: feedError,
  refresh
} = useExecutionFeed(() => ({
  state: filter.value,
  page: page.value,
  objectId: route.query.object || '',
  agentId: route.query.agent || ''
}))
const tabs = [
  { id: 'result', title: '结果与回复' },
  { id: 'evidence', title: '使用的依据' },
  { id: 'events', title: '运行记录' }
]
const rpc = (name: string, p: any) => electron.ipcRenderer.invoke(name, p)
const label = (s: string) => executionStates[s] || s
const actorLabel = (id: string) =>
  id === 'system' ? '程序' : (AGENT_DEFINITIONS.find((a) => a.id === id)?.label || id) + ' Agent'
const sourceLabel = (s: string) =>
  ({
    manual: '由本人发起',
    automatic: '自动任务',
    message: '收到新消息',
    coordinator: '由主 Agent 安排',
    contact: '岗位联系流程',
    discovery: '机会发现派发'
  })[s] || s
const time = (s: string) => (s ? new Date(s).toLocaleString('zh-CN') : '—')
const elapsed = (s: any) =>
  `${Math.max(0, Math.floor(((s.finished_at ? Date.parse(s.finished_at) : Date.now()) - Date.parse(s.started_at)) / 1000))} 秒`
const visibleSteps = computed(() => detail.value?.steps || [])
const selectedStep = computed(() => visibleSteps.value.find((s: any) => s.id === stepId.value))
const selectedCall = computed(() =>
  detail.value?.modelCalls.find((c: any) => 'model:' + c.id === stepId.value)
)
const modelCallId = computed(() => selectedCall.value?.id || '')
const heartbeatStale = computed(
  () =>
    selectedStep.value?.state === 'running' &&
    Date.now() - Date.parse(selectedStep.value.heartbeat_at) > 90000
)
const draftText = computed(
  () =>
    detail.value?.result?.text ||
    selectedStep.value?.output?.text ||
    selectedStep.value?.output?.draft ||
    [...visibleSteps.value].reverse().find((s: any) => s.output?.text || s.output?.draft)?.output
      ?.text ||
    [...visibleSteps.value].reverse().find((s: any) => s.output?.draft)?.output?.draft ||
    ''
)
const checks = computed(() =>
  visibleSteps.value.filter((s: any) => s.actor === 'system' && /检查|审校/.test(s.label))
)
let ticket = 0,
  timer: ReturnType<typeof setInterval> | undefined,
  lastAccount = '',
  lastRevision = 0
async function loadDetail(force = false) {
  if (!selected.value || !active.value || document.hidden || (loading.value && !force)) return
  const id = selected.value,
    seq = ++ticket
  loading.value = true
  try {
    const v = await rpc('career-execution-detail', { id })
    if (seq !== ticket || selected.value !== id) return
    detail.value = v
    if (force || v.run.revision !== lastRevision) {
      lastRevision = v.run.revision
      if (!v.steps.some((s: any) => s.id === stepId.value))
        stepId.value =
          v.steps.find((s: any) => s.state === 'running' && s.actor !== 'system')?.id ||
          v.steps.at(-1)?.id ||
          ''
      if (panel.value === 'events') await loadEvents()
    }
    error.value = ''
  } catch (e) {
    if (seq === ticket) {
      detail.value = undefined
      error.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    if (seq === ticket) loading.value = false
  }
}
async function choose(id: string) {
  if (selected.value === id) return
  selected.value = id
  detail.value = undefined
  stepId.value = ''
  events.value = []
  cursor.value = 0
  lastRevision = 0
  await router.replace({ query: { ...route.query, tab: 'agents', run: id } })
  await loadDetail(true)
}
async function loadEvents() {
  const id = selected.value
  if (!id) return
  try {
    const r = await rpc('career-execution-events', { id, after: cursor.value })
    if (selected.value !== id) return
    const keys = new Set(events.value.map((e) => e.sequence))
    events.value.push(...r.items.filter((e: any) => !keys.has(e.sequence)))
    cursor.value = r.cursor
    moreEvents.value = r.hasMore
  } catch (e) {
    error.value = String(e)
  }
}
async function control(action: string, extra: any = {}) {
  if (!detail.value || busy.value) return
  busy.value = true
  try {
    const r = await rpc('career-execution-control', {
      id: selected.value,
      baseRevision: detail.value.run.revision,
      action,
      ...extra
    })
    if (r.executionId) await choose(r.executionId)
    else await loadDetail(true)
    await refresh()
    return true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    return false
  } finally {
    busy.value = false
  }
}
async function pauseSending() {
  try {
    await rpc('career-tasks-pause', {})
    await refresh()
  } catch (e) {
    error.value = String(e)
  }
}
async function regenerate() {
  if (
    await control('regenerate', {
      instruction: detail.value?.capabilities.instruction ? instruction.value : '',
      confirmNewCall: confirmNewCall.value
    })
  ) {
    regenerateOpen.value = false
    instruction.value = ''
    confirmNewCall.value = false
  }
}
function clearFilters() {
  void router.replace({ query: { tab: 'agents' } })
  selected.value = ''
  detail.value = undefined
}
watch(feed, (v) => {
  if (!v) return
  if (lastAccount && v.accountId !== lastAccount) {
    selected.value = ''
    detail.value = undefined
    ticket++
    void router.replace({ query: { tab: 'agents' } })
  }
  lastAccount = v.accountId
  const id = typeof route.query.run === 'string' ? route.query.run : v.items[0]?.id
  if (!selected.value && id) void choose(id)
  else if (v.items.find((r: any) => r.id === selected.value)?.revision !== lastRevision)
    void loadDetail()
})
watch(
  () => route.query.run,
  (id) => {
    if (typeof id === 'string' && id !== selected.value) void choose(id)
  }
)
watch(panel, (v) => {
  if (v === 'events') void loadEvents()
})
function start() {
  active.value = true
  if (!timer)
    timer = setInterval(() => {
      if (
        !document.hidden &&
        detail.value &&
        (['queued', 'running', 'waiting'].includes(detail.value.run.underlyingState) ||
          panel.value === 'events')
      )
        void loadDetail()
    }, 3000)
}
function stop() {
  active.value = false
  ticket++
  clearInterval(timer)
  timer = undefined
}
start()
onActivated(start)
onDeactivated(stop)
onScopeDispose(stop)
</script>
<style scoped>
.execution-workbench {
  font-size: 13px;
}
.run-header,
.filters,
.run-detail > header,
.step-heading,
.run-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
h2 {
  font-size: 21px;
}
h3 {
  font-size: 18px;
  margin: 6px 0;
}
h4 {
  font-size: 14px;
  margin: 12px 0;
}
p {
  line-height: 1.75;
  overflow-wrap: anywhere;
}
small,
.muted,
.run-header p {
  color: var(--el-text-color-secondary);
}
a {
  color: var(--el-color-primary);
}
button,
select {
  font: inherit;
  padding: 7px 11px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--atlas-panel);
  color: var(--el-text-color-primary);
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
button[aria-pressed='true'] {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
label {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.filters {
  justify-content: flex-end;
}
.run-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  background: var(--atlas-panel);
  margin: 18px 0;
}
.run-list {
  padding: 14px;
  border-right: 1px solid var(--el-border-color);
  min-width: 0;
}
.run-item {
  display: grid;
  gap: 6px;
  text-align: left;
  width: 100%;
  margin: 0 0 10px;
  overflow-wrap: anywhere;
}
.run-item strong {
  font-weight: 600;
}
.run-item .state {
  justify-self: start;
}
.run-list nav {
  display: flex;
  align-items: center;
  gap: 6px;
}
.run-detail {
  padding: 20px;
  min-width: 0;
}
.workflow {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  border-top: 1px solid var(--el-border-color);
  margin-top: 18px;
  padding-top: 14px;
  gap: 20px;
}
.step-list {
  min-width: 0;
}
.step {
  display: flex;
  gap: 9px;
  width: 100%;
  text-align: left;
  margin: 4px 0;
  border: 0;
  background: transparent;
  overflow-wrap: anywhere;
}
.step small {
  display: block;
}
.step.child {
  padding-left: 18px;
}
.mark {
  flex: 0 0 18px;
  color: var(--el-text-color-secondary);
}
.running .mark {
  color: var(--el-color-primary);
}
.completed .mark {
  color: var(--el-color-success);
}
.failed .mark,
.review .mark,
.uncertain .mark {
  color: var(--el-color-warning);
}
.step-detail {
  min-width: 0;
}
.detail-tabs {
  display: flex;
  gap: 12px;
  border-bottom: 1px solid var(--el-border-color);
  padding-bottom: 10px;
  margin: 14px 0;
}
.detail-tabs button {
  border: 0;
  padding: 6px;
}
.draft,
.incoming {
  padding: 14px;
  border-radius: 8px;
  white-space: pre-wrap;
  background: var(--el-fill-color-light);
}
.draft {
  background: var(--el-color-primary-light-9);
}
.draft small,
.incoming small {
  display: block;
  margin-bottom: 8px;
}
.state {
  font-size: 12px;
  background: var(--el-fill-color-light);
  padding: 3px 7px;
  border-radius: 4px;
  white-space: nowrap;
}
.state.running {
  color: var(--el-color-primary);
}
.state.completed,
.state.cached {
  color: var(--el-color-success);
}
.state.review,
.state.blocked,
.state.uncertain,
.state.interrupted {
  color: var(--el-color-warning-dark-2);
}
.error {
  color: var(--el-color-danger);
}
.warning {
  color: var(--el-color-warning-dark-2);
}
.checks > div {
  display: flex;
  gap: 8px;
  align-items: start;
  margin: 8px 0;
}
.fact,
.receipts article {
  padding: 10px 0;
  border-bottom: 1px solid var(--el-border-color);
}
.receipts p {
  white-space: pre-wrap;
}
.events {
  list-style: none;
  padding: 0;
}
.events li {
  display: grid;
  grid-template-columns: 135px minmax(0, 1fr);
  gap: 6px 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--el-border-color);
}
.events time {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.events small {
  grid-column: 2;
}
.run-controls {
  justify-content: flex-start;
  border-top: 1px solid var(--el-border-color);
  padding-top: 16px;
  margin-top: 20px;
}
.run-controls small {
  flex-basis: 100%;
}
.empty {
  padding: 20px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}
.child-runs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.child-runs span {
  flex-basis: 100%;
  color: var(--el-text-color-secondary);
}
textarea {
  width: 100%;
  min-height: 100px;
  padding: 10px;
  font: inherit;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  resize: vertical;
}
.scope button,
.parent button {
  border: 0;
  color: var(--el-color-primary);
  background: transparent;
}
@media (max-width: 1300px) {
  .workflow {
    grid-template-columns: 1fr;
  }
  .step-list {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .step {
    width: auto;
    flex: 1 1 145px;
  }
  .step.child {
    padding-left: 10px;
  }
}
@media (max-width: 900px) {
  .run-layout {
    grid-template-columns: 1fr;
  }
  .run-list {
    border-right: 0;
    border-bottom: 1px solid var(--el-border-color);
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .run-item {
    flex: 1 1 190px;
  }
  .run-detail {
    padding: 14px;
  }
  .events li {
    grid-template-columns: 1fr;
  }
  .events small {
    grid-column: 1;
  }
}
</style>
