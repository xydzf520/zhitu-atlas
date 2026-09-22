import { createHash } from 'node:crypto'
import { validateCareerState, opportunityKey } from '../../common/career'
import {
  readCareerSnapshot,
  withCareerLock,
  checkRevision,
  workspaceFiles
} from './career-file-state'
import { atlasWrite } from './atlas-store'
function csv(text: string) {
  const rows: string[][] = []
  let row: string[] = [],
    value = '',
    quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"'
        i++
      } else quoted = !quoted
    } else if (c === ',' && !quoted) {
      row.push(value)
      value = ''
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(value)
      if (row.some(Boolean)) rows.push(row)
      row = []
      value = ''
    } else value += c
  }
  if (quoted) throw new Error('CSV 引号未闭合')
  row.push(value)
  if (row.some(Boolean)) rows.push(row)
  const headers = rows.shift()?.map((s) => s.trim().replace(/^\uFEFF/, '')) || []
  return rows.map((r, i) => {
    if (r.length !== headers.length) throw new Error(`CSV 第 ${i + 2} 行列数不一致`)
    return Object.fromEntries(headers.map((h, j) => [h, r[j]]))
  })
}
export function previewImport(input: any) {
  if (
    !input ||
    !['csv', 'json'].includes(input.format) ||
    typeof input.text !== 'string' ||
    Buffer.byteLength(input.text) > 8 * 1024 * 1024
  )
    throw new Error('请选择不超过 8MB 的 CSV/JSON')
  const raw = input.format === 'csv' ? csv(input.text) : JSON.parse(input.text)
  const values = Array.isArray(raw) ? raw : raw.opportunities
  if (!Array.isArray(values) || values.length > 5000) throw new Error('最多导入 5000 条机会')
  const state = readCareerSnapshot().state,
    existing = new Set(state.opportunities.map(opportunityKey)),
    rows: any[] = [],
    errors: any[] = [],
    seen = new Set<string>()
  values.forEach((v: any, i: number) => {
    try {
      if (!v || typeof v !== 'object') throw new Error('需要一条岗位对象')
      const r = v.job || v,
        job = {
          jobName: r.jobName ?? r['职位名称'] ?? '',
          companyName: r.companyName ?? r['公司名称'] ?? '',
          description: r.description ?? r['职位描述'] ?? '',
          address: r.address ?? r['地址'] ?? '',
          salaryLow: r.salaryLow ?? r['月薪下限K'] ? Number(r.salaryLow ?? r['月薪下限K']) : null,
          salaryHigh: r.salaryHigh ?? r['月薪上限K'] ? Number(r.salaryHigh ?? r['月薪上限K']) : null
        }
      if (
        typeof job.jobName !== 'string' ||
        typeof job.companyName !== 'string' ||
        !job.jobName.trim() ||
        !job.companyName.trim()
      )
        throw new Error('公司与职位名称必填，且须为文本')
      const source: any = {}
      const platform = v.platform ?? r.platform ?? r['平台'],
        account = v.accountId ?? r.accountId ?? r['账号ID'],
        sourceId = v.sourceId ?? r.sourceId ?? r['来源ID'],
        sourceUrl = v.sourceUrl ?? r.sourceUrl ?? r['来源链接']
      if (platform)
        source.platform =
          ({ BOSS: 'boss', BOSS直聘: 'boss', 猎聘: 'liepin' } as Record<string, string>)[
            platform
          ] || platform
      if (account != null && account !== '') source.accountId = String(account)
      if (sourceId != null && sourceId !== '') source.sourceId = String(sourceId)
      if (sourceUrl) source.sourceUrl = sourceUrl
      const identity =
        source.platform && source.accountId && source.sourceId
          ? [source.platform, source.accountId, source.sourceId]
          : job
      const id =
        'import-' + createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24)
      const item = {
        id,
        job,
        ...source,
        stage: '待评估' as const,
        nextDate: '',
        note: '',
        createdAt: new Date().toISOString()
      }
      validateCareerState({ ...state, opportunities: [item] })
      const key = opportunityKey(item),
        duplicate = existing.has(key) || seen.has(key)
      seen.add(key)
      rows.push({ ...item, duplicate, row: i + 1 })
    } catch (e: any) {
      errors.push({ row: i + 1, error: e.message })
    }
  })
  return {
    rows,
    errors,
    newCount: rows.filter((r) => !r.duplicate).length,
    duplicateCount: rows.filter((r) => r.duplicate).length,
    revision: readCareerSnapshot().revision
  }
}
export function commitImport(input: any) {
  return withCareerLock(() => {
    checkRevision(input.baseRevision, workspaceFiles)
    const preview = previewImport(input)
    if (preview.errors.length) throw new Error('请修正预览中的错误行后再导入')
    const state = readCareerSnapshot().state
    state.opportunities.push(
      ...preview.rows.filter((r) => !r.duplicate).map(({ duplicate, row, ...item }) => item)
    )
    validateCareerState(state)
    atlasWrite('career-workspace.json', state, 'import')
    return { added: preview.newCount, skipped: preview.duplicateCount }
  })
}
