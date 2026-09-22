import { registerInsights } from './atlas-insights'
import { registerMap } from './atlas-map'
import { registerExecution } from './atlas-execution-service'
import { registerCoordinator } from './atlas-coordinator'
import { validCoordinates } from '../../common/regions'
import { registerStorage } from './atlas-storage-health'
import { registerBackupTransfers } from './atlas-backup-transfer'
import { registerAgents } from './atlas-agents'
import { registerCompanyResearch } from './atlas-company-research'
import { registerPortfolio } from './atlas-portfolio'
import { registerContact, contactAction, contactRun } from './atlas-contact'
import { registerAssistant } from './atlas-assistant'
import { initializePolicy, policySnapshot, savePolicy } from './atlas-policy'
import { importHistoricalData, historyArchive, historicalApplications } from './atlas-history-import'
import { registerAdaptive } from './atlas-adaptive'
import { registerTaskQueue, createTask } from './atlas-task-queue'
import { registerCareerWorkspace } from './career-workspace-service'
import { registerCareerDashboard } from './career-dashboard-service'
import {
  atlasDb,
  atlasRead,
  atlasWrite,
  atlasEvent,
  atlasRevision,
  fingerprint
} from './atlas-store'
import { setRuntime, taskSnapshot, resolveSend } from './atlas-tasks'
import { registerDiscovery } from './atlas-discovery'
import { pipelineDetail, registerPipeline } from './atlas-pipeline'
import { registerBackup } from './atlas-backup'
import { analyzeJob } from './atlas-ai'
import { generateGreeting } from './atlas-greeting'
import { previewImport, commitImport } from './atlas-import'
import { readReplyEvents, saveReplyEvent } from './career-reply-store'
import { withCareerLock, checkRevision } from './career-file-state'
import { registerBossSync } from './atlas-boss-sync'
import { registerBossAccountSync } from './atlas-boss-account-state'
import { readBossNavigation } from './atlas-boss-navigation'

export async function fetchHistoricalRecords(payload: any) { return historicalApplications(payload) }

export function registerAtlasOperations(
  handle: (name: string, handler: (...args: any[]) => any) => void
) {
  handle('career-runtime-status', () => ({ protocol: 2, service: 'zhitu-atlas' }))
  registerAgents(handle)
  registerExecution(handle)
  registerInsights(handle)
  registerMap(handle)
  registerCoordinator(handle, createTask)
  registerCompanyResearch(handle)
  registerPortfolio(handle)
  registerContact(handle)
  registerAssistant(handle)
  registerTaskQueue(handle)
  registerAdaptive(handle)
  handle('career-policy-load', policySnapshot)
  handle('career-policy-save', (_, p) => savePolicy(p))
  handle('career-legacy-archive', (_, p) => historyArchive(p))
  registerDiscovery(handle)
  registerPipeline(handle)
  registerBossSync(handle)
  registerBossAccountSync(handle)
  const draftKey = (input: any) => {
    if (
      typeof input?.id !== 'string' ||
      input.id.length > 600 ||
      !atlasDb().prepare('SELECT 1 FROM opportunities WHERE id=?').get(input.id)
    )
      throw Error('请从已保存的机会打开招呼草稿')
    pipelineDetail(input.id)
    return 'atlas-opportunity-draft-' + fingerprint(input.id)
  }
  handle('career-opportunity-draft-load', (_, input) =>
    withCareerLock(() => {
      const key = draftKey(input)
      return { value: atlasRead(key, null), revision: atlasRevision([key]) }
    })
  )
  handle('career-opportunity-draft-save', (_, input) =>
    withCareerLock(() => {
      const key = draftKey(input)
      if (
        typeof input.text !== 'string' ||
        input.text.length > 1500 ||
        typeof input.basis !== 'string' ||
        input.basis.length > 45000
      )
        throw Error('草稿内容过长或格式无效')
      checkRevision(input.baseRevision, [key])
      atlasWrite(key, { text: input.text, basis: input.basis, updatedAt: new Date().toISOString() })
      return { revision: atlasRevision([key]) }
    })
  )
  registerBackup(handle)
  registerBackupTransfers(handle)
  registerStorage(handle)
  handle('career-ai-analyze', (_, input) => analyzeJob(input))
  handle('career-greeting-generate', (_, input) =>
    generateGreeting({ ...input, purpose: 'preview' })
  )
  handle('career-import-preview', (_, input) => previewImport(input))
  handle('career-import-commit', (_, input) => commitImport(input))
  const mapOrigin = () => ({
    value: atlasRead('atlas-map-origin', null),
    revision: atlasRevision(['atlas-map-origin'])
  })
  handle('career-map-origin', () => withCareerLock(mapOrigin))
  handle('career-map-origin-save', (_, request) =>
    withCareerLock(() => {
      checkRevision(request?.baseRevision, ['atlas-map-origin'])
      const input = request.value
      if (
        input !== null &&
        !validCoordinates(input?.lng,input?.lat)
      )
        throw new Error('请选择有效的通勤起点')
      atlasWrite(
        'atlas-map-origin',
        input ? { lng: input.lng, lat: input.lat, crs: 'wgs84' } : null
      )
      return mapOrigin()
    })
  )
  handle('career-boss-navigation', readBossNavigation)
  handle('career-tasks-load', taskSnapshot)
  handle('career-send-resolve', (_, input) =>
    withCareerLock(() => {
      const attempt=atlasDb().prepare('SELECT * FROM send_attempts WHERE id=?').get(input.id)
      const contactId=attempt && JSON.parse(attempt.context || '{}').contactId
      if(contactId){if(attempt.updated_at!==input.updatedAt)throw Error('发送结果已更新，请重新读取');const run=contactRun(contactId);contactAction({accountId:attempt.account_id,id:contactId,revision:run.revision,action:input.result});return true}
      resolveSend(input)
      const event = readReplyEvents().find((e) => e.id === input.id)
      if (event) {
        event.status =
          input.result === 'sent' ? 'sent' : input.result === 'not-sent' ? 'dismissed' : 'uncertain'
        event.reason = '本人核实：' + input.result
        saveReplyEvent(event)
      }
      return true
    })
  )
  handle('career-tasks-policy', (_, input) =>
    withCareerLock(() => {
      checkRevision(input?.baseRevision, ['atlas-runtime'])
      const result = setRuntime(input.policy)
      if(input.policy?.paused===false && result.outbound){const accountId=atlasRead<any>('career-boss-sync.json',null)?.account?.id;if(accountId)atlasWrite('atlas-contact-authorization',{accountId,at:new Date().toISOString()})}
      if (result.paused) (globalThis as any).__atlasStopAll?.()
      return result
    })
  )
  handle('career-tasks-pause', () => {
    const result = setRuntime({ paused: true })
    ;(globalThis as any).__atlasStopAll?.()
    return result
  })
  handle('career-reply-resolve', (_, input) =>
    withCareerLock(() => {
      if (!input || !['sent', 'not-sent', 'unknown'].includes(input.result))
        throw new Error('核实结果无效')
      const event = readReplyEvents().find((e) => e.id === input.id)
      if (!event || !['uncertain', 'sending'].includes(event.status))
        throw new Error('该消息无需核实')
      if (
        atlasDb()
          .prepare('SELECT owner FROM leases WHERE key=? AND expires_at>?')
          .get(`browser:boss:${event.userId}`, Date.now())
      )
        throw new Error('任务正在处理该账户，请暂停后等待收尾再核实')
      event.status =
        input.result === 'sent' ? 'sent' : input.result === 'not-sent' ? 'dismissed' : 'uncertain'
      event.reason =
        input.result === 'sent'
          ? '本人核实已发送'
          : input.result === 'not-sent'
            ? '本人核实未发送；本次结束，需要重新创建发送'
            : '本人核实仍无法确定'
      saveReplyEvent(event)
      atlasEvent('reply-resolved', event.id, { result: input.result })
      atlasDb()
        .prepare('UPDATE send_attempts SET status=?,updated_at=? WHERE id=?')
        .run(
          input.result === 'sent'
            ? 'sent'
            : input.result === 'not-sent'
              ? 'cancelled'
              : 'uncertain',
          new Date().toISOString(),
          event.id
        )
      return true
    })
  )
  handle('career-events', (_, id: string) =>
    atlasDb()
      .prepare('SELECT * FROM events WHERE entity_id=? ORDER BY created_at DESC LIMIT 200')
      .all(id)
      .map((r: any) => ({ ...r, value: JSON.parse(r.value) }))
  )
}
export function createAtlasHandlers(fetchRecords = fetchHistoricalRecords) {
  importHistoricalData()
  initializePolicy()
  const handlers = new Map<string, (...args: any[]) => any>()
  const register = (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler)
  registerCareerWorkspace(register, () => {
    throw new Error('请使用界面复制功能')
  })
  registerCareerDashboard(register, fetchRecords)
  registerAtlasOperations(register)
  handlers.delete('career-copy-text')
  return handlers
}
