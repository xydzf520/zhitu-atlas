import { mapProvider, validateMapTile } from '../../common/map-provider'
import { readLocalMapSetting, writeLocalMapSetting } from './atlas-local-config'

export function mapSettings() {
  const { value, revision } = readLocalMapSetting()
  return { provider: mapProvider.id, enabled: value.enabled === true,
    configured: value.enabled === true && !!value.key && value.termsAccepted === true,
    hasKey: !!value.key, termsAccepted: value.termsAccepted === true, revision,
    localOnly: true, includedInBackup: false }
}
export function saveMapSettings(input: any) {
  const current = readLocalMapSetting()
  if (typeof input?.enabled !== 'boolean' || typeof input?.termsAccepted !== 'boolean' ||
      (input.key !== undefined && typeof input.key !== 'string') ||
      (input.clearKey !== undefined && typeof input.clearKey !== 'boolean')) throw Error('地图配置格式无效')
  const key = input.clearKey ? '' : input.key?.trim() || current.value.key || ''
  if (key && !/^[a-f0-9]{32}$/i.test(key)) throw Error('天地图 Key 应为控制台提供的 32 位字符')
  if (input.enabled && (!key || !input.termsAccepted)) throw Error('请填写自己的 Key 并核对服务使用条件')
  writeLocalMapSetting({ provider: mapProvider.id, enabled: input.enabled, key,
    termsAccepted: input.termsAccepted, updatedAt: new Date().toISOString() }, input.revision)
  return mapSettings()
}

export function tileUrl(input: unknown, key: string) {
  const p = validateMapTile(input)
  const url = new URL(`https://t0.tianditu.gov.cn/${p.layer}_w/wmts`)
  url.search = new URLSearchParams({ SERVICE: 'WMTS', REQUEST: 'GetTile', VERSION: '1.0.0',
    LAYER: p.layer, STYLE: 'default', TILEMATRIXSET: 'w', FORMAT: 'tiles',
    TILEMATRIX: String(p.z), TILEROW: String(p.y), TILECOL: String(p.x), tk: key }).toString()
  return url
}
let active = 0
const queue: Array<() => void> = []
const inflight = new Map<string, Promise<string>>()
async function limited<T>(run: () => Promise<T>): Promise<T> {
  if (active >= 8) {
    if (queue.length >= 120) throw Error('地图请求较多，请停止拖动后重试')
    await new Promise<void>((resolve) => queue.push(resolve))
  } else active++
  try { return await run() }
  finally { const next = queue.shift(); if (next) next(); else active-- }
}
export async function mapTile(input: unknown): Promise<string> {
  const p = validateMapTile(input), cacheKey = JSON.stringify(p)
  const existing = inflight.get(cacheKey)
  if (existing) return existing
  const request = limited(async () => {
    const { value, revision } = readLocalMapSetting()
    if (!value.enabled || !value.key || !value.termsAccepted) throw Error('请先在设置中连接地图')
    if (p.revision !== revision) throw Error('地图配置已更新，请重新加载地图')
    let response: Response
    try {
      response = await fetch(tileUrl(p, value.key), { redirect: 'error', signal: AbortSignal.timeout(12000) })
    } catch { throw Error('地图连接失败，请检查网络后重试') }
    if (!response.ok) {
      await response.body?.cancel()
      throw Error('地图服务未返回图像，请检查 Key 权限、配额及网络')
    }
    const type = response.headers.get('content-type')?.split(';')[0].trim()
    if (!['image/png', 'image/jpeg'].includes(type || '') || Number(response.headers.get('content-length')) > 1024 * 1024) {
      await response.body?.cancel()
      throw Error('地图服务返回授权提示或不支持的内容，请检查 Key 和权限')
    }
    const reader = response.body?.getReader()
    if (!reader) throw Error('地图服务返回空内容')
    const chunks: Uint8Array[] = []; let size = 0
    try {
      while (true) {
        const { value: part, done } = await reader.read()
        if (done) break
        size += part.byteLength
        if (size > 1024 * 1024) throw Error('size')
        chunks.push(part)
      }
    } catch { await reader.cancel().catch(() => {}); throw Error('地图图像读取失败或超过大小限制') }
    finally { reader.releaseLock() }
    const image = Buffer.concat(chunks)
    const valid = type === 'image/png'
      ? image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : image[0] === 255 && image[1] === 216 && image[2] === 255
    if (!valid) throw Error('地图返回内容不是有效图像')
    if (readLocalMapSetting().revision !== revision) throw Error('地图配置已更新，请重新加载地图')
    return `data:${type};base64,${image.toString('base64')}`
  })
  inflight.set(cacheKey, request)
  try { return await request } finally { inflight.delete(cacheKey) }
}
export function registerMap(handle: (name: string, handler: (...args: any[]) => any) => void) {
  handle('career-map-settings', mapSettings)
  handle('career-map-settings-save', (_, input) => saveMapSettings(input))
  handle('career-map-tile', (_, input) => mapTile(input))
  handle('career-map-test', async () => {
    const { revision } = mapSettings()
    await Promise.all(mapProvider.layers.map((layer) => mapTile({ layer, z: 3, x: 6, y: 3, revision })))
    return { ok: true, checkedLayers: [...mapProvider.layers], message: '底图、地名与境界图层连接成功' }
  })
}
