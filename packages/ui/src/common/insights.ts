export const insightKinds = ['resume-review', 'market-review'] as const
export type InsightKind = (typeof insightKinds)[number]
export const insightLabels: Record<InsightKind, string> = {
  'resume-review': '简历竞争力',
  'market-review': '市场机会'
}
export const insightContract =
  '只输出JSON {summary:string,findings:[{title:string,detail:string,kind:"strength|gap|opportunity|unknown",sourceIds:string[]}],actions:[{title:string,reason:string,priority:"high|medium|low",destination:"profile|discovery|communication|policy",sourceIds:string[]}],limitations:string[]}。summary最多100字；findings最多6条，每条title最多30字、detail最多180字；actions最多5条，每条title最多40字、reason最多140字；limitations最多3条，每条最多100字。每个finding和action必须逐字复制输入sources中的来源ID，包括evidence:或job:前缀，不使用序号、标题或名称代替。建议每项title用6–14字，detail用40–80字，reason用30–60字；每项只表达一个判断。'
export function validateInsightReport(
  value: any,
  sources: { id: string; confirmed?: boolean; kind?: string; jobId?: string }[]
) {
  // Resolve only exact original IDs present in this account's source list.
  // Never infer a source from a title, and reject ambiguous aliases.
  const ids = new Set(sources.map((s) => s.id))
  const aliases = new Map<string, string | null>()
  const addAlias = (alias: string, id: string) => {
    if (!alias || ids.has(alias)) return
    aliases.set(alias, aliases.has(alias) && aliases.get(alias) !== id ? null : id)
  }
  for (const source of sources) {
    if (source.kind === 'evidence' && source.id.startsWith('evidence:'))
      addAlias(source.id.slice(9), source.id)
    if (source.kind === 'job' && source.jobId) {
      addAlias(source.jobId, source.id)
      addAlias('job:' + source.jobId, source.id)
    }
  }
  const normalize = (rows: any) =>
    Array.isArray(rows)
      ? rows.map((row) => ({
          ...row,
          sourceIds: Array.isArray(row?.sourceIds)
            ? row.sourceIds.map((id: any) =>
                typeof id === 'string' ? aliases.get(id.trim()) || id.trim() : id
              )
            : row?.sourceIds
        }))
      : rows
  value = { ...value, findings: normalize(value?.findings), actions: normalize(value?.actions) }
  const allowed = new Map(sources.map((s) => [s.id, s]))
  const text = (s: any, max: number) =>
    typeof s === 'string' && s.trim().length > 0 && s.length <= max
  const refs = (v: any) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= 20 &&
    v.every((id: any) => typeof id === 'string' && allowed.has(id))
  if (
    !value ||
    !text(value.summary, 100) ||
    !Array.isArray(value.findings) ||
    value.findings.length > 6 ||
    !Array.isArray(value.actions) ||
    value.actions.length > 5 ||
    !Array.isArray(value.limitations) ||
    value.limitations.length > 3 ||
    value.limitations.some((v: any) => !text(v, 100))
  )
    throw Error('研判结构或长度不符合要求，旧报告已保留')
  for (const row of value.findings) {
    if (!text(row.title, 30)) throw Error('研判结论标题缺失或超过30字，旧报告已保留')
    if (!text(row.detail, 180)) throw Error('研判结论正文缺失或超过180字，旧报告已保留')
    if (!['strength', 'gap', 'opportunity', 'unknown'].includes(row.kind))
      throw Error('研判结论类型无效，旧报告已保留')
    if (!refs(row.sourceIds)) throw Error('研判结论引用不在当前来源清单内，旧报告已保留')
    if (
      row.kind === 'opportunity' &&
      !row.sourceIds.some((id: string) => allowed.get(id)?.kind === 'job')
    )
      throw Error('机会建议缺少岗位来源，未保存这次研判')
    if (
      row.kind === 'strength' &&
      !row.sourceIds.some((id: string) => allowed.get(id)?.confirmed === true)
    )
      throw Error('个人优势缺少已确认经历来源，未保存这次研判')
  }
  for (const row of value.actions)
    if (
      !text(row.title, 40) ||
      !text(row.reason, 140) ||
      !['high', 'medium', 'low'].includes(row.priority) ||
      !['profile', 'discovery', 'communication', 'policy'].includes(row.destination) ||
      !refs(row.sourceIds)
    )
      throw Error('改进建议引用或结构无效，旧报告已保留')
  // No invented numeric scores, promises or externally generated URLs in the display contract.
  if (
    /(?:(?:录用|面试成功|拿到Offer)概率|竞争力(?:总分|评分))[^，。；]{0,12}\d|https?:\/\//i.test(
      JSON.stringify(value)
    )
  )
    throw Error('研判包含不受支持的评分、概率或链接，旧报告已保留')
  return {
    summary: value.summary,
    findings: value.findings.map(({ title, detail, kind, sourceIds }: any) => ({
      title,
      detail,
      kind,
      sourceIds
    })),
    actions: value.actions.map(({ title, reason, priority, destination, sourceIds }: any) => ({
      title,
      reason,
      priority,
      destination,
      sourceIds
    })),
    limitations: value.limitations
  }
}
