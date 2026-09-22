import { URL } from 'node:url'
import { compatibleEndpoint } from './atlas-model-endpoint'
export { compatibleEndpoint } from './atlas-model-endpoint'
import { randomUUID } from 'node:crypto'
import { atlasRead, atlasWrite, fingerprint } from './atlas-store'
import { readLocalModelConfigs, writeLocalModelConfigs, localConfigStatus } from './atlas-local-config'
import { deepseekGeneration, DEEPSEEK_CONTEXT_TOKENS } from '../../common/deepseek-policy'

export const COMMANDCODE_BASE = 'https://api.commandcode.ai/provider/v1'
export const COMMANDCODE_DEFAULT = 'deepseek/deepseek-v4.1-flash'
export type Provider = 'commandcode' | 'deepseek' | 'compatible'
export type ModelEntry = { id: string; name: string; contextLength: number | null; endpoints: string[]; protocol: 'chat' | 'anthropic' | null }
const values = readLocalModelConfigs
export function providerOf(value: any): Provider | null {
  try {
    if (value.provider === 'compatible') { compatibleEndpoint(value.providerCompleteApiUrl); return 'compatible' }
    const u = new URL(value.providerCompleteApiUrl)
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.port) return null
    if (u.hostname === 'api.commandcode.ai' && /^\/provider\/v1(?:\/(?:chat\/completions|messages))?\/?$/.test(u.pathname)) return 'commandcode'
    if (u.hostname === 'api.deepseek.com' && /^(?:\/v1)?(?:\/chat\/completions)?\/?$/.test(u.pathname)) return 'deepseek'
  } catch { /* An unrecognized host must never receive these credentials. */ }
  return null
}
export type GenerationOptions = { maxOutputTokens: number; budgetMode: 'task' | 'fixed'; reasoning: 'default' | 'max'; toolsEnabled: boolean; jsonMode: boolean }
export function generationOptions(input: any, provider: Provider, model: string): GenerationOptions {
  const value = input || { maxOutputTokens: 4096, budgetMode: 'task', reasoning: 'default', toolsEnabled: provider === 'commandcode', jsonMode: provider === 'deepseek' || model.startsWith('deepseek/') }
  if (!Number.isInteger(value.maxOutputTokens) || value.maxOutputTokens < 512 || value.maxOutputTokens > 393216 ||
    !['task','fixed'].includes(value.budgetMode) || !['default','max'].includes(value.reasoning) ||
    typeof value.toolsEnabled !== 'boolean' || typeof value.jsonMode !== 'boolean') throw Error('模型输出预算或能力选项无效')
  if (value.reasoning === 'max' && !(provider === 'deepseek' || provider === 'commandcode' && model.startsWith('deepseek/')))
    throw Error('max 参数仅用于已适配的 DeepSeek 渠道，其他模型使用服务商默认参数')
  return { maxOutputTokens: value.maxOutputTokens, budgetMode: value.budgetMode, reasoning: value.reasoning, toolsEnabled: value.toolsEnabled, jsonMode: value.jsonMode }
}
export function modelConfig() {
  const all = values(), c = all.find(c => c.enabled && c.model && providerOf(c) &&
    (c.providerApiSecret || providerOf(c) === 'compatible' && compatibleEndpoint(c.providerCompleteApiUrl).local))
  if (!c) throw Error('请先在设置中选择模型并配置 API 密钥')
  const provider = providerOf(c)!, protocol = provider === 'commandcode' && c.protocol === 'anthropic' ? 'anthropic' : 'chat'
  const custom = provider === 'compatible' ? compatibleEndpoint(c.providerCompleteApiUrl) : null
  const url = custom?.url || (provider === 'commandcode' ? COMMANDCODE_BASE + (protocol === 'chat' ? '/chat/completions' : '/messages') : 'https://api.deepseek.com/chat/completions')
  const isDeepseek = provider === 'deepseek' || provider === 'commandcode' && /^deepseek\//.test(c.model)
  // Existing records without options retain their exact generation behaviour.
  const options: GenerationOptions = c.generationOptions ? generationOptions(c.generationOptions, provider, c.model) : {
    maxOutputTokens: isDeepseek ? deepseekGeneration.max_tokens : 4096, budgetMode: 'fixed', reasoning: isDeepseek ? 'max' : 'default', toolsEnabled: provider === 'commandcode', jsonMode: isDeepseek
  }
  const generation: { max_tokens: number; thinking?: { type: string }; reasoning_effort?: string } = {
    ...(options.reasoning === 'max' ? deepseekGeneration : {}), max_tokens: options.maxOutputTokens
  }
  const identity = fingerprint([provider, url, c.model, generation, options, 'read-tools-v2'])
  return { model: String(c.model), key: String(c.providerApiSecret || ''), provider, protocol, url, generation, generationOptions: options,
    contextWindowTokens: c.contextWindowTokens || (provider === 'deepseek' && !c.generationOptions ? DEEPSEEK_CONTEXT_TOKENS : null),
    identity, revision: fingerprint(all), toolsEnabled: options.toolsEnabled, jsonMode: options.jsonMode, managed: !!c.atlasManaged || provider === 'commandcode' }
}
export function modelForTask(config: ReturnType<typeof modelConfig>, kind: string) {
  const limits: Record<string, number> = { greeting: 2048, reply: 2048, 'greeting-review': 2048, 'model-test': 1024, strategy: 4096, coordinator: 4096 }
  return config.generationOptions.budgetMode === 'task'
    ? { ...config, generation: { ...config.generation, max_tokens: Math.min(config.generation.max_tokens, limits[kind] || 8192) } }
    : config
}
export type ModelConfig = ReturnType<typeof modelConfig>
// All providers bind caches to actual routing and generation parameters.
export function modelVersion() { try { return ':' + modelConfig().identity.slice(0, 20) } catch { return '' } }
export function assertModelCurrent(config: ModelConfig) {
  if (config.revision !== modelConfig().revision) throw Error('模型配置已更新，本次旧配置任务已停止，请重新运行')
}
export function modelSettings() {
  let c: ModelConfig | undefined
  try { c = modelConfig() } catch { /* First-use settings have no credentials. */ }
  return { configured: !!c, model: c?.model || '', provider: c?.provider || 'compatible',
    url: c?.url || '', baseUrl: c?.provider === 'compatible' ? compatibleEndpoint(c.url).baseUrl : c?.provider === 'deepseek' ? 'https://api.deepseek.com' : c ? COMMANDCODE_BASE : '',
    protocol: c?.protocol || 'chat', generation: c?.generation || {max_tokens:4096}, generationOptions: c?.generationOptions || generationOptions(null, 'compatible', ''), contextWindowTokens: c?.contextWindowTokens || null,
    toolsEnabled: !!c?.toolsEnabled, storage: localConfigStatus(), revision: fingerprint(values()), verification: (() => { const v = c ? atlasRead<any>('atlas-model-verification/' + c.identity, null) : null; return v?.revision === c?.revision ? v : null })() }
}
export function parseModelCatalog(data: any): ModelEntry[] {
  if (!Array.isArray(data?.data) || data.data.length > 5000) throw Error('模型列表格式无效，已保留原列表')
  const seen = new Set<string>()
  return data.data.map((m: any) => {
    if (typeof m.id !== 'string' || !/^[A-Za-z0-9._:/+-]{1,200}$/.test(m.id) || seen.has(m.id) || !Array.isArray(m.supported_endpoints)) throw Error('模型列表包含无效或重复标识')
    seen.add(m.id)
    const endpoints = m.supported_endpoints.filter((s: any) => typeof s === 'string' && s.length < 100)
    return { id: m.id, name: String(m.name || m.id).slice(0, 200), contextLength: Number.isSafeInteger(m.context_length) && m.context_length > 0 ? m.context_length : null, endpoints,
      protocol: endpoints.includes('/chat/completions') ? 'chat' : endpoints.includes('/messages') ? 'anthropic' : null }
  })
}
export function modelHttpError(status: number) {
  return Error(status === 401 ? '模型凭据无效，请检查 API 密钥' : status === 403 ? '模型访问被拒绝，请检查渠道套餐或该模型权限' : status === 429 ? '模型调用受限，请检查额度或稍后手动重试' : `模型服务错误（${status}），请检查所选模型和接口；原资料已保留`)
}
export async function modelCatalog(input: any = {}) {
  if (input.provider === 'compatible') {
    const endpoint = compatibleEndpoint(input.baseUrl)
    const c = values().find(v => providerOf(v) === 'compatible' && compatibleEndpoint(v.providerCompleteApiUrl).url === endpoint.url)
    if (!c) throw Error('请先保存此地址与模型，再读取该服务的模型列表')
    const cacheKey = 'atlas-compatible-models/' + fingerprint(endpoint.baseUrl)
    const cached = atlasRead<any>(cacheKey, null)
    if (!input.refresh && cached) return {...cached,cached:true}
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),30000)
    try {
      const response = await fetch(endpoint.baseUrl + '/models', {redirect:'error',signal:controller.signal,headers:c.providerApiSecret ? {Authorization:`Bearer ${c.providerApiSecret}`} : {}})
      if (!response.ok) throw modelHttpError(response.status)
      const data = await response.json()
      if (!Array.isArray(data?.data) || data.data.length > 5000) throw Error('catalog')
      const models = parseModelCatalog({data:data.data.map((v:any)=>({...v,supported_endpoints:['/chat/completions']}))})
      const result = {models,fetchedAt:new Date().toISOString()};atlasWrite(cacheKey,result);return result
    } catch {
      if (cached) return {...cached,cached:true,warning:'读取失败，显示上次目录；也可以手动输入模型 ID'}
      throw Error('该接口未返回模型列表，可以手动输入模型 ID；未更改现有配置')
    } finally {clearTimeout(timer)}
  }
  const old = atlasRead<any>('atlas-commandcode-models', null)
  if (!input.refresh && old) return { ...old, cached: true }
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000)
  try {
    // The provider publishes the catalog without authentication; never expose a key to the renderer.
    const response = await fetch(COMMANDCODE_BASE + '/models', { redirect: 'error', signal: controller.signal, headers: { 'User-Agent': 'Atlas/0.17.4' } })
    if (!response.ok) throw modelHttpError(response.status)
    const result = { models: parseModelCatalog(await response.json()), fetchedAt: new Date().toISOString() }
    atlasWrite('atlas-commandcode-models', result)
    return { ...result, cached: false }
  } catch (e: any) {
    if (old) return { ...old, cached: true, warning: '刷新失败，正在显示上次成功读取的模型列表' }
    throw Error(e.name === 'AbortError' ? '模型列表读取超时，请手动重试' : '模型列表读取失败，请检查网络或渠道状态')
  } finally { clearTimeout(timeout) }
}
export async function saveModelSettings(input: any) {
  const all = values()
  if (input?.baseRevision !== fingerprint(all)) throw Error('模型配置已变化，请重新读取；当前选择已保留')
  const provider: Provider = input.provider || 'commandcode'
  if (!['commandcode', 'deepseek', 'compatible'].includes(provider)) throw Error('不支持的模型渠道')
  const model = input.model || (provider === 'commandcode' ? COMMANDCODE_DEFAULT : provider === 'deepseek' ? 'deepseek-flash' : '')
  if (typeof model !== 'string' || !/^[A-Za-z0-9._:/+-]{1,200}$/.test(model)) throw Error('请填写有效的模型 ID')
  let entry: ModelEntry | undefined
  if (provider === 'commandcode') {
    const catalog = await modelCatalog()
    entry = catalog.models.find((m: ModelEntry) => m.id === model)
    if (!entry?.protocol) throw Error('请从模型列表选择支持 Chat 或 Anthropic 的模型')
  }
  const custom = provider === 'compatible' ? compatibleEndpoint(input.baseUrl) : null
  const url = custom?.url || (provider === 'commandcode' ? COMMANDCODE_BASE + (entry?.protocol === 'anthropic' ? '/messages' : '/chat/completions') : 'https://api.deepseek.com/chat/completions')
  // Credentials are bound to the exact compatible endpoint, never just its provider type.
  const sameEndpoint = (c: any) => providerOf(c) === provider && (provider !== 'compatible' || compatibleEndpoint(c.providerCompleteApiUrl).url === url)
  const old = all.find(sameEndpoint)
  if (input.clearSecret && !custom?.local) throw Error('只有本机免密服务可以清除 API 密钥')
  const key = input.clearSecret ? '' : typeof input.secret === 'string' && input.secret.trim() ? input.secret.trim() : old?.providerApiSecret || ''
  if ((!key && !custom?.local) || (key && (key.length > 512 || /[\s\x00-\x1f]/.test(key)))) throw Error('请为此地址输入有效的 API 密钥；更换地址不会沿用其他地址的密钥')
  const options = input.generationOptions ? generationOptions(input.generationOptions, provider, model)
    : old?.model === model ? old.generationOptions : generationOptions(null, provider, model)
  if (input.baseRevision !== fingerprint(values())) throw Error('模型配置已变化，请重新读取')
  for (const c of all) c.enabled = false
  const c = { id: randomUUID(), enabled: true, atlasManaged: true, model, provider, protocol: entry?.protocol || 'chat',
    providerCompleteApiUrl: url, providerApiSecret: key, generationOptions: options,
    contextWindowTokens: entry?.contextLength || (old?.model === model ? old.contextWindowTokens : null) }
  writeLocalModelConfigs([...all.filter(v => !sameEndpoint(v)), c], input.baseRevision)
  return modelSettings()
}
