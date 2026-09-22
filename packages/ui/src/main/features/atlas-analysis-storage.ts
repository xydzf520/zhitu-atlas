import { createHash } from 'node:crypto'

// Only immutable analysis text is shared. Parent records keep their own account,
// evidence, model, prompt, timestamps and revision. No public lookup by content ID.
const isAnalysis = (v: any) =>
  v && typeof v === 'object' && typeof v.businessGoal === 'string' && Array.isArray(v.requirements)
const isRef = (v: any) =>
  v &&
  typeof v === 'object' &&
  Object.keys(v).length === 1 &&
  /^[a-f0-9]{64}$/.test(v.$atlasAnalysis || '')
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
export function packAnalysis(db: any, value: any): any {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.analysis) return value
  if (isRef(value.analysis)) throw Error('分析引用只能由存储服务生成')
  if (!isAnalysis(value.analysis)) return { ...value, analysis: packAnalysis(db, value.analysis) }
  const body = JSON.stringify(value.analysis),
    id = hash(body)
  db.prepare('INSERT OR IGNORE INTO analysis_contents VALUES(?,?,?,?)').run(
    id,
    body,
    Buffer.byteLength(body),
    new Date().toISOString()
  )
  return { ...value, analysis: { $atlasAnalysis: id } }
}
export function unpackAnalysis(db: any, value: any): any {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.analysis) return value
  if (!isRef(value.analysis)) return { ...value, analysis: unpackAnalysis(db, value.analysis) }
  const row = db
    .prepare('SELECT body FROM analysis_contents WHERE id=?')
    .get(value.analysis.$atlasAnalysis)
  if (!row || hash(row.body) !== value.analysis.$atlasAnalysis)
    throw Error('分析正文缺失或校验失败，请从备份恢复；没有覆盖原记录')
  return { ...value, analysis: JSON.parse(row.body) }
}
export function compactAnalysisData(db: any) {
  let changed = 0
  for (const [table, field, where] of [
    ['documents', 'value', "key GLOB 'atlas-ai/*' OR key GLOB 'atlas-discovery-item/*'"],
    ['task_runs', 'result', 'result IS NOT NULL']
  ]) {
    const key = table === 'documents' ? 'key' : 'id'
    for (const r of db
      .prepare(`SELECT ${key} id,${field} value FROM ${table} WHERE ${where}`)
      .all()) {
      const next = JSON.stringify(packAnalysis(db, unpackAnalysis(db, JSON.parse(r.value))))
      if (next !== r.value) {
        db.prepare(`UPDATE ${table} SET ${field}=? WHERE ${key}=?`).run(next, r.id)
        changed++
      }
    }
  }
  return changed
}
export function validateAnalysisReferences(db: any) {
  for (const r of db
    .prepare(
      "SELECT value FROM documents WHERE key GLOB 'atlas-ai/*' OR key GLOB 'atlas-discovery-item/*' UNION ALL SELECT result value FROM task_runs WHERE result IS NOT NULL"
    )
    .iterate())
    unpackAnalysis(db, JSON.parse(r.value))
}
