import fs from 'node:fs'
import path from 'node:path'
import { atlasDb, atlasRead, atlasRoot, atlasTransaction } from './atlas-store'
import { validateAnalysisReferences } from './atlas-analysis-storage'
import { cleanupExpiredBackupTransfers } from './atlas-backup-transfer'
const refSql = `SELECT j.value id FROM documents d,json_tree(d.value) j WHERE (d.key GLOB 'atlas-ai/*' OR d.key GLOB 'atlas-discovery-item/*') AND j.key='$atlasAnalysis' AND j.type='text' UNION ALL SELECT j.value id FROM task_runs t,json_tree(t.result) j WHERE t.result IS NOT NULL AND j.key='$atlasAnalysis' AND j.type='text'`
const size = (p: string) => {
  try {
    return fs.statSync(p).size
  } catch {
    return 0
  }
}
function directorySize(dir: string): number {
  if (!fs.existsSync(dir)) return 0
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .reduce(
      (n, e) =>
        n +
        (e.isSymbolicLink()
          ? 0
          : e.isDirectory()
            ? directorySize(path.join(dir, e.name))
            : size(path.join(dir, e.name))),
      0
    )
}
export function storageOverview() {
  const db = atlasDb(),
    root = atlasRoot(),
    file = path.join(root, 'storage/atlas.db'),
    a = db
      .prepare(`SELECT count(*) count,COALESCE(sum(bytes),0) bytes FROM analysis_contents`)
      .get(),
    refs = db
      .prepare(
        `SELECT count(*) count,COALESCE(sum(a.bytes),0) bytes FROM (${refSql}) r JOIN analysis_contents a ON a.id=r.id`
      )
      .get()
  const orphan = db
    .prepare(
      `SELECT count(*) count,COALESCE(sum(bytes),0) bytes FROM analysis_contents WHERE id NOT IN (SELECT id FROM (${refSql}) WHERE id IS NOT NULL)`
    )
    .get()
  const names = [
    'platform_jobs',
    'platform_conversations',
    'platform_messages',
    'profile_versions',
    'task_runs',
    'send_attempts',
    'platform_job_history',
    'events'
  ]
  const restored = atlasRead<any>('atlas-restored-attachments', null),
    attachments =
      restored?.directory && path.basename(restored.directory) === restored.directory
        ? restored.directory
        : 'attachments'
  return {
    databaseBytes: size(file),
    walBytes: size(file + '-wal'),
    freeBytes:
      db.prepare('PRAGMA freelist_count').get().freelist_count *
      db.prepare('PRAGMA page_size').get().page_size,
    attachmentBytes: directorySize(path.join(root, attachments)),
    temporaryBackupBytes: directorySize(path.join(root, 'backup-transfers')),
    analysis: {
      count: a.count,
      references: refs.count,
      storedBytes: a.bytes,
      logicalBytes: refs.bytes,
      savedPayloadBytes: Math.max(0, refs.bytes - a.bytes),
      orphan
    },
    counts: Object.fromEntries(
      names.map((t) => [t, db.prepare(`SELECT count(*) n FROM ${t}`).get().n])
    ),
    lastBackup: atlasRead('atlas-backup-last-export', null),
    schema: db.prepare('SELECT max(version) version FROM atlas_migrations').get().version
  }
}
export function checkStorage() {
  const db = atlasDb()
  const check = db.prepare('PRAGMA quick_check').all(),
    foreignKeys = db.prepare('PRAGMA foreign_key_check').all().length
  validateAnalysisReferences(db)
  return {
    ok: check.every((r: any) => r.quick_check === 'ok') && !foreignKeys,
    foreignKeyErrors: foreignKeys,
    checkedAt: new Date().toISOString(),
    scope: '数据库快速检查、外键关联与分析正文引用；不代表平台历史完整'
  }
}
export function maintainStorage(input: any) {
  if (input?.confirm !== true) throw Error('请先查看可回收范围并确认整理')
  const removed = atlasTransaction(
    () =>
      atlasDb()
        .prepare(
          `DELETE FROM analysis_contents WHERE id NOT IN (SELECT id FROM (${refSql}) WHERE id IS NOT NULL)`
        )
        .run().changes
  )
  const temporary = cleanupExpiredBackupTransfers()
  atlasDb().exec('PRAGMA optimize')
  const checkpoint = atlasDb().prepare('PRAGMA wal_checkpoint(PASSIVE)').get()
  return {
    removedAnalysisBodies: removed,
    removedTemporaryBytes: temporary.bytes,
    checkpoint,
    overview: storageOverview()
  }
}
export function registerStorage(handle: (name: string, fn: (...args: any[]) => any) => void) {
  handle('career-storage-overview', storageOverview)
  handle('career-storage-check', checkStorage)
  handle('career-storage-maintain', (_, p) => maintainStorage(p))
}
