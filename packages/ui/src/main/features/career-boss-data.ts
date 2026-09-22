import { discoveryItems } from './atlas-discovery-state'
import { atlasDb } from './atlas-store'
import { createHash } from 'node:crypto'
import { readLocalJson, writeLocalJson } from './career-reply-store'
import { atlasTransaction } from './atlas-store'
import { capturedBossJobs, ingestBossSnapshot } from './atlas-boss-sync'
export interface BossSync {
  version: 1
  account: { id: string; name: string }
  items: Array<{
    bossId: string
    bossName: string
    companyName: string
    jobName: string
    encryptJobId: string
    address: string
  }>
  updatedAt: string
}
const text = (v: any, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
export function readBossSync(): BossSync | null {
  const s = readLocalJson<BossSync | null>('career-boss-sync.json', null)
  return s?.version === 1 && s.account?.id && Array.isArray(s.items) ? s : null
}
export function saveBossSnapshot(snapshot: any) {
  const id = text(snapshot?.account?.id, 200)
  if (!id) return null
  return atlasTransaction(() => {
    let prev = readBossSync()
    if (prev && prev.account.id !== id)
      writeLocalJson(
        `career-boss-accounts/${createHash('sha256').update(prev.account.id).digest('hex')}.json`,
        prev
      )
    if (prev?.account.id !== id)
      prev = readLocalJson<BossSync | null>(
        `career-boss-accounts/${createHash('sha256').update(id).digest('hex')}.json`,
        null
      )
    const key = (i: { bossId: string; encryptJobId: string }) =>
      `${i.bossId}\u0000${i.encryptJobId || ''}`
    const byBoss = new Map((prev?.account.id === id ? prev.items : []).map((i) => [key(i), i]))
    for (const row of Array.isArray(snapshot.items) ? snapshot.items.slice(0, 5000) : []) {
      const bossId = text(row.bossId, 200)
      if (!bossId) continue
      const item = {
        bossId,
        bossName: text(row.bossName),
        companyName: text(row.companyName),
        jobName: text(row.jobName),
        encryptJobId: text(row.encryptJobId, 200),
        address: text(row.address, 1000)
      }
      const existing =
        byBoss.get(key(item)) ||
        (!item.encryptJobId
          ? [...byBoss.values()].find((i) => i.bossId === bossId)
          : byBoss.get(`${bossId}\u0000`))
      if (existing)
        for (const key of [
          'bossName',
          'companyName',
          'jobName',
          'encryptJobId',
          'address'
        ] as const)
          if (!item[key]) item[key] = existing[key]
      if (item.encryptJobId) byBoss.delete(`${bossId}\u0000`)
      byBoss.set(key(item), item)
    }
    const sync: BossSync = {
      version: 1,
      account: {
        id,
        name: text(snapshot.account.name) || (prev?.account.id === id ? prev.account.name : '')
      },
      items: [...byBoss.values()].slice(-5000),
      updatedAt: new Date().toISOString()
    }
    writeLocalJson('career-boss-sync.json', sync)
    ingestBossSnapshot(snapshot)
    return sync
  })
}
export function enrichSyncedRecords(records: any = {}, sync: BossSync | null) {
  const captured = sync ? capturedBossJobs(sync.account.id) : []
  const capturedIds = new Set(captured.map((j: any) => j.encryptJobId))
  const library = [
    ...captured,
    ...(records.jobLibrary || []).filter((r: any) => !capturedIds.has(r.encryptJobId))
  ]
  const { jobLibrary: _library, ...safe } = records
  if (!sync || (records.accountId && records.accountId !== sync.account.id)) return safe
  const rows = [...(records.applications || [])]
  const byJob = new Map<string, any>(),
    byBoss = new Map<string, any[]>()
  for (const job of library) {
    byJob.set(job.encryptJobId, job)
    const group = byBoss.get(job.encryptBossId) || []
    group.push(job)
    byBoss.set(job.encryptBossId, group)
  }
  const rowJob = new Map<string, number>(),
    rowBoss = new Map<string, number>()
  rows.forEach((r: any, i: number) => {
    if (r.encryptJobId) rowJob.set(r.encryptJobId, i)
    if (r.encryptBossId) rowBoss.set(r.encryptBossId, i)
  })
  for (const item of sync.items) {
    const exact = item.encryptJobId ? byJob.get(item.encryptJobId) : null
    const matches = byBoss.get(item.bossId) || []
    const detail = exact || (!item.encryptJobId && matches.length === 1 ? matches[0] : {})
    const jobId = item.encryptJobId || detail.encryptJobId || ''
    const existingIndex = jobId ? rowJob.get(jobId) : rowBoss.get(item.bossId)
    if (existingIndex !== undefined) {
      rows[existingIndex] = { ...rows[existingIndex], ...detail }
      continue
    }
    if (jobId) rowJob.set(jobId, rows.length)
    rowBoss.set(item.bossId, rows.length)
    rows.push({
      ...detail,
      encryptJobId: jobId,
      recordId: `boss:${item.bossId}`,
      encryptBossId: item.bossId,
      encryptCurrentUserId: sync.account.id,
      companyName: detail.companyName || item.companyName || '企业名称待补充',
      jobName: detail.jobName || item.jobName || '职位待补充',
      bossName: item.bossName || detail.bossName,
      address: detail.address || item.address,
      description: detail.description || '',
      firstContact: '',
      source: 'BOSS 已有会话'
    })
  }
  const discovery = discoveryItems(sync.account.id)
  const tracked = new Set(atlasDb().prepare('SELECT id FROM opportunities').all().map((r: any) => r.id))
  for (const job of captured)
    if (!rowJob.has(job.encryptJobId)) {
      if (discovery.has(job.encryptJobId) && discovery.get(job.encryptJobId)?.status !== 'following' && !tracked.has(`boss:${sync.account.id}:job:${job.encryptJobId}`)) continue
      rowJob.set(job.encryptJobId, rows.length)
      rows.push({
        ...job,
        encryptCurrentUserId: sync.account.id,
        source: job.detailAt ? 'BOSS 浏览岗位' : 'BOSS 推荐 / 搜索',
        initialStage: '待评估',
        firstContact: ''
      })
    }
  return {
    ...safe,
    applications: rows,
    accountName: sync.account.name || records.accountName || 'BOSS 账户',
    accountId: sync.account.id,
    warning: rows.length ? '' : records.warning,
    syncedAt: sync.updatedAt
  }
}
