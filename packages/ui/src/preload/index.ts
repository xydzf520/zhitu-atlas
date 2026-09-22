import { contextBridge, ipcRenderer } from 'electron'
import { allowedInvoke, isBusinessChannel, eventChannels } from '../common/desktop-bridge'
const listeners = new Map<string, Map<Function, (event: unknown, ...args: any[]) => void>>()
const allowedEvent = (name: string) => (eventChannels as readonly string[]).includes(name)
const bridge = {
  invoke(channel: string, payload?: unknown) {
    if (!allowedInvoke(channel)) return Promise.reject(Error('该桌面接口不可用'))
    return ipcRenderer.invoke(
      isBusinessChannel(channel) && channel !== 'career-copy-text' ? 'atlas:rpc' : channel,
      isBusinessChannel(channel) && channel !== 'career-copy-text' ? { channel, payload } : payload
    )
  },
  send(channel: string, value?: unknown) {
    if (channel === 'open-external-link') ipcRenderer.send(channel, value)
  },
  on(channel: string, callback: (...args: any[]) => void) {
    if (!allowedEvent(channel)) return
    const entries = listeners.get(channel) || new Map()
    if (entries.has(callback)) return
    const wrapped = (_event: unknown, ...args: any[]) => callback(undefined, ...args)
    entries.set(callback, wrapped)
    listeners.set(channel, entries)
    ipcRenderer.on(channel, wrapped)
  },
  once(channel: string, callback: (...args: any[]) => void) {
    const once = (...args: any[]) => {
      bridge.removeListener(channel, once)
      callback(...args)
    }
    bridge.on(channel, once)
  },
  removeListener(channel: string, callback: Function) {
    const entries = listeners.get(channel),
      wrapped = entries?.get(callback)
    if (wrapped) ipcRenderer.removeListener(channel, wrapped)
    entries?.delete(callback)
    if (!entries?.size) listeners.delete(channel)
  }
}
contextBridge.exposeInMainWorld('electron', { ipcRenderer: bridge })
