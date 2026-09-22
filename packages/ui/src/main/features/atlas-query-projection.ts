// Derived, process-local read models. Never backed up and never a business authority.
// Rebuild once when source revisions change; subsequent filtering/paging uses SQLite.
const caches = new WeakMap<object, Map<string, any>>()
export function storageStamp(db: any, scopes: string[]) {
  return scopes.map((scope) => [
    scope,
    db.prepare('SELECT revision FROM storage_revisions WHERE scope=?').get(scope)?.revision || 0
  ])
}
export function queryProjection(
  db: any,
  name: 'discovery' | 'conversations',
  basis: string,
  build: () => { rows: any[]; counts: any },
  fields: (r: any) => any
) {
  let cache = caches.get(db)
  if (!cache) {
    cache = new Map()
    caches.set(db, cache)
  }
  const table = 'atlas_page_' + name
  if (cache.get(name)?.basis !== basis) {
    const value = build()
    db.exec(`CREATE TEMP TABLE IF NOT EXISTS ${table}(position INTEGER PRIMARY KEY,id TEXT,search TEXT,status TEXT,bucket TEXT,pending INTEGER,eligible INTEGER,recommended INTEGER,channel_targeted INTEGER,channel_recommended INTEGER,unread INTEGER,attention INTEGER);
      CREATE INDEX IF NOT EXISTS temp.${table}_status ON ${table}(status,position);
      CREATE INDEX IF NOT EXISTS temp.${table}_bucket ON ${table}(bucket,position);
      DELETE FROM ${table};`)
    const insert = db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    db.exec('SAVEPOINT page_projection')
    try {
      value.rows.forEach((r, i) => {
        const f = fields(r)
        insert.run(
          i,
          f.id,
          f.search,
          f.status || '',
          f.bucket || '',
          +!!f.pending,
          +!!f.eligible,
          +!!f.recommended,
          +!!f.targeted,
          +!!f.recommendedChannel,
          +!!f.unread,
          +!!f.attention
        )
      })
      db.exec('RELEASE page_projection')
    } catch (e) {
      db.exec('ROLLBACK TO page_projection; RELEASE page_projection')
      cache.delete(name)
      throw e
    }
    cache.set(name, { ...value, basis, rebuiltAt: Date.now() })
  }
  const state = cache.get(name)
  return {
    counts: state.counts,
    first: (where: string, limit: number) =>
      db
        .prepare(`SELECT position FROM ${table} WHERE ${where} ORDER BY position LIMIT ?`)
        .all(limit)
        .map((r: any) => state.rows[r.position]),
    page: (where: string, args: any[], requested: number, limit: number) => {
      const total = db.prepare(`SELECT count(*) n FROM ${table} WHERE ${where}`).get(...args).n
      const pages = Math.max(1, Math.ceil(total / limit)),
        page = Math.min(pages, Math.max(1, Math.floor(requested) || 1))
      const items = db
        .prepare(`SELECT position FROM ${table} WHERE ${where} ORDER BY position LIMIT ? OFFSET ?`)
        .all(...args, limit, (page - 1) * limit)
        .map((r: any) => state.rows[r.position])
      return { items, total, pages, page }
    }
  }
}
