import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  atlasDb,
  atlasRoot,
  atlasRead,
  atlasWrite,
  atlasTransaction,
  fingerprint
} from './atlas-store'
import { discoveryItemKey } from './atlas-discovery-state'

type Row = Record<string, any>
type JobHistory = { contacts: Row[]; exclusions: Row[] }
const origin = '旧档案迁移'
const marker = 'atlas-unified-data'
const tables = [
  'user_info',
  'job_info',
  'company_info',
  'boss_info',
  'chat_startup_log',
  'mark_as_not_suit_log',
  'chat_message_record',
  'job_info_change_log',
  'company_info_change_log',
  'boss_info_change_log',
  'boss_active_status_record',
  'job_hire_status_record',
  'auto_start_chat_run_record'
] as const
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const identifier = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'
    ? String(value).trim()
    : ''
const serialize = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? String(v) : v))
function timestamp(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  const parsed = typeof value === 'number' ? value : Date.parse(text(value))
  const date = new Date(parsed)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}
function index(rows: Iterable<Row>, field: string) {
  const result = new Map<string, Row | null>()
  for (const row of rows) {
    const key = identifier(row[field])
    if (!key) continue
    if (!result.has(key)) result.set(key, row)
    else if (serialize(result.get(key)) !== serialize(row)) result.set(key, null)
  }
  return result
}
function participants(row: Row, users: Set<string>) {
  const from = identifier(row.encryptFromUserId),
    to = identifier(row.encryptToUserId)
  if (users.has(from) === users.has(to)) return null
  const account = users.has(from) ? from : to,
    bossId = users.has(from) ? to : from
  const explicit = identifier(row.encryptCurrentUserId)
  return bossId && (!explicit || explicit === account) ? { account, bossId } : null
}
function accountFor(table: string, row: Row, users: Set<string>): string {
  if (table === 'chat_message_record') return participants(row, users)?.account || ''
  const explicit = identifier(table === 'user_info' ? row.encryptUserId : row.encryptCurrentUserId)
  if (explicit) return users.has(explicit) ? explicit : ''
  const from = identifier(row.encryptFromUserId),
    to = identifier(row.encryptToUserId)
  return users.has(from) !== users.has(to) ? (users.has(from) ? from : to) : ''
}
function recordId(row: Row) {
  for (const field of [
    'id',
    'mid',
    'encryptJobId',
    'encryptCompanyId',
    'encryptBossId',
    'encryptUserId'
  ]) {
    const value = identifier(row[field])
    if (value) return value
  }
  return fingerprint(JSON.parse(serialize(row)))
}
function archiveRows(table: string, account?: string): Iterable<Row> {
  const sql =
    'SELECT body FROM legacy_records WHERE source_table=?' +
    (account === undefined ? '' : ' AND account_id=?')
  const args = account === undefined ? [table] : [table, account]
  const statement = atlasDb().prepare(sql)
  return {
    *[Symbol.iterator]() {
      for (const row of statement.iterate(...args)) yield JSON.parse(row.body)
    }
  }
}

/** Read-only source snapshot, one target transaction, no platform or model actions. */
export function importHistoricalData() {
  const completed = atlasRead<Row | null>(marker, null)
  if (completed?.completed) return completed
  const restored = atlasRead<Row | null>('atlas-restored-legacy', null)
  if (restored?.disabled) return { completed: true, absent: true, counts: {} }
  const filename = restored?.file ?? 'public.db'
  if (
    typeof filename !== 'string' ||
    path.basename(filename) !== filename ||
    filename === '.' ||
    filename === '..'
  )
    throw Error('历史档案路径无效，原资料已保留')
  const file = path.join(atlasRoot(), 'storage', filename)
  if (!fs.existsSync(file)) return { completed: true, absent: true, counts: {} }
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    throw Error('历史档案必须是本机独立文件，原资料已保留')
  const source = new DatabaseSync(file, { readOnly: true })
  try {
    source.exec('PRAGMA query_only=ON; BEGIN')
    const available = new Set(
      source
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((row) => row.name)
    )
    const rows = (table: (typeof tables)[number]): Iterable<Row> =>
      available.has(table) ? source.prepare(`SELECT * FROM "${table}"`).iterate() : []
    const users = new Set(
      [...rows('user_info')].map((row) => identifier(row.encryptUserId)).filter(Boolean)
    )
    const jobs = index(rows('job_info'), 'encryptJobId')
    const companies = index(rows('company_info'), 'encryptCompanyId')
    const recruiters = index(rows('boss_info'), 'encryptBossId')
    return atlasTransaction(() => {
      // A second process may have completed the import while this source opened.
      const previous = atlasRead<Row | null>(marker, null)
      if (previous?.completed) return previous
      const db = atlasDb(),
        now = new Date().toISOString()
      const counts: Record<string, number> = {}
      const histories = new Map<string, Map<string, JobHistory>>()
      const messageDigests = new Map<string, string | null>()
      const insertArchive = db.prepare('INSERT OR IGNORE INTO legacy_records VALUES(?,?,?,?,?)')
      const existingArchive = db.prepare(
        'SELECT body FROM legacy_records WHERE source_table=? AND source_id=? AND account_id=?'
      )
      let collisions = 0
      for (const table of tables) {
        counts[table] = 0
        for (const row of rows(table)) {
          counts[table]++
          const account = accountFor(table, row, users),
            body = serialize(row)
          let id = recordId(row)
          const prior = existingArchive.get(table, id, account)
          if (prior && prior.body !== body) {
            // Preserve conflicting source records for review, never discard one.
            id += ':' + fingerprint(JSON.parse(body))
            collisions++
          }
          insertArchive.run(table, id, account, body, now)
          if (table === 'chat_message_record') {
            const actors = participants(row, users),
              mid = identifier(row.mid)
            if (actors && mid) {
              const key = JSON.stringify([actors.account, actors.bossId, mid]),
                digest = fingerprint(JSON.parse(body))
              if (!messageDigests.has(key)) messageDigests.set(key, digest)
              else if (messageDigests.get(key) !== digest) messageDigests.set(key, null)
            }
          }
          if ((table !== 'chat_startup_log' && table !== 'mark_as_not_suit_log') || !account)
            continue
          const jobId = identifier(row.encryptJobId)
          if (!jobId) continue
          const accountJobs = histories.get(account) || new Map<string, JobHistory>()
          const history = accountJobs.get(jobId) || { contacts: [], exclusions: [] }
          history[table === 'chat_startup_log' ? 'contacts' : 'exclusions'].push(row)
          accountJobs.set(jobId, history)
          histories.set(account, accountJobs)
        }
      }
      const insertJob = db.prepare("INSERT OR IGNORE INTO platform_jobs VALUES('boss',?,?,?,?,?)")
      const recruiterJobs = new Map<string, Map<string, Row[]>>()
      for (const [account, accountJobs] of histories) {
        const byRecruiter = new Map<string, Row[]>()
        recruiterJobs.set(account, byRecruiter)
        for (const [jobId, history] of accountJobs) {
          const job = jobs.get(jobId)
          if (!job) continue
          const company = companies.get(identifier(job.encryptCompanyId))
          const body = {
            ...job,
            companyName: company?.name || company?.brandName || job.companyName || '',
            sourceUrl: `https://www.zhipin.com/job_detail/${encodeURIComponent(jobId)}.html`,
            source: origin
          }
          insertJob.run(account, jobId, serialize(body), now, text(job.description) ? now : '')
          const key = discoveryItemKey(account, jobId)
          if (!atlasRead(key, null))
            atlasWrite(key, {
              accountId: account,
              jobId,
              status: history.contacts.length
                ? 'following'
                : history.exclusions.length
                  ? 'dismissed'
                  : 'new',
              origin,
              firstSeenAt: now,
              lastSeenAt: now,
              legacyExclusions: history.exclusions
            })
          const bossId = identifier(job.encryptBossId)
          if (bossId) {
            const candidates = byRecruiter.get(bossId) || []
            candidates.push(body)
            byRecruiter.set(bossId, candidates)
          }
        }
      }
      const insertMessage = db.prepare(
        "INSERT OR IGNORE INTO platform_messages VALUES('boss',?,?,?,?,?,?)"
      )
      const storedMessage = db.prepare(
        "SELECT body,sent_at FROM platform_messages WHERE platform='boss' AND account_id=? AND conversation_id=? AND source_id=?"
      )
      const conversations = new Map<string, Map<string, Row>>()
      for (const row of rows('chat_message_record')) {
        const actors = participants(row, users)
        if (!actors) continue
        const { account, bossId } = actors
        const id = identifier(row.mid)
        if (!bossId || !id) continue
        if (messageDigests.get(JSON.stringify([account, bossId, id])) === null) continue
        const sentAt = timestamp(row.time) || timestamp(row.date)
        let message: Row = {
          id,
          accountId: account,
          bossId,
          sourceId: id,
          text: text(row.text),
          type: row.type === 'text' || row.type === 1 ? 'text' : 'unknown',
          direction: identifier(row.encryptFromUserId) === account ? 'sent' : 'received',
          sentAt,
          read: false,
          source: origin
        }
        if (!insertMessage.run(account, bossId, id, serialize(message), sentAt, now).changes) {
          const stored = storedMessage.get(account, bossId, id)
          message = {
            ...JSON.parse(stored.body),
            id,
            accountId: account,
            bossId,
            sentAt: stored.sent_at
          }
        }
        const byRecruiter = conversations.get(account) || new Map<string, Row>()
        const last = byRecruiter.get(bossId)
        if (
          !last ||
          message.sentAt > last.sentAt ||
          (message.sentAt === last.sentAt && id > last.id)
        )
          byRecruiter.set(bossId, message)
        conversations.set(account, byRecruiter)
      }
      const insertConversation = db.prepare(
        "INSERT OR IGNORE INTO platform_conversations VALUES('boss',?,?,?,?,?)"
      )
      for (const [account, byRecruiter] of conversations)
        for (const [bossId, message] of byRecruiter) {
          // A recruiter can have several jobs; only associate a single verified
          // historical job from this account, never the first global match.
          const associated = recruiterJobs.get(account)?.get(bossId) || []
          const job = associated.length === 1 ? associated[0] : null
          const companyIds = new Set(associated.map((row) => identifier(row.encryptCompanyId)))
          const company = companyIds.size === 1 ? companies.get([...companyIds][0]) : null
          const recruiter = recruiters.get(bossId)
          const body = {
            accountId: account,
            bossId,
            bossName: text(recruiter?.name),
            companyName: company?.name || company?.brandName || '',
            jobName: text(job?.jobName),
            encryptJobId: identifier(job?.encryptJobId),
            linkedJobIds: associated.map((row) => identifier(row.encryptJobId)),
            lastText: message.text,
            lastMessageAt: message.sentAt,
            source: origin,
            autoReadVerified: false,
            autoReadReason: '历史档案导入，等待平台重新核实'
          }
          insertConversation.run(account, bossId, serialize(body), now, '')
        }
      const result = {
        completed: true,
        importerVersion: 2,
        at: now,
        counts,
        conflicts: collisions,
        unknownOwnership: db
          .prepare(
            "SELECT count(*) n FROM legacy_records WHERE account_id='' AND source_table<>'user_info'"
          )
          .get().n,
        source: filename,
        sourceRetained: true
      }
      atlasWrite(marker, result)
      return result
    })
  } catch {
    throw Error('历史档案导入未完成，本轮写入已回滚；原档案与已有资料保留')
  } finally {
    source.close()
  }
}

export function historyArchive(input: any = {}) {
  importHistoricalData()
  const n = Number(input.page)
  const page = Number.isFinite(n) ? Math.max(1, Math.min(1000000, Math.trunc(n))) : 1
  const kind = tables.includes(input.kind) ? input.kind : ''
  const current = atlasRead<Row | null>('career-boss-sync.json', null)?.account?.id || ''
  const account = input.unassigned ? '' : current
  const where = 'account_id=?' + (kind ? ' AND source_table=?' : '')
  const args = kind ? [account, kind] : [account]
  const db = atlasDb()
  return {
    page,
    total: db.prepare('SELECT count(*) n FROM legacy_records WHERE ' + where).get(...args).n,
    items: db
      .prepare(
        'SELECT * FROM legacy_records WHERE ' +
          where +
          ' ORDER BY source_table,source_id LIMIT 20 OFFSET ?'
      )
      .all(...args, (page - 1) * 20)
      .map((row: Row) => ({ ...row, body: JSON.parse(row.body) })),
    migration: atlasRead(marker, null)
  }
}

export function historicalApplications(input: any = {}) {
  importHistoricalData()
  const users = index(archiveRows('user_info'), 'encryptUserId')
  const accountId = identifier(input.userId)
  const user = users.get(accountId)
  const jobs = index(archiveRows('job_info'), 'encryptJobId')
  const companies = index(archiveRows('company_info'), 'encryptCompanyId')
  const recruiters = index(archiveRows('boss_info'), 'encryptBossId')
  const firstContacts = new Map<string, Row>()
  if (user)
    for (const log of archiveRows('chat_startup_log', accountId)) {
      const jobId = identifier(log.encryptJobId)
      if (!jobId) continue
      const prior = firstContacts.get(jobId)
      const date = timestamp(log.date),
        oldDate = timestamp(prior?.date)
      if (!prior || (date && (!oldDate || date < oldDate))) firstContacts.set(jobId, log)
    }
  const applications = [...firstContacts]
    .map(([jobId, log]) => {
      const job = jobs.get(jobId) || {},
        company = companies.get(identifier(job.encryptCompanyId)) || {}
      const recruiter = recruiters.get(identifier(job.encryptBossId))
      return {
        ...job,
        encryptJobId: jobId,
        companyName: company.name || company.brandName || '',
        industryName: company.industryName,
        bossName: recruiter?.name || '',
        encryptCurrentUserId: accountId,
        firstContact: timestamp(log.date) ? log.date : '',
        source: origin
      }
    })
    .sort(
      (a, b) =>
        timestamp(a.firstContact).localeCompare(timestamp(b.firstContact)) ||
        a.encryptJobId.localeCompare(b.encryptJobId)
    )
  return {
    data: {
      databaseAvailable: true,
      applications: applications.slice(-5000),
      jobLibrary: [],
      accountId: user ? accountId : '',
      accountName: text(user?.name),
      truncated: applications.length > 5000
    }
  }
}
