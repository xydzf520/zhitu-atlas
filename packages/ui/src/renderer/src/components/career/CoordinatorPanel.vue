<template>
  <section class="coordinator" aria-label="今日求职安排">
    <header>
      <div>
        <h2>
          今日求职安排
          <span v-if="data">{{ data.plan.source === 'ai' ? 'AI 排序' : '规则安排' }}</span>
        </h2>
        <p>沟通优先，逐步推进合适的岗位。</p>
      </div>
      <div class="controls">
        <label
          >协调方式
          <select
            :value="data?.config.mode || 'suggest'"
            :disabled="busy || !data"
            @change="changeMode"
          >
            <option value="suggest">只给建议</option>
            <option value="assist">自动安排</option>
          </select></label
        >
        <button :disabled="busy" @click="refresh">刷新</button>
        <button
          class="primary"
          :disabled="busy || !data?.agentEnabled || !data?.budget.remaining || modelRunning"
          @click="optimize"
        >
          {{ modelRunning ? 'AI 正在安排…' : 'AI 调整安排' }}
        </button>
      </div>
    </header>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="!data" role="status">{{ loading ? '正在读取安排…' : '安排暂不可读，请重试。' }}</p>
    <template v-else>
      <div class="status-line">
        <span
          :class="[
            'indicator',
            data.automationPaused || data.config.mode === 'suggest' ? 'idle' : 'on'
          ]"
        ></span
        ><span>{{
          !data.agentEnabled
            ? '协调 Agent 已停用'
            : data.automationPaused
              ? '全部自动任务已暂停，安排仍可查看'
              : data.config.mode === 'suggest'
                ? '仅显示建议，不提交任务'
                : '自动安排已开启，沿用各模块权限'
        }}</span
        ><RouterLink to="/main-layout/CareerTasks">任务控制 →</RouterLink>
      </div>
      <nav class="tabs" aria-label="安排视图">
        <button
          v-for="item in tabs"
          :key="item.id"
          :aria-pressed="tab === item.id"
          :class="{ selected: tab === item.id }"
          @click="tab = item.id"
        >
          {{ item.label }}</button
        ><small>AI 调整 {{ data.budget.used }}/{{ data.budget.limit }} 次／日</small>
      </nav>
      <div v-if="tab === 'plan'">
        <p class="summary">{{ data.plan.summary }}</p>
        <p v-if="!data.plan.actions.length" class="empty">
          暂无待安排事项。可进入机会发现补充岗位。
        </p>
        <ol class="actions">
          <li v-for="(action, i) in visibleActions" :key="action.id">
            <span class="number">{{ i + 1 }}</span>
            <div class="action-main">
              <strong>{{ action.title }}</strong>
              <p>{{ action.reason }}</p>
              <small v-if="action.blocked || action.execution.reason">{{
                action.blocked || action.execution.reason
              }}</small>
            </div>
            <span :class="['state', action.execution.state]">{{
              stateLabel(action.execution.state)
            }}</span>
            <div class="action-buttons">
              <button
                v-if="action.kind !== 'manual' && action.execution.state === 'pending'"
                :disabled="busy || !!action.blocked"
                @click="dispatch(action)"
              >
                安排执行</button
              ><RouterLink :to="action.destination">查看</RouterLink
              ><button
                v-if="action.kind === 'manual' && action.destination.includes('conversation=')"
                class="quiet"
                :disabled="busy"
                @click="reviewed(action)"
              >
                已处理</button
              ><button
                v-if="action.priority > 0 && action.execution.state === 'pending'"
                class="quiet"
                :disabled="busy"
                @click="skip(action)"
              >
                忽略
              </button>
            </div>
          </li>
        </ol>
        <button
          v-if="data.plan.actions.length > 4"
          class="quiet expand"
          @click="expanded = !expanded"
        >
          {{ expanded ? '收起' : `展开全部 ${data.plan.actions.length} 项` }}
        </button>
      </div>
      <div v-else-if="tab === 'history'" class="history">
        <p v-if="!data.history.length" class="empty">还没有提交过协调任务。</p>
        <article v-for="item in data.history" :key="item.id">
          <div>
            <strong>{{ item.title }}</strong>
            <p>{{ item.execution.reason || stateLabel(item.execution.state) }}</p>
            <small>{{ time(item.createdAt) }}</small>
          </div>
          <span :class="['state', item.execution.state]">{{
            stateLabel(item.execution.state)
          }}</span
          ><RouterLink :to="item.destination">查看结果</RouterLink>
        </article>
        <RouterLink to="/main-layout/CareerTasks">完整队列与取消操作 →</RouterLink>
      </div>
      <div v-else>
        <div class="outcomes">
          <article v-for="metric in outcomeMetrics" :key="metric.label">
            <strong>{{ metric.value }}</strong
            ><span>{{ metric.label }}</span>
          </article>
        </div>
        <p class="scope">
          近 7 天创建的
          {{
            data.outcomes.cohort
          }}
          个联系任务。平台核验成功与人工确认分列；回复和面试来自关联记录，不推断录用概率。
        </p>
        <RouterLink to="/main-layout/CareerInsights">查看简历与市场分析 →</RouterLink>
      </div>
      <div v-if="modelRunning || data.modelTask?.error" class="model-status" role="status">
        <span>{{
          modelRunning ? '安排已交给后台，离开页面不会重复调用。' : data.modelTask.error
        }}</span
        ><button v-if="modelRunning" :disabled="busy" @click="cancelModel">取消本次分析</button>
      </div>
      <footer>
        <RouterLink to="/main-layout/CareerAgents?agent=coordinator">提示词与调用记录 →</RouterLink>
        <details>
          <summary>运行范围与预算</summary>
          <p>
            AI 只选择程序提供的行动。自动安排不会解除发送暂停、确认经历或更改城市与薪资。每日共享 2
            次 AI 安排、6 项辅助分析；岗位分析沿用原有每日额度。失败和中断的同版本行动不自动重试。
          </p>
          <p>
            本次最多检查最近 120 个岗位：已检查 {{ data.plan.sample.scannedJobs }} /
            {{ data.plan.sample.totalJobs }} 个。重要沟通需查看原文；模块完成不等于消息已发送。
          </p>
        </details>
      </footer>
    </template>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, onMounted, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import { coordinationStates } from '../../../../common/coordinator'
const data = ref<any>(),
  loading = ref(false),
  busy = ref(false),
  error = ref(''),
  tab = ref('plan'),
  expanded = ref(false)
const tabs = [
  { id: 'plan', label: '下一步' },
  { id: 'history', label: '执行记录' },
  { id: 'outcomes', label: '联系结果' }
]
const visibleActions = computed(
  () => data.value?.plan.actions.slice(0, expanded.value ? undefined : 4) || []
)
const modelRunning = computed(() => ['queued', 'running'].includes(data.value?.modelTask?.state))
const outcomeMetrics = computed(() => {
  const c = data.value?.outcomes || {}
  return [
    { label: '平台核验成功', value: c.completed || 0 },
    { label: '人工确认发送', value: c.manual || 0 },
    { label: '收到回复', value: c.replied || 0 },
    { label: '推进面试', value: c.interviews || 0 }
  ]
})
const rpc = (name: string, payload?: any) => electron.ipcRenderer.invoke(name, payload)
const stateLabel = (state: string) =>
  coordinationStates[state] ||
  { paused: '已暂停', analyzing: '分析中', blocked: '待处理' }[state] ||
  state
const time = (v: string) => new Date(v).toLocaleString('zh-CN')
let timer: ReturnType<typeof setInterval> | undefined,
  alive = false,
  lastLoad = 0,
  generation = 0
async function refresh() {
  if (loading.value) return
  loading.value = true
  const request = generation
  try {
    const value = await rpc('career-coordinator-overview')
    if (alive && request === generation) {
      data.value = value
      error.value = ''
    }
  } catch (e) {
    if (alive && request === generation) error.value = String(e)
  } finally {
    loading.value = false
    lastLoad = Date.now()
  }
}
async function mutate(run: () => Promise<any>) {
  if (busy.value) return
  busy.value = true
  try {
    await run()
    await refresh()
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
function changeMode(event: Event) {
  const el = event.target as HTMLSelectElement,
    mode = el.value
  el.value = data.value.config.mode
  void mutate(() =>
    rpc('career-coordinator-config', { mode, baseRevision: data.value.config.revision })
  )
}
function optimize() {
  void mutate(() =>
    rpc('career-task-create', {
      channel: 'career-coordinator-plan',
      payload: { baseBasis: data.value.plan.basis, automatic: false }
    })
  )
}
function dispatch(a: any) {
  void mutate(() =>
    rpc('career-coordinator-dispatch', { planId: data.value.plan.id, actionId: a.id })
  )
}
function reviewed(a: any) {
  void mutate(() =>
    rpc('career-coordinator-reviewed', { planId: data.value.plan.id, actionId: a.id })
  )
}
function skip(a: any) {
  void mutate(() => rpc('career-coordinator-skip', { planId: data.value.plan.id, actionId: a.id }))
}
function cancelModel() {
  void mutate(() => rpc('career-task-cancel', { id: data.value.modelTask.id }))
}
function start() {
  alive = true
  void refresh()
  if (!timer)
    timer = setInterval(() => {
      if (!document.hidden && Date.now() - lastLoad >= (modelRunning.value ? 3000 : 30000))
        void refresh()
    }, 3000)
}
function stop() {
  alive = false
  generation++
  clearInterval(timer)
  timer = undefined
}
onMounted(start)
onActivated(start)
onDeactivated(stop)
onBeforeUnmount(stop)
</script>
<style scoped>
.coordinator {
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  background: var(--el-bg-color);
  padding: 20px 24px;
  margin-bottom: 20px;
  color: var(--el-text-color-primary);
  font-size: 13px;
}
header,
.controls,
.status-line,
.tabs,
footer {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
header {
  justify-content: space-between;
}
h2 {
  font-size: 19px;
  margin: 0;
}
h2 span {
  font-size: 11px;
  font-weight: 400;
  background: #eef3fc;
  color: #456594;
  padding: 4px 7px;
  border-radius: 5px;
  margin-left: 8px;
}
p {
  line-height: 1.65;
  margin: 6px 0;
  color: var(--el-text-color-secondary);
}
button,
select {
  font: inherit;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-bg-color);
  padding: 7px 10px;
  color: var(--el-text-color-primary);
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button:focus-visible,
select:focus-visible,
a:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}
.primary {
  background: var(--el-color-primary);
  color: white;
  border-color: var(--el-color-primary);
}
a {
  color: var(--el-color-primary);
  text-decoration: none;
  white-space: nowrap;
}
.status-line {
  font-size: 12px;
  margin: 14px 0;
}
.indicator {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #9aa7ba;
}
.indicator.on {
  background: #258267;
}
.tabs {
  border-bottom: 1px solid var(--el-border-color-light);
  padding-bottom: 8px;
}
.tabs button {
  border: 0;
  background: transparent;
}
.tabs .selected {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.tabs small {
  margin-left: auto;
  color: var(--el-text-color-secondary);
}
.summary {
  margin-top: 14px;
}
.actions {
  list-style: none;
  padding: 0;
  margin: 8px 0;
}
.actions li {
  display: flex;
  gap: 12px;
  align-items: center;
  border-bottom: 1px solid var(--el-border-color-extra-light);
  padding: 13px 0;
}
.number {
  color: #8192ac;
  min-width: 22px;
  font-size: 16px;
}
.action-main {
  flex: 1;
  min-width: 0;
}
.action-main strong {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.action-main p {
  font-size: 12px;
}
.action-main small {
  color: #8b671e;
  font-size: 11px;
}
.action-buttons {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.quiet {
  border: 0;
  background: transparent;
  color: var(--el-text-color-secondary);
  padding: 5px;
}
.expand {
  display: block;
  margin: auto;
}
.state {
  font-size: 11px;
  padding: 4px 7px;
  border-radius: 5px;
  background: #f0f3f8;
  white-space: nowrap;
}
.state.running,
.state.queued {
  color: #245cc3;
  background: #edf3ff;
}
.state.manual,
.state.blocked,
.state.failed {
  color: #946815;
  background: #fff7e8;
}
.state.completed {
  color: #21755c;
  background: #edf8f2;
}
.history article {
  display: flex;
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid var(--el-border-color-light);
  padding: 13px 0;
}
.history article > div {
  flex: 1;
}
.history small,
.scope {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.outcomes {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin: 20px 0;
}
.outcomes article {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.outcomes strong {
  font-size: 26px;
}
.outcomes span {
  font-size: 12px;
}
.error {
  color: var(--el-color-danger);
}
.model-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  background: var(--el-fill-color-light);
  margin-top: 12px;
}
footer {
  border-top: 1px solid var(--el-border-color-extra-light);
  padding-top: 12px;
  margin-top: 16px;
  justify-content: space-between;
  font-size: 12px;
}
footer details {
  max-width: 600px;
}
summary {
  cursor: pointer;
  color: var(--el-text-color-secondary);
}
.empty {
  padding: 15px 0;
}
@media (max-width: 900px) {
  .coordinator {
    padding: 16px;
  }
  .actions li {
    flex-wrap: wrap;
  }
  .action-main {
    min-width: 60%;
  }
  .state {
    margin-left: 34px;
  }
  .controls {
    gap: 8px;
  }
  .outcomes {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
