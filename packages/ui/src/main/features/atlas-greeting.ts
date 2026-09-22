import { assertMetricScopes } from '../../common/greeting'
import { executionRule } from './atlas-execution'
import { resolveAgent, assertAgentCurrent, agentVersion, agentConfig, type AgentSnapshot } from './atlas-agents'
import { DEEPSEEK_REQUEST_TIMEOUT_MS } from '../../common/deepseek-policy'
import type { CareerEvidence, CareerJob } from '../../common/career'
import type { GreetingDraft, GreetingPurpose, GreetingResult } from '../../common/greeting'
import type { ProjectEvidence } from '../../common/portfolio'
import { projectEvidence, projectVersion, verifyPublicProject } from './atlas-portfolio'
import { discoveryAccount } from './atlas-discovery-state'
import { modelVersion } from './atlas-model-config'
import { deepseekGeneration } from '../../common/deepseek-policy'
import { atlasEvent, atlasRead, atlasWrite, fingerprint } from './atlas-store'
import { canonicalProfile, profileHistory } from './atlas-profile'
import { acquireLease, releaseLease, autoContactDecision } from './atlas-tasks'
import { keepLeaseAlive } from './atlas-tasks'
import { deepseekConfig, deepseekJson, modelCacheHit } from './atlas-deepseek'

const greetingPromptBase = 'atlas-greeting-12-no-default-question'
export const currentGreetingPromptVersion = () => agentVersion(greetingPromptBase, ['greeting', 'greeting-review']) + modelVersion() + projectVersion()
export function composeGreeting(opening: string, quotes: string[], ending: string) {
  const sentence = (value: string) => {
    const text = value.trim()
    return /[。.!！?？]$/.test(text) ? text : text.replace(/[，；：、,;:]+$/, '') + '。'
  }
  // Preserve every factual word. Separate multiple self-experience excerpts with a
  // light connector so they read as one person's points, not bolted-together sentences.
  const unique = [...new Set(quotes)]
  return sentence(opening) + unique.map(sentence).join(unique.length > 1 ? '另外，' : '') + ending
}
// Commitment-free closing variants. A stable per-job pick adds natural variety so
// repeated greetings to different recruiters don't all end with the identical line.
export const GREETING_ENDINGS: Record<string, string[]> = {
  none: [''],
  discuss: [
    '如果方向合适，希望进一步交流。',
    '希望有机会结合具体项目进一步沟通。'
  ],
  // Legacy prompt values remain valid, but no longer append a generic question.
  scope: [''],
  priorities: ['']
}
export function pickGreetingEnding(closing: string, job: CareerJob): string {
  const variants = GREETING_ENDINGS[closing]
  if (!variants?.length) throw new Error('招呼结构不完整')
  const seed = fingerprint([job.encryptJobId || job.jobName, job.companyName, closing])
  return variants[Number.parseInt(seed.slice(0, 8), 16) % variants.length]
}
const normalize = (v: string) => v.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
const bounded = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.trim().length >= min && v.length <= max
function validateJob(raw: any): CareerJob {
  if (
    !raw ||
    !bounded(raw.jobName, 1, 200) ||
    !bounded(raw.companyName, 1, 200) ||
    !bounded(raw.description, 80, 30000)
  )
    throw new Error('请填写公司、职位名称和 80–30000 字的完整招聘要求')
  return {
    jobName: raw.jobName.trim(),
    companyName: raw.companyName.trim(),
    description: raw.description.trim(),
    address: typeof raw.address === 'string' ? raw.address.slice(0, 500) : '',
    ...(typeof raw.cityName==='string'?{cityName:raw.cityName.slice(0,100)}:{}),
    ...(typeof raw.degreeName==='string'?{degreeName:raw.degreeName.slice(0,100)}:{}),
    ...(typeof raw.experienceName==='string'?{experienceName:raw.experienceName.slice(0,100)}:{}),
    encryptJobId: typeof raw.encryptJobId === 'string' ? raw.encryptJobId : undefined,
    salaryLow: typeof raw.salaryLow === 'number' ? raw.salaryLow : null,
    salaryHigh: typeof raw.salaryHigh === 'number' ? raw.salaryHigh : null
  }
}
// Numerical facts must occur in the selected source quotes, not just somewhere in the resume.
const quantities = (s: string) =>
  normalize(s).match(/\d+(?:\.\d+)?(?:%|万|亿|千|人|年|个月|万元|k|w)?/g) || []
const commitments =
  /(?:接受|同意|承诺|确定|保证).{0,12}(?:薪资|薪酬|工资|入职|到岗|面试)|(?:已|马上|立即|可以|可|会|将).{0,6}(?:发送|提供|附上).{0,6}(?:简历|附件)|(?:电话|微信|邮箱)[:：]|https?:\/\/|\b1[3-9]\d{9}\b/i
export function validateGreetingDraft(
  raw: any,
  job: CareerJob,
  evidence: CareerEvidence[],
  projects: ProjectEvidence[] = []
): GreetingDraft {
  if (
    !raw ||
    !['draft', 'insufficient'].includes(raw.decision) ||
    !Array.isArray(raw.matches) ||
    raw.matches.length > 3 ||
    !Array.isArray(raw.gaps) ||
    raw.gaps.length > 8 ||
    !raw.gaps.every((g: any) => bounded(g, 1, 200)) ||
    typeof raw.text !== 'string'
  )
    throw new Error('招呼结构不完整')
  if (raw.decision === 'insufficient') {
    if (raw.text || raw.matches.length || !raw.gaps.length)
      throw new Error('证据不足时应说明缺口，不生成自荐内容')
    return { decision: 'insufficient', matches: [], text: '', gaps: raw.gaps }
  }
  if (!raw.matches.length) throw new Error('招呼必须引用至少一项经历')
  if (!bounded(raw.text, 50, 220)) throw new Error(`招呼实际 ${raw.text.length} 字，须为 50–220 字；请减少引用项数并选用完整短句`)
  const linked = projects.filter(p => p.verified && p.confirmed && raw.matches.some((m: any) => m.evidenceId === p.evidenceId))
  let factualText = raw.text
  for (const p of linked) factualText = factualText.replace(`开源项目：${p.url}`, '')
  if (commitments.test(factualText)) throw new Error('招呼包含未经核实的链接、薪资／面试承诺、附件发送或联系方式，不符合自动招呼要求')
  const used = new Set<string>()
  for (const match of raw.matches) {
    const source = evidence.find((e) => e.id === match.evidenceId)
    if (
      !source ||
      used.has(match.evidenceId + '|' + match.requirement) ||
      !bounded(match.requirement, 4, 180) ||
      !normalize(job.description).includes(normalize(match.requirement)) ||
      !bounded(match.evidenceQuote, 8, 4000) ||
      !normalize(source.text).includes(normalize(match.evidenceQuote)) ||
      !bounded(match.relevance, 5, 240)
    )
      throw new Error('岗位要求或经历引用无法对应原文')
    used.add(match.evidenceId + '|' + match.requirement)
  }
  const facts = raw.matches.map((m: any) => m.evidenceQuote).join('\n')
  const allowed = new Set(quantities(facts))
  if (quantities(factualText).some((n) => !allowed.has(n)))
    throw new Error('招呼包含所引经历中没有的数字，请保留原始指标口径')
  assertMetricScopes(factualText, facts)
  if (
    /(?:提升|降低|增长|节省).{0,8}\d/.test(raw.text) &&
    !/(?:提升|降低|增长|节省).{0,8}\d/.test(facts)
  )
    throw new Error('不能把规模或覆盖率改写为效果提升')
  return {
    decision: 'draft',
    matches: raw.matches.map((m: GreetingDraft['matches'][number]) => ({
      requirement: m.requirement,
      evidenceId: m.evidenceId,
      evidenceQuote: m.evidenceQuote,
      relevance: m.relevance
    })),
    text: raw.text.trim(),
    gaps: raw.gaps
  }
}

export function greetingCurrent(result: GreetingResult, job: CareerJob) {
  return (
    agentConfig('greeting').enabled && agentConfig('greeting-review').enabled &&
    result.promptVersion === currentGreetingPromptVersion() &&
    result.profileVersion === profileHistory()[0]?.id &&
    result.jobHash === fingerprint(validateJob(job)) &&
    result.textHash === fingerprint(result.text)
  )
}
export async function generateGreeting(input: {
  job: CareerJob
  purpose?: GreetingPurpose
  styleRequest?: string
  preferredEvidenceId?: string
  refresh?: boolean
  baseProfileVersion?: string
  signal?: AbortSignal
  analysis?: any
  conversationContext?: { accountId: string; bossId: string; messages: { direction: string; text: string; id: string }[] }
}): Promise<GreetingResult> {
  if(input.styleRequest!==undefined && (typeof input.styleRequest!=='string' || input.styleRequest.length>600))throw Error('本次表达要求过长或无效')
  const variant = input?.purpose === 'conversation' ? 'conversation' : ''
  const writerAgent = resolveAgent('greeting', variant), reviewAgent = resolveAgent('greeting-review', variant)
  const job = validateJob(input?.job),
    purpose = input.purpose || 'preview'
  if (!['preview', 'automatic', 'conversation'].includes(purpose)) throw new Error('招呼生成模式无效')
  const profile = canonicalProfile(),
    profileVersion = profileHistory()[0].id
  if (
    input.preferredEvidenceId &&
    !profile.evidence.some((e) => e.id === input.preferredEvidenceId)
  )
    throw new Error('重点经历已变化，请重新选择')
  if (input.baseProfileVersion && input.baseProfileVersion !== profileVersion)
    throw new Error('资料版本已更新，请读取最新资料后生成；原草稿已保留')
  const evidence = profile.evidence.filter(
    (e) => e.id && e.text.trim() && (purpose === 'preview' || e.confirmed)
  )
  // Automatic tasks refresh expired public-repository metadata before binding the prompt version.
  // Repository failure preserves the task; it must not silently omit a requested project link.
  if (purpose === 'automatic') {
    for (const project of projectEvidence(profile).filter(p => p.confirmed && !p.verified && profile.evidence.some(e => e.id === p.evidenceId && e.project?.url))) {
      const verified = await verifyPublicProject({ evidenceId: project.evidenceId, profileVersion })
      if (!verified.verified) throw Error('项目链接待核实：' + verified.reason)
      if (input.signal?.aborted) throw Error('话术生成已取消')
    }
  }
  const promptVersion = currentGreetingPromptVersion()
  const projects = projectEvidence(profile).filter(p => evidence.some(e => e.id === p.evidenceId))
  if (!evidence.length)
    throw new Error(
      purpose !== 'preview' ? '尚无已确认经历，请先确认用于话术的工作经历' : '请先在个人资料中补充经历依据'
    )
  if (evidence.length > 50 || JSON.stringify(evidence).length > 40000)
    throw new Error('经历依据过多，请精简到与求职相关的事实')
  const requirements = job.description
    .match(/[^。；;\n]+[。；;\n]?/g)!
    .flatMap((s) => s.match(/.{1,180}/gs) || [])
    .filter((s) => s.trim().length >= 4)
    .map((text, i) => ({ id: 'r' + i, text: text.trim() }))
  const config = deepseekConfig(),
    jobHash = fingerprint(job)
  const id = fingerprint([
    discoveryAccount(), deepseekGeneration,
    profileVersion,
    jobHash,
    config.model,
    promptVersion,
    purpose,
    input.analysis || null,
    input.styleRequest || '',
    input.preferredEvidenceId || '',
    input.conversationContext || null
  ])
  const key = 'atlas-greeting-' + id,
    cached = atlasRead<GreetingResult | null>(key, null)
  if (cached && !input.refresh && greetingCurrent(cached, job)) { modelCacheHit('greeting',config.model,writerAgent); return { ...cached, cached: true } }
  const leaseKey = 'greeting:' + id,
    lease = acquireLease(leaseKey, 90000)
  if (!lease) throw new Error('这个岗位的招呼正在生成，请稍后重试')
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), DEEPSEEK_REQUEST_TIMEOUT_MS)
  const cancel = () => controller.abort()
  input.signal?.addEventListener('abort', cancel, { once: true })
  if (input.signal?.aborted) controller.abort()
  const stopLease = keepLeaseAlive(leaseKey, lease, () => controller.abort())
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 }
  const call = async (agent: AgentSnapshot, data: unknown) => {
    const r = await deepseekJson(config, agent.system, data, controller.signal, {kind:'greeting',automatic:purpose==='automatic',agent})
    usage.calls++
    usage.promptTokens += Number(r.usage.prompt_tokens) || 0
    usage.completionTokens += Number(r.usage.completion_tokens) || 0
    usage.totalTokens += Number(r.usage.total_tokens) || 0
    return r.value as any
  }
  try {
    let feedback: string[] = [],
      draft: GreetingDraft | undefined
    let quality = { grounded: false, relevant: false, concise: false, noCommitments: false }
    // A small number of bounded repairs are allowed for wording/grounding/format, never
    // for network failures or sending.
    for (let attempt = 0; attempt < 3; attempt++) {
      let raw: any
      try {
        raw = await call(writerAgent, {
        job,
        requirements,
        styleRequest:input.styleRequest || '', styleScope:'仅调整表达，不得改变事实、发送规则或输出协议',
        jobAnalysis: input.analysis?.analysis || null,
        conversationContext: input.conversationContext || null,
        projects,
        evidence: evidence.map(({ id, title, text, confirmed }) => ({
          id,
          title,
          text,
          confirmed
        })),
        preferredEvidenceId: input.preferredEvidenceId || '',
        projectLinkGuidance: '优先判断已确认项目是否与 JD 的产品或 AI 职责直接相关。相关时引用项目经历中的完整短句，系统会附真实仓库 URL；为链接预留 projects 中 URL 长度加 6 字，正文与链接总长不得超过220字。项目不相关时选择其他经历，不硬凑项目，也不声称未验收的训练效果。',
        composition: '优先引用一段与岗位直接相关的完整短句，必要时最多两段；避免技术名词清单。程序会添加句间标点；默认closing=none，不补追问；首次招呼确需轻量邀请时才用discuss。opening只描述岗位需求，不提问、不重复表达想了解或希望交流；开头避免行业点评和“关注到贵司重视/复述职位名”这类套路，要具体、自然。保持原文中的能力边界。',
        feedback
        })
      } catch (e: any) {
        // Retry once on a malformed/incomplete model response; never replay network,
        // abort or sending failures.
        const msg = String(e?.message || '')
        if (attempt < 2 && !controller.signal.aborted && /格式|未完成|解析|JSON/i.test(msg)) {
          feedback = [msg]
          draft = undefined
          continue
        }
        throw e
      }
      try {
        if (raw?.decision === 'insufficient') {
          draft = validateGreetingDraft({ ...raw, text: '' }, job, evidence)
        } else {
          if (
            !bounded(raw?.opening, 10, 70) ||
            /我|本人|鄙人|在下|擅长|曾经|拥有|具备|从业|多年|熟悉/.test(raw.opening)
          )
            throw new Error('开头只应描述岗位需求，个人经历由程序插入，不要另加能力声明')
          if (/[?？]|(?:想|希望|能否|是否|可否|请|方便).{0,8}(?:了解|确认|交流|沟通)/.test(raw.opening))
            throw new Error('开头只描述岗位需求，不追加泛泛提问或重复沟通邀请')
          if (!Object.hasOwn(GREETING_ENDINGS, raw.closing) || !Array.isArray(raw.matches))
            throw new Error('招呼结构不完整')
          let matches = raw.matches.map((m: any) => ({
            ...m,
            requirement: requirements.find((r) => r.id === m.requirementId)?.text,
            evidenceQuote: typeof m.evidenceQuote === 'string' ? m.evidenceQuote : evidence.find((e) => e.id === m.evidenceId)?.text
          }))
          const ending = purpose === 'conversation' ? '' : pickGreetingEnding(raw.closing, job)
          const assemble=(selected:any[]) => {
            let text = composeGreeting(raw.opening, selected.map((m:any) => m.evidenceQuote), ending)
            const project = projects.find(p => p.verified && p.confirmed && selected.some((m:any) => m.evidenceId === p.evidenceId))
            if (project) text += `\n开源项目：${project.url}`
            return text
          }
          // Retain a whole model-selected source quote. Never truncate facts, numbers or qualifiers.
          // The retained text still goes through exact-source validation and independent AI review.
          if(assemble(matches).length>220 && matches.length>1){
            const firstFit=matches.find((m:any)=>typeof m.evidenceQuote==='string' && assemble([m]).length<=220)
            if(firstFit)matches=[firstFit]
          }
          let text = assemble(matches)
          // Link length is included before selecting or repairing quotes, never silently dropped.
          draft = validateGreetingDraft({ ...raw, matches, text }, job, evidence, projects)
        }
      } catch (e) {
        feedback = [(e as Error).message]
        draft = undefined
        continue
      }
      if (draft.decision === 'insufficient') break
      let review: any
      try {
        review = await call(reviewAgent, {
          job,
          draft,
          projects: projects.filter(p => draft!.matches.some(m => m.evidenceId === p.evidenceId)),
          conversationContext: input.conversationContext || null,
          selectedEvidence: evidence
            .filter((e) => draft!.matches.some((m) => m.evidenceId === e.id))
            .map(({ id, title, text }) => ({ id, title, text }))
        })
      } catch (e: any) {
        const msg = String(e?.message || '')
        if (attempt < 2 && !controller.signal.aborted && /格式|未完成|解析|JSON/i.test(msg)) {
          feedback = [msg]
          draft = undefined
          continue
        }
        throw e
      }
      if (
        !review ||
        !['grounded', 'relevant', 'concise', 'noCommitments'].every(
          (k) => typeof review[k] === 'boolean'
        ) ||
        !Array.isArray(review.issues) ||
        !review.issues.every((s: any) => bounded(s, 1, 300))
      )
        throw new Error('招呼审校结果无效，草稿未获通过')
      quality = {
        grounded: review.grounded,
        relevant: review.relevant,
        concise: review.concise,
        noCommitments: review.noCommitments
      }
      if (Object.values(quality).every(Boolean) && !review.issues.length) break
      feedback = review.issues.length
        ? review.issues
        : ['事实依据或岗位相关性审校未通过，请据原文重写']
      draft = undefined
    }
    if (!draft) throw new Error('生成内容经多轮校验仍未通过：' + feedback.join('；'))
    if (profileHistory()[0]?.id !== profileVersion)
      throw new Error('生成期间资料已修改，本次结果未采用；请用最新资料重新生成')
    if (currentGreetingPromptVersion() !== promptVersion) throw Error('项目公开状态或话术配置已变化，请重新生成')
    executionRule('话术检查',draft.decision === 'insufficient' ? 'review' : 'completed',draft.decision === 'insufficient' ? '证据不足，不能自动发送' : '事实引用和表达审校通过',{...quality,evidenceIds:draft.matches.map(m=>m.evidenceId),validated:true})
    const reviewReasons = draft.decision === 'insufficient' ? [...draft.gaps] : []
    if (draft.matches.some((m) => !evidence.find((e) => e.id === m.evidenceId)?.confirmed))
      reviewReasons.push('所引经历尚未本人确认，仅供审核预览')
    const policyReason = autoContactDecision(job, profile)
    if (policyReason && purpose !== 'conversation') reviewReasons.push(policyReason)
    const value: GreetingResult = {
      ...draft,
      projects: projects.filter(p => draft!.matches.some(m => m.evidenceId === p.evidenceId)),
      id,
      job,
      profileVersion,
      jobHash,
      textHash: fingerprint(draft.text),
      model: config.model,
      promptVersion,
      createdAt: new Date().toISOString(),
      purpose,
      readyForAutomation:
        purpose === 'automatic' &&
        draft.decision === 'draft' &&
        !reviewReasons.length &&
        Object.values(quality).every(Boolean),
      reviewReasons,
      quality,
      usage,
      cached: false
    }
    assertAgentCurrent(writerAgent)
    assertAgentCurrent(reviewAgent)
    atlasWrite(key, value)
    atlasEvent('greeting-generated', id, {
      profileVersion,
      model: config.model,
      promptVersion,
      jobHash,
      decision: draft.decision,
      readyForAutomation: value.readyForAutomation,
      usage
    })
    return value
  } catch (e: any) {
    atlasEvent('greeting-failed', id, {
      model: config.model,
      profileVersion,
      usage,
      timeout: controller.signal.aborted
    })
    if (controller.signal.aborted) throw new Error('DeepSeek 招呼生成超时，原草稿与简历已保留')
    throw e
  } finally {
    input.signal?.removeEventListener('abort', cancel)
    clearTimeout(timer)
    stopLease()
    releaseLease(leaseKey, lease)
  }
}
