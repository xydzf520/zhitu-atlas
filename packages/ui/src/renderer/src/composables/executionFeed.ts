import {
  computed,
  onActivated,
  onDeactivated,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
  type Ref
} from 'vue'

// One observer per query, shared by summary cards and the runtime workspace.
const feeds = new Map<
  string,
  { value: Ref<any>; error: Ref<string>; users: number; busy: boolean; last: number; query: any }
>()
let timer: ReturnType<typeof setInterval> | undefined
async function read(entry: ReturnType<typeof entryFor>) {
  if (entry.busy || !entry.users || document.hidden) return
  entry.busy = true
  try {
    entry.value.value = await electron.ipcRenderer.invoke('career-execution-list', entry.query)
    entry.error.value = ''
  } catch (e) {
    entry.error.value = e instanceof Error ? e.message : String(e)
  } finally {
    entry.busy = false
    entry.last = Date.now()
  }
}
function entryFor(key: string, query: any) {
  if (!feeds.has(key))
    feeds.set(key, {
      value: shallowRef<any>(null),
      error: ref(''),
      users: 0,
      busy: false,
      last: 0,
      query
    })
  return feeds.get(key)!
}
export function useExecutionFeed(query: () => any) {
  const active = ref(true),
    current = shallowRef<ReturnType<typeof entryFor>>()
  let previousKey = ''
  function detach() {
    if (current.value) {
      current.value.users--
      if (!current.value.users) feeds.delete(previousKey)
    }
    current.value = undefined
    if (!feeds.size) {
      clearInterval(timer)
      timer = undefined
    }
  }
  watch(
    () => JSON.stringify([active.value, query()]),
    () => {
      detach()
      if (!active.value) return
      const q = query()
      if (q === null) return
      const key = JSON.stringify(q)
      previousKey = key
      current.value = entryFor(key, q)
      current.value.users++
      void read(current.value)
      if (!timer)
        timer = setInterval(() => {
          if (document.hidden) return
          for (const e of feeds.values()) {
            const busy = e.value.value?.items?.some((r: any) =>
              ['queued', 'running', 'waiting'].includes(r.state)
            )
            if (Date.now() - e.last >= (busy ? 2000 : 12000)) void read(e)
          }
        }, 1000)
    },
    { immediate: true }
  )
  onActivated(() => {
    active.value = true
    if (current.value) void read(current.value)
  })
  onDeactivated(() => {
    active.value = false
  })
  onScopeDispose(detach)
  return {
    data: computed(() => current.value?.value.value),
    error: computed(() => current.value?.error.value || ''),
    refresh: () => (current.value ? read(current.value) : Promise.resolve())
  }
}
