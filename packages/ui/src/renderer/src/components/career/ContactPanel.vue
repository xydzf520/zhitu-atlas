<template>
  <section class="contact-panel" aria-label="自动投递与消息">
    <header>
      <div>
        <h2>{{ compact ? '联系结果与下一步' : '自动投递与消息' }}</h2>
        <p v-if="!compact">岗位匹配 → 个性化招呼 → 发送与核验</p>
      </div>
      <RouterLink v-if="compact" to="/main-layout/CareerDiscovery?contact=1"
        >打开机会发现 →</RouterLink
      ><label
        >统计时间
        <select v-model="period" @change="refresh">
          <option value="today">今天</option>
          <option value="week">最近 7 天</option>
          <option value="all">全部</option>
        </select></label
      >
    </header>
    <p v-if="error" class="contact-error" role="alert">
      {{ error }} <button @click="refresh">重新读取</button>
    </p>
    <template v-if="summary">
      <section v-if="!compact" class="contact-channels" aria-label="自动投递岗位来源">
        <article v-for="(label, key) in discoveryChannelLabels" :key="key" :class="{ chosen: channels.includes(key) }">
          <label class="channel-choice"><input type="checkbox" :checked="channels.includes(key)" :disabled="busy" @change="toggleChannel(key)" /><b>{{ label }}</b></label>
          <p>{{ key === 'targeted' ? '按你保存的产品／AI 岗位关键词搜索，结合完整 JD 筛选适合的机会。' : '读取当前 BOSS 账号实际推荐的岗位，再由 AI 核对 JD 和你的工作经历。' }}</p>
          <ol><li>{{ key === 'targeted' ? '关键词搜索' : 'BOSS 推荐列表' }}</li><li>JD ＋履历匹配</li><li>专属招呼</li><li>发送核验</li></ol>
          <div class="channel-counts"><span>本期任务 <b>{{ channelStats(key).tasks }}</b></span><span>核验成功 <b>{{ channelStats(key).completed }}</b></span><span>待处理 <b>{{ channelStats(key).pending }}</b></span></div>
          <button @click="selectChannelResults(key)">查看这类投递结果 →</button>
        </article>
      </section>
      <p v-if="!compact" class="caption">可单选或同时启用。两路共享每日额度、岗位与招聘者去重；推荐岗位也必须满足目标城市、薪资和经历条件。历史来源不明确的记录单列，不补算成功。</p>
      <div v-if="!compact" class="control-row">
        <label
          >运行模式
          <select
            :value="summary.policy.outbound ? 'contact' : 'discover'"
            @change="setMode(($event.target as HTMLSelectElement).value)"
          >
            <option value="discover">仅挖掘岗位</option>
            <option value="contact">匹配后自动联系</option>
          </select></label
        >
        <label>话术发送方式<select v-model="sendMode" :disabled="busy"><option value="automatic">匹配及事实校验通过后自动发送</option><option value="review">逐条弹窗确认后发送</option></select></label>
        <button class="primary" :disabled="busy || !summary.accountId || !channels.length" @click="start">
          {{ busy ? '处理中…' : summary.policy.outbound ? '启动所选来源并自动联系' : '仅挖掘所选来源' }}
        </button>
        <button :disabled="busy || summary.policy.paused" @click="pauseSend">暂停发送</button>
        <button :disabled="busy" @click="pauseAll(!summary.automationPaused)">
          {{ summary.automationPaused ? '恢复采集与分析' : '暂停全部自动任务' }}
        </button>
        <RouterLink to="/main-layout/CareerTasks">任务中心 →</RouterLink>
      </div>
      <p v-if="!compact" class="caption">招呼只使用已确认经历；相关且已核实的开源项目会附 GitHub 地址。简历附件、薪资承诺、面试确认继续交本人处理。这里的自动投递指开聊和个性化消息，简历附件另计。</p>
      <div class="runtime-row" role="status">
        <span
          :class="[
            'dot',
            { active: !summary.policy.paused && !summary.automationPaused && online }
          ]"
        /><b>{{
          summary.automationPaused
            ? '全部自动任务已暂停'
            : summary.policy.paused
              ? '自动发送已暂停'
              : !summary.policy.outbound
                ? '仅挖掘岗位'
                : !summary.authorized
                  ? '当前账号尚未启动自动联系'
                  : online
                    ? (summary.reviewRequired ? '逐条确认后发送' : '已授权：匹配通过自动发送')
                    : '等待桌面执行器在线'
        }}</b
        ><span>{{ summary.policy.startHour }}:00—{{ summary.policy.endHour }}:00 · 北京时间</span
        ><span>{{
          summary.worker?.error || summary.worker?.verification || '平台实际发送尚待验证'
        }}</span>
      </div>
      <div class="blocking" v-if="summary.awaitingConfirmation">
        <b>{{ summary.awaitingConfirmation }} 段话术等待本人确认</b>
        <span>{{ summary.reviewRequired ? '核对话术后才发送，仍受暂停、时段和额度控制。' : '已切换自动模式的所选来源，将重新核对匹配与事实；其他记录仍等待处理。' }}</span>
        <button @click="openPendingReview()">核对待确认话术</button>
      </div>
      <p v-if="summary.platformQuota?.state === 'exhausted'" class="contact-error" role="alert">{{ summary.platformQuota.reason }}</p>
      <p class="caption">以下是本机发送预算，不代表 BOSS 官方额度。平台当前账号的剩余开聊数仍需核实。</p>
      <div v-if="!compact" class="quota-row">
        <label
          >今日自动消息
          <meter
            :value="summary.quota.used + summary.quota.reserved"
            :max="summary.quota.limit"
          /><b
            >已用 {{ summary.quota.used }} · 预留 {{ summary.quota.reserved }} · 剩余
            {{ summary.quota.remaining }} / {{ summary.quota.limit }}</b
          ></label
        ><label
          >今日首次联系
          <meter
            :value="summary.quota.firstUsed + summary.quota.firstReserved"
            :max="summary.quota.firstLimit || 1"
          /><b
            >已用 {{ summary.quota.firstUsed }} · 预留 {{ summary.quota.firstReserved }} · 剩余
            {{ summary.quota.firstRemaining }} / {{ summary.quota.firstLimit }}</b
          ></label
        >
      </div>
      <div
        v-if="summary.evidence.confirmed < summary.evidence.total || !summary.evidence.total"
        class="blocking"
      >
        <b>经历已确认 {{ summary.evidence.confirmed }} / {{ summary.evidence.total }}</b
        ><span>只有已确认的相关经历才能用于自动介绍；学历和必要资历也需逐项核对。</span
        ><RouterLink to="/main-layout/CareerWorkspace?tab=profile">核实资料 →</RouterLink>
      </div>
      <div class="contact-metrics">
        <button v-for="m in metrics" :key="m.key" @click="selectResult(m.filter)">
          <span>{{ m.label }}</span
          ><strong>{{ summary.counts[m.key] ?? 0 }}</strong
          ><small>{{ m.note }}</small>
        </button>
      </div>
      <p class="caption">
        核验成功关联 {{ summary.counts.completed }} 个岗位 ·
        {{ summary.counts.recruiters }} 名招聘者 · {{ summary.counts.companies }} 家已识别企业<span
          v-if="summary.counts.unknownCompanies"
        >
          · 另有 {{ summary.counts.unknownCompanies }} 条企业身份待核实</span
        >。已读取简历发送凭据 {{ summary.counts.resumeReceipts }} 条；不代表完整历史。
      </p>
      <details class="contact-detail"><summary>查看联系漏斗与统计口径</summary>
      <div class="contact-funnel" aria-label="同批联系任务进度">
        <button v-for="step in funnel" :key="step.label" @click="selectResult(step.filter)">
          <b>{{ step.count }}</b
          ><span>{{ step.label }}</span
          ><svg viewBox="0 0 100 5" role="img" :aria-label="step.label + ' ' + step.count + ' 个'">
            <rect width="100" height="5" fill="#e9eef5" />
            <rect
              :width="summary.counts.cohort ? (step.count / summary.counts.cohort) * 100 : 0"
              height="5"
              fill="#356ae6"
            />
          </svg>
        </button>
      </div>
      <p class="caption">
        {{ summary.cohortNote }} 已开聊不代表定制说明已发出；附件简历投递单独核实。
      </p>
      </details>
      <details v-if="!compact" class="source-summary">
        <summary>岗位采集与重复处理</summary>
        <p>
          记录
          {{ Object.values(summary.sources).reduce((n: any, v: any) => n + v, 0) }} 条有效来源观察 ·
          新增 {{ summary.sources.new || 0 }} · 更新 {{ summary.sources.updated || 0 }} · 重复
          {{ summary.sources.duplicate || 0 }}。同一来源、同一轮、同一内容的重复轮询不累加。
        </p>
      </details>
      <div v-if="summary.blockers.length" class="blocker-list">
        <button v-for="r in summary.blockers" :key="r.reason" @click="selectResult('review')">
          <span>{{ r.reason }}</span
          ><b>{{ r.count }}</b>
        </button>
      </div>
      <details v-if="!compact" class="contact-detail" :open="resultsOpen" @toggle="resultsOpen = ($event.target as HTMLDetailsElement).open">
        <summary>执行过程与结果 · {{ results?.total || 0 }} 个任务</summary>
        <div class="result-heading">
          <h3>执行过程与结果</h3>
          <select v-model="resultChannel" aria-label="投递来源筛选" @change="resetResults"><option value="all">全部来源</option><option v-for="(label, key) in discoveryChannelLabels" :key="key" :value="key">{{ label }}</option><option value="other">其他／历史来源待核实</option></select>
          <select
            v-model="filter"
            aria-label="联系结果筛选"
            @change="resetResults"
          >
            <option value="all">全部结果</option>
            <option value="pending">待联系（当前库存）</option>
            <option value="opened">已开聊（包括已完成）</option>
            <option value="replied">收到文本回复</option>
            <option value="interviews">推进面试／Offer</option>
            <option v-for="(label, key) in contactStates" :key="key" :value="key">
              {{ label }}
            </option></select
          ><input
            v-model="query"
            placeholder="搜索公司、岗位"
            aria-label="搜索联系记录"
            @keyup.enter="resetResults"
          /><button
            @click="resetResults"
          >
            搜索
          </button>
        </div>
        <p v-if="!results?.items?.length" class="empty">
          还没有{{
            filter === 'all' ? '联系' : (contactStates[filter] || '对应')
          }}记录。匹配通过后才进入执行队列；待核实原因请查看岗位的条件矩阵。
        </p>
        <div v-else class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>企业／岗位／招聘者</th>
                <th>阶段与原因</th>
                <th>时间与核验</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in results.items" :key="r.id">
                <td>
                  <b>{{ r.body.job.companyName }}</b>
                  <p>{{ r.body.job.jobName }}</p>
                  <small>{{ r.body.job.bossName || '招聘者姓名待补' }} · {{ discoveryChannelLabels[r.body.channels?.[0] as keyof typeof discoveryChannelLabels] || '历史来源待核实' }}</small>
                </td>
                <td>
                  <span :class="['stage', r.state]">{{ contactStates[r.state] || r.state }}</span>
                  <p>{{ r.body.reason }}</p>
                  <small v-if="r.body.nextAt">下一可执行时间：{{ time(r.body.nextAt) }}</small>
                </td>
                <td>
                  {{ time(r.updated_at) }}
                  <p>
                    {{
                      r.state === 'completed'
                        ? '平台消息回读'
                        : r.state === 'manual'
                          ? '本人确认'
                          : '尚未核验个性化说明'
                    }}
                  </p>
                  <small v-if="r.body.proof">消息 {{ r.body.proof.messageId }}</small>
                </td>
                <td>
                  <button @click="selected = r">查看内容与依据</button
                  ><button @click="openOpportunity(r)">关联机会</button
                  ><button
                    v-if="['queued', 'awaiting_confirmation', 'ready', 'cooling', 'failed', 'review'].includes(r.state)"
                    @click="act(r, 'cancel')"
                  >
                    取消本任务
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="results?.total" class="pagination">
          <span>{{ results.total }} 个联系任务</span
          ><button
            :disabled="page <= 1"
            @click="changeResultPage(-1)"
          >
            上一页</button
          ><span>{{ page }} / {{ Math.max(1, Math.ceil(results.total / 20)) }}</span
          ><button
            :disabled="page * 20 >= results.total"
            @click="changeResultPage(1)"
          >
            下一页
          </button>
        </div>
      </details>
    </template>
    <p v-else-if="!error" role="status">正在读取自动联系状态…</p>
    <ElDialog
      :model-value="!!selected"
      @update:model-value="
        (v) => {
          if (!v) selected = null
        }
      "
      title="联系内容与结果核验"
      width="min(850px,92vw)"
      class="atlas-contact-dialog"
    >
      <template v-if="selected"
        ><h3>{{ selected.body.job.companyName }} · {{ selected.body.job.jobName }}</h3>
        <p>{{ contactStates[selected.state] }} · {{ selected.body.reason }}</p>
        <h4>个性化匹配说明</h4>
        <blockquote>
          {{ selected.body.greeting?.text || '尚未生成，不会发送通用模板代替。' }}
        </blockquote>
        <section v-if="selected.state === 'awaiting_confirmation'" class="approval-box">
          <p>确认仅针对以上这段话术。平台若必须先发默认招呼，将预留两条额度，并在至少 10 分钟后补充这段说明。</p>
          <label><input type="checkbox" v-model="reviewChecked" />我已核对内容与经历依据，同意使用这段话术联系该招聘者</label>
          <button class="primary" :disabled="busy || !reviewChecked" @click="act(selected, 'approve')">确认话术并排队</button>
          <p>当前{{ summary?.policy.paused ? '发送已暂停；确认后须主动启动联系流程' : '按运行时段和额度执行' }}。需要修改时先取消任务，在沟通中心重新生成、编辑话术。</p>
          <p v-if="error" role="alert" class="contact-error">{{ error }}</p>
        </section>
        <h4>岗位要求与本人经历</h4>
        <table>
          <thead>
            <tr>
              <th>招聘要求</th>
              <th>已确认经历引用</th>
              <th>关联说明</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in selected.body.greeting?.matches || []"
              :key="m.evidenceId + m.requirement"
            >
              <td>{{ m.requirement }}</td>
              <td>{{ m.evidenceQuote }}</td>
              <td>{{ m.relevance }}</td>
            </tr>
          </tbody>
        </table>
        <details v-if="selected.body.defaultProof">
          <summary>平台默认招呼</summary>
          <p>{{ selected.body.defaultProof.text }}</p>
          <small>{{ time(selected.body.defaultProof.sentAt) }}</small>
        </details>
        <p class="caption">
          资料版本 {{ selected.body.profileVersion }} ·
          {{ selected.body.greeting?.model || '等待生成' }}
        </p>
        <div
          class="control-row"
          v-if="['uncertain', 'review'].includes(selected.state) && selected.body.attemptId"
        >
          <button @click="act(selected, 'sent')">确认本次消息已发送</button
          ><button @click="act(selected, 'not-sent')">确认本次消息未发送</button
          ><button @click="act(selected, 'unknown')">仍不确定</button>
        </div>
        <button
          v-if="
            ['failed', 'review', 'cancelled'].includes(selected.state) &&
            (!selected.body.attemptId || selected.body.retryAllowed)
          "
          @click="act(selected, 'retry')"
        >
          使用最新条件重新排队（可能调用 DeepSeek）
        </button></template
      >
    </ElDialog>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, onActivated, onDeactivated, onBeforeUnmount, ref, watch }  from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElDialog, ElMessage } from 'element-plus'
import { discoveryChannelLabels, type DiscoveryChannel } from '../../../../common/discovery'
import { contactStates } from '../../../../common/contact'
const props = defineProps<{ compact?: boolean }>(),
  emit = defineEmits(['changed']),
  router = useRouter(),
  route = useRoute()
const resultsOpen = ref(!!route.query.contact || !!route.query.contactFilter)
const channels = ref<DiscoveryChannel[]>(['targeted', 'recommended']), sendMode = ref('automatic'), resultChannel = ref('all')
let initialized = false
const channelStats = (key: string) => summary.value?.channelStats?.find((s: any) => s.channel === key) || { tasks: 0, completed: 0, pending: 0 }
function toggleChannel(key: DiscoveryChannel) { channels.value = channels.value.includes(key) ? channels.value.filter(c => c !== key) : [...channels.value, key] }
function selectChannelResults(key: string) { resultsOpen.value = true; resultChannel.value = key; filter.value = 'all'; resetResults() }
const reviewChecked = ref(false), reviewSeen = new Set<string>()
const summary = ref<any>(),
  results = ref<any>(),
  selected = ref<any>(),
  period = ref('today'),
  filter = ref(String(route.query.contactFilter || 'all')),
  page = ref(1),
  query = ref(''),
  error = ref(''),
  busy = ref(false)
watch(() => selected.value?.id + ':' + selected.value?.revision, () => { reviewChecked.value = false })
const online = computed(
  () =>
    summary.value?.worker?.accountId === summary.value?.accountId &&
    Date.now() - Date.parse(summary.value?.worker?.at || '') < 30000
)
const metrics = [
  { key: 'queued', label: '待联系', filter: 'pending', note: '当前库存' },
  { key: 'completed', label: '自动联系成功', filter: 'completed', note: '个性化说明平台核验' },
  { key: 'messages', label: '自动消息数', filter: 'messages', note: '默认招呼＋说明＋回复' },
  { key: 'uncertain', label: '结果不确定', filter: 'uncertain', note: '不自动重发' },
  { key: 'manual', label: '人工确认已发送', filter: 'manual', note: '与平台核验分开' },
  { key: 'failed', label: '执行失败', filter: 'failed', note: '查看原因后处理' }
]
const funnel = computed(() =>
  summary.value
    ? [
        { label: '本批联系任务', count: summary.value.counts.cohort, filter: 'all' },
        { label: '已开聊', count: summary.value.counts.opened, filter: 'opened' },
        { label: '匹配说明已核验', count: summary.value.counts.completed, filter: 'completed' },
        { label: '收到文本回复', count: summary.value.counts.replied, filter: 'replied' },
        { label: '推进面试／Offer', count: summary.value.counts.interviews, filter: 'interviews' }
      ]
    : []
)
const time = (v: string) =>
  v ? new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未知'
let timer: ReturnType<typeof setInterval> | undefined,
  active = true,
  loading = false
function resetResults() {
  page.value = 1
  void loadResults()
}
function changeResultPage(delta: number) {
  page.value += delta
  void loadResults()
}
async function loadResults() {
  try {
    results.value = await electron.ipcRenderer.invoke('career-contact-results', {
      period: period.value,
      filter: filter.value,
      page: page.value,
      query: query.value, channel: resultChannel.value
    })
  } catch (e) {
    error.value = String(e)
  }
}
async function refresh() {
  if (loading) return
  loading = true
  error.value = ''
  try {
    summary.value = await electron.ipcRenderer.invoke('career-contact-summary', {
      period: period.value
    })
    if (!initialized) { channels.value = summary.value.channels || ['targeted', 'recommended']; initialized = true }
    if (!props.compact) {
      await loadResults()
      if (!selected.value && sendMode.value === 'review' && summary.value.reviewRequired && summary.value.awaitingConfirmation && active && !document.hidden) await openPendingReview(false)
    }
  } catch (e) {
    error.value = String(e)
  } finally {
    loading = false
  }
}
async function openPendingReview(explicit = true) {
  if (props.compact) { selectResult('awaiting_confirmation'); return }
  try {
    const pending = await electron.ipcRenderer.invoke('career-contact-results', { period: 'all', filter: 'awaiting_confirmation', page: 1 })
    const row = pending.items.find((r: any) => explicit || !reviewSeen.has(r.id + ':' + r.revision))
    if (row) { reviewSeen.add(row.id + ':' + row.revision); selected.value = row }
  } catch (e) { error.value = String(e) }
}
async function operation(fn: () => Promise<any>) {
  busy.value = true
  error.value = ''
  try {
    await fn()
    await refresh()
    emit('changed')
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
function setMode(mode: string) {
  void operation(() =>
    electron.ipcRenderer.invoke('career-tasks-policy', {
      baseRevision: summary.value.policyRevision,
      policy: { outbound: mode === 'contact' }
    })
  )
}
function start() {
  void operation(async () => {
    if (summary.value.policy.outbound)
      await electron.ipcRenderer.invoke('career-discovery-contact-start', {
        accountId: summary.value.accountId,
        controlRevision: summary.value.controlRevision, channels: channels.value, mode: sendMode.value, acknowledged: sendMode.value === 'automatic',
        baseRevision: summary.value.policyRevision
      })
    else {
      if (summary.value.automationPaused)
        await electron.ipcRenderer.invoke('career-automation-pause', { paused: false })
      await electron.ipcRenderer.invoke('career-discovery-start', {
        accountId: summary.value.accountId, channels: channels.value
      })
    }
  })
}
function pauseSend() {
  void operation(() => electron.ipcRenderer.invoke('career-tasks-pause'))
}
function pauseAll(paused: boolean) {
  void operation(() => electron.ipcRenderer.invoke('career-automation-pause', { paused }))
}
function selectResult(value: string) {
  if(value === 'messages') { void router.push('/main-layout/CareerTasks?tab=sending'); return }
  if (props.compact) {
    router.push({
      path: '/main-layout/CareerDiscovery',
      query: { contact: '1', contactFilter: value }
    })
    return
  }
  resultsOpen.value = true
  filter.value = value
  page.value = 1
  void loadResults()
}
async function act(row: any, action: string) {
  await operation(async () => {
    const updated = await electron.ipcRenderer.invoke('career-contact-action', {
      accountId: summary.value.accountId,
      id: row.id,
      revision: row.revision,
      ...(action === 'approve' ? { text: row.body.greeting?.text, confirmed: reviewChecked.value } : {}),
      action
    })
    if (selected.value?.id === row.id) selected.value = updated
    ElMessage.success('联系记录已更新')
  })
}
function openOpportunity(row: any) {
  router.push({
    path: '/main-layout/CareerDashboard',
    query: { view: 'companies', opportunity: `boss:${row.account_id}:job:${row.job_id}` }
  })
}
function begin() {
  active = true
  if (!timer)
    timer = setInterval(
      () => {
        if (active && !document.hidden && !selected.value) void refresh()
      },
      props.compact ? 15000 : 8000
    )
}
function stop() {
  active = false
  if (timer) clearInterval(timer)
  timer = undefined
}
onMounted(() => {
  void refresh()
  begin()
})
onActivated(() => {
  void refresh()
  begin()
})
onDeactivated(stop)
onBeforeUnmount(stop)
</script>
<style scoped>
.contact-detail{border-top:1px solid var(--el-border-color);padding:14px 0}.contact-detail>summary{cursor:pointer;color:var(--el-color-primary);font-weight:600}.contact-detail[open]>summary{margin-bottom:16px}

.contact-channels { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 16px; margin: 20px 0 8px; }
.contact-channels article { padding: 20px; border: 1px solid #dce4ee; border-radius: 12px; background: #f8fafc; }
.contact-channels article.chosen { border-color: #356ae6; background: #f2f6ff; }
.channel-choice { display: flex; align-items: center; gap: 10px; font-size: 16px; }
.channel-choice input { width: 17px; height: 17px; accent-color: #356ae6; }
.contact-channels ol { display: flex; flex-wrap: wrap; padding: 0; list-style: none; gap: 6px; font-size: 12px; color: #526780; }
.contact-channels li + li::before { content: '→'; margin-right: 6px; }
.channel-counts { display: flex; gap: 15px; flex-wrap: wrap; font-size: 12px; margin: 18px 0; }
.channel-counts b { font-size: 20px; color: #26374d; margin-left: 4px; }
@media (max-width: 760px) { .contact-channels { grid-template-columns: 1fr; } }
.contact-panel {
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color, #dce4ee);
  border-radius: 16px;
  padding: 24px;
  margin: 20px 0;
  color: var(--el-text-color-primary, #26374d);
  font: inherit;
}
.contact-panel header,
.control-row,
.runtime-row,
.result-heading,
.pagination {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.contact-panel header {
  justify-content: space-between;
}
.contact-panel h2 {
  font-size: 20px;
  margin: 6px 0;
}
.contact-panel h3 {
  font-size: 16px;
}
.contact-panel p {
  font-size: 13px;
  line-height: 1.75;
  margin: 7px 0;
}
.contact-panel small,
.caption {
  font-size: 12px;
  color: var(--el-text-color-secondary, #718098);
}
.contact-panel select,
.contact-panel input,
.contact-panel button {
  font: inherit;
  font-size: 13px;
  padding: 8px 12px;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color, #dce4ee);
  border-radius: 7px;
  color: inherit;
}
.contact-panel button {
  cursor: pointer;
}
.contact-panel button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.contact-panel button:focus-visible,
.contact-panel a:focus-visible {
  outline: 2px solid #356ae6;
  outline-offset: 3px;
}
.contact-panel a {
  color: #356ae6;
  font-size: 13px;
}
.control-row {
  margin: 16px 0;
}
.contact-panel .primary {
  background: #356ae6;
  color: #fff;
  border-color: #356ae6;
}
.runtime-row {
  font-size: 12px;
  color: #667991;
  margin: 14px 0;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #95a1b4;
}
.dot.active {
  background: #29936f;
}
.quota-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  padding: 18px;
  background: #f5f8fc;
  border-radius: 10px;
  font-size: 12px;
}
.quota-row label {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.quota-row meter {
  width: 100%;
  height: 12px;
  accent-color: #356ae6;
}
.blocking {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin: 16px 0;
  padding: 14px;
  background: #fff8e9;
  border: 1px solid #f0dfb8;
  border-radius: 9px;
  font-size: 13px;
}
.contact-metrics {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin: 18px 0;
}
.contact-metrics button {
  text-align: left;
  padding: 15px;
}
.contact-metrics strong {
  display: block;
  font-size: 27px;
  margin: 7px 0;
}
.contact-metrics small {
  display: block;
  line-height: 1.6;
}
.contact-funnel {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}
.contact-funnel button {
  border: 0;
  background: #f5f8fc;
  display: flex;
  flex-direction: column;
  align-items: start;
  gap: 7px;
}
.contact-funnel b {
  font-size: 22px;
}
.contact-funnel svg {
  width: 100%;
  height: 5px;
}
.caption {
  line-height: 1.8;
}
.source-summary {
  font-size: 13px;
  margin: 15px 0;
}
.source-summary summary {
  cursor: pointer;
}
.blocker-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.blocker-list button {
  display: flex;
  gap: 12px;
  max-width: 100%;
  text-align: left;
}
.result-heading {
  margin: 25px 0 12px;
}
.result-heading h3 {
  margin-right: auto;
}
.table-scroll {
  overflow-x: auto;
}
.contact-panel table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
  text-align: left;
}
.contact-panel th {
  font-size: 12px;
  color: #667991;
  background: #f5f8fc;
}
.contact-panel td,
.contact-panel th {
  padding: 13px 10px;
  vertical-align: top;
  border-bottom: 1px solid #e7edf5;
}
.contact-panel td {
  max-width: 270px;
  overflow-wrap: anywhere;
}
.contact-panel td button {
  margin: 3px;
}
.stage {
  font-size: 12px;
  border-radius: 5px;
  background: #eef3fb;
  padding: 4px 8px;
  display: inline-block;
}
.stage.completed {
  color: #14744f;
  background: #e7f5ec;
}
.stage.uncertain,
.stage.review {
  color: #95661f;
  background: #fff3d9;
}
.pagination {
  justify-content: flex-end;
  margin-top: 16px;
  font-size: 12px;
}
.pagination > span:first-child {
  margin-right: auto;
}
.empty {
  text-align: center;
  padding: 25px;
  color: #78869c;
}
.contact-error {
  color: #ad3c3c;
  background: #fff1f1;
  padding: 12px;
  border-radius: 7px;
}
.contact-panel blockquote {
  margin: 0;
  background: #f2f6fc;
  padding: 20px;
  font-size: 15px;
  line-height: 1.9;
  white-space: pre-wrap;
  border-radius: 9px;
}
@media (max-width: 1200px) {
  .contact-metrics {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 760px) {
  .contact-panel {
    padding: 16px;
  }
  .quota-row {
    grid-template-columns: 1fr;
  }
  .contact-funnel {
    grid-template-columns: repeat(2, 1fr);
  }
  .contact-metrics {
    grid-template-columns: repeat(2, 1fr);
  }
}

.approval-box { margin: 16px 0; padding: 16px; background: #f0f5ff; border: 1px solid #c8d8f8; border-radius: 10px; }
.approval-box label { display: flex; align-items: flex-start; gap: 8px; margin: 12px 0; }
.approval-box input { width: auto; }
.approval-box p { line-height: 1.6; }
</style>
