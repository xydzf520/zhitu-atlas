import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, createHash, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { atlasDb, atlasRoot, atlasRead, atlasWrite } from './atlas-store'
import {
  backupTables,
  previewBackup,
  restoreEncryptedBackup,
  restoreBackupContents
} from './atlas-backup'
import { atlasSchemaVersion } from './atlas-migrations'
import { validateCareerState } from '../../common/career'
import { validateAnalysisReferences } from './atlas-analysis-storage'
const { DatabaseSync } = require('node:sqlite')
const CHUNK = 1024 * 1024,
  MAX = 512 * CHUNK,
  TTL = 24 * 60 * 60 * 1000
const transfers = new Map<
  string,
  {
    file: string
    size: number
    offset: number
    mode: 'export' | 'import'
    at: number
    filename: string
  }
>()
const activeDirs = new Set<string>()
const busyTransfers = new Set<string>()
const privateDir = () => {
  const p = path.join(atlasRoot(), 'backup-transfers')
  fs.mkdirSync(p, { recursive: true, mode: 0o700 })
  return p
}
const passwordKey = (password: unknown, salt: Buffer) => {
  if (typeof password !== 'string' || password.length < 10 || password.length > 1024)
    throw Error('备份密码至少 10 位')
  return scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}
function fileHash(file: string) {
  const h = createHash('sha256'),
    fd = fs.openSync(file, 'r'),
    buf = Buffer.alloc(CHUNK)
  try {
    let n
    while ((n = fs.readSync(fd, buf, 0, buf.length, null))) h.update(buf.subarray(0, n))
    return h.digest('hex')
  } finally {
    fs.closeSync(fd)
  }
}
function write(fd: number, b: Buffer) {
  let at = 0
  while (at < b.length) at += fs.writeSync(fd, b, at, b.length - at)
}
function read(fd: number, size: number) {
  const b = Buffer.alloc(size)
  let at = 0
  while (at < size) {
    const n = fs.readSync(fd, b, at, size - at, null)
    if (!n) throw Error('备份被截断')
    at += n
  }
  return b
}
function transfer(id: unknown) {
  const t = typeof id === 'string' ? transfers.get(id) : null
  if (!t || Date.now() - t.at > TTL) throw Error('备份传输已过期，请重新选择文件')
  return t
}
function safeAttachment(name: string) {
  return name === path.basename(name) && /^[-\w\u4e00-\u9fff ().]+\.(docx|pdf|txt)$/i.test(name)
}
function sanitizeSnapshot(db: any) {
  db.exec(
    'PRAGMA trusted_schema=OFF; DELETE FROM leases; DELETE FROM contact_reservations; DELETE FROM storage_revisions;'
  )
  db.exec("UPDATE execution_runs SET paused=1,state=CASE WHEN state IN ('queued','running','waiting') THEN 'interrupted' ELSE state END; UPDATE execution_steps SET state='interrupted',summary='迁移后中断，未重放调用' WHERE state IN ('queued','running','waiting')")
  for (const r of db.prepare('SELECT key,value FROM documents').all()) {
    if (
      /^career-reply-(commands|heartbeat)|^career-data-heartbeat|^atlas-platform-|^atlas-boss-capture-status$|^atlas-boss-account-sync-|^atlas-boss-job-read-|^atlas-discovery-worker$|^atlas-contact-worker$|^atlas-contact-authorization$/.test(
        r.key
      )
    ) {
      db.prepare('DELETE FROM documents WHERE key=?').run(r.key)
      continue
    }
    const v = JSON.parse(r.value)
    if (r.key === 'atlas-career-policy' && v) {
      v.automationPaused = true
      v.sending = { ...v.sending, paused: true }
      v.discovery = { ...v.discovery, autoRecommend: false }
      v.replies = { ...v.replies, mode: 'off' }
    } else if (r.key.startsWith('atlas-coordinator-config/') && v) v.mode = 'suggest'
    else if (r.key === 'atlas-runtime' && v) v.paused = true
    else if (r.key === 'career-auto-reply.json' && v) v.mode = 'off'
    else if (r.key === 'atlas-discovery-settings' && v) v.autoRecommend = false
    else if (r.key === 'atlas-boss-sync-settings' && v) v.enabled = false
    else if (r.key.startsWith('atlas-discovery-run/') && v) {
      v.state = 'paused'
      v.message = '迁移恢复后请重新登录，再开始新一轮'
    }
    db.prepare('UPDATE documents SET value=? WHERE key=?').run(JSON.stringify(v), r.key)
  }
  db.exec(
    "UPDATE task_runs SET state='interrupted',step='迁移后任务暂停，请本人重新核实' WHERE state IN ('queued','running'); UPDATE ai_calls SET status='interrupted' WHERE status='running'; DELETE FROM storage_revisions;"
  )
}
export async function createBackupTransfer(input: any) {
  const salt = randomBytes(16),
    key = passwordKey(input?.password, salt),
    header = Buffer.concat([Buffer.from('ATLASBK2'), salt, randomBytes(4)]),
    id = randomBytes(24).toString('hex')
  const dir = path.join(privateDir(), 'export-' + id)
  fs.mkdirSync(dir, { mode: 0o700 })
  activeDirs.add(dir)
  const output = path.join(privateDir(), id + '.atlas')
  let fd: number | undefined
  try {
    const snapshot = path.join(dir, 'database.sqlite')
    atlasDb().prepare('VACUUM INTO ?').run(snapshot)
    fs.chmodSync(snapshot, 0o600)
    const db = new DatabaseSync(snapshot)
    try {
      sanitizeSnapshot(db)
      db.exec('VACUUM')
    } finally {
      db.close()
    }
    const files: any[] = [{ name: 'database.sqlite', path: snapshot }]
    const restored = atlasRead<any>('atlas-restored-attachments', null),
      name =
        restored?.directory && path.basename(restored.directory) === restored.directory
          ? restored.directory
          : 'attachments',
      attachments = path.join(atlasRoot(), name)
    if (fs.existsSync(attachments))
      for (const n of fs.readdirSync(attachments).sort()) {
        const p = path.join(attachments, n)
        if (!safeAttachment(n) || !fs.lstatSync(p).isFile()) continue
        if (fs.statSync(p).size > 15 * CHUNK) throw Error('单个附件超过 15 MiB')
        const copy = path.join(dir, 'attachment-' + files.length)
        fs.copyFileSync(p, copy)
        fs.chmodSync(copy, 0o600)
        files.push({ name: 'attachments/' + n, path: copy })
      }
    const old = atlasRead<any>('atlas-restored-legacy', null),
      legacy = path.join(
        atlasRoot(),
        'storage',
        old?.file && path.basename(old.file) === old.file ? old.file : 'public.db'
      )
    if (!old?.disabled && fs.existsSync(legacy)) {
      const p = path.join(dir, 'legacy.sqlite'),
        origin = new DatabaseSync(legacy, { readOnly: true })
      try {
        origin.prepare('VACUUM INTO ?').run(p)
      } finally {
        origin.close()
      }
      fs.chmodSync(p, 0o600)
      const clean = new DatabaseSync(p)
      try {
        if (
          clean
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name='llm_model_usage_record'"
            )
            .get()
        )
          clean.exec('UPDATE llm_model_usage_record SET providerApiSecret=NULL')
        clean.exec('VACUUM')
      } finally {
        clean.close()
      }
      files.push({ name: 'legacy.sqlite', path: p })
    }
    if (files.length > 1002) throw Error('附件数量超过 1000')
    const manifest = {
      version: 2,
      schema: atlasSchemaVersion,
      createdAt: new Date().toISOString(),
      files: files.map((f) => ({
        name: f.name,
        size: fs.statSync(f.path).size,
        sha256: fileHash(f.path)
      }))
    }
    if (manifest.files.reduce((n, f) => n + f.size, 0) > MAX)
      throw Error('备份原始数据超过 512 MiB')
    fd = fs.openSync(output, 'wx', 0o600)
    write(fd, header)
    let sequence = 0
    const frame = (clear: Buffer) => {
      const counter = Buffer.alloc(8)
      counter.writeBigUInt64BE(BigInt(sequence++))
      const nonce = Buffer.concat([header.subarray(24), counter]),
        cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(Buffer.concat([header, counter]))
      const encrypted = Buffer.concat([cipher.update(gzipSync(clear)), cipher.final()]),
        length = Buffer.alloc(4)
      length.writeUInt32BE(encrypted.length + 16)
      write(fd!, length)
      write(fd!, cipher.getAuthTag())
      write(fd!, encrypted)
    }
    frame(Buffer.concat([Buffer.from([1]), Buffer.from(JSON.stringify(manifest))]))
    for (let i = 0; i < files.length; i++) {
      const from = fs.openSync(files[i].path, 'r'),
        buffer = Buffer.alloc(CHUNK)
      let offset = 0
      try {
        let n
        while ((n = fs.readSync(from, buffer, 0, CHUNK, null))) {
          const tag = Buffer.alloc(13)
          tag[0] = 2
          tag.writeUInt32BE(i, 1)
          tag.writeBigUInt64BE(BigInt(offset), 5)
          frame(Buffer.concat([tag, buffer.subarray(0, n)]))
          offset += n
          if (sequence % 8 === 0) await new Promise((r) => setTimeout(r, 0))
        }
      } finally {
        fs.closeSync(from)
      }
    }
    frame(Buffer.from([3]))
    fs.closeSync(fd)
    fd = undefined
    const size = fs.statSync(output).size,
      filename = `职途Atlas-${new Date().toISOString().slice(0, 10)}.atlas`
    if (size > MAX + 2 * CHUNK) throw Error('备份文件超过传输上限')
    transfers.set(id, {
      file: output,
      size,
      offset: size,
      mode: 'export',
      at: Date.now(),
      filename
    })
    atlasWrite('atlas-backup-last-export', {
      at: manifest.createdAt,
      size,
      version: 2,
      scope: '业务数据、历史与附件；不含 Cookie、API 密钥及运行租约'
    })
    return { id, filename, size, chunkSize: CHUNK, version: 2 }
  } catch (e) {
    fs.rmSync(output, { force: true })
    throw e
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    fs.rmSync(dir, { recursive: true, force: true })
    activeDirs.delete(dir)
    key.fill(0)
  }
}
export function downloadBackupChunk(input: any) {
  const t = transfer(input?.id),
    offset = Number(input?.offset)
  if (t.mode !== 'export' || !Number.isSafeInteger(offset) || offset < 0 || offset > t.size)
    throw Error('备份下载偏移无效')
  const fd = fs.openSync(t.file, 'r'),
    b = Buffer.alloc(Math.min(CHUNK, t.size - offset))
  try {
    const n = fs.readSync(fd, b, 0, b.length, offset)
    t.at = Date.now()
    return { base64: b.subarray(0, n).toString('base64'), offset, next: offset + n, total: t.size }
  } finally {
    fs.closeSync(fd)
  }
}
export function beginBackupUpload(input: any) {
  if (!Number.isSafeInteger(input?.size) || input.size < 52 || input.size > MAX + 2 * CHUNK)
    throw Error('备份文件需小于 514 MiB')
  const id = randomBytes(24).toString('hex'),
    file = path.join(privateDir(), id + '.upload')
  fs.writeFileSync(file, '', { mode: 0o600, flag: 'wx' })
  transfers.set(id, {
    file,
    size: input.size,
    offset: 0,
    mode: 'import',
    at: Date.now(),
    filename: 'import.atlas'
  })
  return { id, chunkSize: CHUNK }
}
export function uploadBackupChunk(input: any) {
  const t = transfer(input?.id)
  if (
    t.mode !== 'import' ||
    input.offset !== t.offset ||
    typeof input.base64 !== 'string' ||
    input.base64.length > Math.ceil(CHUNK / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)
  )
    throw Error('备份分块或上传位置无效')
  const b = Buffer.from(input.base64, 'base64')
  if (!b.length || b.length > CHUNK || t.offset + b.length > t.size) throw Error('备份分块大小无效')
  fs.appendFileSync(t.file, b)
  t.offset += b.length
  t.at = Date.now()
  return { next: t.offset, total: t.size }
}
function inspectSnapshot(file: string) {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    db.exec('PRAGMA trusted_schema=OFF')
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok')
      throw Error('数据库完整性检查失败')
    const versions = db.prepare('SELECT version FROM atlas_migrations ORDER BY version').all()
    if (
      !versions.length ||
      versions.length > atlasSchemaVersion ||
      versions.some((v: any, i: number) => v.version !== i + 1)
    )
      throw Error('备份版本不兼容')
    const counts: any = {}
    for (const table of backupTables) {
      if(table.startsWith('execution_') && versions.length<7 && !db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table)){counts[table]=0;continue}
      if (db.prepare('SELECT type FROM sqlite_master WHERE name=?').get(table)?.type !== 'table')
        throw Error('备份缺少业务数据表')
      const expected = atlasDb()
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((r: any) => r.name),
        actual = db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((r: any) => r.name)
      if (JSON.stringify(expected) !== JSON.stringify(actual)) throw Error('备份字段不兼容')
      counts[table] = db.prepare(`SELECT count(*) n FROM ${table}`).get().n
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw Error('备份关联检查失败')
    const workspace = db
      .prepare("SELECT value FROM documents WHERE key='career-workspace.json'")
      .get()
    if (workspace) validateCareerState(JSON.parse(workspace.value))
    validateAnalysisReferences(db)
    return counts
  } finally {
    db.close()
  }
}
async function withDecoded(input: any, action: (a: any) => any) {
  const t = transfer(input?.id)
  if (t.mode !== 'import' || t.offset !== t.size) throw Error('请先完整上传备份')
  if (busyTransfers.has(input.id)) throw Error('此备份正在处理，请等待完成')
  busyTransfers.add(input.id)
  t.at = Date.now()
  const fd = fs.openSync(t.file, 'r'),
    dir = path.join(privateDir(), 'decode-' + randomBytes(16).toString('hex'))
  fs.mkdirSync(dir, { mode: 0o700 })
  activeDirs.add(dir)
  let key: Buffer | undefined
  try {
    const magic = read(fd, 8)
    if (magic.toString() === 'ATLASBK1') {
      if (t.size > 45 * CHUNK) throw Error('旧版备份过大')
      return await action({ legacy: true, base64: fs.readFileSync(t.file).toString('base64') })
    }
    if (magic.toString() !== 'ATLASBK2') throw Error('备份格式不支持')
    const header = Buffer.concat([magic, read(fd, 20)])
    key = passwordKey(input.password, header.subarray(8, 24))
    let sequence = 0,
      manifest: any = null,
      ended = false,
      consumed = 28,
      current = 0
    const offsets: number[] = [],
      hashes: any[] = []
    while (consumed < t.size) {
      const length = read(fd, 4).readUInt32BE()
      consumed += 4
      if (length < 17 || length > CHUNK + 65536 || consumed + length > t.size)
        throw Error('备份分块损坏')
      const frame = read(fd, length)
      consumed += length
      const counter = Buffer.alloc(8)
      counter.writeBigUInt64BE(BigInt(sequence++))
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.concat([header.subarray(24), counter])
      )
      decipher.setAAD(Buffer.concat([header, counter]))
      decipher.setAuthTag(frame.subarray(0, 16))
      const clear = gunzipSync(
        Buffer.concat([decipher.update(frame.subarray(16)), decipher.final()]),
        { maxOutputLength: CHUNK + 16384 }
      )
      if (clear[0] === 1) {
        if (manifest || sequence !== 1) throw Error('备份清单无效')
        manifest = JSON.parse(clear.subarray(1).toString())
        if (
          manifest.version !== 2 ||
          !Array.isArray(manifest.files) ||
          manifest.files.length < 1 ||
          manifest.files.length > 1002 ||
          manifest.files[0].name !== 'database.sqlite'
        )
          throw Error('备份清单无效')
        const names = new Set()
        let total = 0
        for (const [i, f] of manifest.files.entries()) {
          if (
            typeof f.name !== 'string' ||
            names.has(f.name) ||
            !Number.isSafeInteger(f.size) ||
            f.size < 0 ||
            !/^[a-f0-9]{64}$/.test(f.sha256) ||
            !(
              f.name === 'database.sqlite' ||
              f.name === 'legacy.sqlite' ||
              (f.name.startsWith('attachments/') && safeAttachment(f.name.slice(12)))
            ) ||
            (f.name.startsWith('attachments/') && f.size > 15 * CHUNK)
          )
            throw Error('备份附件或路径无效')
          names.add(f.name)
          total += f.size
          offsets.push(0)
          hashes.push(createHash('sha256'))
          fs.writeFileSync(path.join(dir, String(i)), '', { mode: 0o600, flag: 'wx' })
        }
        if (total > MAX) throw Error('解密数据超过 512 MiB')
      } else if (clear[0] === 2) {
        if (!manifest || ended || clear.length <= 13) throw Error('备份数据顺序无效')
        const i = clear.readUInt32BE(1),
          offset = Number(clear.readBigUInt64BE(5)),
          b = clear.subarray(13)
        while (current < offsets.length && offsets[current] === manifest.files[current].size)
          current++
        if (
          i !== current ||
          i >= offsets.length ||
          offset !== offsets[i] ||
          offset + b.length > manifest.files[i].size
        )
          throw Error('备份数据不完整')
        fs.appendFileSync(path.join(dir, String(i)), b)
        offsets[i] += b.length
        hashes[i].update(b)
      } else if (clear[0] === 3) {
        if (clear.length !== 1 || !manifest || consumed !== t.size) throw Error('备份结束标记无效')
        ended = true
        break
      } else throw Error('备份分块类型无效')
      if (sequence % 8 === 0) await new Promise((r) => setTimeout(r, 0))
    }
    if (!ended || !manifest) throw Error('备份被截断')
    for (const [i, f] of manifest.files.entries())
      if (offsets[i] !== f.size || hashes[i].digest('hex') !== f.sha256)
        throw Error('备份文件校验失败')
    const database = path.join(dir, '0'),
      counts = inspectSnapshot(database)
    return await action({
      manifest,
      database,
      counts,
      attachments: manifest.files.flatMap((f: any, i: number) =>
        f.name.startsWith('attachments/')
          ? [{ name: f.name.slice(12), path: path.join(dir, String(i)) }]
          : []
      ),
      legacyPath: (() => {
        const i = manifest.files.findIndex((f: any) => f.name === 'legacy.sqlite')
        return i >= 0 ? path.join(dir, String(i)) : undefined
      })()
    })
  } catch (e: any) {
    if (/Unsupported|authenticate|incorrect header|invalid distance/i.test(e.message))
      throw Error('密码错误或备份损坏；原数据未改变')
    throw e
  } finally {
    fs.closeSync(fd)
    fs.rmSync(dir, { recursive: true, force: true })
    activeDirs.delete(dir)
    busyTransfers.delete(input.id)
    t.at = Date.now()
    key?.fill(0)
  }
}
export function previewBackupTransfer(input: any) {
  return withDecoded(input, (a) =>
    a.legacy
      ? previewBackup({ password: input.password, base64: a.base64 })
      : {
          version: 2,
          createdAt: a.manifest.createdAt,
          counts: a.counts,
          attachments: a.attachments.length
        }
  )
}
export function restoreBackupTransfer(input: any) {
  if (input?.confirm !== true) throw Error('请先预览备份并确认恢复')
  return withDecoded(input, (a) => {
    if (a.legacy)
      return restoreEncryptedBackup({ password: input.password, base64: a.base64, confirm: true })
    const db = new DatabaseSync(a.database, { readOnly: true })
    try {
      const tables = Object.fromEntries(
        backupTables.map((t) => [t, t.startsWith('execution_') && !db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(t) ? [] : db.prepare(`SELECT * FROM ${t}`).iterate()])
      )
      return restoreBackupContents(
        { tables, attachments: a.attachments, legacyPath: a.legacyPath },
        true
      )
    } finally {
      db.close()
    }
  })
}
export function closeBackupTransfer(input: any) {
  if (busyTransfers.has(input?.id)) throw Error('此备份正在处理，请等待完成')
  const t = transfer(input?.id)
  fs.rmSync(t.file, { force: true })
  transfers.delete(input.id)
  return { closed: true }
}
export function registerBackupTransfers(
  handle: (name: string, fn: (...args: any[]) => any) => void
) {
  handle('career-backup-create-transfer', (_, p) => createBackupTransfer(p))
  handle('career-backup-download-chunk', (_, p) => downloadBackupChunk(p))
  handle('career-backup-begin-upload', (_, p) => beginBackupUpload(p))
  handle('career-backup-upload-chunk', (_, p) => uploadBackupChunk(p))
  handle('career-backup-preview-transfer', (_, p) => previewBackupTransfer(p))
  handle('career-backup-restore-transfer', (_, p) => restoreBackupTransfer(p))
  handle('career-backup-close-transfer', (_, p) => closeBackupTransfer(p))
}
export function cleanupExpiredBackupTransfers() {
  const dir = privateDir(),
    cutoff = Date.now() - TTL
  let bytes = 0
  const live = new Set([...transfers.values()].filter((t) => t.at > cutoff).map((t) => t.file))
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name),
      s = fs.lstatSync(file)
    if (s.mtimeMs > cutoff || live.has(file) || activeDirs.has(file)) continue
    if (s.isFile() && /^([a-f0-9]{48})\.(atlas|upload)$/.test(name)) {
      bytes += s.size
      fs.unlinkSync(file)
    } else if (s.isDirectory() && /^(export-[a-f0-9]{48}|decode-[a-f0-9]{32})$/.test(name)) {
      // Crash leftovers only; active plaintext snapshots must never be removed.
      for (const entry of fs.readdirSync(file)) {
        const stat = fs.lstatSync(path.join(file, entry))
        if (stat.isFile()) bytes += stat.size
      }
      fs.rmSync(file, { recursive: true, force: true })
    }
  }
  for (const [id, t] of transfers) if (t.at <= cutoff) transfers.delete(id)
  return { bytes }
}
