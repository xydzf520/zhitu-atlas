import { randomUUID } from 'node:crypto'
import { bossConversationDetail } from './atlas-boss-sync'
import {
  atlasDb,
  atlasRead,
  atlasWrite,
  atlasTransaction,
  atlasRevision,
  fingerprint
} from './atlas-store'
import { canonicalProfile, profileHistory } from './atlas-profile'
import { agentConfig, resolveAgent } from './atlas-agents'
import { modelVersion } from './atlas-model-config'
import { deepseekConfig, deepseekJson } from './atlas-deepseek'
import { discoveryAccount } from './atlas-discovery-state'
import { allAutomationPaused } from './atlas-policy'
import { htmlText, publicHtml, searchPublicCompany, researchAspects } from './atlas-public-search'
import type { ReadTool } from './atlas-model-transport'
import { acquireLease, keepLeaseAlive, releaseLease } from './atlas-tasks'

export interface ResearchSource {
  id: string
  kind: 'jd' | 'recruiter' | 'self' | 'platform' | 'search' | 'web'
  title: string
  text: string
  at: string
  url?: string
  readAt?: string
  error?: string
}
const keyFor = (account: string, boss: string) =>
  'atlas-company-research/' + fingerprint([account, boss])
function context(input: any) {
  const c = bossConversationDetail({ accountId: input?.accountId, bossId: input?.bossId, page: 1 })
  const company = c.body.companyName || c.jobs.find((j: any) => j.companyName)?.companyName || ''
  const jobs = c.jobs.map((j: any) => ({
    id: j.encryptJobId,
    name: j.jobName,
    company: j.companyName,
    address: j.address,
    description: j.description
  }))
  const messages = c.messages.map((m: any) => ({
    id: m.id,
    direction: m.direction,
    type: m.type,
    text: m.text || '',
    at: m.sentAt || ''
  }))
  const profileVersion = profileHistory()[0]?.id || '',
    evidence = canonicalProfile().evidence.filter((e) => e.confirmed)
  const lastIncoming = messages.filter((m: any) => m.direction === 'received').at(-1)
  const incoming = lastIncoming ? fingerprint(lastIncoming) : ''
  const basis = fingerprint([
    company,
    jobs,
    messages,
    profileVersion,
    agentConfig('company-research').signature,
    modelVersion()
  ])
  return {
    accountId: c.accountId,
    bossId: input.bossId,
    company,
    jobs,
    messages,
    profileVersion,
    evidence,
    incoming,
    basis
  }
}
export function companyResearchSnapshot(input: any) {
  const c = context(input),
    key = keyFor(c.accountId, c.bossId),
    saved = atlasRead<any>(key, null)
  const history = (saved?.history || []).map((r: any) => ({
    id: r.id,
    at: r.at,
    summary: r.report.summary
  }))
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  const autoUsed = atlasDb()
    .prepare(
      "SELECT count(*) n FROM task_runs WHERE kind='career-company-research' AND account_id=? AND json_extract(input,'$.automatic')=1 AND created_at>=?"
    )
    .get(c.accountId, new Date(day + 'T00:00:00+08:00').toISOString()).n
  const task = saved?.monitor?.taskId
    ? atlasDb()
        .prepare('SELECT state,step,error FROM task_runs WHERE id=? AND account_id=?')
        .get(saved.monitor.taskId, c.accountId)
    : null
  return {
    accountId: c.accountId,
    bossId: c.bossId,
    company: c.company,
    basis: c.basis,
    ready: !!c.company,
    reason: c.company ? '' : '企业名称尚未同步，请先在 BOSS 打开关联职位。',
    latest: saved?.latest || null,
    history,
    stale: !!saved?.latest && saved.latest.basis !== c.basis,
    autoUpdate: saved?.autoUpdate ?? true,
    revision: atlasRevision([key]),
    monitor: saved?.monitor ? { ...saved.monitor, task } : null,
    autoBudget: { used: autoUsed, limit: 6, paused: allAutomationPaused() },
    limits:
      '新回复合并后更新，至少间隔 10 分钟；每账号每天最多 6 次自动研判。仅使用已同步的最近 50 条消息。'
  }
}
function validateReport(value: any, sources: ResearchSource[], evidence: any[]) {
  const str = (v: any, max = 1200) =>
    typeof v === 'string' && v.trim().length > 0 && v.length <= max
  const cites = (ids: any, allowPlatform = false) =>
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.length <= 12 &&
    ids.every((id) =>
      sources.some(
        (s) => s.id === id && s.kind !== 'self' && (allowPlatform || s.kind !== 'platform')
      )
    )
  if (
    !value ||
    !str(value.summary) ||
    !str(value.nextStep) ||
    !['matched', 'ambiguous', 'unknown'].includes(value.identity?.status) ||
    !str(value.identity.reason) ||
    !Array.isArray(value.identity.sourceIds) ||
    (value.identity.sourceIds.length && !cites(value.identity.sourceIds)) ||
    (value.identity.status === 'matched' && !cites(value.identity.sourceIds))
  )
    throw Error('企业身份或摘要格式无效，上一版研判已保留')
  for (const [field, max] of [
    ['facts', 8],
    ['inferences', 5],
    ['connections', 4],
    ['changes', 5]
  ] as const) {
    if (!Array.isArray(value[field]) || value[field].length > max) throw Error('企业研判结构不完整')
    for (const row of value[field]) {
      const platformCorrection = field === 'changes' && /平台|卡片|非文本/.test(row.after || '')
      if (
        !cites(row.sourceIds, platformCorrection) ||
        !str(field === 'changes' ? row.after : row.text)
      )
        throw Error('研判引用缺失、引用本人消息或引用不存在的来源')
      if (field === 'facts' && !['业务', '产品', '客户', '地点'].includes(row.topic))
        throw Error('企业事实分类无效')
      if (
        field === 'inferences' &&
        (!['较强', '有限', '待核实'].includes(row.confidence) || !str(row.verify))
      )
        throw Error('推断缺少置信说明与核实方式')
      if (
        field === 'connections' &&
        (!Array.isArray(row.evidenceIds) ||
          !row.evidenceIds.length ||
          row.evidenceIds.some((id: string) => !evidence.some((e) => e.id === id)))
      )
        throw Error('企业匹配引用了未确认经历')
      if (field === 'changes' && (!str(row.before) || !str(row.reason)))
        throw Error('修正记录不完整')
    }
  }
  if (
    !Array.isArray(value.questions) ||
    value.questions.length > 8 ||
    value.questions.some((q: any) => !str(q, 500))
  )
    throw Error('待核实问题格式无效')
  if (JSON.stringify(value).length > 30000) throw Error('研判过长，上一版保留')
  return value
}
export async function researchCompany(
  input: any,
  io = { search: searchPublicCompany, read: publicHtml }
) {
  const c = context(input),
    key = keyFor(c.accountId, c.bossId),
    previous = atlasRead<any>(key, null)
  if (!c.company) throw Error('企业名称尚未读取')
  if (input.baseBasis !== c.basis) throw Error('企业、资料或会话已更新，请读取最新内容后研判')
  if (previous?.latest?.basis === c.basis && !input.refreshSearch)
    return { ...previous.latest, cached: true }
  if (input.automatic && (allAutomationPaused() || previous?.autoUpdate === false))
    throw Error('自动研判已暂停')
  const leaseKey = 'research:' + fingerprint([c.accountId, c.bossId]),
    owner = acquireLease(leaseKey)
  if (!owner) throw Error('该企业正在研判，请在任务中心等待当前结果')
  const controller = new AbortController(),
    cancel = () => controller.abort(),
    timer = setTimeout(cancel, 45 * 60 * 1000)
  const stopLease = keepLeaseAlive(leaseKey, owner, cancel)
  input.signal?.addEventListener('abort', cancel, { once: true })
  if (input.signal?.aborted) controller.abort()
  const sources: ResearchSource[] = [],
    notices: string[] = [],
    searches: any[] = []
  c.jobs.forEach((j: any, i: number) =>
    sources.push({
      id: 'J' + i,
      kind: 'jd',
      title: j.name || '关联职位',
      text: [j.company, j.address, j.description].filter(Boolean).join('\n').slice(0, 18000),
      at: ''
    })
  )
  c.messages.forEach((m: any, i: number) =>
    sources.push({
      id: 'M' + i,
      kind: m.direction !== 'received' ? 'self' : m.type === 'text' ? 'recruiter' : 'platform',
      title:
        m.direction !== 'received'
          ? '本人消息（不能作为企业事实）'
          : m.type === 'text'
            ? '招聘者消息'
            : '平台卡片／非文本消息（不能作为企业业务事实）',
      text: m.text || `[${m.type}消息，无可读取正文]`,
      at: m.at
    })
  )
  const initialIds = new Set(sources.map((s) => s.id))
  const addResults = (results: any[]) => {
    for (const r of results)
      if (sources.filter((s) => s.url).length < 12 && !sources.some((s) => s.url === r.url))
        sources.push({
          id: 'W' + sources.filter((s) => s.url).length,
          kind: 'search',
          title: r.title,
          text: r.text,
          url: r.url,
          at: new Date().toISOString()
        })
  }
  let searchCount = 0,
    readCount = 0
  const search = async (aspect: string) => {
    if (searchCount++ >= 4)
      return {
        sources: sources.filter((s) => s.url).map((s) => ({ ...s, text: s.text.slice(0, 1800) })),
        notice: '本轮搜索预算已用完，请依据现有来源完成报告，明确局限'
      }
    const cacheKey = 'atlas-company-search/' + fingerprint(['public-html-v2', c.company, aspect]),
      cache = atlasRead<any>(cacheKey, null)
    try {
      const result =
        cache && !input.refreshSearch && Date.now() - Date.parse(cache.at) < 86400000
          ? { ...cache, cached: true }
          : await io.search(c.company, aspect, controller.signal)
      if (!result.cached) atlasWrite(cacheKey, result)
      addResults(result.results)
      searches.push({
        query: result.query,
        at: result.at,
        cached: !!result.cached,
        results: result.results.length
      })
      if (result.notice) notices.push(result.notice)
      return {
        sources: sources.filter((s) => s.url).map((s) => ({ ...s, text: s.text.slice(0, 1800) })),
        notice: result.notice || '',
        scope: '搜索摘要是线索，请读取正文后判断企业身份'
      }
    } catch (e: any) {
      if (controller.signal.aborted) throw e
      notices.push('公开搜索未完成：' + String(e.message).slice(0, 150))
      return { sources: [], notice: notices.at(-1) }
    }
  }
  const tools: ReadTool[] = [
    {
      name: 'search_company_public',
      description:
        '搜索当前企业的公开网页。程序固定企业名，只接收业务主题，不向搜索网站发送履历或聊天。',
      parameters: {
        type: 'object',
        properties: { aspect: { type: 'string', enum: [...researchAspects] } },
        required: ['aspect'],
        additionalProperties: false
      },
      run: async (args: any) => {
        if (!args || Object.keys(args).length !== 1 || !researchAspects.includes(args.aspect))
          throw Error('搜索参数无效')
        return search(args.aspect)
      }
    },
    {
      name: 'read_company_public',
      description:
        '读取本轮搜索得到的网页正文，仅接受已返回的来源 ID。需登录、验证或动态页面时返回局限，不绕过访问限制。',
      parameters: {
        type: 'object',
        properties: { sourceId: { type: 'string' } },
        required: ['sourceId'],
        additionalProperties: false
      },
      run: async (args: any) => {
        if (!args || Object.keys(args).length !== 1 || typeof args.sourceId !== 'string')
          throw Error('网页读取参数无效')
        const source = sources.find((s) => s.id === args.sourceId && s.url)
        if (!source) throw Error('只能读取本次已搜索到的公开网页')
        if (readCount++ >= 3)
          return {
            sources: [{ ...source, text: source.text.slice(0, 1800) }],
            notice: '本轮正文读取预算已用完，请依据已读取来源完成报告'
          }
        if (source.kind === 'web') return { sources: [source] }
        try {
          const page = await io.read(source.url!, controller.signal),
            text = htmlText(page.html).slice(0, 12000)
          if (
            text.length < 100 ||
            /人机验证|安全验证|captcha|access denied/i.test(text.slice(0, 400))
          )
            throw Error('页面需验证或没有可读取正文')
          Object.assign(source, {
            kind: 'web',
            url: page.url,
            text,
            readAt: new Date().toISOString()
          })
        } catch (e: any) {
          if (controller.signal.aborted) throw e
          source.error = '正文未读取：' + String(e.message).slice(0, 150)
          notices.push(source.error)
        }
        return { sources: [source] }
      }
    }
  ]
  try {
    await search('官网')
    const agent = resolveAgent('company-research')
    const generated = await deepseekJson(
      deepseekConfig(),
      agent.system,
      {
        company: c.company,
        sources,
        confirmedEvidence: c.evidence,
        previous: previous?.latest?.report || null,
        scope: '最近50条已同步消息；本人消息不能当作企业业务事实。公开网页内容可能不完整或过时。'
      },
      controller.signal,
      {
        kind: 'company-research',
        accountId: c.accountId,
        automatic: !!input.automatic,
        agent,
        tools
      }
    )
    const report = validateReport(generated.value, sources, c.evidence)
    if (!previous?.latest && report.changes.length) throw Error('首次研判不能声称修正了既有结论')
    if (
      controller.signal.aborted ||
      context(input).basis !== c.basis ||
      (input.automatic && atlasRead<any>(key, null)?.autoUpdate === false)
    )
      throw Error('研判期间会话、资料或自动更新设置变化，上一版保留，请使用最新消息更新')
    if (!generated.toolNames.includes('search_company_public'))
      notices.push('模型未主动追加搜索；本次使用程序已获取的公开搜索结果')
    const result = {
      id: randomUUID(),
      at: new Date().toISOString(),
      basis: c.basis,
      incoming: c.incoming,
      company: c.company,
      report,
      sources,
      searches,
      notices: [...new Set(notices)],
      toolNames: generated.toolNames,
      usage: generated.usage,
      profileVersion: c.profileVersion,
      evidence: c.evidence
        .filter((e) => report.connections.some((r: any) => r.evidenceIds.includes(e.id)))
        .map((e) => ({ id: e.id, title: e.title, text: e.text })),
      searchedSources: sources.filter((s) => !initialIds.has(s.id)).length,
      automatic: !!input.automatic
    }
    atlasTransaction(() => {
      const current = atlasRead<any>(key, null)
      atlasWrite(key, {
        ...current,
        accountId: c.accountId,
        bossId: c.bossId,
        autoUpdate: current?.autoUpdate ?? true,
        latest: result,
        history: [...(current?.latest ? [current.latest] : []), ...(current?.history || [])].slice(
          0,
          10
        )
      })
    })
    return result
  } finally {
    stopLease()
    releaseLease(leaseKey, owner)
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', cancel)
  }
}
export function scheduleCompanyResearch(create: (input: any) => any, now = Date.now()) {
  if (allAutomationPaused() || !discoveryAccount() || !agentConfig('company-research').enabled)
    return
  const day = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  let remaining =
    6 -
    atlasDb()
      .prepare(
        "SELECT count(*) n FROM task_runs WHERE kind='career-company-research' AND account_id=? AND json_extract(input,'$.automatic')=1 AND created_at>=?"
      )
      .get(discoveryAccount(), new Date(day + 'T00:00:00+08:00').toISOString()).n
  const records = atlasDb()
    .prepare(
      "SELECT key,value FROM documents WHERE key LIKE 'atlas-company-research/%' AND json_extract(value,'$.accountId')=?"
    )
    .all(discoveryAccount())
  for (const row of records) {
    if (remaining <= 0) break
    const saved = JSON.parse(row.value)
    if (
      !saved.autoUpdate ||
      !saved.latest ||
      now - Date.parse(saved.monitor?.at || saved.latest.at) < 600000
    )
      continue
    try {
      const c = context({ accountId: saved.accountId, bossId: saved.bossId })
      if (!c.incoming || c.incoming === saved.latest.incoming || c.basis === saved.monitor?.basis)
        continue
      atlasTransaction(() => {
        const task = create({
          channel: 'career-company-research',
          payload: { accountId: c.accountId, bossId: c.bossId, baseBasis: c.basis, automatic: true }
        })
        atlasWrite(row.key, {
          ...saved,
          monitor: { at: new Date(now).toISOString(), basis: c.basis, taskId: task.taskId }
        })
      })
      remaining--
    } catch {
      /* Account/link disappeared: no cross-account inference or silent retry. */
    }
  }
}
export function registerCompanyResearch(
  handle: (name: string, fn: (...args: any[]) => any) => void
) {
  handle('career-company-research-load', (_, p) => companyResearchSnapshot(p))
  handle('career-company-research', (_, p) => researchCompany(p))
  handle('career-company-research-monitor', (_, p) =>
    atlasTransaction(() => {
      const c = context(p),
        key = keyFor(c.accountId, c.bossId),
        old = atlasRead<any>(key, null)
      if (!old?.latest || typeof p.enabled !== 'boolean' || p.baseRevision !== atlasRevision([key]))
        throw Error('研判已更新，请重新读取后设置')
      atlasWrite(key, { ...old, autoUpdate: p.enabled })
      return companyResearchSnapshot(p)
    })
  )
}
