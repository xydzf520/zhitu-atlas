export type CoordinationKind =
  | 'manual'
  | 'discover'
  | 'analysis'
  | 'contact'
  | 'research'
  | 'interview'
  | 'resume'
  | 'market'
  | 'strategy'
export interface CoordinationAction {
  id: string
  kind: CoordinationKind
  title: string
  reason: string
  target: string
  basis: string
  priority: number
  destination: string
  payload?: Record<string, unknown>
}
export const coordinationContract =
  '输出 {summary:string, actions:[{id:string,reason:string}]}。summary 最多 160 字；actions 最多 12 项，id 必须来自输入候选且不可重复，reason 为 1–180 字。仅选择和排列现有行动，不新增工具、参数、事实、授权或执行指令。'
export function validateCoordination(value: any, candidates: CoordinationAction[]) {
  if (
    !value ||
    typeof value.summary !== 'string' ||
    !value.summary.trim() ||
    value.summary.length > 160 ||
    !Array.isArray(value.actions) ||
    value.actions.length > 12
  )
    throw Error('安排格式无效，原安排保留')
  const ids = new Set<string>()
  for (const a of value.actions) {
    if (
      !a ||
      Object.keys(a).some((k) => !['id', 'reason'].includes(k)) ||
      !candidates.some((c) => c.id === a.id) ||
      ids.has(a.id) ||
      typeof a.reason !== 'string' ||
      !a.reason.trim() ||
      a.reason.length > 180
    )
      throw Error('协调 Agent 返回了未知、重复或越界行动，原安排保留')
    ids.add(a.id)
  }
  if (candidates.some((c) => c.priority === 0 && !ids.has(c.id)))
    throw Error('安排不能遗漏需要本人处理的重要事项')
  return { summary: value.summary, actions: value.actions as { id: string; reason: string }[] }
}
export const coordinationStates: Record<string, string> = {
  pending: '待安排',
  manual: '需要你处理',
  reviewed: '本人已处理',
  queued: '已排队',
  running: '执行中',
  completed: '模块已完成',
  failed: '执行失败',
  cancelled: '已取消',
  interrupted: '已中断',
  skipped: '已忽略',
  blocked: '待处理',
  stale: '依据已变化'
}
