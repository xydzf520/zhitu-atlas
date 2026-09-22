import { atlasDb, atlasRead, atlasTransaction } from './atlas-store'
import {
  executionList,
  executionDetail,
  executionEvents,
  executionRunRow,
  setExecutionPaused,
  executionEvent,
  executionLink,
  parentExecution
} from './atlas-execution'
import { cancelTask, createTask } from './atlas-task-queue'
import { contactAction, contactRun } from './atlas-contact'
import { saveReplyEvent } from './career-reply-store'
import { updateDiscoveryRun } from './atlas-discovery-state'

function capabilities(run: any) {
  const task = atlasDb()
    .prepare('SELECT kind,state FROM task_runs WHERE id=? AND account_id=?')
    .get(run.owner_id, run.account_id)
  const managed =
    task?.kind?.startsWith('career-') ||
    ['first-contact', 'conversation-reply', 'discovery-run'].includes(task?.kind)
  return {
    pause: !!managed && ['queued', 'running', 'waiting', 'review', 'blocked'].includes(run.state),
    cancel: !!managed && ['queued', 'running', 'waiting', 'review', 'blocked'].includes(run.state),
    regenerate:
      !!task?.kind?.startsWith('career-') &&
      task.kind !== 'career-model-test' &&
      ['completed', 'failed', 'cancelled', 'interrupted'].includes(task.state),
    instruction: [
      'career-reply-draft',
      'career-followup-draft',
      'career-greeting-generate'
    ].includes(task?.kind)
  }
}
export function executionView(id: string) {
  const detail = executionDetail(id)
  return {
    ...detail,
    capabilities: capabilities({ ...detail.run, state: detail.run.underlyingState })
  }
}
export function controlExecution(input: any) {
  return atlasTransaction(() => {
    const run = executionRunRow(input?.id)
    if (input.baseRevision !== run.revision) throw Error('运行状态已变化，请更新后再操作；草稿保留')
    const caps = capabilities(run)
    if (input.action === 'pause') {
      if (!caps.pause) throw Error('此流程不能暂停，请使用所属模块的控制入口')
      return setExecutionPaused(input)
    }
    if (input.action === 'cancel') {
      if (!caps.cancel) throw Error('此阶段不能取消；已有发送仍需核实')
      if (run.owner_id.startsWith('contact:')) {
        const contact = contactRun(run.owner_id.slice(8))
        contactAction({
          accountId: run.account_id,
          id: contact.id,
          revision: contact.revision,
          action: 'cancel'
        })
      } else if (run.owner_id.startsWith('reply:')) {
        const event = atlasRead<any>('career-replies/' + run.owner_id.slice(6) + '.json', null)
        if (!event || !['queued', 'review', 'blocked'].includes(event.status))
          throw Error('回复已进入发送或结果核验，不能取消')
        event.status = 'dismissed'
        event.reason = '本人在运行台取消本条回复'
        saveReplyEvent(event)
        atlasDb()
          .prepare('UPDATE execution_runs SET paused=1,revision=revision+1 WHERE id=?')
          .run(run.id)
      } else if (run.owner_id.startsWith('discovery:')) {
        updateDiscoveryRun(run.account_id, run.owner_id.slice(10), {
          state: 'cancelled',
          message: '本人在运行台取消本轮发现'
        })
      } else cancelTask(run.owner_id)
      executionEvent(run.id, '', 'control', 'cancelled', '本人取消本次执行；已有结果保留')
      return { cancelled: true }
    }
    if (input.action === 'regenerate') {
      if (!caps.regenerate || input.confirmNewCall !== true)
        throw Error('请确认本次会创建新任务，可能产生新的模型用量')
      if (
        typeof input.instruction !== 'string' ||
        input.instruction.length > 600 ||
        (!caps.instruction && input.instruction.trim())
      )
        throw Error('本次表达要求无效或此类任务不支持表达调整')
      const old = atlasDb()
        .prepare('SELECT kind,input FROM task_runs WHERE id=? AND account_id=?')
        .get(run.owner_id, run.account_id)
      const { _taskBasis, ...payload } = JSON.parse(old.input)
      const created = createTask({
        channel: old.kind,
        payload: {
          ...payload,
          automatic: false,
          refresh: true,
          ...(caps.instruction ? { styleRequest: input.instruction.trim() } : {})
        }
      })
      parentExecution(created.taskId, run.owner_id, 'manual-regenerate', 'manual')
      executionEvent(run.id, '', 'control', 'completed', '本人明确重新生成；新任务保留原有业务校验')
      atlasDb().prepare('UPDATE execution_runs SET revision=revision+1 WHERE id=?').run(run.id)
      return { executionId: executionLink('task', created.taskId)?.run_id, taskId: created.taskId }
    }
    throw Error('不支持此运行操作')
  })
}
export function registerExecution(handle: (name: string, fn: (...args: any[]) => any) => void) {
  handle('career-execution-list', (_, p) => executionList(p))
  handle('career-execution-detail', (_, p) => executionView(p.id))
  handle('career-execution-events', (_, p) => executionEvents(p))
  handle('career-execution-control', (_, p) => controlExecution(p))
}
