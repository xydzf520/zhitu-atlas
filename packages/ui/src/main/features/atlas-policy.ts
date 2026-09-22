import fs from 'node:fs'
import path from 'node:path'
import { emptyCareerState } from '../../common/career'
import { atlasRead, atlasWrite, atlasRoot, atlasRevision, atlasTransaction, atlasEvent } from './atlas-store'

export const policyKey = 'atlas-career-policy'
export function careerPolicy() {
  const stored = atlasRead<any>(policyKey, null)
  if (stored) return stored
  const profile = atlasRead('career-workspace.json', emptyCareerState()).profile
  const discovery = atlasRead<any>('atlas-discovery-settings', {})
  const runtime = atlasRead<any>('atlas-runtime', {})
  const replies = atlasRead<any>('career-auto-reply.json', {})
  const advanced: Record<string, any> = {}
  for (const name of ['boss.json', 'common-job-condition-config.json', 'target-company-list.json']) {
    try { advanced[name] = JSON.parse(fs.readFileSync(path.join(atlasRoot(), 'config', name), 'utf8')) } catch { /* optional legacy source */ }
  }
  const existing = !!profile.resumeText || !!profile.targetRoles.length || !!atlasRead('atlas-runtime', null) || !!atlasRead('atlas-discovery-settings', null)
  // Only job conditions belong here; browser credentials and robot tokens never migrate.
  if (advanced['boss.json']) advanced['boss.json'] = Object.fromEntries(Object.entries(advanced['boss.json']).filter(([key]) => /^(expect|blockCompany|jobDetail|fieldsFor|combineRecommend|staticCombine|anyCombine|jobSource|markAsNot|jobNot|jobActive|strategyScope)/.test(key)))
  return {
    version: 1,
    direction: { targetRoles: profile.targetRoles, preferredCities: profile.preferredCities, minimumMonthlyK: profile.minimumMonthlyK },
    discovery: { autoRecommend: discovery.autoRecommend ?? existing, recommendTime: discovery.recommendTime || '09:30', coreKeywords: discovery.keywords?.slice(0, 4) || profile.targetRoles.slice(0, 3), extensionKeywords: [], maxJobs: 60, detailLimit: 40, aiLimit: 30, strategyLimit: 1, adaptive: true },
    sending: { paused: runtime.paused ?? true, outbound: runtime.outbound ?? existing, dailyLimit: runtime.dailyLimit || 20, firstContactLimit: runtime.firstContactLimit ?? 10, startHour: runtime.startHour ?? 9, endHour: runtime.endHour ?? 21, cooldownMinutes: Math.max(10, runtime.cooldownMinutes || 10) },
    replies: { mode: replies.mode || 'off', activatedAt: replies.activatedAt || '' },
    automationPaused: !existing, exclusions: { companies: [], terms: [] }, advanced,
    conflicts: Object.keys(advanced).length ? [{ field: 'legacy-conditions', reason: '旧版组合筛选与正则已保留。请在高级筛选核对；系统不会自动把旧排除写回招聘平台。' }] : []
  }
}
export function initializePolicy() {
  if (!atlasRead(policyKey, null)) atlasWrite(policyKey, careerPolicy(), 'migration')
  return policySnapshot()
}
export const policySnapshot = () => ({ value: careerPolicy(), revision: atlasRevision([policyKey, 'career-workspace.json']) })
export function validatePolicy(p: any) {
  if (!p || !p.direction || !p.discovery || !p.sending || !p.replies) throw Error('求职策略不完整')
  for (const [values, max] of [[p.direction.targetRoles, 12], [p.direction.preferredCities, 10], [p.discovery.coreKeywords, 6], [p.discovery.extensionKeywords, 2], [p.exclusions?.companies, 100], [p.exclusions?.terms, 100]] as const) {
    if (!Array.isArray(values) || values.length > max || values.some((s: any) => typeof s !== 'string' || !s.trim() || s.length > 100)) throw Error('关键词、城市或排除条件格式无效')
  }
  if (!p.direction.targetRoles.length || !p.direction.preferredCities.length || !p.discovery.coreKeywords.length || new Set([...p.discovery.coreKeywords, ...p.discovery.extensionKeywords]).size > 6) throw Error('请保留求职方向、城市和 1–6 个搜索词')
  if (p.direction.minimumMonthlyK !== null && (!Number.isFinite(p.direction.minimumMonthlyK) || p.direction.minimumMonthlyK < 1 || p.direction.minimumMonthlyK > 1000)) throw Error('月薪底线无效')
  const d = p.discovery, s = p.sending
  if (!/^(09|1\d|20):[0-5]\d$/.test(d.recommendTime)) throw Error('推荐时间需在 09:00–20:59')
  for (const [n, min, max] of [[d.maxJobs, 1, 60], [d.detailLimit, 1, 40], [d.aiLimit, 0, 30], [d.strategyLimit, 0, 1], [s.dailyLimit, 1, 100], [s.firstContactLimit, 0, s.dailyLimit], [s.cooldownMinutes, 10, 1440], [s.startHour, 0, 23], [s.endHour, 1, 24]]) if (!Number.isInteger(n) || n < min || n > max) throw Error('读取、分析或发送预算超出范围')
  if (s.startHour >= s.endHour || d.aiLimit > d.detailLimit || d.detailLimit > d.maxJobs) throw Error('请核对时间和任务预算顺序')
  if (![s.paused, s.outbound, d.autoRecommend, d.adaptive, p.automationPaused].every(x => typeof x === 'boolean') || !['off', 'review', 'auto'].includes(p.replies.mode)) throw Error('运行开关无效')
  if (JSON.stringify(p.advanced || {}).length > 100000) throw Error('高级筛选内容过长')
  return p
}
export function savePolicy(input: any) {
  return atlasTransaction(() => {
    initializePolicy()
    if (input?.baseRevision !== policySnapshot().revision) throw Error('策略已在另一处更新，草稿已保留，请重新读取后合并')
    const old = careerPolicy(), value = validatePolicy(JSON.parse(JSON.stringify(input.value)))
    value.version = old.version + 1
    value.replies.activatedAt = old.replies.mode !== 'auto' && value.replies.mode === 'auto' ? new Date().toISOString() : old.replies.activatedAt
    const workspace = atlasRead('career-workspace.json', emptyCareerState())
    workspace.profile = { ...workspace.profile, ...value.direction }
    atlasWrite('career-workspace.json', workspace)
    atlasWrite(policyKey, value)
    atlasWrite('atlas-runtime', value.sending)
    atlasWrite('career-auto-reply.json', { ...value.sending, ...value.replies })
    atlasEvent('policy-change', policyKey, { version: value.version, source: 'user', direction: value.direction })
    return policySnapshot()
  })
}
export function updatePolicySection(section: string, patch: any) {
  const stored = atlasRead<any>(policyKey, null)
  if (!stored) return
  const value = { ...stored, [section]: { ...stored[section], ...patch }, version: stored.version + 1 }
  validatePolicy(value)
  atlasWrite(policyKey, value)
}
export const allAutomationPaused = () => !!atlasRead<any>(policyKey, null)?.automationPaused
export function setAllAutomationPaused(paused: boolean) {
  initializePolicy()
  const p = careerPolicy()
  atlasWrite(policyKey, { ...p, automationPaused: paused, version: p.version + 1 })
  atlasEvent('automation-pause', policyKey, { paused })
}
export function policyExclusions(job: any, p = careerPolicy()): string[] {
  const reasons: string[] = []
  if (p.exclusions.companies.some((v: string) => job.companyName?.toLowerCase().includes(v.toLowerCase()))) reasons.push('企业命中本人排除条件')
  if (p.exclusions.terms.some((v: string) => `${job.jobName} ${job.description}`.toLowerCase().includes(v.toLowerCase()))) reasons.push('岗位命中本人排除关键词')
  const old = legacyRules(p)
  if (old.blockCompanyNameRegExpStr) { try { if (new RegExp(old.blockCompanyNameRegExpStr, 'i').test(job.companyName || '')) reasons.push('企业命中旧版排除规则') } catch { /* remains in verification list */ } }
  return reasons
}
function legacyRules(p: any) {
  const boss=p.advanced?.['boss.json'] || {},common=p.advanced?.['common-job-condition-config.json'] || {}, flags=boss.fieldsForUseCommonConfig || {}
  const detail=flags.jobDetail ? common : boss
  return { ...detail, blockCompanyNameRegExpStr: flags.blockCompanyNameRegExpStr ? common.blockCompanyNameRegExpStr : boss.blockCompanyNameRegExpStr }
}
export function policyVerification(job: any, p=careerPolicy()): string[] {
  const old=legacyRules(p), reasons:string[]=[]
  // Complex legacy combinations retain their exact semantics as explicit checks.
  // They must never silently turn into broader automatic eligibility.
  const raw=p.advanced?.['boss.json'] || {}
  if ((raw.staticCombineRecommendJobFilterConditions || []).length || Object.values(raw.anyCombineRecommendJobFilter || {}).some((v:any)=>Array.isArray(v)&&v.length)) reasons.push('保留的旧版组合筛选需要本人核实')
  const checks: boolean[]=[]
  for(const [field,name] of [['expectJobNameRegExpStr','jobName'],['expectJobDescRegExpStr','description'],['expectJobTypeRegExpStr','jobTypeName']] as const) {
    if(!old[field])continue
    if(!job[name]) {reasons.push('旧版高级筛选所需字段待补充');continue}
    try { if(old[field].length>500) {reasons.push('较长的正则筛选需要本人核实');continue}; checks.push(new RegExp(old[field],'i').test(job[name])) } catch {reasons.push('旧版筛选表达式无效，需要修正')}
  }
  if(checks.length && !(old.jobDetailRegExpMatchLogic===2 ? checks.some(Boolean) : checks.every(Boolean))) reasons.push('岗位未满足保留的高级正则筛选')
  if(old.blockCompanyNameRegExpStr)try{new RegExp(old.blockCompanyNameRegExpStr)}catch{reasons.push('企业排除表达式无效，需要修正')}
  if(p.advanced?.['target-company-list.json']?.length) reasons.push('保留了旧版目标企业名单，请核实本岗位是否在范围内')
  return [...new Set(reasons)]
}
