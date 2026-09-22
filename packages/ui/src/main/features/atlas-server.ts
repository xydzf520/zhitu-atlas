import { startTaskQueue } from './atlas-task-queue'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createAtlasHandlers } from './atlas-service'
import { atlasRoot } from './atlas-store'
import { prepareInstallation } from './atlas-installation'

export const runtimeFile = () => path.join(atlasRoot(), 'storage/atlas-runtime.json')
const equal = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
export function localPort(value = process.env.ATLAS_PORT) {
  if (value === undefined || value === '') return 5178
  if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw Error('ATLAS_PORT 需为 1024–65535 的本机端口')
  return Number(value)
}
export async function startAtlasServer(webRoot: string, port = localPort()) {
  await prepareInstallation()
  const token = randomBytes(32).toString('hex')
  let handlers: ReturnType<typeof createAtlasHandlers> | undefined
  let stopTasks = () => {}
  let host = `127.0.0.1:${port}`
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json',
    '.woff2': 'font/woff2'
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'"
    )
    const send = (code: number, data: any) => {
      res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      })
      res.end(JSON.stringify(data))
    }
    if (req.headers.host !== host) return send(403, { error: '仅允许本机访问' })
    let url: URL
    try {
      url = new URL(req.url || '/', `http://${host}`)
    } catch {
      return send(400, { error: '地址无效' })
    }
    if (url.pathname === '/atlas-api/rpc') {
      if (!handlers) return send(503, { error: '服务正在准备，请稍后重试' })
      if (req.method !== 'POST') return send(405, { error: '仅接受 POST' })
      const supplied = String(req.headers['x-atlas-token'] || '')
      if (
        !equal(token, supplied) ||
        (req.headers.origin && req.headers.origin !== `http://${host}`) ||
        req.headers['sec-fetch-site'] === 'cross-site'
      )
        return send(403, { error: '本机会话已失效，请重新打开工作台' })
      try {
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > 64 * 1024 * 1024) return send(413, { error: '文件过大' })
          chunks.push(chunk)
        }
        const { channel, payload } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const handler = handlers.get(channel)
        if (!handler) return send(404, { error: '该功能尚未提供' })
        return send(200, { data: await handler({}, payload) })
      } catch (e: any) {
        const message = String(e.message || '')
        return send(400, {
          error: /SQLITE|Bearer|api.key|sk-[\w-]+|user_[\w-]{16,}|gh[pousr]_[\w]+|github_pat_|password[=:]|\/home\/|\n|\bSELECT\b|\bINSERT\b/i.test(message)
            ? '操作未完成，资料已保留，请检查输入与连接状态'
            : message.slice(0, 300) || '操作失败'
        })
      }
    }
    if (req.method !== 'GET' || req.headers['sec-fetch-site'] === 'cross-site')
      return send(403, { error: '访问被拒绝' })
    let relative: string
    try {
      relative = decodeURIComponent(url.pathname === '/' ? '/desktop.html' : url.pathname)
      if (relative.includes('\0')) throw Error('invalid path')
    } catch {
      return send(400, { error: '地址无效' })
    }
    const file = path.resolve(webRoot, '.' + relative)
    if (
      !file.startsWith(path.resolve(webRoot) + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile() ||
      fs.lstatSync(file).isSymbolicLink() ||
      !fs.realpathSync(file).startsWith(fs.realpathSync(webRoot) + path.sep)
    )
      return send(404, { error: '界面资源未安装' })
    const type = mime[path.extname(file)] || 'application/octet-stream'
    res.setHeader('Content-Type', type)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (path.extname(file) === '.html') {
      res.setHeader('Cache-Control', 'no-store')
      res.end(
        fs
          .readFileSync(file, 'utf8')
          .replace('</head>', `<meta name="atlas-session" content="${token}"></head>`)
      )
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600')
      fs.createReadStream(file).pipe(res)
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  try {
    handlers = createAtlasHandlers()
    stopTasks = startTaskQueue(async (channel, payload) => handlers!.get(channel)!({}, payload))
  } catch (error) {
    server.close()
    throw error
  }
  port = (server.address() as { port: number }).port
  host = `127.0.0.1:${port}`
  server.on('close', () => {
    stopTasks()
    try {
      if (JSON.parse(fs.readFileSync(runtimeFile(), 'utf8')).token === token)
        fs.unlinkSync(runtimeFile())
    } catch {}
  })
  try {
    fs.mkdirSync(path.dirname(runtimeFile()), { recursive: true, mode: 0o700 })
    fs.writeFileSync(
      runtimeFile(),
      JSON.stringify({ port, token, pid: process.pid, protocol: 2 }),
      { mode: 0o600 }
    )
    fs.chmodSync(runtimeFile(), 0o600)
  } catch (error) {
    server.close()
    throw error
  }
  return server
}
export async function invokeAtlas(channel: string, payload?: unknown) {
  let connection: any
  try {
    connection = JSON.parse(fs.readFileSync(runtimeFile(), 'utf8'))
    if (
      !Number.isInteger(connection.port) ||
      connection.port < 1 ||
      connection.port > 65535 ||
      !/^[a-f0-9]{64}$/.test(connection.token)
    )
      throw Error('invalid connection')
  } catch {
    throw new Error('本机服务尚未启动，请重新打开职途 Atlas')
  }
  const response = await fetch(`http://127.0.0.1:${connection.port}/atlas-api/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Atlas-Token': connection.token },
    body: JSON.stringify({ channel, payload }),
    signal: AbortSignal.timeout(60000)
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || '本机服务操作失败')
  return value.data
}
