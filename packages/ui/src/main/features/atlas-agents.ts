import { executionLink, updateExecutionStep } from './atlas-execution'
import { AGENT_DEFINITIONS, AGENT_RULES, type AgentId } from '../../common/agents'
import {
  atlasDb,
  atlasRead,
  atlasWrite,
  atlasRevision,
  atlasTransaction,
  atlasEvent,
  fingerprint
} from './atlas-store'

const configKey = (id: string) => 'atlas-agent-config/' + id
const account = () => atlasRead<any>('career-boss-sync.json', null)?.account?.id || 'local'
export function agentDefinition(id: string) {
  const definition = AGENT_DEFINITIONS.find((a) => a.id === id)
  if (!definition) throw Error('Agent 不存在')
  return definition
}
export function agentConfig(id: string) {
  const definition = agentDefinition(id),
    saved = atlasRead<any>(configKey(id), null)
  const prompt = saved?.prompt ?? definition.defaultPrompt
  const enabled = saved?.enabled !== false
  return {
    id: definition.id,
    prompt,
    enabled,
    version: saved?.version || 1,
    updatedAt: saved?.updatedAt || null,
    revision: atlasRevision([configKey(id)]),
    signature: fingerprint([
      id,
      prompt,
      enabled,
      definition.variants,
      definition.output,
      AGENT_RULES
    ])
  }
}
export function resolveAgent(id: AgentId, variant = '') {
  const definition = agentDefinition(id),
    config = agentConfig(id)
  if (!config.enabled) throw Error(`${definition.label} Agent 已停用，请在 Agent 管理中启用`)
  if (variant && !definition.variants[variant]) throw Error('Agent 场景不存在')
  const system = [
    config.prompt,
    variant ? definition.variants[variant] : '',
    '程序约束与输出协议（不可由自定义提示词解除）：' + AGENT_RULES,
    '必须保留的输出字段：' + definition.output
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    ...config,
    label: definition.label,
    variant,
    system,
    promptId: fingerprint([config.signature, config.version, variant, system])
  }
}
export type AgentSnapshot = ReturnType<typeof resolveAgent>
export function assertAgentCurrent(snapshot: AgentSnapshot) {
  const current = agentConfig(snapshot.id)
  if (!current.enabled) throw Error(`${snapshot.label} Agent 已停用，本次调用已停止`)
  if (current.signature !== snapshot.signature || current.revision !== snapshot.revision)
    throw Error(`${snapshot.label} 提示词已更新，本次旧版本结果不再采用，请重新运行`)
}
export function agentVersion(base: string, ids: AgentId[]) {
  // Default prompts and program constraints change on upgrades too. Old reports
  // remain readable, but must not authorize actions using a superseded prompt.
  return base + ':' + fingerprint(ids.map(id => {
    const c = agentConfig(id)
    return [id, c.version, c.signature]
  })).slice(0, 20)
}
export function saveAgent(input: any) {
  return atlasTransaction(() => {
    const definition = agentDefinition(input?.id),
      current = agentConfig(definition.id)
    if (input.baseRevision !== current.revision)
      throw Error('另一个窗口已修改此 Agent。你的草稿已保留，请读取最新版本后核对。')
    if (
      typeof input.enabled !== 'boolean' ||
      typeof input.prompt !== 'string' ||
      input.prompt.trim().length < 10 ||
      input.prompt.length > 20000
    )
      throw Error('提示词需为 10–20000 字，启用状态必须有效')
    if (/\b(?:sk-|user_)[A-Za-z0-9_-]{10,}|-----BEGIN.*PRIVATE KEY/.test(input.prompt))
      throw Error('提示词中不能保存 API 密钥，请在模型设置中配置凭据')
    if (current.prompt === input.prompt && current.enabled === input.enabled)
      return agentConfig(definition.id)
    const updatedAt = new Date().toISOString(),
      value = {
        prompt: input.prompt,
        enabled: input.enabled,
        version: current.version + 1,
        updatedAt
      }
    // Version history is configuration, separate from operational logs and model inputs.
    atlasWrite(`atlas-agent-history/${definition.id}/${current.version}`, { ...current })
    atlasWrite(configKey(definition.id), value)
    atlasEvent('agent-config-changed', definition.id, {
      version: value.version,
      enabled: value.enabled
    })
    return agentConfig(definition.id)
  })
}
export function recordAgentCall(id: string, snapshot: AgentSnapshot) {
  atlasWrite('atlas-agent-prompt/' + snapshot.promptId, {
    id: snapshot.id,
    label: snapshot.label,
    version: snapshot.version,
    variant: snapshot.variant,
    signature: snapshot.signature,
    system: snapshot.system
  })
  atlasWrite('atlas-agent-call/' + id, {
    agentId: snapshot.id,
    promptId: snapshot.promptId,
    version: snapshot.version,
    variant: snapshot.variant,
    processId: process.pid
  })
}
function reconcileInterruptedCalls() {
  const rows = atlasDb().prepare("SELECT c.id,c.created_at,d.value metadata FROM ai_calls c LEFT JOIN documents d ON d.key='atlas-agent-call/'||c.id WHERE c.status='running'").all()
  for (const row of rows) {
    const pid = row.metadata ? JSON.parse(row.metadata).processId : null
    let interrupted = Date.now() - Date.parse(row.created_at) > 45 * 60 * 1000
    if (Number.isSafeInteger(pid) && pid > 0) {
      try { process.kill(pid, 0) } catch (e: any) { if (e.code === 'ESRCH') interrupted = true }
    }
    if (interrupted) {
      atlasDb().prepare("UPDATE ai_calls SET status='interrupted' WHERE id=? AND status='running'").run(row.id)
      const linked=executionLink('model',row.id)
      if(linked)updateExecutionStep(linked.step_id,'interrupted','原模型进程已结束或超过最长时限；不会自动重试')
    }
  }
}
export function agentCalls(input: any = {}) {
  reconcileInterruptedCalls()
  const page = Math.max(1, Math.min(100000, Math.floor(Number(input.page) || 1)))
  const id = input.agentId ? agentDefinition(input.agentId).id : ''
  const filter = id
    ? " AND (json_extract(d.value,'$.agentId')=? OR (d.key IS NULL AND c.kind=?))"
    : ''
  const args: any[] = [account(), ...(id ? [id, id] : [])]
  const from =
    " FROM ai_calls c LEFT JOIN documents d ON d.key='atlas-agent-call/'||c.id WHERE c.account_id=?" +
    filter
  const items = atlasDb()
    .prepare(
      'SELECT c.*,d.value metadata' +
        from +
        ' ORDER BY c.created_at DESC,c.id DESC LIMIT 20 OFFSET ?'
    )
    .all(...args, (page - 1) * 20)
    .map((r: any) => {
      const m = r.metadata ? JSON.parse(r.metadata) : null
      const agentId = m?.agentId || r.kind,
        definition = AGENT_DEFINITIONS.find((a) => a.id === agentId)
      return {
        id: r.id,
        executionId:executionLink('model',r.id)?.run_id || '',
        agentId,
        label: definition?.label || r.kind,
        status: r.status,
        automatic: !!r.automatic,
        model: r.model,
        usage: r.usage ? JSON.parse(r.usage) : null,
        elapsedMs: r.status === 'running' ? Date.now() - Date.parse(r.created_at) : r.elapsed_ms,
        createdAt: r.created_at,
        version: m?.version || null,
        promptAvailable: !!m,
        variant: m?.variant || '',
        legacy: !m
      }
    })
  return {
    page,
    items,
    total: atlasDb()
      .prepare('SELECT count(*) n' + from)
      .get(...args).n
  }
}
export function agentCallDetail(input: any) {
  if (typeof input?.id !== 'string' || input.id.length > 100) throw Error('调用记录无效')
  const call = atlasDb()
    .prepare('SELECT * FROM ai_calls WHERE id=? AND account_id=?')
    .get(input.id, account())
  if (!call) throw Error('调用记录不存在或不属于当前账号')
  const metadata = atlasRead<any>('atlas-agent-call/' + input.id, null)
  const prompt = metadata ? atlasRead<any>('atlas-agent-prompt/' + metadata.promptId, null) : null
  return {
    id: input.id,
    prompt,
    gateway: atlasRead('atlas-model-call/' + input.id, null),
    note: prompt
      ? '这是此次调用实际使用的系统提示词；动态 JD、简历与消息仅在调用时注入，未复制到提示词记录。'
      : '此历史调用没有保存提示词快照，无法还原当时的内容。'
  }
}
export function agentOverview() {
  reconcileInterruptedCalls()
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }),
    db = atlasDb()
  const counts = db
    .prepare(
      `SELECT COALESCE(json_extract(d.value,'$.agentId'),c.kind) agentId,c.status,count(*) n,
    sum(COALESCE(json_extract(c.usage,'$.total_tokens'),0)) tokens FROM ai_calls c LEFT JOIN documents d ON d.key='atlas-agent-call/'||c.id
    WHERE c.account_id=? AND c.day=? GROUP BY agentId,c.status`
    )
    .all(account(), day)
  return {
    day,
    accountId: account(),
    rules: AGENT_RULES,
    agents: AGENT_DEFINITIONS.map((definition) => {
      const config = agentConfig(definition.id),
        stats = counts.filter((r: any) => r.agentId === definition.id)
      return {
        ...definition,
        ...config,
        callsToday: stats
          .filter((r: any) => r.status !== 'cached')
          .reduce((n: number, r: any) => n + r.n, 0),
        cachedToday: stats
          .filter((r: any) => r.status === 'cached')
          .reduce((n: number, r: any) => n + r.n, 0),
        running: db
          .prepare(
            "SELECT count(*) n FROM ai_calls c LEFT JOIN documents d ON d.key='atlas-agent-call/'||c.id WHERE c.account_id=? AND c.status='running' AND COALESCE(json_extract(d.value,'$.agentId'),c.kind)=?"
          )
          .get(account(), definition.id).n,
        tokensToday: stats.reduce((n: number, r: any) => n + r.tokens, 0)
      }
    }),
    deterministic: [
      { label: '岗位搜索与详情采集', detail: '浏览器读取与去重；搜索扩展词可由策略 Agent 建议。' },
      { label: '账号与会话同步', detail: '读取账号、消息与岗位，不调用大模型。' },
      {
        label: '资格、额度与发送核验',
        detail: '程序校验城市、薪资、事实确认、限额及回读；模型不能解除这些规则。'
      }
    ]
  }
}
export function registerAgents(handle: (name: string, fn: (...args: any[]) => any) => void) {
  handle('career-agents-load', agentOverview)
  handle('career-agent-save', (_, p) => saveAgent(p))
  handle('career-agent-calls', (_, p) => agentCalls(p))
  handle('career-agent-call-detail', (_, p) => agentCallDetail(p))
  handle('career-agent-history', (_, p) => {
    const id = agentDefinition(p?.id).id
    return atlasDb()
      .prepare(
        "SELECT value FROM documents WHERE key LIKE ? ORDER BY CAST(json_extract(value,'$.version') AS INTEGER) DESC LIMIT 30"
      )
      .all(`atlas-agent-history/${id}/%`)
      .map((r: any) => JSON.parse(r.value))
  })
}
