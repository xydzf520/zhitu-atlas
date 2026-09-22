import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, scryptSync, createCipheriv, createDecipheriv, createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import {
  atlasDb,
  atlasRoot,
  atlasTransaction,
  atlasWrite,
  atlasRead,
  atlasList,
  atlasOwned
} from './atlas-store'
import { migrateProfile } from './atlas-profile'
import { pipelineSummary } from './atlas-pipeline'
import { runtimePolicy, setRuntime } from './atlas-tasks'
import { validateCareerState } from '../../common/career'
import { atlasSchemaVersion } from './atlas-migrations'
import { compactAnalysisData, validateAnalysisReferences } from './atlas-analysis-storage'
const { DatabaseSync } = require('node:sqlite')

export const backupTables = [
  'atlas_migrations',
  'analysis_contents',
  'documents',
  'profile_versions',
  'events',
  'send_attempts',
  'opportunities',
  'entities',
  'related',
  'opportunity_links',
  'platform_jobs',
  'platform_conversations',
  'platform_messages',
  'platform_job_history',
  'task_runs', 'legacy_records', 'ai_calls', 'contact_runs', 'job_observations',
  'execution_runs','execution_steps','execution_links','execution_events','execution_subjects'
]
const tables = backupTables
const keyFor = (password: string, salt: Buffer) =>
  scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 10 || password.length > 1024)
    throw new Error('备份密码至少 10 位')
}
function validateArchive(a: any) {
  if (a?.version !== 1 || !a.tables || !Array.isArray(a.attachments) || a.attachments.length > 1000)
    throw new Error('备份格式不兼容')
  for (const table of tables)
    if(table.startsWith('execution_') && a.tables[table] === undefined && a.tables.atlas_migrations?.length < 7)a.tables[table]=[]
    else if (table === 'analysis_contents' && a.tables[table] === undefined && a.tables.atlas_migrations?.length < 6) a.tables[table] = []
    else if (
      a.tables[table] === undefined &&
      (table.startsWith('platform_') || ['task_runs','legacy_records','ai_calls','contact_runs','job_observations'].includes(table)) &&
      Array.isArray(a.tables.atlas_migrations) &&
      a.tables.atlas_migrations.length < (table.startsWith('platform_') ? 3 : ['contact_runs','job_observations'].includes(table) ? 5 : 4)
    )
      a.tables[table] = []
    else if (!Array.isArray(a.tables[table]) || a.tables[table].length > 200000)
      throw new Error('备份数据无效')
  const versions = a.tables.atlas_migrations
    .map((row: any) => row.version)
    .sort((a: number, b: number) => a - b)
  if (
    !versions.length ||
    versions.length > atlasSchemaVersion ||
    versions.some((v: number, i: number) => v !== i + 1)
  )
    throw new Error('备份数据库版本不兼容')
  for (const f of a.attachments)
    if (
      typeof f.name !== 'string' ||
      f.name !== path.basename(f.name) ||
      f.name === '.' ||
      f.name === '..' ||
      !/^[-\w\u4e00-\u9fff ().]+\.(docx|pdf|txt)$/i.test(f.name) ||
      typeof f.data !== 'string'
    )
      throw new Error('附件路径无效')
}
export function exportEncryptedBackup(password: string) {
  validatePassword(password)
  migrateProfile()
  pipelineSummary()
  const configDir = path.join(atlasRoot(), 'config')
  if (fs.existsSync(configDir))
    for (const name of fs.readdirSync(configDir))
      if (atlasOwned(name) && name.endsWith('.json')) atlasRead(name, null)
  atlasList('career-replies')
  atlasList('career-reply-commands')
  atlasList('career-boss-accounts')
  const data = atlasTransaction(() => {
    const records: Record<string, any[]> = {}
    for (const table of tables) records[table] = atlasDb().prepare(`SELECT * FROM ${table}`).all()
    records.documents = records.documents.filter(
      (r) =>
        !/^career-reply-(commands|heartbeat)|^career-data-heartbeat|^atlas-platform-|^atlas-boss-capture-status$|^atlas-boss-account-sync-|^atlas-boss-job-read-|^atlas-discovery-worker$|^atlas-contact-worker$|^atlas-contact-authorization$/.test(
          r.key
        )
    )
    records.documents = records.documents.map((r) =>
      r.key.startsWith('atlas-paper-run/') ? { ...r, value: JSON.stringify({ ...JSON.parse(r.value), paused: true }) } : r.key === 'atlas-career-policy' ? { ...r, value: JSON.stringify({ ...JSON.parse(r.value), automationPaused: true, sending: { ...JSON.parse(r.value).sending, paused: true }, discovery: { ...JSON.parse(r.value).discovery, autoRecommend: false }, replies: { ...JSON.parse(r.value).replies, mode: 'off' } }) } : r.key === 'atlas-discovery-settings'
        ? { ...r, value: JSON.stringify({ ...JSON.parse(r.value), autoRecommend: false }) }
        : r.key.startsWith('atlas-discovery-run/')
          ? {
              ...r,
              value: JSON.stringify({
                ...JSON.parse(r.value),
                state: 'paused',
                message: '迁移恢复后请重新登录，再开始新一轮'
              })
            }
          : r.key === 'atlas-boss-sync-settings'
            ? { ...r, value: JSON.stringify({ enabled: false }) }
            : r.key === 'atlas-runtime'
              ? { ...r, value: JSON.stringify({ ...JSON.parse(r.value), paused: true }) }
              : r
    )
    records.task_runs = records.task_runs.map(r => ['running','queued'].includes(r.state) ? { ...r, state: 'interrupted', step: '迁移后任务暂停，请本人重新核实' } : r)
    records.ai_calls = records.ai_calls.map(r => r.status === 'running' ? { ...r, status: 'interrupted' } : r)
    records.execution_runs = records.execution_runs.map(r=>({...r,paused:1,...(['queued','running','waiting'].includes(r.state)?{state:'interrupted',summary:'迁移后暂停，请核对后手动处理'}:{})}))
    records.execution_steps = records.execution_steps.map(r=>['running','waiting','queued'].includes(r.state)?{...r,state:'interrupted',summary:'迁移后中断，未重放调用'}:r)
    return records
  })
  const restored = atlasRead<any>('atlas-restored-attachments', null)
  const dir = path.join(
      atlasRoot(),
      restored?.directory && path.basename(restored.directory) === restored.directory
        ? restored.directory
        : 'attachments'
    ),
    attachments: any[] = []
  if (fs.existsSync(dir))
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name)
      if (/\.(docx|pdf|txt)$/i.test(name) && fs.lstatSync(file).isFile()) {
        const bytes = fs.readFileSync(file)
        if (bytes.length > 15 * 1024 * 1024) throw new Error('单个附件超过 15MB')
        attachments.push({
          name,
          data: bytes.toString('base64'),
          sha256: createHash('sha256').update(bytes).digest('hex')
        })
      }
    }
  let legacySqlite = ''
  const old = atlasRead<any>('atlas-restored-legacy', null),
    legacy = path.join(
      atlasRoot(),
      'storage',
      old?.file && path.basename(old.file) === old.file ? old.file : 'public.db'
    )
  if (!old?.disabled && fs.existsSync(legacy)) {
    const temp = path.join(atlasRoot(), 'storage', `backup-${randomBytes(8).toString('hex')}.db`),
      origin = new DatabaseSync(legacy, { readOnly: true })
    try {
      origin.prepare('VACUUM INTO ?').run(temp)
      const sanitized = new DatabaseSync(temp)
      try { if (sanitized.prepare("SELECT 1 FROM sqlite_master WHERE name='llm_model_usage_record'").get()) sanitized.exec('UPDATE llm_model_usage_record SET providerApiSecret=NULL; VACUUM') } finally { sanitized.close() }
      legacySqlite = fs.readFileSync(temp).toString('base64')
    } finally {
      origin.close()
      fs.rmSync(temp, { force: true })
    }
  }
  const archive = {
    version: 1,
    createdAt: new Date().toISOString(),
    tables: data,
    attachments,
    legacySqlite
  }
  const clear = Buffer.from(JSON.stringify(archive))
  if (clear.length > 40 * 1024 * 1024) throw new Error('备份超过当前 40MB 上限')
  const salt = randomBytes(16),
    iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', keyFor(password, salt), iv)
  const encrypted = Buffer.concat([cipher.update(gzipSync(clear)), cipher.final()])
  return {
    filename: `职途Atlas-${new Date().toISOString().slice(0, 10)}.atlas`,
    base64: Buffer.concat([
      Buffer.from('ATLASBK1'),
      salt,
      iv,
      cipher.getAuthTag(),
      encrypted
    ]).toString('base64'),
    includes: '统一资料、业务记录、设置、发送历史与附件；不含登录 Cookie 和 API 密钥'
  }
}
export function inspectBackup(input: { password: string; base64: string }) {
  validatePassword(input?.password)
  if (typeof input.base64 !== 'string' || input.base64.length > 60 * 1024 * 1024)
    throw new Error('备份文件过大或无效')
  try {
    const bytes = Buffer.from(input.base64, 'base64')
    if (bytes.subarray(0, 8).toString() !== 'ATLASBK1') throw new Error('header')
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyFor(input.password, bytes.subarray(8, 24)),
      bytes.subarray(24, 36)
    )
    decipher.setAuthTag(bytes.subarray(36, 52))
    const clear = gunzipSync(
        Buffer.concat([decipher.update(bytes.subarray(52)), decipher.final()]),
        { maxOutputLength: 40 * 1024 * 1024 }
      ),
      archive = JSON.parse(clear.toString())
    validateArchive(archive)
    const workspace = archive.tables.documents.find((r: any) => r.key === 'career-workspace.json')
    if (workspace) validateCareerState(JSON.parse(workspace.value))
    for (const f of archive.attachments)
      if (createHash('sha256').update(Buffer.from(f.data, 'base64')).digest('hex') !== f.sha256)
        throw new Error('附件校验失败')
    return archive
  } catch {
    throw new Error('密码错误、备份损坏或版本不兼容；原数据未改变')
  }
}
export function previewBackup(input: { password: string; base64: string }) {
  const a = inspectBackup(input)
  return {
    createdAt: a.createdAt,
    counts: Object.fromEntries(tables.map((t) => [t, a.tables[t].length])),
    attachments: a.attachments.length
  }
}
export function restoreEncryptedBackup(input: {
  password: string
  base64: string
  confirm: boolean
}) {
  return restoreBackupContents(inspectBackup(input), input.confirm)
}
// V1 JSON and V2 streaming SQLite archives share the same transactional restore.
export function restoreBackupContents(a: any, confirm: boolean) {
  if (confirm !== true) throw new Error('请先预览备份并确认恢复')
  if (!runtimePolicy().paused) throw new Error('请先暂停发送，再等待后台任务收尾后恢复')
  if (atlasDb().prepare('SELECT COUNT(*) AS n FROM leases WHERE expires_at>?').get(Date.now()).n)
    throw new Error('仍有任务正在收尾，请稍后恢复')
  pipelineSummary()
  const staged = path.join(atlasRoot(), 'attachments.restore-' + randomBytes(8).toString('hex'))
  const legacyFile = `restored-${randomBytes(8).toString('hex')}.db`,
    legacyPath = path.join(atlasRoot(), 'storage', legacyFile)
  fs.mkdirSync(staged, { mode: 0o700 })
  try {
    for (const f of a.attachments) {
      if (f.path) { fs.copyFileSync(f.path, path.join(staged, f.name)); fs.chmodSync(path.join(staged, f.name),0o600) }
      else fs.writeFileSync(path.join(staged, f.name), Buffer.from(f.data, 'base64'), { mode: 0o600 })
    }
    if (a.legacySqlite || a.legacyPath) {
      if (a.legacyPath) {fs.copyFileSync(a.legacyPath, legacyPath);fs.chmodSync(legacyPath,0o600)}
      else fs.writeFileSync(legacyPath, Buffer.from(a.legacySqlite, 'base64'), { mode: 0o600 })
      const check = new DatabaseSync(legacyPath, { readOnly: true })
      try {
        if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
          throw new Error('旧档案完整性检查失败')
      } finally {
        check.close()
      }
    }
    atlasTransaction(() => {
      const d = atlasDb()
      for (const table of [...tables].reverse())
        if (table !== 'atlas_migrations') d.prepare(`DELETE FROM ${table}`).run()
      for (const table of tables) {
        // The live schema stays at this application's version when restoring old data.
        if (table === 'atlas_migrations') continue
        const columns = d
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((r: any) => r.name)
        for (const row of a.tables[table]) {
          if (Object.keys(row).some((k) => !columns.includes(k))) throw new Error('备份字段不兼容')
          d.prepare(
            `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`
          ).run(...columns.map((c: string) => row[c] ?? (table === 'send_attempts' && ['context','proof'].includes(c) ? '{}' : null)))
        }
      }
      compactAnalysisData(d)
      validateAnalysisReferences(d)
      d.exec('DELETE FROM contact_reservations')
      d.exec("UPDATE contact_runs SET state='review' WHERE state NOT IN ('completed','manual','cancelled','existing','uncertain')")
      d.exec("UPDATE send_attempts SET status='uncertain' WHERE status='sending'")
      d.exec("UPDATE ai_calls SET status='interrupted' WHERE status='running'")
      d.exec("UPDATE execution_runs SET paused=1,state=CASE WHEN state IN ('queued','running','waiting') THEN 'interrupted' ELSE state END; UPDATE execution_steps SET state='interrupted',summary='迁移后中断，未重放调用' WHERE state IN ('queued','running','waiting')")
      atlasWrite('atlas-legacy-import-closed', true)
      atlasWrite('atlas-restore-epoch', randomBytes(24).toString('hex'))
      for (const row of d
        .prepare("SELECT key,value FROM documents WHERE key LIKE 'career-replies/%'")
        .all()) {
        const event = JSON.parse(row.value)
        if (event && ['sending', 'queued'].includes(event.status)) {
          event.status = event.status === 'sending' ? 'uncertain' : 'review'
          event.reason = '迁移恢复后需要本人重新核实，不会自动重发'
          atlasWrite(row.key, event)
        }
      }
      for (const row of d
        .prepare("SELECT key,value FROM documents WHERE key LIKE 'atlas-discovery-run/%'")
        .all())
        atlasWrite(row.key, {
          ...JSON.parse(row.value),
          state: 'paused',
          message: '迁移恢复后请重新登录，再开始新一轮'
        })
      atlasWrite('atlas-discovery-worker', null)
      atlasWrite('atlas-discovery-settings', {
        ...atlasRead<any>('atlas-discovery-settings', {}),
        autoRecommend: false
      })
      const policy = atlasRead<any>('atlas-career-policy', null)
      if (policy) atlasWrite('atlas-career-policy', { ...policy, automationPaused: true, discovery: { ...policy.discovery, autoRecommend: false }, replies: { ...policy.replies, mode: 'off' } })
      d.exec("UPDATE task_runs SET state='interrupted',step='恢复后需要重新核实' WHERE state IN ('queued','running')")
      d.exec("UPDATE documents SET value=json_set(value,'$.mode','suggest') WHERE key LIKE 'atlas-coordinator-config/%'")
      setRuntime({ paused: true })
      atlasWrite('atlas-boss-sync-settings', { enabled: false })
      const reply = atlasRead<any>('career-auto-reply.json', null)
      if (reply) atlasWrite('career-auto-reply.json', { ...reply, mode: 'off' })
      atlasWrite('atlas-restored-attachments', {
        directory: path.basename(staged),
        at: new Date().toISOString()
      })
      if (a.legacySqlite || a.legacyPath) atlasWrite('atlas-restored-legacy', { file: legacyFile })
      else atlasWrite('atlas-restored-legacy', { disabled: true })
    })
    // The versioned attachment directory is committed by the same DB transaction.
    return { restored: true, paused: true, attachments: a.attachments.length }
  } catch (e) {
    fs.rmSync(staged, { recursive: true, force: true })
    fs.rmSync(legacyPath, { force: true })
    throw e
  }
}
export function registerBackup(handle: (name: string, fn: (...args: any[]) => any) => void) {
  handle('career-backup-export', (_, p) => exportEncryptedBackup(p?.password))
  handle('career-backup-preview', (_, p) => previewBackup(p))
  handle('career-backup-restore', (_, p) => restoreEncryptedBackup(p))
}
