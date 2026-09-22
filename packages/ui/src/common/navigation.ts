export const atlasRoutePrefix = '/main-layout/'
export const atlasPageTitles = {
  CareerDashboard: '全景总览',
  CareerInsights: '全局分析',
  CareerDiscovery: '机会发现',
  CareerBoss: 'BOSS 工作台',
  CareerWorkspace: '简历与资料',
  CareerTasks: '任务中心',
  CareerAgents: 'Agent 管理',
  CareerSettings: '设置'
} as const
export type AtlasPage = keyof typeof atlasPageTitles
type Query = Record<string, string | null | (string | null)[] | undefined>
type Target = { page: AtlasPage; query?: Query }

// Old bookmarks are input data. They never name a component or execution module.
const bookmarks: Record<string, Target> = {
  taskManager: { page: 'CareerTasks' },
  GeekAutoStartChatWithBoss: { page: 'CareerDiscovery' },
  ReadNoReplyReminder: { page: 'CareerDashboard', query: { view: 'replies' } },
  StartChatRecord: { page: 'CareerDashboard', query: { view: 'replies' } },
  MarkAsNotSuitRecord: { page: 'CareerDiscovery', query: { filter: 'dismissed' } },
  JobLibrary: { page: 'CareerDiscovery', query: { filter: 'all' } },
  BossLibrary: { page: 'CareerDashboard', query: { view: 'companies' } },
  CompanyLibrary: { page: 'CareerDashboard', query: { view: 'companies' } }
}
export const atlasBookmarkPaths = Object.keys(bookmarks)

export function resolveAtlasNavigation(path: string, query: Query = {}, hash = '') {
  const name = path.startsWith(atlasRoutePrefix) ? path.slice(atlasRoutePrefix.length) : ''
  const target = Object.hasOwn(bookmarks, name) ? bookmarks[name] : undefined
  if (target)
    return { path: atlasRoutePrefix + target.page, query: { ...query, ...target.query }, hash }
  if (path === atlasRoutePrefix + 'CareerSettings' && query.section === 'tasks') {
    const { section: _section, ...remaining } = query
    return { path: atlasRoutePrefix + 'CareerTasks', query: remaining, hash }
  }
  if (path === atlasRoutePrefix + 'CareerDashboard' && query.view === 'sync') {
    const { view: _view, ...remaining } = query
    return { path: atlasRoutePrefix + 'CareerTasks', query: { ...remaining, tab: 'sync' }, hash }
  }
  return null
}

export function atlasPageTitle(path: string, query: Query = {}) {
  const page = path.slice(atlasRoutePrefix.length) as AtlasPage
  if (path === atlasRoutePrefix + 'CareerDashboard') {
    if (query.view === 'companies') return '企业与进展'
    if (query.view === 'replies') return '沟通中心'
  }
  return Object.hasOwn(atlasPageTitles, page)
    ? atlasPageTitles[page]
    : atlasPageTitles.CareerDashboard
}
