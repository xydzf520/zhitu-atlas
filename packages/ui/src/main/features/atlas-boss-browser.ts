import { AtlasContactWorker, NativeContactAdapter } from './atlas-contact-native'
import { BrowserWindow, WebContentsView, session, ipcMain, dialog } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { atlasRoot } from './atlas-store'
import { AtlasDiscoveryCollector } from './atlas-discovery-collector'
import { AtlasBossAccountSync } from './atlas-boss-account-sync'
import { readBossSync } from './career-boss-data'
import { recordBossNavigation, readBossNavigation } from './atlas-boss-navigation'
import { saveBossSnapshot } from './career-boss-data'
import { readBossPageSnapshot } from './career-data-sync'
import { writeLocalJson } from './career-reply-store'
import { attachBossResponseCapture } from './atlas-boss-capture'
import { bossSyncCoverage, ingestBossJobs, ingestBossPublicJobs } from './atlas-boss-sync'
import { attachNativeReply } from './atlas-boss-reply'
import {
  BOSS_CHAT_URL,
  isBossUrl,
  bossViewBounds,
  bossCookieForImport,
  type BossBrowserStatus
} from '../../common/boss-browser'

export class AtlasBossBrowser {
  private view: WebContentsView | null = null
  private opening: Promise<void> | null = null
  private active = false
  private occluded = false
  private syncing = false
  private bounds = { x: 218, y: 160, width: 0, height: 0 }
  private timer?: ReturnType<typeof setInterval>
  private error = ''
  private pendingUrl = ''
  private navigation: Promise<void> | null = null
  private sessionSource: BossBrowserStatus['session'] = 'new'
  private syncState: BossBrowserStatus['sync'] = 'waiting'
  private accountName = ''
  private loadedCount = 0
  private accountId = ''
  private accountEpoch = 0
  private capture?: ReturnType<typeof attachBossResponseCapture>
  private stopReplies?: () => void
  private accountSync?: AtlasBossAccountSync
  private discovery?: AtlasDiscoveryCollector
  private contact?: AtlasContactWorker
  private humanEpoch = 0
  private humanAt = 0
  private separateWindows = new Set<BrowserWindow>()
  constructor(private window: BrowserWindow) {
    // Resume reads from the persisted session after restart, even before the user opens the BOSS tab.
    // The collector verifies the account in its own page before accepting any data.
    this.accountSync = new AtlasBossAccountSync(session.fromPartition('persist:atlas-boss'), () =>
      this.syncState === 'login-required' ? '' : this.accountId || readBossSync()?.account.id || ''
    )
    this.discovery = new AtlasDiscoveryCollector(session.fromPartition('persist:atlas-boss'), () =>
      this.syncState === 'login-required' ? '' : this.accountId || readBossSync()?.account.id || '', true, () => this.humanBusy()
    )
    this.contact = new AtlasContactWorker(new NativeContactAdapter(session.fromPartition('persist:atlas-boss'), async () => ({
      busy: await this.humanBusy(), epoch: this.humanEpoch
    })))
    window.on('resize', () => this.layout())
    window.on('closed', () => this.dispose())
    // Route changes hide the native view before the next Vue layout arrives.
    window.webContents.on('did-navigate-in-page', () => {
      if (!this.onBossRoute()) this.hide()
    })
    window.webContents.on('did-start-loading', () => this.hide())
    window.webContents.on('render-process-gone', () => this.hide())
  }
  private async humanBusy() {
    if (Date.now() - this.humanAt < 15000) return true
    const contents = [this.view?.webContents, ...[...this.separateWindows].filter(w => !w.isDestroyed()).map(w => w.webContents)]
    for (const wc of contents) {
      if (!wc || wc.isDestroyed()) continue
      if (wc.isLoadingMainFrame()) return true
      try { if ((await wc.executeJavaScript(`(${readBossPageSnapshot.toString()})()`)).draftActive) return true }
      catch { return true }
    }
    return false
  }
  async openSeparate(url = BOSS_CHAT_URL) {
    if (!isBossUrl(url)) throw Error('仅支持 BOSS 站内 HTTPS 地址')
    const popup = new BrowserWindow({ title: 'BOSS · 职途 Atlas', width: 1280, height: 900,
      webPreferences: { session: session.fromPartition('persist:atlas-boss'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } })
    this.separateWindows.add(popup)
    const wc = popup.webContents
    const input = () => { this.humanAt = Date.now(); this.humanEpoch++ }
    wc.on('before-input-event', input); wc.on('before-mouse-event', input)
    wc.on('will-navigate', (event, target) => { if (!isBossUrl(target)) event.preventDefault() })
    wc.setWindowOpenHandler(({ url: target }) => { if (isBossUrl(target)) void wc.loadURL(target); return { action: 'deny' } })
    let busy = false, account = '', epoch = 0
    const capture = attachBossResponseCapture(wc, async () => {
      if (wc.isDestroyed() || !isBossUrl(wc.getURL())) return { id: '', epoch }
      const snapshot = await wc.executeJavaScript(`(${readBossPageSnapshot.toString()})()`)
      const id = snapshot.account?.id || ''
      if (account !== id) { account = id; epoch++ }
      return { id, epoch }
    }, async () => sync())
    const sync = async () => {
      if (busy || wc.isDestroyed() || wc.isLoadingMainFrame() || !isBossUrl(wc.getURL())) return
      busy = true
      try {
        const snapshot = await wc.executeJavaScript(`(${readBossPageSnapshot.toString()})()`)
        ingestBossPublicJobs(snapshot.publicJobs)
        if (snapshot.account?.id) {
          saveBossSnapshot(snapshot)
          if (snapshot.jobDetail) ingestBossJobs(snapshot.account.id, { code: 0, zpData: snapshot.jobDetail }, '/wapi/zpgeek/job/detail.json')
        }
        recordBossNavigation(wc.getURL())
      } catch { /* An incomplete page is never treated as a synchronized account. */ }
      finally { busy = false }
    }
    const timer = setInterval(() => void sync(), 7000)
    wc.on('did-finish-load', sync)
    popup.once('closed', () => { capture.dispose(); clearInterval(timer); this.separateWindows.delete(popup) })
    await wc.loadURL(url)
    return { sharedSession: true }
  }
  private onBossRoute() {
    return (
      !this.window.isDestroyed() && !!this.window.webContents &&
      this.window.webContents.getURL().split('#')[1]?.split('?')[0] === '/main-layout/CareerBoss'
    )
  }
  private recordPage(url: string) {
    try {
      recordBossNavigation(url)
    } catch {
      this.error = '页面地址记录失败，已保留当前 BOSS 页面。'
    }
  }
  private async create() {
    if (this.view?.webContents && !this.view.webContents.isDestroyed()) return
    const stored = session.fromPartition('persist:atlas-boss')
    stored.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    stored.setPermissionCheckHandler(() => false)
    const existing = (await stored.cookies.get({})).filter((cookie) =>
      isBossUrl(`https://${(cookie.domain || '').replace(/^\./, '')}/`)
    )
    if (existing.length) this.sessionSource = 'existing'
    else {
      try {
        const cookies = JSON.parse(
          fs.readFileSync(path.join(atlasRoot(), 'storage/boss-cookies.json'), 'utf8')
        )
        if (Array.isArray(cookies))
          for (const raw of cookies.slice(0, 500)) {
            const cookie = bossCookieForImport(raw)
            if (cookie) {
              await stored.cookies.set(cookie)
              this.sessionSource = 'imported'
            }
          }
      } catch {
        /* No stored credentials: display the site's own login page. */
      }
    }
    if (this.window.isDestroyed()) return
    const view = (this.view = new WebContentsView({
      webPreferences: {
        session: stored,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
        navigateOnDragDrop: false
      }
    }))
    view.setBackgroundColor('#ffffff')
    view.setVisible(false)
    this.window.contentView.addChildView(view)
    const wc = view.webContents
    wc.on('before-input-event',()=>{this.humanEpoch++;this.humanAt=Date.now()})
    wc.on('before-mouse-event',()=>{this.humanEpoch++;this.humanAt=Date.now()})
    this.stopReplies = attachNativeReply(wc)
    this.capture = attachBossResponseCapture(
      wc,
      async () => {
        if (wc.isDestroyed() || !isBossUrl(wc.getURL())) return { id: '', epoch: this.accountEpoch }
        const snapshot = await wc.executeJavaScript(`(${readBossPageSnapshot.toString()})()`)
        const id = snapshot.account?.id || ''
        if (id !== this.accountId) {
          this.accountId = id
          this.accountEpoch++
          this.capture?.clear()
        }
        if (id) saveBossSnapshot(snapshot)
        return { id, epoch: this.accountEpoch }
      },
      async () => {
        await this.sync()
      }
    )
    const rejectOutside = (event: Electron.Event, url: string) => {
      if (!isBossUrl(url)) {
        event.preventDefault()
        this.error = '该链接不属于 BOSS，已保留当前页面。'
      }
    }
    wc.on('will-navigate', rejectOutside)
    wc.on('did-navigate', (_event, url) => {
      this.recordPage(url)
    })
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) this.recordPage(url)
    })
    wc.on('will-redirect', rejectOutside)
    wc.setWindowOpenHandler(({ url }) => {
      if (isBossUrl(url)) void this.navigate(url)
      else this.error = '该链接不属于 BOSS，已保留当前页面。'
      return { action: 'deny' }
    })
    wc.on('did-start-loading', () => {
      this.error = ''
      this.syncState = 'waiting'
      this.accountEpoch++
      this.capture?.clear()
    })
    wc.on('did-fail-load', (_e, code, _description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.error = `BOSS 页面加载失败（${code}），可手动重试。`
    })
    wc.on('render-process-gone', () => {
      this.error = 'BOSS 页面已停止运行，请手动重新加载。'
    })
    wc.on('dom-ready', () => {
      this.recordPage(wc.getURL())
      void this.sync()
    })
    wc.on('did-finish-load', () => {
      void this.sync()
    })
    this.timer = setInterval(() => {
      void this.sync()
    }, 10000)
    this.timer.unref()
  }
  async open(url?: string) {
    if (url !== undefined && !isBossUrl(url)) throw Error('仅支持 BOSS 站内 HTTPS 地址')
    if (!this.opening)
      this.opening = this.create().finally(() => {
        this.opening = null
      })
    await this.opening
    const wc = this.view?.webContents
    if (!wc || wc.isDestroyed()) throw Error('BOSS 页面尚未就绪')
    this.active = true
    this.layout()
    // Opening the same page or re-entering the workspace never reloads the site.
    if (!wc.getURL()) await this.navigate(url || BOSS_CHAT_URL)
    else if (url && url !== wc.getURL()) await this.navigate(url)
    return this.status()
  }
  async navigate(url: string) {
    if (!isBossUrl(url)) throw Error('仅支持 BOSS 站内 HTTPS 地址')
    const wc = this.view?.webContents
    if (!wc || wc.isDestroyed()) throw Error('请先打开 BOSS 工作台')
    if (this.pendingUrl === url && this.navigation) return this.navigation
    if (wc.getURL() === url && !this.navigation) return
    this.pendingUrl = url
    const navigation = wc.loadURL(url).catch((e: any) => {
      if (e?.code !== 'ERR_ABORTED' && this.pendingUrl === url)
        this.error = 'BOSS 页面加载失败，可手动重试。'
    })
    this.navigation = navigation
    try {
      await navigation
    } finally {
      if (this.navigation === navigation) {
        this.pendingUrl = ''
        this.navigation = null
      }
    }
  }

  setBounds(value: any) {
    const [width, height] = this.window.getContentSize()
    this.bounds = bossViewBounds(value, width, height)
    this.layout()
  }
  private layout() {
    if (!this.view?.webContents || this.window.isDestroyed() || !this.window.webContents || this.view.webContents.isDestroyed()) return
    const [width, height] = this.window.getContentSize()
    const bounds = bossViewBounds(this.bounds, width, height)
    this.view.setBounds(bounds)
    this.view.setVisible(
      this.active && !this.occluded && this.onBossRoute() && bounds.width > 0 && bounds.height > 0
    )
  }
  hide() {
    this.active = false
    this.layout()
  }
  overlay(value: boolean) {
    this.occluded = value
    this.layout()
  }
  async action(value: string) {
    const wc = this.view?.webContents
    if (!wc || wc.isDestroyed()) throw Error('请先打开 BOSS 工作台')
    if (value === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    else if (value === 'forward' && wc.navigationHistory.canGoForward())
      wc.navigationHistory.goForward()
    else if (value === 'reload') {
      // Native confirmation remains visible above the embedded website.
      const answer = await dialog.showMessageBox(this.window, {
        type: 'question',
        title: '重新加载 BOSS',
        message: '重新加载会丢失 BOSS 页面中尚未发送或保存的内容。',
        buttons: ['取消', '重新加载'],
        defaultId: 0,
        cancelId: 0
      })
      if (answer.response === 1) wc.reload()
    } else if (value === 'sync') await this.sync()
    return this.status()
  }
  private async sync() {
    const wc = this.view?.webContents
    if (this.syncing || !wc || wc.isDestroyed() || wc.isLoadingMainFrame()) return
    const url = wc.getURL()
    if (!isBossUrl(url)) {
      this.syncState = 'waiting'
      return
    }
    this.syncing = true
    try {
      const snapshot = await wc.executeJavaScript(`(${readBossPageSnapshot.toString()})()`)
      if (this.view?.webContents !== wc || wc.isDestroyed() || wc.getURL() !== url) return
      const publicResult = ingestBossPublicJobs(snapshot.publicJobs)
      if (!snapshot.account?.id) {
        if (!url.startsWith(BOSS_CHAT_URL)) {
          this.syncState = 'job-detail'
          writeLocalJson('career-data-heartbeat.json', {
            at: new Date().toISOString(),
            state: 'job-detail',
            diagnostics: snapshot.diagnostics,
            publicJobsSaved: publicResult.saved,
            capture: this.capture?.status()
          })
          return
        }
        if (this.accountId) {
          this.accountId = ''
          this.accountEpoch++
          this.capture?.clear()
        }
        this.syncState = 'login-required'
        this.accountName = ''
        this.loadedCount = 0
        writeLocalJson('career-data-heartbeat.json', {
          at: new Date().toISOString(),
          state: 'login-required'
        })
        return
      }
      if (this.accountId !== snapshot.account.id) {
        this.accountId = snapshot.account.id
        this.accountEpoch++
      }
      const saved = saveBossSnapshot(snapshot)
      if (snapshot.jobDetail)
        ingestBossJobs(
          snapshot.account.id,
          { code: 0, zpData: snapshot.jobDetail },
          '/wapi/zpgeek/job/detail.json'
        )
      this.syncState = 'connected'
      this.accountName = saved?.account.name || ''
      this.loadedCount = snapshot.items.length
      writeLocalJson('career-data-heartbeat.json', {
        at: new Date().toISOString(),
        state: 'connected',
        userId: snapshot.account.id,
        loadedCount: snapshot.items.length,
        totalCount: new Set((saved?.items || []).map((item) => item.bossId)).size,
        diagnostics: snapshot.diagnostics,
        draftActive: snapshot.draftActive,
        capture: this.capture?.status()
      })
    } catch {
      this.syncState = 'error'
      writeLocalJson('career-data-heartbeat.json', {
        at: new Date().toISOString(),
        state: 'error',
        error: '页面结构或登录状态变化，保留已有数据'
      })
    } finally {
      this.syncing = false
    }
  }
  status(): BossBrowserStatus {
    const wc = this.view?.webContents,
      ready = wc && !wc.isDestroyed()
    const currentAccount = this.accountId || readBossSync()?.account.id || ''
    return {
      created: !!ready,
      loading: ready ? wc.isLoadingMainFrame() : false,
      url: ready ? wc.getURL() : '',
      title: ready ? wc.getTitle() : '',
      canGoBack: ready ? wc.navigationHistory.canGoBack() : false,
      canGoForward: ready ? wc.navigationHistory.canGoForward() : false,
      error: this.error,
      session: this.sessionSource,
      sync: this.syncState,
      accountName: this.accountName,
      loadedCount: this.loadedCount,
      coverage: currentAccount ? bossSyncCoverage(currentAccount) : undefined,
      capture: this.capture?.status(),
      recordedPage: readBossNavigation().current
    }
  }
  dispose() {
    for (const popup of this.separateWindows) if (!popup.isDestroyed()) popup.close()
    this.separateWindows.clear()
    this.contact?.dispose()
    this.contact=undefined
    this.discovery?.dispose()
    this.discovery = undefined
    this.accountSync?.dispose()
    this.accountSync = undefined
    if (this.timer) clearInterval(this.timer)
    this.capture?.dispose()
    this.capture = undefined
    this.stopReplies?.()
    this.stopReplies = undefined
    const view = this.view
    this.view = null
    if (view && !this.window.isDestroyed() && this.window.contentView.children.includes(view))
      this.window.contentView.removeChildView(view)
    if (view?.webContents && !view.webContents.isDestroyed())
      view.webContents.close({ waitForBeforeUnload: false })
  }
}

export function initAtlasBossBrowser(window: BrowserWindow) {
  const browser = new AtlasBossBrowser(window)
  const check = (event: IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      throw Error('该操作仅允许工作台主窗口调用')
    return browser
  }
  ipcMain.handle('atlas-boss-open', (event, payload) => check(event).open(payload?.url))
  ipcMain.handle('atlas-boss-layout', (event, payload) => {
    check(event).setBounds(payload)
    return true
  })
  ipcMain.handle('atlas-boss-hide', (event) => {
    check(event).hide()
    return true
  })
  ipcMain.handle('atlas-boss-overlay', (event, visible) => {
    check(event).overlay(!!visible)
    return true
  })
  ipcMain.handle('atlas-boss-status', (event) => check(event).status())
  ipcMain.handle('atlas-boss-action', (event, value) => check(event).action(String(value)))
  ipcMain.handle('atlas-open-boss', (event, payload) => {
    check(event)
    const url = payload?.url || BOSS_CHAT_URL
    if (!isBossUrl(url)) throw Error('仅支持 BOSS 站内 HTTPS 地址')
    window.webContents.send('atlas-boss-open-request', { url })
    return { embedded: true }
  })
  return browser
}
