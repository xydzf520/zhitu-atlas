import { createTask, taskRun } from './atlas-task-queue'
import { parentExecution, taskExecutionPaused } from './atlas-execution'
import { reserveDiscoveryRead, discoveryDailyBudget } from './atlas-discovery-budget'
import { allAutomationPaused, careerPolicy } from './atlas-policy'
import { BrowserWindow, type Session } from 'electron'
import { atlasDb, atlasRead, atlasWrite } from './atlas-store'
import { acquireLease, releaseLease, keepLeaseAlive } from './atlas-tasks'
import { readBossPageSnapshot } from './career-data-sync'
import { ingestBossJobs, capturedBossJobs } from './atlas-boss-sync'
import {
  discoveryRun,
  updateDiscoveryRun,
  discoveryAccount,
  discoveryItemKey
} from './atlas-discovery-state'
import { discoverySettings, startDiscovery } from './atlas-discovery'
import { canonicalProfile } from './atlas-profile'
import { discoveryAssessment, discoverySources } from '../../common/discovery'
import { isBossUrl } from '../../common/boss-browser'

// The page's normal rendered list is the data source. No private API replay or sends.
export function readDiscoveryPage() {
  const page = document.querySelector('.page-jobs-main') as any
  const root = document.querySelector('.main-wrap') as any
  const user = page?.__vue__?.$store?.state?.userInfo || root?.__vue__?.$store?.state?.userInfo
  const list = page?.__vue__?.jobList
  const keys = [
    'encryptId',
    'encryptJobId',
    'jobName',
    'postDescription',
    'encryptUserId',
    'encryptBossId',
    'encryptBrandId',
    'brandName',
    'address',
    'cityName',
    'degreeName',
    'experienceName',
    'jobExperience',
    'brandIndustry',
    'brandScaleName',
    'brandStageName',
    'bossName',
    'bossTitle',
    'bossActiveTime',
    'salaryDesc'
  ]
  const items = Array.isArray(list)
    ? list
        .slice(0, 100)
        .map((job: any) =>
          Object.fromEntries(
            keys
              .filter((k) => typeof job?.[k] === 'string' || typeof job?.[k] === 'number')
              .map((k) => [k, job[k]])
          )
        )
    : []
  return {
    accountId: user?.encryptUserId || '',
    query:
      page?.__vue__?.formData?.query ||
      (document.querySelector('input[placeholder="搜索职位、公司"]') as HTMLInputElement)?.value ||
      '',
    listAvailable: Array.isArray(list),
    items,
    blocked: !!document.querySelector('.geetest_panel, .captcha-container, .verify-page'),
    empty: !!document.querySelector('.job-empty-wrapper'),
    url: location.href
  }
}
export function scrollDiscoveryPage(account: string) {
  const page = document.querySelector('.page-jobs-main') as any
  const user =
    page?.__vue__?.$store?.state?.userInfo ||
    (document.querySelector('.main-wrap') as any)?.__vue__?.$store?.state?.userInfo
  if (user?.encryptUserId !== account) return false
  const list = document.querySelector('.job-list-container') as HTMLElement | null
  if (!list) return false
  let el: HTMLElement | null = list
  while (el) {
    if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) {
      el.scrollTop = el.scrollHeight
      el.dispatchEvent(new Event('scroll'))
      return true
    }
    el = el.parentElement
  }
  window.scrollTo(0, document.documentElement.scrollHeight)
  return true
}
export class AtlasDiscoveryCollector {
  private timer?: ReturnType<typeof setInterval>
  private view?: BrowserWindow
  private owner = ''
  private stopLease?: () => void
  private account = ''
  private runId = ''
  private busy = false
  private disposed = false
  private loaded = ''
  private loadedAt = 0
  private target = ''
  private rounds = 0
  private listCount = 0
  constructor(
    private session: Session,
    private currentAccount: () => string,
    autoStart = true,
    private humanBusy: () => Promise<boolean> = async () => false
  ) {
    if (autoStart) {
      this.timer = setInterval(() => void this.tick(), 4000)
      this.timer.unref()
    }
  }
  private close() {
    this.stopLease?.()
    this.stopLease = undefined
    if (this.view && !this.view.isDestroyed()) this.view.destroy()
    this.view = undefined
    this.loaded = ''
    this.target = ''
    if (this.owner) releaseLease('discover:boss:' + this.account, this.owner)
    this.owner = ''
  }
  private current() {
    const run = discoveryRun(this.account)
    return !allAutomationPaused() && !taskExecutionPaused('discovery:'+this.runId) && !this.disposed &&
      this.currentAccount() === this.account &&
      discoveryAccount() === this.account &&
      run?.id === this.runId &&
      ['queued', 'running', 'analyzing'].includes(run.state)
      ? run
      : null
  }
  private patch(patch: any) {
    if (this.current()) updateDiscoveryRun(this.account, this.runId, patch)
  }
  private async load(url: string) {
    this.loaded = url
    this.loadedAt = Date.now()
    await this.view!.webContents.loadURL(url)
  }
  private finish(run: any) {
    this.patch({
      state: 'completed',
      phase: 'done',
      completedAt: new Date().toISOString(),
      message: `本轮已保存 ${run.jobIds.length} 个岗位，补齐 ${(run.detailSuccessIds || []).length} 份详情，完成 ${run.analyzedIds.length} 份 AI 分析${run.errors.length ? '；部分内容待核实' : ''}。符合条件的岗位由统一自动联系队列接收；暂停或缺少证据时保留待处理。`
    })
    this.close()
  }
  async tick(now = new Date()) {
    let browserOwner: string | null = null, browserKey = ''
    if (this.disposed) return
    if (allAutomationPaused()) { this.close(); return }
    if (this.busy) {
      atlasWrite('atlas-discovery-worker', {
        at: new Date().toISOString(),
        accountId: this.currentAccount(),
        available: !!this.currentAccount()
      })
      if (!this.current()) this.close()
      return
    }
    this.busy = true
    try {
      const active = this.currentAccount()
      atlasWrite('atlas-discovery-worker', {
        at: new Date().toISOString(),
        accountId: active,
        available: !!active
      })
      if (!active || active !== discoveryAccount()) {
        if (this.account)
          updateDiscoveryRun(this.account, this.runId, {
            state: 'blocked',
            message: '账号未核实，已停止读取'
          })
        this.close()
        return
      }
      if (this.account && this.account !== active) {
        updateDiscoveryRun(this.account, this.runId, {
          state: 'blocked',
          message: '登录账号已变化，本轮停止'
        })
        this.close()
      }
      let run = discoveryRun(active)
      if(run && taskExecutionPaused('discovery:'+run.id)){this.close();return}
      const settings = discoverySettings()
      const day = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }),
        time = now.toLocaleTimeString('en-GB', {
          timeZone: 'Asia/Shanghai',
          hour: '2-digit',
          minute: '2-digit'
        })
      const scheduleKey = 'atlas-discovery-schedule/' + active
      if (
        settings.autoRecommend &&
        (settings.keywords.length > 0 || (atlasRead<any>('atlas-contact-authorization', {}).accountId === active && atlasRead<any>('atlas-contact-authorization', {}).channels?.includes('recommended'))) &&
        time >= settings.recommendTime &&
        time < '21:00' &&
        String(atlasRead<any>(scheduleKey, {}).day || '') < day &&
        (!run || !['queued', 'running', 'analyzing', 'blocked'].includes(run.state))
      ) {
        run = startDiscovery({ accountId: active, channels: atlasRead<any>('atlas-contact-authorization', {}).accountId === active ? atlasRead<any>('atlas-contact-authorization', {}).channels : undefined })
        atlasWrite(scheduleKey, { day, runId: run.id, at: now.toISOString() })
        updateDiscoveryRun(active, run.id, {
          automatic: true,
          message: '每日主动推荐已开始，正在读取新岗位'
        })
      }
      if (!run || !['queued', 'running', 'analyzing'].includes(run.state)) {
        this.close()
        return
      }
      if (this.account !== active || this.runId !== run.id) {
        if (this.account && this.account !== active)
          updateDiscoveryRun(this.account, this.runId, {
            state: 'blocked',
            message: '登录账号已变化，本轮停止'
          })
        this.close()
        this.account = active
        this.runId = run.id
      }
      if (!run.strategyChecked && (run.channels || ['targeted']).includes('targeted') && careerPolicy().discovery.adaptive) {
        if(!run.strategyTaskId) { const task=createTask({channel:'career-strategy-optimize',payload:{automatic:true}});parentExecution(task.taskId,'discovery:'+run.id,'strategy','discovery');this.patch({strategyTaskId:task.taskId,message:'正在复盘搜索策略，核心方向保持不变'});return }
        const task=taskRun(run.strategyTaskId)
        if(['queued','running'].includes(task.state))return
        this.patch({strategyChecked:true,settings:{...run.settings,keywords:discoverySettings().keywords},strategyNotice:task.state==='completed'?'搜索策略已核对':task.error || task.step});return
      }
      if(run.phase==='ai') { this.processAnalysis(run,active); return }
      if(await this.humanBusy()) { this.patch({message:'本人正在操作 BOSS，采集等待页面空闲'}); return }
      if (!this.owner) {
        this.owner = acquireLease('discover:boss:' + active, 90000) || ''
        if (!this.owner) return
        this.stopLease = keepLeaseAlive('discover:boss:' + active, this.owner, () => this.close())
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
        const guard = (event: Electron.Event, url: string) => {
          if (!isBossUrl(url)) event.preventDefault()
        }
        this.view.webContents.on('will-navigate', guard)
        this.view.webContents.on('will-redirect', guard)
        this.patch({ state: 'running', message: '正在读取所选来源的 BOSS 岗位，前台工作台保持不变' })
      }
      const renewed = atlasDb()
        .prepare('UPDATE leases SET expires_at=? WHERE key=? AND owner=? AND expires_at>?')
        .run(Date.now() + 90000, 'discover:boss:' + active, this.owner, Date.now()).changes
      if (!renewed) {
        this.close()
        return
      }
      if (run.phase !== 'ai') { browserKey = 'browser:boss:' + active; browserOwner = acquireLease(browserKey); if (!browserOwner) return }
      const wc = this.view!.webContents
      if (wc.isLoadingMainFrame()) {
        if (Date.now() - this.loadedAt > 45000) throw Error('页面加载超时，请稍后开始新一轮')
        return
      }
      if (run.phase === 'search') {
        const sources = discoverySources(run.channels || ['targeted', 'recommended'], run.settings.keywords, run.settings.cities?.length ? run.settings.cities : [run.settings.city])
        if (
          run.keywordIndex >= sources.length ||
          run.jobIds.length >= run.settings.maxJobs || discoveryDailyBudget().candidates.length >= careerPolicy().discovery.maxJobs
        ) {
          this.patch({
            phase: 'detail',
            message: '搜索列表已入库，正在补齐重点岗位的完整要求与地址'
          })
          this.loaded = ''
          return
        }
        const {keyword,url,origin}=sources[run.keywordIndex]
        if (this.loaded !== url) {
          this.rounds = 0
          this.listCount = 0
          await this.load(url)
          return
        }
        const page = await wc.executeJavaScript(`(${readDiscoveryPage.toString()})()`)
        if (!this.current()) {
          this.close()
          return
        }
        if (page.blocked)
          throw Error('平台要求登录核实或安全检查，已停止；请在 BOSS 工作台处理后重新开始')
        if (page.accountId !== active || !page.listAvailable || page.query.trim() !== keyword) {
          if (Date.now() - this.loadedAt < 20000) return
          throw Error('搜索页账号、关键词或列表结构未能核实，已停止；不会把登录引导岗位计入结果')
        }
        if (!page.items.length && !page.empty) {
          if (Date.now() - this.loadedAt < 20000) return
          throw Error('搜索列表尚未返回岗位或明确的空结果，已停止；请检查 BOSS 工作台提示')
        }
        let room = run.settings.maxJobs - run.jobIds.length
        const available = page.items
          .filter((j: any) => j.encryptId || j.encryptJobId)
          .slice(0, Math.ceil(run.settings.maxJobs / sources.length))
          .filter(
            (j: any) => (run.jobIds.includes(String(j.encryptId || j.encryptJobId)) || room-- > 0) && reserveDiscoveryRead('candidates',active,String(j.encryptId || j.encryptJobId))
          )
        ingestBossJobs(
          active,
          { code: 0, zpData: { jobList: available } },
          keyword?'/wapi/zpgeek/search/joblist.json':'/wapi/zpgeek/pc/recommend/job/list.json',
          {origin,runId:run.id,keyword}
        )
        const ids = [
          ...new Set<string>([
            ...run.jobIds,
            ...available.map((j: any) => String(j.encryptId || j.encryptJobId))
          ])
        ].slice(0, run.settings.maxJobs)
        this.patch({ jobIds: ids, message: `已读取 ${ids.length} 个岗位 · 当前来源：${keyword || 'BOSS 推荐'}` })
        const grew = page.items.length > this.listCount
        this.listCount = page.items.length
        if (
          ids.length >= run.settings.maxJobs ||
          page.items.length >= Math.ceil(run.settings.maxJobs / sources.length) ||
          !grew ||
          this.rounds >= 2 ||
          page.empty
        ) {
          this.patch({ keywordIndex: run.keywordIndex + 1 })
          this.loaded = ''
          return
        }
        this.rounds++
        await wc.executeJavaScript(`(${scrollDiscoveryPage.toString()})(${JSON.stringify(active)})`)
        return
      }
      const jobs = capturedBossJobs(active)
        .filter((j: any) => run.jobIds.includes(j.encryptJobId))
        .map((job: any) => ({
          job,
          assessment: discoveryAssessment(job, canonicalProfile(), run.settings)
        }))
        .filter((i: any) => !i.assessment.excluded.length)
        .sort((a: any, b: any) => b.assessment.score - a.assessment.score)
      if (run.phase === 'detail') {
        if (this.target) {
          if (
            new URL(wc.getURL()).pathname !== `/job_detail/${encodeURIComponent(this.target)}.html`
          )
            throw Error('职位详情发生跳转，已停止本轮；请检查登录或平台提示')
          const snapshot = await wc.executeJavaScript(`(${readBossPageSnapshot.toString()})()`)
          if (!this.current()) {
            this.close()
            return
          }
          const data = snapshot.publicJobs?.find((j: any) => j.jobInfo?.encryptId === this.target)
          let errors = run.errors
          if (data)
            ingestBossJobs(active, { code: 0, zpData: data }, '/wapi/zpgeek/job/detail.json')
          else if (Date.now() - this.loadedAt < 10000) return
          else
            errors = [
              ...errors,
              { jobId: this.target, message: '岗位详情未返回可识别内容；可能下架或需要平台核实' }
            ]
          this.patch({
            detailIds: [...new Set([...run.detailIds, this.target])],
            detailSuccessIds: data
              ? [...new Set([...(run.detailSuccessIds || []), this.target])]
              : run.detailSuccessIds || [],
            errors
          })
          this.target = ''
          return
        }
        if (run.detailIds.length >= run.settings.detailLimit) {
          this.patch({ phase: 'ai', state: 'analyzing' })
          return
        }
        const next = jobs.find((i: any) => !run.detailIds.includes(i.job.encryptJobId))
        if (!next) {
          this.patch({ phase: 'ai', state: 'analyzing' })
          return
        }
        this.target = next.job.encryptJobId
        if (next.job.detailAt && next.job.description.length >= 80) {
          this.patch({
            detailIds: [...run.detailIds, this.target],
            detailSuccessIds: [...new Set([...(run.detailSuccessIds || []), this.target])]
          })
          this.target = ''
          return
        }
        if(!reserveDiscoveryRead('details',active,this.target)){this.target='';this.patch({phase:'ai',state:'analyzing',message:'今日详情读取预算已用完，分析已保存的完整岗位'});return}
        this.patch({ message: `正在补齐：${next.job.companyName || '企业'} · ${next.job.jobName}` })
        await this.load(`https://www.zhipin.com/job_detail/${encodeURIComponent(this.target)}.html`)
        return
      }
    } catch (error) {
      this.patch({
        state: 'blocked',
        message: error instanceof Error ? error.message : '读取中断，已有数据保留',
        completedAt: new Date().toISOString()
      })
      this.close()
    } finally {
      if (browserOwner) releaseLease(browserKey, browserOwner)
      this.busy = false
    }
  }
  private processAnalysis(run:any,account:string) {
    if(taskExecutionPaused('discovery:'+run.id))return
    if(run.analysisTaskId) {
      const task=taskRun(run.analysisTaskId)
      if(['queued','running'].includes(task.state))return
      if(task.state==='completed') this.patch({analysisTaskId:'',analysisJobId:'',analyzedIds:[...run.analyzedIds,run.analysisJobId]})
      else {this.patch({state:'paused',phase:'ai',analysisTaskId:'',errors:[...run.errors,{jobId:run.analysisJobId,ai:true,message:task.error||task.step}],message:'AI 已停止，原有岗位与报告保留：'+(task.error||task.step)});this.close()}
      return
    }
    if(run.analyzedIds.length>=run.settings.aiLimit){this.finish(run);return}
    const next=capturedBossJobs(account).find((j:any)=>run.jobIds.includes(j.encryptJobId) && !run.analyzedIds.includes(j.encryptJobId) && j.description?.length>=80 && j.description.length<=30000 && !run.errors.some((e:any)=>e.ai && e.jobId===j.encryptJobId) && !discoveryAssessment(j,canonicalProfile(),run.settings).excluded.length && atlasRead<any>(discoveryItemKey(account,j.encryptJobId),{}).status!=='dismissed')
    if(!next){this.finish(run);return}
    const task=createTask({channel:'career-discovery-analyze',payload:{accountId:account,jobId:next.encryptJobId,profileVersion:run.profileVersion,automatic:true}})
    parentExecution(task.taskId,'discovery:'+run.id,next.encryptJobId,'discovery')
    this.patch({analysisTaskId:task.taskId,analysisJobId:next.encryptJobId,message:'DeepSeek 正在分析：'+next.companyName+' · '+next.jobName})
  }
  dispose() {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    this.close()
  }
}
