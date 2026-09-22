import { inAccountScope } from './atlas-account-scope'
import { queryProjection, storageStamp } from './atlas-query-projection'
import { contactMatch, contactJobBasis, startContacts } from './atlas-contact'
import { discoveryDailyBudget } from './atlas-discovery-budget'
import { policyExclusions, policyVerification, allAutomationPaused, careerPolicy } from './atlas-policy'
import { feedbackList } from './atlas-adaptive'
import { modelUsage } from './atlas-deepseek'
import { randomUUID } from 'node:crypto'
import {
  atlasDb,
  atlasRead,
  atlasWrite,
  atlasTransaction,
  atlasEvent,
  atlasRevision,
  fingerprint
} from './atlas-store'
import { canonicalProfile, profileHistory } from './atlas-profile'
import { capturedBossJobs } from './atlas-boss-sync'
import {
  discoveryAccount,
  discoveryItemKey,
  discoveryItems,
  discoveryRun,
  saveDiscoveryRun
} from './atlas-discovery-state'
import {
  defaultDiscoverySettings,
  validateDiscoverySettings,
  discoveryAssessment,
  recommendationRank, validateDiscoveryChannels, itemDiscoveryChannels
} from '../../common/discovery'
import { readCareerSnapshot, checkRevision, withCareerLock } from './career-file-state'
import { opportunityKey, profileEvidence } from '../../common/career'
import { indexOpportunity } from './atlas-pipeline'
import { buildOpportunities } from '../../common/dashboard'
import { analyzeJob, analysisModel, currentAnalysisPromptVersion } from './atlas-ai'
import { acquireLease, releaseLease, keepLeaseAlive } from './atlas-tasks'
const settingsKey = 'atlas-discovery-settings'
function contactedJobs(account: string) {
  const sync = atlasRead<any>('career-boss-sync.json', null)
  return new Set<string>(
    sync?.account?.id === account
      ? (sync.items || []).map((i: any) => i.encryptJobId).filter(Boolean)
      : []
  )
}
export function discoverySettings() {
  const p = atlasRead<any>('atlas-career-policy', null)
  if (p) return { ...p.discovery, keywords: [...new Set<string>([...p.discovery.coreKeywords, ...p.discovery.extensionKeywords])], city: p.direction.preferredCities[0] || '', cities: p.direction.preferredCities, minimumMonthlyK: p.direction.minimumMonthlyK }
  return { ...defaultDiscoverySettings(canonicalProfile()), ...atlasRead(settingsKey, {}) }
}
export const discoveryJobBasis = contactJobBasis
function accountCheck(input: any) {
  const account = discoveryAccount()
  if (!account || input?.accountId !== account)
    throw Error('BOSS 账号尚未核实或已变化，请重新读取页面')
  return account
}
function jobFor(account: string, id: string) {
  if(typeof id==='string' && id.startsWith('local:')) {const item=readCareerSnapshot().state.opportunities.find(o=>'local:'+o.id===id && inAccountScope(o,account));if(!item)throw Error('导入机会不存在或账号不一致');return {...item.job,encryptJobId:id,sourcePlatform:'import',sourceUrl:item.sourceUrl || '',observedAt:item.createdAt || '',detailAt:item.job.description.length>=80?item.createdAt || 'import':''}}
  if (typeof id !== 'string' || !id || id.length > 250) throw Error('岗位标识无效')
  const row = atlasDb()
    .prepare(
      "SELECT body,observed_at,detail_at FROM platform_jobs WHERE platform='boss' AND account_id=? AND source_id=?"
    )
    .get(account, id)
  if (!row) throw Error('岗位尚未读取，请先挖掘岗位或在 BOSS 搜索后更新结果')
  return {
    description: '',
    address: '',
    ...JSON.parse(row.body),
    observedAt: row.observed_at,
    detailAt: row.detail_at
  }
}
export function discoveryList(input: any = {}) {
  const account = discoveryAccount(), profile = canonicalProfile(), settings = discoverySettings(), policy = careerPolicy()
  const version = profileHistory()[0]?.id || '', model = analysisModel(), db = atlasDb()
  const basis = fingerprint([account, version, model, currentAnalysisPromptVersion(), policy, storageStamp(db,['platform_jobs','platform_conversations','opportunities','contact_runs','career-workspace.json','career-boss-sync.json','atlas-discovery-item','atlas-feedback','atlas-restore-epoch'])])
  const projection = queryProjection(db,'discovery',basis,()=>{
    const items=discoveryItems(account), feedback=new Map<string,any>(feedbackList().map((r:any)=>[r.jobId,r]))
  const tracked = new Set(
    atlasDb()
      .prepare('SELECT id FROM opportunities')
      .all()
      .map((r: any) => r.id)
  )
  const contacted = contactedJobs(account)
  const contacts=atlasDb().prepare('SELECT id,job_id,recruiter_id,state FROM contact_runs WHERE account_id=?').all(account),tasksByRecruiter=new Map<string,any>(contacts.map((r:any)=>[r.recruiter_id,r])),knownConversations=new Set(atlasDb().prepare("SELECT source_id FROM platform_conversations WHERE platform='boss' AND account_id=?").all(account).map((r:any)=>r.source_id))
  const captured=capturedBossJobs(account),capturedIds=new Set(captured.map((j:any)=>j.encryptJobId))
  const imported=readCareerSnapshot().state.opportunities.filter(o=>inAccountScope(o,account) && !(o.platform==='boss'&&o.sourceId&&capturedIds.has(o.sourceId))).map(o=>({...o.job,encryptJobId:'local:'+o.id,sourcePlatform:'import',localOpportunityId:opportunityKey(o),sourceUrl:o.sourceUrl || '',observedAt:o.createdAt || '',detailAt:o.job.description.length>=80?o.createdAt || 'import':''}))
  const all = [...captured,...imported].map((job: any) => {
    const item = items.get(job.encryptJobId),
      opportunityId = job.localOpportunityId || `boss:${account}:job:${job.encryptJobId}`
    const following = job.sourcePlatform==='import' || tracked.has(opportunityId) || contacted.has(job.encryptJobId)
    return {
      job,
      channels: itemDiscoveryChannels(item),
      opportunityId,
      item: {
        status: following ? 'following' : item?.status || 'new',
        ...item,
        ...(job.sourcePlatform==='import'?{origin:'手动／文件导入'}:{}),
        ...(following ? { status: 'following' } : {}),
        revision: item?.revision || atlasRevision([discoveryItemKey(account, job.encryptJobId)])
      },
      feedback: feedback.get(job.encryptJobId),
      contactTask: tasksByRecruiter.get(job.encryptBossId) || null,
      existingConversation: knownConversations.has(job.encryptBossId),
      contactMatch: contactMatch(job,{account,profile,version,model,policy,feedback:feedback.get(job.encryptJobId)||null,item:item||{}}),
      assessment: (() => { const a = discoveryAssessment(job, profile, settings), excluded = [...a.excluded, ...policyExclusions(job,policy)], verify=policyVerification(job,policy); return { ...a, excluded, missing:[...a.missing,...verify], bucket: excluded.length ? 'excluded' : verify.length ? 'verify' : a.bucket } })(),
      analyzed: !!item?.analysis,
      analysisOutdated:
        !!item?.analysis &&
        (item.analysis.profileVersion !== version ||
          item.analysisBasis !== discoveryJobBasis(job) ||
          item.analysis.model !== model ||
          item.analysis.promptVersion !== currentAnalysisPromptVersion())
    }
  })
  const isRecommended = (i: any) => i.item.status === 'new' && !['irrelevant', 'ended', 'progressed'].includes(i.feedback?.action) && i.analyzed && !i.analysisOutdated && recommendationRank(i) < 2 && !i.assessment.excluded.length
  const counts = {
    total: all.length,
    new: all.filter((i) => i.item.status === 'new').length,
    priority: all.filter((i) => i.item.status === 'new' && i.assessment.bucket === 'priority')
      .length,
    verify: all.filter((i) => i.item.status === 'new' && i.assessment.bucket === 'verify').length,
    excluded: all.filter((i) => i.assessment.bucket === 'excluded').length,
    following: all.filter((i) => i.item.status === 'following').length,
    dismissed: all.filter((i) => i.item.status === 'dismissed').length,
    analyzed: all.filter((i) => i.analyzed && !i.analysisOutdated).length,
    eligible: all.filter(i=>i.contactMatch.eligible).length,
    pending: all.filter(i => !i.analyzed || i.analysisOutdated).length,
    recommended: all.filter(isRecommended).length
  }
  const hardRank=(r:any)=>r.assessment.excluded.length || (!r.analysisOutdated && r.item.analysis?.analysis?.requirements?.some((q:any)=>q.essential && q.status==='gap')) ? 2 : !r.analyzed || r.analysisOutdated || r.assessment.missing.length || r.item.analysis?.analysis?.requirements?.some((q:any)=>q.essential && q.status!=='met') ? 1 : 0
  const evidenceCount=(r:any)=>r.analysisOutdated?0:(r.item.analysis?.analysis?.requirements || []).filter((q:any)=>q.status==='met' && q.evidenceIds?.length && q.evidenceIds.every((id:string)=>profileEvidence(profile).some(e=>e.id===id && e.confirmed))).length
  const focus=(r:any)=>(policy.discovery.focus || []).filter((v:string)=>`${r.job.jobName} ${r.job.description}`.includes(v)).length
  const compare=(a:any,b:any)=>hardRank(a)-hardRank(b) || recommendationRank(a)-recommendationRank(b) || evidenceCount(b)-evidenceCount(a) || Number(b.feedback?.action==='interested')-Number(a.feedback?.action==='interested') || focus(b)-focus(a) || b.assessment.score-a.assessment.score || b.job.observedAt.localeCompare(a.job.observedAt)
    all.sort(compare)
    return {rows:all,counts}
  },r=>({id:r.job.encryptJobId,search:`${r.job.jobName} ${r.job.companyName} ${r.job.cityName || ''} ${r.job.address}`.toLowerCase(),status:r.item.status,bucket:r.assessment.bucket,pending:!r.analyzed||r.analysisOutdated,eligible:r.contactMatch.eligible,recommended:r.item.status==='new'&&!['irrelevant','ended','progressed'].includes(r.feedback?.action)&&r.analyzed&&!r.analysisOutdated&&recommendationRank(r)<2&&!r.assessment.excluded.length,targeted:r.channels.includes('targeted'),recommendedChannel:r.channels.includes('recommended')}))
  const query=String(input.query||'').trim().slice(0,150).toLowerCase(),filter=input.filter||'new',args:any[]=[],where=['1=1']
  if(input.channel && input.channel!=='all') where.push(input.channel==='targeted'?'channel_targeted=1':input.channel==='recommended'?'channel_recommended=1':'0=1')
  if(input.jobId){where.push('id=?');args.push(input.jobId)}
  if(query){where.push('instr(search,?)>0');args.push(query)}
  if(['eligible','pending','recommended'].includes(filter)) where.push(filter+'=1')
  else if(['priority','verify','excluded','possible'].includes(filter)){where.push("bucket=? AND status<>'dismissed'");args.push(filter)}
  else if(filter!=='all'){where.push('status=?');args.push(filter)}
  const pageResult=projection.page(where.join(' AND '),args,Number(input.page)||1,20)
  return {
    recommendations: projection.first('recommended=1',3),
    usage: modelUsage(),
    automationPaused: allAutomationPaused(),
    accountId: account,
    accountName: atlasRead<any>('career-boss-sync.json', null)?.account?.name || '',
    settings,
    settingsRevision: atlasRevision([settingsKey]),
    profileVersion: version,
    evidence: profileEvidence(profile),
    counts:projection.counts,
    dailyReads: { candidates: discoveryDailyBudget().candidates.length, details: discoveryDailyBudget().details.length },
    ...pageResult,
    run: discoveryRun(account),
    worker: atlasRead<any>('atlas-discovery-worker', null)
  }
}
export async function analyzeDiscoveredJob(input: any) {
  const account = accountCheck(input),
    job = jobFor(account, input.jobId),
    key = discoveryItemKey(account, input.jobId),
    basis = discoveryJobBasis(job)
  const leaseKey = 'analyze:discovery:' + fingerprint([account, input.jobId]),
    owner = acquireLease(leaseKey, 90000)
  if (!owner) throw Error('该岗位正在分析，请稍候查看结果')
  const stopLease = keepLeaseAlive(leaseKey, owner)
  try {
    const result = await analyzeJob({
      job,
      baseProfileVersion: input.profileVersion,
      refresh: !!input.refresh,
      mode: 'discovery', automatic: !!input.automatic, signal: input.signal
    })
    if (account !== discoveryAccount() || basis !== discoveryJobBasis(jobFor(account, input.jobId)))
      throw Error('分析期间账号或岗位变化，未覆盖现有结果')
    atlasTransaction(() => {
      const item = atlasRead<any>(key, { accountId: account, jobId: input.jobId, status: 'new' })
      atlasWrite(key, { ...item, analysis: result, analysisBasis: basis, analysisError: '' })
    })
    return result
  } catch (error) {
    if (account === discoveryAccount())
      atlasTransaction(() => {
        const item = atlasRead<any>(key, { accountId: account, jobId: input.jobId, status: 'new' })
        atlasWrite(key, {
          ...item,
          analysisError: error instanceof Error ? error.message : '分析失败'
        })
      })
    throw error
  } finally {
    stopLease()
    releaseLease(leaseKey, owner)
  }
}
export function startDiscovery(input: any) {
  return atlasTransaction(() => {
    if (allAutomationPaused()) throw Error('全部自动任务已暂停，请先在任务中心恢复采集与分析')
    const account = accountCheck(input),
      old = discoveryRun(account)
    if (old && ['queued', 'running', 'analyzing'].includes(old.state))
      throw Error('已有一轮挖掘正在进行，请等待结束或先暂停')
    const channels = validateDiscoveryChannels(input.channels ?? ['targeted', 'recommended'])
    const settings = validateDiscoverySettings(discoverySettings(), !channels.includes('targeted')),
      value = {
        id: randomUUID(),
        accountId: account,
        channels,
        settings,
        profileVersion: profileHistory()[0]?.id || '',
        state: 'queued',
        message: '等待桌面接收；请保持桌面程序运行并已登录 BOSS',
        at: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        jobIds: [],
        detailIds: [],
        detailSuccessIds: [],
        analyzedIds: [],
        errors: [],
        keywordIndex: 0,
        phase: 'search'
      }
    saveDiscoveryRun(account, value)
    return value
  })
}

// Resume the saved phase rather than skipping unfinished detail collection.
export function resumeDiscovery(input: any) {
  return atlasTransaction(() => {
    if (allAutomationPaused()) throw Error('全部自动任务已暂停，请先恢复')
    const account=accountCheck(input), run=discoveryRun(account)
    if(!run || run.id!==input.runId)throw Error('挖掘轮次已变化，请更新后再继续')
    if(!['paused','blocked'].includes(run.state))throw Error('本轮仍在运行或已结束，请勿重复继续')
    if(run.analysisTaskId){const task=atlasDb().prepare('SELECT state FROM task_runs WHERE id=?').get(run.analysisTaskId);if(task && ['queued','running'].includes(task.state))throw Error('原分析任务仍在处理，请稍后继续')}
    const version=profileHistory()[0]?.id || '', model=analysisModel(), changed=version!==run.profileVersion
    const phase=['search','detail','ai'].includes(run.phase)?run.phase:(run.jobIds.length?'detail':'search')
    const analyzedIds=run.analyzedIds.filter((id:string)=>{const item=atlasRead<any>(discoveryItemKey(account,id),null);return item?.analysis?.profileVersion===version && item.analysis.model===model && item.analysis.promptVersion===currentAnalysisPromptVersion() && item.analysisBasis===discoveryJobBasis(jobFor(account,id))})
    const next={...run,settings:validateDiscoverySettings(discoverySettings(), run.channels?.length === 1 && run.channels[0] === 'recommended'),profileVersion:version,automatic:false,phase,state:phase==='ai'?'analyzing':'queued',analyzedIds,
      analysisTaskId:'',analysisJobId:'',completedAt:null,errors:run.errors.filter((e:any)=>!e.ai),
      resumedAt:new Date().toISOString(),message:'从已保存步骤继续：'+({search:'读取岗位',detail:'补齐岗位详情',ai:'分析岗位'}[phase])+(changed?'；资料已更新，旧分析重新核对':''),at:new Date().toISOString()}
    saveDiscoveryRun(account,next)
    return next
  })
}

export function registerDiscovery(
  handle: (name: string, handler: (...args: any[]) => any) => void
) {
  handle('career-discovery-list', (_, input) => discoveryList(input))
  handle('career-discovery-settings', (_, input) =>
    withCareerLock(() => {
      checkRevision(input?.baseRevision, [settingsKey])
      const settings = validateDiscoverySettings(input?.settings)
      atlasWrite(settingsKey, settings)
      const account = discoveryAccount(),
        run = discoveryRun(account)
      if (
        !settings.autoRecommend &&
        run?.automatic &&
        ['queued', 'running', 'analyzing'].includes(run.state)
      ) {
        saveDiscoveryRun(account, {
          ...run,
          state: 'paused',
          message: '每日主动推荐已关闭，本轮暂停，已读数据保留',
          at: new Date().toISOString()
        })
      }
      return { settings, revision: atlasRevision([settingsKey]) }
    })
  )
  handle('career-discovery-start', (_, input) => startDiscovery(input))
  handle('career-discovery-contact-start', (_, input) => atlasTransaction(() => {
    const account = accountCheck(input), channels = validateDiscoveryChannels(input.channels)
    const old = discoveryRun(account)
    if (old && ['queued','running','analyzing'].includes(old.state) &&
        JSON.stringify(old.channels || ['targeted','recommended']) !== JSON.stringify(channels))
      throw Error('已有其他来源的采集正在运行，请等待完成或先暂停本轮再切换')
    const contact = startContacts({ ...input, channels })
    const run = old && ['queued','running','analyzing'].includes(old.state) ? old : startDiscovery({ ...input, channels })
    return { ...contact, run }
  }))
  handle('career-discovery-resume', (_, input) => resumeDiscovery(input))
  handle('career-discovery-pause', (_, input) =>
    atlasTransaction(() => {
      const account = accountCheck(input),
        run = discoveryRun(account)
      if (run && input.runId === run.id) {
        atlasWrite('atlas-discovery-schedule/' + account, {
          day: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }),
          runId: run.id,
          pausedByUser: true
        })
        saveDiscoveryRun(account, {
          ...run,
          state: 'paused',
          message: '已暂停；已读岗位和分析保留，正在返回的分析只保存为草稿',
          at: new Date().toISOString()
        })
      }
      return discoveryRun(account)
    })
  )
  handle('career-discovery-retry-analysis', (_, input) =>
    atlasTransaction(() => {
      const account = accountCheck(input),
        run = discoveryRun(account)
      if (!run || run.id !== input.runId || !run.jobIds.length)
        throw Error('这轮没有可继续分析的岗位，请先挖掘岗位')
      if (['queued', 'running', 'analyzing'].includes(run.state))
        throw Error('本轮仍在运行，请稍后查看结果')
      const profileVersion = profileHistory()[0]?.id || '',
        model = analysisModel()
      const analyzedIds = run.analyzedIds.filter((id: string) => {
        const item = atlasRead<any>(discoveryItemKey(account, id), null)
        return (
          item?.analysis?.profileVersion === profileVersion &&
          item.analysis.model === model &&
          item.analysis.promptVersion === currentAnalysisPromptVersion() &&
          item.analysisBasis === discoveryJobBasis(jobFor(account, id))
        )
      })
      const next = {
        ...run,
        profileVersion,
        automatic: false,
        state: 'analyzing',
        phase: 'ai',
        analyzedIds,
        errors: run.errors.filter((e: any) => !e.ai),
        message: '已保留岗位，继续本轮 AI 分析',
        completedAt: null,
        at: new Date().toISOString()
      }
      saveDiscoveryRun(account, next)
      return next
    })
  )
  handle('career-discovery-analyze', (_, input) => analyzeDiscoveredJob(input))
  handle('career-discovery-detail', (_, input) => {
    const account = accountCheck(input)
    jobFor(account, input.jobId)
    return discoveryList({ filter: 'all', jobId: input.jobId }).items[0]
  })
  handle('career-discovery-decision', (_, input) =>
    withCareerLock(() => {
      const account = accountCheck(input),
        key = discoveryItemKey(account, input.jobId),
        job = jobFor(account, input.jobId)
      if (!['following', 'dismissed', 'new'].includes(input.status)) throw Error('机会操作无效')
      checkRevision(input.baseRevision, [key])
      const old = atlasRead<any>(key, {}),
        id = `boss:${account}:job:${input.jobId}`
      if (input.status === 'following') {
        const snapshot = readCareerSnapshot()
        if (
          !contactedJobs(account).has(input.jobId) &&
          !snapshot.state.opportunities.some((o) => opportunityKey(o) === id) &&
          !atlasDb().prepare('SELECT id FROM opportunities WHERE id=?').get(id)
        ) {
          if (snapshot.state.opportunities.length >= 5000)
            throw Error('跟进清单已达上限，请先整理历史机会')
          snapshot.state.opportunities.push({
            id: randomUUID(),
            platform: 'boss',
            accountId: account,
            sourceId: input.jobId,
            sourceUrl: job.sourceUrl,
            job,
            stage: '计划联系',
            nextDate: '',
            note: '从机会发现加入，尚未联系招聘方。',
            createdAt: new Date().toISOString()
          })
          atlasWrite('career-workspace.json', snapshot.state, 'discovery')
          for (const o of buildOpportunities(snapshot.state, [], snapshot.preferences).filter(
            (o) => o.id === id
          ))
            indexOpportunity(o)
        }
      } else if (
        contactedJobs(account).has(input.jobId) ||
        atlasDb().prepare('SELECT id FROM opportunities WHERE id=?').get(id)
      )
        throw Error('该岗位已经进入跟进，请在企业与机会管理进展')
      atlasWrite(key, {
        ...old,
        accountId: account,
        jobId: input.jobId,
        status: input.status,
        decisionAt: new Date().toISOString()
      })
      atlasEvent('discovery-decision', id, { status: input.status })
      return { opportunityId: id, revision: atlasRevision([key]) }
    })
  )
}
