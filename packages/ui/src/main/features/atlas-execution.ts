import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { atlasDb, atlasRead, atlasTransaction } from './atlas-store'
import { unpackAnalysis } from './atlas-analysis-storage'
import { AGENT_DEFINITIONS } from '../../common/agents'
import { executionKinds, executionState, executionDestination } from '../../common/execution'

type Scope = { runId: string; stepId: string; accountId: string }
const context = new AsyncLocalStorage<Scope>()
const now = () => new Date().toISOString()
export const executionAccount = () =>
  atlasRead<any>('career-boss-sync.json', null)?.account?.id || 'local'
export const executionContext = () => context.getStore()
export function executionText(value: unknown, max = 500): string {
  return String(value ?? '')
    .replace(/\b(?:sk-|user_)[A-Za-z0-9_-]{8,}/g, '[凭据已隐藏]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]')
    .slice(0, max)
}
export function executionLink(kind: string, ref: string) {
  return (
    atlasDb().prepare('SELECT * FROM execution_links WHERE kind=? AND ref_id=?').get(kind, ref) ||
    null
  )
}
export function linkExecution(runId: string, kind: string, ref: string, stepId = '') {
  if (!ref) return
  const old = executionLink(kind, ref)
  if (old && old.run_id !== runId) return old // A shared result has one owner, never duplicate calls.
  atlasDb()
    .prepare(
      "INSERT INTO execution_links VALUES(?,?,?,?) ON CONFLICT(kind,ref_id) DO UPDATE SET step_id=CASE WHEN excluded.step_id<>'' THEN excluded.step_id ELSE execution_links.step_id END"
    )
    .run(kind, ref, runId, stepId)
  return executionLink(kind, ref)
}
export function executionEvent(
  runId: string,
  stepId: string,
  kind: string,
  state: string,
  summary: string
) {
  atlasDb()
    .prepare(
      'INSERT INTO execution_events(run_id,step_id,kind,state,summary,created_at) VALUES(?,?,?,?,?,?)'
    )
    .run(runId, stepId, kind, state, executionText(summary), now())
}
function objectFor(account: string, kind: string, input: any) {
  const jobId = input.jobId || input.job?.encryptJobId || ''
  const bossId = input.bossId || input.conversationId || ''
  let objectKind =
    jobId && kind === 'first-contact'
      ? 'job'
      : bossId
        ? 'conversation'
        : jobId
          ? 'job'
          : input.id && kind === 'career-interview-prepare'
            ? 'opportunity'
            : kind.includes('resume')
              ? 'profile'
              : kind.includes('market')
                ? 'market'
                : ''
  let objectId =
    objectKind === 'job' ? jobId : bossId || (objectKind === 'opportunity' ? input.id : '')
  let job = input.job
  if (jobId) {
    const r = atlasDb()
      .prepare(
        "SELECT body FROM platform_jobs WHERE platform='boss' AND account_id=? AND source_id=?"
      )
      .get(account, jobId)
    if (r) job = JSON.parse(r.body)
  }
  let label = [job?.companyName, job?.jobName].filter(Boolean).join(' · ')
  if (!label && bossId) {
    const r = atlasDb()
      .prepare(
        "SELECT body FROM platform_conversations WHERE platform='boss' AND account_id=? AND source_id=?"
      )
      .get(account, bossId)
    const b = r ? JSON.parse(r.body) : {}
    label = [b.companyName || input.company, b.bossName || input.person].filter(Boolean).join(' · ')
  }
  return { objectKind, objectId, title: executionText(label || executionKinds[kind] || kind, 180) }
}
export function ensureExecutionTask(
  id: string,
  kind: string,
  account: string,
  input: any = {},
  createdAt = now()
) {
  return atlasTransaction(() => {
    const old = executionLink('task', id)
    if (old) return old
    let parent = context.getStore()
    if (parent?.accountId !== account) parent = undefined
    // Contact and reply lifecycles outlive their preparation tasks.
    const independent =
      kind === 'first-contact' || kind === 'conversation-reply' || kind === 'discovery-run'
    const runId = parent && !independent ? parent.runId : 'run:' + id
    if (!parent || independent) {
      const o = objectFor(account, kind, input)
      atlasDb()
        .prepare(
          'INSERT OR IGNORE INTO execution_runs(id,account_id,owner_kind,owner_id,title,object_kind,object_id,source,parent_id,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
        )
        .run(
          runId,
          account,
          'task',
          id,
          o.title,
          o.objectKind,
          o.objectId,
          input.automatic
            ? 'automatic'
            : kind === 'conversation-reply'
              ? 'message'
              : kind === 'first-contact'
                ? 'contact'
                : 'manual',
          parent?.runId || '',
          'queued',
          createdAt,
          now()
        )
    }
    const stepId = 'step:' + id
    atlasDb()
      .prepare(
        'INSERT OR IGNORE INTO execution_steps(id,run_id,parent_id,actor,label,state,basis,created_at,heartbeat_at) VALUES(?,?,?,?,?,?,?,?,?)'
      )
      .run(
        stepId,
        runId,
        parent && !independent ? parent.stepId : '',
        'system',
        executionKinds[kind] || kind,
        'queued',
        JSON.stringify(
          input._taskBasis || {
            profileVersion: input.profileVersion || input.baseProfileVersion || ''
          }
        ),
        createdAt,
        now()
      )
    linkExecution(runId, 'task', id, stepId)
    const objects: Array<[string, string]> = [
      ['job', input.jobId || input.job?.encryptJobId || ''],
      ['conversation', input.bossId || input.conversationId || '']
    ]
    for (const [kind, ref] of objects)
      if (ref)
        atlasDb()
          .prepare('INSERT OR IGNORE INTO execution_subjects VALUES(?,?,?)')
          .run(runId, kind, ref)
    executionEvent(runId, stepId, 'created', 'queued', '创建' + (executionKinds[kind] || kind))
    return executionLink('task', id)
  })
}
export function executionTaskChanged(input: {
  id: string
  kind: string
  accountId: string
  state: string
  step: string
  input?: any
  createdAt?: string
}) {
  return atlasTransaction(() => {
    const link = ensureExecutionTask(
      input.id,
      input.kind,
      input.accountId,
      input.input,
      input.createdAt
    )
    updateExecutionStep(link.step_id, executionState(input.state), input.step)
    const run = atlasDb().prepare('SELECT owner_id FROM execution_runs WHERE id=?').get(link.run_id)
    if (run.owner_id === input.id)
      atlasDb()
        .prepare(
          'UPDATE execution_runs SET state=?,summary=?,updated_at=?,revision=revision+1 WHERE id=? AND (state<>? OR summary<>?)'
        )
        .run(
          executionState(input.state),
          executionText(input.step),
          now(),
          link.run_id,
          executionState(input.state),
          executionText(input.step)
        )
    return link
  })
}
export function updateExecutionStep(id: string, state: string, summary: string, output?: any) {
  return atlasTransaction(() => {
    const db = atlasDb(),
      old = db.prepare('SELECT * FROM execution_steps WHERE id=?').get(id)
    if (!old) return
    const at = now(),
      text = executionText(summary),
      value = output === undefined ? old.output : JSON.stringify(output).slice(0, 150000)
    // Never write a truncated JSON value.
    if (output !== undefined && JSON.stringify(output).length > 150000) throw Error('运行结果过长')
    const changed = old.state !== state || old.summary !== text || old.output !== value
    db.prepare(
      'UPDATE execution_steps SET state=?,summary=?,output=?,started_at=?,finished_at=?,heartbeat_at=? WHERE id=?'
    ).run(
      state,
      text,
      value,
      old.started_at || (state === 'running' ? at : ''),
      ['completed', 'failed', 'cancelled', 'cached', 'interrupted', 'skipped'].includes(state)
        ? old.finished_at || at
        : '',
      at,
      id
    )
    if (changed) {
      executionEvent(old.run_id, id, 'step', state, text)
      db.prepare('UPDATE execution_runs SET updated_at=?,revision=revision+1 WHERE id=?').run(
        at,
        old.run_id
      )
    }
  })
}
export function withExecutionTask<T>(id: string, fn: () => T): T {
  const link = executionLink('task', id)
  if (!link) return fn()
  const run = atlasDb().prepare('SELECT account_id FROM execution_runs WHERE id=?').get(link.run_id)
  return context.run({ runId: link.run_id, stepId: link.step_id, accountId: run.account_id }, fn)
}
export function withExecutionScope<T>(scope: Scope, fn: () => T): T {
  return context.run(scope, fn)
}
export function executionPaused(runId?: string): boolean {
  const id = runId || context.getStore()?.runId
  if (!id) return false
  return !!atlasDb()
    .prepare(
      "WITH RECURSIVE ancestors AS (SELECT id,parent_id,source,paused FROM execution_runs WHERE id=? UNION SELECT r.id,r.parent_id,r.source,r.paused FROM execution_runs r JOIN ancestors a ON r.id=a.parent_id WHERE a.source IN ('coordinator','discovery','automatic')) SELECT 1 FROM ancestors WHERE paused=1 LIMIT 1"
    )
    .get(id)
}
export function taskExecutionPaused(taskId: string) {
  return executionPaused(executionLink('task', taskId)?.run_id)
}
export function beginModelExecution(id: string, accountId: string, kind: string, basis: any) {
  let scope = context.getStore()
  if (!scope || scope.accountId !== accountId) {
    const link = ensureExecutionTask('model:' + id, 'model:' + kind, accountId, {
      automatic: basis.automatic
    })
    scope = { runId: link.run_id, stepId: link.step_id, accountId }
  }
  const stepId = 'model:' + id,
    label = AGENT_DEFINITIONS.find((a) => a.id === kind)?.label || kind
  atlasDb()
    .prepare(
      'INSERT INTO execution_steps(id,run_id,parent_id,actor,label,state,summary,basis,created_at,heartbeat_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
    )
    .run(
      stepId,
      scope.runId,
      scope.stepId,
      kind,
      label,
      'waiting',
      '等待模型执行权',
      JSON.stringify(basis),
      now(),
      now()
    )
  linkExecution(scope.runId, 'model', id, stepId)
  executionEvent(scope.runId, stepId, 'created', 'waiting', '等待' + label)
  return { runId: scope.runId, stepId, accountId }
}
export function finishModelExecution(scope: Scope, state: string, summary: string, output?: any) {
  updateExecutionStep(scope.stepId, state, summary, output)
  const root = atlasDb().prepare('SELECT owner_id FROM execution_runs WHERE id=?').get(scope.runId)
  if (root?.owner_id?.startsWith('model:'))
    executionTaskChanged({
      id: root.owner_id,
      kind: root.owner_id,
      accountId: scope.accountId,
      state,
      step: summary
    })
}
export function modelExecutionOutput(value: any) {
  const out: any = {}
  for (const key of [
    'text',
    'reason',
    'summary',
    'draft',
    'grounded',
    'relevant',
    'concise',
    'noCommitments',
    'evidenceIds',
    'issues',
    'recommendation'
  ]) {
    if (value?.[key] !== undefined && JSON.stringify(value[key]).length < 12000)
      out[key] = value[key]
  }
  return { ...out, validated: false } // Transport completion is not business approval.
}
export function executionRule(label: string, state: string, summary: string, output?: any) {
  const scope = context.getStore()
  if (!scope) return
  const id = 'rule:' + randomUUID()
  atlasDb()
    .prepare(
      'INSERT INTO execution_steps(id,run_id,parent_id,actor,label,state,created_at,heartbeat_at) VALUES(?,?,?,?,?,?,?,?)'
    )
    .run(id, scope.runId, scope.stepId, 'system', label, 'running', now(), now())
  updateExecutionStep(id, state, summary, output)
  return id
}
export function parentExecution(
  childTaskId: string,
  parentTaskId: string,
  originRef: string,
  source = 'coordinator'
) {
  const child = executionLink('task', childTaskId),
    parent = executionLink('task', parentTaskId)
  if (!child || !parent || child.run_id === parent.run_id) return
  const db = atlasDb(),
    c = db.prepare('SELECT account_id FROM execution_runs WHERE id=?').get(child.run_id),
    p = db.prepare('SELECT account_id FROM execution_runs WHERE id=?').get(parent.run_id)
  if (c.account_id !== p.account_id) throw Error('运行账号不一致')
  db.prepare(
    'UPDATE execution_runs SET parent_id=?,origin_ref=?,source=?,revision=revision+1 WHERE id=?'
  ).run(parent.run_id, originRef, source, child.run_id)
}
export function executionRunRow(id: string) {
  const row = atlasDb()
    .prepare('SELECT * FROM execution_runs WHERE id=? AND account_id=?')
    .get(id, executionAccount())
  if (!row) throw Error('运行记录不存在或不属于当前账号')
  return row
}
function projection(r: any) {
  const pending = ['queued', 'running', 'waiting', 'blocked', 'review'].includes(r.state)
  const currentStep = pending
    ? atlasDb()
        .prepare(
          "SELECT label,actor,state,summary,heartbeat_at FROM execution_steps WHERE run_id=? AND state IN ('running','waiting') ORDER BY CASE WHEN actor='system' THEN 1 ELSE 0 END,created_at DESC,rowid DESC LIMIT 1"
        )
        .get(r.id)
    : null
  return {
    ...r,
    state: r.paused && pending ? 'paused' : r.state,
    underlyingState: r.state,
    currentStep,
    destination: executionDestination(r.object_kind, r.object_id)
  }
}
export function executionList(input: any = {}) {
  const account = executionAccount(),
    page = Math.max(1, Math.min(100000, Math.floor(Number(input.page) || 1))),
    db = atlasDb()
  const where = ['r.account_id=?'],
    args: any[] = [account]
  if (input.objectId) {
    where.push(
      '(r.object_id=? OR EXISTS(SELECT 1 FROM execution_subjects s WHERE s.run_id=r.id AND s.ref_id=?))'
    )
    args.push(String(input.objectId).slice(0, 600), String(input.objectId).slice(0, 600))
  }
  if (input.agentId) {
    where.push('EXISTS(SELECT 1 FROM execution_steps s WHERE s.run_id=r.id AND s.actor=?)')
    args.push(input.agentId)
  }
  if (input.state === 'active')
    where.push(
      "r.state IN ('queued','running','waiting','blocked','review','uncertain','interrupted')"
    )
  else if (input.state && input.state !== 'all') {
    where.push(input.state === 'paused' ? 'r.paused=1' : 'r.state=?')
    if (input.state !== 'paused') args.push(input.state)
  }
  const filter = where.join(' AND ')
  const rows = db
    .prepare(
      'SELECT r.* FROM execution_runs r WHERE ' +
        filter +
        " ORDER BY CASE WHEN state IN ('uncertain','review','interrupted') THEN 0 WHEN state='running' THEN 1 ELSE 2 END,updated_at DESC,id LIMIT 20 OFFSET ?"
    )
    .all(...args, (page - 1) * 20)
  const counts = db
    .prepare('SELECT state,count(*) n FROM execution_runs WHERE account_id=? GROUP BY state')
    .all(account)
  const policy = atlasRead<any>('atlas-career-policy', {}),
    runningModels = db
      .prepare("SELECT count(*) n FROM ai_calls WHERE account_id=? AND status='running'")
      .get(account).n
  return {
    accountId: account,
    page,
    items: rows.map(projection),
    total: db.prepare('SELECT count(*) n FROM execution_runs r WHERE ' + filter).get(...args).n,
    counts,
    runningModels,
    automationPaused: policy.automationPaused !== false,
    sendingPaused: policy.sending?.paused !== false,
    at: now()
  }
}
export function executionDetail(id: string) {
  const run = executionRunRow(id),
    db = atlasDb(),
    links = db.prepare('SELECT * FROM execution_links WHERE run_id=?').all(id)
  const steps = db
    .prepare('SELECT * FROM execution_steps WHERE run_id=? ORDER BY created_at,rowid LIMIT 300')
    .all(id)
    .map((s: any) => ({ ...s, basis: JSON.parse(s.basis), output: JSON.parse(s.output) }))
  const taskLink = links.find((l: any) => l.kind === 'task' && l.ref_id === run.owner_id)
  const task = taskLink
    ? db
        .prepare('SELECT id,kind,state,result,input FROM task_runs WHERE id=? AND account_id=?')
        .get(taskLink.ref_id, run.account_id)
    : null
  let result = task?.result ? unpackAnalysis(db, JSON.parse(task.result)) : null,
    incoming = '',
    verification: any = null
  if (run.owner_id.startsWith('contact:')) {
    const row = db
      .prepare('SELECT * FROM contact_runs WHERE id=? AND account_id=?')
      .get(run.owner_id.slice(8), run.account_id)
    if (row) {
      const b = JSON.parse(row.body)
      result = {
        ...b.greeting,
        reason: b.reason,
        profileVersion: b.profileVersion,
        checks: b.match?.checks
      }
      verification = b.proof || null
    }
  }
  if (run.owner_id.startsWith('reply:')) {
    const event = atlasRead<any>('career-replies/' + run.owner_id.slice(6) + '.json', null)
    if (event?.userId === run.account_id) {
      result = {
        text: event.draft,
        reason: event.reason,
        profileVersion: event.profileVersion,
        evidenceIds: event.evidenceIds
      }
      incoming = event.incoming
    }
  }
  const sends = links
    .filter((l: any) => l.kind === 'send')
    .map((l: any) =>
      db
        .prepare(
          'SELECT id,status,text,created_at,updated_at,proof,context FROM send_attempts WHERE id=? AND account_id=?'
        )
        .get(l.ref_id, run.account_id)
    )
    .filter(Boolean)
    .map((s: any) => ({ ...s, proof: JSON.parse(s.proof), context: JSON.parse(s.context) }))
  const profileId =
    result?.profileVersion ||
    (task?.input ? JSON.parse(task.input)._taskBasis?.profileVersion : '') ||
    steps.map((s: any) => s.basis.profileVersion).find(Boolean)
  const profile = profileId
    ? db.prepare('SELECT value FROM profile_versions WHERE id=?').get(profileId)
    : null
  const facts = profile ? JSON.parse(profile.value) : null
  const ids = new Set<string>()
  const collect = (value: any, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 12) return
    for (const [key, v] of Object.entries(value)) {
      if ((key === 'evidenceIds' || key === 'sourceIds') && Array.isArray(v)) {
        for (const id of v)
          if (typeof id === 'string' && (key === 'evidenceIds' || id.startsWith('evidence:')))
            ids.add(id.replace(/^evidence:/, ''))
      } else if (key === 'evidenceId' && typeof v === 'string') ids.add(v.replace(/^evidence:/, ''))
      else collect(v, depth + 1)
    }
  }
  collect(result)
  for (const step of steps) collect(step.output)
  const evidence = (facts?.evidence || [])
    .filter((e: any) => ids.has(e.id))
    .map((e: any) => ({
      id: e.id,
      title: e.title,
      text: e.text,
      confirmed: e.confirmed,
      source: e.source
    }))
  const modelCalls = links
    .filter((l: any) => l.kind === 'model')
    .map((l: any) =>
      db
        .prepare(
          'SELECT id,model,status,usage,elapsed_ms FROM ai_calls WHERE id=? AND account_id=?'
        )
        .get(l.ref_id, run.account_id)
    )
    .filter(Boolean)
    .map((c: any) => ({ ...c, usage: c.usage ? JSON.parse(c.usage) : null }))
  const latestVersion = db
    .prepare('SELECT id FROM profile_versions ORDER BY version DESC LIMIT 1')
    .get()?.id
  return {
    run: projection(run),
    steps,
    links,
    result,
    incoming,
    evidence,
    profileVersion: profileId || '',
    profileStale: !!profileId && profileId !== latestVersion,
    verification,
    sends,
    modelCalls,
    children: db
      .prepare(
        'SELECT * FROM execution_runs WHERE parent_id=? AND account_id=? ORDER BY created_at DESC LIMIT 100'
      )
      .all(id, run.account_id)
      .map(projection),
    parent: run.parent_id
      ? db
          .prepare('SELECT id,title,state FROM execution_runs WHERE id=? AND account_id=?')
          .get(run.parent_id, run.account_id)
      : null,
    totalSteps: db.prepare('SELECT count(*) n FROM execution_steps WHERE run_id=?').get(id).n
  }
}
export function executionEvents(input: any) {
  executionRunRow(input.id)
  const after = Math.max(0, Math.floor(Number(input.after) || 0)),
    db = atlasDb()
  const rows = db
    .prepare(
      'SELECT * FROM execution_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT 100'
    )
    .all(input.id, after)
  return { items: rows, cursor: rows.at(-1)?.sequence || after, hasMore: rows.length === 100 }
}
export function setExecutionPaused(input: any) {
  return atlasTransaction(() => {
    const row = executionRunRow(input.id)
    if (row.revision !== input.baseRevision) throw Error('运行已变化，请刷新后重试')
    if (typeof input.paused !== 'boolean') throw Error('暂停参数无效')
    if (!['queued', 'running', 'waiting', 'blocked', 'review'].includes(row.state))
      throw Error('此状态不能恢复执行，请核对结果后从原入口创建新任务')
    const task = atlasDb()
      .prepare('SELECT kind FROM task_runs WHERE id=? AND account_id=?')
      .get(row.owner_id, row.account_id)
    if (
      !task ||
      (!task.kind.startsWith('career-') &&
        !['first-contact', 'conversation-reply', 'discovery-run'].includes(task.kind))
    )
      throw Error('此流程不支持局部暂停，请使用所属模块入口')
    atlasDb()
      .prepare('UPDATE execution_runs SET paused=?,revision=revision+1,updated_at=? WHERE id=?')
      .run(+input.paused, now(), row.id)
    executionEvent(
      row.id,
      '',
      'control',
      input.paused ? 'paused' : 'waiting',
      input.paused
        ? '本人暂停本条后续步骤；在途发送仍需核验'
        : '本人恢复本条后续步骤；仍需通过原有授权和检查'
    )
    return projection(executionRunRow(row.id))
  })
}
