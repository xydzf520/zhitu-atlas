import { atlasRead, atlasWrite } from './atlas-store'
import { isBossUrl } from '../../common/boss-browser'

export function bossPageIdentity(raw: unknown) {
  if (!isBossUrl(raw)) return null
  const url = new URL(raw)
  // Security/session query strings are deliberately excluded from persisted history.
  const value = url.origin + url.pathname
  const match = url.pathname.match(/^\/job_detail\/([^/]+)\.html$/)
  const kind = match ? '职位详情' : url.pathname.startsWith('/web/geek/chat') ? '消息' : url.pathname.startsWith('/web/geek/jobs') ? '职位列表' : url.pathname.startsWith('/web/geek/resume') ? '简历' : '其他 BOSS 页面'
  try { return { url: value.slice(0, 2000), kind, jobId: match ? decodeURIComponent(match[1]) : '' } }
  catch { return null }
}
export const readBossNavigation = () => atlasRead<any>('atlas-boss-navigation', { current: null, history: [] })
export function recordBossNavigation(raw: unknown) {
  const identity = bossPageIdentity(raw)
  if (!identity) return readBossNavigation()
  const previous = readBossNavigation()
  if (previous.current?.url === identity.url) return previous
  const current = { ...identity, at: new Date().toISOString() }
  const value = { current, history: [...(previous.history || []), current].slice(-100) }
  atlasWrite('atlas-boss-navigation', value)
  return value
}
