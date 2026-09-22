import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { DatabaseSync, backup } from 'node:sqlite'
import { migrateAtlasSchema } from './atlas-migrations'

export const defaultAtlasRoot = () => path.join(os.homedir(), '.local/share/zhitu-atlas')
export const installationRoot = () => process.env.ATLAS_DATA_ROOT || defaultAtlasRoot()
export function assertPrivateLocation(directory: string) {
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.git')) || fs.existsSync(path.join(current, 'SOURCE_MANIFEST.json')))
      throw Error('私有配置必须保存在源码仓库之外，请将 ATLAS_DATA_ROOT 指向本机独立目录')
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw Error('私有配置目录不能使用符号链接')
    } catch (error: any) { if (error.code !== 'ENOENT') throw error }
    if (path.dirname(current) === current) break
  }
}
const privateDirectory = (directory: string) => {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
}

/** Copy a stopped installation into a new directory; never overwrite either source or target. */
export async function migrateInstallation(source: string, target: string) {
  source = path.resolve(source)
  target = path.resolve(target)
  assertPrivateLocation(target)
  if (target === source || target.startsWith(source + path.sep))
    throw Error('迁移目标必须独立于原目录')
  if (fs.existsSync(source) && fs.lstatSync(source).isSymbolicLink())
    throw Error('迁移来源不能是符号链接')
  if (fs.existsSync(target)) return { migrated: false, reason: 'target-exists' }
  if (!fs.existsSync(source)) return { migrated: false, reason: 'source-absent' }
  // A runtime file is a lease hint, not a source of credentials for this migration.
  const runtime = path.join(source, 'storage/atlas-runtime.json')
  if (fs.existsSync(runtime)) {
    try {
      const pid = JSON.parse(fs.readFileSync(runtime, 'utf8')).pid
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0)
          throw Error('请先退出旧版桌面和后台，再迁移资料。')
        } catch (e: any) {
          if (e.code !== 'ESRCH') throw e
        }
      }
    } catch (e: any) {
      if (!(e instanceof SyntaxError)) throw e
    }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  const staged = target + '.migrating-' + randomUUID()
  privateDirectory(staged)
  const manifest: Array<{ file: string; sha256: string }> = []
  try {
    const attachments = fs
      .readdirSync(source, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && /^attachments(?:\.restore-[a-f0-9]+)?$/.test(entry.name)
      )
      .map((entry) => entry.name)
    for (const folder of ['config', 'private', 'storage', ...attachments]) {
      const base = path.join(source, folder)
      if (!fs.existsSync(base) || fs.lstatSync(base).isSymbolicLink()) continue
      const copy = async (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) continue
          const from = path.join(directory, entry.name)
          const relative = path.relative(source, from),
            to = path.join(staged, relative)
          if (entry.isDirectory()) {
            if (entry.name.endsWith('.lock')) continue
            privateDirectory(to)
            await copy(from)
            continue
          }
          if (
            !entry.isFile() ||
            /(?:-wal|-shm|\.lock|\.tmp)$/.test(entry.name) ||
            ['atlas-runtime.json', 'ipc-pipe-name'].includes(entry.name)
          )
            continue
          privateDirectory(path.dirname(to))
          if (entry.name.endsWith('.db')) {
            const db = new DatabaseSync(from, { readOnly: true })
            try {
              await backup(db, to)
            } finally {
              db.close()
            }
            const check = new DatabaseSync(to, { readOnly: true })
            try {
              if (Object.values(check.prepare('PRAGMA integrity_check').get()!)[0] !== 'ok')
                throw Error('数据库备份校验失败，原资料未改变')
            } finally {
              check.close()
            }
          } else fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL)
          fs.chmodSync(to, 0o600)
          manifest.push({
            file: relative,
            sha256: createHash('sha256').update(fs.readFileSync(to)).digest('hex')
          })
        }
      }
      await copy(base)
    }
    const atlasFile = path.join(staged, 'storage/atlas.db')
    {
      privateDirectory(path.dirname(atlasFile))
      const db = new DatabaseSync(atlasFile)
      try {
        migrateAtlasSchema(db)
        // Older installs may still have execution preferences only in JSON files.
        for (const key of [
          'atlas-career-policy',
          'atlas-runtime',
          'career-auto-reply.json',
          'atlas-discovery-settings',
          'atlas-boss-sync-settings'
        ]) {
          const legacyFile = path.join(staged, 'config', key)
          if (
            !db.prepare('SELECT 1 FROM documents WHERE key=?').get(key) &&
            fs.existsSync(legacyFile)
          )
            db.prepare('INSERT INTO documents VALUES(?,?,1,?)').run(
              key,
              JSON.stringify(JSON.parse(fs.readFileSync(legacyFile, 'utf8'))),
              new Date().toISOString()
            )
        }
        const tables = new Set(
          db
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .all()
            .map((row) => row.name)
        )
        db.exec('BEGIN IMMEDIATE')
        if (tables.has('documents')) {
          for (const row of db.prepare('SELECT key,value FROM documents').all()) {
            const key = String(row.key),
              value = JSON.parse(String(row.value))
            if (key === 'atlas-career-policy') {
              value.automationPaused = true
              value.sending = { ...value.sending, paused: true }
              value.replies = { ...value.replies, mode: 'off' }
              value.discovery = { ...value.discovery, autoRecommend: false }
              value.version = (value.version || 0) + 1
            } else if (key === 'atlas-runtime') value.paused = true
            else if (key === 'career-auto-reply.json') value.mode = 'off'
            else if (key === 'atlas-discovery-settings') value.autoRecommend = false
            else if (key === 'atlas-boss-sync-settings') value.enabled = false
            else if (key.startsWith('atlas-discovery-run/') && value) {
              value.state = 'paused'
              value.message = '独立版本迁移后请核实账号再启动'
            } else continue
            db.prepare('UPDATE documents SET value=?,revision=revision+1 WHERE key=?').run(
              JSON.stringify(value),
              key
            )
          }
        }
        for (const table of ['leases', 'contact_reservations'])
          if (tables.has(table)) db.exec(`DELETE FROM ${table}`)
        if (tables.has('task_runs'))
          db.exec(
            "UPDATE task_runs SET state='interrupted',step='迁移后需本人重新核实' WHERE state IN ('queued','running')"
          )
        if (tables.has('send_attempts'))
          db.exec("UPDATE send_attempts SET status='uncertain' WHERE status='sending'")
        if (tables.has('contact_runs'))
          db.exec(
            "UPDATE contact_runs SET state='review',body=json_set(body,'$.state','review','$.reason','迁移后需本人重新核实'),revision=revision+1 WHERE state NOT IN ('completed','manual','cancelled','existing','uncertain')"
          )
        db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)')
      } finally {
        db.close()
      }
      fs.chmodSync(atlasFile, 0o600)
      if (!manifest.some((item) => item.file === 'storage/atlas.db'))
        manifest.push({ file: 'storage/atlas.db', sha256: '' })
    }
    for (const item of manifest)
      item.sha256 = createHash('sha256')
        .update(fs.readFileSync(path.join(staged, item.file)))
        .digest('hex')
    fs.writeFileSync(
      path.join(staged, 'migration.json'),
      JSON.stringify({ version: 1, at: new Date().toISOString(), files: manifest, paused: true }),
      { mode: 0o600 }
    )
    // A racing installer must not replace another completed installation.
    if (fs.existsSync(target)) throw Error('目标目录已由另一个进程创建，迁移已停止')
    fs.renameSync(staged, target)
    return { migrated: true, files: manifest.length }
  } catch (error) {
    fs.rmSync(staged, { recursive: true, force: true })
    throw error
  }
}

export async function prepareInstallation() {
  assertPrivateLocation(installationRoot())
  // The historical directory is read only during this one-time migration.
  if (!process.env.ATLAS_DATA_ROOT)
    await migrateInstallation(path.join(os.homedir(), '.geekgeekrun'), defaultAtlasRoot())
  for (const sub of ['', 'storage', 'config']) privateDirectory(path.join(installationRoot(), sub))
}
