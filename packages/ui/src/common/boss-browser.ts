export const BOSS_CHAT_URL = 'https://www.zhipin.com/web/geek/chat'
export const BOSS_JOBS_URL = 'https://www.zhipin.com/web/geek/jobs'
export const BOSS_RESUME_URL = 'https://www.zhipin.com/web/geek/resume'

export interface BossBrowserStatus {
  created: boolean
  loading: boolean
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  error: string
  session: 'existing' | 'imported' | 'new'
  sync: 'waiting' | 'connected' | 'login-required' | 'error' | 'job-detail'
  accountName: string
  loadedCount: number
  coverage?: {
    linkedJobs: number
    linkedDetails: number
    messages: number
    addresses: number
    conversationsWithMessages: number
    scope: string
  }
  capture?: { enabled: boolean; error: string }
  recordedPage?: { url: string; kind: string; jobId: string; at: string }
}

export function isBossUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8000) return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      (url.hostname === 'zhipin.com' || url.hostname.endsWith('.zhipin.com'))
    )
  } catch {
    return false
  }
}

export function bossViewBounds(value: any, width: number, height: number) {
  if (!value || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key])))
    throw Error('页面布局无效')
  // Keep the native site below its toolbar and outside the app navigation.
  const x = Math.max(64, Math.min(width, Math.round(value.x)))
  const y = Math.max(90, Math.min(height, Math.round(value.y)))
  return {
    x,
    y,
    width: Math.max(0, Math.min(width - x, Math.round(value.width))),
    height: Math.max(0, Math.min(height - y, Math.round(value.height)))
  }
}

export function bossCookieForImport(cookie: any, now = Date.now() / 1000) {
  const domain = typeof cookie?.domain === 'string' ? cookie.domain.toLowerCase() : ''
  if (
    !(domain === 'zhipin.com' || domain === '.zhipin.com' || domain.endsWith('.zhipin.com')) ||
    typeof cookie.name !== 'string' ||
    typeof cookie.value !== 'string'
  )
    return null
  const expires = Number(cookie.expirationDate ?? cookie.expires)
  if (expires > 0 && expires <= now) return null
  const sameSite: 'no_restriction' | 'lax' | 'strict' | 'unspecified' =
    cookie.sameSite === 'None' || cookie.sameSite === 'no_restriction'
      ? 'no_restriction'
      : String(cookie.sameSite).toLowerCase() === 'strict'
        ? 'strict'
        : String(cookie.sameSite).toLowerCase() === 'lax'
          ? 'lax'
          : 'unspecified'
  return {
    url: `https://${domain.replace(/^\./, '')}/`,
    name: cookie.name,
    value: cookie.value,
    ...(cookie.hostOnly ? {} : { domain }),
    path: cookie.path || '/',
    secure: cookie.secure !== false,
    httpOnly: !!cookie.httpOnly,
    sameSite,
    ...(expires > 0 ? { expirationDate: expires } : {})
  }
}
