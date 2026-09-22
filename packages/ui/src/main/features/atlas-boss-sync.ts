import { queryProjection, storageStamp } from './atlas-query-projection'
import { markDiscovered } from './atlas-discovery-state'
import { atlasDb, atlasRead, atlasWrite, atlasTransaction } from './atlas-store'
import { accountSyncState, bossJobReadState } from './atlas-boss-account-state'
import { fingerprint } from './atlas-store'
import { randomUUID } from 'node:crypto'
import {
  bossId,
  bossMessageType,
  normalizeBossContact,
  normalizeBossJob,
  normalizeBossMessage,
  conversationPriority
} from '../../common/boss-sync'

const json = (v: unknown) => JSON.stringify(v)
const activeId = () => atlasRead<any>('career-boss-sync.json', null)?.account?.id || ''
export const bossCapturePaths = new Set([
  '/wapi/zpgeek/job/detail.json',
  '/wapi/zpgeek/pc/recommend/job/list.json',
  '/wapi/zpgeek/search/joblist.json',
  '/wapi/zpchat/geek/historyMsg'
])
export function bossCapturePath(value: string) {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' &&
      u.hostname === 'www.zhipin.com' &&
      bossCapturePaths.has(u.pathname)
      ? u.pathname
      : ''
  } catch {
    return ''
  }
}
function mergeKnown(old: any, next: any) {
  const merged = { ...old }
  for (const [key, value] of Object.entries(next))
    if (value !== '' && value !== undefined && value !== null) merged[key] = value
  return merged
}
function saveJob(account: string, job: any, detail: boolean, now: string) {
  const db = atlasDb(),
    old = db
      .prepare("SELECT * FROM platform_jobs WHERE platform='boss' AND account_id=? AND source_id=?")
      .get(account, job.encryptJobId)
  const previous = old ? JSON.parse(old.body) : {},
    next = mergeKnown(previous, job)
  if (job.workAddresses?.length > 1) next.address = ''
  // Summary responses must never replace complete JD/salary fields already observed.
  if (!detail && old?.detail_at)
    for (const key of Object.keys(previous))
      if (previous[key] !== '' && previous[key] != null) next[key] = previous[key]
  const detailAt = detail ? now : old?.detail_at || ''
  db.prepare(
    "INSERT INTO platform_jobs VALUES('boss',?,?,?,?,?) ON CONFLICT(platform,account_id,source_id) DO UPDATE SET body=excluded.body,observed_at=excluded.observed_at,detail_at=excluded.detail_at"
  ).run(account, job.encryptJobId, json(next), now, detailAt)
  if (detail) {
    const stable = { ...next }
    delete stable.activeStatus
    // Adjacent equal snapshots are ignored; A → B → A remains a real history.
    const last = db
      .prepare(
        "SELECT body FROM platform_job_history WHERE platform='boss' AND account_id=? AND source_id=? ORDER BY observed_at DESC,rowid DESC LIMIT 1"
      )
      .get(account, job.encryptJobId)
    if (!last || last.body !== json(stable))
      db.prepare("INSERT INTO platform_job_history VALUES(?,'boss',?,?,?,?)").run(
        randomUUID(),
        account,
        job.encryptJobId,
        json(stable),
        now
      )
  }
  return {...next,_atlasChangeKind:!old?'new':old.body===json(next)?'duplicate':'updated'}
}
export function ingestBossJobs(account: string, payload: any, pathname: string, meta: {origin?:string;runId?:string;keyword?:string} = {}) {
  if (!account || account !== activeId()) return { saved: 0, reason: 'account-changed' }
  if (payload?.code !== 0) return { saved: 0, reason: 'platform-error' }
  const detail = pathname === '/wapi/zpgeek/job/detail.json'
  const allowed =
    detail ||
    ['/wapi/zpgeek/pc/recommend/job/list.json', '/wapi/zpgeek/search/joblist.json'].includes(
      pathname
    )
  if (!allowed) return { saved: 0, reason: 'unsupported' }
  const raw = detail ? [payload.zpData] : payload.zpData?.jobList
  if (!Array.isArray(raw)) return { saved: 0, reason: 'schema-changed' }
  const jobs = raw
    .slice(0, 100)
    .map((v: any) => normalizeBossJob(v, detail))
    .filter(Boolean)
  if (!jobs.length) return { saved: 0, reason: raw.length ? 'schema-changed' : 'empty' }
  return atlasTransaction(() => {
    const now = new Date().toISOString()
    const savedJobs=jobs.map(job=>saveJob(account,job,detail,now))
    markDiscovered(account,savedJobs,meta.origin || (detail?'BOSS 职位详情':pathname.includes('recommend')?'BOSS 推荐':'BOSS 搜索'),meta.runId,meta.keyword)
    atlasWrite('atlas-boss-capture-status', {
      accountId: account,
      at: now,
      state: 'connected',
      lastKind: detail ? '岗位详情' : '岗位列表'
    })
    return { saved: jobs.length, added:savedJobs.filter(j=>j._atlasChangeKind==='new').length, updated:savedJobs.filter(j=>j._atlasChangeKind==='updated').length, duplicates:savedJobs.filter(j=>j._atlasChangeKind==='duplicate').length, reason: '' }
  })
}
export function ingestBossPublicJobs(items: any) {
  const current = atlasRead<any>('career-boss-sync.json', null)
  if (!current?.account?.id || !Array.isArray(items)) return { saved: 0 }
  const known = new Set((current.items || []).map((row: any) => row.encryptJobId))
  let saved = 0
  for (const data of items.slice(0, 10)) {
    const id = bossId(data?.jobInfo?.encryptId)
    // Public job content has no private account state. Only enrich an existing
    // exact source ID; never change the logged-in account or infer a company match.
    if (!id || !known.has(id) || data?.sourceKind !== 'rendered-public-job' ||
      data.pageUrl !== `https://www.zhipin.com/job_detail/${encodeURIComponent(id)}.html`) continue
    saved += ingestBossJobs(current.account.id, { code: 0, zpData: data }, '/wapi/zpgeek/job/detail.json').saved
  }
  return { saved }
}
export function ingestBossSnapshot(snapshot: any) {
  const account = bossId(snapshot?.account?.id)
  if (!account || account !== activeId()) return
  return atlasTransaction(() => {
    const db = atlasDb(),
      now = new Date().toISOString()
    for (const raw of Array.isArray(snapshot.items) ? snapshot.items.slice(0, 5000) : []) {
      const contact = normalizeBossContact(raw)
      if (!contact) continue
      const old = db
        .prepare(
          "SELECT body FROM platform_conversations WHERE platform='boss' AND account_id=? AND source_id=?"
        )
        .get(account, contact.bossId)
      const previous = old ? JSON.parse(old.body) : {},
        next = mergeKnown(previous, contact)
      if ((contact.unreadCount || 0) > 0) {
        const alertKey = fingerprint([contact.lastMessageAt, contact.lastText])
        next.atlasAlertKey = alertKey
        if (previous.atlasAcknowledgedKey !== alertKey) next.atlasUnreadCount = contact.unreadCount
      }
      // Empty last text is valid if observed; unknown fields never clear known values.
      if (typeof raw.lastText === 'string') next.lastText = contact.lastText
      const jobs = new Set<string>(Array.isArray(previous.jobIds) ? previous.jobIds : [])
      if (contact.encryptJobId) jobs.add(contact.encryptJobId)
      next.jobIds = [...jobs]
      db.prepare(
        "INSERT INTO platform_conversations VALUES('boss',?,?,?,?,'') ON CONFLICT(platform,account_id,source_id) DO UPDATE SET body=excluded.body,observed_at=excluded.observed_at"
      ).run(account, contact.bossId, json(next), now)
    }
    const conversation = snapshot.conversation,
      id = bossId(conversation?.bossId)
    // The selected contact and conversation header must agree in the page reader.
    if (!id || !conversation?.identityVerified || !Array.isArray(conversation.messages)) return
    let existing = db
      .prepare(
        "SELECT body FROM platform_conversations WHERE platform='boss' AND account_id=? AND source_id=?"
      )
      .get(account, id)
    if (!existing) {
      const contact = normalizeBossContact({
        bossId: id,
        bossName: conversation.bossName,
        companyName: conversation.companyName,
        encryptJobId: conversation.encryptJobId
      })!
      db.prepare("INSERT INTO platform_conversations VALUES('boss',?,?,?,?,'')").run(
        account,
        id,
        json(contact),
        now
      )
      existing = { body: json(contact) }
    }
    let accepted = 0,
      skipped = 0
    for (const raw of conversation.messages.slice(-2000)) {
      const message = normalizeBossMessage(raw)
      if (!message) {
        skipped++
        continue
      }
      accepted++
      const old = db
        .prepare(
          "SELECT body FROM platform_messages WHERE platform='boss' AND account_id=? AND conversation_id=? AND source_id=?"
        )
        .get(account, id, message.id)
      if (old) {
        const previous = JSON.parse(old.body)
        if (previous.direction !== message.direction) {
          skipped++
          accepted--
          continue
        }
      }
      db.prepare(
        "INSERT INTO platform_messages VALUES('boss',?,?,?,?,?,?) ON CONFLICT(platform,account_id,conversation_id,source_id) DO UPDATE SET body=excluded.body,sent_at=CASE WHEN excluded.sent_at='' THEN platform_messages.sent_at ELSE excluded.sent_at END"
      ).run(account, id, message.id, json(message), message.sentAt, now)
    }
    const body = {
      ...JSON.parse(existing.body),
      loadedMessageCount: accepted,
      skippedMessageCount: skipped,
      historyScope: 'loaded',
      draftActive: !!snapshot.draftActive
    }
    db.prepare(
      "UPDATE platform_conversations SET body=?,message_observed_at=? WHERE platform='boss' AND account_id=? AND source_id=?"
    ).run(json(body), now, account, id)
  })
}
export function capturedBossJobs(account = activeId()) {
  if (!account) return []
  return atlasDb()
    .prepare(
      "SELECT body,observed_at,detail_at FROM platform_jobs WHERE platform='boss' AND account_id=? ORDER BY observed_at DESC,source_id"
    )
    .all(account)
    .map((r: any) => ({ description: '', address: '', ...JSON.parse(r.body), observedAt: r.observed_at, detailAt: r.detail_at }))
}
export function bossSyncCoverage(account = activeId()) {
  const db = atlasDb()
  const jobs = capturedBossJobs(account),
    byId = new Map(jobs.map((j: any) => [j.encryptJobId, j]))
  const current = atlasRead<any>('career-boss-sync.json', null),
    items = current?.account?.id === account ? current.items || [] : []
  const contacts = new Set(items.map((x: any) => x.bossId)),
    ids = [...new Set<string>(items.map((x: any) => x.encryptJobId).filter(Boolean))]
  const matched: any[] = ids.map((id) => byId.get(id)).filter(Boolean)
  const complete = (key: string) => matched.filter((j) => !!j[key]).length
  const count = db
    .prepare("SELECT COUNT(*) n FROM platform_messages WHERE platform='boss' AND account_id=?")
    .get(account).n
  return {
    accountId: account,
    checkedAt: new Date().toISOString(),
    lastDataAt: current?.account?.id === account ? current.updatedAt || '' : '',
    conversations: contacts.size,
    linkedJobs: ids.length,
    linkedDetails: matched.filter((j) => j.detailAt).length,
    jobNames: complete('jobName'),
    descriptions: complete('description'),
    salaries: matched.filter((j) => j.salaryLow > 0 && j.salaryHigh > 0).length,
    addresses: complete('address'),
    observedJobs: jobs.length,
    messages: count,
    conversationsWithMessages: db
      .prepare(
        "SELECT COUNT(DISTINCT conversation_id) n FROM platform_messages WHERE platform='boss' AND account_id=?"
      )
      .get(account).n,
    unknownHistory: true,
    automatic: accountSyncState(account),
    scope: '自动补齐当前账号可读取的会话、正文和岗位；完整历史总量未知',
    capture:
      atlasRead<any>('atlas-boss-capture-status', null)?.accountId === account
        ? atlasRead('atlas-boss-capture-status', null)
        : null
  }
}
export function listBossConversations(input: any = {}) {
  const account = activeId(),
    limit = 30,
    page = Math.max(1, Math.min(10000, Math.floor(Number(input.page) || 1))),
    query = String(input.query || '')
      .trim()
      .slice(0, 200)
      .toLowerCase()
  const db=atlasDb(), projection=queryProjection(db,'conversations',fingerprint([account,storageStamp(db,['platform_jobs','platform_conversations','atlas-restore-epoch'])]),()=>{
  const rows = db.prepare(`SELECT c.body,c.observed_at,c.message_observed_at,json_extract(j.body,'$.jobName') job_name,json_extract(j.body,'$.companyName') company_name FROM platform_conversations c LEFT JOIN platform_jobs j ON j.platform=c.platform AND j.account_id=c.account_id AND j.source_id=json_extract(c.body,'$.encryptJobId') WHERE c.platform='boss' AND c.account_id=?`).all(account)
    .map((r: any) => {
      const body = JSON.parse(r.body)
      return {
        ...body,
        jobName: r.job_name || body.jobName,
        companyName: r.company_name || body.companyName,
        accountId: account,
        observedAt: r.observed_at,
        messageObservedAt: r.message_observed_at,
        ...conversationPriority(body)
      }
    })
  const counts: Record<string, number> = {
    all: rows.length,
    important: 0,
    reply: 0,
    unread: 0,
    attention: 0,
    waiting: 0,
    unknown: 0
  }
  for (const r of rows) {
    if (r.bucket !== 'unread') counts[r.bucket]++
    if (r.unreadCount > 0) counts.unread++
    if (r.atlasUnreadCount > 0) counts.attention++
  }
    rows.sort((a:any,b:any)=>a.rank-b.rank||(b.lastMessageAt||'').localeCompare(a.lastMessageAt||'')||a.bossId.localeCompare(b.bossId))
    return {rows,counts}
  },r=>({id:r.bossId,search:`${r.companyName} ${r.bossName} ${r.jobName} ${r.lastText}`.toLowerCase(),bucket:r.bucket,unread:r.unreadCount>0,attention:r.atlasUnreadCount>0}))
  const where=['1=1'],args:any[]=[]
  if(input.filter && input.filter!=='all') {if(['unread','attention'].includes(input.filter))where.push(input.filter+'=1');else{where.push('bucket=?');args.push(input.filter)}}
  if(query){where.push('instr(search,?)>0');args.push(query)}
  const result=projection.page(where.join(' AND '),args,page,limit)
  return {
    accountId: account,
    items:result.items,
    total:result.total,
    page:result.page,
    pageSize: limit,
    counts:projection.counts,
    coverage: bossSyncCoverage(account)
  }
}
export function bossConversationDetail(input: any) {
  const account = activeId(),
    id = bossId(input?.bossId)
  if (!account || input?.accountId !== account) throw Error('BOSS 账号已变化，请重新读取会话')
  const db = atlasDb(),
    row = db
      .prepare(
        "SELECT body,message_observed_at FROM platform_conversations WHERE platform='boss' AND account_id=? AND source_id=?"
      )
      .get(account, id)
  if (!row) throw Error('会话尚未同步，请在 BOSS 打开该会话')
  const total = db
    .prepare(
      "SELECT COUNT(*) n FROM platform_messages WHERE platform='boss' AND account_id=? AND conversation_id=?"
    )
    .get(account, id).n
  const page = Math.min(
    Math.max(1, Math.floor(Number(input.page) || 1)),
    Math.max(1, Math.ceil(total / 50))
  )
  const messages = db
    .prepare(
      "SELECT body,sent_at,observed_at FROM platform_messages WHERE platform='boss' AND account_id=? AND conversation_id=? ORDER BY sent_at DESC,observed_at DESC,source_id DESC LIMIT 50 OFFSET ?"
    )
    .all(account, id, (page - 1) * 50)
    .map((r: any) => { const m = JSON.parse(r.body); return { ...m, type: m.type === 'other' ? bossMessageType(m.platformType) : m.type, sentAt: r.sent_at, observedAt: r.observed_at } })
    .reverse()
  const body = JSON.parse(row.body),
    jobs = capturedBossJobs(account).filter((j: any) =>
      (body.jobIds || [body.encryptJobId]).includes(j.encryptJobId)
    )
  return {
    accountId: account,
    body,
    messages,
    total,
    page,
    pageSize: 50,
    jobs,
    messageObservedAt: row.message_observed_at,
    scope: '已加载消息；时间未知的消息按采集顺序展示，未读取完整历史'
  }
}
export function bossJobHistory(input: any) {
  const account = activeId()
  if (input?.accountId !== account) throw Error('BOSS 账号已变化，请重新打开岗位')
  return atlasDb()
    .prepare(
      "SELECT body,observed_at FROM platform_job_history WHERE platform='boss' AND account_id=? AND source_id=? ORDER BY observed_at DESC,rowid DESC LIMIT 20"
    )
    .all(account, bossId(input.jobId))
    .map((r: any) => ({ job: JSON.parse(r.body), observedAt: r.observed_at }))
}
export function bossCommunicationMetrics() {
  const account = activeId(),
    since = new Date(Date.now() - 30 * 86400000).toISOString(),
    db = atlasDb()
  const sample = db
    .prepare(
      "SELECT conversation_id,MIN(CASE WHEN json_extract(body,'$.direction')='sent' THEN sent_at END) first_sent FROM platform_messages WHERE platform='boss' AND account_id=? AND sent_at>=? AND json_extract(body,'$.type')='text' AND length(json_extract(body,'$.text'))>0 GROUP BY conversation_id HAVING first_sent IS NOT NULL"
    )
    .all(account, since)
  let replied = 0
  for (const c of sample)
    if (
      db
        .prepare(
          "SELECT 1 FROM platform_messages WHERE platform='boss' AND account_id=? AND conversation_id=? AND sent_at>? AND json_extract(body,'$.direction')='received' AND json_extract(body,'$.type')='text' AND length(json_extract(body,'$.text'))>0 LIMIT 1"
        )
        .get(account, c.conversation_id, c.first_sent)
    )
      replied++
  return {
    since,
    days: 30,
    outboundConversations: sample.length,
    textReplyConversations: replied,
    textReplyRate: sample.length ? Math.round((replied / sample.length) * 100) : null,
    definition:
      '近 30 天已采集且有时间的文本消息；分母为有己方文本的会话，回应指随后出现的对方非空文本。仅为可见样本，不代表有效意向或全账号回复率。'
  }
}
// A result is a persisted observation, not a claim that platform history is complete.
export function bossSyncReport(input: any = {}) {
  const account = activeId(), db = atlasDb(), coverage = bossSyncCoverage(account)
  if (input.accountId && input.accountId !== account) throw Error('账号已变化，请重新读取同步结果')
  const jobs = new Map(capturedBossJobs(account).map((j: any) => [j.encryptJobId, j]))
  const messages = new Map(db.prepare("SELECT conversation_id,COUNT(*) n,MAX(observed_at) at FROM platform_messages WHERE platform='boss' AND account_id=? GROUP BY conversation_id").all(account).map((r: any) => [r.conversation_id, r]))
  const contacts = db.prepare("SELECT source_id,body,message_observed_at FROM platform_conversations WHERE platform='boss' AND account_id=?").all(account)
  const rows = contacts.map((r: any) => {
    const c = JSON.parse(r.body), m: any = messages.get(r.source_id)
    const ids: string[] = [...new Set<string>([...(c.jobIds || []), c.encryptJobId].filter(Boolean))]
    const associated = ids.map(id => {
      const j: any = jobs.get(id), read = bossJobReadState(account, id)
      const missing = [!j?.jobName && '岗位名称', !j?.description && '岗位要求', !(j?.salaryLow > 0 && j?.salaryHigh > 0) && '薪资区间', !j?.address && '工作地址'].filter(Boolean)
      return { jobId: id, jobName: j?.jobName || c.jobName || '岗位待补充', missing,
        address: j?.address || '', workAddresses: j?.workAddresses || [],
        detailAt: j?.detailAt || '', lastAttemptAt: read.at || '',
        reason: !missing.length ? '已采集岗位要求、薪资与工作地址' : j?.workAddresses?.length > 1 ? '存在多个工作地点，请在岗位详情中核实实际地点' : read.reason || (read.at ? '旧版读取未记录结果，可立即同步重新核实' : '等待后台读取关联职位页'),
        retryable: missing.length > 0, sourceUrl: j?.sourceUrl || `https://www.zhipin.com/job_detail/${encodeURIComponent(id)}.html` }
    })
    return { accountId: account, bossId: r.source_id, companyName: c.companyName || '企业待补充', bossName: c.bossName || '联系人',
      messages: m?.n || 0, messageAt: m?.at || r.message_observed_at || '',
      readAt: c.autoReadAt || m?.at || '', readVerified: c.autoReadVerified === true,
      historyReason: c.autoReadReason || (m?.n ? '已保存当前页面消息；后台历史尚未核实' : '等待后台读取；完整历史总量未知'),
      jobs: associated, needsAttention: !m?.n || c.autoReadVerified === false || !ids.length || associated.some(j => j.missing.length > 0),
      missingJobId: !ids.length, skippedMessages: c.skippedMessageCount || 0 }
  }).sort((a: any, b: any) => Number(b.needsAttention) - Number(a.needsAttention) || a.companyName.localeCompare(b.companyName, 'zh-CN'))
  const query = String(input.query || '').trim().slice(0, 200).toLowerCase()
  const filtered = rows.filter((r: any) => (!input.onlyMissing || r.needsAttention) && (!query || `${r.companyName} ${r.bossName} ${r.jobs.map(j => j.jobName).join(' ')}`.toLowerCase().includes(query)))
  const page = Math.min(Math.max(1, Math.floor(Number(input.page) || 1)), Math.max(1, Math.ceil(filtered.length / 20)))
  const missing = rows.filter((r: any) => r.needsAttention).length
  return { accountId: account, checkedAt: coverage.checkedAt, coverage, missing, total: filtered.length,
    page, pageSize: 20, items: filtered.slice((page - 1) * 20, page * 20),
    outcome: !rows.length ? 'waiting' : missing ? 'partial' : 'available',
    outcomeLabel: !rows.length ? '等待账号数据' : missing ? `已保存可读取数据 · ${missing} 个会话仍有缺项` : '当前会话与岗位字段已齐备 · 完整历史未验证',
    capabilities: [
      { name: '联系人与消息', state: '已接入', detail: '后台读取当前账号可加载内容，按账号和消息 ID 去重。完整历史总量未知。' },
      { name: '职位与地址', state: '已接入', detail: '真实职位详情按来源 ID 关联；缺失地址和多工作地点单独标记。' },
      { name: '附件与媒体', state: '类型记录', detail: '图片、简历、卡片、语音保留类型和已有文本；文件内容需在 BOSS 查看。' },
      { name: '投递、面试、Offer', state: '本人核实', detail: '会话不等于正式投递；可在企业机会详情记录面试、结果与待办。' },
      { name: '猎聘自动同步', state: '待接入', detail: '本版未完成真实账号验证；可使用任务与数据中心的 CSV / JSON 导入。' }
    ] }
}
export function registerBossSync(handle: (name: string, handler: (...args: any[]) => any) => void) {
  handle('career-boss-sync-report', (_, input) => bossSyncReport(input))
  handle('career-boss-conversations', (_, input) => listBossConversations(input))
  handle('career-boss-conversation', (_, input) => bossConversationDetail(input))
  handle('career-boss-job-history', (_, input) => bossJobHistory(input))
  handle('career-boss-metrics', bossCommunicationMetrics)
}
