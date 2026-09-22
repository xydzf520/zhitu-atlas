<template>
  <main class="agents-page">
    <header class="page-header">
      <div>
        <h1>Agent 管理</h1>
        <p>提示词、启停与调用记录</p>
      </div>
      <ElButton :loading="loading" @click="refresh">刷新状态</ElButton>
    </header>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <div v-if="!data && loading" class="empty" role="status">正在读取 Agent 配置…</div>
    <ExecutionSummary :agent-id="selectedId" title="此 Agent 关联的工作" />
    <template v-if="data">
      <section class="metrics" aria-label="今日 Agent 概况">
        <article>
          <span>启用的 Agent</span
          ><strong
            >{{ enabledCount }}<small> / {{ data.agents.length }}</small></strong
          >
          <p>允许调用，不代表正在运行</p>
        </article>
        <article>
          <span>正在调用模型</span><strong>{{ runningCount }}</strong>
          <p>同一模型串行执行</p>
        </article>
        <article>
          <span>今日模型调用</span><strong>{{ callsCount }}</strong>
          <p>{{ data.day }} · 当前账号 · 含失败调用</p>
        </article>
        <article>
          <span>今日已报告 tokens</span><strong>{{ tokensCount.toLocaleString() }}</strong>
          <p>{{ model?.model || '未配置模型' }} · {{ cacheCount }} 次缓存复用</p>
        </article>
      </section>
      <section class="flow" aria-label="求职 AI 流程"><button @click="choose('coordinator')">求职协调<small>全景总览 · 安排与追踪</small></button><button @click="choose('resume-review')">简历研判<small>全局分析</small></button><button @click="choose('market-review')">机会研判<small>全局分析</small></button>
        <span>采集岗位<small>程序读取</small></span
        ><b aria-hidden="true">→</b
        ><button @click="choose('analysis')">岗位分析<small>所选模型</small></button
        ><b aria-hidden="true">→</b
        ><button @click="choose('greeting')">
          招呼生成 + 审校<small>所选模型 · 2 个步骤</small></button
        ><b aria-hidden="true">→</b><span>发送与回读<small>程序规则</small></span
        ><b aria-hidden="true">→</b
        ><button @click="choose('reply')">回复 / 跟进 / 面试<small>所选模型</small></button>
      </section>
      <details class="usage-note"><summary>启停如何生效</summary><p>
        启用 Agent 后，由原有任务按需调用；不会直接启动投递。停用会阻止新调用，并取消正在进行的该
        Agent 模型请求，已产生的模型用量无法撤回。
      </p></details>
      <div class="workspace">
        <nav class="agent-list" aria-label="选择 Agent">
          <button
            v-for="a in data.agents"
            :key="a.id"
            :class="['agent-card', { selected: selectedId === a.id }]"
            :aria-pressed="selectedId === a.id"
            @click="choose(a.id)"
          >
            <div>
              <strong>{{ a.label }}</strong
              ><span :class="['state', a.running ? 'running' : a.enabled ? 'enabled' : 'off']">{{
                a.running ? '运行中' : a.enabled ? '已启用' : '已停用'
              }}</span>
            </div>
            <p>{{ a.description }}</p>
            <small>今日 {{ a.callsToday }} 次调用 · v{{ a.version }} · 大模型</small>
          </button>
        </nav>
        <section v-if="selected" class="editor" aria-label="Agent 提示词编辑器">
          <header>
            <div>
              <small>{{ selected.entry }}</small>
              <h2>{{ selected.label }}</h2>
            </div>
            <span class="version">v{{ selected.version }}</span>
          </header>
          <ElAlert
            v-if="conflict"
            title="其他窗口已更新配置。当前草稿已保留，请核对最新版本。"
            type="warning"
            :closable="false"
          />
          <div class="editor-controls">
            <label><input v-model="draftEnabled" type="checkbox" />启用此 Agent（保存后生效）</label
            ><span :class="dirty ? 'unsaved' : 'saved'" role="status">{{
              dirty ? '有未保存修改' : '已与服务端一致'
            }}</span>
          </div>
          <label class="prompt-label" for="agent-prompt"
            >可编辑提示词
            <small>{{ draftPrompt.length.toLocaleString() }} / 20,000 字</small></label
          >
          <textarea
            id="agent-prompt"
            v-model="draftPrompt"
            maxlength="20000"
            spellcheck="false"
            aria-describedby="prompt-help"
          />
          <p id="prompt-help">
            保存后用于下一次调用；旧版本的进行中调用会停止，旧分析和招呼不再用于自动执行。此处只写任务指令，岗位、简历与消息由程序注入。
          </p>
          <div class="actions">
            <ElButton type="primary" :disabled="!dirty || conflict" :loading="saving" @click="save"
              >保存并生效</ElButton
            ><ElButton @click="draftPrompt = selected.defaultPrompt">使用默认提示词</ElButton
            ><ElButton @click="reloadEditor">读取最新版本</ElButton
            ><ElButton @click="showHistory">版本历史</ElButton>
          </div>
          <div class="contracts">
            <article>
              <h3>动态输入</h3>
              <ul>
                <li v-for="item in selected.inputs" :key="item">{{ item }}</li>
              </ul>
            </article>
            <article>
              <h3>输出结构</h3>
              <p>{{ selected.output }}</p>
            </article>
          </div>
          <details class="constraints">
            <summary>实际追加的程序约束与场景指令</summary>
            <p>{{ data.rules }}</p>
            <p><b>输出协议：</b>{{ selected.output }}</p>
            <template v-for="(value, key) in selected.variants" :key="key"
              ><h4>{{ String(key) === 'discovery' ? '机会发现模式' : key }}</h4>
              <p>{{ value }}</p></template
            >
            <p>
              这些约束会追加到提示词中；事实校验、预算和发送确认还会由程序独立执行。完整调用提示词可在下方记录中查看。
            </p>
          </details>
          <section v-if="history !== null" class="history">
            <h3>已保存的旧版本</h3>
            <p v-if="!history.length">尚无修改历史。</p>
            <details v-for="v in history" :key="v.version">
              <summary>
                v{{ v.version }} · {{ v.enabled ? '启用' : '停用' }} · {{ formatTime(v.updatedAt) }}
              </summary>
              <pre>{{ v.prompt }}</pre>
              <ElButton
                @click="useHistory(v)"
                >载入此版本为草稿</ElButton
              >
            </details>
          </section>
        </section>
      </div>
      <section class="calls-panel">
        <header>
          <div>
            <h2>实际模型调用</h2>
            <p>记录运行、完成、失败、取消与缓存；历史调用缺少快照时明确标注。</p>
          </div>
          <label
            >筛选 Agent
            <select
              v-model="callFilter"
              @change="changePage(1)"
            >
              <option value="">全部</option>
              <option v-for="a in data.agents" :key="a.id" :value="a.id">{{ a.label }}</option>
            </select></label
          >
        </header>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Agent / 时间</th>
                <th>触发方式</th>
                <th>模型 / 提示词</th>
                <th>结果</th>
                <th>耗时 / tokens</th>
                <th>查看</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in calls?.items" :key="c.id">
                <td>
                  <b>{{ c.label }}</b
                  ><small>{{ formatTime(c.createdAt) }}</small>
                </td>
                <td>{{ c.automatic ? '自动任务' : '手动 / 缓存' }}</td>
                <td>
                  {{ c.model
                  }}<small
                    >{{ c.version ? 'v' + c.version : '历史版本未知'
                    }}{{ c.variant === 'discovery' ? ' · 机会发现' : '' }}</small
                  >
                </td>
                <td>
                  <span :class="['state', c.status]">{{ statusLabel(c.status) }}</span>
                </td>
                <td>
                  {{ duration(c.elapsedMs)
                  }}<small>{{ c.usage?.total_tokens?.toLocaleString() ?? '未报告' }} tokens</small>
                </td>
                <td>
                  <ElButton size="small" @click="inspectCall(c.id)">{{
                    c.promptAvailable ? '查看调用提示词' : '查看说明'
                  }}</ElButton><RouterLink v-if="c.executionId" :to="{path:'/main-layout/CareerTasks',query:{tab:'agents',run:c.executionId}}">关联工作 →</RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="calls && !calls.items.length" class="empty">
          当前范围尚无模型调用记录。可从机会发现或沟通中心触发对应任务。
        </p>
        <footer>
          <span>共 {{ calls?.total || 0 }} 条 · 第 {{ page }} 页</span
          ><ElButton
            :disabled="page <= 1"
            @click="changePage(page - 1)"
            >上一页</ElButton
          ><ElButton
            :disabled="!calls || page * 20 >= calls.total"
            @click="changePage(page + 1)"
            >下一页</ElButton
          >
        </footer>
      </section>
      <section class="deterministic">
        <h2>这些步骤不调用大模型</h2>
        <div>
          <article v-for="item in data.deterministic" :key="item.label">
            <h3>{{ item.label }}</h3>
            <p>{{ item.detail }}</p>
          </article>
        </div>
      </section>
    </template>
    <ElDialog
      v-model="detailOpen"
      title="此次调用的实际提示词"
      width="min(900px, 92vw)"
      destroy-on-close
      ><p>{{ detail?.note }}</p><p v-if="detail?.gateway">渠道：{{ detail.gateway.provider }} · {{ detail.gateway.protocol }} · 只读工具：{{ detail.gateway.tools?.join('、') || '本次未调用' }}</p>
      <template v-if="detail?.prompt"
        ><p>
          {{ detail.prompt.label }} · v{{ detail.prompt.version
          }}{{ detail.prompt.variant ? ' · ' + detail.prompt.variant : '' }}
        </p>
        <pre class="actual-prompt">{{ detail.prompt.system }}</pre></template
      ><template #footer><ElButton @click="detailOpen = false">关闭</ElButton></template></ElDialog
    >
  </main>
</template>

<script setup lang="ts">
import { ref, computed, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import ExecutionSummary from '../../components/career/ExecutionSummary.vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import { ElAlert, ElButton, ElDialog, ElMessage, ElMessageBox } from 'element-plus'
const data = ref<any>(),
  model = ref<any>(),
  calls = ref<any>(),
  detail = ref<any>(),
  detailOpen = ref(false)
const route = useRoute()
const selectedId = ref('analysis'),
  draftPrompt = ref(''),
  draftEnabled = ref(true),
  baseline = ref<any>(),
  history = ref<any[] | null>(null)
const error = ref(''),
  loading = ref(false),
  saving = ref(false),
  page = ref(1),
  callFilter = ref('')
const selected = computed(() => data.value?.agents.find((a: any) => a.id === selectedId.value))
const dirty = computed(
  () =>
    !!baseline.value &&
    (draftPrompt.value !== baseline.value.prompt || draftEnabled.value !== baseline.value.enabled)
)
const conflict = computed(
  () => !!baseline.value && selected.value?.revision !== baseline.value.revision
)
const sum = (field: string) =>
  data.value?.agents.reduce((n: number, a: any) => n + Number(a[field] || 0), 0) || 0
const enabledCount = computed(() => data.value?.agents.filter((a: any) => a.enabled).length || 0),
  runningCount = computed(() => sum('running')),
  callsCount = computed(() => sum('callsToday')),
  tokensCount = computed(() => sum('tokensToday')),
  cacheCount = computed(() => sum('cachedToday'))
const rpc = (channel: string, payload?: unknown) => electron.ipcRenderer.invoke(channel, payload)
function setEditor() {
  if (!selected.value) return
  baseline.value = { ...selected.value }
  draftPrompt.value = selected.value.prompt
  draftEnabled.value = selected.value.enabled
  history.value = null
}
async function allowDiscard() {
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm('当前提示词尚未保存，是否放弃本次修改？', '保留草稿', {
      confirmButtonText: '放弃修改',
      cancelButtonText: '继续编辑',
      type: 'warning'
    })
    return true
  } catch {
    return false
  }
}
async function choose(id: string) {
  if (id === selectedId.value) return
  if (!(await allowDiscard())) return
  selectedId.value = id
  setEditor()
}
function useHistory(v: any) { draftPrompt.value = v.prompt; draftEnabled.value = v.enabled }
function changePage(value: number) { page.value = value; void loadCalls() }
async function loadCalls() {
  try {
    calls.value = await rpc('career-agent-calls', { page: page.value, agentId: callFilter.value })
    return true
  } catch (e) {
    error.value = String(e)
    return false
  }
}
async function refresh() {
  if (loading.value) return
  loading.value = true
  try {
    const next = await rpc('career-agents-load')
    const preserve = dirty.value
    data.value = next
    if (!baseline.value || (!preserve && baseline.value.revision !== selected.value?.revision))
      setEditor()
    if (await loadCalls()) error.value = ''
  } catch (e) {
    error.value = String(e)
  } finally {
    loading.value = false
  }
}
async function reloadEditor() {
  if (!(await allowDiscard())) return
  try {
    data.value = await rpc('career-agents-load')
    setEditor()
    error.value = ''
  } catch (e) {
    error.value = String(e)
  }
}
async function save() {
  saving.value = true
  try {
    const saved = await rpc('career-agent-save', {
      id: selectedId.value,
      prompt: draftPrompt.value,
      enabled: draftEnabled.value,
      baseRevision: baseline.value.revision
    })
    baseline.value = { ...baseline.value, ...saved }
    Object.assign(selected.value, saved)
    ElMessage.success('已保存，后续调用使用此配置')
    error.value = ''
    await refresh()
  } catch (e) {
    error.value = String(e)
  } finally {
    saving.value = false
  }
}
async function showHistory() {
  try {
    history.value = await rpc('career-agent-history', { id: selectedId.value })
  } catch (e) {
    error.value = String(e)
  }
}
async function inspectCall(id: string) {
  try {
    detail.value = await rpc('career-agent-call-detail', { id })
    detailOpen.value = true
  } catch (e) {
    error.value = String(e)
  }
}
const formatTime = (value: string) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '默认版本'
const duration = (ms: number) =>
  ms < 1000 ? `${Math.max(0, ms)} ms` : `${Math.round(ms / 1000)} 秒`
const statusLabel = (s: string) =>
  ({
    running: '运行中',
    completed: '模型已返回',
    failed: '调用失败',
    cancelled: '已取消',
    cached: '缓存复用',
    interrupted: '执行中断'
  })[s] || s
let timer: ReturnType<typeof setInterval> | undefined,
  active = false
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
function visibility() {
  if (active && !document.hidden) void refresh()
}
function stop() {
  active = false
  if (timer) clearInterval(timer)
  timer = undefined
  document.removeEventListener('visibilitychange', visibility)
  window.removeEventListener('beforeunload', beforeUnload)
}
onActivated(() => {
  active = true
  void refresh().then(() => { const id=String(route.query.agent||''); if(data.value?.agents.some((a:any)=>a.id===id))void choose(id); if(typeof route.query.call==='string')void inspectCall(route.query.call) })
  void rpc('career-model-settings')
    .then((v) => (model.value = v))
    .catch((e) => (error.value = String(e)))
  timer = setInterval(() => {
    if (!document.hidden) void refresh()
  }, 5000)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('beforeunload', beforeUnload)
})
onDeactivated(stop)
onBeforeUnmount(stop)
onBeforeRouteLeave(allowDiscard)
</script>

<style scoped>
.agents-page {
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  padding: 28px;
  color: var(--el-text-color-primary);
  font-size: 13px;
}
.page-header,
.calls-panel > header,
.editor > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.page-header {
  margin-bottom: 20px;
}
h1 {
  font-size: 28px;
  margin: 10px 0;
}
h2 {
  font-size: 18px;
  margin: 8px 0;
}
h3 {
  font-size: 14px;
  margin: 8px 0;
}
p {
  line-height: 1.7;
  color: var(--el-text-color-secondary);
  margin: 8px 0;
}
small {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.page-header > div > small {
  letter-spacing: 1.8px;
  color: var(--el-color-primary);
}
.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin: 20px 0;
}
.metrics article,
.editor,
.calls-panel,
.deterministic {
  background: var(--atlas-panel);
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  padding: 20px;
}
.metrics span {
  color: var(--el-text-color-secondary);
}
.metrics strong {
  font-size: 30px;
  display: block;
  margin-top: 10px;
}
.metrics strong small {
  font-size: 16px;
}
.metrics p {
  font-size: 11px;
  margin-bottom: 0;
}
.flow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 20px;
  background: var(--el-color-primary-light-9);
  border-radius: 10px;
}
.flow > span,
.flow button {
  text-align: center;
  font: inherit;
  color: var(--el-text-color-primary);
  min-width: 0;
}
.flow button {
  background: none;
  border: 0;
  cursor: pointer;
}
.flow button:hover {
  color: var(--el-color-primary);
}
.flow small {
  display: block;
  margin-top: 5px;
}
.flow b {
  color: var(--el-text-color-placeholder);
}
.usage-note {
  font-size: 12px;
  margin: 12px 0 20px;
}
.workspace {
  display: grid;
  grid-template-columns: 290px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.agent-list {
  display: grid;
  gap: 10px;
}
.agent-card {
  text-align: left;
  width: 100%;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--atlas-panel);
  padding: 16px;
  cursor: pointer;
  color: inherit;
  font: inherit;
}
.agent-card > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.agent-card p {
  font-size: 12px;
}
.agent-card.selected {
  border-color: var(--el-color-primary);
  box-shadow: inset 3px 0 var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.state {
  display: inline-block;
  font-size: 11px;
  white-space: nowrap;
  border-radius: 6px;
  padding: 4px 8px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
}
.state.enabled,
.state.completed {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}
.state.running {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.state.failed {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
.editor {
  min-width: 0;
}
.version {
  background: var(--el-fill-color-light);
  border-radius: 6px;
  padding: 5px 9px;
}
.editor-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin: 18px 0;
}
.editor-controls label {
  display: flex;
  gap: 8px;
  align-items: center;
}
.unsaved {
  color: var(--el-color-warning);
  font-size: 12px;
}
.saved {
  color: var(--el-color-success);
  font-size: 12px;
}
.prompt-label {
  display: flex;
  justify-content: space-between;
  font-weight: 600;
  margin-bottom: 8px;
}
.prompt-label small {
  font-weight: 400;
}
textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 340px;
  resize: vertical;
  font: inherit;
  line-height: 1.8;
  padding: 16px;
  color: inherit;
  background: var(--atlas-bg);
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
}
textarea:focus {
  outline: 2px solid var(--el-color-primary-light-5);
  border-color: var(--el-color-primary);
}
#prompt-help {
  font-size: 12px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
}
.actions .el-button {
  margin: 0;
}
.contracts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  border-top: 1px solid var(--el-border-color);
  padding-top: 12px;
}
.contracts li {
  line-height: 1.9;
  color: var(--el-text-color-secondary);
}
.contracts ul {
  padding-left: 18px;
}
.constraints,
.history {
  margin-top: 16px;
  border-top: 1px solid var(--el-border-color);
  padding-top: 14px;
}
summary {
  cursor: pointer;
  color: var(--el-color-primary);
  line-height: 1.8;
}
.history details {
  padding: 10px 0;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  line-height: 1.8;
}
.calls-panel {
  margin-top: 24px;
}
.calls-panel header p {
  font-size: 12px;
}
.calls-panel label {
  white-space: nowrap;
}
select {
  padding: 8px;
  margin-left: 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--atlas-panel);
  color: inherit;
}
.table-scroll {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  margin-top: 12px;
}
th {
  font-size: 12px;
  font-weight: 500;
  background: var(--atlas-bg);
  color: var(--el-text-color-secondary);
}
th,
td {
  padding: 12px;
  border-bottom: 1px solid var(--el-border-color);
}
td {
  font-size: 12px;
}
td small {
  display: block;
  margin-top: 5px;
}
.calls-panel footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.calls-panel footer span {
  margin-right: auto;
  color: var(--el-text-color-secondary);
}
.empty {
  padding: 24px;
  text-align: center;
  color: var(--el-text-color-secondary);
}
.deterministic {
  margin-top: 24px;
}
.deterministic > div {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
.deterministic p {
  font-size: 12px;
}
.actual-prompt {
  padding: 18px;
  background: var(--atlas-bg);
  border-radius: 8px;
}
button:focus-visible,
select:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
@media (max-width: 1150px) {
  .workspace {
    grid-template-columns: 250px minmax(0, 1fr);
  }
  .agents-page {
    padding: 20px;
  }
  .metrics article {
    padding: 16px;
  }
  .flow {
    gap: 6px;
    padding: 14px 8px;
  }
}
@media (max-width: 850px) {
  .workspace {
    grid-template-columns: 1fr;
  }
  .agent-list {
    grid-template-columns: 1fr 1fr;
  }
  .metrics {
    grid-template-columns: 1fr 1fr;
  }
  .flow {
    flex-wrap: wrap;
  }
  .deterministic > div {
    grid-template-columns: 1fr;
  }
  .calls-panel > header {
    align-items: start;
    flex-direction: column;
  }
}
@media (max-width: 550px) {
  .agent-list,
  .contracts {
    grid-template-columns: 1fr;
  }
  .agents-page {
    padding: 14px;
  }
}
</style>
