import { DEEPSEEK_REQUEST_TIMEOUT_MS } from '../src/common/deepseek-policy'
/** Retry only an explicitly rejected session, never an uncertain mutation. */
export function createAtlasRpcClient(options: {
  token: () => string
  renew: () => Promise<void>
  fetch: typeof fetch
}) {
  let renewing: Promise<void> | undefined
  return async (channel: string, payload: unknown) => {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      /^career-(?:ai-analyze|discovery-analyze|greeting-generate)$/.test(channel)
        ? DEEPSEEK_REQUEST_TIMEOUT_MS + 15000
        : 30000
    )
    const request = () =>
      options.fetch('/atlas-api/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Atlas-Client': 'local-dashboard',
          'X-Atlas-Token': options.token()
        },
        body: JSON.stringify({ channel, payload }),
        signal: controller.signal
      })
    try {
      const before = options.token()
      let response = await request()
      if (response.status === 403) {
        // The server rejects credentials before dispatch. A retry here cannot
        // duplicate a save/send. Network errors and timeouts are never replayed.
        if (options.token() === before) {
          if (!renewing)
            renewing = options.renew().finally(() => {
              renewing = undefined
            })
          await renewing
        }
        response = await request()
      }
      const result = await response.json()
      if (!response.ok) throw Error(result.error || '本地数据服务连接失败')
      return result.data
    } catch (error: any) {
      if (error?.name === 'AbortError') throw Error('请求超时，请核对最新保存状态后重试。')
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}
