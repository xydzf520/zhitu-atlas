<template>
  <section class="boss-inbox panel" :class="{ compact }" aria-label="会话沟通">
    <header class="inbox-heading">
      <div>
        <h2>{{ compact ? '先处理有回应的机会' : '联系人与会话' }}</h2>
        <p class="muted">
          {{ data?.counts?.all ?? 0 }} 位联系人 ·
          {{ data?.coverage?.messages ?? 0 }} 条已同步消息<span v-if="!compact">
            · 仅展示已读取范围</span
          >
        </p>
      </div>
      <button class="text-button" :disabled="loading" @click="refreshMessages">
        {{ loading ? '读取中…' : '更新本地记录' }}
      </button>
    </header>
    <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
    <div :class="{ 'inbox-workspace': !compact }">
      <section class="contact-column" aria-label="联系人列表">
        <div v-if="!compact" class="inbox-filters">
          <input
            v-model="query"
            placeholder="搜索企业、联系人或消息"
            aria-label="搜索同步会话"
            @input="searchSoon"
          />
          <select v-model="filter" aria-label="筛选沟通状态" @change="filterChanged">
            <option v-for="f in filters" :key="f[0]" :value="f[0]">
              {{ f[1] }} · {{ data?.counts?.[f[0]] ?? 0 }}
            </option>
          </select>
          <small v-if="filter === 'attention'"
            >Atlas 提醒与 BOSS 未读分别记录，查看提醒不会把平台消息标记已读。</small
          >
        </div>
        <div class="inbox-list">
          <button
            v-for="c in compact ? (data?.items || []).slice(0, 3) : data?.items || []"
            :key="c.bossId"
            class="conversation-row"
            :aria-pressed="selected?.bossId === c.bossId"
            @click="open(c)"
          >
            <span class="conversation-main"
              ><strong>{{ c.companyName || c.bossName || '企业待补充' }}</strong
              ><small>{{ c.bossName || '联系人待补充' }} · {{ c.jobName || '职位待补充' }}</small
              ><span class="last-text">{{ c.lastText || '消息正文待补齐' }}</span></span
            >
            <span class="conversation-state" :class="c.bucket"
              ><b>{{ c.label }}</b
              ><small>{{ shortTime(c.lastMessageAt) }}</small></span
            >
            <span v-if="c.unreadCount || c.atlasUnreadCount" class="unread-hint"
              ><span v-if="c.unreadCount">BOSS 未读 {{ c.unreadCount }}</span
              ><span v-if="c.atlasUnreadCount">Atlas 新提醒</span></span
            >
          </button>
          <div v-if="!data?.items?.length" class="empty">
            <b>{{
              loading
                ? '正在读取联系人…'
                : query || filter !== 'all'
                  ? '没有符合筛选的会话'
                  : '还没有同步到联系人'
            }}</b>
            <p v-if="!loading">
              {{
                query || filter !== 'all'
                  ? '可以清除搜索或切回全部联系人。'
                  : '在桌面 BOSS 工作台打开消息页后，同步已加载的联系人。'
              }}
            </p>
            <button v-if="!loading && (query || filter !== 'all')" @click="clearFilter">
              查看全部
            </button>
          </div>
        </div>
        <footer class="contact-pagination">
          <template v-if="compact"
            ><span>重要事项由你确认</span
            ><button class="text-button" @click="emit('all')">全部沟通 →</button></template
          ><template v-else
            ><span>{{ data?.total || 0 }} 人 · {{ data?.page || 1 }}/{{ pages }} 页</span
            ><button
              :disabled="loading || page <= 1"
              aria-label="上一页联系人"
              @click="changePage(-1)"
            >
              ‹</button
            ><button
              :disabled="loading || page >= pages"
              aria-label="下一页联系人"
              @click="changePage(1)"
            >
              ›
            </button></template
          >
        </footer>
      </section>
      <component
        :is="compact ? ElDialog : 'section'"
        v-if="selected"
        :class="{ 'conversation-panel': !compact }"
        :model-value="!!selected"
        :title="selected.companyName || selected.bossName || '会话记录'"
        width="min(800px, calc(100vw - 32px))"
        :close-on-click-modal="false"
        @close="close"
      >
        <p
          v-if="!compact && data && !data.items?.some((c: any) => c.bossId === selected.bossId)"
          class="outside-filter"
        >
          当前会话不在左侧筛选结果中，草稿仍保留。
        </p>
        <header class="conversation-heading">
          <div>
            <h3>{{ selected.companyName || '企业待补充' }}</h3>
            <p class="muted">
              {{ selected.bossName || '联系人待补充' }} · {{ selected.jobName || '职位待补充' }}
            </p>
          </div>
          <CompanyResearch :account-id="selected.accountId" :boss-id="selected.bossId" :conversation="detail" :active="active" />
          <span class="state-tag" :class="selected.bucket">{{ selected.label || '待核实' }}</span>
        </header>
        <ExecutionSummary v-if="!compact" :object-id="selected.bossId" :active="active" title="本会话的 Agent 工作" />
        <p v-if="detailError" role="alert" class="error-banner">
          读取未完成：{{ detailError }} <button @click="readDetail()">重试</button>
        </p>
        <div v-if="compact" class="compact-jobs">
          <button
            v-for="j in detail?.jobs || []"
            :key="j.encryptJobId"
            @click="goOpportunity(j.encryptJobId)"
          >
            {{ j.jobName || '岗位待补充' }} · 查看匹配 →
          </button>
        </div>
        <div class="message-toolbar">
          <span>{{ detailLoading ? '正在读取…' : `${detail?.total || 0} 条已采集消息` }}</span>
          <div>
            <button :disabled="detailLoading || messagePage <= 1" @click="changeMessagePage(-1)">
              更新</button
            ><button
              :disabled="detailLoading || messagePage >= Math.ceil((detail?.total || 0) / 50)"
              @click="changeMessagePage(1)"
            >
              更早
            </button>
          </div>
        </div>
        <div ref="timeline" class="timeline" tabindex="0" aria-label="已同步聊天记录">
          <p class="history-scope">
            {{ messagePage > 1 ? `第 ${messagePage} 页历史消息` : '当前已读取的最新消息' }} ·
            完整历史尚未验证
          </p>
          <article v-for="m in detail?.messages || []" :key="m.id" :class="m.direction">
            <small
              >{{ m.direction === 'sent' ? '我' : selected.bossName || '招聘方' }} ·
              {{ time(m.sentAt) }}{{ m.direction === 'sent' && m.read ? ' · 平台已读' : '' }}</small
            >
            <p>{{ m.text || messageLabel(m.type) }}</p>
            <small v-if="m.type !== 'text'" class="message-kind">{{ messageLabel(m.type) }}</small>
          </article>
          <div v-if="detail && !detail.messages.length" class="empty">
            <b>正文尚未读取</b>
            <p>{{ detail.body?.autoReadReason || '请在 BOSS 中打开该会话，等待正文同步。' }}</p>
          </div>
        </div>
        <section v-if="!compact" class="draft-composer" aria-label="AI 回复草稿">
          <div class="draft-heading">
            <strong>AI 话术与回复</strong><span>仅保存建议，不会自动发送</span>
          </div>
          <div class="draft-modes" role="group" aria-label="AI 话术类型">
            <button :aria-pressed="composerMode === 'pitch'" @click="composerMode = 'pitch'">
              岗位匹配话术</button
            ><button :aria-pressed="composerMode === 'reply'" @click="composerMode = 'reply'">
              回复对方 / 跟进
            </button>
          </div>
          <ConversationPitch
            v-show="composerMode === 'pitch'"
            :account-id="selected.accountId"
            :boss-id="selected.bossId"
            :jobs="detail?.jobs || []"
            :conversation="detail"
            :disabled="detailLoading || messagePage > 1"
            :active="active !== false && composerMode === 'pitch'"
          />
          <div v-show="composerMode === 'reply'" class="regular-reply">
            <div class="draft-actions">
              <button :disabled="!canSuggest || aiBusy" @click="suggest(false)">
                {{ aiBusy ? 'AI 生成中…' : 'AI 起草回复' }}</button
              ><button :disabled="!canSuggest || aiBusy" @click="suggest(true)">起草主动跟进</button
              ><RouterLink v-if="aiBusy" to="/main-layout/CareerTasks">查看任务</RouterLink>
            </div>
            <p v-if="!canSuggest" class="muted">
              {{
                messagePage > 1
                  ? '正在查看历史消息，请回到最新一页再生成回复。'
                  : '读取到对方的文本消息后，可以生成有上下文的建议。'
              }}
            </p>
            <p v-if="draftError" role="alert" class="draft-feedback">{{ draftError }}</p>
            <p v-if="draftStale" class="draft-feedback">
              会话已有新消息，这份草稿基于较早上下文；请核对后使用。
            </p>
            <textarea
              v-if="draft?.text"
              v-model="draft.text"
              aria-label="编辑当前会话草稿"
              rows="3"
              maxlength="1500"
            />
            <details v-if="draft?.reason" class="draft-reason">
              <summary>查看建议依据</summary>
              <p>{{ draft.reason }}</p>
            </details>
            <AiDraftReview
              v-if="draft?.text"
              :key="selectedKey"
              v-model="draft.text"
              v-model:confirmation="draft.confirmation"
              :basis="JSON.stringify([selectedKey, draft.context, contextKey])"
              :request-open="draft.reviewPending"
              @opened="draft.reviewPending = false"
              :active="active !== false && composerMode === 'reply'"
              :available="canSuggest && !aiBusy && !draftStale"
              disabled-reason="请返回最新消息并重新核对会话；旧草稿需要重新生成。"
              :context="selected.bossName || '当前招聘者'"
              title="确认回复与跟进话术"
              :verify="verifyReplyDraft"
            >
              <p>{{ draft.reason || '结合当前会话生成，请核实个人经历与重要事项。' }}</p>
            </AiDraftReview>
          </div>
        </section>
      </component>
      <section v-else-if="!compact" class="conversation-panel empty selection-empty">
        <b>选择一个会话开始处理</b>
        <p>左侧按重要事项、待回复和等待对方排列。<br />消息内容和回复建议会显示在这里。</p>
      </section>
      <aside v-if="!compact" class="assistant-column" aria-label="会话下一步">
        <h3>这条会话怎么处理</h3>
        <template v-if="selected">
          <div class="next-action" :class="selected.bucket">
            <span class="eyebrow">当前状态</span><strong>{{ selected.label || '待核实' }}</strong>
            <p>{{ selected.reason || '先核对消息正文与关联岗位，再决定下一步。' }}</p>
            <button v-if="pendingCount" @click="emit('review', selected.bossId)">
              处理 {{ pendingCount }} 条待确认 →</button
            ><button v-else @click="emit('boss')">打开 BOSS 消息页 ↗</button>
          </div>
          <h4>
            关联岗位 <span>{{ detail?.jobs?.length || 0 }}</span>
          </h4>
          <button
            v-for="j in detail?.jobs || []"
            :key="j.encryptJobId"
            class="linked-job"
            @click="goOpportunity(j.encryptJobId)"
          >
            <b>{{ j.jobName || '岗位待补充' }}</b
            ><span>{{ j.salaryDesc || '薪资待核实' }}</span
            ><small>{{ j.address || j.cityName || '地址待补充' }}</small
            ><span>查看岗位与匹配 →</span>
          </button>
          <p v-if="!detail?.jobs?.length" class="muted">
            暂无可靠的关联岗位。打开 BOSS 会话中的职位卡片后可补充。
          </p>
          <div class="action-guide">
            <h4>{{ guide.title }}</h4>
            <p>{{ guide.reason }}</p>
            <ol>
              <li v-for="step in guide.steps" :key="step">{{ step }}</li>
            </ol>
            <button v-if="guide.action === 'reply'" @click="composerMode = 'reply'">准备回复草稿</button>
            <p>薪资、面试、简历附件需本人确认。生成或复制草稿不会发送消息。</p>
          </div>
        </template>
        <p v-else class="muted">选中联系人后，展示对应的处理原因、岗位和下一步。</p>
      </aside>
    </div>
    <details v-if="!compact && metrics" class="inbox-insights">
      <summary>沟通复盘 · 近 30 天已采集样本</summary>
      <div class="metrics">
        <span
          >发出文本的会话 <b>{{ metrics.outboundConversations ?? 0 }}</b></span
        ><span
          >随后有文本回应 <b>{{ metrics.textReplyConversations ?? 0 }}</b></span
        ><span
          >样本回应率
          <b>{{ metrics.textReplyRate == null ? '待积累' : metrics.textReplyRate + '%' }}</b></span
        >
      </div>
      <p class="muted">{{ metrics.definition }}</p>
    </details>
  </section>
</template>
<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  onActivated,
  onDeactivated,
  watch,
  nextTick
} from 'vue'
import { useRoute } from 'vue-router'
import { ElDialog } from 'element-plus'
import AiDraftReview from './AiDraftReview.vue'
import ConversationPitch from './ConversationPitch.vue'
import CompanyResearch from './CompanyResearch.vue'
import ExecutionSummary from './ExecutionSummary.vue'
import { useAITasks } from '../../composables/atlasTasks'
import { conversationPriority } from '../../../../common/boss-sync'
import { conversationGuide } from '../../../../common/hiring-guide'
const runAITask = useAITasks()
const composerMode = ref('pitch')
const props = defineProps<{
  compact?: boolean
  active?: boolean
  pendingByConversation?: Record<string, number>
}>()
const emit = defineEmits<{
  (e: 'all'): void
  (e: 'opportunity', id: string): void
  (e: 'coverage', value: any): void
  (e: 'review', id: string): void
  (e: 'boss'): void
}>()
const route = useRoute()
let requestedConversation = ''
const data = ref<any>(),
  metrics = ref<any>(),
  loading = ref(false),
  error = ref(''),
  query = ref(''),
  filter = ref('all'),
  page = ref(1),
  selected = ref<any>(),
  detail = ref<any>(),
  detailLoading = ref(false),
  detailError = ref(''),
  messagePage = ref(1),
  timeline = ref<HTMLElement>()
type Draft = {
  text: string
  reason?: string
  context?: string
  profileVersion?: string
  confirmation?: string
  reviewPending?: boolean
}
const draftStore = ref<Record<string, Draft>>({}),
  busy = ref<Record<string, boolean>>({}),
  draftErrors = ref<Record<string, string>>({})
try {
  const stored = JSON.parse(sessionStorage.getItem('atlas-conversation-drafts') || '{}')
  for (const [key, value] of Object.entries(stored))
    if (value && typeof (value as Draft).text === 'string') draftStore.value[key] = value as Draft
} catch {}
watch(
  draftStore,
  (value) => {
    try {
      sessionStorage.setItem('atlas-conversation-drafts', JSON.stringify(value))
    } catch {
      if (selectedKey.value)
        draftErrors.value[selectedKey.value] = '浏览器暂存不可用，请复制草稿后再离开。'
    }
  },
  { deep: true }
)
const keyOf = (c: any) => (c?.accountId && c?.bossId ? JSON.stringify([c.accountId, c.bossId]) : '')
const selectedKey = computed(() => keyOf(selected.value))
const draft = computed(() => draftStore.value[selectedKey.value])
const draftError = computed(() => draftErrors.value[selectedKey.value] || '')
const aiBusy = computed(() => !!busy.value[selectedKey.value])
const pendingCount = computed(() => props.pendingByConversation?.[selectedKey.value] || 0)
const guide = computed(() => conversationGuide(selected.value, detail.value?.messages || [], messagePage.value === 1 && !detailLoading.value && !detailError.value, pendingCount.value))
const latestIncoming = computed(() =>
  [...(detail.value?.messages || [])]
    .reverse()
    .find((m: any) => m.direction === 'received' && m.type === 'text' && m.text)
)
const contextKey = computed(() =>
  JSON.stringify((detail.value?.messages || []).map((m: any) => [m.id, m.text, m.direction]))
)
const canSuggest = computed(
  () =>
    !!latestIncoming.value &&
    messagePage.value === 1 &&
    !detailLoading.value &&
    !detailError.value &&
    !!selectedKey.value
)
const draftStale = computed(
  () =>
    !!draft.value?.context &&
    !!detail.value &&
    messagePage.value === 1 &&
    draft.value.context !== contextKey.value
)
async function suggest(followup = false) {
  if (!canSuggest.value || aiBusy.value) return
  const key = selectedKey.value,
    initialText = draftStore.value[key]?.text,
    context = contextKey.value,
    c = selected.value
  busy.value[key] = true
  draftErrors.value[key] = ''
  try {
    const result = await runAITask(followup ? 'career-followup-draft' : 'career-reply-draft', {
      incoming: latestIncoming.value.text,
      messageId: latestIncoming.value.id,
      bossId: c.bossId,
      accountId: c.accountId,
      context: detail.value.messages
        .filter((m:any)=>m.type==='text' && m.text && ['sent','received'].includes(m.direction))
        .slice(-20)
        .map((m: any) => `${m.direction === 'sent' ? '我' : '对方'}：${m.text}`)
        .join('\n')
    })
    if (draftStore.value[key]?.text !== initialText) {
      draftErrors.value[key] = '生成期间草稿已修改，保留你的编辑；新结果可在任务中心查看。'
      return
    }
    if (!result?.text) throw Error(result?.reason || '模型没有返回可用草稿，已有内容保留。')
    draftStore.value[key] = {
      text: result.text,
      reason: result.reason,
      context,
      profileVersion: result.profileVersion,
      confirmation: '',
      reviewPending: true
    }
  } catch (e) {
    draftErrors.value[key] = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value[key] = false
  }
}
async function verifyReplyDraft() {
  const c = selected.value,
    original = draft.value
  const [snapshot, latest] = await Promise.all([
    electron.ipcRenderer.invoke('career-workspace-snapshot'),
    electron.ipcRenderer.invoke('career-boss-conversation', {
      accountId: c.accountId,
      bossId: c.bossId,
      page: 1
    })
  ])
  const latestContext = JSON.stringify(
    (latest.messages || []).map((m: any) => [m.id, m.text, m.direction])
  )
  if (
    !original.profileVersion ||
    snapshot.profileVersion !== original.profileVersion ||
    latestContext !== original.context
  )
    throw Error('资料或会话已变化，请重新生成回复再确认。')
}
const filters = [
  ['all', '全部联系人'],
  ['reply', '待我回复'],
  ['important', '重要事项'],
  ['waiting', '等待对方'],
  ['unknown', '待核实'],
  ['unread', 'BOSS 未读'],
  ['attention', 'Atlas 提醒']
]
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / 30)))
let sequence = 0,
  detailSequence = 0,
  timer: ReturnType<typeof setInterval> | undefined,
  debounce: ReturnType<typeof setTimeout> | undefined
const time = (s: string) =>
  s
    ? new Date(s).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '时间未知'
const shortTime = time
async function refreshMessages() {
  await refresh()
  if (selected.value && !detailLoading.value) await readDetail()
}
function filterChanged() {
  page.value = 1
  void refresh()
}
function clearFilter() {
  query.value = ''
  filter.value = 'all'
  filterChanged()
}
function changePage(delta: number) {
  page.value += delta
  void refresh()
}
function changeMessagePage(delta: number) {
  messagePage.value += delta
  void readDetail(true)
}
function goOpportunity(id: string) {
  emit('opportunity', id)
  if (props.compact) close()
}
async function refresh() {
  const ticket = ++sequence
  loading.value = true
  try {
    const [next, m] = await Promise.all([
      electron.ipcRenderer.invoke('career-boss-conversations', {
        page: page.value,
        query: query.value,
        filter: filter.value
      }),
      electron.ipcRenderer.invoke('career-boss-metrics')
    ])
    if (ticket !== sequence) return
    if (data.value?.accountId !== next.accountId) {
      close()
      requestedConversation = ''
    }
    data.value = next
    metrics.value = m
    emit('coverage', next.coverage)
    page.value = next.page
    error.value = ''
    openRequested()
    if (!props.compact && !selected.value && next.items?.length && !route.query.conversation)
      open(next.items[0])
  } catch (e) {
    if (ticket === sequence) error.value = '读取失败，已有记录保留：' + String(e)
  } finally {
    if (ticket === sequence) loading.value = false
  }
}
function searchSoon() {
  page.value = 1
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(refresh, 250)
}
function openRequested() {
  const id = typeof route.query.conversation === 'string' ? route.query.conversation : ''
  if (
    props.active !== false &&
    !props.compact &&
    id &&
    id !== requestedConversation &&
    data.value?.accountId
  ) {
    requestedConversation = id
    open(
      data.value.items?.find((c: any) => c.bossId === id) || {
        bossId: id,
        accountId: data.value.accountId
      }
    )
  }
}
watch(
  () => route.query.conversation,
  () => {
    requestedConversation = ''
    openRequested()
  }
)
const messageLabel = (type: string) =>
  (
    ({
      image: '［图片消息］',
      resume: '［简历消息］',
      card: '［平台卡片，请在 BOSS 查看］',
      sound: '［语音消息］',
      sticker: '［表情消息］',
      comDesc: '［企业介绍］',
      system: '［平台提示］',
      revoked: '［已撤回消息］',
      action: '［平台操作通知］',
      link: '［链接消息，请在 BOSS 查看］'
    }) as Record<string, string>
  )[type] || '［暂不支持的消息类型］'
function open(c: any) {
  if (keyOf(c) === selectedKey.value) return
  selected.value = c
  detail.value = undefined
  detailError.value = ''
  messagePage.value = 1
  void readDetail(true)
  if (c.atlasAlertKey)
    void electron.ipcRenderer
      .invoke('career-boss-conversation-ack', {
        accountId: c.accountId,
        bossId: c.bossId,
        alertKey: c.atlasAlertKey
      })
      .then(refresh)
      .catch(() => {})
}
function close() {
  detailSequence++
  selected.value = undefined
  detail.value = undefined
  detailLoading.value = false
}
async function readDetail(scroll = false) {
  if (!selected.value) return
  const ticket = ++detailSequence,
    atBottom = timeline.value
      ? timeline.value.scrollHeight - timeline.value.scrollTop - timeline.value.clientHeight < 60
      : true
  detailLoading.value = true
  try {
    const next = await electron.ipcRenderer.invoke('career-boss-conversation', {
      accountId: selected.value.accountId,
      bossId: selected.value.bossId,
      page: messagePage.value
    })
    if (ticket !== detailSequence) return
    detail.value = next
    const body = { ...selected.value, ...next.body }
    selected.value = { ...body, ...conversationPriority(body) }
    messagePage.value = next.page
    detailError.value = ''
    if (scroll || atBottom) {
      await nextTick()
      if (ticket === detailSequence && timeline.value)
        timeline.value.scrollTop = timeline.value.scrollHeight
    }
  } catch (e) {
    if (ticket === detailSequence) detailError.value = String(e)
  } finally {
    if (ticket === detailSequence) detailLoading.value = false
  }
}
watch(
  () => props.active,
  (active) => {
    if (active === false) stop()
    else start()
  }
)
function start() {
  if (timer || props.active === false) return
  void refresh()
  timer = setInterval(async () => {
    if (document.hidden) return
    await refresh()
    if (selected.value && !detailLoading.value) void readDetail()
  }, 15000)
}
function stop() {
  if (timer) clearInterval(timer)
  timer = undefined
  if (debounce) clearTimeout(debounce)
  sequence++
  detailSequence++
  loading.value = false
  detailLoading.value = false
}
onMounted(start)
onActivated(start)
onDeactivated(stop)
onBeforeUnmount(stop)
</script>
<style scoped>
.boss-inbox {
  margin: 0;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  color: var(--el-text-color-primary);
}
.outside-filter {
  font-size: 11px;
  color: #986017;
  padding: 8px 16px;
  background: #fff8e9;
}
.inbox-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--el-border-color);
}
h2,
h3,
h4,
p {
  margin: 0;
}
h2 {
  font-size: 16px;
}
h3 {
  font-size: 16px;
  line-height: 1.5;
}
h4 {
  font-size: 13px;
  margin: 20px 0 10px;
}
button,
input,
select,
textarea {
  font: inherit;
}
button {
  cursor: pointer;
  border: 1px solid var(--el-border-color);
  background: var(--atlas-panel, #fff);
  color: var(--el-text-color-regular);
  border-radius: 7px;
  padding: 7px 10px;
  font-size: 12px;
}
button:hover:not(:disabled) {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
.timeline:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.muted {
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}
.inbox-heading .muted {
  margin-top: 5px;
}
.inbox-workspace {
  display: grid;
  grid-template-columns: clamp(220px, 20vw, 300px) minmax(0, 1fr) clamp(210px, 18vw, 280px);
  height: clamp(330px, calc(100dvh - 395px), 850px);
}
.contact-column,
.conversation-panel,
.assistant-column {
  min-width: 0;
  min-height: 0;
}
.contact-column {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--el-border-color);
}
.inbox-filters {
  padding: 14px;
  display: grid;
  gap: 8px;
  border-bottom: 1px solid var(--el-border-color);
}
input,
select,
textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 7px;
  padding: 9px 10px;
  background: var(--atlas-panel, #fff);
  color: var(--el-text-color-primary);
  font-size: 12px;
}
.inbox-filters small {
  font-size: 11px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.inbox-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.conversation-row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  text-align: left;
  width: 100%;
  padding: 15px 16px;
  gap: 9px;
  border: 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  border-left: 3px solid transparent;
  border-radius: 0;
  background: transparent;
}
.conversation-row[aria-pressed='true'] {
  border-left-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.conversation-main {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.conversation-main strong {
  font-size: 13px;
}
.conversation-main small,
.last-text {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.last-text {
  color: var(--el-text-color-regular);
}
.conversation-state {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  align-items: center;
  font-size: 11px;
}
.conversation-state small {
  font-size: 10px;
  color: var(--el-text-color-secondary);
  font-weight: 400;
}
.important {
  color: #986017;
}
.reply {
  color: #16705c;
}
.waiting,
.unknown {
  color: var(--el-text-color-secondary);
}
.unread {
  color: var(--el-color-primary);
}
.unread-hint {
  display: flex;
  gap: 9px;
  font-size: 10px;
  color: var(--el-color-primary);
}
.contact-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  border-top: 1px solid var(--el-border-color);
}
.contact-pagination span {
  margin-right: auto;
}
.conversation-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.conversation-heading {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 8px;
  padding: 16px 18px;
}
.conversation-heading .muted {
  margin-top: 4px;
}
.state-tag {
  font-size: 11px;
  white-space: nowrap;
  background: #f3f6fa;
  border-radius: 6px;
  padding: 5px 7px;
}
.message-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px 10px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.message-toolbar > div {
  display: flex;
  gap: 6px;
}
.message-toolbar button {
  font-size: 11px;
  padding: 4px 8px;
}
.timeline {
  flex: 1;
  min-height: 90px;
  overflow: auto;
  background: #f5f7fb;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 18px;
  overscroll-behavior: contain;
}
.timeline article {
  align-self: flex-start;
  max-width: 90%;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid #e7ebf2;
  border-radius: 4px 12px 12px 12px;
}
.timeline article.sent {
  align-self: flex-end;
  background: #eaf1ff;
  border-color: #dce6fa;
  border-radius: 12px 4px 12px 12px;
}
.timeline small {
  font-size: 10px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
.timeline p {
  font-size: 13px;
  line-height: 1.85;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin-top: 7px;
}
.timeline .history-scope {
  font-size: 10px;
  text-align: center;
  color: var(--el-text-color-secondary);
  margin: 0;
}
.message-kind {
  display: block;
  margin-top: 8px;
}
.draft-composer {
  min-height: 0;
  padding: 14px 18px;
  border-top: 1px solid var(--el-border-color);
  max-height: 48%;
  overflow: auto;
}
.draft-heading,
.draft-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.draft-heading span,
.draft-footer small {
  font-size: 10px;
  color: var(--el-text-color-secondary);
}
.draft-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 10px 0;
  flex-wrap: wrap;
}
.draft-actions button:first-child {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.draft-actions a {
  font-size: 12px;
}
.draft-composer textarea {
  font-size: 13px;
  line-height: 1.7;
  resize: vertical;
  min-height: 85px;
  max-height: 180px;
}
.draft-feedback {
  font-size: 12px;
  line-height: 1.6;
  color: #986017;
  margin: 8px 0;
}
.draft-footer {
  margin-top: 8px;
}
.draft-reason {
  font-size: 11px;
  line-height: 1.7;
  margin-top: 8px;
  color: var(--el-text-color-secondary);
}
summary {
  cursor: pointer;
}
.assistant-column {
  overflow: auto;
  padding: 18px;
  border-left: 1px solid var(--el-border-color);
}
.assistant-column h3 {
  font-size: 13px;
}
.next-action {
  margin-top: 14px;
  padding: 14px;
  background: #f5f7fb;
  border-radius: 9px;
  display: grid;
  gap: 8px;
}
.eyebrow {
  font-size: 10px;
  color: var(--el-text-color-secondary);
}
.next-action strong {
  font-size: 14px;
}
.next-action p,
.action-guide p {
  font-size: 12px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}
.next-action button {
  margin-top: 5px;
  background: white;
}
.linked-job {
  display: grid;
  gap: 7px;
  text-align: left;
  width: 100%;
  margin-bottom: 8px;
  padding: 12px;
}
.linked-job b {
  font-size: 13px;
}
.linked-job span {
  color: var(--el-color-primary);
  font-size: 11px;
}
.linked-job small {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.action-guide {
  border-top: 1px solid var(--el-border-color);
  margin-top: 20px;
}
.action-guide ol {
  padding-left: 18px;
  font-size: 12px;
  line-height: 2.3;
  color: var(--el-text-color-regular);
}
.empty {
  padding: 30px 18px;
  text-align: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.8;
}
.empty p {
  margin: 8px 0;
}
.selection-empty {
  justify-content: center;
}
.inbox-insights {
  padding: 14px 20px;
  border-top: 1px solid var(--el-border-color);
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.metrics {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  margin: 15px 0;
}
.metrics b {
  font-size: 17px;
  color: var(--el-text-color-primary);
}
.error-banner {
  margin: 10px;
  font-size: 12px;
}
.compact {
  padding: 0;
}
.compact .contact-column {
  border: 0;
}
.compact .inbox-list {
  max-height: none;
}
.compact .timeline {
  max-height: 50vh;
}
.compact .conversation-heading {
  padding: 10px 0;
}
.compact .message-toolbar {
  padding: 10px 0;
}
.compact .conversation-row {
  padding: 12px 18px;
}
.compact .conversation-state {
  justify-content: flex-start;
  gap: 15px;
}
@media (max-width: 1250px) {
  .inbox-workspace {
    grid-template-columns: 220px minmax(0, 1fr);
  }
  .assistant-column {
    grid-column: 1/-1;
    border-left: 0;
    border-top: 1px solid var(--el-border-color);
    max-height: 280px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .assistant-column h3,
  .assistant-column .action-guide {
    grid-column: 1/-1;
  }
  .assistant-column h4 {
    margin: 0;
  }
  .assistant-column .next-action {
    grid-row: 2/5;
    margin: 0;
  }
  .inbox-workspace {
    height: auto;
    grid-template-rows: 560px auto;
  }
  .action-guide {
    display: none;
  }
}
@media (max-width: 760px) {
  .inbox-workspace {
    grid-template-columns: 1fr;
    grid-template-rows: 300px 640px auto;
  }
  .contact-column {
    border-right: 0;
    border-bottom: 1px solid var(--el-border-color);
  }
  .assistant-column {
    display: block;
  }
  .draft-heading {
    align-items: start;
    flex-direction: column;
  }
  .conversation-heading {
    flex-wrap: wrap;
  }
  .inbox-heading {
    padding: 14px;
  }
  .inbox-heading .muted {
    font-size: 11px;
  }
}
@media (min-width: 1251px) and (max-height: 850px) {
  .inbox-heading {
    padding: 10px 16px;
  }
  .inbox-heading .muted {
    display: none;
  }
  .inbox-workspace {
    height: max(390px, calc(100dvh - 275px));
  }
  .draft-composer {
    max-height: 58%;
  }
  .conversation-heading {
    padding: 12px 16px;
  }
}
.draft-modes {
  display: flex;
  gap: 8px;
  margin: 10px 0;
}
.draft-modes button {
  padding: 6px 9px;
  font-size: 11px;
}
.draft-modes button[aria-pressed='true'] {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary-light-7);
}
</style>
