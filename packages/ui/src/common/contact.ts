import { jobLocation, normalizeCity } from './regions'
import { assessCareerJob, type CareerJob, type CareerProfile } from './career'

export type MatchStatus = 'met' | 'verify' | 'gap'
export interface MatchCheck {
  key: string
  label: string
  status: MatchStatus
  reason: string
  evidenceIds?: string[]
}
export interface Qualification {
  id: string
  kind: 'education' | 'experience' | 'other'
  label: string
  value: string
  confirmed: boolean
  source: string
}
export const contactStates: Record<string, string> = {
  queued: '待联系',
  generating: '生成匹配说明',
  awaiting_confirmation: '待本人确认话术',
  ready: '准备联系',
  opening: '建立会话中',
  cooling: '已开聊 · 等待补充说明',
  sending: '发送匹配说明',
  verifying: '核验消息',
  completed: '自动联系成功',
  manual: '人工确认已发送',
  review: '需要处理',
  uncertain: '发送结果不确定',
  failed: '执行失败',
  cancelled: '已取消',
  existing: '已有会话'
}
const rankDegree = (v: string) =>
  /博士/.test(v)
    ? 5
    : /硕士|研究生/.test(v)
      ? 4
      : /本科|学士/.test(v)
        ? 3
        : /大专|专科/.test(v)
          ? 2
          : /高中|中专/.test(v)
            ? 1
            : 0
export function contactBaseMatch(
  job: CareerJob & Record<string, any>,
  profile: CareerProfile
): MatchCheck[] {
  const checks: MatchCheck[] = [],
    facts = profile.qualifications || []
  const add = (
    key: string,
    label: string,
    status: MatchStatus,
    reason: string,
    evidenceIds: string[] = []
  ) => checks.push({ key, label, status, reason, evidenceIds })
  const assessment = assessCareerJob({ ...job, address: job.cityName || job.address }, profile)
  add(
    'role',
    '岗位方向与初筛',
    assessment.score >= 65 ? 'met' : 'verify',
    assessment.score >= 65 ? '通过当前岗位方向与初筛门槛' : '关联依据不足，未通过自动联系初筛'
  )
  const location = jobLocation(job),
    place = location.city
  const cityMet =
    !!place && profile.preferredCities.map(normalizeCity).includes(normalizeCity(place))
  add(
    'city',
    '工作城市',
    cityMet ? 'met' : !place || !profile.preferredCities.length ? 'verify' : 'gap',
    cityMet ? place : !place ? location.reason : '工作地点与目标城市不一致'
  )
  add(
    'salary',
    '薪资区间',
    !job.salaryHigh || !profile.minimumMonthlyK
      ? 'verify'
      : job.salaryHigh >= profile.minimumMonthlyK
        ? 'met'
        : 'gap',
    !job.salaryHigh
      ? '月薪上限未知'
      : !profile.minimumMonthlyK
        ? `月薪上限 ${job.salaryHigh}K；期望薪资待设置`
        : job.salaryHigh < profile.minimumMonthlyK
          ? `月薪上限 ${job.salaryHigh}K，低于期望 ${profile.minimumMonthlyK}K`
          : `月薪上限 ${job.salaryHigh}K；期望 ${profile.minimumMonthlyK}K，区间符合不代表薪资承诺`
  )
  add(
    'jd',
    '完整招聘要求',
    (job.description || '').trim().length >= 80 ? 'met' : 'verify',
    (job.description || '').trim().length >= 80 ? '已读取招聘要求' : '先补齐完整 JD'
  )
  if (/关闭|下架|停止招聘/.test(String(job.hireStatus || job.jobStatus || '')))
    add('active', '岗位有效性', 'gap', '平台显示岗位已停止招聘')
  const related = assessment.matchedEvidence.filter((e) => e.confirmed && e.id)
  add(
    'evidence',
    '相关经历依据',
    related.length ? 'met' : 'verify',
    related.length
      ? `${related.length} 项相关经历已确认`
      : '没有已确认的相关经历，请到简历与资料核实',
    related.map((e) => e.id!)
  )
  // A preference is not a mandatory qualification. Never infer the applicant's degree/years.
  const clauses = (job.description || '')
    .split(/[。；;，,\n]|(?<=学历|学位|及以上)(?=本科|硕士|博士|大专)/)
    .flatMap((s) => s.split(/(?:以及|并且|同时|及|且|和|并)\s*(?=\d)/))
    .filter((s) => !/优先|加分|不限|非必须|不要求/.test(s))
  const degreeText = [
    /不限|优先/.test(job.degreeName || '') ? '' : job.degreeName || '',
    ...clauses.filter((s) => /本科|硕士|博士|大专|学历|全日制|统招/.test(s))
  ].join('；')
  if (degreeText) {
    // Alternatives within a clause lower its minimum; independent clauses remain mandatory.
    const required = Math.max(
        0,
        ...degreeText.split('；').map((clause) => {
          const alternatives = clause.split(/或者|或|\//).map(rankDegree)
          return alternatives.every(Boolean) ? Math.min(...alternatives) : rankDegree(clause)
        })
      ),
      known = facts.filter((f) => f.kind === 'education' && f.confirmed),
      actual = Math.max(0, ...known.map((f) => rankDegree(f.value))),
      fullTime = /统招|(?<!非)全日制/.test(degreeText),
      sufficient = known.filter((f) => rankDegree(f.value) >= required),
      fullTimeMet = sufficient.some(
        (f) => !/非全日制/.test(f.value) && /统招|全日制/.test(f.value)
      ),
      fullTimeGap = sufficient.length > 0 && sufficient.every((f) => /非全日制/.test(f.value))
    const ambiguous = degreeText
      .split('；')
      .some(
        (clause) =>
          /或者|或|\//.test(clause) && clause.split(/或者|或|\//).some((part) => !rankDegree(part))
      )
    const status =
      ambiguous || !required || !actual
        ? 'verify'
        : actual < required
          ? 'gap'
          : fullTime && !fullTimeMet
            ? fullTimeGap
              ? 'gap'
              : 'verify'
            : 'met'
    add(
      'degree',
      '必要学历',
      status,
      status === 'met'
        ? '已记录学历满足该要求'
        : status === 'gap'
          ? fullTime && fullTimeGap && actual >= required
            ? '岗位要求全日制／统招，已记录的相应学历为非全日制'
            : '已记录学历低于岗位要求'
          : '实际学历或学习形式待核实，不能从关键词推定',
      known.map((f) => f.id)
    )
  }
  const yearsRequirements = [
    ...new Set(
      [
        ...(/不限|应届|优先/.test(job.experienceName || '') ? [] : [job.experienceName || '']),
        ...clauses.filter((s) =>
          /\d+\s*(?:[-–~至]\s*\d+)?\s*年.{0,12}(?:经验|经历)|经验.{0,8}\d+\s*年/.test(s)
        )
      ]
        .filter(Boolean)
        .flatMap((clause) => clause.split(/(?:以及|并且|同时|及|且|和|并)\s*(?=\d)/))
    )
  ]
  for (const [index, yearsText] of yearsRequirements.entries()) {
    const required = Number(yearsText.match(/\d+/)?.[0]),
      specialized = /管理/.test(yearsText)
        ? '管理'
        : /产品|行业|团队|算法|研发|销售|运营/.exec(yearsText)?.[0]
    // General product tenure must not satisfy a separate AI/domain tenure requirement.
    // Use the fact label, never explanatory text such as "not equivalent to AI experience".
    const aiSpecific =
      /AI|AIGC|人工智能|大模型|智能体/i.test(yearsText) &&
      !/互联网.{0,20}(?:或|\/)|智能硬件.{0,12}或/.test(yearsText)
    const known = facts.filter(
      (f) =>
        f.kind === 'experience' &&
        f.confirmed &&
        (!specialized || (f.label + f.value).includes(specialized)) &&
        (!aiSpecific || /AI|AIGC|人工智能|大模型|智能体/i.test(f.label))
    )
    const values = known
      .map((f) => Number(f.value.match(/\d+(?:\.\d+)?/)?.[0]))
      .filter(Number.isFinite)
    const status =
      !required || !values.length || /(?:或|\/).*\d+\s*年/.test(yearsText)
        ? 'verify'
        : Math.max(...values) >= required
          ? 'met'
          : 'gap'
    add(
      index === 0 ? 'experience' : `experience-${index}`,
      aiSpecific ? '必要 AI 相关经验' : `必要${specialized || '工作'}经验`,
      status,
      status === 'met'
        ? `已确认相关经验年限满足：${yearsText.trim()}`
        : status === 'gap'
          ? `已确认相关经验年限不足：${yearsText.trim()}`
          : `请核实“${yearsText.trim()}”，不能用总工龄替代`,
      known.map((f) => f.id)
    )
  }
  return checks
}
export function finishContactMatch(checks: MatchCheck[]) {
  const gaps = checks.filter((c) => c.status === 'gap'),
    pending = checks.filter((c) => c.status === 'verify')
  return {
    checks,
    eligible: !gaps.length && !pending.length,
    status: gaps.length ? 'excluded' : pending.length ? 'verify' : 'eligible',
    satisfied: checks.filter((c) => c.status === 'met').length,
    pending: pending.length,
    reasons: [...gaps, ...pending].map((c) => c.reason)
  }
}
