import { bossCityCode, jobLocation, normalizeCity } from './regions'
import { assessCareerJob, type CareerJob, type CareerProfile } from './career'
export interface DiscoverySettings {
  autoRecommend: boolean
  recommendTime: string
  keywords: string[]
  city: string
  cities?: string[]
  minimumMonthlyK: number | null
  maxJobs: number
  detailLimit: number
  aiLimit: number
}
export function defaultDiscoverySettings(profile: CareerProfile): DiscoverySettings {
  return {
    autoRecommend: false,
    recommendTime: '09:30',
    keywords: profile.targetRoles.slice(0, 3),
    city: profile.preferredCities[0] || '',
    cities: profile.preferredCities,
    minimumMonthlyK: profile.minimumMonthlyK,
    maxJobs: 60,
    detailLimit: 40,
    aiLimit: 30
  }
}
export function validateDiscoverySettings(input: any, allowEmptyKeywords = false): DiscoverySettings {
  if (
    !input ||
    !Array.isArray(input.keywords) ||
    (!input.keywords.length && !allowEmptyKeywords) ||
    input.keywords.length > 6 ||
    input.keywords.some((s: any) => typeof s !== 'string' || !s.trim() || s.length > 60) ||
    typeof input.city !== 'string' || (!input.city.trim() && !allowEmptyKeywords)
  )
    throw Error('请填写城市和 1–6 个岗位关键词')
  if (
    typeof input.autoRecommend !== 'boolean' ||
    !/^([01]\d|20):[0-5]\d$/.test(input.recommendTime) ||
    input.recommendTime < '09:00'
  )
    throw Error('推荐时间请设置在北京时间 09:00–20:59')
  if (
    input.minimumMonthlyK !== null &&
    (!Number.isFinite(input.minimumMonthlyK) ||
      input.minimumMonthlyK < 1 ||
      input.minimumMonthlyK > 1000)
  )
    throw Error('期望月薪格式无效')
  for (const [key, min, max] of [
    ['maxJobs', 1, 60],
    ['detailLimit', 1, 40],
    ['aiLimit', 0, 30]
  ] as const)
    if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max)
      throw Error('读取或 AI 分析数量超出本轮限制')
  return {
    autoRecommend: input.autoRecommend,
    recommendTime: input.recommendTime,
    keywords: [...new Set<string>(input.keywords.map((v: string) => v.trim()))],
    city: input.city.trim(),
    cities: Array.isArray(input.cities) ? input.cities.filter((c:unknown)=>typeof c==='string' && c.trim()).slice(0,10) : [input.city.trim()],
    minimumMonthlyK: input.minimumMonthlyK,
    maxJobs: input.maxJobs,
    detailLimit: Math.min(input.detailLimit, input.maxJobs),
    aiLimit: Math.min(input.aiLimit, input.detailLimit, input.maxJobs)
  }
}
export function discoveryAssessment(
  job: CareerJob & { cityName?: string },
  profile: CareerProfile,
  settings: DiscoverySettings
) {
  const assessment = assessCareerJob(
    { ...job, address: job.cityName || job.address },
    {
      ...profile,
      preferredCities: settings.cities?.length ? settings.cities : [settings.city],
      minimumMonthlyK: settings.minimumMonthlyK,
      evidence: profile.evidence
    }
  )
  const place = jobLocation(job), excluded: string[] = [], missing: string[] = []
  const targets = (settings.cities?.length ? settings.cities : [settings.city]).filter(Boolean).map(normalizeCity)
  if (!targets.length) missing.push('求职城市待设置')
  else if (!place.city) missing.push(place.reason)
  else if (!targets.includes(normalizeCity(place.city))) excluded.push('工作城市与目标城市不一致')
  if (!(Number(job.salaryHigh) > 0)) missing.push('薪资上限待核实')
  else if (settings.minimumMonthlyK !== null && Number(job.salaryHigh) < settings.minimumMonthlyK)
    excluded.push(`薪资上限低于 ${settings.minimumMonthlyK}K 期望`)
  if ((job.description || '').trim().length < 80) missing.push('完整招聘要求待补齐')
  const bucket = excluded.length
    ? 'excluded'
    : missing.length
      ? 'verify'
      : assessment.score >= 65
        ? 'priority'
        : 'possible'
  return {
    ...assessment,
    provisional: assessment.matchedEvidence.some((e) => !e.confirmed),
    bucket,
    excluded,
    missing,
    nextAction: excluded.length
      ? '查看排除依据，可调整筛选条件'
      : missing.length
        ? '先补齐并核实岗位条件'
        : assessment.score >= 65
          ? '阅读 AI 分析，再加入跟进并准备匹配招呼'
          : '核实职责边界，判断是否值得投入'
  }
}
export const discoverySearchUrl = (keyword: string, city: string) =>
  'https://www.zhipin.com/web/geek/jobs?' +
  new URLSearchParams({ query: keyword, city: bossCityCode(city) }).toString()

export const recommendationLabels: Record<string, string> = {
  prioritize: '优先争取',
  consider: '可以考虑',
  verify: '先核实',
  skip: '不建议投入'
}
export function recommendationRank(row: any) {
  if (!row.analyzed || row.analysisOutdated) return 2
  const decision = row.item.analysis?.analysis?.recommendation?.decision
  return (
    ({ prioritize: 0, consider: 1, verify: 3, skip: 4 } as Record<string, number>)[decision] ?? 2
  )
}

export const discoveryChannelLabels = { targeted: '目标岗位搜索', recommended: 'BOSS 推荐岗位' } as const
export type DiscoveryChannel = keyof typeof discoveryChannelLabels
export function validateDiscoveryChannels(value: unknown): DiscoveryChannel[] {
  if (!Array.isArray(value) || !value.length || value.some(v => !['targeted', 'recommended'].includes(v)))
    throw Error('请选择目标岗位搜索、BOSS 推荐岗位中的至少一种来源')
  return (['targeted', 'recommended'] as DiscoveryChannel[]).filter(v => value.includes(v))
}
export function discoverySources(channels: DiscoveryChannel[], keywords: string[], cities: string[]) {
  if (!cities.length) throw Error('请先设置求职城市')
  return [...new Set(cities.map(normalizeCity))].flatMap(city => channels.flatMap<{channel:DiscoveryChannel;keyword:string;url:string;origin:string}>(channel => channel === 'targeted'
    ? keywords.map(keyword => ({channel,keyword,url:discoverySearchUrl(keyword,city),origin:'BOSS 主动搜索'}))
    : [{channel,keyword:'',url:'https://www.zhipin.com/web/geek/jobs?'+new URLSearchParams({city:bossCityCode(city)}),origin:'BOSS 推荐'}]))
}
export function itemDiscoveryChannels(item: { origins?: string[]; origin?: string } = {}): DiscoveryChannel[] {
  const origins = item.origins || [item.origin || '']
  return (['targeted', 'recommended'] as DiscoveryChannel[]).filter(channel => origins.some(origin =>
    channel === 'targeted' ? ['BOSS 搜索', 'BOSS 主动搜索'].includes(origin) : origin === 'BOSS 推荐'))
}
