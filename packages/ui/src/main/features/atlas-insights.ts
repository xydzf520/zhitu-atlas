import { salaryDistribution } from '../../common/salary'
import { inAccountScope } from './atlas-account-scope'
import { atlasDb, atlasRead, atlasWrite, fingerprint, atlasTransaction } from './atlas-store'
import { canonicalProfile, profileHistory } from './atlas-profile'
import { careerPolicy } from './atlas-policy'
import { discoveryItems } from './atlas-discovery-state'
import { analysisModel, currentAnalysisPromptVersion } from './atlas-ai'
import { contactJobBasis } from './atlas-contact'
import { profileEvidence } from '../../common/career'
import { contactBaseMatch } from '../../common/contact'
import { jobLocation, locationGroups } from '../../common/regions'
import { insightKinds, validateInsightReport, type InsightKind } from '../../common/insights'
import { agentConfig, resolveAgent } from './atlas-agents'
import { modelVersion } from './atlas-model-config'
import { deepseekConfig, deepseekJson, modelCacheHit } from './atlas-deepseek'
import { projectFacts } from './atlas-portfolio'
import { acquireLease, keepLeaseAlive, releaseLease } from './atlas-tasks'

const account = () => atlasRead<any>('career-boss-sync.json', null)?.account?.id || 'local'
const reportKey = (kind: InsightKind, days: number) =>
  'atlas-global-report/' + fingerprint([account(), kind, days])
function windowDays(input: any) {
  const days = Number(input?.days ?? 30)
  if (![0, 30, 90].includes(days)) throw Error('请选择最近30天、90天或全部样本')
  return days
}
function buildSnapshot(days: number) {
  const db = atlasDb(),
    user = account(),
    profile = canonicalProfile(),
    policy = careerPolicy(),
    profileVersion = profileHistory()[0]?.id || fingerprint(profile)
  const rows = db
    .prepare(
      'SELECT platform,source_id,body,observed_at,detail_at FROM platform_jobs WHERE account_id=? ORDER BY observed_at DESC,source_id'
    )
    .all(user)
  const seen = new Set(rows.map((r: any) => `${r.platform}:${r.source_id}`))
  const imported: any[] = []
  let unassigned = 0
  for (const o of atlasRead<any>('career-workspace.json', { opportunities: [] }).opportunities) {
    if (!o.job) continue
    if (!inAccountScope(o, user)) {
      if (!o.accountId && !o.userId) unassigned++
      continue
    }
    if ((o.platform === 'boss' || o.job.encryptJobId) && !o.accountId) {
      unassigned++
      continue
    }
    const platform = o.platform || 'manual',
      sourceId = o.sourceId || o.id,
      key = `${platform}:${sourceId}`
    if (seen.has(key)) continue
    seen.add(key)
    imported.push({
      discovery_id: 'local:' + o.id,
      platform,
      source_id: sourceId,
      body: JSON.stringify(o.job),
      observed_at: o.createdAt || '',
      detail_at: o.createdAt || ''
    })
  }
  const cutoff = days ? Date.now() - days * 86400000 : 0,
    all = [...rows, ...imported].sort((a, b) =>
      String(b.observed_at).localeCompare(String(a.observed_at))
    ),
    undated = all.filter((r) => !Number.isFinite(Date.parse(r.observed_at))).length
  const jobs = all
    .filter((r) => !days || Date.parse(r.observed_at) >= cutoff)
    .map((r) => ({
      ...JSON.parse(r.body),
      insightId: 'job:' + fingerprint([r.platform, user, r.source_id]).slice(0, 24),
      sourceId: r.source_id,
      discoveryId: r.discovery_id || (r.platform === 'boss' ? r.source_id : ''),
      platform: r.platform,
      observedAt: r.observed_at,
      detailAt: r.detail_at
    }))
  const evidence = profileEvidence(profile),
    confirmed = evidence.filter((e) => e.confirmed),
    model = analysisModel(),
    prompt = currentAnalysisPromptVersion(),
    items = discoveryItems(user)
  const matchCounts = { met: 0, verify: 0, gap: 0 },
    requirements = new Map<string, any>()
  let analyzed = 0
  for (const job of jobs) {
    const match = contactBaseMatch(job, profile)
    matchCounts[
      match.some((c) => c.status === 'gap')
        ? 'gap'
        : match.every((c) => c.status === 'met')
          ? 'met'
          : 'verify'
    ]++
    const record = job.discoveryId ? items.get(job.discoveryId) : null,
      report = record?.analysis
    if (
      !report ||
      report.profileVersion !== profileVersion ||
      report.model !== model ||
      report.promptVersion !== prompt ||
      record.analysisBasis !== contactJobBasis(job)
    )
      continue
    analyzed++
    const used = new Set<string>()
    for (const r of report.analysis?.requirements || []) {
      const key = String(r.requirement).trim().slice(0, 120)
      if (!key || used.has(key)) continue
      used.add(key)
      const item = requirements.get(key) || { name: key, met: 0, verify: 0, gap: 0, jobs: [] }
      const status =
        r.status === 'met' &&
        r.evidenceIds?.length &&
        r.evidenceIds.every((id: string) => confirmed.some((e) => e.id === id))
          ? 'met'
          : r.status === 'gap'
            ? 'gap'
            : 'verify'
      item[status]++
      if (item.jobs.length < 5) item.jobs.push({ id: job.insightId, name: job.jobName })
      requirements.set(key, item)
    }
  }
  const checks = [
    { label: '求职方向', ok: profile.targetRoles.length > 0 },
    { label: '求职城市', ok: profile.preferredCities.length > 0 },
    { label: '个人优势', ok: !!profile.summary.trim() },
    { label: '简历正文', ok: !!profile.resumeText.trim() },
    { label: '可引用经历', ok: !!confirmed.length },
    { label: '期望薪资', ok: profile.minimumMonthlyK !== null }
  ]
  const salaryJobs = jobs.filter(
      (j) => Number(j.salaryLow) > 0 && Number(j.salaryHigh) >= Number(j.salaryLow)
    ),
    salaries = salaryJobs
      .map((j) => (Number(j.salaryLow) + Number(j.salaryHigh)) / 2)
      .sort((a, b) => a - b)
  const salaryMedian = salaries.length
    ? (salaries[Math.floor((salaries.length - 1) / 2)] +
        salaries[Math.floor(salaries.length / 2)]) /
      2
    : null
  const salaryBands = salaryDistribution(salaries).map(({name,count}) => ({name,count}))
  const roles = profile.targetRoles.map((name) => ({
    name,
    count: jobs.filter((j) =>
      String(j.jobName || '')
        .toLowerCase()
        .includes(name.toLowerCase())
    ).length
  }))
  const stages = db
    .prepare('SELECT body FROM opportunities')
    .all()
    .map((r: any) => JSON.parse(r.body))
    .filter((o: any) => inAccountScope(o, user) && !o.archived && !o.mergedInto)
    .reduce((out: any, o: any) => {
      out[o.stage || '待评估'] = (out[o.stage || '待评估'] || 0) + 1
      return out
    }, {})
  const stats = {
    total: jobs.length,
    allStored: all.length,
    undated,
    unassigned,
    completeJd: jobs.filter((j) => j.description?.length >= 80).length,
    analyzed,
    match: matchCounts,
    salaryMedian,
    salarySamples: salaryJobs.length,
    salaryUnknown: jobs.length - salaryJobs.length,
    salaryBands,
    cities: locationGroups(jobs.map((job) => ({ job }))),
    roles,
    stages,
    requirements: [...requirements.values()]
      .sort((a, b) => b.met + b.verify + b.gap - (a.met + a.verify + a.gap))
      .slice(0, 8)
  }
  const actions: any[] = []
  if (checks.some((c) => !c.ok))
    actions.push({
      id: 'profile',
      title: '补齐求职资料',
      detail: checks
        .filter((c) => !c.ok)
        .map((c) => c.label)
        .join('、'),
      destination: 'profile',
      count: checks.filter((c) => !c.ok).length
    })
  if (evidence.length > confirmed.length)
    actions.push({
      id: 'evidence',
      title: '核对经历依据',
      detail: '确认后可用于匹配和话术',
      destination: 'profile',
      count: evidence.length - confirmed.length
    })
  if (jobs.length > stats.completeJd)
    actions.push({
      id: 'details',
      title: '补齐岗位详情',
      detail: '缺少完整 JD',
      destination: 'discovery',
      count: jobs.length - stats.completeJd
    })
  if (stats.completeJd > analyzed)
    actions.push({
      id: 'analysis',
      title: '分析待评估岗位',
      detail: '已有 JD，尚无当前版本分析',
      destination: 'discovery',
      count: stats.completeJd - analyzed
    })
  if (!jobs.length)
    actions.push({
      id: 'search',
      title: '先收集目标岗位',
      detail: '搜索、推荐或导入岗位',
      destination: 'discovery',
      count: 0
    })
  const sourceJobs = jobs.slice(0, 60)
  const sources: any[] = [
    {
      id: 'profile',
      label: '当前简历与求职方向',
      kind: 'profile',
      text: {
        headline: profile.headline,
        summary: profile.summary,
        resumeText: profile.resumeText.slice(0, 18000),
        ...policy.direction
      }
    },
    { id: 'sample', label: `${jobs.length}个岗位样本`, kind: 'sample', text: stats },
    ...evidence.map((e) => ({
      id: 'evidence:' + e.id,
      label: e.title,
      kind: 'evidence',
      confirmed: !!e.confirmed,
      text: e.text,
      source: e.source
    })),
    ...sourceJobs.map((j) => ({
      id: j.insightId,
      label: `${j.companyName} · ${j.jobName}`,
      kind: 'job',
      text: {
        title: j.jobName,
        company: j.companyName,
        city: jobLocation(j).city,
        salaryLow: j.salaryLow,
        salaryHigh: j.salaryHigh,
        description: (j.description || '').slice(0, 2500),
        observedAt: j.observedAt
      },
      jobId: j.platform === 'boss' ? j.sourceId : undefined
    }))
  ]
  const basis = fingerprint([
    user,
    profileVersion,
    policy.direction,
    days,
    jobs.map((j) => [
      j.platform,
      j.sourceId,
      j.observedAt,
      j.description,
      j.salaryLow,
      j.salaryHigh,
      j.address
    ]),
    stats,
    evidence,
    modelVersion(),
    projectFacts(profile)
  ])
  return {
    accountId: user,
    days,
    basis,
    profileVersion,
    profile: {
      headline: profile.headline,
      targetRoles: profile.targetRoles,
      cities: profile.preferredCities,
      minimumMonthlyK: profile.minimumMonthlyK,
      evidenceTotal: evidence.length,
      confirmed: confirmed.length,
      checks
    },
    stats,
    actions,
    sources,
    aiSampleCount: sourceJobs.length
  }
}
export function insightsOverview(input: any = {}) {
  const days = windowDays(input),
    snapshot = buildSnapshot(days)
  const reports = Object.fromEntries(
    insightKinds.map((kind) => {
      const r = atlasRead<any>(reportKey(kind, days), null)
      return [
        kind,
        r
          ? {
              ...r,
              stale: r.basis !== snapshot.basis || r.agentSignature !== agentConfig(kind).signature
            }
          : null
      ]
    })
  )
  const tasks = atlasDb()
    .prepare(
      "SELECT id,kind,state,step,error,created_at,input FROM task_runs WHERE account_id=? AND kind IN ('career-resume-review','career-market-review') ORDER BY created_at DESC LIMIT 40"
    )
    .all(snapshot.accountId)
    .filter((t: any) => Number(JSON.parse(t.input)?.days ?? 30) === days)
  const latestTasks = insightKinds
    .map((kind) => tasks.find((t: any) => t.kind === 'career-' + kind))
    .filter(Boolean)
    .map(({ input: _, ...t }: any) => t)
  return {
    ...snapshot,
    sources: snapshot.sources.map(({ text: _, ...s }) => s),
    reports,
    latestTasks,
    tasks: tasks
      .filter((t: any) => ['queued', 'running'].includes(t.state))
      .map(({ input: _, ...t }: any) => t)
  }
}
export async function analyzeInsights(kind: InsightKind, input: any = {}) {
  const days = windowDays(input),
    snapshot = buildSnapshot(days),
    agent = resolveAgent(kind),
    config = deepseekConfig()
  if (input.baseBasis && input.baseBasis !== snapshot.basis)
    throw Error('资料或岗位已更新，请刷新全局分析后重试')
  if (kind === 'market-review' && !snapshot.stats.total) throw Error('请先收集岗位，再分析市场机会')
  if (
    kind === 'resume-review' &&
    !snapshot.sources[0].text.resumeText &&
    !snapshot.sources[0].text.summary &&
    !snapshot.profile.evidenceTotal
  )
    throw Error('请先填写简历或经历')
  const key = reportKey(kind, days),
    old = atlasRead<any>(key, null)
  if (old?.basis === snapshot.basis && old?.agentSignature === agent.signature && !input.refresh) {
    modelCacheHit(kind, config.model, agent)
    return { ...old, cached: true }
  }
  const leaseKey = 'global-insight:' + fingerprint([snapshot.accountId, kind]),
    owner = acquireLease(leaseKey, 90000)
  if (!owner) throw Error('同类研判正在运行，请到任务中心查看')
  const stop = keepLeaseAlive(leaseKey, owner)
  try {
    const generated = await deepseekJson(
      config,
      agent.system,
      {
        scope: {
          days,
          window: '按最近观察时间，非发布时间',
          sampleCount: snapshot.stats.total,
          jdSampleCount: snapshot.aiSampleCount,
          selection: '当前账号窗口内最近60个去重岗位，统计使用全部窗口内样本；不是全国招聘市场'
        },
        // Platform IDs are needed by the UI, but the model should see one
        // unambiguous citation ID per source.
        sources: snapshot.sources.map(({ jobId: _, ...source }) => source),
        confirmedEvidence: profileEvidence(canonicalProfile())
          .filter((e) => e.confirmed)
          .map((e) => ({ ...e, id: 'evidence:' + e.id })),
        projects: projectFacts(canonicalProfile()).map((p) => ({
          ...p,
          evidenceId: 'evidence:' + p.evidenceId
        }))
      },
      input.signal || AbortSignal.timeout(45 * 60000),
      { kind, agent, accountId: snapshot.accountId, automatic: !!input.automatic }
    )
    const report = validateInsightReport(generated.value, snapshot.sources)
    return atlasTransaction(() => {
      if (account() !== snapshot.accountId || buildSnapshot(days).basis !== snapshot.basis)
        throw Error('研判期间资料、账号或岗位发生变化，旧报告保留，请重新分析')
      const value = {
        kind,
        ...report,
        basis: snapshot.basis,
        accountId: snapshot.accountId,
        profileVersion: snapshot.profileVersion,
        agentSignature: agent.signature,
        model: config.model,
        createdAt: new Date().toISOString(),
        usage: generated.usage,
        sources: snapshot.sources.map(({ text: _, ...s }) => s)
      }
      atlasWrite(key, value)
      return value
    })
  } finally {
    stop()
    releaseLease(leaseKey, owner)
  }
}
export function registerInsights(handle: (name: string, fn: (...args: any[]) => any) => void) {
  handle('career-insights-overview', (_, p) => insightsOverview(p))
  handle('career-resume-review', (_, p) => analyzeInsights('resume-review', p))
  handle('career-market-review', (_, p) => analyzeInsights('market-review', p))
}
