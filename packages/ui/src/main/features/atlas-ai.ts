import { resolveAgent, agentVersion } from './atlas-agents'
import {
  deepseekGeneration,
  DEEPSEEK_REQUEST_TIMEOUT_MS,
  DEEPSEEK_MAX_JSON_CHARS
} from '../../common/deepseek-policy'
import { deepseekJson, deepseekConfig, modelCacheHit } from './atlas-deepseek'
import { modelVersion } from './atlas-model-config'
import { canonicalProfile, profileHistory } from './atlas-profile'
import { atlasRead, atlasWrite, atlasEvent, fingerprint } from './atlas-store'
import { assessCareerJob } from '../../common/career'
import { projectFacts, projectFactsVersion } from './atlas-portfolio'
export const analysisPromptVersion = 'atlas-jd-13-general-careers'
export const currentAnalysisPromptVersion = () =>
  agentVersion(analysisPromptVersion, ['analysis']) + modelVersion() + projectFactsVersion()
export const analysisOutputTokens = deepseekGeneration.max_tokens
export function analysisModel() {
  try {
    return deepseekConfig().model
  } catch {
    return ''
  }
}
export async function analyzeJob(input: any) {
  const { observedAt: _observed, detailAt: _detail, ...job } = input?.job || {}
  const discovery = input?.mode === 'discovery'
  const agent = resolveAgent('analysis', discovery ? 'discovery' : ''),
    promptVersion = currentAnalysisPromptVersion()
  if (
    !job ||
    typeof job.description !== 'string' ||
    job.description.length < 80 ||
    job.description.length > 30000 ||
    typeof job.jobName !== 'string' ||
    job.jobName.length > 500
  )
    throw new Error('请提供岗位名称及 80–30000 字的完整 JD')
  const profile = canonicalProfile(),
    config = deepseekConfig()
  const profileVersion = profileHistory()[0]?.id || fingerprint(profile),
    cacheKey =
      'atlas-ai/' +
      fingerprint([
        profileVersion,
        job,
        config.model,
        promptVersion,
        discovery,
        analysisOutputTokens,
        deepseekGeneration,
        atlasRead<any>('career-boss-sync.json', null)?.account?.id || 'local'
      ])
  if (input.baseProfileVersion && input.baseProfileVersion !== profileVersion)
    throw Error('资料版本已更新，请重新读取后分析')
  const cached = atlasRead<any>(cacheKey, null)
  if (cached && !input.refresh) {
    modelCacheHit('analysis', config.model, agent)
    return { ...cached, cached: true }
  }
  const evidence = [
      ...profile.evidence.map(({ project: _project, ...e }) => e),
      ...(profile.qualifications || []).map((f) => ({
        id: f.id,
        title: f.label,
        text: f.value,
        source: f.source,
        confirmed: f.confirmed,
        keywords: []
      }))
    ].filter((e) => discovery || e.confirmed),
    allowed = new Set(evidence.map((e) => e.id))
  const projects = projectFacts(profile).filter((p) => allowed.has(p.evidenceId))
  if (!evidence.length && !discovery) throw new Error('请先在个人资料中核对并确认经历依据')
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), DEEPSEEK_REQUEST_TIMEOUT_MS)
  const cancel = () => controller.abort()
  input?.signal?.addEventListener('abort', cancel, { once: true })
  if (input?.signal?.aborted) controller.abort()
  try {
    const generated = await deepseekJson(
      deepseekConfig(),
      agent.system,
      {
        job,
        candidate: {
          name: profile.name,
          headline: profile.headline,
          targetRoles: profile.targetRoles,
          preferredCities: profile.preferredCities,
          minimumMonthlyK: profile.minimumMonthlyK,
          evidence,
          projects
        }
      },
      controller.signal,
      { kind: 'analysis', automatic: !!input.automatic, agent }
    )
    const analysis: any = generated.value
    const result: any = {
      usage: generated.usage,
      choices: [{ finish_reason: generated.finishReason }]
    }
    if (
      !analysis ||
      typeof analysis.businessGoal !== 'string' ||
      !Array.isArray(analysis.requirements) ||
      !['strengths', 'gaps', 'questions', 'resumeSuggestions'].every(
        (k) => Array.isArray(analysis[k]) && analysis[k].every((v: any) => typeof v === 'string')
      ) ||
      typeof analysis.draft !== 'string' ||
      JSON.stringify(analysis).length > DEEPSEEK_MAX_JSON_CHARS
    )
      throw new Error('模型分析格式不完整，请重试')
    if (
      analysis.recommendation &&
      (!['prioritize', 'consider', 'verify', 'skip'].includes(analysis.recommendation.decision) ||
        typeof analysis.recommendation.reason !== 'string' ||
        typeof analysis.recommendation.nextStep !== 'string')
    )
      throw new Error('模型推荐结论格式无效，原有分析已保留')
    if (discovery && !analysis.recommendation)
      analysis.recommendation = {
        decision: 'verify',
        reason: '模型尚未给出完整推荐结论，请结合逐项分析核实。',
        nextStep: '核对必要条件后再决定是否联系。'
      }
    for (const r of analysis.requirements)
      if (
        typeof r.requirement !== 'string' ||
        typeof r.assessment !== 'string' ||
        !Array.isArray(r.evidenceIds) ||
        r.evidenceIds.some((id: string) => !allowed.has(id))
      )
        throw new Error('模型引用了不存在的经历，结果已拦截')
    for (const r of analysis.requirements) {
      r.status = ['met', 'verify', 'gap'].includes(r.status) ? r.status : 'verify'
      if (
        r.status === 'met' &&
        (!r.evidenceIds.length ||
          r.evidenceIds.some((id: string) => !evidence.find((e) => e.id === id)?.confirmed))
      )
        r.status = 'verify'
      r.essential = r.essential === true
    }
    if (
      discovery &&
      analysis.requirements.some((r: any) => r.essential && r.status === 'gap') &&
      ['prioritize', 'consider'].includes(analysis.recommendation?.decision)
    )
      analysis.recommendation.decision = 'verify'
    const value = {
      analysis,
      projects: projects.filter((p) =>
        analysis.requirements.some((r: any) => r.evidenceIds.includes(p.evidenceId))
      ),
      provisional: evidence.some((e) => !e.confirmed),
      evidenceConfirmation: Object.fromEntries(evidence.map((e) => [e.id, !!e.confirmed])),
      profileVersion,
      model: config.model,
      promptVersion,
      maxOutputTokens: config.generation.max_tokens,
      thinking: 'thinking' in config.generation ? 'enabled' : 'provider-default',
      reasoningEffort:
        'reasoning_effort' in config.generation
          ? config.generation.reasoning_effort
          : 'provider-default',
      contextWindowTokens: config.contextWindowTokens,
      finishReason: result.choices?.[0]?.finish_reason || 'unknown',
      createdAt: new Date().toISOString(),
      ruleAssessment: assessCareerJob(job, profile),
      usage: result.usage || null
    }
    if ((profileHistory()[0]?.id || fingerprint(canonicalProfile())) !== profileVersion)
      throw Error('分析期间资料已变化，请使用最新资料重新分析')
    if (currentAnalysisPromptVersion() !== promptVersion)
      throw Error('项目经历或分析配置已变化，请重新分析')
    atlasWrite(cacheKey, value)
    atlasEvent('ai-analysis', 'profile', {
      model: config.model,
      profileVersion,
      usage: result.usage || null
    })
    return { ...value, cached: false }
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('模型响应超时，当前资料已保留')
    if (e instanceof SyntaxError) throw new Error('模型未返回有效 JSON，当前资料已保留')
    throw e
  } finally {
    input?.signal?.removeEventListener('abort', cancel)
    clearTimeout(timer)
  }
}
