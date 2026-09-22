import { recordTask } from './atlas-task-records'
import { unpackAnalysis } from './atlas-analysis-storage'
import {
  atlasDb,
  atlasRead,
  atlasWrite,
  atlasTransaction,
  fingerprint
} from './atlas-store'
export const discoveryAccount = () =>
  atlasRead<any>('career-boss-sync.json', null)?.account?.id || ''
export const discoveryItemKey = (account: string, id: string) =>
  'atlas-discovery-item/' + fingerprint([account, id])
export const discoveryRunKey = (account: string) => 'atlas-discovery-run/' + fingerprint(account)
export function discoveryRun(account = discoveryAccount()) {
  return atlasRead<any>(discoveryRunKey(account), null)
}
export function saveDiscoveryRun(account: string, value: any) {
  atlasWrite(discoveryRunKey(account), value)
  recordTask({id:'discovery:'+value.id,kind:'discovery-run',accountId:account,state:value.state,step:value.message,createdAt:value.createdAt,input:{profileVersion:value.profileVersion,settings:value.settings,channels:value.channels},result:{candidates:value.jobIds?.length,details:value.detailIds?.length,analyses:value.analyzedIds?.length},error:value.errors?.at(-1)?.message})
}
export function updateDiscoveryRun(account: string, runId: string, patch: any) {
  return atlasTransaction(() => {
    const key = discoveryRunKey(account),
      old = atlasRead<any>(key, null)
    if (!old || old.id !== runId || old.state === 'paused' || old.state === 'cancelled')
      return false
    const value={ ...old, ...patch, at: new Date().toISOString() }
    saveDiscoveryRun(account, value)
    return true
  })
}
export function markDiscovered(
  account: string,
  jobs: any[],
  origin: string,
  runId = '',
  keyword = ''
) {
  if (!account || account !== discoveryAccount()) return
  atlasTransaction(() => {
    const now = new Date().toISOString()
    for (const job of jobs) {
      if (!job?.encryptJobId || !job.jobName) continue
      const key = discoveryItemKey(account, job.encryptJobId),
        old = atlasRead<any>(key, null)
      const clean={...job};delete clean._atlasChangeKind
      const observation=fingerprint([account,job.encryptJobId,origin,runId || now.slice(0,10),clean])
      atlasDb().prepare("INSERT OR IGNORE INTO job_observations VALUES(?,'boss',?,?,?,?,?,?)").run(observation,account,job.encryptJobId,origin,runId,job._atlasChangeKind || (old?'duplicate':'new'),now)
      atlasWrite(key, {
        ...old,
        accountId: account,
        jobId: job.encryptJobId,
        firstSeenAt: old?.firstSeenAt || now,
        lastSeenAt: now,
        origin,
        origins: [...new Set([...(old?.origins || (old?.origin ? [old.origin] : [])),origin])],
        status: old?.status || 'new',
        runId: runId || old?.runId || '',
        keywords: [...new Set([...(old?.keywords || []), ...(keyword ? [keyword] : [])])].slice(-12)
      })
    }
  })
}
export function discoveryItems(account = discoveryAccount()): Map<string, any> {
  const epoch=atlasRead('atlas-restore-epoch',null)
  return new Map(
    atlasDb()
      .prepare("SELECT key,value,revision,updated_at FROM documents WHERE key LIKE 'atlas-discovery-item/%' AND json_extract(value,'$.accountId')=?")
      .all(account)
      .map((r: any) => ({ key: r.key, value: unpackAnalysis(atlasDb(), JSON.parse(r.value)), revision: fingerprint([epoch,[[r.key,{revision:r.revision,updated_at:r.updated_at}]]]) }))
      .filter((r: any) => r.value?.accountId === account)
      .map((r: any) => [r.value.jobId, { ...r.value, revision: r.revision }])
  )
}
