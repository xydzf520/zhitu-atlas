import { inAccountScope, sameOpportunityScope } from './atlas-account-scope'
import { randomUUID } from 'node:crypto'
import { atlasDb, atlasEvent, atlasTransaction, fingerprint } from './atlas-store'

function db() {
  return atlasDb()
}
export function indexOpportunity(item: any) {
  return atlasTransaction(() => {
    const d = db(),
      prev = d.prepare('SELECT body FROM opportunities WHERE id=?').get(item.id)
    const old = prev ? JSON.parse(prev.body) : null
    const value = JSON.stringify({
      ...item,
      archived: old?.archived || false,
      mergedInto: old?.mergedInto || ''
    })
    if (prev?.body === value) return
    d.prepare(
      'INSERT INTO opportunities VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET body=excluded.body,revision=opportunities.revision+1'
    ).run(item.id, value)
    if (old && old.stage !== item.stage)
      atlasEvent('stage-change', item.id, {
        from: old.stage,
        to: item.stage,
        source: 'workspace',
        reason: item.endReason || '',
        at: new Date().toISOString()
      })
    if (!old) atlasEvent('opportunity-added', item.id, { stage: item.stage, source: item.source })
    const scope = `${item.platform || 'manual'}:${item.accountId || item.userId || 'local'}`
    // Without an authoritative company id, keep separate records and offer an explicit merge.
    const companyId =
      'company:' +
      fingerprint([scope, item.job.encryptCompanyId || item.job.encryptBrandId || item.id]).slice(
        0,
        32
      )
    d.prepare('INSERT OR REPLACE INTO entities VALUES(?,?,?)').run(
      companyId,
      'company',
      JSON.stringify({ name: item.job.companyName, source: item.source })
    )
    d.prepare('INSERT OR IGNORE INTO opportunity_links VALUES(?,?,?)').run(
      item.id,
      companyId,
      'company'
    )
    // A newly observed authoritative company id replaces the provisional link.
    d.prepare(
      "DELETE FROM opportunity_links WHERE opportunity_id=? AND role='company' AND entity_id<>?"
    ).run(item.id, companyId)
    if (item.bossId) {
      const contactId = 'contact:' + fingerprint([scope, item.bossId]).slice(0, 32)
      d.prepare('INSERT OR REPLACE INTO entities VALUES(?,?,?)').run(
        contactId,
        'contact',
        JSON.stringify({
          name: item.job.bossName || '',
          sourceId: item.bossId,
          accountId: item.accountId || item.userId,
          platform: item.platform || 'boss'
        })
      )
      d.prepare('INSERT OR IGNORE INTO opportunity_links VALUES(?,?,?)').run(
        item.id,
        contactId,
        'recruiter'
      )
    }
  })
}
export function pipelineDetail(id: string) {
  const d = db(),
    row = d.prepare('SELECT * FROM opportunities WHERE id=?').get(id)
  if (!row) throw new Error('请先从企业与机会打开该岗位')
  const body = JSON.parse(row.body)
  if (!inAccountScope(body)) throw Error('机会不属于当前账号或归属尚未核实')
  const events = d
    .prepare('SELECT * FROM events WHERE entity_id=? ORDER BY created_at DESC LIMIT 300')
    .all(id)
    .map((r: any) => ({ ...r, value: JSON.parse(r.value) }))
  const related = d
    .prepare('SELECT * FROM related WHERE opportunity_id=? ORDER BY kind,id')
    .all(id)
    .map((r: any) => ({ ...r, body: JSON.parse(r.body) }))
  const entities = d
    .prepare(
      'SELECT e.*,l.role FROM entities e JOIN opportunity_links l ON l.entity_id=e.id WHERE l.opportunity_id=?'
    )
    .all(id)
    .map((r: any) => ({ ...r, body: JSON.parse(r.body) }))
  const company = entities.find((e: any) => e.role === 'company')
  const companyOpportunities = company
    ? d
        .prepare(
          "SELECT o.id,o.body FROM opportunities o JOIN opportunity_links l ON l.opportunity_id=o.id WHERE l.entity_id=? AND l.role='company'"
        )
        .all(company.id)
        .map((r: any) => ({ ...r, body: JSON.parse(r.body) }))
        .filter((r: any) => inAccountScope(r.body))
    : []
  const companyContacts = company
    ? d
        .prepare(
          "SELECT DISTINCT e.id,e.body,c.opportunity_id FROM entities e JOIN opportunity_links c ON c.entity_id=e.id AND c.role='recruiter' JOIN opportunity_links l ON l.opportunity_id=c.opportunity_id WHERE l.entity_id=? AND l.role='company'"
        )
        .all(company.id)
        .filter((r: any) => companyOpportunities.some((o: any) => o.id === r.opportunity_id))
        .filter(
          (r: any, index: number, rows: any[]) =>
            rows.findIndex((other) => other.id === r.id) === index
        )
        .map((r: any) => ({ ...r, body: JSON.parse(r.body) }))
    : []
  const candidates = d
    .prepare('SELECT id,body,revision FROM opportunities WHERE id<>?')
    .all(id)
    .map((r: any) => ({ ...r, body: JSON.parse(r.body) }))
    .filter(
      (r: any) =>
        inAccountScope(r.body) &&
        sameOpportunityScope(body, r.body) &&
        !r.body.mergedInto &&
        r.body.job.companyName === body.job.companyName &&
        r.body.job.jobName === body.job.jobName
    )
    .slice(0, 20)
  const merged = d
    .prepare("SELECT id,body FROM opportunities WHERE json_extract(body,'$.mergedInto')=?")
    .all(id)
    .map((r: any) => ({ ...r, body: JSON.parse(r.body) }))
    .filter((r: any) => inAccountScope(r.body) && sameOpportunityScope(body, r.body))
  for (const source of merged) {
    related.push(
      ...d
        .prepare('SELECT * FROM related WHERE opportunity_id=?')
        .all(source.id)
        .map((r: any) => ({ ...r, body: JSON.parse(r.body), mergedFrom: source.id }))
    )
    events.push(
      ...d
        .prepare('SELECT * FROM events WHERE entity_id=? ORDER BY created_at DESC LIMIT 200')
        .all(source.id)
        .map((r: any) => ({ ...r, value: JSON.parse(r.value), mergedFrom: source.id }))
    )
  }
  events.sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))
  return {
    id,
    body,
    revision: row.revision,
    related,
    events,
    entities,
    candidates,
    merged,
    companyOpportunities,
    companyContacts
  }
}
export function saveRelated(input: any) {
  if (
    !input ||
    !['interview', 'offer', 'todo'].includes(input.kind) ||
    typeof input.opportunityId !== 'string' ||
    !input.body ||
    typeof input.body.title !== 'string' ||
    !input.body.title.trim() ||
    input.body.title.length > 200 ||
    JSON.stringify(input.body).length > 20000
  )
    throw new Error('请填写有效标题与内容')
  if (input.body.date && Number.isNaN(Date.parse(input.body.date))) throw new Error('时间格式无效')
  if (
    input.kind === 'interview' &&
    input.body.round != null &&
    (!Number.isInteger(input.body.round) || input.body.round < 1 || input.body.round > 30)
  )
    throw new Error('面试轮次应在 1–30 之间')
  if (input.kind === 'offer') {
    for (const key of ['monthlyK', 'bonusK'])
      if (input.body[key] != null && (!Number.isFinite(input.body[key]) || input.body[key] < 0))
        throw new Error('薪资无效')
    if (
      input.body.salaryMonths != null &&
      (!Number.isFinite(input.body.salaryMonths) ||
        input.body.salaryMonths < 1 ||
        input.body.salaryMonths > 36)
    )
      throw new Error('薪资月数应在 1–36 之间')
  }
  return atlasTransaction(() => {
    const d = db()
    pipelineDetail(input.opportunityId)
    const id = input.id || randomUUID(),
      old = d.prepare('SELECT * FROM related WHERE id=?').get(id)
    if (
      old &&
      (old.revision !== input.baseRevision ||
        old.opportunity_id !== input.opportunityId ||
        old.kind !== input.kind)
    )
      throw new Error('记录已更新，请重新读取后保存')
    d.prepare(
      'INSERT INTO related VALUES(?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET body=excluded.body,revision=related.revision+1'
    ).run(id, input.opportunityId, input.kind, JSON.stringify(input.body))
    atlasEvent(input.kind + '-saved', input.opportunityId, {
      id,
      title: input.body.title,
      completed: !!input.body.completed
    })
    return pipelineDetail(input.opportunityId)
  })
}
export function setArchived(input: any) {
  return atlasTransaction(() => {
    const detail = pipelineDetail(input.id)
    if (detail.revision !== input.baseRevision) throw new Error('机会已更新，请重新读取')
    detail.body.archived = input.archived === true
    db()
      .prepare('UPDATE opportunities SET body=?,revision=revision+1 WHERE id=?')
      .run(JSON.stringify(detail.body), input.id)
    atlasEvent(input.archived ? 'archived' : 'restored', input.id, {})
    return pipelineDetail(input.id)
  })
}
export function mergeOpportunity(input: any) {
  return atlasTransaction(() => {
    if (!input || input.id === input.targetId) throw new Error('请选择另一个明确相同的岗位')
    const source = pipelineDetail(input.id),
      target = pipelineDetail(input.targetId)
    if (!sameOpportunityScope(source.body, target.body)) throw Error('不同账号或平台的机会不能合并')
    if (source.revision !== input.baseRevision || target.revision !== input.targetRevision)
      throw new Error('机会已更新，请重新核对后合并')
    if (source.body.mergedInto || target.body.mergedInto || source.merged.length)
      throw new Error('请先撤销已有合并，避免层级合并')
    source.body.mergedInto = input.targetId
    db()
      .prepare('UPDATE opportunities SET body=?,revision=revision+1 WHERE id=?')
      .run(JSON.stringify(source.body), input.id)
    atlasEvent('opportunity-merged', input.targetId, {
      sourceId: input.id,
      sourceName: source.body.job.companyName
    })
    return pipelineDetail(input.targetId)
  })
}
export function undoMerge(input: any) {
  return atlasTransaction(() => {
    const source = pipelineDetail(input.id)
    if (source.revision !== input.baseRevision || !source.body.mergedInto)
      throw new Error('合并状态已变化，请重新读取')
    const target = source.body.mergedInto
    // Undo may repair a legacy invalid merge; never expose or modify the other account.
    source.body.mergedInto = ''
    db()
      .prepare('UPDATE opportunities SET body=?,revision=revision+1 WHERE id=?')
      .run(JSON.stringify(source.body), input.id)
    const targetRow = db().prepare('SELECT body FROM opportunities WHERE id=?').get(target)
    const validTarget =
      targetRow &&
      inAccountScope(JSON.parse(targetRow.body)) &&
      sameOpportunityScope(source.body, JSON.parse(targetRow.body))
    atlasEvent('opportunity-merge-undone', validTarget ? target : input.id, { sourceId: input.id })
    return pipelineDetail(input.id)
  })
}
export function pipelineStates() {
  return Object.fromEntries(
    db()
      .prepare('SELECT id,body FROM opportunities')
      .all()
      .filter((r: any) => inAccountScope(JSON.parse(r.body)))
      .map((r: any) => {
        const b = JSON.parse(r.body)
        return [r.id, { archived: !!b.archived, mergedInto: b.mergedInto || '' }]
      })
  )
}
export function pipelineSummary() {
  const d = db(),
    related = d
      .prepare(
        'SELECT r.*,o.body AS opportunity FROM related r JOIN opportunities o ON o.id=r.opportunity_id ORDER BY r.id'
      )
      .all()
      .map((r: any) => ({ ...r, body: JSON.parse(r.body), opportunity: JSON.parse(r.opportunity) }))
      .filter((r: any) => inAccountScope(r.opportunity))
  const counts = ['interview', 'offer', 'todo']
    .map((kind) => ({ kind, total: related.filter((r: any) => r.kind === kind).length }))
    .filter((r) => r.total)
  const opportunities = d
    .prepare('SELECT body FROM opportunities')
    .all()
    .map((r: any) => JSON.parse(r.body))
    .filter((r: any) => inAccountScope(r) && !r.mergedInto && !r.archived)
  const offers = related
    .filter((r: any) => r.kind === 'offer')
    .map((r: any) => {
      const b = r.body,
        fixedAnnualK =
          b.monthlyK != null && b.salaryMonths != null ? b.monthlyK * b.salaryMonths : null
      return {
        ...r,
        fixedAnnualK,
        totalAnnualK: fixedAnnualK != null && b.bonusK != null ? fixedAnnualK + b.bonusK : null
      }
    })
  const stats = {
    total: opportunities.length,
    withoutDate: opportunities.filter((o: any) => !o.createdAt).length,
    stages: ['待评估', '计划联系', '已沟通', '已投递', '面试中', 'Offer', '已结束'].map(
      (stage) => ({ stage, count: opportunities.filter((o: any) => o.stage === stage).length })
    )
  }
  return {
    related,
    counts,
    offers,
    stats,
    definition:
      '全部时间；阶段分母为当前未归档、未合并的机会数，表示当前分布，不代表转化率。面试按轮次、Offer 按记录计数。薪酬未知项保留待确认，年薪仅按已填税前现金计算，不含股权及福利。'
  }
}
export function registerPipeline(handle: (name: string, fn: (...args: any[]) => any) => void) {
  handle('career-pipeline-detail', (_, id) => pipelineDetail(id))
  handle('career-pipeline-save', (_, input) => saveRelated(input))
  handle('career-pipeline-archive', (_, input) => setArchived(input))
  handle('career-pipeline-summary', pipelineSummary)
  handle('career-pipeline-merge', (_, input) => mergeOpportunity(input))
  handle('career-pipeline-unmerge', (_, input) => undoMerge(input))
}
