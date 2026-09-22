import { contactBaseMatch, finishContactMatch } from '../../common/contact'
import { recordTask } from './atlas-task-records'
import { withExecutionTask, executionLink, linkExecution, taskExecutionPaused } from './atlas-execution'
import { policyExclusions, policyVerification } from './atlas-policy'
import { setInterval as leaseInterval, clearInterval as clearLeaseInterval } from 'node:timers'
import { randomUUID } from 'node:crypto'
import {
  atlasDb,
  atlasRead,
  atlasWrite,
  atlasTransaction,
  atlasEvent,
  atlasRevision
} from './atlas-store'
import { type CareerJob, type CareerProfile } from '../../common/career'

export interface RuntimePolicy {
  paused: boolean
  outbound: boolean
  dailyLimit: number
  firstContactLimit: number
  startHour: number
  endHour: number
  cooldownMinutes: number
}
export const defaultRuntime = (): RuntimePolicy => ({
  paused: true,
  outbound: true,
  dailyLimit: 20,
  firstContactLimit: 10,
  startHour: 9,
  endHour: 21,
  cooldownMinutes: 10
})
export const runtimePolicy = (): RuntimePolicy => atlasRead<any>('atlas-career-policy', null)?.sending || atlasRead('atlas-runtime', defaultRuntime())
export function setRuntime(input: Partial<RuntimePolicy>) {
  const v = { ...runtimePolicy(), ...input }
  if (
    typeof v.paused !== 'boolean' ||
    typeof v.outbound !== 'boolean' ||
    !Number.isInteger(v.dailyLimit) ||
    v.dailyLimit < 1 ||
    v.dailyLimit > 100 ||
    !Number.isInteger(v.firstContactLimit) ||
    v.firstContactLimit < 0 ||
    v.firstContactLimit > v.dailyLimit ||
    !Number.isInteger(v.startHour) ||
    !Number.isInteger(v.endHour) ||
    v.startHour < 0 ||
    v.startHour >= v.endHour ||
    v.endHour > 24 ||
    !Number.isInteger(v.cooldownMinutes) ||
    v.cooldownMinutes < 10
  )
    throw new Error('任务策略无效')
  atlasWrite('atlas-runtime', v)
  atlasEvent('runtime-policy', 'runtime', v)
  return v
}
export function acquireLease(key: string, ttl = 90000) {
  const owner = randomUUID(),
    now = Date.now()
  const result = atlasDb()
    .prepare(
      'INSERT INTO leases VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at WHERE leases.expires_at<?'
    )
    .run(key, owner, now + ttl, now)
  return result.changes ? owner : null
}
export function releaseLease(key: string, owner: string) {
  atlasDb().prepare('DELETE FROM leases WHERE key=? AND owner=?').run(key, owner)
}
export function autoContactDecision(job: CareerJob, profile: CareerProfile) {
  const restrictions = [...policyExclusions(job),...policyVerification(job)]
  if(restrictions.length)return restrictions[0]
  return finishContactMatch(contactBaseMatch(job, profile)).reasons[0] || ''
}
export interface SendAttempt {
  id: string
  platform: string
  accountId: string
  recipientId: string
  kind: 'first-contact' | 'reply' | 'follow-up'
  automatic: boolean
  text: string
  context?: Record<string, any>
}
export function claimSend(a: SendAttempt, now = Date.now()): string {
  return atlasTransaction(() => {
    const policy = runtimePolicy(),
      db = atlasDb()
    const ownerTask=a.context?.contactId?'contact:'+a.context.contactId:'reply:'+a.id
    if(taskExecutionPaused(ownerTask))return '本条流程已暂停'
    if (atlasRead<any>('atlas-career-policy', null)?.automationPaused) return '全部自动任务已暂停'
    if (policy.paused) return '自动发送已暂停'
    if (a.kind === 'first-contact' && !policy.outbound) return '主动联系未开启'
    if (db.prepare('SELECT id FROM send_attempts WHERE id=?').get(a.id))
      return '已有发送尝试，请核实结果'
    if (a.automatic) {
      const hour = Number(
        new Date(now).toLocaleString('en-GB', {
          timeZone: 'Asia/Shanghai',
          hour: '2-digit',
          hour12: false
        })
      )
      if (hour < policy.startHour || hour >= policy.endHour) return '当前不在自动发送时段'
      const day = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
      const start = new Date(day + 'T00:00:00+08:00').toISOString()
      const rows = db
        .prepare(
          "SELECT * FROM send_attempts WHERE automatic=1 AND created_at>=? AND status IN ('sending','sent','uncertain')"
        )
        .all(start)
      const reservations = db.prepare('SELECT COALESCE(sum(slots),0) slots,COALESCE(sum(first_contact),0) first FROM contact_reservations WHERE day=?').get(day)
      if (rows.length + reservations.slots >= policy.dailyLimit) return '达到两平台合计每日上限'
      if (
        a.kind === 'first-contact' &&
        rows.filter((r: any) => r.kind === 'first-contact').length + reservations.first >= policy.firstContactLimit
      )
        return '达到每日首条招呼上限'
      const same = db
        .prepare(
          "SELECT created_at FROM send_attempts WHERE platform=? AND account_id=? AND recipient_id=? AND automatic=1 AND created_at>=? AND status IN ('sending','sent','uncertain')"
        )
        .all(a.platform, a.accountId, a.recipientId, new Date(now - 86400000).toISOString())
      if (same.length >= 3) return '该会话 24 小时内已自动沟通三次'
      if (same.some((r: any) => now - Date.parse(r.created_at) < policy.cooldownMinutes * 60000))
        return '同一会话冷却中'
    }
    const at = new Date(now).toISOString()
    db.prepare('INSERT INTO send_attempts(id,platform,account_id,recipient_id,kind,automatic,status,text,created_at,updated_at,context) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
      a.id,
      a.platform,
      a.accountId,
      a.recipientId,
      a.kind,
      +a.automatic,
      'sending',
      a.text,
      at,
      at,
      JSON.stringify(a.context || {})
    )
    withExecutionTask(ownerTask,()=>recordTask({id:'send:'+a.id,kind:'send-'+a.kind,accountId:a.accountId,state:'sending',step:'发送已预留，等待平台核验',createdAt:at,input:{bossId:a.recipientId,automatic:a.automatic},result:{attemptId:a.id}}))
    const link=executionLink('task','send:'+a.id)
    if(link)linkExecution(link.run_id,'send',a.id,link.step_id)
    return ''
  })
}
export function finishSend(id: string, status: 'sent' | 'uncertain' | 'cancelled') {
  atlasDb()
    .prepare('UPDATE send_attempts SET status=?,updated_at=? WHERE id=?')
    .run(status, new Date().toISOString(), id)
  const row=atlasDb().prepare('SELECT * FROM send_attempts WHERE id=?').get(id)
  if(row)recordTask({id:'send:'+id,kind:'send-'+row.kind,accountId:row.account_id,state:status,step:status==='uncertain'?'发送结果不确定，请人工核实':status==='sent'?(JSON.parse(row.proof || '{}').method==='manual'?'本人确认已发送':'平台发送已核验'):'发送已取消',createdAt:row.created_at,result:{attemptId:id}})
}
export function recoverAbandonedSends(now = Date.now()) {
  // A dead process cannot verify a completed click. Never replay its reservation.
  return atlasTransaction(() => {
    const rows = atlasDb().prepare("SELECT id FROM send_attempts WHERE status='sending' AND updated_at<? AND NOT EXISTS(SELECT 1 FROM leases WHERE key='browser:'||send_attempts.platform||':'||send_attempts.account_id AND expires_at>?)").all(new Date(now - 90000).toISOString(), now)
    for (const row of rows) finishSend(row.id, 'uncertain')
    return rows.length
  })
}
export function resolveSend(input: {
  id: string
  result: 'sent' | 'not-sent' | 'unknown'
  updatedAt: string
}) {
  return atlasTransaction(() => {
    const row = atlasDb().prepare('SELECT * FROM send_attempts WHERE id=?').get(input?.id)
    if (
      !row ||
      !['uncertain', 'sending'].includes(row.status) ||
      !['sent', 'not-sent', 'unknown'].includes(input.result)
    )
      throw new Error('该发送记录无法核实')
    if (row.updated_at !== input.updatedAt) throw new Error('发送结果已更新，请重新读取后核实')
    if (
      atlasDb()
        .prepare('SELECT owner FROM leases WHERE key=? AND expires_at>?')
        .get(`browser:${row.platform}:${row.account_id}`, Date.now())
    )
      throw new Error('该账户仍在处理，请先暂停任务并等待收尾')
    atlasDb().prepare('UPDATE send_attempts SET proof=? WHERE id=?').run(JSON.stringify({method:'manual',result:input.result,at:new Date().toISOString()}),row.id)
    finishSend(
      row.id,
      input.result === 'sent' ? 'sent' : input.result === 'not-sent' ? 'cancelled' : 'uncertain'
    )
    atlasEvent('send-resolved', row.id, { result: input.result })
    return true
  })
}
export function taskSnapshot() {
  recoverAbandonedSends()
  return {
    policy: runtimePolicy(),
    policyRevision: atlasRevision(['atlas-runtime']),
    lastError: atlasRead('atlas-worker-last-error', null),
    outboundBlocked: atlasRead('atlas-outbound-blocked', null),
    outboundDraft: atlasRead('atlas-outbound-draft', null),
    sends: atlasDb()
      .prepare('SELECT * FROM send_attempts ORDER BY created_at DESC LIMIT 200')
      .all(),
    leases: atlasDb()
      .prepare('SELECT key,expires_at FROM leases WHERE expires_at>?')
      .all(Date.now())
  }
}

// Keep ownership during long model calls; a crashed process expires within 90 seconds.
export function keepLeaseAlive(key: string, owner: string, onLost?: () => void) {
  const timer = leaseInterval(() => {
    try {
      const renewed = atlasDb()
        .prepare('UPDATE leases SET expires_at=? WHERE key=? AND owner=? AND expires_at>?')
        .run(Date.now() + 90000, key, owner, Date.now()).changes
      if (!renewed) {
        clearLeaseInterval(timer)
        onLost?.()
      }
    } catch {
      clearLeaseInterval(timer)
      onLost?.()
    }
  }, 20000)
  timer.unref()
  return () => clearLeaseInterval(timer)
}
