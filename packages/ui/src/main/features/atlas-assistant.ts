import { resolveAgent, agentVersion } from './atlas-agents'
import { modelSettings, saveModelSettings, modelCatalog, modelVersion } from './atlas-model-config'
import { atlasRead, atlasWrite, fingerprint, atlasDb } from './atlas-store'
import { canonicalProfile, profileHistory } from './atlas-profile'
import { classifyReply } from '../../common/auto-reply'
import { deepseekConfig, deepseekJson, testModel } from './atlas-deepseek'
import { deepseekGeneration, DEEPSEEK_REQUEST_TIMEOUT_MS } from '../../common/deepseek-policy'
import { discoveryAccount } from './atlas-discovery-state'
import { pipelineDetail } from './atlas-pipeline'
import { conversationPitch, conversationPitchContext } from './atlas-conversation-pitch'
import { communicationStyleIssues, COMMUNICATION_STYLE_VERSION } from '../../common/communication-quality'
import { executionRule } from './atlas-execution'

export async function replyDraft(input: any) {
  if(input.styleRequest!==undefined && (typeof input.styleRequest!=='string' || input.styleRequest.length>600))throw Error('本次表达要求过长或无效')
  if (input?.accountId && input.accountId !== discoveryAccount()) throw Error('账号已变化，请重新读取会话后生成回复')
  if (typeof input?.incoming !== 'string' || !input.incoming.trim() || input.incoming.length > 1500) throw Error('请选择一条可以核实的文本消息')
  const profile = canonicalProfile(), decision = classifyReply(input.incoming, profile)
  if (!decision.automatic) {executionRule('消息分类','review',decision.reason); return { text: '', review: true, reason: decision.reason }}
  executionRule('消息分类','completed',decision.category+'：'+decision.reason)
  const agent = resolveAgent(input.followup ? 'followup' : 'reply')
  const reviewer = resolveAgent('greeting-review', 'reply')
  const context = typeof input.context === 'string' ? input.context.slice(-5000) : ''
  const evidence = profile.evidence.filter(e => e.confirmed), version = profileHistory()[0]?.id
  const account = discoveryAccount(), model = deepseekConfig().model
  const key = 'atlas-reply-ai/' + fingerprint([input.styleRequest || '', COMMUNICATION_STYLE_VERSION, agentVersion('reply-4', [input.followup ? 'followup' : 'reply', 'greeting-review']),model,account,!!input.followup, input.messageId, input.incoming, context, version, deepseekGeneration,modelVersion()])
  const old = atlasRead<any>(key, null)
  if (old && !input.refresh) {executionRule('复用回复','cached','复用相同资料与会话版本的草稿');return { ...old, cached: true }}
  const controller = new AbortController(), cancel = () => controller.abort(), timer = setTimeout(cancel, DEEPSEEK_REQUEST_TIMEOUT_MS)
  input.signal?.addEventListener('abort', cancel, { once: true })
  if (input.signal?.aborted) controller.abort()
  try {
    const result = await deepseekJson(deepseekConfig(), agent.system, { styleRequest:input.styleRequest || '', styleScope:'仅调整本次表达，不改变事实、授权或重要事项规则', incoming: input.incoming, context, approvedBaseline: decision.draft, evidence, cities: profile.preferredCities }, controller.signal, { kind: input.followup ? 'followup' : 'reply', automatic: !!input.automatic, agent })
    const value: any = result.value
    if (!value || typeof value.text !== 'string' || value.text.length > 220 || !Array.isArray(value.evidenceIds) || value.evidenceIds.some((id: string) => !evidence.some(e => e.id === id))) throw Error('回复依据或格式无效，原草稿保留')
    const styleIssues = communicationStyleIssues({ text: value.text, incoming: input.incoming,
      intent: decision.category === '工作城市' ? 'location' : decision.category === '常规咨询' ? 'greeting' : 'other' })
    const blockingStyle = styleIssues.find(i => i.severity === 'block')
    if (blockingStyle) throw Error(blockingStyle.reason + ' 原草稿保留，等待本人核对。')
    const facts = evidence.filter(e => value.evidenceIds.includes(e.id)).map(e => e.text).join('')
    const numbers = value.text.match(/\d+(?:\.\d+)?(?:%|万|亿|人|年|k)?/gi) || []
    if (numbers.some((n: string) => !facts.includes(n)) || /薪资|工资|待遇|面试|入职|到岗|简历|附件|微信|电话|邮箱|https?:|保证|承诺/.test(value.text)) throw Error('回复包含未经确认的数字或重要事项，请人工处理')
    executionRule('事实与表达检查','completed','经历引用有效；数字与重要事项检查通过',{evidenceIds:value.evidenceIds,styleIssues,validated:true})
    let reviewUsage: any = null
    if (value.text) {
      const review = await deepseekJson(deepseekConfig(), reviewer.system, { incoming: input.incoming, context, draft: value.text, evidence: evidence.filter(e => value.evidenceIds.includes(e.id)), cities: profile.preferredCities }, controller.signal, { kind: 'greeting-review', automatic: !!input.automatic, agent: reviewer })
      const checked: any = review.value
      if (!checked || !['grounded','relevant','concise','noCommitments'].every(k => checked[k] === true) || !Array.isArray(checked.issues) || checked.issues.length) throw Error('回复未通过独立事实与相关性审校，原草稿保留，请本人核实')
      reviewUsage = review.usage
      executionRule('审校结果核对','completed','模型返回的事实、相关性、简洁和承诺检查均通过',{grounded:true,relevant:true,concise:true,noCommitments:true,validated:true})
    }
    if (account !== discoveryAccount() || version !== profileHistory()[0]?.id || controller.signal.aborted) throw Error('资料已变化或任务已取消')
    const reply = { text: value.text, evidenceIds: value.evidenceIds, review: !!input.followup || !value.text, reason: value.text ? '基于已确认经历与当前上下文，通过独立事实审校' : '证据不足，请本人补充', styleIssues, usage: result.usage, reviewUsage, profileVersion: version }
    atlasWrite(key, reply)
    return reply
  } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', cancel) }
}
export function interviewContext(id: string) {
  const opportunity = pipelineDetail(id), account = discoveryAccount()
  const owner = opportunity.body.accountId || opportunity.body.userId
  if (owner && owner !== account) throw Error('岗位不属于当前账号，请重新选择')
  const messages = opportunity.body.bossId && opportunity.body.platform === 'boss'
    ? atlasDb().prepare("SELECT source_id,body,sent_at FROM platform_messages WHERE platform='boss' AND account_id=? AND conversation_id=? ORDER BY sent_at DESC,observed_at DESC,source_id DESC LIMIT 30").all(account, opportunity.body.bossId)
      .map((r: any) => ({ ...JSON.parse(r.body), id: r.source_id, sentAt: r.sent_at }))
      .filter((m: any) => m.type === 'text' && typeof m.text === 'string' && m.text.trim() && ['sent', 'received'].includes(m.direction))
      .reverse().map((m: any) => ({ id: m.id, speaker: m.direction === 'sent' ? '本人' : '招聘方', direction: m.direction, text: m.text, sentAt: m.sentAt })) : []
  const interviews = opportunity.related.filter(r => r.kind === 'interview')
  return { opportunity, messages, interviews, basis: fingerprint([opportunity.revision, opportunity.body.job, interviews, messages]) }
}
export async function interviewPreparation(input: any) {
  const agent = resolveAgent('interview'), context = interviewContext(input.id)
  if (input.baseBasis && input.baseBasis !== context.basis) throw Error('面试或沟通已变化，请重新准备')
  const { opportunity, messages, interviews } = context, profile = canonicalProfile(), version = profileHistory()[0]?.id
  const account = discoveryAccount()
  const key = 'atlas-interview/' + fingerprint([agentVersion('interview-3', ['interview']),deepseekConfig().model,account,input.id, context.basis, version, deepseekGeneration,modelVersion()])
  if (!input.refresh && atlasRead(key, null)) return atlasRead(key, null)
  const controller = new AbortController(), cancel = () => controller.abort(), timer = setTimeout(cancel, DEEPSEEK_REQUEST_TIMEOUT_MS)
  input.signal?.addEventListener('abort', cancel, { once: true })
  if (input.signal?.aborted) controller.abort()
  try {
    const result = await deepseekJson(deepseekConfig(), agent.system, { job: opportunity.body.job, messages, messageScope: '当前账号已同步的最近文本；不含平台卡片，不代表全部历史。本人发言不是招聘方承诺。', evidence: profile.evidence.filter(e => e.confirmed), interviews }, controller.signal, { kind: 'interview', agent, automatic: !!input.automatic })
    const value: any = result.value
    if (!value || typeof value.focus !== 'string' || !Array.isArray(value.questions) || value.questions.length > 8 || !Array.isArray(value.checklist) || value.checklist.length > 6 || value.checklist.some((x: any) => typeof x !== 'string') || value.questions.some((q: any) => typeof q.question !== 'string' || typeof q.outline !== 'string' || (q.perspective != null && !['hr','business','candidate'].includes(q.perspective)) || !Array.isArray(q.evidenceIds) || q.evidenceIds.some((id: string) => !profile.evidence.some(e => e.id === id && e.confirmed)))) throw Error('面试准备的结构或证据无效')
    if (account !== discoveryAccount() || version !== profileHistory()[0]?.id || controller.signal.aborted || context.basis !== interviewContext(input.id).basis) throw Error('资料、岗位或会话已变化，或任务已取消；请重新准备')
    const report = { ...value, evidence: profile.evidence.filter(e => e.confirmed && value.questions.some((q: any) => q.evidenceIds.includes(e.id))), basis: context.basis, profileVersion: version, createdAt: new Date().toISOString(), usage: result.usage }
    atlasWrite(key, report); return report
  } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', cancel) }
}
export function registerAssistant(handle: (name: string, fn: (...args: any[]) => any) => void) {
  handle('career-conversation-pitch-context', (_, p) => conversationPitchContext(p))
  handle('career-conversation-pitch', (_, p) => conversationPitch(p))
  handle('career-reply-draft', (_, p) => replyDraft(p))
  handle('career-followup-draft', (_, p) => replyDraft({...p,followup:true,automatic:false}))
  handle('career-interview-prepare', (_, p) => interviewPreparation(p))
  handle('career-model-settings', modelSettings)
  handle('career-model-save', (_, p) => saveModelSettings(p))
  handle('career-model-catalog', (_, p) => modelCatalog(p))
  handle('career-model-test', (_, p) => testModel(p))
}
