import { recordTask } from './atlas-task-records'
import { atlasDb, atlasRead, atlasWrite, fingerprint, atlasTransaction } from './atlas-store'

export const accountSyncSettings = () => atlasRead('atlas-boss-sync-settings', { enabled: true })
export const accountSyncKey = (account: string) => 'atlas-boss-account-sync-' + fingerprint(account)
export function accountSyncState(account: string) {
  const settings = accountSyncSettings()
  const state = atlasRead<any>(accountSyncKey(account), {})
  return { ...state, enabled: settings.enabled, accountId: account,
    state: !settings.enabled ? 'paused' : state.state || 'waiting',
    fresh: !!state.at && Date.now() - Date.parse(state.at) < 45000 }
}
export function updateAccountSync(account: string, patch: any) {
  if (!account) return
  atlasTransaction(() => {
    const value={...atlasRead<any>(accountSyncKey(account),{}),...patch,accountId:account,at:new Date().toISOString()}
    atlasWrite(accountSyncKey(account),value)
    recordTask({id:'sync:'+account,kind:'boss-sync',accountId:account,state:value.state || 'waiting',step:value.message || '等待同步',result:{discovered:value.discovered,completed:value.completed,listFinished:value.listFinished},error:value.lastError})
  })
}
export const bossJobReadKey = (account: string, id: string) => 'atlas-boss-job-read-' + account + '-' + id
export function bossJobReadState(account: string, id: string) {
  return atlasRead<any>(bossJobReadKey(account, id), {})
}
export function recordBossJobRead(account: string, id: string, result: { state: string; reason: string }) {
  atlasWrite(bossJobReadKey(account, id), { version: 3, at: new Date().toISOString(), ...result })
}
export function acknowledgeBossConversation(input: any) {
  const account = atlasRead<any>('career-boss-sync.json', null)?.account?.id
  if (!account || input?.accountId !== account) throw Error('账号已变化，请重新读取会话')
  atlasTransaction(() => {
    const db = atlasDb(), row = db.prepare("SELECT body FROM platform_conversations WHERE platform='boss' AND account_id=? AND source_id=?").get(account, input.bossId)
    if (!row) return
    const body = JSON.parse(row.body)
    // Acknowledge exactly the alert the user saw, never a newer arrival.
    if (input.alertKey !== body.atlasAlertKey) return
    body.atlasUnreadCount = 0
    body.atlasAcknowledgedKey = body.atlasAlertKey
    db.prepare("UPDATE platform_conversations SET body=? WHERE platform='boss' AND account_id=? AND source_id=?").run(JSON.stringify(body), account, input.bossId)
  })
}
export function registerBossAccountSync(handle: (name: string, handler: (...args: any[]) => any) => void) {
  handle('career-boss-sync-control', (_, input) => {
    const account = atlasRead<any>('career-boss-sync.json', null)?.account?.id
    if (input?.accountId && input.accountId !== account) throw Error('账号已变化，请刷新同步结果后重试')
    if (input?.action !== 'sync-now' && typeof input?.enabled !== 'boolean') throw Error('同步开关无效')
    if (input?.action === 'sync-now' && !account) throw Error('请先在桌面 BOSS 工作台登录并核实账号')
    return atlasTransaction(() => {
      const enabled = input.action === 'sync-now' ? true : input.enabled
      atlasWrite('atlas-boss-sync-settings', { enabled })
      // A user-requested round can retry missing fields without the old 24h
      // checkpoint. Keep sending policy completely separate from reading.
      if (account) updateAccountSync(account, { retryRequestedAt: new Date().toISOString(),
        ...(enabled ? { state: 'queued', message: '已请求重新读取，等待桌面同步器接收' } : { state: 'paused', message: '账号读取已暂停，已同步数据保留' }) })
      return accountSyncState(account || '')
    })
  })
  handle('career-boss-conversation-ack', (_, input) => acknowledgeBossConversation(input))
}
