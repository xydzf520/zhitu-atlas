import type { ModelConfig } from './atlas-model-config'
import { modelHttpError } from './atlas-model-config'
import { DEEPSEEK_MAX_JSON_CHARS } from '../../common/deepseek-policy'
import { TextDecoder } from 'node:util'

// Streaming keeps long max-thinking requests alive; incomplete streams are never accepted as success.
export async function readModelStream(response: Response, anthropic: boolean, signal: AbortSignal) {
  if (!response.body) throw Error('模型未返回响应流')
  const reader = response.body.getReader(), decoder = new TextDecoder(), blocks: any[] = [], toolCalls: any[] = []
  // A provider can stop yielding bytes while keeping the connection open.
  // Abort must release the read as well as prevent the next request.
  const cancelRead = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancelRead, { once: true })
  const message: any = { role: 'assistant', content: '', reasoning_content: '' }
  let buffer = '', finish: string | null = null, usage: any = {}, total = 0, stopped = false
  const event = (raw: string) => {
    const payload = raw.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
    if (!payload || payload === '[DONE]') return
    let d: any
    try { d = JSON.parse(payload) } catch { throw Error('模型响应流格式无效') }
    if (d.error || d.type === 'error') throw Error('模型响应流中断，原有结果保留')
    if (anthropic) {
      if (d.type === 'message_start') usage = { ...usage, ...d.message?.usage }
      if (d.type === 'content_block_start') {
        if (!Number.isSafeInteger(d.index) || d.index < 0 || d.index > 20) throw Error('模型响应块索引无效')
        blocks[d.index] = { ...d.content_block }
      }
      if (d.type === 'content_block_delta') {
        const b = blocks[d.index], delta = d.delta
        if (!b || !delta) throw Error('模型响应块缺失')
        if (delta.type === 'text_delta') b.text = (b.text || '') + delta.text
        if (delta.type === 'thinking_delta') b.thinking = (b.thinking || '') + delta.thinking
        if (delta.type === 'signature_delta') b.signature = (b.signature || '') + delta.signature
        if (delta.type === 'input_json_delta') b.partialJson = (b.partialJson || '') + delta.partial_json
      }
      if (d.type === 'message_delta') { finish = d.delta?.stop_reason || finish; usage = { ...usage, ...d.usage } }
      if (d.type === 'message_stop') stopped = true
    } else {
      if (d.usage) usage = d.usage
      const c = d.choices?.[0], delta = c?.delta
      if (c?.finish_reason) finish = c.finish_reason
      if (!delta) return
      if (typeof delta.content === 'string') message.content += delta.content
      if (typeof delta.reasoning_content === 'string') message.reasoning_content += delta.reasoning_content
      for (const t of delta.tool_calls || []) {
        if (!Number.isSafeInteger(t.index) || t.index < 0 || t.index > 3) throw Error('模型工具数量超出上限')
        const existing = toolCalls[t.index] ||= { id: '', type: 'function', function: { name: '', arguments: '' } }
        if (t.id) existing.id = t.id
        if (t.function?.name) existing.function.name += t.function.name
        if (t.function?.arguments) existing.function.arguments += t.function.arguments
      }
    }
  }
  try {
    while (true) {
      if (signal.aborted) throw Error('模型任务已取消')
      const { done, value } = await reader.read()
      if (signal.aborted) throw Error('模型任务已取消')
      if (done) { buffer += decoder.decode(); break }
      total += value.byteLength
      if (total > 32 * 1024 * 1024) throw Error('模型响应流过长，任务已停止')
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '')
      let end: number
      while ((end = buffer.indexOf('\n\n')) >= 0) { event(buffer.slice(0, end)); buffer = buffer.slice(end + 2) }
    }
    if (buffer.trim()) event(buffer)
    if (!finish || (anthropic && !stopped)) throw Error('模型响应流未完成，不会自动重试')
    if (anthropic) {
      for (const b of blocks) if (b?.partialJson !== undefined) { try { b.input = JSON.parse(b.partialJson) } catch { throw Error('工具参数输出不完整') }; delete b.partialJson }
      return { content: blocks, stop_reason: finish, usage }
    }
    if (toolCalls.length) message.tool_calls = toolCalls
    return { choices: [{ message, finish_reason: finish }], usage }
  } finally { signal.removeEventListener('abort', cancelRead); await reader.cancel().catch(() => {}); reader.releaseLock() }
}

export type ReadTool = { name: string; description: string; parameters: any; run: (args: any) => unknown }
export function evidenceTools(input: any): ReadTool[] {
  const records = input?.evidence || input?.candidate?.evidence || input?.confirmedEvidence || []
  const evidence = Array.isArray(records) ? records.filter(e => e?.confirmed === true && typeof e.id === 'string') : []
  if (!evidence.length) return []
  return [{ name: 'atlas_read_confirmed_evidence', description: '只读核对本次任务已提供且本人已确认的经历；按 ID 返回事实和来源，不修改资料或执行发送。',
    parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 } }, required: ['ids'], additionalProperties: false },
    run: args => {
      if (!args || Object.keys(args).length !== 1 || !Array.isArray(args.ids) || !args.ids.length || args.ids.length > 10 || args.ids.some((id: any) => typeof id !== 'string' || id.length > 200)) throw Error('工具参数无效')
      return { evidence: args.ids.map((id: string) => { const e = evidence.find(e => e.id === id); return e ? { id, title: e.title, text: e.text, source: e.source, confirmed: true } : { id, error: '不存在或尚未确认，不可作为事实引用' } }) }
    } }]
}
export const diagnosticTool = (): ReadTool => ({ name: 'atlas_connection_probe', description: 'Read-only connection diagnostic. Returns a server-generated result. Call once before the final JSON.',
  parameters: { type: 'object', properties: { value: { type: 'integer', enum: [7] } }, required: ['value'], additionalProperties: false }, run: args => {
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 1 || args.value !== 7) throw Error('工具参数无效')
    return { answer: 'atlas-tool-ok' }
  } })
// A closed read-only tool set. No dynamic code, URLs, file paths, browser commands or sending tools.
export async function modelJsonTransport(config: ModelConfig, system: string, input: unknown, signal: AbortSignal,
  options: { tools?: ReadTool[]; maxToolCalls?: number; beforeRequest?: () => void; afterRequest?: (usage: any) => void; onTool?: (name: string) => void; onToolEvent?: (event:{name:string;state:string;summary:string})=>void } = {}) {
  const tools = options.tools || [], anthropic = config.protocol === 'anthropic'
  const messages: any[] = anthropic ? [{ role: 'user', content: JSON.stringify(input) }] : [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }]
  const usage: any = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requestCount: 0, toolCalls: 0 }
  const toolNames: string[] = [], usedIds = new Set<string>()
  for (let round = 0; round < 3; round++) {
    if (signal.aborted) throw Error('模型任务已取消')
    options.beforeRequest?.()
    const definitions = tools.map(t => anthropic ? { name: t.name, description: t.description, input_schema: t.parameters } : { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })
    const body: any = { model: config.model, messages, ...config.generation }
    if (config.provider === 'commandcode') { body.stream = true; if (!anthropic) body.stream_options = { include_usage: true } }
    if (anthropic) { body.system = system; delete body.thinking; delete body.reasoning_effort }
    else if (config.jsonMode) body.response_format = { type: 'json_object' }
    if (definitions.length) { body.tools = definitions; body.tool_choice = anthropic ? { type: 'auto' } : 'auto' }
    let response: Response
    try { response = await fetch(config.url, { method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', ...(config.key ? {Authorization: `Bearer ${config.key}`} : {}), ...(anthropic ? { 'anthropic-version': '2023-06-01' } : {}) }, body: JSON.stringify(body) }) }
    catch { throw Error(signal.aborted ? '模型任务已取消或超时，原有结果保留' : '模型网络请求失败，结果不确定；不会自动重试') }
    if (!response.ok) throw modelHttpError(response.status)
    let data: any
    try { data = response.headers?.get('content-type')?.includes('text/event-stream') ? await readModelStream(response, anthropic, signal) : await response.json() }
    catch { throw Error(signal.aborted ? '模型任务已取消或超时，原有结果保留' : '模型响应未完成或格式无效，不会自动重试') }
    const u = data.usage || {}, prompt = Number(u.prompt_tokens ?? u.input_tokens) || 0, completion = Number(u.completion_tokens ?? u.output_tokens) || 0
    usage.prompt_tokens += prompt; usage.completion_tokens += completion; usage.total_tokens += Number(u.total_tokens) || prompt + completion; usage.requestCount++
    options.afterRequest?.({ ...usage })
    if (signal.aborted) throw Error('模型任务已取消')
    const message = anthropic ? { role: 'assistant', content: data.content } : data.choices?.[0]?.message
    const finish = anthropic ? data.stop_reason : data.choices?.[0]?.finish_reason
    const calls = anthropic ? (Array.isArray(data.content) ? data.content.filter((c: any) => c.type === 'tool_use').map((c: any) => ({ id: c.id, name: c.name, args: c.input })) : [])
      : (message?.tool_calls || []).map((c: any) => ({ id: c.id, name: c.function?.name, raw: c.function?.arguments }))
    if (calls.length) {
      if (round === 2 || calls.length + usage.toolCalls > Math.min(6, options.maxToolCalls || 4) || (finish && finish !== (anthropic ? 'tool_use' : 'tool_calls'))) throw Error('模型工具调用超出轮次或数量上限，任务已停止')
      messages.push(message) // Preserve reasoning_content / thinking blocks required by the provider.
      const results: any[] = []
      for (const call of calls) {
        const tool = tools.find(t => t.name === call.name)
        if (!tool || typeof call.id !== 'string' || !call.id || usedIds.has(call.id)) throw Error('模型请求了未授权或重复的工具，已拦截')
        usedIds.add(call.id)
        let args: any
        try { args = anthropic ? call.args : typeof call.raw === 'string' && call.raw.length <= 4096 ? JSON.parse(call.raw) : null } catch { throw Error('模型工具参数不是有效 JSON') }
        if (signal.aborted) throw Error('模型任务已取消')
        options.onToolEvent?.({name:tool.name,state:'running',summary:'开始执行只读工具；参数不写入运行日志'})
        let result:any
        try { result = await tool.run(args) }
        catch(e){options.onToolEvent?.({name:tool.name,state:'failed',summary:'工具读取失败，原数据保留'});throw e}
        const text = JSON.stringify(result)
        options.onToolEvent?.({name:tool.name,state:'completed',summary:'工具已返回，结果交给模型；不是发送动作'})
        if (signal.aborted) throw Error('模型任务已取消')
        if (text.length > 50000) throw Error('工具结果过长')
        usage.toolCalls++; toolNames.push(tool.name); options.onTool?.(tool.name)
        if (anthropic) results.push({ type: 'tool_result', tool_use_id: call.id, content: text })
        else messages.push({ role: 'tool', tool_call_id: call.id, content: text })
      }
      if (anthropic) messages.push({ role: 'user', content: results })
      continue
    }
    const raw = anthropic ? (Array.isArray(data.content) ? data.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') : '') : message?.content
    if (typeof raw !== 'string' || raw.length > DEEPSEEK_MAX_JSON_CHARS || (finish && finish !== (anthropic ? 'end_turn' : 'stop'))) throw Error('模型输出不完整或未正常结束，原有结果保留')
    let value: unknown
    try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')) } catch { throw Error('模型输出格式无效，原有草稿已保留') }
    return { value, usage, toolNames, finishReason: 'stop' }
  }
  throw Error('模型工具调用未能结束')
}
