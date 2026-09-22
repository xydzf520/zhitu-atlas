import { publicRepositoryUrl, type ProjectEvidence } from '../../common/portfolio'
import type { CareerProfile } from '../../common/career'
import { canonicalProfile, profileHistory } from './atlas-profile'
import { atlasRead, atlasWrite, fingerprint } from './atlas-store'

const lifetime = 24 * 60 * 60 * 1000
const key = (url: string) => 'atlas-project-verification/' + fingerprint(url)
interface Verification {
  url: string
  verified: boolean
  verifiedAt: string
  license: string
  reason: string
}

export function projectEvidence(profile: CareerProfile): ProjectEvidence[] {
  return profile.evidence
    .filter((e) => e.id && e.project)
    .map((e) => {
      const project = e.project!
      let result: Verification | null = null
      try {
        if (project.url)
          result = atlasRead<Verification | null>(key(publicRepositoryUrl(project.url)), null)
      } catch {
        /* Invalid legacy URL is never passed to a model or rendered as a link. */
      }
      const age = result ? Date.now() - Date.parse(result.verifiedAt) : Infinity
      const verified = !!result?.verified && age >= 0 && age < lifetime
      return {
        ...project,
        url: verified ? result!.url : '',
        evidenceId: e.id!,
        confirmed: !!e.confirmed,
        verified,
        verifiedAt: result?.verifiedAt || '',
        license: verified ? result!.license : '',
        reason: verified
          ? '公开仓库与许可证已核实；个人贡献以已确认经历为准'
          : result?.verified
            ? '仓库核实已超过 24 小时，请重新核实后附带链接'
            : result?.reason || '尚未核实公开仓库与许可证；只作项目经历，不称已开源'
      }
    })
}

export function projectFacts(profile: CareerProfile): ProjectEvidence[] {
  return profile.evidence
    .filter((e) => e.id && e.project)
    .map((e) => ({
      name: e.project!.name,
      scope: e.project!.scope,
      limitations: e.project!.limitations,
      evidenceId: e.id!,
      confirmed: !!e.confirmed,
      url: '',
      verified: false,
      verifiedAt: '',
      license: '',
      reason: '仅分析项目经历与能力；公开链接及开源状态在准备联系时另行核实'
    }))
}
export const projectFactsVersion = () =>
  ':project-facts:' + fingerprint(projectFacts(canonicalProfile()))

export const projectVersion = () => {
  const projects = projectEvidence(canonicalProfile())
  return projects.length
    ? ':projects:' +
        fingerprint(projects.map(({ verifiedAt: _at, reason: _reason, ...identity }) => identity))
    : ''
}

export async function verifyPublicProject(input: { evidenceId: string; profileVersion: string }) {
  const profile = canonicalProfile()
  if (input.profileVersion !== profileHistory()[0]?.id)
    throw Error('资料已变化，请保存并重新读取后核实')
  const evidence = profile.evidence.find((e) => e.id === input.evidenceId)
  if (!evidence?.project?.url) throw Error('请先保存项目仓库地址')
  const url = publicRepositoryUrl(evidence.project.url)
  const result: Verification = {
    url,
    verified: false,
    verifiedAt: new Date().toISOString(),
    license: '',
    reason: ''
  }
  try {
    // Fixed public API origin, no local credentials, no repository content or instructions executed.
    const response = await fetch(
      'https://api.github.com/repos/' + url.slice('https://github.com/'.length),
      {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Zhitu-Atlas-Portfolio' },
        redirect: 'error',
        signal: AbortSignal.timeout(15000)
      }
    )
    if (!response.ok)
      throw Error(
        response.status === 404
          ? '仓库尚未公开或地址不存在'
          : `公开仓库核实失败（HTTP ${response.status}）`
      )
    const repo = (await response.json()) as any
    if (
      repo.private !== false ||
      repo.visibility !== 'public' ||
      repo.html_url?.toLowerCase() !== url.toLowerCase() ||
      !repo.size
    )
      throw Error('仓库未公开、地址已迁移或尚无代码')
    const license = repo.license?.spdx_id
    if (typeof license !== 'string' || !license || license === 'NOASSERTION')
      throw Error('尚未识别到开源许可证，请检查仓库 LICENSE')
    result.verified = true
    result.license = license
    result.reason = '公开仓库及许可证核实通过'
  } catch (error: any) {
    result.reason =
      error?.name === 'TimeoutError'
        ? '公开仓库核实超时，请稍后重试'
        : error?.message || '仓库核实失败'
  }
  if (input.profileVersion !== profileHistory()[0]?.id)
    throw Error('核实期间资料已修改，本次结果未采用')
  atlasWrite(key(url), result)
  return result
}

export function registerPortfolio(
  handle: (name: string, handler: (...args: any[]) => any) => void
) {
  handle('career-projects-load', () => projectEvidence(canonicalProfile()))
  handle('career-project-verify', (_, input) => verifyPublicProject(input))
}
