import { salaryDistribution } from './salary'
import { jobLocation, validCoordinates } from './regions'
import { assessCareerJob, opportunityKey, type CareerState } from './career'
export const pipelineStages = [
  '待评估',
  '计划联系',
  '已沟通',
  '已投递',
  '面试中',
  'Offer',
  '已结束'
] as const
export type PipelineStage = (typeof pipelineStages)[number]
export const stageColors: Record<string, string> = {
  待评估: '#65758a',
  计划联系: '#2563c7',
  已沟通: '#7154b2',
  已投递: '#087d86',
  面试中: '#a86b16',
  Offer: '#15775b',
  已结束: '#ad4e65'
}
export interface DashboardPreferences {
  version: 1
  overrides: Record<
    string,
    {
      stage?: PipelineStage
      endReason?: string
      address?: string
      lng?: number
      lat?: number
      crs?: 'wgs84' | 'gcj02' | 'unknown'
      commuteMinutes?: number | null
      nextDate?: string
      note?: string
      updatedAt?: string
    }
  >
}
export interface DashboardOpportunity {
  id: string
  job: any
  stage: PipelineStage
  endReason?: string
  nextDate: string
  note: string
  createdAt: string
  source: string
  bossId?: string
  userId?: string
  platform?: string
  score: number
  label: string
  industry?: string
  scale?: string
  lng?: number
  lat?: number
  crs?: 'wgs84' | 'gcj02' | 'unknown'
  commuteMinutes?: number | null
  district: string
}
export function districtFor(address: string) { const place=jobLocation({address});return place.district || place.city || '地址待补充' }
export function localDay(time: number | string | Date = Date.now()) {
  return new Date(time).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}
export function buildOpportunities(
  state: CareerState,
  rows: any[],
  preferences: DashboardPreferences
): DashboardOpportunity[] {
  const out = new Map<string, DashboardOpportunity>()
  const add = (
    id: string,
    job: any,
    stage: PipelineStage,
    source: string,
    createdAt = '',
    extra: any = {}
  ) => {
    const override = preferences.overrides[id] || (!extra.userId ? preferences.overrides[`boss:${extra.bossId || ''}`] : undefined) || {}
    const normalizedJob = {
      ...job,
      address: override.address?.trim() || job.address || '',
      description: job.description || '',
      jobName: job.jobName || '职位待补充',
      companyName: job.companyName || '公司待补充'
    }
    const assessment = assessCareerJob(normalizedJob, state.profile)
    out.set(id, {
      id,
      job: normalizedJob,
      stage,
      nextDate: '',
      note: '',
      createdAt,
      source,
      score: assessment.score,
      label: assessment.label,
      ...extra,
      ...override,
      district: jobLocation(normalizedJob).district || jobLocation(normalizedJob).city || '地址待补充'
    })
  }
  for (const row of rows) {
    if (!row.encryptJobId && !row.recordId) continue
    const sourceId = row.encryptJobId ? `job:${row.encryptJobId}` : row.recordId
    const id = row.encryptCurrentUserId ? `${row.platform || 'boss'}:${row.encryptCurrentUserId}:${sourceId}` : sourceId
    if (!out.has(id))
      add(id, row, row.initialStage === '待评估' ? '待评估' : '已沟通', row.source || 'BOSS 开聊记录', row.firstContact || row.date || '', {
        bossId: row.encryptBossId,
        userId: row.encryptCurrentUserId,
        platform: row.platform || 'boss',
        industry: row.industryName,
        scale: row.scaleHigh ? `${row.scaleLow || 0}–${row.scaleHigh} 人` : ''
      })
  }
  for (const o of state.opportunities) {
    const id = opportunityKey(o)
    const old = out.get(id)
    add(
      id,
      { ...old?.job, ...o.job },
      o.stage,
      o.platform === 'boss' ? 'BOSS 导入' : o.platform === 'liepin' ? '猎聘导入' : o.platform === 'import' ? '文件导入' : '个人跟进',
      old?.createdAt || (o as any).createdAt || '',
      {
        bossId: old?.bossId || (o.job as any).encryptBossId,
        userId: o.accountId || old?.userId,
        platform: o.platform || old?.platform,
        sourceUrl: o.sourceUrl,
        industry: old?.industry,
        scale: old?.scale,
        nextDate: o.nextDate,
        note: o.note
      }
    )
    // Local stage is authoritative unless an explicit dashboard override exists.
    out.get(id)!.stage = preferences.overrides[id]?.stage || o.stage
  }
  return [...out.values()]
}
export function summarizeDashboard(items: DashboardOpportunity[], today = localDay()) {
  const stages = pipelineStages.map((name) => ({
    name,
    count: items.filter((o) => o.stage === name).length,
    color: stageColors[name]
  }))
  const salary = items
    .filter((o) => Number(o.job.salaryHigh) > 0 && Number(o.job.salaryLow) > 0)
    .map((o) => (Number(o.job.salaryLow) + Number(o.job.salaryHigh)) / 2)
    .sort((a, b) => a - b)
  const median = salary.length
    ? (salary[Math.floor((salary.length - 1) / 2)] + salary[Math.floor(salary.length / 2)]) / 2
    : null
  const active = items.filter((o) => o.stage !== '已结束')
  const districts = [...new Set(items.map(o=>o.district).filter(d=>d!=='地址待补充'))]
    .map((name) => ({ name, count: items.filter((o) => o.district === name).length }))
    .filter((d) => d.count)
    .sort((a, b) => b.count - a.count)
  const byIndustry = new Map<string, number>()
  items.forEach((o) =>
    byIndustry.set(
      o.industry || '行业待补充',
      (byIndustry.get(o.industry || '行业待补充') || 0) + 1
    )
  )
  return {
    total: items.length,
    companies: new Set(items.map((o) => o.job.companyName).filter((n) => n !== '公司待补充')).size,
    active: active.length,
    interviews: items.filter((o) => o.stage === '面试中').length,
    offers: items.filter((o) => o.stage === 'Offer').length,
    due: active.filter((o) => o.stage !== 'Offer' && o.nextDate && o.nextDate <= today),
    priority: active.filter((o) => o.score >= 65).length,
    salaryMedian: median,
    salarySamples: salary.length,
    stages,
    districts,
    industry: [...byIndustry]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    unlocated: items.filter((o) => o.district === '地址待补充' && !(o.lng && o.lat)).length,
    salaryBands: salaryDistribution(salary),
    trend: Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${today}T12:00:00+08:00`)
      d.setUTCDate(d.getUTCDate() - 6 + i)
      const day = localDay(d)
      return {
        day,
        count: items.filter((o) => o.createdAt && localDay(o.createdAt) === day).length
      }
    })
  }
}
export function validateDashboardPreferences(value: any): asserts value is DashboardPreferences {
  if (
    value?.version !== 1 ||
    !value.overrides ||
    Array.isArray(value.overrides) ||
    typeof value.overrides !== 'object' ||
    Object.keys(value.overrides).length > 10000
  )
    throw new Error('大屏配置格式错误')
  for (const [id, v] of Object.entries(value.overrides) as [string, any][]) {
    if (!id || id.length > 600 || !v || typeof v !== 'object') throw new Error('岗位配置格式错误')
    if (v.stage !== undefined && !pipelineStages.includes(v.stage)) throw new Error('投递状态无效')
    if (v.crs !== undefined && !['wgs84','gcj02','unknown'].includes(v.crs)) throw new Error('坐标系无效')
    if (v.commuteMinutes != null && (!Number.isFinite(v.commuteMinutes) || v.commuteMinutes < 0 || v.commuteMinutes > 600)) throw new Error('通勤时间应为 0–600 分钟')
    for (const key of ['address', 'note', 'nextDate', 'updatedAt', 'endReason'])
      if (v[key] !== undefined && (typeof v[key] !== 'string' || v[key].length > 3000))
        throw new Error('字段格式错误')
    if (
      v.nextDate &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(v.nextDate) ||
        Number.isNaN(Date.parse(v.nextDate)) ||
        new Date(v.nextDate).toISOString().slice(0, 10) !== v.nextDate)
    )
      throw new Error('跟进日期无效')
    if ((v.lng == null) !== (v.lat == null)) throw new Error('请同时填写经纬度')
    if (
      v.lng != null &&
      !validCoordinates(v.lng, v.lat)
    )
      throw new Error('请输入有效的经纬度；地图显示需要确认坐标系')
  }
}
