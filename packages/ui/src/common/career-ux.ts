import type { CareerProfile } from './career'
import type { ReplyEvent, ReplySettings } from './auto-reply'
export function profileReadiness(p: CareerProfile) {
  return [
    { label: '姓名与求职定位', ready: !!p.name.trim() && !!p.headline.trim() },
    { label: '目标岗位与城市', ready: p.targetRoles.length > 0 && p.preferredCities.length > 0 },
    {
      label: '可核实的项目经历',
      ready: p.evidence.some(
        (e) => e.confirmed === true && !!e.text.trim() && e.keywords.length > 0
      )
    },
    { label: '个人优势与简历', ready: !!p.summary.trim() && !!p.resumeText.trim() }
  ]
}
export function bossCollectorLabel(s: any) {
  if (s?.enabled === false) return '自动读取已暂停'
  if (s?.state === 'queued') return s.fresh ? '已请求同步' : '请求尚未执行 · 请打开桌面 BOSS 工作台'
  if (!s?.fresh) return '等待桌面同步器连接'
  return ({ loading: '正在连接账号', syncing: '正在读取会话', details: '正在补齐岗位', idle: '后台在线 · 等待增量同步', blocked: '同步中断 · 需要检查', waiting: '等待核实登录', paused: '自动读取已暂停' } as Record<string, string>)[s.state] || '等待同步'
}
export function connectionSummary(
  connection: any,
  heartbeat: any,
  settings: ReplySettings,
  now = Date.now()
) {
  const fresh = (at: string) => {
    const age = now - Date.parse(at || '')
    return age >= -5000 && age < 45000
  }
  const automatic = connection?.automatic
  const collecting = automatic?.fresh && automatic.enabled && ['idle', 'syncing', 'details', 'loading'].includes(automatic.state) || (!automatic && connection?.state === 'connected' && fresh(connection?.syncAt))
  const live = heartbeat?.state === 'connected' && fresh(heartbeat?.at)
  const hour = Number(
    new Date(now).toLocaleString('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      hour12: false
    })
  )
  let replyLabel = '消息页未连接'
  if (settings.mode === 'off') replyLabel = '回复助手已暂停'
  else if (live && heartbeat.paused) replyLabel = '全部自动发送已暂停'
  else if (heartbeat?.state === 'error' && fresh(heartbeat?.at)) replyLabel = '回复助手需检查'
  else if (live && heartbeat.mode !== settings.mode) replyLabel = '策略等待生效'
  else if (live && settings.mode === 'review') replyLabel = '全部回复先确认'
  else if (live && (hour < settings.startHour || hour >= settings.endHour))
    replyLabel = '自动回复时段外'
  else if (live) replyLabel = '常规咨询自动回复中'
  return {
    collecting,
    live,
    sourceLabel: automatic ? bossCollectorLabel(automatic) : connection?.state === 'job-detail' && fresh(connection?.syncAt)
      ? 'BOSS 职位页已打开 · 消息页同步暂歇'
      : collecting
      ? 'BOSS 会话同步中'
      : connection?.syncAt
        ? '会话同步已断开'
        : '等待连接 BOSS',
    replyLabel
  }
}
export function replyQueue(
  events: ReplyEvent[],
  commands: Record<string, unknown>,
  filter = 'attention',
  query = ''
) {
  const category = (e: ReplyEvent) =>
    commands[e.id] || ['queued', 'sending'].includes(e.status)
      ? 'queued'
      : ['review', 'blocked', 'uncertain'].includes(e.status)
        ? 'attention'
        : 'history'
  const priority = (e: ReplyEvent) =>
    category(e) === 'attention' ? 0 : category(e) === 'queued' ? 1 : 2
  const q = query.trim().toLowerCase()
  const counts = { attention: 0, queued: 0, history: 0, all: events.length }
  events.forEach((e) => counts[category(e)]++)
  const items = events
    .filter(
      (e) =>
        (filter === 'all' || category(e) === filter) &&
        (!q || `${e.company} ${e.person} ${e.incoming}`.toLowerCase().includes(q))
    )
    .sort((a, b) => priority(a) - priority(b) || b.createdAt.localeCompare(a.createdAt))
  return { items, counts }
}
