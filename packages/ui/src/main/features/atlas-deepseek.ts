import { modelConfig, assertModelCurrent, modelForTask } from './atlas-model-config'
import { modelJsonTransport, evidenceTools, diagnosticTool, type ReadTool } from './atlas-model-transport'
import { randomUUID } from 'node:crypto'
import { atlasDb, atlasRead, atlasTransaction } from './atlas-store'
import { acquireLease, releaseLease, keepLeaseAlive } from './atlas-tasks'
import { careerPolicy, allAutomationPaused } from './atlas-policy'
import { atlasWrite } from './atlas-store'
import { setInterval, clearInterval } from 'node:timers'
import { resolveAgent, assertAgentCurrent, recordAgentCall, type AgentSnapshot } from './atlas-agents'
import type { AgentId } from '../../common/agents'
import { beginModelExecution, finishModelExecution, updateExecutionStep, modelExecutionOutput, executionPaused, withExecutionScope, executionRule } from './atlas-execution'

export const deepseekConfig = modelConfig
export async function deepseekJson(
  config: ReturnType<typeof deepseekConfig>,
  system: string,
  input: unknown,
  signal: AbortSignal,
  meta: { kind?: string; accountId?: string; automatic?: boolean; agent?: AgentSnapshot; diagnostic?: boolean; tools?: ReadTool[] } = {}
) {
  const accountId = meta.accountId || atlasRead<any>('career-boss-sync.json', null)?.account?.id || 'local'
  const kind = meta.kind || 'greeting', day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  const agent = meta.diagnostic ? null : meta.agent || resolveAgent(kind as AgentId)
  const checkCurrent = () => { if (agent) assertAgentCurrent(agent); assertModelCurrent(config); if(executionPaused()) throw Error('本条流程已暂停；进行中的模型调用不会自动重试') }
  // Even compatibility calls use the central definition; no hidden prompt bypass.
  system = agent?.system || system
  checkCurrent()
  const id = randomUUID()
  const execution = beginModelExecution(id,accountId,agent?.id || kind,{model:config.model,promptId:agent?.promptId || '',version:agent?.version || null,automatic:!!meta.automatic,profileVersion:atlasDb().prepare('SELECT id FROM profile_versions ORDER BY version DESC LIMIT 1').get()?.id || ''})
  const toolSteps = new Map<string,string>()
  let owner: string | null = null
  const started = Date.now()
  try { while (!(owner = acquireLease('model:official-deepseek'))) {
    checkCurrent()
    if (signal.aborted || Date.now() - started > 45 * 60 * 1000) throw Error('模型排队已取消或超时')
    await new Promise(resolve => setTimeout(resolve, 500))
  } } catch(e:any) {finishModelExecution(execution,'cancelled',e.message);throw e}
  const controller = new AbortController(), cancel = () => controller.abort()
  signal.addEventListener('abort',cancel,{once:true})
  if(signal.aborted)controller.abort()
  const timeout=setTimeout(cancel,45*60*1000)
  const stopLease = keepLeaseAlive('model:official-deepseek', owner, cancel)
  let agentError = ''
  let traceHeartbeat = 0
  const watchAgent = setInterval(() => {
    try { checkCurrent() } catch (e: any) { agentError = e.message; controller.abort() }
    if(Date.now()-traceHeartbeat>10000){traceHeartbeat=Date.now();atlasDb().prepare('UPDATE execution_steps SET heartbeat_at=? WHERE id=?').run(new Date().toISOString(),execution.stepId)}
  }, 750)
  watchAgent.unref()
  try {
    checkCurrent()
    if (controller.signal.aborted) throw Error('模型任务已取消')
    atlasTransaction(() => {
      if (meta.automatic && allAutomationPaused()) throw Error('全部自动任务已暂停')
      if (kind === 'coordinator' && atlasDb().prepare("SELECT count(*) n FROM ai_calls WHERE day=? AND kind='coordinator' AND status<>'cached'").get(day).n >= 2)
        throw Error('今日求职安排的 AI 调整已使用 2 次；规则安排与已有任务仍可查看')
      if (meta.automatic && ['analysis', 'strategy'].includes(kind)) {
        const limit = kind === 'analysis' ? careerPolicy().discovery.aiLimit : careerPolicy().discovery.strategyLimit
        const count = atlasDb().prepare('SELECT count(*) n FROM ai_calls WHERE day=? AND kind=? AND automatic=1').get(day, kind).n
        if (count >= limit) throw Error('已达到今日' + (kind === 'analysis' ? '岗位分析' : '策略复盘') + '预算')
      }
      atlasDb().prepare('INSERT INTO ai_calls VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, accountId, kind, day, +!!meta.automatic, config.model, 'running', JSON.stringify({requestCount:0}), 0, new Date().toISOString())
      if (agent) recordAgentCall(id, agent)
      finishModelExecution(execution,'running','模型请求已开始')
    })
  const result = await withExecutionScope(execution,()=>modelJsonTransport(modelForTask(config, kind), system, input, controller.signal, {
    maxToolCalls: kind === 'company-research' ? 6 : 4,
    tools: meta.tools || (meta.diagnostic ? [diagnosticTool()] : config.toolsEnabled && !(meta.automatic && kind === 'strategy') ? evidenceTools(input) : []),
    beforeRequest: () => {
      checkCurrent()
      atlasTransaction(() => {
        if (meta.automatic && allAutomationPaused()) throw Error('全部自动任务已暂停')
        if (meta.automatic && ['analysis','strategy'].includes(kind)) {
          const limit = kind === 'analysis' ? careerPolicy().discovery.aiLimit : careerPolicy().discovery.strategyLimit
          const used = atlasDb().prepare("SELECT COALESCE(sum(COALESCE(json_extract(usage,'$.requestCount'),1)),0) n FROM ai_calls WHERE day=? AND kind=? AND automatic=1 AND status<>'cached'").get(day,kind).n
          if (used >= limit) throw Error('已达到今日模型生成调用预算；工具后续调用未发出')
        }
        // Reserve each paid HTTP attempt before sending, including failed/uncertain attempts.
        atlasDb().prepare("UPDATE ai_calls SET usage=json_set(COALESCE(usage,'{}'),'$.requestCount',COALESCE(json_extract(usage,'$.requestCount'),0)+1) WHERE id=?").run(id)
        updateExecutionStep(execution.stepId,'running','请求已提交，等待模型输出')
      })
    },
    afterRequest: usage => {atlasDb().prepare('UPDATE ai_calls SET usage=? WHERE id=?').run(JSON.stringify(usage),id);updateExecutionStep(execution.stepId,'running','已接收输出，处理工具或校验格式')},
    onToolEvent: (event) => {
      if(event.state==='running'){const step=executionRule('工具：'+event.name,event.state,event.summary);if(step)toolSteps.set(event.name,step)}
      else {const step=toolSteps.get(event.name);if(step)updateExecutionStep(step,event.state,event.summary)}
    },
    onTool: name => {
      const previous = atlasRead<any>('atlas-model-call/'+id, {tools:[]})
      atlasWrite('atlas-model-call/'+id, {...previous,provider:config.provider,protocol:config.protocol,tools:[...previous.tools,name]})
    }
  }))
  checkCurrent()
  if (controller.signal.aborted) throw Error('模型任务已取消，原有结果保留')
  atlasWrite('atlas-model-call/'+id, {provider:config.provider,protocol:config.protocol,tools:result.toolNames})
  atlasDb().prepare('UPDATE ai_calls SET status=?,usage=?,elapsed_ms=? WHERE id=?').run('completed', JSON.stringify(result.usage), Date.now() - started, id)
  finishModelExecution(execution,'completed','模型输出已返回；业务检查由后续步骤完成',modelExecutionOutput(result.value))
  return result
  } catch (error) {
    atlasDb().prepare('UPDATE ai_calls SET status=?,elapsed_ms=? WHERE id=?').run(controller.signal.aborted ? 'cancelled' : 'failed', Date.now() - started, id)
    finishModelExecution(execution,controller.signal.aborted?'cancelled':'failed',agentError || (error as any).message || '模型调用未完成')
    if (agentError) throw Error(agentError)
    throw error
  } finally { clearInterval(watchAgent); clearTimeout(timeout); signal.removeEventListener('abort',cancel); stopLease(); releaseLease('model:official-deepseek', owner) }
}
export function modelUsage() {
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  const rows = atlasDb().prepare('SELECT kind,status,automatic,usage,elapsed_ms,created_at FROM ai_calls WHERE day=? ORDER BY created_at DESC').all(day)
  return { day, analysisLimit: careerPolicy().discovery.aiLimit, strategyLimit: careerPolicy().discovery.strategyLimit, automaticAnalysis: rows.filter((r: any) => r.kind === 'analysis' && r.automatic).reduce((n:number,r:any)=>n+(r.usage?JSON.parse(r.usage).requestCount??1:1),0), automaticStrategy: rows.filter((r: any) => r.kind === 'strategy' && r.automatic).reduce((n:number,r:any)=>n+(r.usage?JSON.parse(r.usage).requestCount??1:1),0), totalTokens: rows.reduce((n: number, r: any) => n + (r.usage ? Number(JSON.parse(r.usage).total_tokens) || 0 : 0), 0), calls: rows.map((r: any) => ({ ...r, usage: r.usage ? JSON.parse(r.usage) : null })) }
}

export function modelCacheHit(kind:string,model:string,agent?:AgentSnapshot) {
 const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),account=atlasRead<any>('career-boss-sync.json',null)?.account?.id || 'local'
 const id=randomUUID()
 atlasTransaction(()=>{
  atlasDb().prepare('INSERT INTO ai_calls VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,account,kind,day,0,model,'cached',JSON.stringify({total_tokens:0}),0,new Date().toISOString())
  if(agent)recordAgentCall(id,agent)
  const execution=beginModelExecution(id,account,kind,{model,version:agent?.version,promptId:agent?.promptId})
  finishModelExecution(execution,'cached','复用已有结果，没有新模型请求')
 })
}

export async function testModel(input: any = {}) {
  const config = modelConfig()
  if (input.baseRevision !== config.revision) throw Error('模型配置已变化，请保存或重新读取后测试')
  const started = Date.now(), controller = new AbortController(), cancel = () => controller.abort(), timeout = setTimeout(cancel, 120000)
  input.signal?.addEventListener('abort',cancel,{once:true})
  if(input.signal?.aborted)controller.abort()
  try {
    const result = await deepseekJson(config,
      'Connection diagnostic. First call atlas_connection_probe once with {"value":7}. Then return ONLY JSON with {"ok":true,"answer":<answer from tool>}. Never invent tool results.',
      {task:'Verify generation and a real round-trip tool call using synthetic data only.'}, controller.signal,{kind:'model-test',diagnostic:true})
    const value:any = result.value
    const verified = value?.ok === true && value.answer === 'atlas-tool-ok' && result.toolNames.includes('atlas_connection_probe')
    const report = {revision:config.revision,model:config.model,provider:config.provider,protocol:config.protocol,generation:true,toolCalling:verified,at:new Date().toISOString(),elapsedMs:Date.now()-started,usage:result.usage,
      note:verified?'生成、工具执行及回传均已验证；未发送招聘消息':'生成成功，但模型没有完成指定工具回传，工具能力仍待验证'}
    atlasWrite('atlas-model-verification/'+config.identity,report)
    return report
  } catch (e: any) {
    atlasWrite('atlas-model-verification/'+config.identity, {revision:config.revision,model:config.model,provider:config.provider,protocol:config.protocol,generation:false,toolCalling:false,at:new Date().toISOString(),elapsedMs:Date.now()-started,note:e.message || '模型测试未完成',failed:true})
    throw e
  } finally { clearTimeout(timeout); input.signal?.removeEventListener('abort',cancel) }
}
