// Preparation aids derived from observed messages and cited evidence.
// They do not infer a recruiter's personality, intent or hiring probability.
export function requirementEvidenceState(r: any, result: any, evidence: any[] = [], outdated = false): 'met' | 'verify' | 'gap' {
    if (outdated) return 'verify'
    if (r.status === 'gap') return 'gap'
    return r.status === 'met' && Array.isArray(r.evidenceIds) && r.evidenceIds.length &&
      r.evidenceIds.every((id: string) => evidence.some(e => e.id === id && e.confirmed) && result.evidenceConfirmation?.[id] !== false)
      ? 'met' : 'verify'
}
export function hiringBrief(result: any, evidence: any[] = [], outdated = false) {
  const requirements: any[] = Array.isArray(result?.analysis?.requirements) ? result.analysis.requirements : []
  const state = (r: any) => requirementEvidenceState(r, result, evidence, outdated)
  const essential = requirements.filter(r => r.essential === true)
  const counts = { met: 0, verify: 0, gap: 0 }
  for (const r of essential) counts[state(r)]++
  const proof = requirements.filter(r => state(r) === 'met').slice(0, 3).map(r => ({
    requirement: r.requirement,
    evidence: r.evidenceIds.map((id: string) => evidence.find(e => e.id === id)).map((e: any) => ({ id: e.id, title: e.title, text: e.text, source: e.source })),
    question: `针对“${r.requirement}”，你具体做了什么，如何核对结果？`
  }))
  const questions = requirements.filter(r => state(r) !== 'met').slice(0, 3).map(r => ({
    requirement: r.requirement,
    question: r.essential ? `“${r.requirement}”是必须满足的准入条件，还是可用相关实践补充说明？` : `这个岗位的“${r.requirement}”具体要解决什么问题、如何衡量结果？`,
    status: state(r)
  }))
  return { counts, essentialCount: essential.length, proof, questions,
    next: outdated ? '先更新分析，再准备对外介绍。' : counts.gap ? '存在明确的必要条件缺口，先核对要求，暂不自动联系。' : counts.verify ? '先补齐必要条件的依据，再决定是否联系。' : !proof.length ? '先找到能支撑岗位需求的已确认经历，避免泛泛介绍。' : '挑选最贴切的一项经历，说明你的行动与结果，再邀请对方确认岗位重点。',
    businessGoal: typeof result?.analysis?.businessGoal === 'string' ? result.analysis.businessGoal : '' }
}

export function isRecruiterDecline(text: string) {
  return /很抱歉[，,][\s\S]*当前的职位需求不是很匹配|(?:目前|暂时|当前)(?:不太适合|不合适|不匹配|不考虑)|(?:岗位|职位)(?:已经|已)(?:招满|招到|关闭)|(?:暂时|已|已经)(?:停止|暂停)招聘|感谢[\s\S]{0,25}(?:暂不|不再)考虑/.test(text)
}

export function conversationGuide(conversation: any, messages: any[] = [], latestPage = true, pending = 0) {
  const base = { title: '先核对当前会话', reason: '仅根据已同步消息提供准备建议，不判断招聘者的性格或录用意向。', steps: ['读取最新消息正文', '确认关联岗位与工作地点', '再决定回复或准备材料'], action: 'boss' }
  if (!latestPage) return { ...base, title: '正在查看历史消息', reason: '旧消息不能代表当前进度，请返回最新消息后再准备回复。' }
  if (pending > 0) return { ...base, title: `先处理 ${pending} 条待确认记录`, reason: '已有草稿或发送结果需要核实，避免重复联系。', steps: ['核对原文、会话和发送记录', '确认重要事项或不确定结果', '处理完成后再准备新内容'], action: 'review' }
  const textMessages = messages.filter(m => m.type === 'text' && typeof m.text === 'string' && m.text.trim() && ['sent', 'received'].includes(m.direction))
  const latest = textMessages[textMessages.length - 1]
  // A newer summary without loaded body is not enough to compose an answer.
  if (!latest || (conversation?.lastMessageAt && (!latest.sentAt || Date.parse(conversation.lastMessageAt) > Date.parse(latest.sentAt)))) return base
  if (latest.direction === 'sent') return { ...base, title: '已发出说明，等待回应', reason: '最后一条已同步文本由你发出；未回复不代表拒绝或不感兴趣。', steps: ['核对是否已发送过相关经历和项目地址', '准备一个尚未说明的案例，避免重复自荐', '需要跟进时先确认岗位仍在招聘，再由本人决定发送'] }
  if (isRecruiterDecline(latest.text)) return { ...base, title: '记录婉拒，调整投入', reason: '已读到明确的婉拒或停止招聘信息；结束机会由本人决定。', steps: ['记录对方明确说明的原因，未说明则保留未知', '核对是否仍有其他适合岗位', '由本人决定归档，不继续自动追问'] }
  if (/简历|附件|作品集/.test(latest.text)) return { ...base, title: '准备与岗位相关的简历或作品', reason: '对方索要资料不等于已经认可匹配，也不等于面试邀请。', steps: ['核对企业、岗位和正在使用的简历版本', '选出一项对应 JD 的成果，核对 GitHub 项目与个人贡献', '本人确认后发送附件或作品，并核实平台结果'] }
  if (/面试|约.{0,8}时间|offer|录用|薪资|期望.{0,5}薪|入职|到岗/i.test(latest.text)) return { ...base, title: '重要事项由你确认', reason: '涉及时间、待遇或承诺，先核对具体条件，不由 AI 代为答应。', steps: ['明确岗位、对接人、时间或待遇口径', '整理可核实的问题和条件', '本人确认后回复，再记录下一步'] }
  return { ...base, title: '先回答对方的问题', reason: '已读取招聘方文本；优先回应具体问题，再补充相关经历。', steps: ['一句话回应对方当前问题', '必要时补充一项真实经历和结果', '留下一个便于回答的问题，不重发整段自我介绍'], action: 'reply' }
}
