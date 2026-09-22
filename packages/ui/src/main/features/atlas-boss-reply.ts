import type { WebContents } from 'electron'
import type { BrowserPage as Page } from './platform-page'
import { readCareerReplyPage, runCareerReplyCycle } from './career-auto-reply'
import { runtimePolicy } from './atlas-tasks'
import { readReplySettings } from './career-reply-store'

// The same coordinator, quotas, confirmation records and leases serve both browsers.
// Native writes are revalidated inside the page immediately before the DOM action.
export function createNativeReplyPage(wc: WebContents) {
  let userEpoch = 0,
    writeEpoch = -1,
    disposed = false
  const typed = () => {
    userEpoch++
  }
  wc.on('before-input-event', typed)
  const execute = (body: string) => {
    if (disposed || wc.isDestroyed()) throw Error('BOSS 页面已关闭')
    return wc.executeJavaScript(body)
  }
  const checkPolicy = () => {
    if (runtimePolicy().paused || readReplySettings().mode === 'off') throw Error('自动发送已暂停')
  }
  const guarded = async (expected: any, body: string) => {
    const result = await execute(
      `(()=>{try{const expected=${JSON.stringify(expected)},s=(${readCareerReplyPage.toString()})();if(!s.identityVerified||s.userId!==expected.userId||s.bossId!==expected.bossId||s.messageId!==expected.messageId||s.incoming!==expected.incoming)throw Error('会话或消息已变化');${body}}catch(e){return {atlasError:e.message||'页面操作失败'}}})()`
    )
    if (result?.atlasError) throw Error(result.atlasError)
    return result
  }
  const page = {
    isClosed: () => disposed || wc.isDestroyed(),
    url: () => (wc.isDestroyed() ? '' : wc.getURL()),
    evaluate: (fn: any, ...args: any[]) =>
      execute(typeof fn === 'string' ? fn : `(${fn.toString()})(...${JSON.stringify(args)})`),
    atlasChoose: async (target: string) => {
      checkPolicy()
      const changed = await execute(
        `(()=>{const s=(${readCareerReplyPage.toString()})();if(!s.userId||s.draft.trim()||s.typing)return false;const target=${JSON.stringify(target)};const el=[...document.querySelectorAll('.main-wrap .chat-user .user-list-content ul[role=group] li[role=listitem]')].find(el=>{const v=el.__vue__?.source;return v&&(target?v.encryptBossId===target:v.unreadCount>0&&v.lastIsSelf===false)});if(!el)return false;el.click();return true})()`
      )
      if (changed) await new Promise((r) => setTimeout(r, 650))
      return changed
    },
    atlasWriteDraft: async (expected: any) => {
      checkPolicy()
      writeEpoch = userEpoch
      await guarded(
        expected,
        `if(s.draft.trim()||s.typing)throw Error('输入框已有草稿或用户正在输入');const input=document.querySelector('.chat-conversation .message-controls .chat-input');if(!input)throw Error('输入框不可用');input.focus();return true;`
      )
      checkPolicy()
      if (writeEpoch !== userEpoch) throw Error('检测到用户输入，已停止')
      // insertText dispatches native input events, preserving the platform editor's state.
      await wc.insertText(expected.text)
      if (writeEpoch !== userEpoch) throw Error('检测到用户输入，草稿保留供本人核实')
    },
    atlasSendDraft: async (expected: any) => {
      checkPolicy()
      if (writeEpoch !== userEpoch) throw Error('检测到用户输入，未点击发送')
      await guarded(
        expected,
        `if(s.draft.trim()!==expected.text.trim())throw Error('草稿已变化');const button=document.querySelector('.chat-conversation .message-controls .chat-op .btn-send:not(.disabled)');if(!button)throw Error('发送按钮不可用');button.click();return true;`
      )
    }
  }
  return {
    page: page as unknown as Page,
    dispose: () => {
      disposed = true
      wc.removeListener('before-input-event', typed)
    }
  }
}
export function attachNativeReply(wc: WebContents) {
  const surface = createNativeReplyPage(wc),
    timer = setInterval(() => void runCareerReplyCycle(surface.page), 12000)
  timer.unref()
  return () => {
    clearInterval(timer)
    surface.dispose()
  }
}
