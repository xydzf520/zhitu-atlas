import { modelVersion } from './atlas-model-config'
import { resolveAgent } from './atlas-agents'
import { randomUUID } from 'node:crypto'
import { atlasDb, atlasRead, atlasWrite, atlasTransaction, atlasEvent, fingerprint } from './atlas-store'
import { canonicalProfile } from './atlas-profile'
import { careerPolicy, policyKey, policySnapshot } from './atlas-policy'
import { deepseekConfig, deepseekJson, modelUsage } from './atlas-deepseek'
import { DEEPSEEK_REQUEST_TIMEOUT_MS } from '../../common/deepseek-policy'
import { discoveryAccount } from './atlas-discovery-state'
const feedbackKey = (id: string) => 'atlas-feedback/' + fingerprint([discoveryAccount(), id])
export function feedbackFor(id: string) { return atlasRead<any>(feedbackKey(id), null) }
export function feedbackList() {
  return atlasDb().prepare("SELECT value FROM documents WHERE key LIKE 'atlas-feedback/%' ORDER BY updated_at DESC LIMIT 300").all().map((r: any) => JSON.parse(r.value)).filter((r: any) => r.accountId === discoveryAccount())
}
export function saveFeedback(input: any) {
  if (!input?.jobId || input.jobId.length > 250 || !['interested', 'irrelevant', 'progressed', 'ended', 'clear'].includes(input.action) || typeof input.reason !== 'string' || input.reason.length > 500) throw Error('反馈内容无效')
  const local = input.jobId.startsWith('local:') && atlasRead<any>('career-workspace.json', {opportunities:[]}).opportunities.some((o:any) => 'local:'+o.id===input.jobId && (!o.accountId || o.accountId===discoveryAccount()))
  if (!local && !atlasDb().prepare("SELECT 1 FROM platform_jobs WHERE platform='boss' AND account_id=? AND source_id=?").get(discoveryAccount(), input.jobId)) throw Error('岗位不属于当前账号')
  const value = { accountId: discoveryAccount(), jobId: input.jobId, action: input.action, reason: input.reason, at: new Date().toISOString() }
  atlasWrite(feedbackKey(input.jobId), value)
  atlasEvent('recommendation-feedback', input.jobId, value)
  return value
}
const basis = () => fingerprint(careerPolicy().direction)
export function strategyHistory() {
  return atlasDb().prepare("SELECT value FROM documents WHERE key LIKE 'atlas-strategy/%' ORDER BY updated_at DESC LIMIT 30").all().map((r: any) => JSON.parse(r.value)).filter((r: any) => r.accountId === discoveryAccount())
}
export async function optimizeStrategy(input: any = {}) {
  const p = careerPolicy(), account = discoveryAccount(), today = modelUsage().day
  if (!p.discovery.adaptive) return { skipped: true, reason: '动态优化已关闭' }
  const agent = resolveAgent('strategy')
  const dayKey = 'atlas-strategy-day/' + fingerprint([account, today])
  const old = atlasRead<any>(dayKey, null)
  if (old) return { ...old, cached: true, promptStale: old.agentSignature !== agent.signature || old.modelVersion !== modelVersion() }
  const directionBasis = basis(), originalVersion = p.version, controller = new AbortController(), cancel = () => controller.abort()
  input.signal?.addEventListener('abort', cancel, { once: true })
  if(input.signal?.aborted) controller.abort()
  const timer = setTimeout(cancel, DEEPSEEK_REQUEST_TIMEOUT_MS)
  const jobs = atlasDb().prepare("SELECT body FROM platform_jobs WHERE platform='boss' AND account_id=? ORDER BY observed_at DESC LIMIT 60").all(account).map((r: any) => { const j = JSON.parse(r.body); return { title: j.jobName, company: j.companyName, salary: j.salaryDesc, description: (j.description || '').slice(0, 800) } })
  try {
    const result = await deepseekJson(deepseekConfig(), agent.system, { direction: p.direction, coreKeywords: p.discovery.coreKeywords, confirmedEvidence: canonicalProfile().evidence.filter(e => e.confirmed), jobs, feedback: feedbackList().slice(0, 60), rejected: strategyHistory().filter(s => s.rejected && s.directionBasis === directionBasis).map(s => s.after) }, controller.signal, { kind: 'strategy', automatic: true, accountId: account, agent })
    const value: any = result.value
    if (!value || !Array.isArray(value.extensions) || value.extensions.length > 2 || value.extensions.some((x: any) => typeof x !== 'string' || !x.trim() || x.length > 60) || typeof value.reason !== 'string' || value.reason.length > 1500 || !Array.isArray(value.focus) || value.focus.length > 3 || value.focus.some((x: any) => typeof x !== 'string' || x.length > 150)) throw Error('策略建议格式无效，当前搜索条件保留')
    const extensions = [...new Set<string>(value.extensions.map((v: string) => v.trim()))].filter(k => !p.discovery.coreKeywords.includes(k)).slice(0, Math.max(0, 6 - p.discovery.coreKeywords.length))
    if (strategyHistory().some(s => s.rejected && s.directionBasis === directionBasis && fingerprint(s.after) === fingerprint(extensions))) throw Error('本次重复了已拒绝的调整，未应用')
    return atlasTransaction(() => {
      if (careerPolicy().version !== originalVersion || discoveryAccount() !== account || controller.signal.aborted) throw Error('分析期间策略或账号已变化，未覆盖当前设置')
      const record = { modelVersion: modelVersion(), agentSignature: agent.signature, id: randomUUID(), accountId: account, directionBasis, before: p.discovery.extensionKeywords, after: extensions, reason: value.reason, focus: value.focus, at: new Date().toISOString(), applied: true, rejected: false, usage: result.usage }
      atlasWrite(policyKey, { ...p, version: p.version + 1, discovery: { ...p.discovery, extensionKeywords: extensions, focus: value.focus } })
      atlasWrite('atlas-strategy/' + record.id, record); atlasWrite(dayKey, record)
      atlasEvent('strategy-applied', record.id, { before: record.before, after: record.after })
      return record
    })
  } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', cancel) }
}
export function undoStrategy(input: any) {
  return atlasTransaction(() => {
    const key = 'atlas-strategy/' + input.id, record = atlasRead<any>(key, null), p = careerPolicy()
    if (!record || record.accountId !== discoveryAccount() || input.baseRevision !== policySnapshot().revision) throw Error('策略已变化，请重新读取再撤销')
    if (fingerprint(p.discovery.extensionKeywords) !== fingerprint(record.after)) throw Error('已有较新的调整，请先处理最近一版')
    atlasWrite(policyKey, { ...p, version: p.version + 1, discovery: { ...p.discovery, extensionKeywords: record.before, focus: [] } })
    atlasWrite(key, { ...record, applied: false, rejected: true, undoneAt: new Date().toISOString() })
    return policySnapshot()
  })
}
export function registerAdaptive(handle: (name: string, fn: (...args: any[]) => any) => void) {
  handle('career-recommendation-feedback', (_, p) => saveFeedback(p))
  handle('career-strategy-history', () => ({ items: strategyHistory(), policyRevision: policySnapshot().revision, usage: modelUsage(), feedbackCount: feedbackList().length }))
  handle('career-strategy-optimize', (_, p) => optimizeStrategy(p))
  handle('career-strategy-undo', (_, p) => undoStrategy(p))
  handle('career-model-usage', modelUsage)
}
