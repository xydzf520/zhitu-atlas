import { createApp, h } from 'vue'
import { RouterView } from 'vue-router'
import { createAtlasRouter } from '../src/renderer/src/router/createAtlasRouter'
import { createPinia } from 'pinia'
import ElementPlus, { ElMessage } from 'element-plus'
import 'element-plus/dist/index.css'
import '../src/renderer/src/style/base.scss'
import 'virtual:uno.css'
import '../src/renderer/src/style/atlas-theme.scss'
document.documentElement.classList.remove('dark')
document.documentElement.dataset.theme = 'daylight'
import Layout from './Layout.vue'
import { createAtlasRpcClient } from './rpc-client'
const sessionMeta = () => document.querySelector<HTMLMetaElement>('meta[name=atlas-session]')
const invokeLocal = createAtlasRpcClient({
  token: () => sessionMeta()?.content || '',
  fetch: window.fetch.bind(window),
  renew: async () => {
    const response = await fetch('/desktop.html', {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000)
    })
    if (!response.ok) throw Error('本机服务尚未恢复，已有输入已保留，请稍后重试。')
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html')
    const token = doc.querySelector<HTMLMetaElement>('meta[name=atlas-session]')?.content
    const meta = sessionMeta()
    if (!token || !meta) throw Error('无法恢复本机会话，请保存草稿后重新打开工作台。')
    meta.content = token
  }
})
const desktopMessage =
  '请在职途 Atlas 桌面程序里使用此功能；登录 BOSS 消息页后，数据会自动出现在这里。'
;(window as any).electron = {
  ipcRenderer: {
    invoke: async (channel: string, payload: unknown) => {
      if (channel === 'career-copy-text') return navigator.clipboard.writeText(String(payload))
      if (!channel.startsWith('career-')) {
        ElMessage.info(desktopMessage)
        throw Error(desktopMessage)
      }
      return invokeLocal(channel, payload)
    },
    send: (channel: string, url: string) => {
      if (channel === 'open-external-link' && /^https:\/\/www\.zhipin\.com\//.test(url))
        window.open(url, '_blank', 'noopener')
    },
    on: () => {},
    once: () => {},
    removeListener: () => {}
  }
}
const router = createAtlasRouter(Layout)
createApp({ render: () => h(RouterView) })
  .use(router)
  .use(createPinia())
  .use(ElementPlus)
  .mount('#app')
