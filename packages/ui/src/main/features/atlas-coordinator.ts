import { randomUUID } from 'node:crypto'
import { executionContext, parentExecution, executionTaskChanged } from './atlas-execution'
import { type CoordinationAction, validateCoordination } from '../../common/coordinator'
import {
  atlasDb,
  atlasRead,
  atlasWrite,
  atlasRevision,
  atlasTransaction,
  fingerprint
} from './atlas-store'
import { activeAccount, inAccountScope } from './atlas-account-scope'
import { canonicalProfile, profileHistory } from './atlas-profile'
import { careerPolicy, allAutomationPaused } from './atlas-policy'
import { agentConfig, agentVersion, resolveAgent } from './atlas-agents'
import { modelVersion } from './atlas-model-config'
import { deepseekConfig, deepseekJson } from './atlas-deepseek'
import {
  contactMatch,
  contactJob,
  contactJobBasis,
  enqueueContact,
  contactSummary
} from './atlas-contact'
import { discoveryRun, saveDiscoveryRun } from './atlas-discovery-state'
import { startDiscovery } from './atlas-discovery'
import { companyResearchSnapshot } from './atlas-company-research'
import { interviewContext } from './atlas-assistant'
import { discoveryDailyBudget } from './atlas-discovery-budget'

type CreateTask = (input: any) => { taskId: string; reused?: boolean }
const day = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
const now = () => new Date().toISOString()
const path = (page: string) => '/main-layout/' + page
const configKey = () => 'atlas-coordinator-config/' + fingerprint(activeAccount())
const planKey = () => 'atlas-coordinator-plan/' + fingerprint(activeAccount())
const actionKey = (id: string) => 'atlas-coordinator-action/' + id
const channels: Partial<Record<CoordinationAction['kind'], string>> = {
  analysis: 'career-discovery-analyze',
  research: 'career-company-research',
  interview: 'career-interview-prepare',
  resume: 'career-resume-review',
  market: 'career-market-review',
  strategy: 'career-strategy-optimize'
}
const supporting = new Set(['research', 'interview', 'resume', 'market'])
export function coordinatorConfig() {
  return {
    mode: 'suggest',
    ...atlasRead<any>(configKey(), {}),
    revision: atlasRevision([configKey()])
  }
}
export function saveCoordinatorConfig(input: any) {
  return atlasTransaction(() => {
    if (input?.baseRevision !== coordinatorConfig().revision)
      throw Error('协调设置已变化，请刷新后重试')
    if (!['suggest', 'assist'].includes(input.mode)) throw Error('协调模式无效')
    atlasWrite(configKey(), { mode: input.mode, updatedAt: now() })
    return coordinatorConfig()
  })
}
export function coordinatorBudget() {
  const d = day(),
    db = atlasDb()
  const used = db
    .prepare(
      "SELECT count(*) n FROM ai_calls WHERE day=? AND kind='coordinator' AND status<>'cached'"
    )
    .get(d).n
  const start = new Date(d + 'T00:00:00+08:00').toISOString()
  const supportUsed = db
    .prepare(
      "SELECT count(*) n FROM documents WHERE key LIKE 'atlas-coordinator-action/%' AND json_extract(value,'$.support')=1 AND json_extract(value,'$.createdAt')>=?"
    )
    .get(start).n
  return { used, limit: 2, remaining: Math.max(0, 2 - used), supportUsed, supportLimit: 6 }
}
function environmentBasis() {
  const policy = careerPolicy()
  return fingerprint([
    activeAccount(),
    profileHistory()[0]?.id,
    policy.direction,
    policy.exclusions,
    policy.advanced,
    modelVersion(),
    agentVersion('coordination-1', [
      'coordinator',
      'analysis',
      'resume-review',
      'market-review',
      'interview',
      'strategy',
      'company-research'
    ])
  ])
}
/** A bounded, server-owned action catalogue. The model never supplies RPC names or arguments. */
export function coordinatorCandidates() {
  const db = atlasDb(),
    account = activeAccount(),
    profile = canonicalProfile(),
    policy = careerPolicy(),
    version = profileHistory()[0]?.id || '',
    basis = environmentBasis(),
    actions: CoordinationAction[] = []
  const add = (
    kind: CoordinationAction['kind'],
    target: string,
    title: string,
    reason: string,
    priority: number,
    destination: string,
    detail: any,
    payload?: any
  ) => {
    const b = fingerprint([basis, detail]),
      id = fingerprint([account, kind, target, b])
    actions.push({ id, kind, target, title, reason, priority, destination, basis: b, payload })
  }
  if (!profile.resumeText.trim())
    add(
      'manual',
      'profile',
      '补充个人资料',
      '有完整履历才能判断岗位关联。',
      0,
      path('CareerWorkspace'),
      version
    )
  const unconfirmed = profile.evidence.filter((e) => !e.confirmed)
  if (unconfirmed.length)
    add(
      'manual',
      'evidence',
      `核对 ${unconfirmed.length} 项经历`,
      '确认真实贡献和结果，后续话术复用这些依据。',
      0,
      path('CareerWorkspace'),
      version
    )
  const uncertain = db
    .prepare("SELECT count(*) n FROM contact_runs WHERE account_id=? AND state='uncertain'")
    .get(account).n
  if (uncertain)
    add(
      'manual',
      'uncertain',
      `核实 ${uncertain} 个发送结果`,
      '结果不确定的联系保持停止，不重复发送。',
      0,
      path('CareerDiscovery') + '?view=results',
      uncertain
    )

  const conversations = db
    .prepare(
      "SELECT c.source_id,c.body,m.body message,m.source_id message_id,m.sent_at FROM platform_conversations c JOIN platform_messages m ON m.platform=c.platform AND m.account_id=c.account_id AND m.conversation_id=c.source_id WHERE c.platform='boss' AND c.account_id=? AND m.source_id=(SELECT x.source_id FROM platform_messages x WHERE x.platform=c.platform AND x.account_id=c.account_id AND x.conversation_id=c.source_id ORDER BY x.sent_at DESC,x.source_id DESC LIMIT 1) ORDER BY m.sent_at DESC LIMIT 30"
    )
    .all(account)
  for (const r of conversations) {
    const m = JSON.parse(r.message),
      c = JSON.parse(r.body)
    if (m.direction !== 'received') continue
    if (
      r.sent_at &&
      Date.parse(r.sent_at) < Date.now() - 7 * 86400000 &&
      !c.unreadCount &&
      !c.unread
    )
      continue
    // Platform cards and important commitments always stay in the conversation UI.
    const title = c.companyName || c.bossName || c.name || '招聘者'
    const url =
      path('CareerDashboard') + '?view=replies&conversation=' + encodeURIComponent(r.source_id)
    add(
      'manual',
      r.source_id,
      `查看 ${title} 的新沟通`,
      '最近一条来自对方；核对原文后处理，平台卡片不作为意向判断。',
      0,
      url,
      [r.message_id, m]
    )
    try {
      const research = companyResearchSnapshot({ accountId: account, bossId: r.source_id })
      if (
        research.ready &&
        (!research.latest || research.stale) &&
        research.autoUpdate &&
        research.autoBudget.used < 6
      )
        add(
          'research',
          r.source_id,
          `了解 ${title}`,
          '结合关联 JD、最新沟通和公开来源更新企业研判。',
          1,
          url,
          research.basis,
          { accountId: account, bossId: r.source_id, baseBasis: research.basis, automatic: true }
        )
    } catch {
      /* An incomplete source link is a UI task, never guessed by name. */
    }
  }
  const interviews = db
    .prepare(
      "SELECT r.opportunity_id,r.body,o.body opportunity FROM related r JOIN opportunities o ON o.id=r.opportunity_id WHERE r.kind='interview' ORDER BY json_extract(r.body,'$.date') LIMIT 100"
    )
    .all()
  for (const r of interviews) {
    const i = JSON.parse(r.body),
      o = JSON.parse(r.opportunity),
      date = Date.parse(i.date)
    if (
      !inAccountScope(o, account) ||
      !Number.isFinite(date) ||
      date < Date.now() ||
      date > Date.now() + 7 * 86400000 ||
      ['cancelled', 'completed'].includes(i.status)
    )
      continue
    try {
      const c = interviewContext(r.opportunity_id)
      add(
        'interview',
        r.opportunity_id,
        `准备面试：${i.title}`,
        '未来 7 天的面试，复用岗位要求、经历和已知沟通。',
        1,
        path('CareerDashboard') + '?view=companies',
        c.basis,
        { id: r.opportunity_id, baseBasis: c.basis, automatic: true }
      )
    } catch {
      /* Missing opportunity remains visible in the interview calendar. */
    }
  }
  const jobs = db
    .prepare(
      "SELECT source_id,body,detail_at,observed_at FROM platform_jobs WHERE platform='boss' AND account_id=? ORDER BY observed_at DESC,source_id LIMIT 120"
    )
    .all(account)
  for (const r of jobs) {
    const job = {
      description: '',
      ...JSON.parse(r.body),
      observedAt: r.observed_at,
      detailAt: r.detail_at
    }
    const match = contactMatch(job, { account, profile, version, policy })
    const existing = db
      .prepare(
        'SELECT id FROM contact_runs WHERE account_id=? AND (job_id=? OR recruiter_id=?) UNION ALL SELECT source_id FROM platform_conversations WHERE account_id=? AND source_id=? LIMIT 1'
      )
      .get(account, r.source_id, job.encryptBossId || '', account, job.encryptBossId || '')
    const url = path('CareerDiscovery') + '?job=' + encodeURIComponent(r.source_id)
    if (match.eligible && !existing)
      add(
        'contact',
        r.source_id,
        `联系：${job.companyName} · ${job.jobName}`,
        '统一匹配已通过；沿用授权生成匹配招呼并经发送队列核验。',
        2,
        url,
        [match.jobBasis, match.analysisId]
      )
    else if (
      !match.fresh &&
      job.description.length >= 80 &&
      !match.checks.some((c: any) => c.status === 'gap' && c.key !== 'ai')
    )
      add(
        'analysis',
        r.source_id,
        `分析：${job.companyName} · ${job.jobName}`,
        '详情已读取，更新岗位要求与已确认经历的对应关系。',
        3,
        url,
        contactJobBasis(job),
        { accountId: account, jobId: r.source_id, profileVersion: version, automatic: true }
      )
  }
  const run = discoveryRun(account),
    today = day(),
    reads = discoveryDailyBudget()
  if (
    account !== 'local' &&
    policy.discovery.autoRecommend &&
    reads.candidates.length < policy.discovery.maxJobs &&
    (!run || !['queued', 'running', 'analyzing', 'paused', 'blocked'].includes(run.state)) &&
    (!run?.createdAt ||
      new Date(run.createdAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) !== today)
  )
    add(
      'discover',
      today,
      '补充岗位与详情',
      '复用机会发现的搜索、BOSS 推荐和每日读取预算。',
      4,
      path('CareerDiscovery'),
      today
    )
  if (profile.resumeText.trim())
    add(
      'resume',
      version,
      '检查简历竞争力',
      '从 HR 筛选和业务交付两方面检查表达与证据。',
      4,
      path('CareerInsights'),
      version,
      { automatic: true }
    )
  if (jobs.length >= 5)
    add(
      'market',
      today,
      '复盘当前岗位样本',
      '比较已采集样本、经历与方向，不外推整个招聘市场。',
      4,
      path('CareerInsights'),
      today,
      { automatic: true }
    )
  const feedbackCount = db
    .prepare(
      "SELECT count(*) n FROM documents WHERE key LIKE 'atlas-feedback/%' AND json_extract(value,'$.accountId')=?"
    )
    .get(account).n
  if (feedbackCount >= 3 && policy.discovery.adaptive && policy.discovery.strategyLimit > 0)
    add(
      'strategy',
      today,
      '调整扩展搜索词',
      `已有 ${feedbackCount} 条本人反馈，仅优化扩展词与软排序。`,
      5,
      path('CareerDiscovery'),
      today,
      { automatic: true }
    )
  // Keep all urgent items; bound remaining input independently of corpus size.
  return {
    accountId: account,
    environment: basis,
    profileVersion: version,
    sample: {
      scannedJobs: jobs.length,
      totalJobs: db
        .prepare("SELECT count(*) n FROM platform_jobs WHERE platform='boss' AND account_id=?")
        .get(account).n
    },
    actions: actions
      .filter((a) => atlasRead<any>(actionKey(a.id), null)?.state !== 'reviewed')
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 60)
  }
}
function execution(action: CoordinationAction) {
  const saved = atlasRead<any>(actionKey(action.id), null)
  if (!saved)
    return { state: action.kind === 'manual' ? 'manual' : 'pending', taskId: '', reason: '' }
  if (saved.taskId) {
    const t = atlasDb()
      .prepare('SELECT state,step,error FROM task_runs WHERE id=? AND account_id=?')
      .get(saved.taskId, activeAccount())
    return {
      ...saved,
      state: t?.state || 'interrupted',
      reason: t?.error || t?.step || '关联任务不可读'
    }
  }
  if (saved.contactId) {
    const t = atlasDb()
      .prepare('SELECT state,body FROM contact_runs WHERE id=? AND account_id=?')
      .get(saved.contactId, activeAccount())
    return {
      ...saved,
      state:
        t?.state === 'completed'
          ? 'completed'
          : ['failed', 'uncertain', 'review', 'manual'].includes(t?.state)
            ? 'blocked'
            : 'running',
      reason: t ? JSON.parse(t.body).reason || t.state : '联系任务不可读'
    }
  }
  if (saved.discoveryId) {
    const run = discoveryRun(activeAccount())
    const task = atlasDb()
      .prepare('SELECT state,step FROM task_runs WHERE id=? AND account_id=?')
      .get('discovery:' + saved.discoveryId, activeAccount())
    return {
      ...saved,
      state: task?.state || (run?.id === saved.discoveryId ? run.state : 'interrupted'),
      reason: task?.step || run?.message || ''
    }
  }
  return saved
}
function candidateBasis(c: ReturnType<typeof coordinatorCandidates>) {
  return fingerprint([day(), c.environment, c.actions.map((a) => [a.id, execution(a).state])])
}
function writePlan(
  c: ReturnType<typeof coordinatorCandidates>,
  source: string,
  summary: string,
  choices: { id: string; reason: string }[]
) {
  const chosen = choices
    .map((a, order) => ({ ...c.actions.find((x) => x.id === a.id)!, reason: a.reason, order }))
    .sort((a, b) => a.priority - b.priority || a.order - b.order)
  const plan = {
    id: randomUUID(),
    accountId: c.accountId,
    day: day(),
    source,
    summary,
    executionTaskId:executionContext()?.stepId.startsWith('step:')?executionContext()!.stepId.slice(5):'',
    basis: candidateBasis(c),
    environment: c.environment,
    createdAt: now(),
    sample: c.sample,
    actions: chosen
  }
  atlasWrite(planKey(), plan)
  atlasWrite('atlas-coordinator-history/' + plan.id, plan)
  return plan
}
export function refreshCoordinator() {
  return atlasTransaction(() => {
    const c = coordinatorCandidates(),
      old = atlasRead<any>(planKey(), null),
      basis = candidateBasis(c)
    if (old?.basis === basis) return old
    const urgent = c.actions.filter((a) => a.priority === 0)
    const available = c.actions.filter(
      (a) => a.priority !== 0 && ['pending', 'queued', 'running'].includes(execution(a).state)
    )
    const actions = [...urgent, ...available.slice(0, Math.max(0, 12 - urgent.length))]
    // Retain execution evidence separately even when an updated plan drops its source action.
    return writePlan(
      c,
      'rules',
      actions.length
        ? '先处理沟通与近期面试，再推进匹配岗位。'
        : '当前没有新的待安排事项，可查看执行记录或继续发现岗位。',
      actions.map((a) => ({ id: a.id, reason: a.reason }))
    )
  })
}
export async function planWithAi(input: any) {
  const c = coordinatorCandidates(),
    before = candidateBasis(c),
    account = activeAccount()
  if (input?.baseBasis !== before) throw Error('安排依据已变化，请刷新后重试；未调用模型')
  const pending = c.actions
    .filter((a) => ['pending', 'manual', 'queued', 'running'].includes(execution(a).state))
    .slice(0, 30)
  if (!pending.length) return refreshCoordinator()
  if (pending.filter((a) => a.priority === 0).length > 12)
    throw Error('待处理的重要沟通较多，请先处理后再请求 AI 安排')
  const result = await deepseekJson(
    deepseekConfig(),
    '',
    {
      actions: pending.map(({ payload, ...a }) => a),
      direction: careerPolicy().direction,
      profileVersion: c.profileVersion,
      sample: c.sample,
      outcomes: contactSummary({ period: 'week' }).counts,
      feedback: atlasDb()
        .prepare(
          "SELECT json_extract(value,'$.action') action,json_extract(value,'$.reason') reason FROM documents WHERE key LIKE 'atlas-feedback/%' AND json_extract(value,'$.accountId')=? ORDER BY updated_at DESC LIMIT 20"
        )
        .all(account),
      limitations: '结果为近 7 天创建的联系任务，不代表录用概率或策略因果效果。'
    },
    input.signal || new AbortController().signal,
    {
      kind: 'coordinator',
      accountId: account,
      automatic: !!input.automatic,
      agent: resolveAgent('coordinator'),
      tools: []
    }
  )
  const value = validateCoordination(result.value, pending)
  return atlasTransaction(() => {
    const fresh = coordinatorCandidates()
    if (account !== activeAccount() || candidateBasis(fresh) !== before || input.signal?.aborted)
      throw Error('分析期间依据或账号已变化，原安排保留')
    return writePlan(fresh, 'ai', value.summary, value.actions)
  })
}
function blocked(action: CoordinationAction): string {
  if (!agentConfig('coordinator').enabled) return '求职协调 Agent 已停用'
  const agent = {
    analysis: 'analysis',
    research: 'company-research',
    interview: 'interview',
    resume: 'resume-review',
    market: 'market-review',
    strategy: 'strategy'
  }[action.kind]
  if (agent && !agentConfig(agent).enabled) return '此模块的 Agent 已停用'
  if (coordinatorConfig().mode !== 'assist') return '当前仅建议，可开启自动安排'
  if (allAutomationPaused()) return '全部自动任务已暂停'
  const hour = Number(
    new Date().toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      hour12: false
    })
  )
  if (hour < 9 || hour >= 21) return '等待 09:00–21:00 运行时段'
  if (action.kind === 'contact') {
    const s = careerPolicy().sending,
      auth = atlasRead<any>('atlas-contact-authorization', {})
    if (s.paused || !s.outbound) return '发送已暂停；请在机会发现管理'
    if (!auth.id || auth.accountId !== activeAccount() || auth.mode !== 'automatic')
      return '尚未授权匹配后自动联系'
  }
  if (supporting.has(action.kind) && coordinatorBudget().supportUsed >= 6)
    return '今日辅助分析已安排 6 项'
  if (action.kind === 'analysis') {
    const count = atlasDb()
      .prepare(
        "SELECT count(*) n FROM ai_calls WHERE day=? AND kind='analysis' AND automatic=1 AND status<>'cached'"
      )
      .get(day()).n
    if (count >= careerPolicy().discovery.aiLimit) return '今日岗位分析预算已用完'
  }
  return ''
}
export function dispatchCoordinator(input: any, create: CreateTask) {
  return atlasTransaction(() => {
    const plan = atlasRead<any>(planKey(), null)
    if (!plan || input?.planId !== plan.id) throw Error('安排已更新，请刷新后重试')
    const old = plan.actions.find((a: CoordinationAction) => a.id === input.actionId) as
      | CoordinationAction
      | undefined
    if (!old || old.kind === 'manual') throw Error('此事项需要在对应页面由本人处理')
    const previous = atlasRead<any>(actionKey(old.id), null)
    if (previous) return execution(old) // Idempotent across plans, windows and restarts, including failures.
    const fresh = coordinatorCandidates().actions.find((a) => a.id === old.id)
    if (!fresh) throw Error('岗位、资料或会话已变化，未执行旧安排')
    const reason = blocked(fresh)
    if (reason) throw Error(reason)
    const base: any = {
      id: fresh.id,
      accountId: activeAccount(),
      kind: fresh.kind,
      title: fresh.title,
      destination: fresh.destination,
      basis: fresh.basis,
      environment: environmentBasis(),
      createdAt: now(),
      state: 'queued',
      support: supporting.has(fresh.kind),
      planId: plan.id
    }
    if (fresh.kind === 'contact') {
      const result = enqueueContact(activeAccount(), contactJob(activeAccount(), fresh.target))
      if (result.blocked) throw Error(result.blocked.join('；'))
      base.contactId = result.id
    } else if (fresh.kind === 'discover') {
      const run = startDiscovery({
        accountId: activeAccount(),
        channels: ['targeted', 'recommended']
      })
      saveDiscoveryRun(activeAccount(), { ...run, automatic: true })
      base.discoveryId = run.id
    } else {
      const task = create({ channel: channels[fresh.kind], payload: fresh.payload })
      base.taskId = task.taskId
    }
    atlasWrite(actionKey(fresh.id), base)
    const parentTask=plan.executionTaskId || 'coordination:'+plan.id
    if(!plan.executionTaskId)executionTaskChanged({id:parentTask,kind:'coordination-run',accountId:activeAccount(),state:'completed',step:'规则安排已完成；各模块按原有授权执行'})
    parentExecution(base.taskId || (base.contactId?'contact:'+base.contactId:'discovery:'+base.discoveryId),parentTask,fresh.id)
    return execution(fresh)
  })
}
// Queue hook: a setting change or stale input cancels dispatch before any model request.
export function coordinatorTaskBlock(taskId: string, checkSources = false) {
  const task = atlasDb().prepare('SELECT kind,input FROM task_runs WHERE id=?').get(taskId)
  if (
    task?.kind === 'career-coordinator-plan' &&
    JSON.parse(task.input).automatic &&
    coordinatorConfig().mode !== 'assist'
  )
    return '自动安排已关闭'
  const row = atlasDb()
    .prepare(
      "SELECT value FROM documents WHERE key LIKE 'atlas-coordinator-action/%' AND json_extract(value,'$.taskId')=? LIMIT 1"
    )
    .get(taskId)
  if (!row) return ''
  const a = JSON.parse(row.value)
  if (a.accountId !== activeAccount() || a.environment !== environmentBasis())
    return '协调任务的账号、资料或模型依据已变化'
  if (!agentConfig('coordinator').enabled || coordinatorConfig().mode !== 'assist')
    return '自动安排已关闭或协调 Agent 已停用'
  if (checkSources && !coordinatorCandidates().actions.some((c) => c.id === a.id))
    return '协调任务的岗位或会话依据已变化'
  return ''
}
export function coordinatorOverview() {
  const plan = refreshCoordinator(),
    b = coordinatorBudget(),
    config = coordinatorConfig()
  const actions = plan.actions.map((a: CoordinationAction) => ({
    ...a,
    payload: undefined,
    execution: execution(a),
    blocked: a.kind === 'manual' ? '' : blocked(a)
  }))
  const history = atlasDb()
    .prepare(
      "SELECT value FROM documents WHERE key LIKE 'atlas-coordinator-action/%' AND json_extract(value,'$.accountId')=? ORDER BY updated_at DESC LIMIT 20"
    )
    .all(activeAccount())
    .map((r: any) => {
      const a = JSON.parse(r.value)
      return { ...a, execution: execution(a) }
    })
  const modelTask =
    atlasDb()
      .prepare(
        "SELECT id,state,error,updated_at FROM task_runs WHERE account_id=? AND kind='career-coordinator-plan' ORDER BY created_at DESC LIMIT 1"
      )
      .get(activeAccount()) || null
  const stats = contactSummary({ period: 'week' })
  return {
    plan: { ...plan, actions },
    config,
    budget: b,
    modelTask,
    history,
    agentEnabled: agentConfig('coordinator').enabled,
    automationPaused: allAutomationPaused(),
    outcomes: { ...stats.counts, start: stats.start, period: 'week' },
    revision: atlasRevision([planKey()])
  }
}
export function scheduleCoordinator(create: CreateTask) {
  if (
    coordinatorConfig().mode !== 'assist' ||
    allAutomationPaused() ||
    !agentConfig('coordinator').enabled
  )
    return
  const plan = refreshCoordinator()
  const active = atlasDb()
    .prepare(
      "SELECT count(*) n FROM task_runs WHERE account_id=? AND state IN ('queued','running') AND kind LIKE 'career-%'"
    )
    .get(activeAccount()).n
  if (active) return
  const candidate = plan.actions.find(
    (a: CoordinationAction) =>
      a.kind !== 'manual' && execution(a).state === 'pending' && !blocked(a)
  )
  if (!candidate) return
  // Once per day automatic planning; explicit AI refresh shares the same two-call budget.
  const key = 'atlas-coordinator-auto-plan/' + fingerprint([activeAccount(), day()])
  if (coordinatorBudget().remaining > 0 && !atlasRead(key, null)) {
    atlasTransaction(() => {
      if (atlasRead(key, null)) return
      const task = create({
        channel: 'career-coordinator-plan',
        payload: { baseBasis: plan.basis, automatic: true }
      })
      atlasWrite(key, { taskId: task.taskId, at: now() })
    })
    return
  }
  dispatchCoordinator({ planId: plan.id, actionId: candidate.id }, create)
}
export function registerCoordinator(
  handle: (name: string, fn: (...args: any[]) => any) => void,
  create: CreateTask
) {
  handle('career-coordinator-overview', () => coordinatorOverview())
  handle('career-coordinator-config', (_, p) => saveCoordinatorConfig(p))
  handle('career-coordinator-refresh', () => refreshCoordinator())
  handle('career-coordinator-plan', (_, p) => planWithAi(p))
  handle('career-coordinator-dispatch', (_, p) => dispatchCoordinator(p, create))
  handle('career-coordinator-reviewed', (_, p) =>
    atlasTransaction(() => {
      const plan = atlasRead<any>(planKey(), null),
        a = plan?.actions.find((x: CoordinationAction) => x.id === p?.actionId)
      if (
        !a ||
        plan.id !== p.planId ||
        a.kind !== 'manual' ||
        !a.destination.includes('conversation=') ||
        !coordinatorCandidates().actions.some((x) => x.id === a.id)
      )
        throw Error('沟通依据已变化，请重新查看')
      atlasWrite(actionKey(a.id), {
        ...a,
        accountId: activeAccount(),
        state: 'reviewed',
        createdAt: now(),
        reason: '本人标记此版本沟通已处理；不代表发送或平台已读'
      })
      return coordinatorOverview()
    })
  )
  handle('career-coordinator-skip', (_, p) =>
    atlasTransaction(() => {
      const plan = atlasRead<any>(planKey(), null),
        action = plan?.actions.find((a: CoordinationAction) => a.id === p?.actionId)
      if (!action || plan.id !== p.planId) throw Error('安排已变化，请刷新后重试')
      if (action.priority === 0 || atlasRead(actionKey(action.id), null))
        throw Error('重要或已提交的事项请在对应页面处理')
      atlasWrite(actionKey(action.id), {
        ...action,
        payload: undefined,
        accountId: activeAccount(),
        state: 'skipped',
        createdAt: now(),
        reason: '本人忽略本版本建议'
      })
      return coordinatorOverview()
    })
  )
}
