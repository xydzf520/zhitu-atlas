/** Narrow, explainable checks. Passing these checks is not a semantic or factual review. */
export type CommunicationIssue = { code: string; severity: 'block' | 'review'; reason: string; excerpt: string }
export type ReplyIntent = 'location' | 'greeting' | 'other'
export const COMMUNICATION_STYLE_VERSION = 'communication-style-1'

export function communicationStyleIssues(input: {
  text: string
  incoming?: string
  intent?: ReplyIntent
  audience?: 'hr' | 'business' | 'technical' | 'unknown'
}): CommunicationIssue[] {
  const { text, incoming = '', intent = 'other', audience = 'unknown' } = input
  const issues: CommunicationIssue[] = []
  const add = (code: string, severity: CommunicationIssue['severity'], reason: string, excerpt: string) =>
    issues.push({ code, severity, reason, excerpt })
  // A request to introduce the role/team is not a neutral sign-off. It is only
  // appropriate when the recruiter explicitly invites questions; factual review
  // must still check whether that information is already known.
  const broadQuestion = text.match(/(?:方便|能否|可以|可否|能不能|请|想|希望)[^。！？!?\n]{0,32}(?:介绍|了解|发一下|发下|说说|确认|交流|聊聊)[^。！？!?\n]{0,36}(?:岗位职责|职责范围|核心职责|团队情况|团队目标|核心业务目标|岗位.{0,6}(?:重点|方向|业务问题|负责的板块))[^。！？!?\n]*[。！？!?]?/)
  const invited = /(?:你|您)(?:还有|有|是否有)?.{0,12}(?:想了解|想问|要问|什么问题)|有什么.{0,6}(?:想了解|想问)|想先了解哪些/.test(incoming)
  if (broadQuestion && !invited)
    add('unprompted-role-question', 'block', '回复默认追加了岗位或团队追问；先回答当前问题，不把索要信息当作结尾。', broadQuestion[0])
  const limit = intent === 'location' ? 55 : intent === 'greeting' ? 60 : 0
  if (limit && [...text].length > limit)
    add('simple-answer-overloaded', 'block', '地点确认或普通招呼被扩展成长段介绍，请只回答当前问题。', text)
  const internal = text.match(/公开版本.{0,12}(?:去除|清理)|原绑定编码运行时|替代\s*Harness.{0,8}尚待集成/i)
  if (internal && !/Harness|运行时|开源版本|公开版本|集成状态/i.test(incoming))
    add('internal-maintenance-detail', 'review', '普通咨询带出了无关的版本维护说明，建议先解释业务用途。', internal[0])
  const terms = [...new Set(text.match(/\b(?:MCP|LangGraph|Harness|LoRA|QLoRA|RAG|Function Calling)\b|幂等|有界阶段/gi) || [])]
  if (audience !== 'technical' && terms.length >= 3)
    add('jargon-density', 'review', '多个未解释的技术术语增加阅读负担；根据接收者和问题决定是否保留。', terms.join('、'))
  const lecture = text.match(/^(?:您好[，,]?)?(?:企业级|企业|智能体|AI).{0,35}(?:关键不在|关键在于|必须|应该)/)
  if (lecture)
    add('industry-commentary-opening', 'review', '开头偏行业点评，建议先说明本人经历与这个岗位的联系。', lecture[0])
  return issues
}
