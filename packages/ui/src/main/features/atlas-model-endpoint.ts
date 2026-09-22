import { URL } from 'node:url'

/** Only an explicit settings action may create a compatible provider. Never accept URLs from model output. */
export function compatibleEndpoint(value: unknown) {
  if (typeof value !== 'string' || value.length > 2000) throw Error('请填写兼容接口的 Base URL')
  let u: URL
  try { u = new URL(value.trim()) } catch { throw Error('模型地址格式无效') }
  const local = ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname)
  if (u.username || u.password || u.search || u.hash || /[%\\\\]/.test(u.pathname) ||
    !['https:', 'http:'].includes(u.protocol) || (u.protocol === 'http:' && !local) ||
    /^(?:0\.|169\.254\.|\[fe80:)/i.test(u.hostname))
    throw Error('模型地址仅支持 HTTPS 或本机回环 HTTP，不能含凭据、查询参数或转义路径')
  let base = u.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
  if (!base) base = '/v1'
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/.test(base)) throw Error('模型接口路径无效')
  u.pathname = base
  const baseUrl = u.toString().replace(/\/$/, '')
  return { baseUrl, url: baseUrl + '/chat/completions', local }
}
