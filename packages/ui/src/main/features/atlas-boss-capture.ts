import type { WebContents } from 'electron'
import { bossCapturePath, ingestBossJobs } from './atlas-boss-sync'
import { atlasWrite } from './atlas-store'

// Observes allowlisted responses made by the normal BOSS page. It never issues
// platform requests, intercepts traffic, navigates, or collects headers/cookies.
export function attachBossResponseCapture(
  wc: WebContents,
  context: () => Promise<{ id: string; epoch: number }>,
  sync: () => Promise<void>
) {
  const pending = new Map<string, { path: string; ready: Promise<{ id: string; epoch: number }> }>()
  let disposed = false,
    owned = false,
    captureError = ''
  let matchedResponses = 0, capturedJobs = 0, lastSkip = ''
  const observedJobPaths = new Set<string>()
  const mark = (message: string) => {
    captureError = message
  }
  const message = async (_event: any, method: string, p: any) => {
    if (disposed) return
    if (method === 'Network.responseReceived') {
      // Diagnostic endpoint names only: no queries, request bodies, headers or cookies.
      try {
        const url = new URL(p.response?.url || '')
        if (url.origin === 'https://www.zhipin.com' && /^\/wapi\/[a-zA-Z0-9_/.\-]{1,120}$/.test(url.pathname) && /job|position/i.test(url.pathname) && observedJobPaths.size < 16)
          observedJobPaths.add(url.pathname)
      } catch {}
      const pathname = bossCapturePath(p.response?.url || '')
      if (!pathname || p.response?.status !== 200 || !['XHR', 'Fetch'].includes(p.type)) return
      matchedResponses++
      if (pending.size >= 100) pending.delete(pending.keys().next().value!)
      const item = { path: pathname, ready: context().catch(() => ({ id: '', epoch: -1 })) }
      pending.set(p.requestId, item)
    } else if (method === 'Network.loadingFailed') pending.delete(p.requestId)
    else if (method === 'Network.loadingFinished') {
      const item = pending.get(p.requestId)
      if (!item) return
      // Account reads may still be pending when a small response finishes.
      try {
        const original = await item.ready,
          before = await context()
        if (
          !original.id ||
          before.id !== original.id ||
          before.epoch !== original.epoch ||
          disposed ||
          pending.get(p.requestId) !== item
        ) {
          lastSkip = !original.id ? '页面账号尚未核实' : '页面或账号在响应期间变化'
          return
        }
        if (item.path === '/wapi/zpchat/geek/historyMsg') {
          await sync()
          return
        }
        if (p.encodedDataLength > 2 * 1024 * 1024) {
          mark('岗位响应过大，已跳过')
          return
        }
        const response = await wc.debugger.sendCommand('Network.getResponseBody', {
          requestId: p.requestId
        })
        const content = response.base64Encoded
          ? Buffer.from(response.body, 'base64').toString('utf8')
          : response.body
        if (typeof content !== 'string' || Buffer.byteLength(content) > 2 * 1024 * 1024) {
          mark('岗位响应过大，已跳过')
          return
        }
        const after = await context()
        if (
          disposed ||
          before.id !== after.id ||
          before.epoch !== after.epoch ||
          pending.get(p.requestId) !== item
        )
          return
        const result = ingestBossJobs(before.id, JSON.parse(content), item.path)
        capturedJobs += result.saved
        lastSkip = result.reason
        if (result.reason === 'schema-changed') {
          mark('岗位页面结构变化，保留已有数据')
          atlasWrite('atlas-boss-capture-status', {
            accountId: before.id,
            state: 'error',
            at: new Date().toISOString(),
            error: captureError
          })
        } else if (result.saved) captureError = ''
      } catch {
        mark('本次岗位详情未能读取；打开岗位后可再次采集')
      } finally {
        pending.delete(p.requestId)
      }
    }
  }
  const detached = () => {
    owned = false
    pending.clear()
    if (!disposed) mark('详情采集已断开，基础列表仍可同步')
  }
  try {
    if (wc.debugger.isAttached()) mark('页面正在调试，详情采集暂不可用')
    else {
      wc.debugger.attach('1.3')
      owned = true
      wc.debugger.on('message', message)
      wc.debugger.on('detach', detached)
      void wc.debugger
        .sendCommand('Network.enable', {
          maxTotalBufferSize: 8 * 1024 * 1024,
          maxResourceBufferSize: 2 * 1024 * 1024
        })
        .catch(() => mark('详情采集启动失败，基础列表仍可同步'))
    }
  } catch {
    mark('详情采集启动失败，基础列表仍可同步')
  }
  return {
    status: () => ({ enabled: owned, error: captureError, matchedResponses, capturedJobs, lastSkip, observedJobPaths: [...observedJobPaths] }),
    clear: () => pending.clear(),
    dispose: () => {
      disposed = true
      pending.clear()
      wc.debugger.removeListener('message', message)
      wc.debugger.removeListener('detach', detached)
      if (owned && !wc.isDestroyed() && wc.debugger.isAttached()) wc.debugger.detach()
    }
  }
}
