import { setInterval, clearInterval } from 'node:timers'
import { randomUUID } from 'node:crypto'
import { atlasDb, atlasRead, atlasTransaction, fingerprint } from './atlas-store'
import { acquireLease, keepLeaseAlive, releaseLease } from './atlas-tasks'
import { allAutomationPaused, setAllAutomationPaused } from './atlas-policy'
import { scheduleCompanyResearch } from './atlas-company-research'
import { scheduleCoordinator, coordinatorTaskBlock } from './atlas-coordinator'
import { careerPolicy } from './atlas-policy'
import { agentVersion } from './atlas-agents'
import { type AgentId } from '../../common/agents'
import { modelVersion } from './atlas-model-config'
import { packAnalysis, unpackAnalysis } from './atlas-analysis-storage'
import { executionTaskChanged, withExecutionTask, executionLink, updateExecutionStep } from './atlas-execution'
const channels = new Set([
  'career-contact-prepare',
  'career-model-test',
  'career-ai-analyze',
  'career-greeting-generate',
  'career-discovery-analyze',
  'career-strategy-optimize',
  'career-reply-draft',
  'career-conversation-pitch',
  'career-followup-draft',
  'career-interview-prepare'
])
const controllers = new Map<string, AbortController>()
channels.add('career-company-research')
channels.add('career-resume-review')
channels.add('career-market-review')
channels.add('career-coordinator-plan')
let executor: ((channel: string, payload: any) => Promise<any>) | undefined
let timer: ReturnType<typeof setInterval> | undefined
let busy = false
let researchScheduleAt = 0
const account = () => atlasRead<any>('career-boss-sync.json', null)?.account?.id || 'local'
const taskAgents: Record<string, AgentId[]> = {
  'career-coordinator-plan': ['coordinator'],
  'career-contact-prepare': ['analysis', 'greeting', 'greeting-review'],
  'career-model-test': [],
  'career-ai-analyze': ['analysis'],
  'career-greeting-generate': ['analysis', 'greeting', 'greeting-review'],
  'career-discovery-analyze': ['analysis'],
  'career-strategy-optimize': ['strategy'],
  'career-reply-draft': ['reply', 'greeting-review'],
  'career-conversation-pitch': ['greeting', 'greeting-review'],
  'career-followup-draft': ['followup', 'greeting-review'],
  'career-interview-prepare': ['interview'],
  'career-company-research': ['company-research'],
  'career-resume-review': ['resume-review'],
  'career-market-review': ['market-review', 'analysis']
}
function inputBasis(channel: string, payload: any = {}) {
  const p = careerPolicy(),
    modelTest = channel === 'career-model-test'
  const discovery = [
    'career-strategy-optimize',
    'career-discovery-analyze',
    'career-contact-prepare'
  ].includes(channel)
  return {
    profileVersion: modelTest
      ? null
      : atlasDb().prepare('SELECT id FROM profile_versions ORDER BY version DESC LIMIT 1').get()
          ?.id || null,
    policy: modelTest
      ? null
      : fingerprint(
          discovery
            ? [
                p.direction,
                p.exclusions,
                p.advanced,
                p.discovery.coreKeywords,
                p.discovery.extensionKeywords
              ]
            : p.direction
        ),
    model: modelVersion(),
    prompts: agentVersion(
      'task-basis-2',
      taskAgents[
        channel === 'career-reply-draft' && payload.followup ? 'career-followup-draft' : channel
      ] || []
    )
  }
}
export function taskRun(id: string) {
  const row = atlasDb().prepare('SELECT * FROM task_runs WHERE id=?').get(id)
  if (!row || row.account_id !== account()) throw Error('任务不存在或不属于当前账号')
  const basis = JSON.parse(row.input)?._taskBasis
  return {
    ...row,
    input: undefined,
    inputVersions: basis,
    inputOutdated:
      fingerprint(basis ?? null) !== fingerprint(inputBasis(row.kind, JSON.parse(row.input))),
    result: row.result ? unpackAnalysis(atlasDb(), JSON.parse(row.result)) : null
    , executionId: executionLink('task',id)?.run_id || ''
  }
}
export function createTask(input: any) {
  if (!channels.has(input?.channel)) throw Error('不支持此类后台任务')
  if (input.payload != null && (typeof input.payload !== 'object' || Array.isArray(input.payload)))
    throw Error('任务输入必须是对象')
  if (input.payload && ('_taskBasis' in input.payload || 'signal' in input.payload))
    throw Error('任务版本与取消信号由后台管理')
  if (input.payload?.automatic != null && typeof input.payload.automatic !== 'boolean')
    throw Error('自动任务标记无效')
  if (
    input.channel === 'career-model-test' &&
    Object.keys(input.payload || {}).some((k) => k !== 'baseRevision')
  )
    throw Error('模型测试只接受已保存配置的版本，不接受密钥或自定义提示词')
  if (JSON.stringify(input.payload || {}).length > 150000) throw Error('任务资料过长')
  return atlasTransaction(() => {
    const payload = input.payload || {},
      basis = inputBasis(input.channel, payload),
      idempotency = fingerprint([input.channel, account(), payload, basis])
    const old = atlasDb()
      .prepare(
        "SELECT id FROM task_runs WHERE idempotency_key=? AND state IN ('queued','running') ORDER BY created_at DESC LIMIT 1"
      )
      .get(idempotency)
    if (old) return { taskId: old.id, reused: true }
    const id = randomUUID(),
      now = new Date().toISOString()
    atlasDb()
      .prepare('INSERT INTO task_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        input.channel,
        account(),
        idempotency,
        'queued',
        payload.automatic ? '等待自动分析；手动任务优先' : '等待后台执行；不打断已开始的模型调用',
        JSON.stringify({ ...payload, _taskBasis: basis }),
        null,
        '',
        now,
        now,
        now
      )
    executionTaskChanged({id,kind:input.channel,accountId:account(),state:'queued',step:'等待后台执行',input:{...payload,_taskBasis:basis},createdAt:now})
    return { taskId: id, reused: false, executionId:executionLink('task',id)?.run_id }
  })
}
export function cancelTask(id: string) {
  const task = taskRun(id)
  if (!['queued', 'running'].includes(task.state)) return task
  if (!channels.has(task.kind)) throw Error('请用暂停本轮、同步开关或发送暂停控制此任务')
  atlasDb()
    .prepare(
      "UPDATE task_runs SET state='cancelled',step='已取消，已保存的结果保留',updated_at=? WHERE id=?"
    )
    .run(new Date().toISOString(), id)
  controllers.get(id)?.abort()
  executionTaskChanged({id,kind:task.kind,accountId:account(),state:'cancelled',step:'本人取消；已保存的结果保留'})
  return taskRun(id)
}
export async function taskQueueTick() {
  if (busy || !executor) return
  busy = true
  let worker: string | null
  try {
    worker = acquireLease('task-queue-worker', 90000)
  } catch (error) {
    busy = false
    throw error
  }
  if (!worker) {
    busy = false
    return
  }
  const stopLease = keepLeaseAlive('task-queue-worker', worker, () => {
    for (const c of controllers.values()) c.abort()
  })
  let heartbeat: ReturnType<typeof setInterval> | undefined
  try {
    if (Date.now() - researchScheduleAt > 60000) {
      researchScheduleAt = Date.now()
      scheduleCompanyResearch(createTask)
      scheduleCoordinator(createTask)
    }
    // A crashed call may have consumed tokens. Never silently replay it.
    const interrupted = atlasDb().prepare("SELECT * FROM task_runs WHERE state='running' AND kind LIKE 'career-%' AND heartbeat_at<?").all(new Date(Date.now()-90000).toISOString())
    atlasDb()
      .prepare(
        "UPDATE task_runs SET state='interrupted',step='进程中断，请核对后手动重试',updated_at=? WHERE state='running' AND kind LIKE 'career-%' AND heartbeat_at<?"
      )
      .run(new Date().toISOString(), new Date(Date.now() - 90000).toISOString())
    for(const r of interrupted){
      const run=executionLink('task',r.id)
      if(run){
        const steps=atlasDb().prepare("SELECT id FROM execution_steps WHERE run_id=? AND state IN ('running','waiting','queued')").all(run.run_id)
        for(const s of steps)updateExecutionStep(s.id,'interrupted','原执行进程中断；不会自动重试')
        atlasDb().prepare("UPDATE ai_calls SET status='interrupted' WHERE status='running' AND id IN (SELECT ref_id FROM execution_links WHERE run_id=? AND kind='model')").run(run.run_id)
      }
      executionTaskChanged({id:r.id,kind:r.kind,accountId:r.account_id,state:'interrupted',step:'进程中断，请核对后手动重试'})
    }
    const row = atlasDb()
      .prepare(
        "SELECT * FROM task_runs WHERE state='queued' AND kind LIKE 'career-%' AND account_id=? AND NOT EXISTS(WITH RECURSIVE ancestors AS (SELECT r.id,r.parent_id,r.source,r.paused FROM execution_links l JOIN execution_runs r ON r.id=l.run_id WHERE l.kind='task' AND l.ref_id=task_runs.id UNION SELECT r.id,r.parent_id,r.source,r.paused FROM execution_runs r JOIN ancestors a ON r.id=a.parent_id WHERE a.source IN ('coordinator','discovery','automatic')) SELECT 1 FROM ancestors WHERE paused=1)" +
          (allAutomationPaused() ? " AND COALESCE(json_extract(input,'$.automatic'),0)=0" : '') +
          " ORDER BY COALESCE(json_extract(input,'$.automatic'),0),created_at,rowid LIMIT 1"
      )
      .get(account())
    if (!row) return
    const payload = JSON.parse(row.input)
    if (payload.automatic && allAutomationPaused()) return
    const coordinationBlock = coordinatorTaskBlock(row.id, true)
    // Never run an old queued request against silently replaced personal facts.
    // Pause switches are deliberately excluded, so pausing/resuming is harmless.
    if (
      coordinationBlock || !channels.has(row.kind) ||
      fingerprint(payload._taskBasis ?? null) !==
        fingerprint(inputBasis(row.kind, JSON.parse(row.input)))
    ) {
      atlasDb()
        .prepare(
          "UPDATE task_runs SET state='interrupted',step='依据已变化，请核对后重新创建任务',error='排队期间资料、策略、模型或提示词已更新；未调用模型',updated_at=? WHERE id=? AND state='queued'"
        )
        .run(new Date().toISOString(), row.id)
      executionTaskChanged({id:row.id,kind:row.kind,accountId:row.account_id,state:'stale',step:coordinationBlock || '资料、策略、模型或提示词已更新；未调用模型'})
      return
    }
    const now = new Date().toISOString()
    if (
      !atlasDb()
        .prepare(
          "UPDATE task_runs SET state='running',step='模型正在处理任务',updated_at=?,heartbeat_at=? WHERE id=? AND state='queued'"
        )
        .run(now, now, row.id).changes
    )
      return
    const controller = new AbortController()
    executionTaskChanged({id:row.id,kind:row.kind,accountId:row.account_id,state:'running',step:'正在处理任务'})
    controllers.set(row.id, controller)
    heartbeat = setInterval(() => {
      if (
        account() !== row.account_id ||
        atlasDb().prepare('SELECT state FROM task_runs WHERE id=?').get(row.id)?.state ===
          'cancelled' ||
        (payload.automatic && allAutomationPaused())
        || !!coordinatorTaskBlock(row.id)
      )
        controller.abort()
      atlasDb()
        .prepare("UPDATE task_runs SET heartbeat_at=? WHERE id=? AND state='running'")
        .run(new Date().toISOString(), row.id)
    }, 2000)
    heartbeat.unref()
    try {
      const result = await withExecutionTask(row.id,()=>executor!(row.kind, { ...payload, signal: controller.signal }))
      if (controller.signal.aborted) throw Error('任务已取消或账号发生变化')
      atlasTransaction(() =>
        atlasDb()
          .prepare(
            "UPDATE task_runs SET state='completed',step='已完成',result=?,updated_at=? WHERE id=? AND state='running'"
          )
          .run(JSON.stringify(packAnalysis(atlasDb(), result)), new Date().toISOString(), row.id)
      )
      executionTaskChanged({id:row.id,kind:row.kind,accountId:row.account_id,state:result?.review?'review':'completed',step:result?.review?result.reason || '结果需要本人核对':'处理完成；生成内容不代表已发送'})
    } catch (e: any) {
      atlasDb()
        .prepare(
          "UPDATE task_runs SET state=?,step=?,error=?,updated_at=? WHERE id=? AND state='running'"
        )
        .run(
          controller.signal.aborted ? 'cancelled' : 'failed',
          '原有资料与报告已保留',
          e.name === 'AbortError' ? '任务已取消或超时' : String(e.message).slice(0, 500),
          new Date().toISOString(),
          row.id
        )
      executionTaskChanged({id:row.id,kind:row.kind,accountId:row.account_id,state:controller.signal.aborted?'cancelled':'failed',step:e.name==='AbortError'?'调用已取消或超时；不会自动重试':String(e.message)})
    } finally {
      controllers.delete(row.id)
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    try {
      stopLease()
      releaseLease('task-queue-worker', worker)
    } finally {
      busy = false
    }
  }
}
export function startTaskQueue(run: (channel: string, payload: any) => Promise<any>) {
  executor = run
  if (!timer) {
    timer = setInterval(
      () =>
        void taskQueueTick().catch(() => {
          /* Transient storage failures retry dispatch, never the paid request. */
        }),
      1000
    )
    timer.unref()
  }
  return () => {
    if (timer) clearInterval(timer)
    timer = undefined
    for (const c of controllers.values()) c.abort()
  }
}
export function taskCenter(input: any = {}) {
  const page = Math.max(1, Number(input.page) || 1),
    db = atlasDb(),
    id = account()
  const rows = db
    .prepare(
      'SELECT id,kind,state,step,error,created_at,updated_at,heartbeat_at FROM task_runs WHERE account_id=? ORDER BY created_at DESC LIMIT 20 OFFSET ?'
    )
    .all(id, (page - 1) * 20)
  const queued = db
    .prepare(
      "SELECT COALESCE(json_extract(input,'$.automatic'),0) automatic,count(*) count FROM task_runs WHERE account_id=? AND state='queued' AND kind LIKE 'career-%' GROUP BY automatic"
    )
    .all(id)
  const contactCounts = Object.fromEntries(
    db
      .prepare('SELECT state,count(*) count FROM contact_runs WHERE account_id=? GROUP BY state')
      .all(id)
      .map((r: any) => [r.state, r.count])
  )
  return {
    page,
    items: rows,
    queued: {
      manual: queued.filter((r: any) => !r.automatic).reduce((n: number, r: any) => n + r.count, 0),
      automatic: queued
        .filter((r: any) => !!r.automatic)
        .reduce((n: number, r: any) => n + r.count, 0)
    },
    contactCounts,
    total: db.prepare('SELECT count(*) n FROM task_runs WHERE account_id=?').get(id).n,
    automationPaused: allAutomationPaused(),
    counts: db
      .prepare('SELECT state,count(*) count FROM task_runs WHERE account_id=? GROUP BY state')
      .all(id),
    discovery: atlasRead('atlas-discovery-run/' + fingerprint(id), null),
    sync: atlasRead('atlas-boss-account-sync-' + fingerprint(id), null)
  }
}
export function registerTaskQueue(handle: (name: string, fn: (...args: any[]) => any) => void) {
  handle('career-task-create', (_, p) => createTask(p))
  handle('career-task-get', (_, p) => taskRun(p.id))
  handle('career-task-cancel', (_, p) => cancelTask(p.id))
  handle('career-task-center', (_, p) => taskCenter(p))
  handle('career-automation-pause', (_, p) => {
    if (typeof p?.paused !== 'boolean') throw Error('暂停状态无效')
    setAllAutomationPaused(p.paused)
    if (p.paused)
      for (const [id, c] of controllers) {
        const row = atlasDb().prepare('SELECT input FROM task_runs WHERE id=?').get(id)
        if (row && JSON.parse(row.input).automatic) c.abort()
      }
    return taskCenter()
  })
}
