import { onScopeDispose, onDeactivated } from 'vue'

// Page observers can stop without cancelling the persistent backend task.
export function useAITasks() {
  const observers = new Set<AbortController>()
  const stop = () => { for (const observer of observers) observer.abort(); observers.clear() }
  onScopeDispose(stop)
  onDeactivated(stop)
  return async (channel: string, payload: any, onProgress?: (task: any) => void) => {
    const observer = new AbortController()
    observers.add(observer)
    try { return await runAITask(channel, payload, onProgress, observer.signal) }
    finally { observers.delete(observer) }
  }
}
export async function runAITask(channel: string, payload: any, onProgress?: (task: any) => void, signal?: AbortSignal) {
  const { taskId } = await electron.ipcRenderer.invoke('career-task-create', { channel, payload })
  const started = Date.now()
  while (Date.now() - started < 55 * 60 * 1000) {
    if (signal?.aborted) throw Error('页面已关闭；任务仍保留在任务中心。')
    const task = await electron.ipcRenderer.invoke('career-task-get', { id: taskId })
    if (signal?.aborted) throw Error('页面已关闭；任务仍保留在任务中心。')
    onProgress?.(task)
    if (task.state === 'completed') return task.result
    if (['failed','cancelled','interrupted'].includes(task.state)) throw Error(task.error || task.step)
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
      const timer = setTimeout(done, document.hidden ? 15000 : 2000)
      signal?.addEventListener('abort', done, { once: true })
      if (signal?.aborted) done()
    })
  }
  throw Error('任务仍在后台处理，请在任务中心查看；没有重新发起模型调用。')
}
