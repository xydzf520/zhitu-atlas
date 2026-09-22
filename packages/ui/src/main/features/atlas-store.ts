import fs from 'node:fs'
import { installationRoot } from './atlas-installation'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { migrateAtlasSchema } from './atlas-migrations'
import { packAnalysis, unpackAnalysis } from './atlas-analysis-storage'

// Both the bundled Electron and local Node runtime provide SQLite. No native ABI rebuild.
const { DatabaseSync } = require('node:sqlite')
const databases = new Map<string, any>()
const transactionDepth = new WeakMap<object, number>()
export const atlasRoot = installationRoot
export const atlasOwned = (key: string) =>
  /^career-[a-z0-9-]+(?:\/[a-f0-9]{64})?\.json$/.test(key) || key.startsWith('atlas-')
const json = (v: unknown) => JSON.stringify(v)
export const fingerprint = (v: unknown) => createHash('sha256').update(json(v)).digest('hex')
export function atlasDb() {
  const root = atlasRoot()
  if (databases.has(root)) return databases.get(root)
  const storage = path.join(root, 'storage')
  fs.mkdirSync(storage, { recursive: true, mode: 0o700 })
  const file = path.join(storage, 'atlas.db'),
    db = new DatabaseSync(file)
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;')
  try {
    migrateAtlasSchema(db)
  } catch (error) {
    db.close()
    throw error
  }
  fs.chmodSync(file, 0o600)
  databases.set(root, db)
  return db
}
export function atlasTransaction<T>(run: () => T): T {
  const db = atlasDb()
  // Reserve the writer before reading quotas/revisions. A deferred transaction
  // can fail its read-to-write upgrade when two workers claim at the same time.
  const depth = transactionDepth.get(db) || 0
  const name = 't' + randomUUID().replace(/-/g, '')
  db.exec(depth ? `SAVEPOINT ${name}` : 'BEGIN IMMEDIATE')
  transactionDepth.set(db, depth + 1)
  try {
    const value = run()
    db.exec(depth ? `RELEASE ${name}` : 'COMMIT')
    return value
  } catch (e) {
    db.exec(depth ? `ROLLBACK TO ${name}; RELEASE ${name}` : 'ROLLBACK')
    throw e
  } finally {
    transactionDepth.set(db, depth)
  }
}
export function atlasRead<T>(key: string, fallback: T): T {
  const row = atlasDb().prepare('SELECT value FROM documents WHERE key=?').get(key)
  if (row) return unpackAnalysis(atlasDb(), JSON.parse(row.value))
  // Import each legacy document once. Subsequent reads use SQLite exclusively.
  const file = path.join(atlasRoot(), 'config', key)
  const restored =
    atlasDb().prepare("SELECT value FROM documents WHERE key='atlas-legacy-import-closed'").get()
      ?.value === 'true'
  if (!restored && atlasOwned(key) && fs.existsSync(file)) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    atlasDb()
      .prepare('INSERT OR IGNORE INTO documents VALUES(?,?,1,?)')
      .run(key, json(value), new Date().toISOString())
    return JSON.parse(atlasDb().prepare('SELECT value FROM documents WHERE key=?').get(key).value)
  }
  return fallback
}
export function atlasWrite(key: string, value: unknown, source = 'workspace') {
  return atlasTransaction(() => {
    const db = atlasDb(),
      serialized = json((key.startsWith('atlas-ai/') || key.startsWith('atlas-discovery-item/')) ? packAnalysis(db, value) : value),
      now = new Date().toISOString()
    const previous = db.prepare('SELECT value FROM documents WHERE key=?').get(key)
    if (previous?.value === serialized) return
    db.prepare(
      `INSERT INTO documents VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, revision=documents.revision+1, updated_at=excluded.updated_at`
    ).run(key, serialized, now)
    // Compatibility writers update the single policy in this same transaction.
    const policyRow = db.prepare("SELECT value FROM documents WHERE key='atlas-career-policy'").get()
    if (policyRow && ['career-workspace.json', 'atlas-runtime', 'career-auto-reply.json', 'atlas-discovery-settings'].includes(key)) {
      const policy = JSON.parse(policyRow.value), oldPolicy = JSON.stringify(policy), v = value as any
      if (key === 'career-workspace.json') policy.direction = { targetRoles: v.profile.targetRoles, preferredCities: v.profile.preferredCities, minimumMonthlyK: v.profile.minimumMonthlyK }
      if (key === 'atlas-runtime') policy.sending = { ...policy.sending, ...v }
      if (key === 'career-auto-reply.json') {
        policy.replies = { mode: v.mode, activatedAt: v.activatedAt }
        for (const field of ['dailyLimit', 'cooldownMinutes', 'startHour', 'endHour']) if (v[field] != null) policy.sending[field] = field === 'cooldownMinutes' ? Math.max(10, v[field]) : v[field]
        policy.sending.firstContactLimit = Math.min(policy.sending.firstContactLimit, policy.sending.dailyLimit)
      }
      if (key === 'atlas-discovery-settings') {
        for (const field of ['autoRecommend', 'recommendTime', 'maxJobs', 'detailLimit', 'aiLimit']) if (v[field] != null) policy.discovery[field] = v[field]
        if (v.keywords) { policy.discovery.coreKeywords = v.keywords; policy.discovery.extensionKeywords = [] }
        if (v.minimumMonthlyK !== undefined) {
          policy.direction.minimumMonthlyK = v.minimumMonthlyK
          const workspaceRow=db.prepare("SELECT value FROM documents WHERE key='career-workspace.json'").get()
          if(workspaceRow) {const workspace=JSON.parse(workspaceRow.value);workspace.profile.minimumMonthlyK=v.minimumMonthlyK;atlasWrite('career-workspace.json',workspace)}
        }
      }
      if (JSON.stringify(policy) !== oldPolicy) { policy.version++; atlasWrite('atlas-career-policy', policy) }
    }
    if (key === 'career-workspace.json') {
      const profile = (value as any).profile
      const old = previous ? JSON.parse(previous.value).profile : null
      if (json(profile) !== json(old)) {
        const version =
          (db.prepare('SELECT MAX(version) AS n FROM profile_versions').get().n || 0) + 1
        db.prepare('INSERT INTO profile_versions VALUES(?,?,?,?,?)').run(
          randomUUID(),
          version,
          json(profile),
          source,
          now
        )
      }
    }
  })
}
export function atlasRemove(key: string) {
  atlasWrite(key, null)
}
export function atlasList<T>(prefix: string): T[] {
  const legacy = path.join(atlasRoot(), 'config', prefix)
  if (fs.existsSync(legacy) && fs.statSync(legacy).isDirectory()) {
    for (const file of fs.readdirSync(legacy))
      if (/^[a-f0-9]{64}\.json$/.test(file)) atlasRead(`${prefix}/${file}`, null)
  }
  return atlasDb()
    .prepare(prefix.includes('/') ? 'SELECT value FROM documents WHERE key >= ? AND key < ? ORDER BY updated_at DESC' : "SELECT value FROM documents WHERE substr(key,1,instr(key,'/')-1)=? ORDER BY updated_at DESC,key")
    .all(...(prefix.includes('/') ? [prefix+'/',prefix+'0'] : [prefix]))
    .map((r: any) => unpackAnalysis(atlasDb(), JSON.parse(r.value)))
    .filter(Boolean)
}
export function atlasRevision(keys: string[]) {
  const values = keys.map((key) => {
    atlasRead(key, null)
    const row = atlasDb().prepare('SELECT revision,updated_at FROM documents WHERE key=?').get(key)
    return [key, row || null]
  })
  return fingerprint([atlasRead('atlas-restore-epoch', null), values])
}
export function atlasEvent(kind: string, entityId: string, value: unknown) {
  atlasDb()
    .prepare('INSERT INTO events VALUES(?,?,?,?,?)')
    .run(randomUUID(), kind, entityId, json(value), new Date().toISOString())
}
export function closeAtlas() {
  for (const db of databases.values()) db.close()
  databases.clear()
}
