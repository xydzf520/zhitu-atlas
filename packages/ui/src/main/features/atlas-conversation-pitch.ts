import { bossConversationDetail } from './atlas-boss-sync'
import { canonicalProfile, profileHistory } from './atlas-profile'
import { fingerprint } from './atlas-store'
import { agentConfig } from './atlas-agents'
import { generateGreeting, currentGreetingPromptVersion } from './atlas-greeting'

// Resolve every fact on the service side. A caller may select a linked job, but
// cannot substitute a JD, another account's conversation, or unconfirmed facts.
function basis(input: any) {
  const conversation = bossConversationDetail({
    accountId: input?.accountId,
    bossId: input?.bossId,
    page: 1
  })
  const jobs = conversation.jobs
  const sourceJob = input?.jobId
    ? jobs.find((j: any) => j.encryptJobId === input.jobId)
    : jobs.length === 1
      ? jobs[0]
      : undefined
  if (input?.jobId && !sourceJob) throw Error('此岗位不属于当前会话，请重新选择关联岗位')
  // DOM-captured details can omit companyName. Use the same verified account/conversation link, never a name-based join.
  const job = sourceJob
    ? { ...sourceJob, companyName: sourceJob.companyName || conversation.body.companyName || '' }
    : undefined
  const companySource = sourceJob?.companyName
    ? 'job'
    : job?.companyName
      ? 'conversation'
      : 'unknown'
  const profileVersion = profileHistory()[0]?.id
  const evidence = canonicalProfile().evidence.filter((e) => e.confirmed && e.text.trim())
  const messages = conversation.messages
    .filter((m: any) => m.type === 'text' && m.text)
    .slice(-20)
    .map((m: any) => ({ id: m.id, direction: m.direction, text: m.text }))
  const jobBasis = job
    ? {
        encryptJobId: job.encryptJobId,
        jobName: job.jobName,
        companyName: job.companyName,
        description: job.description,
        address: job.address,
        salaryLow: job.salaryLow,
        salaryHigh: job.salaryHigh,
        degreeName: job.degreeName,
        experienceName: job.experienceName
      }
    : null
  const revision = fingerprint([
    conversation.accountId,
    input.bossId,
    jobBasis,
    messages,
    profileVersion,
    currentGreetingPromptVersion(),
    agentConfig('greeting').signature,
    agentConfig('greeting-review').signature
  ])
  const reason = !job
    ? jobs.length > 1
      ? '此会话关联多个岗位，请先选择本次话术对应的岗位。'
      : '尚未关联岗位，请先在 BOSS 打开会话中的职位详情。'
    : !job.companyName || !job.jobName
      ? '公司或岗位名称尚未读取，请在 BOSS 打开对应会话和职位详情。'
      : !job.description || job.description.trim().length < 80
        ? '岗位 JD 尚未补齐，请先打开完整职位详情并等待同步。'
        : !evidence.length
          ? '尚无已确认的工作经历，请先在简历与资料中确认。'
          : !agentConfig('greeting').enabled || !agentConfig('greeting-review').enabled
            ? '匹配招呼或事实审校 Agent 已停用，请先在 Agent 管理中启用。'
            : ''
  return { conversation, job, companySource, messages, evidence, profileVersion, revision, reason }
}
export function conversationPitchContext(input: any) {
  const b = basis(input)
  return {
    accountId: b.conversation.accountId,
    bossId: input.bossId,
    jobId: b.job?.encryptJobId || '',
    jobName: b.job?.jobName || '',
    companyName: b.job?.companyName || '',
    companySource: b.companySource,
    confirmedEvidenceCount: b.evidence.length,
    profileVersion: b.profileVersion,
    basis: b.revision,
    ready: !b.reason,
    reason: b.reason
  }
}
export async function conversationPitch(input: any) {
  const b = basis(input)
  if (b.reason) throw Error(b.reason)
  if (!input.baseBasis || input.baseBasis !== b.revision)
    throw Error('岗位、资料或会话已更新，请读取最新依据后生成')
  const result = await generateGreeting({
    job: b.job,
    purpose: 'conversation',
    baseProfileVersion: b.profileVersion,
    signal: input.signal,
    conversationContext: {
      accountId: b.conversation.accountId,
      bossId: input.bossId,
      messages: b.messages
    }
  })
  if (input.signal?.aborted || basis(input).revision !== b.revision)
    throw Error('生成期间岗位、资料或会话发生变化，本次结果不采用，原草稿保留')
  return {
    ...result,
    accountId: b.conversation.accountId,
    bossId: input.bossId,
    jobId: b.job.encryptJobId,
    basis: b.revision,
    matches: result.matches.map((m) => ({
      ...m,
      evidenceTitle: b.evidence.find((e) => e.id === m.evidenceId)?.title || '已确认经历'
    })),
    reason:
      result.decision === 'insufficient'
        ? result.gaps.join('；')
        : '结合本岗位 JD、已确认经历和当前会话生成，已通过事实与相关性审校；发送仍需你决定。'
  }
}
