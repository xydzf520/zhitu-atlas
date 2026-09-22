import { modelSettings } from './atlas-model-config'
import { indexOpportunity, pipelineDetail, pipelineStates } from './atlas-pipeline'
import { atlasDb, atlasRemove, atlasTransaction } from './atlas-store'
import { bossSyncCoverage } from './atlas-boss-sync'
import { profileHistory } from './atlas-profile'
import { readBossSync, enrichSyncedRecords } from './career-boss-data'
import { buildOpportunities, validateDashboardPreferences } from '../../common/dashboard'
import { validateReplySettings } from '../../common/auto-reply'
import {
  readLocalJson,
  writeLocalJson,
  readReplyEvents,
  readReplySettings,
  saveReplyEvent
} from './career-reply-store'
import {
  checkRevision,
  localRevision,
  readCareerSnapshot,
  withCareerLock,
  workspaceFiles
} from './career-file-state'

function replySnapshot() {
  const { settings, settingsRevision } = withCareerLock(() => ({
    settings: readReplySettings(),
    settingsRevision: localRevision(['career-auto-reply.json'])
  }))
  const heartbeat = readLocalJson<any>('career-reply-heartbeat.json', {})
  const userId =
    Date.now() - Date.parse(heartbeat.at || '') < 45000
      ? heartbeat.userId
      : readBossSync()?.account.id
  const all = readReplyEvents().filter((e) => !userId || e.userId === userId)
  const unresolved = all.filter((e) =>
    ['review', 'blocked', 'uncertain', 'queued', 'sending'].includes(e.status)
  )
  const unresolvedIds = new Set(unresolved.map((e) => e.id))
  const recent = all.filter((e) => !unresolvedIds.has(e.id)).slice(0, 200)
  const replies = [...unresolved, ...recent]
  const pendingCommands: Record<string, { action: string; text: string; at: string }> = {}
  for (const e of unresolved) {
    const c = readLocalJson<any>(`career-reply-commands/${e.id}.json`, null)
    if (c?.action === 'approve' && ['review', 'blocked'].includes(e.status))
      pendingCommands[e.id] = { action: c.action, text: c.text, at: c.at }
  }
  return {
    replySettings: settings,
    settingsRevision,
    replies,
    replyTotal: all.length,
    pendingCommands,
    heartbeat
  }
}
export function registerCareerDashboard(
  handle: (name: string, handler: (...args: any[]) => any) => void,
  fetchRecords: (payload: any) => Promise<any>
) {
  handle('career-dashboard-load', async () => {
    const snapshot = withCareerLock(readCareerSnapshot)
    const workspace = snapshot.state,
      sync = readBossSync()
    const reply = replySnapshot()
    let records: any
    try {
      records = await fetchRecords({
        name: workspace.profile.name || '',
        userId:
          Date.now() - Date.parse(reply.heartbeat.at || '') < 45000
            ? reply.heartbeat.userId || ''
            : sync?.account.id || ''
      })
      if (records?.error || !records?.data) throw new Error('database unavailable')
    } catch {
      records = {
        data: {
          applications: [],
          databaseAvailable: false,
          warning: '岗位数据库暂时不可读；个人资料与手动机会仍可使用。请稍后重试。'
        }
      }
    }
    atlasTransaction(() => {
      for (const item of buildOpportunities(
        workspace,
        enrichSyncedRecords(records.data, sync).applications || [],
        snapshot.preferences
      ))
        indexOpportunity(item)
    })
    const syncCoverage = bossSyncCoverage(sync?.account.id)
    return {
      workspace,
      revision: snapshot.revision,
      preferences: snapshot.preferences,
      profileVersion: profileHistory()[0]?.id || '',
      syncCoverage,
      opportunityStates: pipelineStates(),
      contactOutcomes: Object.fromEntries(atlasDb().prepare("SELECT job_id,state FROM contact_runs WHERE platform='boss' AND account_id=?").all(sync?.account.id || '').map((r:any)=>[`boss:${sync?.account.id}:job:${r.job_id}`,r.state])),
      records: enrichSyncedRecords(records.data, sync),
      connection: {
        mode: 'local',
        automatic: syncCoverage.automatic,
        database: records.data.databaseAvailable !== false,
        manualCount: workspace.opportunities.length,
        historyCount: records.data.applications?.length || 0,
        syncedCount: new Set((sync?.items || []).map((item) => item.bossId)).size,
        syncAt: readLocalJson<any>('career-data-heartbeat.json', {}).at || sync?.updatedAt || '',
        account: sync?.account.name || records.data.accountName || '',
        state: readLocalJson<any>('career-data-heartbeat.json', {}).state || 'waiting'
      },
      ...reply,
      model: (() => { const c = modelSettings(); return c.configured ? {name:c.model,provider:c.provider,officialDeepSeek:c.provider==='deepseek',contextWindowTokens:c.contextWindowTokens,maxOutputTokens:c.generation.max_tokens} : null })()
    }
  })
  handle('career-dashboard-save', () => {
    throw new Error('旧页面不能保存整份配置，请重新打开工作台')
  })
  handle('career-opportunity-save', (_, input: any) =>
    withCareerLock(() => {
      if (
        !input ||
        typeof input.id !== 'string' ||
        !input.id ||
        input.id.length > 600 ||
        ['__proto__', 'constructor', 'prototype'].includes(input.id)
      )
        throw new Error('机会标识无效')
      checkRevision(input.baseRevision, workspaceFiles)
      const { preferences } = readCareerSnapshot()
      const next = {
        ...preferences,
        overrides: { ...preferences.overrides, [input.id]: input.override }
      }
      validateDashboardPreferences(next)
      if (input.override.stage === '已结束' && !input.override.endReason?.trim())
        throw new Error('请填写结束原因；尚未核实时可填写待核实')
      writeLocalJson('career-dashboard.json', next)
      try {
        const old = pipelineDetail(input.id).body
        indexOpportunity({
          ...old,
          ...input.override,
          job: { ...old.job, address: input.override.address ?? old.job.address }
        })
      } catch (e: any) {
        if (!String(e.message).includes('请先从')) throw e
      }
      return { preferences: next, revision: localRevision(workspaceFiles) }
    })
  )
  handle(
    'career-reply-settings-save',
    (_, input: string | { settings: string; baseRevision: string }) =>
      withCareerLock(() => {
        if (typeof input === 'string') throw new Error('旧页面不能保存回复策略，请重新打开工作台')
        const payload = input?.settings
        if (typeof payload !== 'string' || payload.length > 5000) throw new Error('配置无效')
        const v = JSON.parse(payload)
        validateReplySettings(v)
        checkRevision(input.baseRevision, ['career-auto-reply.json'])
        const old = readReplySettings()
        v.activatedAt =
          old.mode !== 'auto' && v.mode === 'auto' ? new Date().toISOString() : old.activatedAt
        writeLocalJson('career-auto-reply.json', v)
        return { settings: v, revision: localRevision(['career-auto-reply.json']) }
      })
  )
  handle('career-reply-pause', () =>
    withCareerLock(() => {
      const settings = { ...readReplySettings(), mode: 'off' as const }
      writeLocalJson('career-auto-reply.json', settings)
      return { settings, revision: localRevision(['career-auto-reply.json']) }
    })
  )
  handle('career-reply-command', (_, payload: { id: string; action: string; text: string }) =>
    withCareerLock(() => {
      if (
        !payload ||
        !/^[a-f0-9]{64}$/.test(payload.id) ||
        !['approve', 'dismiss'].includes(payload.action) ||
        typeof payload.text !== 'string' ||
        payload.text.length > 1500 ||
        (payload.action === 'approve' && !payload.text.trim())
      )
        throw new Error('回复内容无效（最多 1500 字）')
      const event = readReplyEvents().find((e) => e.id === payload.id)
      if (!event || !['review', 'blocked'].includes(event.status))
        throw new Error('该消息状态已变化，请更新记录后重试')
      const commandFile = `career-reply-commands/${payload.id}.json`
      const existing = readLocalJson<any>(commandFile, null)
      if (existing && payload.action === 'approve') {
        if (existing.action === 'approve' && existing.text === payload.text.trim()) return true
        throw new Error('这条消息已确认排队，不能重复提交不同内容。')
      }
      if (payload.action === 'dismiss') {
        // A local dismissal works even when BOSS is disconnected or the assistant is paused.
        event.status = 'dismissed'
        event.reason = '本人忽略，此消息不再回复'
        saveReplyEvent(event)
        atlasRemove(commandFile)
      } else
        writeLocalJson(commandFile, {
          ...payload,
          text: payload.text.trim(),
          at: new Date().toISOString()
        })
      return true
    })
  )
  handle('career-reply-status', replySnapshot)
}
