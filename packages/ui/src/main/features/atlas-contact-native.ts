import { jobLocation } from '../../common/regions'
import { BrowserWindow, type Session, type WebContents } from 'electron'
import {
  contactTick,
  contactApprovalCurrent,
  contactRun,
  recordPlatformContactLimit,
  platformContactLimit,
  enrollContacts,
  type ContactAdapter,
  type ContactProof
} from './atlas-contact'
import { readCareerReplyPage } from './career-auto-reply'
import { readBossPageSnapshot } from './career-data-sync'
import { discoveryAccount } from './atlas-discovery-state'
import { runtimePolicy } from './atlas-tasks'
import { allAutomationPaused } from './atlas-policy'
import { atlasWrite, atlasRead } from './atlas-store'
import { isBossUrl, BOSS_CHAT_URL } from '../../common/boss-browser'
import { discoverySearchUrl } from '../../common/discovery'
import { saveBossSnapshot } from './career-boss-data'
import { ingestBossJobs } from './atlas-boss-sync'
import { contactJobBasis, contactJob, contactMatch } from './atlas-contact'
import { normalizeBossJob } from '../../common/boss-sync'

// Runs only on normal authenticated BOSS pages. No send API replay or page reload loop.
export function readContactPage() {
  const docs = [document]
  for (const f of Array.from(document.querySelectorAll('iframe'))) {
    try {
      if (f.contentDocument && f.contentDocument.location.origin === location.origin)
        docs.push(f.contentDocument)
    } catch {}
  }
  for (const doc of docs) {
    const el = doc.querySelector('.job-detail-box') as any,
      v = el?.__vue__,
      data = v?.data
    if (!data?.jobInfo?.encryptId) continue
    const button = el.querySelector('.op-btn.op-btn-chat') as HTMLElement | null
    const text = (button?.innerText || button?.textContent || '').trim()
    const dialogs = Array.from(
      doc.querySelectorAll('[role=dialog],.dialog-wrap,.greet-boss-dialog,.chat-block-dialog')
    )
      .filter((e: any) => e.getBoundingClientRect().width > 0)
      .map((e) => e.textContent || '')
      .join(' ')
    const unsafe = /发送简历|附件简历|投递简历|提交申请|确认面试|立即申请|交换电话|交换微信/.test(
      dialogs + ' ' + text
    )
    return {
      accountId:
        v.$store?.state?.userInfo?.encryptUserId ||
        (document.querySelector('.main-wrap') as any)?.__vue__?.$store?.state?.userInfo
          ?.encryptUserId ||
        (document.querySelector('.page-jobs-main') as any)?.__vue__?.$store?.state?.userInfo
          ?.encryptUserId ||
        '',
      jobId: data.jobInfo.encryptId,
      recruiterId: data.bossInfo?.encryptBossId || '',
      buttonText: text,
      unsafe,
      blocked: !!doc.querySelector('.geetest_panel,.captcha-container,.verify-page')
    }
  }
  return {
    accountId: '',
    jobId: '',
    recruiterId: '',
    buttonText: '',
    unsafe: false,
    blocked: !!document.querySelector('.geetest_panel,.captcha-container,.verify-page')
  }
}
export class NativeContactAdapter implements ContactAdapter {
  private view?: BrowserWindow
  private epoch = 0
  private inspectedEpoch = 0
  private disposed = false
  private lastTarget = ''
  private expected: any
  constructor(
    private session: Session,
    private humanState: () => Promise<{ busy: boolean; epoch: number }>
  ) {}
  private wc(): WebContents {
    if (this.disposed) throw Error('自动联系执行器已停止')
    if (!this.view || this.view.isDestroyed()) {
      this.view = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        skipTaskbar: true,
        webPreferences: {
          session: this.session,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          backgroundThrottling: false
        }
      })
      this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      const guard = (e: Electron.Event, url: string) => {
        if (!isBossUrl(url)) e.preventDefault()
      }
      this.view.webContents.on('will-navigate', guard)
      this.view.webContents.on('will-redirect', guard)
      this.view.webContents.on('before-input-event', () => this.epoch++)
    }
    return this.view.webContents
  }
  private async evaluate(script: string) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([this.wc().executeJavaScript(script), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('BOSS 页面响应超时，停止本次操作并保留待核验结果')), 15000)
      })])
    } finally { if (timer) clearTimeout(timer) }
  }
  private async check(row: any) {
    if (!contactApprovalCurrent(contactRun(row.id))) throw Error('话术尚未经本人确认或确认已失效')
    if (!row.body.openedAt && platformContactLimit(row.account_id).state === 'exhausted') throw Error('BOSS 今日开聊额度已用完，停止新增联系')
    const wc = this.view?.webContents
    if (wc && !wc.isDestroyed() && isBossUrl(wc.getURL()) && !wc.isLoadingMainFrame()) {
      const notice = await this.evaluate(`(() => [...document.querySelectorAll('[role=dialog],.dialog-wrap,.greet-boss-dialog,.chat-block-dialog,.toast,.toast-wrap')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.textContent||'').join(' ').slice(0,2000))()`)
      if (recordPlatformContactLimit(row.account_id, notice) && !row.body.openedAt) throw Error('BOSS 今日开聊额度已用完，停止新增联系')
    }
    const policy=runtimePolicy(), hour=Number(new Date().toLocaleTimeString('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hour12:false}))
    if(hour<policy.startHour || hour>=policy.endHour)throw Error('已离开发送时段，停止本次平台操作')
    if (
      runtimePolicy().paused ||
      allAutomationPaused() ||
      !runtimePolicy().outbound ||
      discoveryAccount() !== row.account_id
    )
      throw Error('发送已暂停或账号已变化')
    const latest = contactMatch(contactJob(row.account_id, row.job_id), { account: row.account_id })
    if (
      !latest.eligible ||
      latest.profileVersion !== row.body.profileVersion ||
      latest.analysisId !== row.body.analysisId ||
      latest.jobBasis !== row.body.jobBasis
    )
      throw Error('资料、岗位或分析版本变化，已停止')
    const human = await this.humanState()
    if (
      human.busy ||
      (this.expected && human.epoch !== this.expected.humanEpoch) ||
      this.epoch !== this.inspectedEpoch
    )
      throw Error('检测到本人操作，已停止本次平台动作')
  }
  private async waitFor<T>(
    read: () => Promise<T>,
    accept: (x: T) => boolean,
    row: any,
    ms = 20000
  ): Promise<T> {
    const end = Date.now() + ms
    do {
      await this.check(row)
      const value = await read()
      if (accept(value)) return value
      await new Promise((r) => setTimeout(r, 500))
    } while (Date.now() < end)
    throw Error('BOSS 页面或消息未在时限内返回，未重复执行')
  }
  private async load(url: string, row: any) {
    await this.check(row)
    const wc = this.wc()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        wc.loadURL(url),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('BOSS 加载超时，停止本次操作')), 30000)
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  private async selectConversation(row: any) {
    const wc = this.wc()
    if (!wc.getURL().startsWith(BOSS_CHAT_URL)) await this.load(BOSS_CHAT_URL, row)
    await this.waitFor(
      async () =>
        this.evaluate(
          `(()=>{const user=document.querySelector('.main-wrap')?.__vue__?.$store?.state?.userInfo;if(user?.encryptUserId!==${JSON.stringify(row.account_id)})return false;const wanted=${JSON.stringify(row.recruiter_id)},el=[...document.querySelectorAll('.chat-user li[role=listitem]')].find(e=>e.__vue__?.source?.encryptBossId===wanted);if(!el)return false;el.click();return true})()`
        ),
      Boolean,
      row
    )
    const state = await this.waitFor(
      () => this.evaluate(`(${readCareerReplyPage.toString()})()`),
      (s: any) =>
        s.identityVerified && s.userId === row.account_id && s.bossId === row.recruiter_id,
      row
    )
    const snapshot = await this.evaluate(`(${readBossPageSnapshot.toString()})()`)
    if (snapshot.account?.id === row.account_id) saveBossSnapshot(snapshot)
    return state
  }
  async inspect(row: any) {
    this.expected = undefined
    const human = await this.humanState()
    this.inspectedEpoch = this.epoch
    if (human.busy) return { mode: 'blocked' as const, reason: '本人正在操作 BOSS，暂停本次联系' }
    this.expected = { humanEpoch: human.epoch }
    if (row.body.openedAt) {
      const s = await this.selectConversation(row)
      this.expected = { ...this.expected, state: s }
      return {
        mode: 'existing' as const,
        draft: s.draft,
        typing: s.typing,
        latestMessageId: s.messageId,
        incoming: !s.isSelf
      }
    }
    this.wc()
    const url = discoverySearchUrl(row.body.job.jobName, jobLocation(row.body.job).city)
    if (this.lastTarget !== row.id) {
      await this.load(url, row)
      this.lastTarget = row.id
    }
    const read = () => this.evaluate(`(${readContactPage.toString()})()`)
    let surface = await read()
    if (surface.jobId !== row.job_id) {
      await this.waitFor(
        async () =>
          this.evaluate(
            `(()=>{const root=document.querySelector('.page-jobs-main')?.__vue__;if(root?.$store?.state?.userInfo?.encryptUserId!==${JSON.stringify(row.account_id)})return false;const id=${JSON.stringify(row.job_id)};const el=[...document.querySelectorAll('a[href]')].find(e=>{try{return new URL(e.href).pathname==='/job_detail/'+encodeURIComponent(id)+'.html'}catch{return false}});if(!el)return false;el.click();return true})()`
          ),
        Boolean,
        row
      )
      surface = await this.waitFor(read, (s: any) => s.jobId === row.job_id, row)
    }
    if (
      surface.accountId !== row.account_id ||
      surface.recruiterId !== row.recruiter_id ||
      surface.blocked ||
      surface.unsafe
    )
      return {
        mode: 'blocked' as const,
        reason: '账号、招聘者或平台动作未能核实；简历及正式申请需本人确认'
      }
    const snapshot = await this.evaluate(`(${readBossPageSnapshot.toString()})()`)
    if (snapshot.jobDetail) {
      const live = normalizeBossJob(snapshot.jobDetail, true)
      if (live) {
        ingestBossJobs(
          row.account_id,
          { code: 0, zpData: snapshot.jobDetail },
          '/wapi/zpgeek/job/detail.json'
        )
        if (
          contactJobBasis({
            ...row.body.job,
            ...Object.fromEntries(Object.entries(live).filter(([, v]) => v !== '' && v != null))
          }) !== row.body.jobBasis
        )
          return { mode: 'blocked' as const, reason: '平台岗位条件已更新，请重新分析后联系' }
      }
    }
    if (surface.buttonText === '继续沟通') return { mode: 'existing' as const }
    if (surface.buttonText !== '立即沟通')
      return {
        mode: 'blocked' as const,
        reason: '未识别到普通立即沟通入口；不会点击申请或发送简历'
      }
    this.expected = { ...this.expected, surface }
    return { mode: 'default' as const }
  }
  async open(row: any): Promise<ContactProof> {
    await this.check(row)
    const result = await this.evaluate(
      `(()=>{const read=${readContactPage.toString()},s=read(),e=${JSON.stringify({ accountId: row.account_id, jobId: row.job_id, recruiterId: row.recruiter_id })};if(s.accountId!==e.accountId||s.jobId!==e.jobId||s.recruiterId!==e.recruiterId||s.unsafe||s.blocked||s.buttonText!=='立即沟通')return false;const docs=[document];for(const f of document.querySelectorAll('iframe')){try{if(f.contentDocument&&f.contentDocument.location.origin===location.origin)docs.push(f.contentDocument)}catch{}}const root=docs.map(d=>d.querySelector('.job-detail-box')).find(el=>el?.__vue__?.data?.jobInfo?.encryptId===e.jobId);const button=root?.querySelector('.op-btn.op-btn-chat');if(!button)return false;button.click();return true})()`
    )
    if (!result) throw Error('点击前平台条件已变化，未继续操作')
    await new Promise((r) => setTimeout(r, 900))
    await this.selectConversation(row)
    return this.readProof(row, false)
  }
  async send(row: any): Promise<ContactProof> {
    const s = this.expected?.state || (await this.selectConversation(row)),
      wc = this.wc(),
      text = row.body.greeting.text
    if (s.draft || !s.isSelf || s.messageId !== row.body.baselineMessageId)
      throw Error('会话已变化，补充说明未发送')
    await this.check(row)
    const expected = {
      userId: row.account_id,
      bossId: row.recruiter_id,
      messageId: s.messageId,
      text
    }
    const focus = await this.evaluate(
      `(()=>{const s=(${readCareerReplyPage.toString()})(),e=${JSON.stringify(expected)};if(!s.identityVerified||s.userId!==e.userId||s.bossId!==e.bossId||s.messageId!==e.messageId||s.draft||s.typing)return false;const el=document.querySelector('.chat-conversation .message-controls .chat-input');if(!el)return false;el.focus();return true})()`
    )
    if (!focus) throw Error('会话或草稿已变化')
    await this.check(row)
    await wc.insertText(text)
    await this.check(row)
    const clicked = await this.evaluate(
      `(()=>{const s=(${readCareerReplyPage.toString()})(),e=${JSON.stringify(expected)};if(!s.identityVerified||s.userId!==e.userId||s.bossId!==e.bossId||s.messageId!==e.messageId||s.draft.trim()!==e.text.trim())return false;const b=document.querySelector('.chat-conversation .message-controls .chat-op .btn-send:not(.disabled)');if(!b)return false;b.click();return true})()`
    )
    if (!clicked) throw Error('发送前账号、消息或文本发生变化')
    return this.readProof(row, true)
  }
  private async readProof(row: any, personalized: boolean): Promise<ContactProof> {
    const snapshot = await this.waitFor(
      () => this.evaluate(`(${readBossPageSnapshot.toString()})()`),
      (s: any) =>
        s.account?.id === row.account_id &&
        s.conversation?.identityVerified &&
        s.conversation?.bossId === row.recruiter_id &&
        (s.conversation.messages || []).some(
          (m: any) =>
            m.isSelf &&
            m.mid &&
            [1, 2].includes(m.status) &&
            ['text'].includes(m.type || m.messageType) &&
            Number(new Date(m.time)) >= Date.parse(row.updated_at) - 5000 &&
            (!personalized || m.text?.trim() === row.body.greeting.text.trim())
        ),
      row
    )
    saveBossSnapshot(snapshot)
    const candidates = snapshot.conversation.messages.filter(
      (m: any) =>
        m.isSelf &&
        m.mid &&
        [1, 2].includes(m.status) &&
        (m.type || m.messageType) === 'text' &&
        Number(new Date(m.time)) >= Date.parse(row.updated_at) - 5000 &&
        (!personalized || m.text?.trim() === row.body.greeting.text.trim())
    )
    if (candidates.length !== 1) throw Error('没有唯一可核实的新发出消息')
    const m = candidates[0]
    return {
      accountId: row.account_id,
      recruiterId: row.recruiter_id,
      conversationId: row.recruiter_id,
      jobId: row.job_id,
      messageId: String(m.mid),
      text: m.text,
      sentAt: new Date(m.time).toISOString()
    }
  }
  dispose() {
    this.disposed = true
    if (this.view && !this.view.isDestroyed()) this.view.destroy()
    this.view = undefined
  }
}
export class AtlasContactWorker {
  private timer: ReturnType<typeof setInterval>
  private busy = false
  private enrolledAt = 0
  private disposed = false
  constructor(private adapter: ContactAdapter) {
    this.timer = setInterval(() => void this.tick(), 4000)
    this.timer.unref()
  }
  async tick() {
    if (this.disposed) return
    atlasWrite('atlas-contact-worker', {
      at: new Date().toISOString(),
      accountId: discoveryAccount(),
      available: true,
      verification: '首次联系以实际消息回读为准；未核验的能力保持待验收'
    })
    if (
      this.busy ||
      atlasRead<any>('atlas-contact-authorization', {}).accountId !== discoveryAccount() ||
      runtimePolicy().paused ||
      !runtimePolicy().outbound ||
      allAutomationPaused()
    )
      return
    this.busy = true
    try {
      if (Date.now() - this.enrolledAt > 30000) {
        enrollContacts()
        this.enrolledAt = Date.now()
      }
      await contactTick(this.adapter)
    } catch (e: any) {
      atlasWrite('atlas-contact-worker', {
        at: new Date().toISOString(),
        accountId: discoveryAccount(),
        available: true,
        error: String(e.message).slice(0, 300)
      })
    } finally {
      this.busy = false
    }
  }
  dispose() {
    this.disposed = true
    clearInterval(this.timer)
    this.adapter.dispose?.()
  }
}
