/** Native surface is deliberately smaller than the business RPC surface. */
export const nativeChannels = [
  'career-copy-text',
  'atlas-boss-status',
  'atlas-boss-open',
  'atlas-boss-hide',
  'atlas-boss-layout',
  'atlas-boss-action',
  'atlas-boss-overlay',
  'atlas-runtime-info',
  'atlas-open-boss',
  'atlas-open-workspace-window'
] as const
export const eventChannels = ['atlas-boss-open-request', 'atlas-runtime-error'] as const
export const isBusinessChannel = (name: unknown): name is string =>
  typeof name === 'string' && /^career-[a-z0-9-]{1,80}$/.test(name)
export const allowedInvoke = (name: string) =>
  isBusinessChannel(name) || (nativeChannels as readonly string[]).includes(name)
export function publicLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 3000) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}
