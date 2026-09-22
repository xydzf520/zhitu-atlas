import { randomUUID } from 'node:crypto'
import { itemDiscoveryChannels, validateDiscoveryChannels, discoveryChannelLabels } from '../../common/discovery'
import { contactBaseMatch, finishContactMatch, type MatchCheck } from '../../common/contact'
import {
  atlasDb,
  atlasRead,
  atlasWrite,
  atlasTransaction,
  atlasEvent,
  fingerprint,
  atlasRevision
} from './atlas-store'
import { canonicalProfile, profileHistory } from './atlas-profile'
import { discoveryAccount, discoveryItemKey, discoveryItems } from './atlas-discovery-state'
import { analysisModel, currentAnalysisPromptVersion } from './atlas-ai'
import {
  policyExclusions,
  policyVerification,
  allAutomationPaused,
  setAllAutomationPaused
} from './atlas-policy'
import {
  runtimePolicy,
  setRuntime,
  acquireLease,
  releaseLease,
  keepLeaseAlive,
  claimSend,
  finishSend
} from './atlas-tasks'
import { generateGreeting, greetingCurrent } from './atlas-greeting'
import { recordTask } from './atlas-task-records'
import { withExecutionTask, taskExecutionPaused } from './atlas-execution'
import { indexOpportunity } from './atlas-pipeline'
import { buildOpportunities } from '../../common/dashboard'
import { readCareerSnapshot, checkRevision } from './career-file-state'
import { opportunityKey } from '../../common/career'

export const contactJobBasis = (job: any) =>
  fingerprint([
    job.jobName,
    job.companyName,
    job.description,
    job.salaryDesc,
    job.salaryHigh,
    job.salaryLow,
    job.address,
    job.cityName,
    job.degreeName,
    job.experienceName
  ])
const dayOf = (now = Date.now()) =>
  new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
const iso = (now = Date.now()) => new Date(now).toISOString()
export function platformContactLimit(account: string, now = Date.now()) {
  return atlasRead<any>('boss-contact-limit/' + fingerprint([account, dayOf(now)]), { state: 'unknown' })
}
export function recordPlatformContactLimit(account: string, notice: string, now = Date.now()) {
  if (!account || !/(今日|今天|当日|每日).{0,30}(开聊|沟通|打招呼).{0,30}(上限|用完|已满)|(?:开聊|沟通|打招呼).{0,30}(?:次数|人数).{0,15}(?:已用完|已达上限)/.test(notice)) return false
  atlasWrite('boss-contact-limit/' + fingerprint([account, dayOf(now)]), {
    state: 'exhausted', at: iso(now), reason: 'BOSS 当前账号已提示当天开聊额度用完，停止新增联系', source: 'platform-visible-notice' })
  return true
}
export function contactJob(account: string, jobId: string) {
  const r = atlasDb()
    .prepare("SELECT * FROM platform_jobs WHERE platform='boss' AND account_id=? AND source_id=?")
    .get(account, jobId)
  if (!r) throw Error('岗位尚未读取或账号不一致')
  return { description: '', address: '', ...JSON.parse(r.body), observedAt: r.observed_at, detailAt: r.detail_at }
}
export function contactMatch(job: any, options: any = {}) {
  const account = options.account || discoveryAccount(),
    profile = options.profile || canonicalProfile(),
    item = options.item || atlasRead<any>(discoveryItemKey(account, job.encryptJobId), {}),
    checks: MatchCheck[] = contactBaseMatch(job, profile)
  for (const reason of policyExclusions(job, options.policy))
    checks.push({ key: 'excluded', label: '本人排除条件', status: 'gap', reason })
  for (const reason of policyVerification(job, options.policy))
    checks.push({ key: 'advanced', label: '高级筛选', status: 'verify', reason })
  const feedback =
    options.feedback === undefined
      ? atlasRead<any>('atlas-feedback/' + fingerprint([account, job.encryptJobId]), null)
      : options.feedback
  if (['irrelevant', 'ended', 'progressed'].includes(feedback?.action))
    checks.push({
      key: 'feedback',
      label: '本人反馈',
      status: 'gap',
      reason: '本人已标记不相关、结束或已推进，请在进展中管理，不重复首次联系'
    })
  if (item.status === 'dismissed')
    checks.push({ key: 'dismissed', label: '本人选择', status: 'gap', reason: '已标记暂不考虑' })
  const model = options.model ?? analysisModel(),
    version = options.version || profileHistory()[0]?.id,
    analysis = item.analysis
  const fresh =
    !!analysis &&
    analysis.profileVersion === version &&
    item.analysisBasis === contactJobBasis(job) &&
    analysis.model === model &&
    analysis.promptVersion === currentAnalysisPromptVersion()
  const decision = analysis?.analysis?.recommendation?.decision
  checks.push({
    key: 'ai',
    label: 'AI 投入建议',
    status: !fresh
      ? 'verify'
      : ['prioritize', 'consider'].includes(decision)
        ? 'met'
        : decision === 'skip'
          ? 'gap'
          : 'verify',
    reason: !fresh
      ? !analysis ? '尚未生成 AI 岗位分析'
        : analysis.profileVersion !== version ? '个人资料已更新，岗位分析需要重新生成'
        : item.analysisBasis !== contactJobBasis(job) ? '招聘要求已变化，岗位分析需要重新生成'
        : '模型、渠道或提示词已变化，岗位分析需要重新生成'
      : {
          prioritize: '优先争取',
          consider: '可以考虑',
          skip: 'AI 暂不建议投入',
          verify: 'AI 建议先核实'
        }[decision as string] || 'AI 建议待核实'
  })
  if (fresh) {
    const evidence = [...profile.evidence, ...(profile.qualifications || [])]
    const requirements = analysis.analysis?.requirements
    if (!Array.isArray(requirements) || !requirements.length)
      checks.push({
        key: 'requirements',
        label: '要求覆盖',
        status: 'verify',
        reason: '岗位分析尚未列出可核对要求'
      })
    for (const [i, r] of (requirements || []).entries())
      if (r.essential) {
        const proved =
          Array.isArray(r.evidenceIds) &&
          r.evidenceIds.length > 0 &&
          r.evidenceIds.every((id: string) => evidence.some((e: any) => e.id === id && e.confirmed))
        checks.push({
          key: 'requirement:' + i,
          label: r.requirement,
          status: r.status === 'gap' ? 'gap' : r.status === 'met' && proved ? 'met' : 'verify',
          reason: r.status === 'met' && proved ? r.assessment : '必要条件需核实：' + r.requirement,
          evidenceIds: r.evidenceIds
        })
      }
  }
  if (job.sourcePlatform === 'import')
    checks.push({
      key: 'source',
      label: '来源核验',
      status: 'verify',
      reason: '手动或导入资料尚未核实 BOSS 岗位与招聘者；不自动发送'
    })
  if (!job.encryptBossId)
    checks.push({
      key: 'recruiter',
      label: '招聘者身份',
      status: 'verify',
      reason: '缺少可靠的招聘者标识，先补齐详情'
    })
  return {
    ...finishContactMatch(checks),
    fresh,
    decision,
    profileVersion: version,
    analysisId: fresh ? fingerprint(analysis) : '',
    jobBasis: contactJobBasis(job)
  }
}
function currentAccount(input: any) {
  const id = discoveryAccount()
  if (!id || input?.accountId !== id) throw Error('BOSS 账号未核实或已变化')
  return id
}
export function contactRun(id: string) {
  const row = atlasDb().prepare('SELECT * FROM contact_runs WHERE id=?').get(id)
  return row ? { ...row, body: JSON.parse(row.body) } : null
}
export function saveContact(id: string, patch: any, now = Date.now()) {
  return atlasTransaction(() => {
    const old = contactRun(id)
    if (!old) throw Error('联系任务不存在')
    const body = { ...old.body, ...patch },
      state = patch.state || old.state
    atlasDb()
      .prepare('UPDATE contact_runs SET state=?,body=?,revision=revision+1,updated_at=? WHERE id=?')
      .run(state, JSON.stringify(body), iso(now), id)
    recordTask({
      id: 'contact:' + id,
      kind: 'first-contact',
      accountId: old.account_id,
      state,
      step: body.reason || state,
      createdAt: old.created_at,
      input: { jobId: old.job_id, bossId:old.recruiter_id, job:body.job, profileVersion: body.profileVersion, automatic:true },
      result: {
        contactId: id,
        conversationId: body.conversationId || '',
        messageId: body.proof?.messageId || ''
      }
    })
    return contactRun(id)
  })
}
export function enqueueContact(account: string, job: any, now = Date.now()) {
  return atlasTransaction(() => {
    if (account !== discoveryAccount()) throw Error('账号已变化')
    const match = contactMatch(job, { account })
    if (!match.eligible) return { blocked: match.reasons }
    const old = atlasDb()
      .prepare(
        "SELECT id,job_id,state FROM contact_runs WHERE platform='boss' AND account_id=? AND (job_id=? OR recruiter_id=?)"
      )
      .get(account, job.encryptJobId, job.encryptBossId)
    if (old) {
      if(old.job_id !== job.encryptJobId) linkRelatedContactJob(account,job,old.id)
      return {
        reused: true,
        id: old.id,
        reason:
          old.job_id === job.encryptJobId ? '该岗位已有联系任务' : '同一招聘者已有首条介绍任务'
      }
    }
    const previous = atlasDb()
      .prepare(
        "SELECT source_id FROM platform_conversations WHERE platform='boss' AND account_id=? AND source_id=?"
      )
      .get(account, job.encryptBossId)
    if (previous) {
      linkRelatedContactJob(account,job,'conversation:'+previous.source_id)
      return { blocked: ['已有会话，请在沟通中心跟进'], conversationId: previous.source_id }
    }
    const id = randomUUID(),
      body = {
        job,
        channels: (() => {
          const found = itemDiscoveryChannels(atlasRead<any>(discoveryItemKey(account, job.encryptJobId), {}))
          const chosen = atlasRead<any>('atlas-contact-authorization', {}).channels || []
          return [...found.filter(c => chosen.includes(c)), ...found.filter(c => !chosen.includes(c))]
        })(),
        profileVersion: match.profileVersion,
        jobBasis: match.jobBasis,
        analysisId: match.analysisId,
        reason: '匹配通过，等待生成个性化说明',
        generation: 1
      }
    atlasDb()
      .prepare("INSERT INTO contact_runs VALUES(?,'boss',?,?,?,'queued',?,1,?,?)")
      .run(
        id,
        account,
        job.encryptJobId,
        job.encryptBossId,
        JSON.stringify(body),
        iso(now),
        iso(now)
      )
    saveContact(id, {}, now)
    return { id, created: true }
  })
}
export function enrollContacts(account = discoveryAccount()) {
  if (!account) return { created: 0 }
  const profile = canonicalProfile(),
    version = profileHistory()[0]?.id,
    model = analysisModel(),
    items = discoveryItems(account)
  let created = 0
  const jobs = atlasDb()
    .prepare(
      "SELECT body FROM platform_jobs WHERE platform='boss' AND account_id=? ORDER BY observed_at DESC"
    )
    .all(account)
  const authorization = atlasRead<any>('atlas-contact-authorization', {})
  const candidates = jobs
    .map((r: any) => JSON.parse(r.body))
    .filter((job: any) => !authorization.channels || itemDiscoveryChannels(items.get(job.encryptJobId)).some(c => authorization.channels.includes(c)))
    .map((job: any) => ({
      job,
      match: contactMatch(job, {
        account,
        profile,
        version,
        model,
        item: items.get(job.encryptJobId) || {}
      })
    }))
    .filter((r: any) => r.match.eligible)
    .sort(
      (a: any, b: any) =>
        Number(a.match.decision === 'consider') - Number(b.match.decision === 'consider') ||
        b.match.satisfied - a.match.satisfied
    )
  for (const { job } of candidates) if (enqueueContact(account, job).created) created++
  return { created, eligible: candidates.length }
}
export function contactQuota(now = Date.now()) {
  const db = atlasDb(),
    day = dayOf(now),
    start = day + 'T00:00:00+08:00',
    end = iso(Date.parse(start) + 86400000)
  const used = db
    .prepare(
      "SELECT count(*) n FROM send_attempts WHERE automatic=1 AND created_at>=? AND created_at<? AND status IN ('sending','sent','uncertain')"
    )
    .get(iso(Date.parse(start)), end).n
  const first = db
    .prepare(
      "SELECT count(*) n FROM send_attempts WHERE automatic=1 AND kind='first-contact' AND created_at>=? AND created_at<? AND status IN ('sending','sent','uncertain')"
    )
    .get(iso(Date.parse(start)), end).n
  const reservations = db
      .prepare(
        'SELECT COALESCE(sum(slots),0) slots,COALESCE(sum(first_contact),0) first FROM contact_reservations WHERE day=?'
      )
      .get(day),
    p = runtimePolicy()
  return {
    day,
    used,
    reserved: reservations.slots,
    remaining: Math.max(0, p.dailyLimit - used - reservations.slots),
    limit: p.dailyLimit,
    firstUsed: first,
    firstReserved: reservations.first,
    firstRemaining: Math.max(0, p.firstContactLimit - first - reservations.first),
    firstLimit: p.firstContactLimit
  }
}
export function reserveContact(id: string, slots: number, now = Date.now()) {
  return atlasTransaction(() => {
    const row = contactRun(id),
      p = runtimePolicy()
    if (
      !row ||
      row.account_id !== discoveryAccount() ||
      p.paused ||
      !p.outbound ||
      allAutomationPaused()
    )
      return '自动发送已暂停或账号变化'
    if (![1, 2].includes(slots)) throw Error('消息预留数量无效')
    const hour = Number(
        new Date(now).toLocaleString('en-GB', {
          timeZone: 'Asia/Shanghai',
          hour: '2-digit',
          hour12: false
        })
      ),
      minute = Number(
        new Date(now).toLocaleString('en-GB', { timeZone: 'Asia/Shanghai', minute: '2-digit' })
      )
    if (
      hour < p.startHour ||
      hour >= p.endHour ||
      (slots === 2 && hour * 60 + minute + p.cooldownMinutes >= p.endHour * 60)
    )
      return '当前时段不足完成联系，等待下一可执行时段'
    atlasDb()
      .prepare('DELETE FROM contact_reservations WHERE task_id=? AND day<>?')
      .run(id, dayOf(now))
    if (atlasDb().prepare('SELECT 1 FROM contact_reservations WHERE task_id=?').get(id)) return ''
    const q = contactQuota(now),
      first = row.body.openedAt ? 0 : 1
    if (q.remaining < slots || (first && q.firstRemaining < 1))
      return '今日额度不足，等待下一运行日'
    atlasDb()
      .prepare('INSERT INTO contact_reservations VALUES(?,?,?,?,?)')
      .run(id, dayOf(now), row.account_id, slots, first)
    return ''
  })
}
function releaseReservation(id: string) {
  atlasDb().prepare('DELETE FROM contact_reservations WHERE task_id=?').run(id)
}
// Consent is persisted and bound to the exact content, identities and source versions.
export function contactApprovalBasis(row: any) {
  return fingerprint([row.account_id, row.job_id, row.recruiter_id, row.body.profileVersion,
    row.body.analysisId, row.body.jobBasis, row.body.generation, row.body.greeting])
}
export function contactApprovalCurrent(row: any) {
  if (!row?.body?.greeting?.readyForAutomation || !row.body.approval?.at || row.body.approval.basis !== contactApprovalBasis(row)) return false
  if (row.body.approval.method !== 'automatic') return true
  const auth = atlasRead<any>('atlas-contact-authorization', {})
  return auth.accountId === row.account_id && auth.mode === 'automatic' && auth.id === row.body.approval.authorizationId && contactChannelAllowed(row, auth)
}
function contactChannelAllowed(row: any, auth: any) {
  // A manually approved single opportunity remains explicit. Unknown origins never acquire automatic consent.
  return !auth.channels || (row.body.channels || []).some((c: string) => auth.channels.includes(c)) ||
    (row.body.approval?.method !== 'automatic' && !!row.body.approval?.at && row.body.approval.basis === contactApprovalBasis(row))
}
function authorizeMatchedGreeting(row: any) {
  const auth = atlasRead<any>('atlas-contact-authorization', {})
  if (auth.accountId !== row.account_id || auth.mode !== 'automatic' || !auth.id ||
      !row.body.greeting?.readyForAutomation || !contactChannelAllowed(row, auth)) return row
  const next = saveContact(row.id, { state: row.body.openedAt ? 'cooling' : 'ready',
    approval: { method: 'automatic', authorizationId: auth.id, basis: contactApprovalBasis(row), at: iso() },
    reason: '岗位匹配与话术事实审校通过，按本人授权自动联系' })
  atlasEvent('contact-content-auto-authorized', row.id, { authorizationId: auth.id, basis: next.body.approval.basis })
  return next
}
export function startContacts(input: any) {
  return atlasTransaction(() => {
    const account = currentAccount(input)
    checkRevision(input.baseRevision, ['atlas-runtime'])
    const mode = input.mode ?? 'review'
    if (mode === 'automatic' || input.controlRevision) checkRevision(input.controlRevision, ['atlas-runtime', 'atlas-contact-authorization'])
    if (!['automatic', 'review'].includes(mode)) throw Error('话术发送方式无效')
    const channels = input.channels === undefined ? undefined : validateDiscoveryChannels(input.channels)
    if (mode === 'automatic' && (!channels || input.acknowledged !== true)) throw Error('请明确选择岗位来源并启用匹配后自动发送')
    setAllAutomationPaused(false)
    atlasWrite('atlas-contact-authorization', { id: randomUUID(), accountId: account, at: iso(), mode, channels })
    setRuntime({ paused: false, outbound: true })
    return { ...enrollContacts(account), summary: contactSummary() }
  })
}
export function claimContactSend(
  row: any,
  text: string,
  phase: 'default' | 'personalized',
  now = Date.now()
) {
  return atlasTransaction(() => {
    row = contactRun(row.id)
    if (!contactApprovalCurrent(row)) throw Error('这段匹配说明尚未经本人确认或自动授权已失效，禁止发送')
    if (phase === 'personalized' && text !== row.body.greeting.text) throw Error('发送内容与已确认话术不一致')
    const reservation = atlasDb()
      .prepare('SELECT * FROM contact_reservations WHERE task_id=? AND day=?')
      .get(row.id, dayOf(now))
    if (!reservation || reservation.slots < 1) throw Error('发送额度未预留')
    // Consume the slot in the same transaction as the universal quota check.
    atlasDb()
      .prepare('UPDATE contact_reservations SET slots=slots-1,first_contact=0 WHERE task_id=?')
      .run(row.id)
    const id = randomUUID(),
      reason = claimSend(
        {
          id,
          platform: 'boss',
          accountId: row.account_id,
          recipientId: row.recruiter_id,
          kind: row.body.openedAt ? 'follow-up' : 'first-contact',
          automatic: true,
          text,
          context: {
            contactId: row.id,
            jobId: row.job_id,
            opportunityId: `boss:${row.account_id}:job:${row.job_id}`,
            conversationId: row.body.conversationId || row.recruiter_id,
            phase,
            profileVersion: row.body.profileVersion,
            analysisId: row.body.analysisId,
            textHash: fingerprint(text)
          }
        },
        now
      )
    if (reason) throw Error(reason)
    saveContact(
      row.id,
      {
        attemptId: id,
        phase,
        state: phase === 'default' ? 'opening' : 'sending',
        reason: phase === 'default' ? '正在建立会话并核验平台招呼' : '正在发送个性化匹配说明'
      },
      now
    )
    return id
  })
}
export interface ContactProof {
  accountId: string
  conversationId: string
  recruiterId: string
  jobId: string
  messageId: string
  text: string
  sentAt: string
}
export function verifyContactSend(id: string, proof: ContactProof, now = Date.now()) {
  return atlasTransaction(() => {
    const row = contactRun(id),
      attempt =
        row?.body.attemptId &&
        atlasDb().prepare('SELECT * FROM send_attempts WHERE id=?').get(row.body.attemptId)
    if (!row || !attempt) throw Error('发送尝试不存在')
    if (!['opening', 'sending', 'verifying'].includes(row.state)) {
      if (
        row.body.proof?.messageId === proof.messageId ||
        row.body.defaultProof?.messageId === proof.messageId
      )
        return row
      throw Error('此任务没有等待核验的发送')
    }
    const personalized = row.body.phase === 'personalized'
    if (
      proof.accountId !== row.account_id ||
      proof.recruiterId !== row.recruiter_id ||
      proof.jobId !== row.job_id ||
      proof.conversationId !== row.recruiter_id ||
      !proof.messageId ||
      !proof.text ||
      !Number.isFinite(Date.parse(proof.sentAt)) ||
      Date.parse(proof.sentAt) < Date.parse(attempt.created_at) - 5000 ||
      Date.parse(proof.sentAt) > now + 5000 ||
      (personalized && proof.text.trim() !== attempt.text.trim())
    )
      throw Error('消息内容、身份、时间或标识未能核验')
    atlasDb()
      .prepare('UPDATE send_attempts SET text=?,proof=? WHERE id=?')
      .run(proof.text, JSON.stringify({ method: 'platform', ...proof }), attempt.id)
    finishSend(attempt.id, 'sent')
    const message = {
      id: proof.messageId,
      direction: 'sent',
      type: 'text',
      text: proof.text,
      sentAt: proof.sentAt
    }
    atlasDb()
      .prepare(
        "INSERT INTO platform_messages VALUES('boss',?,?,?,?,?,?) ON CONFLICT(platform,account_id,conversation_id,source_id) DO NOTHING"
      )
      .run(
        row.account_id,
        proof.conversationId,
        proof.messageId,
        JSON.stringify(message),
        proof.sentAt,
        iso(now)
      )
    const next = saveContact(
      id,
      {
        state: personalized ? 'completed' : 'cooling',
        openedAt: row.body.openedAt || proof.sentAt,
        conversationId: proof.conversationId,
        proof: personalized ? proof : undefined,
        defaultProof: personalized ? row.body.defaultProof : proof,
        baselineMessageId: proof.messageId,
        nextAt: personalized
          ? null
          : iso(Date.parse(proof.sentAt) + runtimePolicy().cooldownMinutes * 60000),
        completedAt: personalized ? iso(now) : null,
        reason: personalized ? '个性化匹配说明已由平台回读核验' : '已开聊，等待冷却后补充个性化说明'
      },
      now
    )
    if (personalized) {
      releaseReservation(id)
      linkContactOpportunity(next)
    }
    atlasEvent('contact-message-verified', id, {
      phase: row.body.phase,
      messageId: proof.messageId
    })
    return next
  })
}
function linkRelatedContactJob(account:string,job:any,taskId:string) {
  if(atlasDb().prepare('SELECT 1 FROM opportunities WHERE id=?').get(`boss:${account}:job:${job.encryptJobId}`))return
  linkContactOpportunity({id:taskId,account_id:account,job_id:job.encryptJobId,recruiter_id:job.encryptBossId,state:'related',body:{job}})
}
export function linkContactOpportunity(row: any) {
  const snapshot = readCareerSnapshot(),
    id = `boss:${row.account_id}:job:${row.job_id}`
  const verified = ['completed','manual'].includes(row.state)
  let item = snapshot.state.opportunities.find((o) => opportunityKey(o) === id)
  if (!item) {
    item = {
      id: randomUUID(),
      platform: 'boss',
      accountId: row.account_id,
      sourceId: row.job_id,
      sourceUrl: row.body.job.sourceUrl,
      job: row.body.job,
      stage: verified ? '已沟通' : '待评估',
      nextDate: '',
      note: verified ? (row.state==='manual' ? '本人确认已发送匹配说明，尚无平台回读凭据。' : '个性化匹配说明已核验发送。') : '同一招聘者关联的其他机会，复用联系安排或已有会话；尚未就此岗位发送介绍。',
      createdAt: iso()
    }
    snapshot.state.opportunities.push(item)
  } else if (verified && ['待评估', '计划联系'].includes(item.stage)) item.stage = '已沟通'
  const existing = atlasDb().prepare('SELECT body FROM opportunities WHERE id=?').get(id)
  if (existing) {
    const stage = JSON.parse(existing.body).stage
    if (['已投递', '面试中', 'Offer', '已结束'].includes(stage)) item.stage = stage
  }
  atlasWrite('career-workspace.json', snapshot.state, 'automatic-contact')
  const indexed = buildOpportunities(snapshot.state, [], snapshot.preferences).find(
    (o) => o.id === id
  )
  if (indexed) indexOpportunity({ ...indexed, bossId: row.recruiter_id })
  atlasEvent('contact-linked', id, {
    contactId: row.id,
    conversationId: row.body.conversationId,
    messageId: row.body.proof?.messageId || '',
    verification: row.state === 'manual' ? 'manual' : verified ? 'platform' : 'related-only'
  })
}
export function contactAction(input: any) {
  return atlasTransaction(() => {
    const account = currentAccount(input),
      row = contactRun(input.id)
    if (!row || row.account_id !== account) throw Error('联系任务不属于当前账号')
    if (row.revision !== input.revision) throw Error('记录已更新，请读取最新状态；原内容保留')
    if (
      atlasDb()
        .prepare('SELECT 1 FROM leases WHERE key=? AND expires_at>?')
        .get('contact:' + row.id, Date.now())
    )
      throw Error('任务仍在处理，请先暂停发送并等待收尾')
    if (input.action === 'approve') {
      if (row.state !== 'awaiting_confirmation') throw Error('此任务不在话术确认阶段')
      if (input.text !== row.body.greeting?.text || input.confirmed !== true)
        throw Error('请核对当前完整话术后勾选确认')
      const job = contactJob(account, row.job_id), match = contactMatch(job, { account })
      if (!match.eligible || match.profileVersion !== row.body.profileVersion ||
          match.analysisId !== row.body.analysisId || match.jobBasis !== row.body.jobBasis ||
          !greetingCurrent(row.body.greeting, job))
        throw Error('资料、岗位或模型已变化，请重新准备话术；原草稿保留')
      const next = saveContact(row.id, { approval: { basis: contactApprovalBasis(row), at: iso() },
        state: row.body.openedAt ? 'cooling' : 'ready', reason: '本人已确认这段话术，等待运行时段与发送检查' })
      atlasEvent('contact-content-approved', row.id, { basis: next.body.approval.basis })
      return next
    }
    if (input.action === 'cancel') {
      if (['opening', 'sending', 'verifying', 'completed', 'manual'].includes(row.state))
        throw Error('此阶段无法取消，请先核实结果')
      releaseReservation(row.id)
      return saveContact(row.id, { state: 'cancelled', reason: '本人取消；已有发送记录保留' })
    }
    if (['sent', 'not-sent', 'unknown'].includes(input.action)) {
      if (!['uncertain', 'review'].includes(row.state)) throw Error('该任务不需要人工核实')
      if (input.action === 'unknown')
        return saveContact(row.id, { state: 'uncertain', reason: '本人仍无法确定，禁止自动重发' })
      const sent = input.action === 'sent',
        phase = row.body.phase
      if (row.body.attemptId) {
        atlasDb()
          .prepare('UPDATE send_attempts SET proof=? WHERE id=?')
          .run(
            JSON.stringify({ method: 'manual', at: iso(), result: input.action }),
            row.body.attemptId
          )
        finishSend(row.body.attemptId, sent ? 'sent' : 'cancelled')
      }
      releaseReservation(row.id)
      const next = saveContact(row.id, {
        state: sent && phase === 'personalized' ? 'manual' : 'review',
        reason: sent ? '本人确认已发送；核验方式为人工' : '本人确认未发送；请明确重新排队',
        retryAllowed: !sent,
        openedAt: sent && phase === 'default' ? row.body.openedAt || iso() : row.body.openedAt
      })
      if (next.state === 'manual') linkContactOpportunity(next)
      atlasEvent('contact-resolved', row.id, { action: input.action, phase })
      return next
    }
    if (input.action === 'retry') {
      if (
        !['failed', 'review', 'cancelled'].includes(row.state) ||
        (row.body.attemptId && !row.body.retryAllowed)
      )
        throw Error('发送结果尚未明确，禁止重新排队')
      const job = contactJob(account, row.job_id),
        match = contactMatch(job, { account })
      if (!match.eligible) throw Error(match.reasons.join('；'))
      return saveContact(row.id, {
        state: row.body.openedAt ? 'cooling' : 'queued',
        reason: '本人重新排队，发送前再次核查',
        retryAllowed: false,
        attemptId: '',
        greeting: undefined,
        approval: undefined,
        generation: row.body.generation + 1,
        profileVersion: match.profileVersion,
        analysisId: match.analysisId,
        jobBasis: match.jobBasis,
        job
      })
    }
    throw Error('不支持的联系操作')
  })
}
// Explicit preparation is allowed while sending is paused; it has no browser capability.
export async function prepareContact(input: any) {
  const account = currentAccount(input), job = contactJob(account, input.jobId)
  const match = contactMatch(job, { account })
  if (!match.eligible) throw Error(match.reasons.join('；'))
  const queued = enqueueContact(account, job), id = queued.id
  if (!id) throw Error('该岗位已有会话或无法建立联系任务，请到沟通中心处理')
  const owner = acquireLease('contact:' + id)
  if (!owner) throw Error('该联系任务正在处理，请等待当前任务完成')
  const controller = new AbortController(), abort = () => controller.abort()
  input.signal?.addEventListener('abort', abort, { once: true })
  if (input.signal?.aborted) controller.abort()
  const stop = keepLeaseAlive('contact:' + id, owner, abort)
  let generating = false
  try {
    const row = contactRun(id)
    if (row.body.greeting && greetingCurrent(row.body.greeting, job) &&
        ['awaiting_confirmation','ready','cooling'].includes(row.state)) return row
    if (row.state !== 'queued' || row.body.attemptId) throw Error('请先在联系结果中处理当前任务，不能重复调用模型')
    const generated = atlasDb().prepare("SELECT count(*) n FROM contact_runs WHERE json_extract(body,'$.generationDay')=?").get(dayOf()).n
    if (generated >= runtimePolicy().firstContactLimit) throw Error('今日首次联系话术准备额度已用完')
    saveContact(id, { state: 'generating', generationDay: dayOf(), reason: '正在准备话术；自动发送保持原状态' })
    generating = true
    const greeting = await withExecutionTask('contact:'+id,()=>generateGreeting({ job, purpose: 'automatic', baseProfileVersion: match.profileVersion,
      analysis: atlasRead<any>(discoveryItemKey(account, job.encryptJobId), {}).analysis, signal: controller.signal }))
    if (controller.signal.aborted || currentAccount(input) !== account) throw Error('话术准备已取消或账号发生变化')
    const latestJob = contactJob(account, job.encryptJobId), latest = contactMatch(latestJob, { account })
    if (!latest.eligible || latest.profileVersion !== match.profileVersion || latest.analysisId !== match.analysisId ||
        latest.jobBasis !== match.jobBasis || !greetingCurrent(greeting, latestJob)) throw Error('准备期间资料或岗位变化，原记录保留，请重新核对')
    if (!greeting.readyForAutomation) throw Error(greeting.reviewReasons.join('；') || '话术未通过事实核验')
    return saveContact(id, { greeting, approval: null, state: 'awaiting_confirmation', reason: '请核对这段匹配说明并确认；尚未操作 BOSS' })
  } catch (e: any) {
    if (generating) saveContact(id, { state: 'failed', reason: String(e.message).slice(0,500), retryAllowed: true })
    throw e
  } finally { stop(); input.signal?.removeEventListener('abort', abort); releaseLease('contact:' + id, owner) }
}
export interface ContactAdapter {
  inspect(
    row: any
  ): Promise<{
    mode: 'default' | 'direct' | 'existing' | 'blocked'
    reason?: string
    draft?: string
    typing?: boolean
    latestMessageId?: string
    incoming?: boolean
  }>
  open(row: any): Promise<ContactProof>
  send(row: any): Promise<ContactProof>
  dispose?(): void
}
export async function contactTick(adapter: ContactAdapter, now = Date.now()) {
  if (
    runtimePolicy().paused ||
    !runtimePolicy().outbound ||
    allAutomationPaused() ||
    !discoveryAccount()
  )
    return
  const account = discoveryAccount(),
    db = atlasDb()
  if (atlasRead<any>('atlas-contact-authorization', {}).accountId !== account) return
  // Abandoned effects are never replayed; abandoned generation may have consumed tokens.
  const abandoned = db
    .prepare(
      "SELECT id,state FROM contact_runs WHERE account_id=? AND state IN ('generating','opening','sending','verifying') AND updated_at<? AND NOT EXISTS(SELECT 1 FROM leases WHERE key='contact:'||contact_runs.id AND expires_at>?)"
    )
    .all(account, iso(now - 90000), now)
  for (const r of abandoned) {
    const row = contactRun(r.id)
    if (row.body.attemptId) finishSend(row.body.attemptId, 'uncertain')
    saveContact(r.id, {
      state: r.state === 'generating' ? 'failed' : 'uncertain',
      reason: '进程中断，未自动重试；请核对结果'
    })
    releaseReservation(r.id)
  }
  const platformExhausted = platformContactLimit(account, now).state === 'exhausted', authorization = atlasRead<any>('atlas-contact-authorization', {})
  const raw = db
    .prepare(
      "SELECT * FROM contact_runs WHERE account_id=? AND state IN ('queued','ready','cooling','awaiting_confirmation') AND (?=0 OR json_extract(body,'$.openedAt') IS NOT NULL) AND (json_extract(body,'$.nextAt') IS NULL OR json_extract(body,'$.nextAt')<=?) ORDER BY CASE state WHEN 'cooling' THEN 0 WHEN 'ready' THEN 1 ELSE 2 END,created_at"
    )
    .all(account, platformExhausted ? 1 : 0, iso(now))
    .find((r: any) => {
      const row = { ...r, body: JSON.parse(r.body) }
      return !taskExecutionPaused('contact:'+row.id) && contactChannelAllowed(row, authorization) && (row.state !== 'awaiting_confirmation' || authorization.mode === 'automatic')
    })
  if (!raw) return
  const owner = acquireLease('contact:' + raw.id)
  if (!owner) return
  const controller = new AbortController(),
    stop = keepLeaseAlive('contact:' + raw.id, owner, () => controller.abort())
  let stopBrowser: (() => void) | undefined
  let browser: string | null = null,
    timer: ReturnType<typeof setInterval> | undefined
  try {
    let row = contactRun(raw.id)
    const current = () =>
      !controller.signal.aborted &&
      account === discoveryAccount() &&
      atlasRead<any>('atlas-contact-authorization', {}).accountId === account &&
      !runtimePolicy().paused &&
      runtimePolicy().outbound &&
      !allAutomationPaused() &&
      !taskExecutionPaused('contact:'+row.id) &&
      contactChannelAllowed(row, atlasRead<any>('atlas-contact-authorization', {}))
    timer = setInterval(() => {
      if (!current()) controller.abort()
    }, 1000)
    timer.unref()
    const job = contactJob(account, row.job_id),
      match = contactMatch(job, { account })
    if (
      !match.eligible ||
      match.profileVersion !== row.body.profileVersion ||
      match.analysisId !== row.body.analysisId ||
      match.jobBasis !== row.body.jobBasis
    ) {
      saveContact(row.id, {
        state: 'review',
        reason: match.reasons.join('；') || '资料、岗位或分析版本已变化',
        retryAllowed: !row.body.attemptId
      })
      releaseReservation(row.id)
      return
    }
    if (!row.body.greeting) {
      const q = contactQuota(now),
        hour = Number(
          new Date(now).toLocaleString('en-GB', {
            timeZone: 'Asia/Shanghai',
            hour: '2-digit',
            hour12: false
          })
        ),
        p = runtimePolicy()
      const generated = db
        .prepare("SELECT count(*) n FROM contact_runs WHERE json_extract(body,'$.generationDay')=?")
        .get(dayOf(now)).n
      if (
        hour < p.startHour ||
        hour >= p.endHour ||
        q.remaining < 1 ||
        (!row.body.openedAt && (q.firstRemaining < 1 || generated >= p.firstContactLimit))
      ) {
        saveContact(row.id, {
          reason: '等待运行时段或今日首次联系额度；尚未调用模型',
          nextAt: iso(now + 60000)
        })
        return
      }
      saveContact(row.id, {
        state: 'generating',
        generationDay: dayOf(now),
        reason: 'DeepSeek 根据完整 JD 与已确认经历生成匹配说明'
      })
      const greeting = await withExecutionTask('contact:'+row.id,()=>generateGreeting({
        job,
        purpose: 'automatic',
        baseProfileVersion: match.profileVersion,
        analysis: atlasRead<any>(discoveryItemKey(account, row.job_id), {}).analysis,
        signal: controller.signal
      }))
      if (!greeting.readyForAutomation)
        throw Error(greeting.reviewReasons.join('；') || '招呼未通过事实核验')
      row = saveContact(row.id, {
        greeting,
        state: 'awaiting_confirmation',
        approval: null,
        reason: '匹配说明已生成，请在机会发现核对并确认；尚未操作 BOSS'
      })
      if (!current()) return
    }
    if (!current()) return
    if (!greetingCurrent(row.body.greeting, job)) {
      saveContact(row.id, { state: 'review', approval: null, retryAllowed: !row.body.attemptId,
        reason: '话术依据或模型已变化，请重新准备；原草稿保留' })
      releaseReservation(row.id)
      return
    }
    if (!contactApprovalCurrent(row)) row = authorizeMatchedGreeting(row)
    if (!contactApprovalCurrent(row)) {
      if (row.state !== 'awaiting_confirmation') saveContact(row.id, {
        state: 'awaiting_confirmation', approval: null, reason: '请先核对并确认这段匹配说明，尚未操作 BOSS' })
      releaseReservation(row.id)
      return
    }
    browser = acquireLease('browser:boss:' + account)
    if (!browser) return
    stopBrowser = keepLeaseAlive('browser:boss:' + account, browser, () => controller.abort())
    const pre = await adapter.inspect(row)
    if (!current()) return
    if (
      pre.draft ||
      pre.typing ||
      (row.body.openedAt && (pre.incoming || pre.latestMessageId !== row.body.baselineMessageId))
    ) {
      saveContact(row.id, {
        state: 'review',
        reason: '会话已有回复、本人输入或消息变化，请在沟通中心处理'
      })
      releaseReservation(row.id)
      return
    }
    if (pre.mode === 'blocked') {
      saveContact(row.id, {
        state: 'review',
        reason: pre.reason || '平台动作尚未核实',
        retryAllowed: !row.body.attemptId
      })
      releaseReservation(row.id)
      return
    }
    if (pre.mode === 'existing' && !row.body.openedAt) {
      saveContact(row.id, {
        state: 'existing',
        reason: '已有会话，转入沟通中心，未重复发送首条介绍',
        conversationId: row.recruiter_id
      })
      releaseReservation(row.id)
      return
    }
    const slots = row.body.openedAt || pre.mode === 'direct' ? 1 : 2,
      waiting = reserveContact(row.id, slots, now)
    if (waiting) {
      saveContact(row.id, { reason: waiting, nextAt: iso(now + 60000) })
      return
    }
    // Re-read all versions immediately before reserving a platform effect.
    const latest = contactMatch(contactJob(account, row.job_id), { account })
    if (
      !current() ||
      !latest.eligible ||
      latest.analysisId !== row.body.analysisId ||
      latest.profileVersion !== row.body.profileVersion ||
      latest.jobBasis !== row.body.jobBasis ||
      !greetingCurrent(row.body.greeting, contactJob(account, row.job_id))
    )
      throw Error('发送前资料、岗位、分析或草稿已变化')
    const phase = !row.body.openedAt && pre.mode === 'default' ? 'default' : 'personalized'
    claimContactSend(
      row,
      phase === 'default' ? '[平台默认招呼，等待回读]' : row.body.greeting.text,
      phase,
      now
    )
    row = contactRun(row.id)
    const proof = await (phase === 'default' ? adapter.open(row) : adapter.send(row))
    // Verify against the tick clock so a controlled `now` (tests, backfills) stays
    // consistent with the attempt timestamp; in production `now` defaults to Date.now()
    // so Math.max(now, Date.now()) equals the previous real-time bound exactly.
    verifyContactSend(row.id, proof, Math.max(now, Date.now()))
  } catch (e: any) {
    const row = contactRun(raw.id),
      effect = ['opening', 'sending', 'verifying'].includes(row.state)
    if (effect && row.body.attemptId) finishSend(row.body.attemptId, 'uncertain')
    saveContact(row.id, {
      state: effect ? 'uncertain' : 'failed',
      reason: effect
        ? '平台结果不确定，未自动重试：' + String(e.message).slice(0, 200)
        : String(e.message).slice(0, 300),
      retryAllowed: !effect && !row.body.openedAt
    })
    releaseReservation(row.id)
  } finally {
    if (timer) clearInterval(timer)
    stopBrowser?.()
    if (browser) releaseLease('browser:boss:' + account, browser)
    stop()
    releaseLease('contact:' + raw.id, owner)
  }
}
const contactOutcomeFilters: Record<string, string> = {
  pending: "c.state IN ('queued','generating','awaiting_confirmation','ready')",
  opened: "json_extract(c.body,'$.openedAt') IS NOT NULL",
  replied: "c.state='completed' AND EXISTS(SELECT 1 FROM platform_messages m WHERE m.platform=c.platform AND m.account_id=c.account_id AND m.conversation_id=c.recruiter_id AND m.sent_at>json_extract(c.body,'$.proof.sentAt') AND json_extract(m.body,'$.direction')='received' AND json_extract(m.body,'$.type')='text')",
  interviews: "c.state='completed' AND EXISTS(SELECT 1 FROM opportunities o WHERE o.id='boss:'||c.account_id||':job:'||c.job_id AND json_extract(o.body,'$.stage') IN ('面试中','Offer'))"
}
export function contactResults(input: any = {}) {
  const account = discoveryAccount(),
    page = Math.max(1, Math.floor(Number(input.page) || 1)),
    filter = String(input.filter || 'all'),
    period = ['today', 'week', 'all'].includes(input.period) ? input.period : 'today'
  const start =
      period === 'all'
        ? ''
        : iso(Date.parse(dayOf() + 'T00:00:00+08:00') - (period === 'week' ? 6 * 86400000 : 0)),
    args: any[] = [account],
    where = ['c.account_id=?']
  if (input.channel && input.channel !== 'all') {
    if (!['targeted', 'recommended', 'other'].includes(input.channel)) throw Error('岗位来源无效')
    where.push("COALESCE(json_extract(c.body,'$.channels[0]'),'other')=?")
    args.push(input.channel)
  }
  if (contactOutcomeFilters[filter]) where.push(contactOutcomeFilters[filter])
  else if (filter !== 'all') {
    where.push('c.state=?')
    args.push(filter)
  }
  if (start && filter !== 'pending') {
    where.push('created_at>=?')
    args.push(start)
  }
  const search = String(input.query || '')
    .trim()
    .slice(0, 100)
  if (search) {
    where.push(
      "(json_extract(body,'$.job.jobName') LIKE ? OR json_extract(body,'$.job.companyName') LIKE ?)"
    )
    args.push('%' + search + '%', '%' + search + '%')
  }
  const sql = where.join(' AND '),
    db = atlasDb()
  const rows = db
    .prepare(`SELECT c.* FROM contact_runs c WHERE ${sql} ORDER BY updated_at DESC LIMIT 20 OFFSET ?`)
    .all(...args, (page - 1) * 20)
    .map((r: any) => ({ ...r, body: JSON.parse(r.body) }))
  return {
    items: rows,
    total: db.prepare(`SELECT count(*) n FROM contact_runs c WHERE ${sql}`).get(...args).n,
    page,
    period,
    start,
    accountId: account
  }
}
export function contactSummary(input: any = {}) {
  const account = discoveryAccount(),
    db = atlasDb(),
    period = ['today', 'week', 'all'].includes(input.period) ? input.period : 'today',
    start =
      period === 'all'
        ? ''
        : iso(Date.parse(dayOf() + 'T00:00:00+08:00') - (period === 'week' ? 6 * 86400000 : 0))
  const stateCounts = Object.fromEntries(
    db
      .prepare('SELECT state,count(*) n FROM contact_runs WHERE account_id=? GROUP BY state')
      .all(account)
      .map((r: any) => [r.state, r.n])
  )
  const scope = "account_id=? AND (?='' OR created_at>=?)",
    args = [account, start, start]
  const cohort = db
    .prepare(`SELECT * FROM contact_runs WHERE ${scope}`)
    .all(...args)
    .map((r: any) => ({ ...r, body: JSON.parse(r.body) }))
  const completed = cohort.filter((r: any) => r.state === 'completed'),
    manual = cohort.filter((r: any) => r.state === 'manual')
  const outcomeCount = (filter: string) => db.prepare(`SELECT count(*) n FROM contact_runs c WHERE ${scope} AND ${contactOutcomeFilters[filter]}`).get(...args).n
  const replied = outcomeCount('replied'), interviews = outcomeCount('interviews')
  const sources = db
    .prepare(
      "SELECT change_kind,count(*) n FROM job_observations WHERE account_id=? AND (?='' OR observed_at>=?) GROUP BY change_kind"
    )
    .all(...args)
  const profile = canonicalProfile(),
    worker = atlasRead<any>('atlas-contact-worker', null)
  const blockers = db
    .prepare(
      "SELECT json_extract(body,'$.reason') reason,count(*) count FROM contact_runs WHERE account_id=? AND state IN ('review','uncertain','failed') GROUP BY reason LIMIT 8"
    )
    .all(account)
  const sent = db
    .prepare(
      "SELECT count(*) n FROM send_attempts WHERE account_id=? AND automatic=1 AND status='sent' AND (?='' OR created_at>=?)"
    )
    .get(...args).n
  const qualifies = db
    .prepare(
      "SELECT count(*) n FROM contact_runs WHERE account_id=? AND state IN ('queued','generating','awaiting_confirmation','ready')"
    )
    .get(account).n
  return {
    accountId: account,
    authorized: atlasRead<any>('atlas-contact-authorization', {}).accountId === account,
    period,
    start,
    policy: runtimePolicy(),
    policyRevision: atlasRevision(['atlas-runtime']),
    controlRevision: atlasRevision(['atlas-runtime', 'atlas-contact-authorization']),
    automationPaused: allAutomationPaused(),
    quota: contactQuota(),
    platformQuota: platformContactLimit(account),
    worker,
    states: stateCounts,
    blockers,
    reviewRequired: atlasRead<any>('atlas-contact-authorization', {}).accountId !== account || atlasRead<any>('atlas-contact-authorization', {}).mode !== 'automatic',
    channels: atlasRead<any>('atlas-contact-authorization', {}).channels || ['targeted', 'recommended'],
    channelStats: [...Object.keys(discoveryChannelLabels), 'other'].map(channel => {
      const rows = cohort.filter((r: any) => (r.body.channels?.[0] || 'other') === channel)
      return { channel, tasks: rows.length, completed: rows.filter((r: any) => r.state === 'completed').length,
        failed: rows.filter((r: any) => r.state === 'failed').length, uncertain: rows.filter((r: any) => r.state === 'uncertain').length,
        pending: rows.filter((r: any) => ['queued','generating','awaiting_confirmation','ready','cooling'].includes(r.state)).length }
    }),
    awaitingConfirmation: stateCounts.awaiting_confirmation || 0,
    evidence: {
      total: profile.evidence.length,
      confirmed: profile.evidence.filter((e) => e.confirmed).length
    },
    counts: {
      cohort: cohort.length,
      queued: qualifies,
      opened: cohort.filter((r: any) => r.body.openedAt).length,
      completed: completed.length,
      manual: manual.length,
      uncertain: cohort.filter((r: any) => r.state === 'uncertain').length,
      failed: cohort.filter((r: any) => r.state === 'failed').length,
      messages: sent,
      replied,
      interviews,
      resumeReceipts: db
        .prepare(
          "SELECT count(*) n FROM platform_messages WHERE account_id=? AND json_extract(body,'$.direction')='sent' AND json_extract(body,'$.type')='resume' AND (?='' OR sent_at>=?)"
        )
        .get(...args).n,
      companies: new Set(completed.map((r: any) => r.body.job.encryptCompanyId).filter(Boolean))
        .size,
      unknownCompanies: completed.filter((r: any) => !r.body.job.encryptCompanyId).length,
      recruiters: new Set(completed.map((r: any) => r.recruiter_id)).size
    },
    sources: Object.fromEntries(sources.map((r: any) => [r.change_kind, r.n])),
    cohortNote:
      '按所选时间内创建的首次联系任务，追踪截至当前的发送、回复与面试；消息数按发送日期统计。未覆盖的历史未知。'
  }
}
export function registerContact(handle: (name: string, fn: (...a: any[]) => any) => void) {
  handle('career-contact-prepare', (_, p) => prepareContact(p))
  handle('career-contact-summary', (_, p) => contactSummary(p))
  handle('career-contact-results', (_, p) => contactResults(p))
  handle('career-contact-match', (_, p) => contactMatch(contactJob(currentAccount(p), p.jobId)))
  handle('career-contact-action', (_, p) => contactAction(p))
  handle('career-contact-start', (_, p) => startContacts(p))
  handle('career-contact-enqueue', (_, p) =>
    enqueueContact(currentAccount(p), contactJob(p.accountId, p.jobId))
  )
}
