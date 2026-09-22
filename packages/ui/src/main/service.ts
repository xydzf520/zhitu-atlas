import { startAtlasServer } from './features/atlas-server'
import { prepareInstallation } from './features/atlas-installation'
import path from 'node:path'

async function run() {
  await prepareInstallation()
  const server = await startAtlasServer(path.resolve(__dirname, '../../web-dist'))
  const parent = (process as any).parentPort
  parent?.postMessage({ type: 'ready' })
  let closing = false
  const close = () => {
    if (closing) return
    closing = true
    server.close(() => process.exit(0))
    server.closeIdleConnections()
    setTimeout(() => process.exit(0), 8000).unref()
  }
  parent?.on('message', (event: any) => {
    if (event.data?.type === 'shutdown') close()
  })
  process.on('SIGTERM', close)
  process.on('SIGINT', close)
}
run().catch((error: any) => {
  ;(process as any).parentPort?.postMessage({
    type: 'failed',
    message:
      error.code === 'EADDRINUSE'
        ? '本机端口已占用，请退出旧版后台后重试。'
        : '后台启动失败，原资料已保留。'
  })
  process.exitCode = 1
})
