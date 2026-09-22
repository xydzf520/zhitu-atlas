<template>
  <main class="discovery-page" aria-label="机会发现">
    <header class="discovery-header">
      <div>
        <h1>机会发现</h1>
        <p>搜索岗位、评估匹配与联系结果</p>
      </div>
      <div class="actions">
        <ElButton @click="load()" :loading="loading">更新本地结果</ElButton
        >
      </div>
    </header>
    <nav class="discovery-shortcuts" aria-label="机会发现快速定位">
      <ElButton v-if="data?.recommendations?.length" @click="jumpTo('discovery-recommendations')">看推荐 · {{ data.counts.recommended }}</ElButton>
      <ElButton @click="jumpTo('discovery-pool')">浏览岗位机会池</ElButton>
      <ElButton @click="jumpTo('discovery-contact')">自动投递与结果</ElButton>
    </nav>
    <ExecutionSummary title="岗位发现与联系进度" />
    <div id="discovery-contact" tabindex="-1"><ContactPanel @changed="load()" /></div>
    <section v-if="data?.counts.total" class="panel readiness-summary" aria-label="投递准备情况">
      <b>已归档 {{ data.counts.total }} 个岗位 · 当前可准备联系 {{ data.counts.eligible }} 个</b>
      <p>当前分析 {{ data.counts.analyzed }} 份 · 待分析或更新 {{ data.counts.pending }} 份</p>
      <ElButton @click="setFilter('eligible')">查看可联系岗位</ElButton>
      <ElButton @click="setFilter('pending')">查看待分析岗位</ElButton>
      <details><summary>匹配与联系规则</summary><p>模型、资料或 JD 变更后，旧报告不用于自动联系。查看岗位的初筛清单，可核对薪资、资历、经历和招聘者身份。</p></details>
    </section>
    <p v-if="data?.automationPaused" class="muted">全部自动任务已暂停，可在任务中心恢复。</p>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <section class="discovery-controls panel">
      <div class="control-heading">
        <div>
          <h2>岗位采集</h2>
          <p>
            {{ data?.accountName ? `BOSS · ${data.accountName}` : '等待 BOSS 账号连接' }} · 采集城市 {{ data?.settings?.cities?.join('、') || data?.settings?.city || '待设置' }} ·
            {{ form.minimumMonthlyK ? `期望月薪 ${form.minimumMonthlyK}K 起` : '薪资待设置' }}
          </p>
        </div>
        <span :class="['connection-pill', workerOnline ? 'online' : '']">{{
          workerOnline ? '桌面挖掘器在线' : '等待桌面程序在线'
        }}</span>
      </div>
      <p class="muted">今日已读取 {{ data?.dailyReads?.candidates || 0 }}/{{ form.maxJobs }} 个候选 · 补详情 {{ data?.dailyReads?.details || 0 }}/{{ form.detailLimit }}；重复启动共用预算。</p>
      <div class="schedule-summary">
        <b>{{ form.autoRecommend ? `每天 ${form.recommendTime} 主动推荐` : '主动推荐已关闭' }}</b
        ><span>北京时间 · 程序运行且登录有效时执行；错过时间会在 21:00 前补一次。</span
        ><RouterLink to="/main-layout/CareerBoss">查看 BOSS 连接 →</RouterLink>
      </div>
      <details ref="strategyPanel" class="strategy-settings"><summary>调整岗位方向、城市与筛选策略</summary><CareerPolicyEditor @saved="load()" /></details>
      <div v-if="data?.run" class="run-status" role="status">
        <div>
          <b>{{ runLabels[data.run.state] || data.run.state }}</b>
          <p>{{ data.run.message }}</p>
          <small
            >{{ time(data.run.at) }} · 岗位 {{ data.run.jobIds.length }} · 详情已处理
            {{ data.run.detailIds.length }} · AI 已完成 {{ data.run.analyzedIds.length }}</small
          >
        </div>
        <ElButton v-if="['paused','blocked'].includes(data.run.state)" @click="resume">继续采集与分析</ElButton><ElButton v-if="running" @click="pause">暂停本轮</ElButton
        ><ElButton
          v-if="
            !running &&
            data.run.jobIds.length &&
            (data.run.errors.some((e: any) => e.ai) ||
              ['completed'].includes(data.run.state))
          "
          @click="retryAnalysis"
          >继续本轮 AI 分析</ElButton
        >
      </div>
      <details v-if="data?.run?.errors?.length" class="run-errors">
        <summary>{{ data.run.errors.length }} 项需要处理</summary>
        <ul>
          <li v-for="(item, i) in data.run.errors" :key="i">{{ item.message }}</li>
        </ul>
      </details>
    </section>
    <details class="strategy-settings panel"><summary>AI 搜索策略与调整历史</summary><AdaptiveStrategy @updated="load()" /></details>
    <div class="metric-grid">
      <article>
        <span>待分析岗位</span><b>{{ data?.counts.pending || 0 }}</b>
      </article>
      <article>
        <span>AI 推荐</span><b>{{ data?.counts.recommended || 0 }}</b>
      </article>
      <article>
        <span>条件待核实</span><b>{{ data?.counts.verify || 0 }}</b>
      </article>
      <article>
        <span>已加入跟进</span><b>{{ data?.counts.following || 0 }}</b>
      </article>
    </div>
    <section v-if="data?.recommendations?.length" id="discovery-recommendations" tabindex="-1" class="recommendation-section">
      <div class="section-heading">
        <div>
          <small>RECOMMENDED FOR YOU</small>
          <h2>优先看这几个机会</h2>
        </div>
        <p>仅展示未过期的 AI 推荐，依据与缺口可逐项核对。</p>
      </div>
      <div class="recommendation-grid">
        <article
          v-for="(row, i) in data.recommendations"
          :key="row.job.encryptJobId"
          class="recommendation-card"
        >
          <span class="rec-order">推荐 {{ String(i + 1).padStart(2, '0') }}</span>
          <h3>{{ row.job.jobName }}</h3>
          <p>{{ row.job.companyName }} · {{ row.job.salaryDesc || '薪资待核实' }}</p>
          <p class="rec-reason">
            {{
              (!row.analysisOutdated && row.item.analysis?.analysis?.recommendation?.reason) ||
              row.assessment.reasons[0] ||
              '需要进一步核对岗位要求'
            }}
          </p>
          <span class="status-tag">{{
            row.analyzed && !row.analysisOutdated
              ? `AI · ${recommendationLabels[row.item.analysis?.analysis?.recommendation?.decision] || '已分析'}`
              : '规则初筛，待 AI 分析'
          }}</span
          ><span
            v-if="row.assessment.provisional || row.item.analysis?.provisional"
            class="status-tag warning"
            >经历待本人确认</span
          ><button @click="openDetail(row)">查看推荐依据与下一步 →</button>
        </article>
      </div>
    </section>
    <section id="discovery-pool" tabindex="-1" class="panel candidate-panel">
      <div class="section-heading">
        <div>
          <h2>岗位机会池</h2>
          <p>新发现的岗位先进入这里，加入跟进后同步到企业页面和机会地图。</p>
        </div>
        <ElInput
          v-model="query"
          clearable
          aria-label="搜索机会池"
          placeholder="企业、岗位或地址"
          class="pool-search"
          @keyup.enter="search"
          @clear="search"
        /><ElButton @click="search">筛选</ElButton>
      </div>
      <div class="pool-filters" role="group" aria-label="机会池筛选">
        <button
          v-for="f in filters"
          :key="f.value"
          :aria-pressed="filter === f.value"
          @click="setFilter(f.value)"
        >
          {{ f.label }}
        </button>
      </div>
      <p v-if="loading && !data" class="empty" role="status">正在读取机会池…</p>
      <div v-else-if="!data?.items.length" class="empty">
        <h3>{{ data?.counts.total ? '当前筛选没有岗位' : '还没有新的岗位推荐' }}</h3>
        <p>
          {{
            data?.accountId
              ? '保持桌面程序运行，等待每日主动推荐；也可以立即挖掘一轮。'
              : '请在桌面 BOSS 工作台登录，机会发现会使用同一账号读取岗位。'
          }}
        </p>
        <ElButton v-if="filter !== 'all' && data?.counts.total" @click="setFilter('all')"
          >查看全部岗位</ElButton
        >
      </div>
      <article v-for="row in data?.items" :key="row.job.encryptJobId" class="candidate-row">
        <div class="candidate-main">
          <div class="candidate-title">
            <h3>
              <button @click="openDetail(row)">{{ row.job.jobName }}</button>
            </h3>
            <strong>{{ row.job.salaryDesc || '薪资待核实' }}</strong>
          </div>
          <p>
            {{ row.job.companyName || '企业待补充' }}
            <span>· {{ row.job.address || row.job.cityName || '地点待核实' }}</span>
          </p>
          <div class="tags">
            <span :class="['status-tag', row.assessment.bucket]">{{
              bucketLabels[row.assessment.bucket]
            }}</span
            ><span class="status-tag">{{ statusLabels[row.item.status] }}</span
            ><span v-if="row.analyzed" class="status-tag">{{
              row.analysisOutdated
                ? '分析已过期'
                : `AI · ${recommendationLabels[row.item.analysis?.analysis?.recommendation?.decision] || '已分析'}`
            }}</span
            ><span v-if="row.assessment.provisional" class="status-tag warning"
              >匹配经历待确认</span
            >
          </div>
          <ul class="candidate-reasons">
            <li
              v-for="reason in [
                ...row.assessment.excluded,
                ...(!row.analysisOutdated && row.item.analysis?.analysis?.recommendation
                  ? [row.item.analysis.analysis.recommendation.reason]
                  : []),
                ...row.assessment.missing,
                ...row.assessment.reasons
              ].slice(0, 3)"
              :key="reason"
            >
              {{ reason }}
            </li>
          </ul>
          <small
            >{{ row.item.origins?.join('、') || row.item.origin || 'BOSS 已读取岗位' }} · 最近读取
            {{ time(row.job.observedAt) }}</small
          >
        </div>
        <div class="candidate-actions">
          <small v-if="row.contactTask">已有联系任务：{{ contactStates[row.contactTask.state] || row.contactTask.state }}</small><small v-else-if="row.existingConversation">已有会话，请在沟通中心跟进</small><small>已确认满足 {{ row.contactMatch.satisfied }} 项／待核实 {{ row.contactMatch.pending }} 项</small><span class="status-tag">{{ row.analyzed ? (row.analysisOutdated ? '分析待更新' : '有分析依据') : '待分析' }}</span><ElButton type="primary" plain @click="openDetail(row)">查看分析与行动</ElButton
          ><ElButton v-if="row.item.status === 'following'" @click="goFollow(row)"
            >查看跟进</ElButton
          ><ElButton v-else-if="row.item.status === 'dismissed'" @click="decide(row, 'new')"
            >恢复到机会池</ElButton
          ><ElButton
            v-else
            :loading="workingId === row.job.encryptJobId"
            @click="decide(row, 'following')"
            >加入跟进</ElButton
          >
        </div>
      </article>
      <footer class="pagination">
        <span
          >{{ data?.total || 0 }} 个结果 · 第 {{ data?.page || 1 }} /
          {{ data?.pages || 1 }} 页</span
        ><ElButton :disabled="page <= 1" @click="changePage(-1)">上一页</ElButton
        ><ElButton :disabled="page >= (data?.pages || 1)" @click="changePage(1)">下一页</ElButton>
      </footer>
    </section>
    <ElDialog
      v-model="detailOpen"
      width="min(1040px,calc(100vw - 32px))"
      :title="selected?.job.jobName || '岗位详情'"
      class="discovery-modal"
      destroy-on-close
    >
      <template v-if="selected"
        ><div class="detail-summary">
          <h2>{{ selected.job.companyName }}</h2>
          <p>
            {{ selected.job.salaryDesc || '薪资待核实' }} ·
            {{ selected.job.address || selected.job.cityName || '地点待核实' }}
          </p>
          <div class="tags">
            <span class="status-tag">{{ bucketLabels[selected.assessment.bucket] }}</span
            ><span class="status-tag">{{ selected.analyzed ? '已有分析依据' : '待分析' }}</span>
          </div>
        </div>
        <div class="detail-actions">
          <ElButton
            :type="selected.analyzed && !selected.analysisOutdated ? 'default' : 'primary'"
            :disabled="selected.job.description?.length < 80"
            :loading="analyzing"
            @click="analyze"
            >{{ selected.analyzed ? '重新分析该岗位' : 'DeepSeek 分析为什么适合' }}</ElButton
          ><ElButton
            v-if="selected.item.status !== 'following'"
            :loading="workingId === selected.job.encryptJobId"
            @click="decide(selected, 'following', true)"
            >加入跟进，准备匹配招呼</ElButton
          ><ElButton v-else @click="goFollow(selected, 'greeting')">生成匹配招呼</ElButton
          ><ElButton v-if="selected.contactMatch?.eligible && !selected.existingConversation"
            :loading="analyzing" @click="prepareWording">AI 准备待确认话术</ElButton
          ><ElButton @click="openBoss">BOSS 原始岗位</ElButton
          ><ElButton v-if="selected.item.status === 'new'" @click="decide(selected, 'dismissed')"
            >暂不考虑</ElButton
          >
        </div>
        <p v-if="analyzing" role="status">DeepSeek 正在后台分析 · <RouterLink to="/main-layout/CareerTasks">查看进度或取消</RouterLink></p>
        <p class="muted">手动重新分析会产生一次新的模型调用；有效缓存可直接复用。</p>

        <ExecutionSummary :object-id="selected.job.encryptJobId" title="该岗位的处理进度" />
        <ElAlert v-if="detailError" :title="detailError" type="error" :closable="false" />
        <section v-if="!selected.item.analysis || selected.analysisOutdated || selected.assessment.excluded.length || selected.assessment.missing.length" class="next-action">
          <h3>下一步建议</h3>
          <p>{{ selected.assessment.nextAction }}</p>
          <ul>
            <li
              v-for="r in [...selected.assessment.excluded, ...selected.assessment.missing]"
              :key="r"
            >
              {{ r }}
            </li>
          </ul>
        </section>
        <ElTabs v-model="detailTab"
          ><ElTabPane label="AI 推荐依据" name="analysis"
            ><AnalysisReport
              v-if="selected.item.analysis"
              :result="selected.item.analysis"
              :evidence="data?.evidence || []"
              :outdated="selected.analysisOutdated"
            />
            <div v-else class="empty">
              <h3>还没有这份岗位的 AI 分析</h3>
              <p>
                每日任务会分析重点岗位，也可以点击上方按钮。资料未确认的经历会明确标注，不会当成已验证成果。
              </p>
            </div>
            <p v-if="selected.item.analysisError" class="error">
              {{ selected.item.analysisError }}
            </p></ElTabPane
          ><ElTabPane label="招聘要求与原文" name="jd"
            ><StructuredText
              :source="selected.job.description"
              empty="目前只读取了岗位列表，完整 JD 等待后台补齐。可在 BOSS 打开原始岗位后更新本地结果。" /></ElTabPane
          ><ElTabPane label="初筛与核实清单" name="rule"
            ><h3>自动联系条件矩阵</h3><p>已确认满足 {{ selected.contactMatch?.satisfied || 0 }} 项／待核实 {{ selected.contactMatch?.pending || 0 }} 项</p><table class="match-table"><thead><tr><th>检查项</th><th>状态</th><th>依据／待处理原因</th></tr></thead><tbody><tr v-for="c in selected.contactMatch?.checks || []" :key="c.key+c.reason"><td>{{ c.label }}</td><td>{{ c.status==='met'?'满足':c.status==='gap'?'不符合':'待核实' }}</td><td>{{ c.reason }}</td></tr></tbody></table><h3>关联依据</h3>
            <ul>
              <li v-for="r in selected.assessment.reasons" :key="r">{{ r }}</li>
            </ul>
            <h3>需进一步核实</h3>
            <ul>
              <li v-for="r in selected.assessment.questions" :key="r">{{ r }}</li>
            </ul>
            <p class="muted">初筛仅检查已知条件与关键词，逐项经历依据以分析报告为准。</p></ElTabPane
          ></ElTabs
        >
        <details class="strategy-settings"><summary>反馈推荐质量</summary>
        <div class="detail-actions"><ElButton @click="feedback('interested')">感兴趣</ElButton><ElButton @click="feedback('irrelevant')">不相关</ElButton><ElButton @click="feedback('progressed')">已有推进</ElButton><ElButton @click="feedback('clear')">清除反馈</ElButton><span>{{ selected.feedback?.action ? '已记录你的反馈' : '反馈会用于下一次搜索复盘' }}</span></div>
        </details>
      </template>
    </ElDialog>
  </main>
</template>
<script setup lang="ts">
import { useAITasks } from '../../composables/atlasTasks'
const runAITask = useAITasks()
import { recommendationLabels } from '../../../../common/discovery'
import { computed, inject, onActivated, onDeactivated, onMounted, onBeforeUnmount, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElInput,
  ElTabs,
  ElTabPane,
  ElMessage
} from 'element-plus'
import { contactStates } from '../../../../common/contact'
import ExecutionSummary from '../../components/career/ExecutionSummary.vue'
import ContactPanel from '../../components/career/ContactPanel.vue'
import CareerPolicyEditor from '../../components/career/CareerPolicyEditor.vue'
import AdaptiveStrategy from '../../components/career/AdaptiveStrategy.vue'
import AnalysisReport from '../../components/career/AnalysisReport.vue'
import StructuredText from '../../components/career/StructuredText.vue'
const router = useRouter(),
  route = useRoute(),
  runtime = inject('atlas-runtime', 'desktop'),
  data = ref<any>(),
  form = computed(() => data.value?.settings || {})
const strategyPanel = ref<HTMLDetailsElement>()
const query = ref(String(route.query.query || '')),
  filter = ref(String(route.query.filter || 'new')),
  page = ref(1),
  loading = ref(false),
  error = ref(''),
  workingId = ref(''),
  detailOpen = ref(false),
  selected = ref<any>(),
  detailTab = ref('analysis'),
  detailError = ref(''),
  analyzing = ref(false)
const running = computed(() => ['queued', 'running', 'analyzing'].includes(data.value?.run?.state)),
  workerOnline = computed(
    () =>
      data.value?.worker?.available &&
      data.value?.worker?.accountId === data.value?.accountId &&
      Date.now() - Date.parse(data.value?.worker?.at || '') < 30000
  )
const filters = [
  { value: 'new', label: '待查看' },
  { value: 'recommended', label: 'AI 推荐' },
  { value: 'pending', label: '待分析' },
  { value: 'eligible', label: '匹配通过 · 待联系' },
  { value: 'verify', label: '条件待核实' },
  { value: 'excluded', label: '不符条件' },
  { value: 'following', label: '已跟进' },
  { value: 'dismissed', label: '暂不考虑' },
  { value: 'all', label: '全部' }
]
const bucketLabels: Record<string, string> = {
    priority: '优先了解',
    possible: '可以评估',
    verify: '条件待核实',
    excluded: '不符当前条件'
  },
  statusLabels: Record<string, string> = {
    new: '新机会',
    following: '已加入跟进',
    dismissed: '暂不考虑'
  },
  runLabels: Record<string, string> = {
    queued: '任务已排队',
    running: '正在挖掘',
    analyzing: 'AI 分析中',
    completed: '本轮已结束',
    paused: '已暂停',
    blocked: '需要处理'
  }
const time = (v: string) => (v ? new Date(v).toLocaleString('zh-CN') : '未知')
let requestedJob = ''
let loadingNow = false,
  pendingLoad = false,
  timer: ReturnType<typeof setInterval> | undefined,
  active = true
async function load(background = false) {
  if (loadingNow) { if (!background) pendingLoad = true; return }
  loadingNow = true
  const request = { query: query.value, filter: filter.value, page: page.value }
  if (!background) loading.value = true
  try {
    const next = await electron.ipcRenderer.invoke('career-discovery-list', request)
    if (!active) return
    if (request.query !== query.value || request.filter !== filter.value || request.page !== page.value) { pendingLoad = true; return }
    error.value = ''
    const oldAccount = data.value?.accountId
    data.value = next
    if (typeof route.query.job === 'string' && route.query.job !== requestedJob) {
      const row = [...next.recommendations, ...next.items].find(
        (r: any) => r.job.encryptJobId === route.query.job
      )
      if (row) {
        requestedJob = route.query.job
        openDetail(row)
      }
    }
    page.value = next.page
    if (oldAccount && oldAccount !== next.accountId) {
      detailOpen.value = false
      error.value = '账号已变化，请核对新账号后继续'
    }
    if (selected.value) {
      const current = [...next.items, ...next.recommendations].find(
        (r: any) => r.job.encryptJobId === selected.value.job.encryptJobId
      )
      if (current) selected.value = current
    }
  } catch (e) {
    error.value = String(e)
  } finally {
    loadingNow = false
    loading.value = false
    if (active && pendingLoad) { pendingLoad = false; void load() }
  }
}
async function resume(){try{await electron.ipcRenderer.invoke('career-discovery-resume',{accountId:data.value.accountId,runId:data.value.run.id});await load()}catch(e){error.value=String(e)}}
async function retryAnalysis() {
  error.value = ''
  try {
    await electron.ipcRenderer.invoke('career-discovery-retry-analysis', {
      accountId: data.value.accountId,
      runId: data.value.run.id
    })
    await load()
  } catch (e) {
    error.value = String(e)
  }
}
async function pause() {
  try {
    await electron.ipcRenderer.invoke('career-discovery-pause', {
      accountId: data.value.accountId,
      runId: data.value.run.id
    })
    await load()
  } catch (e) {
    error.value = String(e)
  }
}
function setFilter(value: string) {
  filter.value = value
  page.value = 1
  void load()
}
function jumpTo(id: string) {
  const target = document.getElementById(id)
  target?.focus({ preventScroll: true })
  target?.scrollIntoView({ block: 'start' })
}
function search() {
  page.value = 1
  void load()
}
function changePage(delta: number) {
  page.value += delta
  void load()
}
function openDetail(row: any) {
  selected.value = row
  detailTab.value = row.item.analysis ? 'analysis' : 'jd'
  detailError.value = ''
  detailOpen.value = true
}
async function prepareWording() {
  if (!selected.value || analyzing.value) return
  analyzing.value = true
  detailError.value = ''
  try {
    await runAITask('career-contact-prepare', { accountId: data.value.accountId, jobId: selected.value.job.encryptJobId })
    detailOpen.value = false
    await load()
    ElMessage.success('话术已准备，请在自动投递与消息面板确认；未发送')
  } catch (e) { detailError.value = String(e) }
  finally { analyzing.value = false }
}
async function analyze() {
  if (!selected.value || analyzing.value) return
  analyzing.value = true
  detailError.value = ''
  const target = selected.value.job.encryptJobId
  try {
    await runAITask('career-discovery-analyze', {
      accountId: data.value.accountId,
      jobId: target,
      profileVersion: data.value.profileVersion,
      refresh: !!selected.value.item.analysis
    })
    await load()
    detailTab.value = 'analysis'
  } catch (e) {
    detailError.value = String(e)
  } finally {
    analyzing.value = false
  }
}
async function feedback(action: string) {
  try { await electron.ipcRenderer.invoke('career-recommendation-feedback', { jobId: selected.value.job.encryptJobId, action, reason: '' }); await load(); ElMessage.success('反馈已保存') } catch(e) { detailError.value=String(e) }
}
async function decide(row: any, status: string, open = false) {
  workingId.value = row.job.encryptJobId
  detailError.value = ''
  error.value = ''
  try {
    const result = await electron.ipcRenderer.invoke('career-discovery-decision', {
      accountId: data.value.accountId,
      jobId: row.job.encryptJobId,
      status,
      baseRevision: row.item.revision
    })
    if (status === 'following') {
      ElMessage.success('已加入企业跟进与地图，尚未联系招聘方')
      if (open) {
        detailOpen.value = false
        await router.push({
          path: '/main-layout/CareerDashboard',
          query: { view: 'companies', opportunity: result.opportunityId, section: 'greeting' }
        })
        return
      }
    } else if (selected.value?.job.encryptJobId === row.job.encryptJobId) detailOpen.value = false
    await load()
  } catch (e) {
    error.value = detailError.value = String(e)
  } finally {
    workingId.value = ''
  }
}
function goFollow(row: any, section = 'job') {
  detailOpen.value = false
  router.push({
    path: '/main-layout/CareerDashboard',
    query: { view: 'companies', opportunity: row.opportunityId, section }
  })
}
function openBoss() {
  const url = selected.value.job.sourceUrl
  if (!url) return
  if (runtime === 'desktop') {
    detailOpen.value = false
    router.push({ path: '/main-layout/CareerBoss', query: { url, request: String(Date.now()) } })
  } else window.open(url, '_blank', 'noopener,noreferrer')
}
function begin() {
  active = true
  if (!timer)
    timer = setInterval(() => {
      if (active && !document.hidden) void load(true)
    }, 8000)
}
function stop() {
  active = false
  if (timer) clearInterval(timer)
  timer = undefined
}
onMounted(() => {
  void load()
  begin()
})
onActivated(() => {
  if((route.query.strategy || route.query.settings) && strategyPanel.value) { strategyPanel.value.open=true; strategyPanel.value.scrollIntoView({block:'center'}) }
  if(route.query.query!==undefined)query.value=String(route.query.query)
  if(route.query.filter)filter.value=String(route.query.filter)
  void load(true)
  begin()
})
onDeactivated(stop)
onBeforeUnmount(stop)
</script>
<style scoped>
.discovery-shortcuts{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 20px}.discovery-shortcuts .el-button{margin:0}
.strategy-settings>summary{cursor:pointer;color:var(--el-color-primary);padding:12px 0;font-weight:600}

.match-table{width:100%;border-collapse:collapse;font-size:13px;margin:16px 0}.match-table td,.match-table th{text-align:left;padding:12px;border-bottom:1px solid var(--el-border-color);line-height:1.8;vertical-align:top}
.discovery-page {
  padding: 30px;
  max-width: 1600px;
  margin: auto;
  color: var(--el-text-color-primary);
}
.discovery-header,
.control-heading,
.section-heading,
.actions,
.detail-actions,
.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}
.discovery-header {
  margin-bottom: 24px;
}
.discovery-header small,
.section-heading small {
  letter-spacing: 2px;
  color: var(--el-color-primary);
  font-size: 11px;
  font-weight: 600;
}
h1 {
  font-size: 28px;
  margin: 8px 0;
}
h2 {
  font-size: 18px;
  margin: 0 0 8px;
}
h3 {
  font-size: 16px;
  margin: 0 0 10px;
}
p {
  font-size: 14px;
  line-height: 1.8;
  margin: 6px 0;
}
small,
.muted,
.section-heading p {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.8;
}
.panel {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 14px;
  padding: 24px;
  margin: 20px 0;
}
.control-heading p {
  color: var(--el-text-color-secondary);
}
.connection-pill,
.status-tag {
  display: inline-block;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  font-size: 12px;
  padding: 4px 9px;
  color: var(--el-text-color-secondary);
}
.connection-pill.online,
.status-tag.priority {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success-dark-2);
}
.status-tag.warning,
.status-tag.verify {
  color: var(--el-color-warning-dark-2);
  background: var(--el-color-warning-light-9);
}
.status-tag.excluded {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}
.schedule-summary {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 16px;
  padding: 16px;
  background: var(--el-color-primary-light-9);
  border-radius: 9px;
  font-size: 13px;
}
.schedule-summary span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.schedule-summary a {
  color: var(--el-color-primary);
}
summary {
  cursor: pointer;
  color: var(--el-color-primary);
  font-size: 13px;
}
.search-settings {
  margin-top: 20px;
}
.settings-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
  margin: 18px 0;
}
.settings-grid label {
  display: flex;
  flex-direction: column;
  gap: 9px;
  font-size: 13px;
}
.settings-grid .full {
  grid-column: 1/-1;
}
.settings-grid .schedule-toggle {
  flex-direction: row;
  align-items: center;
  grid-column: span 2;
}
.settings-grid input[type='time'] {
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 7px;
  font: inherit;
}
.actions,
.detail-actions {
  justify-content: flex-start;
}
.run-status {
  margin-top: 18px;
  border-top: 1px solid var(--el-border-color);
  padding-top: 18px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.run-status b {
  font-size: 13px;
}
.run-status p {
  font-size: 13px;
}
.run-errors {
  margin-top: 14px;
  font-size: 13px;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.metric-grid article {
  padding: 18px 22px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
}
.metric-grid span {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.metric-grid b {
  display: block;
  font-size: 30px;
  margin-top: 8px;
}
.recommendation-section {
  margin: 28px 0;
}
.recommendation-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 16px;
}
.recommendation-card {
  padding: 22px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-color-primary-light-7);
  border-top: 3px solid var(--el-color-primary);
  border-radius: 12px;
}
.rec-order {
  font-size: 12px;
  color: var(--el-color-primary);
}
.recommendation-card h3 {
  margin-top: 12px;
  line-height: 1.6;
}
.rec-reason {
  font-size: 13px;
  min-height: 45px;
  color: var(--el-text-color-secondary);
}
.recommendation-card button {
  display: block;
  border: 0;
  background: transparent;
  color: var(--el-color-primary);
  cursor: pointer;
  padding: 0;
  margin-top: 18px;
  font: inherit;
  font-size: 13px;
}
.pool-search {
  max-width: 260px;
}
.pool-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 22px 0;
}
.pool-filters button {
  border: 1px solid var(--el-border-color);
  border-radius: 7px;
  background: var(--el-bg-color);
  padding: 8px 12px;
  color: var(--el-text-color-secondary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.pool-filters button[aria-pressed='true'] {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.candidate-row {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  border-top: 1px solid var(--el-border-color-lighter);
  padding: 24px 0;
}
.candidate-main {
  min-width: 0;
  flex: 1;
}
.candidate-title {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 15px;
}
.candidate-title h3 {
  margin: 0;
  line-height: 1.6;
}
.candidate-title button {
  font: inherit;
  color: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.candidate-title strong {
  white-space: nowrap;
  color: var(--el-color-primary);
  font-size: 16px;
}
.candidate-main p span {
  color: var(--el-text-color-secondary);
}
.tags {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  margin: 10px 0;
}
.candidate-reasons {
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
  margin: 10px 0;
}
.candidate-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: stretch;
  min-width: 145px;
}
.candidate-actions b {
  font-size: 24px;
  color: var(--el-color-primary);
  text-align: right;
}
.candidate-actions small {
  margin-left: 5px;
  font-weight: normal;
}
.candidate-actions .el-button + .el-button {
  margin-left: 0;
}
.empty {
  padding: 35px 20px;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 14px;
  line-height: 1.8;
}
.pagination {
  justify-content: flex-end;
  border-top: 1px solid var(--el-border-color);
  padding-top: 18px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.pagination span {
  margin-right: auto;
}
.detail-summary {
  margin-bottom: 18px;
}
.detail-actions {
  margin: 16px 0;
}
.next-action {
  background: var(--el-color-primary-light-9);
  padding: 16px;
  border-radius: 9px;
  margin: 20px 0;
}
.next-action h3 {
  font-size: 14px;
}
.next-action p,
.next-action ul {
  font-size: 13px;
}
.error {
  color: var(--el-color-danger);
}
@media (max-width: 1150px) {
  .recommendation-grid {
    grid-template-columns: 1fr;
  }
  .settings-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .discovery-page {
    padding: 22px;
  }
  .candidate-title {
    display: block;
  }
  .candidate-title strong {
    display: block;
    margin-top: 6px;
  }
}
@media (max-width: 700px) {
  .metric-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .candidate-row {
    flex-direction: column;
  }
  .candidate-actions {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }
  .candidate-actions b {
    margin-right: auto;
  }
  .panel {
    padding: 18px;
  }
  .settings-grid {
    grid-template-columns: 1fr;
  }
  .settings-grid .schedule-toggle {
    grid-column: auto;
  }
}
</style>

<style scoped>
</style>
