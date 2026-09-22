import type { Qualification } from './contact'
import { validateProject, type CareerProject } from './portfolio'
import { roleAlignment } from './role-matching'
export interface CareerEvidence {
  id?: string
  confirmed?: boolean
  title: string
  text: string
  keywords: string[]
  source: string
  project?: CareerProject
}
export interface CareerProfile {
  name: string
  headline: string
  summary: string
  targetRoles: string[]
  preferredCities: string[]
  minimumMonthlyK: number | null
  evidence: CareerEvidence[]
  resumeText: string
  qualifications?: Qualification[]
}
export function profileEvidence(profile: CareerProfile): CareerEvidence[] { return [...profile.evidence,...(profile.qualifications || []).map(f=>({id:f.id,title:f.label,text:f.value,confirmed:f.confirmed,source:f.source,keywords:[]}))] }
export interface CareerJob {
  encryptJobId?: string
  jobName: string
  companyName: string
  description: string
  address?: string
  cityName?: string
  degreeName?: string
  experienceName?: string
  salaryLow?: number | null
  salaryHigh?: number | null
}
export const careerStages = ['待评估', '计划联系', '已沟通', '已投递', '面试中', 'Offer', '已结束'] as const
export interface CareerOpportunity {
  id: string
  platform?: 'boss' | 'liepin' | 'import'
  accountId?: string
  sourceId?: string
  sourceUrl?: string
  job: CareerJob
  stage: (typeof careerStages)[number]
  nextDate: string
  note: string
  createdAt?: string
}
export function opportunityKey(o: CareerOpportunity): string {
  if (o.platform && o.accountId && o.sourceId) return `${o.platform}:${o.accountId}:job:${o.sourceId}`
  return o.job.encryptJobId ? `job:${o.job.encryptJobId}` : `manual:${o.id}`
}
export interface CareerState {
  version: 1
  profile: CareerProfile
  opportunities: CareerOpportunity[]
}
export function emptyCareerState(): CareerState {
  return { version: 1, profile: { name: '', headline: '', summary: '', targetRoles: [], preferredCities: [], minimumMonthlyK: null, evidence: [], resumeText: '' }, opportunities: [] }
}
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
function contains(text: string, term: string) {
  if (!term.trim()) return false
  // Short Latin terms must not match unrelated words such as retail or detail.
  if (/^[a-z]{1,4}$/i.test(term)) return new RegExp(`\\b${term}\\b`, 'i').test(text)
  return norm(text).includes(norm(term))
}
export function assessCareerJob(job: CareerJob, profile: CareerProfile) {
  // Historical list observations may not include a JD or title yet. Keep them unknown.
  job = { ...job, jobName: typeof job.jobName === 'string' ? job.jobName : '', description: typeof job.description === 'string' ? job.description : '' }
  const text = `${job.jobName}\n${job.description}`
  const matchedEvidence = profile.evidence.filter(e => e.keywords.some(k => contains(text, k)))
  const reasons: string[] = []
  const questions: string[] = []
  const alignment = roleAlignment(job.jobName, profile.targetRoles)
  const roleMatch = alignment.status === 'matched'
  if (roleMatch) reasons.push(alignment.reason)
  matchedEvidence.forEach(e => reasons.push(`相关经历：${e.title}`))
  if (!roleMatch) questions.push(alignment.reason)
  const enoughDetail = job.description.trim().length >= 80
  if (!enoughDetail) questions.push('职位描述不足，补充完整 JD 后再评估')
  if (profile.preferredCities.length) {
    if (!job.address?.trim()) questions.push('工作城市待核实')
    else if (!profile.preferredCities.some(c => contains(job.address!, c))) questions.push(`工作地点与偏好 ${profile.preferredCities.join('、')} 不一致，需确认是否接受`)
  } else questions.push('目标城市尚未设置')
  if (profile.minimumMonthlyK !== null) {
    if (!(Number(job.salaryHigh) > 0)) questions.push('薪资待核实')
    else if (Number(job.salaryHigh) < profile.minimumMonthlyK) questions.push('薪资上限低于设定的月薪期望')
  } else questions.push('薪资期望尚未设置')
  if (/博士|硕士|本科|统招|学历/.test(job.description)) questions.push('核对学历要求与实际教育背景')
  if (/训练|微调|算法|模型研发/.test(job.description)) questions.push('核实模型训练、算法研发是否为必要职责，以及本人是否有直接经历')
  if (/团队|负责人|总监|管理/.test(text)) questions.push('面试确认职责边界、汇报关系、团队资源与考核指标')
  const confirmed = matchedEvidence.filter(e => e.confirmed)
  const topics = new Set(confirmed.flatMap(e => e.keywords.filter(k => contains(text, k)).map(norm)))
  // The same weights apply to every occupation. Unconfirmed facts never raise eligibility.
  const score = Math.min(!enoughDetail ? 49 : alignment.status === 'different' ? 34 : !roleMatch ? 64 : 100,
    (roleMatch ? 40 : 0) + Math.min(40, confirmed.length * 15) +
    (enoughDetail ? 10 : 0) + (topics.size >= 2 ? 10 : 0))
  return { score, reasons, questions, matchedEvidence, alignment,
    label: !enoughDetail ? '信息不足' : !roleMatch ? '方向待核实' : score >= 65 ? '优先了解' : '值得评估' }
}
const stableIndex = (seed: string, size: number) => {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h) % size
}
export function draftCareerMessage(job: CareerJob, evidence: CareerEvidence | undefined) {
  const role = job.jobName || '相关岗位',
    openings = [
      `您好，看到贵司在招${role}。`,
      `您好，留意到贵司的${role}岗位。`,
      `您好，看到贵司${role}的招聘。`
    ],
    endings = [
      '如果与当前需求相符，希望有机会进一步交流。',
      '可以结合具体案例进一步介绍我的工作。',
      '期待有机会交流。'
    ],
    opening = openings[stableIndex(role + '|' + (job.companyName || ''), openings.length)],
    ending = endings[stableIndex((job.companyName || '') + role, endings.length)]
  return evidence?.confirmed
    ? `${opening}${evidence.text}${ending}`
    : `${opening}我对这个机会感兴趣，${ending}`
}
export function isFollowUpDue(item: CareerOpportunity, today: string) {
  return item.stage !== '已结束' && item.stage !== 'Offer' && !!item.nextDate && item.nextDate <= today
}

// Reject incompatible or oversized state before touching the existing file.
export function validateCareerState(value: unknown): asserts value is CareerState {
  const fail = () => { throw new Error('个人工作台数据格式不正确，请检查输入') }
  const str = (s: unknown, max = 100000) => typeof s === 'string' && s.length <= max
  const strings = (s: unknown) => Array.isArray(s) && s.length <= 100 && s.every(v => str(v, 100))
  if (!value || typeof value !== 'object') fail()
  const v = value as CareerState
  const p = v.profile
  if (v.version !== 1 || !p || !str(p.name, 100) || !str(p.headline, 200) || !str(p.summary) || !str(p.resumeText) || !strings(p.targetRoles) || !strings(p.preferredCities)) fail()
  if (p.minimumMonthlyK !== null && !(typeof p.minimumMonthlyK === 'number' && Number.isFinite(p.minimumMonthlyK) && p.minimumMonthlyK > 0 && p.minimumMonthlyK <= 1000)) fail()
  if (!Array.isArray(p.evidence) || p.evidence.length > 100 || p.evidence.some(e => !e || !str(e.title, 200) || !str(e.text, 5000) || !str(e.source, 2000) || !strings(e.keywords))) fail()
  if (p.qualifications !== undefined && (!Array.isArray(p.qualifications) || p.qualifications.length > 50 || p.qualifications.some(f => !f || !str(f.id,200) || !f.id || !['education','experience','other'].includes(f.kind) || !str(f.label,200) || !str(f.value,500) || !str(f.source,2000) || typeof f.confirmed !== 'boolean') || new Set(p.qualifications.map(f=>f.id)).size !== p.qualifications.length)) fail()
  const evidenceIds = new Set<string>()
  for (const e of p.evidence) {
    if (e.project !== undefined) validateProject(e.project)
    if (e.confirmed !== undefined && typeof e.confirmed !== 'boolean') fail()
    if (e.id !== undefined) {
      if (!str(e.id, 200) || !e.id || evidenceIds.has(e.id)) fail()
      evidenceIds.add(e.id)
    }
  }
  for(const f of p.qualifications || []) { if(evidenceIds.has(f.id) || f.confirmed && (!f.value.trim() || !f.label.trim() || !f.source.trim())) fail(); evidenceIds.add(f.id) }
  if (!Array.isArray(v.opportunities) || v.opportunities.length > 5000) fail()
  const ids = new Set<string>()
  for (const o of v.opportunities) {
    if (!o || !str(o.id, 200) || !o.id || ids.has(o.id) || !careerStages.includes(o.stage) || !str(o.note, 10000) || !str(o.nextDate, 10) || (o.nextDate && !/^\d{4}-\d{2}-\d{2}$/.test(o.nextDate))) fail()
    if (o.nextDate && (Number.isNaN(Date.parse(o.nextDate)) || new Date(o.nextDate).toISOString().slice(0, 10) !== o.nextDate)) fail()
    if(o.createdAt !== undefined && (!str(o.createdAt,50) || Number.isNaN(Date.parse(o.createdAt)))) fail()
    ids.add(o.id)
    if (o.platform !== undefined && !['boss','liepin','import'].includes(o.platform)) fail()
    for (const field of [o.accountId,o.sourceId]) if (field !== undefined && (!str(field, 500) || !field.trim())) fail()
    if ((o.accountId || o.sourceId) && !(o.platform && o.accountId && o.sourceId)) throw new Error('来源标识需同时包含平台、账号与来源 ID')
    if (o.sourceUrl !== undefined && (!str(o.sourceUrl, 2000) || !/^https?:\/\//.test(o.sourceUrl))) fail()
    if (!o.job || !str(o.job.jobName, 500) || !str(o.job.companyName, 500) || !str(o.job.description) || (o.job.address != null && !str(o.job.address, 2000))) fail()
    if (o.job.encryptJobId != null && !str(o.job.encryptJobId, 500)) fail()
    if (o.job.salaryLow != null && o.job.salaryHigh != null && o.job.salaryLow > o.job.salaryHigh) throw new Error('月薪下限不能高于上限')
    for (const salary of [o.job.salaryLow, o.job.salaryHigh]) if (salary != null && (typeof salary !== 'number' || !Number.isFinite(salary) || salary < 0 || salary > 1000)) fail()
  }
}
