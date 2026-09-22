import { recruitmentCities } from '../../common/regions'
import https from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// Public HTML only: no search API, credentials, BOSS session, or page scripts.
export function publicUrl(raw: string) {
  const u = new URL(raw)
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    (u.port && u.port !== '443') ||
    !u.hostname.includes('.') ||
    isIP(u.hostname.replace(/^\[|\]$/g, '')) ||
    /(?:^|\.)(?:localhost|local|lan|internal|test|invalid)$/.test(u.hostname)
  )
    throw Error('只允许公开 HTTPS 网页')
  u.hash = ''
  return u.toString()
}
export function publicIp(ip: string) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    )
  }
  // Only globally routable unicast; reject mapped, link-local, unique-local and documentation IPs.
  return isIP(ip) === 6 && /^[23]/i.test(ip) && !/^2001:(?:db8|0:)/i.test(ip) && !/^2002:/i.test(ip)
}
export async function publicHtml(
  raw: string,
  signal: AbortSignal,
  redirects = 0
): Promise<{ url: string; html: string }> {
  const url = publicUrl(raw),
    u = new URL(url)
  signal.throwIfAborted()
  const addresses = await lookup(u.hostname, { all: true })
  signal.throwIfAborted()
  if (!addresses.length || addresses.some((a) => !publicIp(a.address)))
    throw Error('网页地址不能指向本机或内网')
  const address = addresses.find((a) => a.family === 4) || addresses[0]
  const response = await new Promise<{
    status: number
    location: string
    type: string
    html: string
  }>((resolve, reject) => {
    const req = https.get(
      url,
      {
        signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AtlasResearch/1.0)',
          Accept: 'text/html'
        },
        // Pin the validated DNS answer to this socket; every redirect is checked again.
        lookup: ((_host: string, opts: any, cb: any) =>
          opts.all ? cb(null, [address]) : cb(null, address.address, address.family)) as any
      },
      (res) => {
        const status = res.statusCode || 0,
          location = String(res.headers.location || ''),
          type = String(res.headers['content-type'] || '')
        if (status >= 300 && status < 400) {
          res.resume()
          resolve({ status, location, type, html: '' })
          return
        }
        if (status !== 200 || !/text\/html|application\/xhtml/i.test(type)) {
          res.resume()
          reject(Error(`公开网页不可读取（HTTP ${status}），可能需登录、验证或不支持正文格式`))
          return
        }
        let size = 0
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 2 * 1024 * 1024) req.destroy(Error('网页过大，停止读取'))
          else chunks.push(chunk)
        })
        res.on('error', reject)
        res.on('end', () =>
          resolve({ status, location, type, html: Buffer.concat(chunks).toString('utf8') })
        )
      }
    )
    req.setTimeout(20000, () => req.destroy(Error('公开网页读取超时')))
    req.on('error', reject)
  })
  if (response.status >= 300 && response.status < 400) {
    if (redirects >= 3 || !response.location) throw Error('网页跳转过多，停止读取')
    return publicHtml(new URL(response.location, url).toString(), signal, redirects + 1)
  }
  return { url, html: response.html }
}
export function htmlText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(?:x([a-f0-9]+)|(\d+));/gi, (_m, h, n) => {
      const v = parseInt(h || n, h ? 16 : 10)
      return v > 0 && v <= 0x10ffff ? String.fromCodePoint(v) : ' '
    })
    .replace(
      /&(?:nbsp|amp|quot|apos|lt|gt);/gi,
      (s) =>
        ({ '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' })[
          s.toLowerCase()
        ] || ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
}
function searchLink(raw: string) {
  const u = new URL(raw.replace(/&amp;/g, '&'))
  if (/(^|\.)bing\.com$/.test(u.hostname) && u.pathname === '/ck/a') {
    const encoded = u.searchParams.get('u') || ''
    if (encoded.startsWith('a1'))
      return publicUrl(Buffer.from(encoded.slice(2), 'base64url').toString('utf8'))
  }
  const url = publicUrl(u.toString())
  if (/(^|\.)bing\.com$/.test(new URL(url).hostname)) throw Error('搜索导航不作为资料来源')
  return url
}
export function parseSearchResults(html: string) {
  const results: { title: string; url: string; text: string }[] = []
  for (const block of html.match(
    /<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>[\s\S]*?<\/li>/gi
  ) || []) {
    const heading = block.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/i)?.[0] || ''
    const href = heading.match(/href=["']([^"']+)["']/i)?.[1]
    if (!href) continue
    try {
      const url = searchLink(href),
        title = htmlText(heading).slice(0, 180)
      if (title && !results.some((r) => r.url === url))
        results.push({ url, title, text: htmlText(block).slice(0, 1800) })
    } catch {
      /* Invalid, private and navigation links are not admitted to the model's read tool. */
    }
    if (results.length >= 6) break
  }
  return results
}
export const researchAspects = ['业务产品', '官网', '地址', '近期动态'] as const
export function companySearchQuery(company: string, aspect: string) {
  if (!researchAspects.includes(aspect as any)) throw Error('不支持的企业搜索主题')
  const name = company.replace(/[\r\n\t"<>]/g, ' ').trim()
  if (!name || name.length > 100 || /https?:|@|\b(?:sk-|user_)/i.test(name))
    throw Error('企业名称不适合公开搜索，请先核实')
  return `${name} ${aspect === '业务产品' ? '产品' : aspect === '地址' ? '地址' : aspect === '近期动态' ? '新闻' : '官网'}`
}
export function companyNameCore(company: string) {
  const city = recruitmentCities.map(c=>c.name).sort((a,b)=>b.length-a.length).find(c=>company.startsWith(c))
  return (city ? company.slice(city.length).replace(/^市/, '') : company)
    .replace(
      /(?:股份有限公司|有限责任公司|有限公司|信息技术咨询|信息技术|软件科技|网络科技|科技|集团)+$/,
      ''
    )
    .replace(/\s+/g, '')
}
export async function searchPublicCompany(company: string, aspect: string, signal: AbortSignal) {
  const query = companySearchQuery(company, aspect)
  const page = await publicHtml('https://cn.bing.com/search?q=' + encodeURIComponent(query), signal)
  const core = companyNameCore(company),
    results = parseSearchResults(page.html).filter((s) => {
      const text = (s.title + s.text).replace(/\s+/g, '').toLowerCase()
      return (
        text.includes(company.replace(/\s+/g, '').toLowerCase()) ||
        (core.length >= 2 && text.includes(core.toLowerCase()))
      )
    })
  return {
    query,
    results,
    at: new Date().toISOString(),
    notice: results.length
      ? ''
      : '没有读到公开搜索结果；可能暂无匹配资料或搜索页面要求验证，不代表企业没有业务'
  }
}
