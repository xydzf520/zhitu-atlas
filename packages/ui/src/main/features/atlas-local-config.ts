import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { installationRoot, assertPrivateLocation } from './atlas-installation'
export { assertPrivateLocation } from './atlas-installation'

/** Backend only. Never import this module from renderer, common, or preload. */
export const privateConfigDirectory = () => path.join(path.resolve(installationRoot()), 'private')
export const privateModelFile = () => path.join(privateConfigDirectory(), 'models.json')
const legacyModelFile = () => path.join(path.resolve(installationRoot()), 'config/llm.json')
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function prepareDirectory() {
  const directory = privateConfigDirectory()
  assertPrivateLocation(directory)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
  return directory
}
function readFile(file: string): string | null {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024)
      throw Error('本机模型配置文件类型或大小异常，原文件已保留')
    fs.fchmodSync(fd, 0o600)
    return fs.readFileSync(fd, 'utf8')
  } catch (error: any) {
    if (error.code === 'ENOENT') return null
    // File parser/OS error messages can include credentials or personal paths.
    throw Error('本机模型配置无法安全读取，请检查私有目录与文件权限；原文件已保留')
  } finally { if (fd !== undefined) fs.closeSync(fd) }
}
function parse(text: string): any[] {
  try {
    const value = JSON.parse(text)
    if (!Array.isArray(value) || value.length > 200 || value.some(v => !v || typeof v !== 'object' || Array.isArray(v))) throw Error('shape')
    return value
  } catch { throw Error('本机模型配置格式损坏，原文件已保留；请从本机副本恢复') }
}
function writeFile(file: string, value: unknown) {
  // Validate the destination even though rename itself does not follow a symlink.
  if (fs.existsSync(file) && (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).nlink !== 1))
    throw Error('私有配置文件不能使用链接')
  const temporary = path.join(prepareDirectory(), '.models-' + randomUUID() + '.tmp')
  let fd: number | undefined
  try {
    fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600)
    fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined
    fs.renameSync(temporary, file)
    // Commit the directory entry before deleting the legacy copy.
    const dir = fs.openSync(path.dirname(file), fs.constants.O_RDONLY)
    try { fs.fsyncSync(dir) } finally { fs.closeSync(dir) }
  } catch { throw Error('本机私有配置保存未完成，请检查磁盘与权限并重新读取；未自动删除原始迁移文件') }
  finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(temporary, { force: true }) }
}
function locked<T>(run: () => T): T {
  const lock = path.join(prepareDirectory(), '.models.lock')
  try { fs.mkdirSync(lock, { mode: 0o700 }) }
  catch (error: any) {
    if (error.code !== 'EEXIST') throw Error('本机私有配置暂不可写，请检查目录权限')
    // Only reap a demonstrably dead owner; never steal an active writer's lock.
    try {
      const stat = fs.lstatSync(lock)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('unsafe')
      const owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'))
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw Error('owner')
      try { process.kill(owner.pid, 0); throw Error('active') }
      catch (e: any) { if (e.code !== 'ESRCH') throw e }
      fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock)
      fs.mkdirSync(lock, { mode: 0o700 })
    } catch { throw Error('另一个本机进程正在更新模型配置，请稍后重新读取') }
  }
  try {
    fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600, flag: 'wx' })
    return run()
  } finally {
    fs.rmSync(path.join(lock, 'owner.json'), { force: true }); fs.rmdirSync(lock)
  }
}
function readUnlocked(): any[] {
  assertPrivateLocation(path.dirname(legacyModelFile()))
  const currentText = readFile(privateModelFile()), legacyText = readFile(legacyModelFile())
  const current = currentText === null ? null : parse(currentText)
  if (legacyText === null) return current || []
  const legacy = parse(legacyText)
  if (current && digest(current) !== digest(legacy))
    throw Error('检测到新旧模型配置冲突，两份配置均已保留；请退出旧版后核对私有配置')
  if (!current) writeFile(privateModelFile(), legacy)
  // Read back before removing anything. Interrupted migration is safe to retry.
  if (digest(parse(readFile(privateModelFile())!)) !== digest(legacy)) throw Error('模型凭据迁移校验失败，原文件已保留')
  if (readFile(legacyModelFile()) !== legacyText) throw Error('旧版模型配置已变化，本次迁移停止')
  fs.unlinkSync(legacyModelFile())
  return current || legacy
}
export function readLocalModelConfigs(): any[] {
  prepareDirectory()
  // Normal reads do not acquire a write lock or touch ordinary business storage.
  if (!fs.existsSync(legacyModelFile())) {
    const text = readFile(privateModelFile())
    return text === null ? [] : parse(text)
  }
  return locked(readUnlocked)
}
export function writeLocalModelConfigs(next: any[], expectedRevision: string) {
  return locked(() => {
    if (digest(readUnlocked()) !== expectedRevision) throw Error('模型配置已变化，请重新读取；当前选择已保留')
    parse(JSON.stringify(next))
    writeFile(privateModelFile(), next)
  })
}
export function localConfigStatus() {
  return { localOnly: true, file: privateModelFile(), protection: 'owner-only', includedInBackup: false }
}

// Non-model service credentials share the same private directory and atomic writer.
export function readLocalMapSetting(): { value: any; revision: string } {
  prepareDirectory()
  const text = readFile(path.join(privateConfigDirectory(), 'maps.json'))
  let value: any = {}
  try {
    if (text !== null) value = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('shape')
  } catch { throw Error('本机地图配置格式损坏，原文件已保留') }
  return { value, revision: digest(value) }
}
export function writeLocalMapSetting(value: Record<string, unknown>, expectedRevision: string) {
  return locked(() => {
    if (readLocalMapSetting().revision !== expectedRevision) throw Error('地图配置已变化，请重新读取；未覆盖其他窗口的修改')
    writeFile(path.join(privateConfigDirectory(), 'maps.json'), value)
    return readLocalMapSetting()
  })
}
