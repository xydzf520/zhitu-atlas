import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { careerDirectory, readLocalJson } from './career-reply-store'
import { emptyCareerState, validateCareerState, opportunityKey } from '../../common/career'
import { validateDashboardPreferences, type DashboardPreferences } from '../../common/dashboard'
import { atlasOwned, atlasRevision, atlasTransaction } from './atlas-store'
import { migrateProfile } from './atlas-profile'

export const workspaceFiles = ['career-workspace.json', 'career-dashboard.json']
export function localRevision(files: string[]) {
  if (files.every(atlasOwned)) return atlasRevision(files)
  const hash = createHash('sha256')
  for (const file of files) {
    const p = path.join(careerDirectory(), file)
    hash.update(file).update('\0').update(fs.existsSync(p) ? fs.readFileSync(p) : 'missing').update('\0')
  }
  return hash.digest('hex')
}
export function checkRevision(base: unknown, files: string[]) {
  if (typeof base !== 'string' || base !== localRevision(files))
    throw new Error('另一个窗口已更新数据。当前修改仍保留，请先核对最新内容再保存。')
}
// All UI read-modify-write operations share this short, synchronous cross-process lock.
export function withCareerLock<T>(run: () => T): T {
  const dir = careerDirectory(), lock = path.join(dir, '.career-write.lock')
  fs.mkdirSync(dir, { recursive: true })
  let fd: number
  try { fd = fs.openSync(lock, 'wx', 0o600) }
  catch (error: any) {
    if (error.code !== 'EEXIST') throw error
    let stale = false
    try {
      const pid = Number(fs.readFileSync(lock, 'utf8'))
      if (Number.isSafeInteger(pid) && pid > 0) {
        try { process.kill(pid, 0) } catch (e: any) { stale = e.code === 'ESRCH' }
      }
    } catch { /* A concurrent writer may be finishing. Retry on the next user action. */ }
    if (!stale) throw new Error('另一个窗口正在保存，请稍后重试。')
    try { fs.unlinkSync(lock); fd = fs.openSync(lock, 'wx', 0o600) }
    catch { throw new Error('资料正在更新，请稍后重试。') }
  }
  try { fs.writeSync(fd, String(process.pid)); return atlasTransaction(run) }
  finally { fs.closeSync(fd); fs.unlinkSync(lock) }
}
export function readCareerSnapshot() {
  migrateProfile()
  const state = readLocalJson('career-workspace.json', emptyCareerState())
  const preferences = readLocalJson<DashboardPreferences>('career-dashboard.json', { version: 1, overrides: {} })
  validateCareerState(state); validateDashboardPreferences(preferences)
  for (const item of state.opportunities) {
    const id = opportunityKey(item)
    const edit = preferences.overrides[id]
    if (!edit) continue
    item.stage = edit.stage || item.stage
    item.nextDate = edit.nextDate ?? item.nextDate
    item.note = edit.note ?? item.note
    item.job.address = edit.address ?? item.job.address
  }
  return { state, preferences, revision: localRevision(workspaceFiles) }
}
