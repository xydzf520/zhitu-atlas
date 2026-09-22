export const executionStates: Record<string, string> = {
  queued: '等待执行',
  running: '运行中',
  waiting: '等待条件',
  review: '待你处理',
  blocked: '条件未满足',
  paused: '已暂停',
  failed: '失败',
  uncertain: '结果不确定',
  interrupted: '已中断，待核实',
  completed: '已完成',
  cancelled: '已取消',
  cached: '复用结果',
  manual: '本人已核实',
  stale: '依据已变化',
  skipped: '已跳过'
}
export const executionKinds: Record<string, string> = {
  'coordination-run': '求职协调（规则安排）',
  'career-coordinator-plan': '求职协调安排',
  'career-contact-prepare': '准备岗位联系',
  'career-model-test': '模型连接验证',
  'career-ai-analyze': '岗位分析',
  'career-discovery-analyze': '岗位分析',
  'career-greeting-generate': '匹配招呼',
  'career-strategy-optimize': '搜索策略复盘',
  'career-reply-draft': '回复草稿',
  'career-conversation-pitch': '会话匹配话术',
  'career-followup-draft': '跟进草稿',
  'career-interview-prepare': '面试准备',
  'career-company-research': '企业研判',
  'career-resume-review': '简历竞争力',
  'career-market-review': '市场机会',
  'first-contact': '岗位自动联系',
  'discovery-run': '岗位发现',
  'boss-sync': '账号同步',
  'send-first-contact': '首次联系发送',
  'send-reply': '回复发送',
  'send-follow-up': '跟进发送',
  'conversation-reply': '处理招聘者消息'
}
export function executionState(state: string) {
  return (
    (
      {
        analyzing: 'running',
        syncing: 'running',
        details: 'running',
        generating: 'running',
        opening: 'running',
        sending: 'running',
        verifying: 'running',
        idle: 'completed',
        sent: 'completed',
        cooling: 'waiting',
        ready: 'waiting',
        awaiting_confirmation: 'review',
        dismissed: 'skipped',
        existing: 'skipped'
      } as Record<string, string>
    )[state] || state
  )
}
export function executionDestination(kind: string, id: string) {
  const base = '/main-layout/'
  if (kind === 'conversation')
    return base + 'CareerDashboard?view=replies&conversation=' + encodeURIComponent(id)
  if (kind === 'job') return base + 'CareerDiscovery?job=' + encodeURIComponent(id)
  if (kind === 'opportunity')
    return base + 'CareerDashboard?view=companies&job=' + encodeURIComponent(id)
  if (kind === 'profile' || kind === 'market') return base + 'CareerInsights'
  return ''
}
