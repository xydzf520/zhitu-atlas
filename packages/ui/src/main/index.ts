import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  shell,
  utilityProcess,
  type UtilityProcess
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { prepareInstallation, installationRoot } from './features/atlas-installation'
import { assertPrivateLocation } from './features/atlas-local-config'
import { invokeAtlas, runtimeFile } from './features/atlas-server'
import { initAtlasBossBrowser } from './features/atlas-boss-browser'
import { isBusinessChannel, publicLink } from '../common/desktop-bridge'
import { PRODUCT_NAME } from '../common/brand'

let window: BrowserWindow | null = null
let backend: UtilityProcess | null = null
let quitting = false
let recovery = 0
const bootTime = Date.now()
app.setName('zhitu-atlas')
assertPrivateLocation(installationRoot() + '-desktop')
fs.mkdirSync(installationRoot() + '-desktop', { recursive: true, mode: 0o700 })
fs.chmodSync(installationRoot() + '-desktop', 0o700)
app.setPath('userData', installationRoot() + '-desktop')
// The single-instance lock includes the selected data directory.
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.show()
    window?.focus()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    quitting = true
    backend?.postMessage({ type: 'shutdown' })
    setTimeout(() => backend?.kill(), 9000).unref()
  })
  app
    .whenReady()
    .then(boot)
    .catch(() => {
      void dialog
        .showMessageBox({
          type: 'error',
          title: PRODUCT_NAME,
          message: '工作台未能启动',
          detail: '原资料已保留。请退出旧版后台，检查本机服务端口（默认 5178）后重新打开。'
        })
        .then(() => app.quit())
    })
}
async function ensureBackend() {
  try {
    const file = JSON.parse(fs.readFileSync(runtimeFile(), 'utf8'))
    if (file.protocol === 2 && (await invokeAtlas('career-runtime-status')).protocol === 2) return
  } catch {
    /* A stale runtime file cannot prevent a fresh service from binding its port. */
  }
  await new Promise<void>((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'service.js'), [], {
      serviceName: 'Atlas local service',
      stdio: 'pipe',
      env: { ...process.env, ATLAS_DATA_ROOT: installationRoot() }
    })
    backend = child
    let ready = false
    const timer = setTimeout(() => {
      child.kill()
      reject(Error('后台启动超时'))
    }, 20000)
    child.on('message', (message) => {
      if (message?.type === 'ready') {
        ready = true
        clearTimeout(timer)
        resolve()
      }
      if (message?.type === 'failed') {
        clearTimeout(timer)
        reject(Error(message.message))
      }
    })
    // Never forward arbitrary backend stdout (which could contain user data) to the UI.
    child.stdout?.resume()
    child.stderr?.resume()
    child.once('exit', () => {
      clearTimeout(timer)
      if (backend === child) backend = null
      if (!ready) reject(Error('后台启动失败'))
      else if (!quitting && recovery++ < 2) {
        window?.webContents.send('atlas-runtime-error', '后台正在恢复，未确认的发送不会重试。')
        setTimeout(
          () =>
            void ensureBackend().catch(() =>
              window?.webContents.send(
                'atlas-runtime-error',
                '后台连接失败，请保存草稿并重新打开工作台。'
              )
            ),
          1500
        )
      }
    })
  })
}
function trusted(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw Error('仅允许工作台主窗口调用')
}
async function boot() {
  await prepareInstallation()
  await ensureBackend()
  Menu.setApplicationMenu(null)
  window = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1540,
    height: 980,
    minWidth: 1050,
    minHeight: 680,
    show: false,
    backgroundColor: '#f4f7fb',
    icon: path.join(app.getAppPath(), 'resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  ipcMain.handle('atlas:rpc', (event, request) => {
    trusted(event)
    if (
      !isBusinessChannel(request?.channel) ||
      JSON.stringify(request.payload ?? null).length > 48 * 1024 * 1024
    )
      throw Error('请求不受支持')
    return invokeAtlas(request.channel, request.payload)
  })
  ipcMain.handle('career-copy-text', (event, value) => {
    trusted(event)
    if (typeof value !== 'string' || value.length > 500000) throw Error('复制内容无效')
    clipboard.writeText(value)
  })
  ipcMain.handle('atlas-runtime-info', (event) => {
    trusted(event)
    return {
      version: app.getVersion(),
      startedAt: new Date(bootTime).toISOString(),
      dataRoot: installationRoot(),
      backend: backend ? 'managed' : 'shared',
      browser: '内置 Chromium · 同一 BOSS 会话'
    }
  })
  ipcMain.on('open-external-link', (event, value) => {
    trusted(event)
    const url = publicLink(value)
    if (url) void shell.openExternal(url)
  })
  const browser = initAtlasBossBrowser(window)
  ipcMain.handle('atlas-open-workspace-window', (event, input) => {
    trusted(event)
    return browser.openSeparate(input?.url)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    const safe = publicLink(url)
    if (safe) void shell.openExternal(safe)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => {
    window = null
  })
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged)
    await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(path.join(__dirname, '../renderer/index.html'))
}
