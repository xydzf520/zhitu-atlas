import { allAutomationPaused } from './atlas-policy'
import { BrowserWindow, type Session } from 'electron'
import { readBossPageSnapshot } from './career-data-sync'
import { readBossSync, saveBossSnapshot } from './career-boss-data'
import { ingestBossPublicJobs } from './atlas-boss-sync'
import { atlasDb } from './atlas-store'
import { acquireLease, releaseLease, keepLeaseAlive } from './atlas-tasks'
import { accountSyncSettings, accountSyncState, updateAccountSync, bossJobReadState, recordBossJobRead } from './atlas-boss-account-state'
import { BOSS_CHAT_URL, isBossUrl } from '../../common/boss-browser'

// Only operates in a dedicated collector view. No sends, attachment actions,
// authentication tricks or private API requests; the user's view is untouched.
export function stepBossAccountPage(input: { account: string; action: string; bossId?: string }) {
  const user = (document.querySelector('.main-wrap') as any)?.__vue__?.$store?.state?.userInfo
  if (!input.account || user?.encryptUserId !== input.account) return 'account-changed'
  if (document.querySelector('.chat-input')?.textContent?.trim()) return 'draft'
  const scroller = (document.querySelector('.main-wrap .chat-user .user-list-content') as any)?.__vue__
  if (input.action === 'more-contacts') {
    if (typeof scroller?.scrollToBottom !== 'function') return 'unsupported'
    scroller.scrollToBottom()
    return 'loading'
  }
  if (input.action === 'select') {
    const list = (document.querySelector('.main-wrap .chat-user') as any)?.__vue__?.list
    if (!Array.isArray(list)) return 'unsupported'
    const index = list.findIndex((item: any) => item.encryptBossId === input.bossId)
    if (index < 0) return 'missing'
    const target = Array.from(document.querySelectorAll('.main-wrap .chat-user .user-list-content ul[role=group] li[role=listitem]'))
      .find((el: any) => el.__vue__?.source?.encryptBossId === input.bossId) as HTMLElement | undefined
    if (!target) {
      if (typeof scroller?.scrollToIndex !== 'function') return 'unsupported'
      scroller.scrollToIndex(index)
      return 'scrolling'
    }
    // The virtual LI is a wrapper; BOSS binds selection to its nested card.
    // Dispatch at the visible card content so the real handler receives it.
    target.scrollIntoView({ block: 'nearest' })
    const rect = target.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width * 0.45, rect.top + rect.height / 2) as HTMLElement | null
    if (!hit || !target.contains(hit)) return 'obscured'
    hit.click()
    return 'selected'
  }
  if (input.action === 'history') {
    const selected = (document.querySelector('.chat-conversation') as any)?.__vue__?.selectedFriend$
    const header = (document.querySelector('.chat-conversation .chat-record') as any)?.__vue__?.boss
    if (!input.bossId || selected?.encryptBossId !== input.bossId || header?.encryptBossId !== input.bossId) return 'identity-changed'
    let el = document.querySelector('.message-content .chat-record') as HTMLElement | null
    while (el && !el.classList.contains('chat-conversation')) {
      if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) {
        el.scrollTop = 0
        el.dispatchEvent(new Event('scroll'))
        return 'loading'
      }
      el = el.parentElement
    }
    return 'no-scroll'
  }
  return 'unsupported'
}

export class AtlasBossAccountSync {
  private view?: BrowserWindow
  private timer?: ReturnType<typeof setInterval>
  private busy = false
  private disposed = false
  private owner = ''
  private account = ''
  private blocked = false
  private retry = ''
  private loadingAt = 0
  private nextRoundAt = 0
  private scanned = new Set<string>()
  private completed = 0
  private listCount = -1
  private stagnantList = 0
  private listDone = false
  private listComplete = false
  private target = ''
  private attempts = 0
  private historySignature = ''
  private stagnantHistory = 0
  private historyPages = 0
  private detailTarget = ''
  private failed = 0
  constructor(private session: Session, private currentAccount: () => string, autoStart = true) {
    if (autoStart) {
      this.timer = setInterval(() => void this.tick(), 5000)
      this.timer.unref()
    }
  }
  private report(state: string, message: string, extra: any = {}) {
    updateAccountSync(this.account, { state, message, visited: this.completed, processed: this.scanned.size, failed: this.failed, ...extra })
  }
  private closeView() {
    if (this.view && !this.view.isDestroyed()) this.view.destroy()
    this.view = undefined
    if (this.owner) releaseLease('collect:boss:' + this.account, this.owner)
    this.owner = ''
  }
  private async load(url: string) {
    this.loadingAt = Date.now()
    await this.view!.webContents.loadURL(url)
  }
  private async snapshot() {
    return this.view!.webContents.executeJavaScript(`(${readBossPageSnapshot.toString()})()`)
  }
  private async step(action: string, bossId = this.target) {
    const result = await this.view!.webContents.executeJavaScript(`(${stepBossAccountPage.toString()})(${JSON.stringify({ account: this.account, action, bossId })})`)
    updateAccountSync(this.account, { lastStep: action + ':' + result })
    return result
  }
  private async begin() {
    this.owner = acquireLease('collect:boss:' + this.account, 30000) || ''
    if (!this.owner) return
    this.view = new BrowserWindow({ show: false, width: 1280, height: 900, skipTaskbar: true, webPreferences: { session: this.session, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false } })
    const wc = this.view.webContents
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    const guard = (event: Electron.Event, url: string) => { if (!isBossUrl(url)) event.preventDefault() }
    wc.on('will-navigate', guard)
    wc.on('will-redirect', guard)
    this.scanned.clear(); this.completed = 0; this.failed = 0; this.target = ''; this.detailTarget = ''
    this.listCount = -1; this.stagnantList = 0; this.listDone = false; this.listComplete = false
    this.report('loading', '正在连接当前账号的后台消息页', { startedAt: new Date().toISOString(), nextAt: '', lastError: '' })
    await this.load(BOSS_CHAT_URL)
  }
  private finishConversation(reason: string, verified = true) {
    const db = atlasDb(), row = db.prepare("SELECT body FROM platform_conversations WHERE platform='boss' AND account_id=? AND source_id=?").get(this.account, this.target)
    if (row) db.prepare("UPDATE platform_conversations SET body=? WHERE platform='boss' AND account_id=? AND source_id=?")
      .run(JSON.stringify({ ...JSON.parse(row.body), ...(verified ? { autoReadAt: new Date().toISOString(), autoReadVersion: 3 } : {}), autoReadVerified: verified, autoReadReason: reason }), this.account, this.target)
    this.scanned.add(this.target)
    if (verified) this.completed++
    this.target = ''; this.attempts = 0; this.stagnantHistory = 0; this.historyPages = 0; this.historySignature = ''
  }
  async tick() {
    if (allAutomationPaused()) { this.closeView(); return }
    if (this.busy || this.disposed) return
    this.busy = true
    let browserOwner: string | null = null, browserKey = '', stopBrowser: (()=>void) | undefined
    try {
      const current = this.currentAccount()
      if (!accountSyncSettings().enabled || !current) {
        if (this.account) this.report(!current ? 'waiting' : 'paused', !current ? '等待前台登录账号核实' : '自动补齐已暂停，保留已有数据')
        this.closeView(); return
      }
      if (current !== this.account) {
        this.closeView(); this.account = current; this.blocked = false; this.nextRoundAt = 0
      }
      const retry = accountSyncState(this.account).retryRequestedAt || ''
      if (retry !== this.retry) { this.retry = retry; this.blocked = false; this.nextRoundAt = 0; this.closeView() }
      if (this.blocked) return
      if (Date.now() < this.nextRoundAt) { this.report('idle', '本轮已结束，等待增量检查', { nextAt: new Date(this.nextRoundAt).toISOString() }); return }
      browserKey='browser:boss:'+current; browserOwner=acquireLease(browserKey,90000); if (!browserOwner) return
      stopBrowser=keepLeaseAlive(browserKey,browserOwner,()=>this.closeView())
      if (!this.view || this.view.webContents.isDestroyed()) { await this.begin(); return }
      const renewed = atlasDb().prepare('UPDATE leases SET expires_at=? WHERE key=? AND owner=? AND expires_at>?')
        .run(Date.now() + 30000, 'collect:boss:' + this.account, this.owner, Date.now()).changes
      if (!renewed) { this.closeView(); return }
      const wc = this.view.webContents
      if (wc.isLoadingMainFrame()) {
        if (Date.now() - this.loadingAt > 45000) throw Error('页面加载超时')
        return
      }
      const snapshot = await this.snapshot()
      if (allAutomationPaused() || !accountSyncSettings().enabled || this.currentAccount() !== this.account || readBossSync()?.account.id !== this.account) { this.closeView(); return }
      if (this.detailTarget) {
        if (new URL(wc.getURL()).pathname !== `/job_detail/${encodeURIComponent(this.detailTarget)}.html`) {
          recordBossJobRead(this.account, this.detailTarget, { state: 'blocked', reason: '职位页面发生跳转，可能需要登录或平台检查；保留已有数据' })
          throw Error('职位页面发生跳转，已停止本轮读取')
        }
        const result = ingestBossPublicJobs(snapshot.publicJobs)
        recordBossJobRead(this.account, this.detailTarget, { state: result.saved ? 'observed' : 'unavailable', reason: result.saved ? '已读取职位页；未展示的字段保持待补充' : '职位页未返回可识别内容，可能已下架或页面结构变化；可重新同步核实' })
        this.report('details', result.saved ? '岗位与地址已补齐' : '岗位暂未返回可识别详情，已记录缺失')
        this.detailTarget = ''
        await this.load(BOSS_CHAT_URL)
        return
      }
      if (!snapshot.account?.id || snapshot.account.id !== this.account || !snapshot.listAvailable) {
        if (Date.now() - this.loadingAt < 20000 && !snapshot.account?.id) return
        this.report('blocked', '后台页面需要登录核实或平台检查；已停止，前台页面保持不变')
        this.blocked = true; this.closeView(); return
      }
      this.listComplete ||= snapshot.listFinished
      saveBossSnapshot({ ...snapshot, collector: true })
      const known = readBossSync()?.items || []
      this.report('syncing', this.target ? '正在补齐会话正文和更早消息' : '正在读取账号联系人', { discovered: new Set(known.map(c => c.bossId)).size, listFinished: this.listComplete, diagnostics: snapshot.diagnostics })
      if (!this.listDone) {
        const count = snapshot.items.length
        this.stagnantList = count === this.listCount ? this.stagnantList + 1 : 0
        this.listCount = count
        if (snapshot.listFinished || count >= 5000 || this.stagnantList >= 3) this.listDone = true
        else {
          const step = await this.step('more-contacts')
          if (step !== 'loading') this.listDone = true
          return
        }
      }
      if (this.target) {
        const conversation = snapshot.conversation
        if (conversation?.bossId !== this.target || !conversation.identityVerified) {
          if (++this.attempts > 4) {
            this.failed++; this.finishConversation('会话身份未能核实，待下轮补齐', false)
            if (this.failed >= 3) { this.report('blocked', '连续会话无法核实，已停止；请检查平台页面状态'); this.blocked = true; this.closeView() }
            return
          }
          await this.step('select'); return
        }
        const signature = conversation.messages.map((m: any) => m.mid).join('|')
        this.stagnantHistory = signature === this.historySignature ? this.stagnantHistory + 1 : 0
        this.historySignature = signature
        if (this.stagnantHistory >= 2 || this.historyPages >= 10 || conversation.messages.length >= 2000) {
          this.finishConversation('已读取页面可加载消息；完整历史总量未知'); return
        }
        const step = await this.step('history')
        this.historyPages++
        if (step === 'no-scroll') this.finishConversation('已读取当前消息；页面没有提供可滚动的历史区域')
        else if (step !== 'loading') { this.failed++; this.finishConversation('历史读取中断，已保留已采集正文') }
        return
      }
      // Checkpoints survive restarts. Revisit new summaries immediately and old
      // conversations at most once per hour; preserve the whole known index.
      const candidate = snapshot.items.find((item: any) => {
        if (!item.bossId || this.scanned.has(item.bossId)) return false
        const row = atlasDb().prepare("SELECT body FROM platform_conversations WHERE platform='boss' AND account_id=? AND source_id=?").get(this.account, item.bossId)
        const body = row ? JSON.parse(row.body) : {}
        return body.autoReadVersion !== 3 || body.autoReadVerified === false || !body.autoReadAt || (this.retry && body.autoReadAt < this.retry) || Date.now() - Date.parse(body.autoReadAt) > 3600000 || (body.lastMessageAt && body.lastMessageAt > body.autoReadAt)
      })
      if (candidate) { this.target = candidate.bossId; await this.step('select'); return }
      // One missing associated job per tick, on the same isolated view. Failed
      // pages are backoff tracked; neither visible URL nor navigation history changes.
      const job = known.find(item => {
        if (!item.encryptJobId) return false
        const row = atlasDb().prepare("SELECT body,detail_at FROM platform_jobs WHERE platform='boss' AND account_id=? AND source_id=?").get(this.account, item.encryptJobId)
        const data = row ? JSON.parse(row.body) : {}
        if (row?.detail_at && data.jobName && data.description && data.salaryLow > 0 && data.salaryHigh > 0 && data.address) return false
        const read = bossJobReadState(this.account, item.encryptJobId)
        return !read.at || read.version !== 3 || (this.retry && read.at < this.retry) || Date.now() - Date.parse(read.at) > 86400000
      })
      if (job) {
        recordBossJobRead(this.account, job.encryptJobId, { state: 'loading', reason: '正在读取关联职位页' })
        this.detailTarget = job.encryptJobId
        this.report('details', '正在补齐会话关联的岗位与地址')
        await this.load(`https://www.zhipin.com/job_detail/${encodeURIComponent(job.encryptJobId)}.html`)
        return
      }
      this.report('idle', '本轮可读取内容已入库；未返回的历史和字段保持待补齐', { completedAt: new Date().toISOString() })
      this.nextRoundAt = Date.now() + 15 * 60000
      this.closeView()
    } catch (error) {
      if (!this.disposed) {
        const reason = error instanceof Error && error.message === '页面加载超时' ? '页面加载超时，请检查网络后立即同步' : '页面读取中断，可能存在网络错误、登录检查或页面结构变化；可立即同步重试'
        if (this.detailTarget) recordBossJobRead(this.account, this.detailTarget, { state: 'error', reason })
        this.report('blocked', reason, { lastError: reason })
        this.blocked = true; this.closeView()
      }
    } finally { stopBrowser?.(); if(browserOwner) releaseLease(browserKey,browserOwner); this.busy = false }
  }
  dispose() {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    this.closeView()
  }
}
