/** A work sample supports a confirmed experience; it never confirms authorship or outcomes. */
export interface CareerProject {
  name: string
  url: string
  scope: string
  limitations: string
}
export interface ProjectEvidence extends CareerProject {
  evidenceId: string
  confirmed: boolean
  verified: boolean
  verifiedAt: string
  license: string
  reason: string
}

export function publicRepositoryUrl(value: string): string {
  if (typeof value !== 'string' || value.length > 300) throw Error('请填写公开 GitHub 仓库地址')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash)
    throw Error('作品链接仅支持不带凭据的 HTTPS GitHub 仓库地址')
  const match = /^\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/?$/.exec(url.pathname)
  if (!match || ['.', '..'].includes(match[2])) throw Error('请填写仓库首页地址，不是文件或个人主页')
  return `https://github.com/${match[1]}/${match[2].replace(/\.git$/, '')}`
}

export function validateProject(project: CareerProject) {
  if (!project || !(['name', 'url', 'scope', 'limitations'] as const).every(key => typeof project[key] === 'string'))
    throw Error('作品信息格式不正确')
  if (!project.name.trim() || project.name.length > 100 || project.scope.length > 1500 || project.limitations.length > 1500)
    throw Error('请补充作品名称，并将职责与能力边界分别控制在 1500 字内')
  if (project.url) publicRepositoryUrl(project.url)
}
