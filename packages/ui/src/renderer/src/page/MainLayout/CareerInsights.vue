<template>
  <main class="insights-page">
    <header class="insights-header">
      <div>
        <h1>全局分析</h1>
        <p>简历、岗位样本与改进建议</p>
      </div>
      <div class="controls">
        <label
          >岗位样本<select :disabled="loading" v-model.number="days" @change="changeWindow">
            <option :value="30">最近 30 天</option>
            <option :value="90">最近 90 天</option>
            <option :value="0">全部记录</option>
          </select></label
        ><ElButton :loading="loading" @click="load">刷新</ElButton>
      </div>
    </header>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <p v-if="!data" class="empty" role="status">
      {{ loading ? '正在整理资料与岗位…' : '暂未读取到数据' }}
    </p>
    <template v-if="data">
      <div class="scope-line">
        <span>{{ data.profile.targetRoles.join(' / ') || '未设置求职方向' }}</span
        ><span
          >{{ data.profile.cities.join('、') || '未设置城市' }} ·
          {{
            data.profile.minimumMonthlyK ? data.profile.minimumMonthlyK + 'K 起' : '薪资未设置'
          }}</span
        ><button @click="go('policy')">调整方向</button>
      </div>
      <section class="insights-metrics" aria-label="真实数据概况">
        <article>
          <span>已确认依据</span
          ><strong
            >{{ data.profile.confirmed }}<small> / {{ data.profile.evidenceTotal }}</small></strong
          >
          <p>经历与资历</p>
        </article>
        <article>
          <span>岗位样本</span><strong>{{ data.stats.total }}</strong>
          <p>{{ data.stats.completeJd }} 个有完整 JD</p>
        </article>
        <article>
          <span>当前岗位分析</span><strong>{{ data.stats.analyzed }}</strong>
          <p>与当前简历版本一致</p>
        </article>
        <article>
          <span>样本月薪中位数</span
          ><strong
            >{{ data.stats.salaryMedian === null ? '—' : data.stats.salaryMedian.toFixed(1)
            }}<small v-if="data.stats.salaryMedian !== null">K</small></strong
          >
          <p>{{ data.stats.salarySamples }} 个有效薪资区间</p>
        </article>
      </section>
      <section class="insights-grid top-grid">
        <article class="insight-panel readiness">
          <header>
            <h2>资料准备</h2>
            <button @click="go('profile')">编辑资料 ↗</button>
          </header>
          <div class="readiness-content">
            <svg
              viewBox="0 0 120 120"
              role="img"
              :aria-label="`资料已完成${ready}项，共${data.profile.checks.length}项`"
            >
              <circle cx="60" cy="60" r="46" fill="none" stroke="#edf0f4" stroke-width="9" />
              <circle
                cx="60"
                cy="60"
                r="46"
                fill="none"
                stroke="#3b6bd6"
                stroke-width="9"
                :stroke-dasharray="`${(ready / data.profile.checks.length) * 289} 289`"
                transform="rotate(-90 60 60)"
                stroke-linecap="round"
              />
              <text x="60" y="59" text-anchor="middle" class="ring-count">
                {{ ready }}/{{ data.profile.checks.length }}
              </text>
              <text x="60" y="78" text-anchor="middle" class="ring-label">已完成</text>
            </svg>
            <ul>
              <li v-for="check in data.profile.checks" :key="check.label">
                <span :class="check.ok ? 'ready' : 'missing'" aria-hidden="true">{{
                  check.ok ? '✓' : '○'
                }}</span
                >{{ check.label === '可引用经历' ? '可引用依据' : check.label
                }}<small>{{ check.ok ? '已准备' : '待补充' }}</small>
              </li>
            </ul>
          </div>
        </article>
        <article class="insight-panel">
          <header>
            <h2>优先处理</h2>
            <span>{{ data.actions.length }} 项</span>
          </header>
          <button
            v-for="item in data.actions.slice(0, 4)"
            :key="item.id"
            class="improvement"
            @click="go(item.destination)"
          >
            <span
              ><b>{{ item.title }}</b
              ><small>{{ item.detail }}</small></span
            ><strong>{{ item.count || '↗' }}</strong>
          </button>
          <p v-if="!data.actions.length" class="empty">基础资料已就绪，可继续核对具体岗位。</p>
        </article>
      </section>
      <section class="insights-grid charts-grid" aria-label="岗位样本分布">
        <article class="insight-panel">
          <header>
            <h2>地区分布</h2>
            <span>{{ data.stats.total }} 个样本</span>
          </header>
          <div v-if="data.stats.cities.length" class="data-bars">
            <button
              v-for="r in data.stats.cities.slice(0, 6)"
              :key="r.name"
              @click="browse(r.name)"
            >
              <span>{{ r.name }}</span
              ><i><b :style="{ width: percent(r.count, data.stats.total) + '%' }" /></i
              ><strong>{{ r.count }}</strong>
            </button>
          </div>
          <p v-else class="empty">暂无岗位位置</p>
        </article>
        <article class="insight-panel">
          <header>
            <h2>薪资分布</h2>
            <span>月薪 · K</span>
          </header>
          <p v-if="!data.stats.salarySamples" class="empty">暂无可统计的薪资样本</p>
          <div v-else class="data-bars">
            <div v-for="r in data.stats.salaryBands" :key="r.name">
              <span>{{ r.name }}</span
              ><i><b :style="{ width: percent(r.count, data.stats.salarySamples) + '%' }" /></i
              ><strong>{{ r.count }}</strong>
            </div>
          </div>
          <p class="chart-note">按区间中点统计，分组随样本调整 · {{ data.stats.salaryUnknown }} 个薪资未知</p>
        </article>
        <article class="insight-panel">
          <header>
            <h2>条件核对</h2>
            <span>全部 {{ data.stats.total }} 个岗位</span>
          </header>
          <div class="data-bars">
            <button v-for="r in conditionRows" :key="r.name" @click="go('discovery')">
              <span>{{ r.name }}</span
              ><i
                ><b
                  :style="{
                    width: percent(r.count, data.stats.total) + '%',
                    background: r.color
                  }" /></i
              ><strong>{{ r.count }}</strong>
            </button>
          </div>
          <p class="chart-note">必要条件与经历初筛，不等于允许自动发送</p>
        </article>
      </section>
      <section class="insights-grid reports-grid" aria-label="AI 研判">
        <article v-for="kind in insightKinds" :key="kind" class="insight-panel report-panel">
          <header>
            <div>
              <h2>{{ insightLabels[kind] }}</h2>
              <span class="quiet-label">AI 研判</span>
            </div>
            <ElButton
              :disabled="!!running(kind) || starting === kind || !canAnalyze(kind)"
              @click="analyze(kind)"
              >{{
                running(kind) ? '分析中' : data.reports[kind] ? '更新研判' : '开始分析'
              }}</ElButton
            >
          </header>
          <div v-if="running(kind)" class="analysis-progress" role="status">
            <span class="progress-dot" /><span>{{
              running(kind).state === 'queued' ? '等待模型空闲' : '正在分析资料与岗位'
            }}</span
            ><button @click="cancel(running(kind).id)">取消</button>
          </div>
          <p v-if="failure(kind)" class="inline-error" role="alert">{{ failure(kind) }}</p>
          <p v-if="notices[kind]" class="chart-note" role="status">{{ notices[kind] }}</p>
          <InsightReport v-if="data.reports[kind]" :report="data.reports[kind]" @action="go" />
          <div v-else class="report-empty">
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <path
                :d="
                  kind === 'resume-review'
                    ? 'M8 3h11l6 6v20H8zM18 3v8h7M12 16h9M12 21h7'
                    : 'M4 27h24M8 22V14M16 22V5M24 22V10'
                "
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              />
            </svg>
            <h3>{{ kind === 'resume-review' ? '简历优势与表达缺口' : '岗位机会与投入建议' }}</h3>
            <p>
              {{
                kind === 'resume-review'
                  ? '结合整份履历与岗位要求，识别优势和表达缺口。'
                  : '比较已采集岗位的业务需求、薪资与经历关联。'
              }}
            </p>
            <small>{{
              canAnalyze(kind) ? '使用设置中的模型，按需调用并记录用量。' : '先补充简历或采集岗位。'
            }}</small>
          </div>
          <footer>
            <RouterLink :to="`/main-layout/CareerAgents?agent=${kind}`"
              >提示词与启用设置 ↗</RouterLink
            >
          </footer>
        </article>
      </section>
      <section class="insight-panel evidence-matrix">
        <header>
          <h2>岗位要求与经历依据</h2>
          <span>{{ data.stats.analyzed }} 份当前分析</span>
        </header>
        <p v-if="!data.stats.requirements.length" class="empty">
          分析岗位后，这里会显示已支持、待核实和缺口。
        </p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>要求</th>
                <th>已有支持</th>
                <th>待核实</th>
                <th>缺口</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in data.stats.requirements" :key="r.name">
                <th>
                  <details>
                    <summary>{{ r.name }}</summary>
                    <ul>
                      <li v-for="j in r.jobs" :key="j.id">{{ j.name }}</li>
                    </ul>
                  </details>
                </th>
                <td class="met">{{ r.met }}</td>
                <td>{{ r.verify }}</td>
                <td class="gap">{{ r.gap }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <details class="scope-notes">
        <summary>数据范围与口径</summary>
        <p>
          当前账号本地共 {{ data.stats.allStored }} 个岗位；本窗口
          {{ data.stats.total }} 个。时间按最近观察记录计算，未知日期
          {{ data.stats.undated }} 个，限定时间时不计入。薪资中位数使用有效区间中点。{{
            data.stats.unassigned
          }}
          条平台来源记录账号未核实，未计入。
        </p>
        <p>
          AI 阅读窗口内最近 {{ data.aiSampleCount }} 个岗位的 JD
          摘要，并使用全部窗口内样本统计。已采集样本不代表全国市场；资料完成度不是竞争力评分。人工导入记录按所属账号或本机资料计入。
        </p>
      </details>
    </template>
  </main>
</template>
<script setup lang="ts">
import { computed, ref, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ElAlert, ElButton } from 'element-plus'
import { insightKinds, insightLabels, type InsightKind } from '../../../../common/insights'
import InsightReport from '../../components/career/InsightReport.vue'
const router = useRouter(),
  data = ref<any>(),
  days = ref(30),
  loading = ref(false),
  error = ref(''),
  starting = ref(''),
  failures = ref<Record<string, string>>({}),
  notices = ref<Record<string, string>>({})
const call = (name: string, p?: unknown) => electron.ipcRenderer.invoke(name, p)
const destinations: Record<string, string> = {
  profile: '/main-layout/CareerWorkspace',
  discovery: '/main-layout/CareerDiscovery',
  communication: '/main-layout/CareerDashboard?view=replies',
  policy: '/main-layout/CareerDiscovery?strategy=1'
}
const go = (destination: string) => router.push(destinations[destination] || destinations.profile)
const browse = (city: string) =>
  router.push({
    path: '/main-layout/CareerDiscovery',
    query: { query: city === '地点待核实' ? '' : city, filter: 'all' }
  })
const ready = computed(() => data.value?.profile.checks.filter((r: any) => r.ok).length || 0)
const percent = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0)
const conditionRows = computed(() => [
  { name: '初筛满足', count: data.value?.stats.match.met || 0, color: '#348262' },
  { name: '待核实', count: data.value?.stats.match.verify || 0, color: '#be8b37' },
  { name: '明确不符', count: data.value?.stats.match.gap || 0, color: '#9ba5b2' }
])
const running = (kind: string) => data.value?.tasks.find((t: any) => t.kind === 'career-' + kind)
function failure(kind: string) {
  if (failures.value[kind]) return failures.value[kind]
  const t = data.value?.latestTasks?.find((t: any) => t.kind === 'career-' + kind),
    report = data.value?.reports[kind]
  return t &&
    ['failed', 'interrupted'].includes(t.state) &&
    (!report || t.created_at > report.createdAt)
    ? t.error || t.step
    : ''
}
const canAnalyze = (kind: InsightKind) =>
  kind === 'market-review'
    ? data.value?.stats.total > 0
    : !!(
        data.value?.profile.evidenceTotal ||
        data.value?.profile.checks.find((c: any) => c.label === '简历正文')?.ok ||
        data.value?.profile.checks.find((c: any) => c.label === '个人优势')?.ok
      )
let active = false,
  timer: ReturnType<typeof setInterval> | undefined
const pending = new Map<string, string>()
function changeWindow() {
  // Tasks keep running on the server; window-specific notices must not leak
  // into another sample window. Returning to a window reloads its task history.
  pending.clear()
  failures.value = {}
  notices.value = {}
  void load()
}
async function load() {
  if (loading.value) return
  loading.value = true
  try {
    const result = await call('career-insights-overview', { days: days.value })
    data.value = result
    error.value = ''
    for (const [id, kind] of pending)
      if (!result.tasks.some((t: any) => t.id === id)) {
        const task = await call('career-task-get', { id })
        if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(task.state)) continue
        if (task.state !== 'completed') failures.value[kind] = task.error || task.step
        else notices.value[kind] = task.result?.cached ? '依据未变，已复用现有研判' : '研判已更新'
        pending.delete(id)
      }
  } catch (e) {
    error.value = String(e)
  } finally {
    loading.value = false
  }
}
async function analyze(kind: InsightKind) {
  starting.value = kind
  failures.value[kind] = ''
  notices.value[kind] = ''
  try {
    const r = await call('career-task-create', {
      channel: 'career-' + kind,
      payload: { days: days.value, baseBasis: data.value.basis }
    })
    pending.set(r.taskId, kind)
    await load()
  } catch (e) {
    failures.value[kind] = String(e)
  } finally {
    starting.value = ''
  }
}
async function cancel(id: string) {
  try {
    await call('career-task-cancel', { id })
    await load()
  } catch (e) {
    error.value = String(e)
  }
}
function start() {
  active = true
  void load()
  if (!timer)
    timer = setInterval(() => {
      if (active && !document.hidden && (data.value?.tasks.length || pending.size)) void load()
    }, 2500)
}
function stop() {
  active = false
  clearInterval(timer)
  timer = undefined
}
onActivated(start)
onDeactivated(stop)
onBeforeUnmount(stop)
</script>
<style scoped>
.insights-page {
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  padding: 28px 32px 40px;
  color: var(--el-text-color-primary);
  font-size: 13px;
}
.insights-header,
.insight-panel > header,
.controls,
.scope-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.insights-header h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 650;
}
.insights-header p {
  color: var(--el-text-color-secondary);
  margin: 8px 0 0;
}
.controls label {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--el-text-color-secondary);
}
select {
  padding: 9px 12px;
  background: white;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
}
.scope-line {
  justify-content: flex-start;
  margin: 24px 0 18px;
  flex-wrap: wrap;
  color: var(--el-text-color-secondary);
}
.scope-line span:first-child {
  color: var(--el-text-color-primary);
  font-weight: 550;
}
.insights-page button:not(.el-button) {
  cursor: pointer;
}
.scope-line button,
.insight-panel > header button,
.analysis-progress button {
  background: none;
  border: 0;
  color: var(--el-color-primary);
  font-size: 12px;
}
.insights-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}
.insights-metrics article {
  padding: 20px 22px;
  background: var(--atlas-panel);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
}
.insights-metrics span,
.insights-metrics p {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.insights-metrics strong {
  display: block;
  font-size: 30px;
  font-weight: 600;
  margin: 12px 0;
  font-variant-numeric: tabular-nums;
}
.insights-metrics small {
  font-size: 14px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}
.insights-metrics p {
  margin: 0;
}
.insights-grid {
  display: grid;
  gap: 20px;
  margin-bottom: 20px;
}
.top-grid {
  grid-template-columns: 1fr 1fr;
}
.reports-grid {
  grid-template-columns: 1fr 1fr;
  align-items: start;
}
.charts-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.insight-panel {
  padding: 22px;
  background: var(--atlas-panel);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  min-width: 0;
}
.insight-panel > header {
  margin-bottom: 20px;
}
.insight-panel h2 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}
.insight-panel > header > span,
.quiet-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.readiness-content {
  display: flex;
  gap: 28px;
  align-items: center;
}
.readiness svg {
  width: 135px;
  max-width: 36%;
  flex-shrink: 0;
}
.ring-count {
  font-size: 24px;
  fill: var(--el-text-color-primary);
  font-weight: 600;
}
.ring-label {
  font-size: 10px;
  fill: var(--el-text-color-secondary);
}
.readiness ul {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
}
.readiness li {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 11px 0;
}
.readiness li small {
  margin-left: auto;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}
.ready {
  color: #248267;
}
.missing {
  color: #9aa5b6;
}
.improvement {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  background: none;
  border: 0;
  border-top: 1px solid var(--el-border-color-lighter);
  padding: 13px 0;
  text-align: left;
  width: 100%;
  color: var(--el-text-color-primary);
}
.improvement b {
  font-size: 13px;
  font-weight: 550;
}
.improvement small {
  display: block;
  margin-top: 5px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.improvement strong {
  font-variant-numeric: tabular-nums;
  color: var(--el-color-primary);
}
.report-empty {
  padding: 26px 12px;
  text-align: center;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}
.report-empty svg {
  width: 34px;
  height: 34px;
  color: #8492a5;
}
.report-empty h3 {
  font-size: 15px;
  font-weight: 550;
  color: var(--el-text-color-primary);
  margin: 12px 0;
}
.report-empty p {
  font-size: 13px;
}
.report-empty small {
  font-size: 11px;
}
.report-panel footer {
  border-top: 1px solid var(--el-border-color-lighter);
  margin-top: 18px;
  padding-top: 14px;
  font-size: 12px;
  color: var(--el-color-primary);
}
.analysis-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 12px;
  background: var(--el-fill-color-light);
  margin-bottom: 15px;
  border-radius: 6px;
}
.analysis-progress button {
  margin-left: auto;
}
.progress-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--el-color-primary);
}
.inline-error {
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.7;
}
.data-bars > div,
.data-bars > button {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr) 26px;
  align-items: center;
  gap: 12px;
  padding: 9px 0;
  background: none;
  border: 0;
  width: 100%;
  text-align: left;
  font-size: 12px;
  color: var(--el-text-color-regular);
}
.data-bars i {
  height: 7px;
  border-radius: 3px;
  background: #edf0f5;
  overflow: hidden;
}
.data-bars b {
  display: block;
  height: 100%;
  background: #6281bd;
  border-radius: 3px;
}
.data-bars strong {
  text-align: right;
  font-size: 12px;
  font-weight: 550;
}
.chart-note {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
  margin: 14px 0 0;
}
.empty {
  padding: 25px 12px;
  text-align: center;
  color: var(--el-text-color-secondary);
  line-height: 1.8;
}
.table-wrap {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  min-width: 450px;
}
th,
td {
  text-align: left;
  padding: 14px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 12px;
}
thead {
  color: var(--el-text-color-secondary);
}
th {
  font-weight: 500;
}
th:first-child {
  width: 60%;
}
td {
  font-variant-numeric: tabular-nums;
}
.met {
  color: #248267;
}
.gap {
  color: #a76b25;
}
summary {
  cursor: pointer;
}
table ul {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}
.scope-notes {
  margin-top: 24px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.8;
}
@media (max-width: 1200px) {
  .charts-grid {
    grid-template-columns: 1fr 1fr;
  }
  .charts-grid article:last-child {
    grid-column: 1/-1;
  }
  .readiness-content {
    gap: 12px;
  }
  .readiness li {
    gap: 6px;
  }
}
@media (max-width: 900px) {
  .insights-page {
    padding: 20px;
  }
  .insights-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .insights-metrics {
    grid-template-columns: repeat(2, 1fr);
  }
  .top-grid,
  .reports-grid,
  .charts-grid {
    grid-template-columns: 1fr;
  }
  .charts-grid article:last-child {
    grid-column: auto;
  }
  .controls {
    width: 100%;
  }
}
</style>
