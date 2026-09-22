import { allAutomationPaused } from './atlas-policy'
import { atlasDb, fingerprint } from './atlas-store'
import { replyDraft } from './atlas-assistant'
import { withExecutionTask, taskExecutionPaused } from './atlas-execution'
import { deepseekConfig } from './atlas-deepseek'
import type { BrowserPage as Page, ElementHandle } from './platform-page'
import { createHash } from 'node:crypto'
import { atlasList, atlasRemove } from './atlas-store'
import { runtimePolicy, acquireLease, releaseLease, claimSend, finishSend } from './atlas-tasks'
import { canonicalProfile } from './atlas-profile'
import { classifyReply, mayAutoReply, type ReplyEvent } from '../../common/auto-reply'
import { withCareerLock } from './career-file-state'
import {
  readLocalJson,
  writeLocalJson,
  readReplyEvents,
  readReplySettings,
  saveReplyEvent
} from './career-reply-store'
let busy = false
const attached = new WeakSet<Page>()
export function readCareerReplyPage() {
  const q = (s: string): any => document.querySelector(s)
  const view = q('.chat-conversation')?.__vue__
  const boss = q('.chat-conversation .chat-record')?.__vue__?.boss
  const record = q('.message-content .chat-record')?.__vue__
  const list = record?.list$ || record?.records$ || []
  const real = list.filter((m: any) => m.status !== 3)
  const last = real[real.length - 1]
  const trailing: any[] = []
  for (let i = real.length - 1; i >= 0 && !real[i].isSelf && trailing.length < 20; i--) {
    trailing.unshift(real[i])
  }
  const input = q('.chat-conversation .message-controls .chat-input')
  const user = q('.main-wrap')?.__vue__?.$store?.state?.userInfo
  const headerId = boss?.encryptBossId || '',
    selectedId = view?.selectedFriend$?.encryptBossId || ''
  return {
    identityVerified: !!headerId && headerId === selectedId,
    userId: user?.encryptUserId || '',
    bossId: boss?.encryptBossId || view?.selectedFriend$?.encryptBossId || '',
    person: boss?.name || '',
    company: view?.selectedFriend$?.brandName || '',
    messageId: String(last?.mid || ''),
    messageStatus: last?.status,
    receivedAt: last?.time ? +new Date(last.time) : 0,
    incoming:
      (trailing.length === 20 ? '[合并消息过长，请在 BOSS 查看]\n' : '') +
        trailing
          .map((m) =>
            m.type === 'text' || m.messageType === 'text'
              ? m.text || ''
              : '[非文本消息，请在 BOSS 查看]'
          )
          .join('\n') || (last && !last.isSelf ? '[非文本消息，请在 BOSS 查看]' : ''),
    isSelf: !!last?.isSelf,
    lastText: last?.text || '',
    draft: input?.value || input?.textContent || '',
    typing: document.activeElement === input
  }
}
async function snapshot(page: Page) {
  return page.evaluate(readCareerReplyPage)
}
async function chooseConversation(page: Page, targetBossId = '') {
  if ((page as any).atlasChoose) return (page as any).atlasChoose(targetBossId)
  const handle = (
    await page.evaluateHandle((target) => {
      const q = (s: string): any => document.querySelector(s)
      const input = q('.chat-conversation .message-controls .chat-input')
      if ((input?.value || input?.textContent || '').trim() || document.activeElement === input)
        return null
      const els = Array.from(
        document.querySelectorAll(
          '.main-wrap .chat-user .user-list-content ul[role=group] li[role=listitem]'
        )
      ) as any[]
      return (
        els.find((el) => {
          const v = el.__vue__?.source
          return v && (target ? v.encryptBossId === target : v.unreadCount > 0 && !v.lastIsSelf)
        }) || null
      )
    }, targetBossId)
  ).asElement()
  if (handle) {
    await (handle as ElementHandle).click()
    await new Promise((r) => setTimeout(r, 650))
    return true
  }
  return false
}
export function attachCareerAutoReply(page: Page) {
  if (attached.has(page)) return
  attached.add(page)
  const timer = setInterval(() => void runCareerReplyCycle(page), 12000)
  timer.unref()
  page.once('close', () => clearInterval(timer))
}
export async function runCareerReplyCycle(page: Page) {
  if (busy || page.isClosed() || !page.url().startsWith('https://www.zhipin.com/web/geek/chat'))
    return
  busy = true
  let event: ReplyEvent | undefined
  let leaseKey = '',
    lease: string | null = null
  try {
    const settings = readReplySettings()
    const initial = await snapshot(page)
    writeLocalJson('career-reply-heartbeat.json', {
      at: new Date().toISOString(),
      userId: initial.userId,
      state: initial.userId ? 'connected' : 'login-required',
      mode: settings.mode,
      paused: runtimePolicy().paused
    })
    if (runtimePolicy().paused || allAutomationPaused()) return
    if (settings.mode === 'off' || !initial.userId || initial.draft.trim() || initial.typing) return
    leaseKey = `browser:boss:${initial.userId}`
    lease = acquireLease(leaseKey)
    if (!lease) return
    const history = readReplyEvents()
    const commands = atlasList<any>('career-reply-commands')
    let command: any
    for (const c of commands) {
      const e = history.find((v) => v.id === c.id && v.userId === initial.userId)
      if (!e) continue
      if (c.action === 'dismiss' && ['review', 'blocked'].includes(e.status)) {
        e.status = 'dismissed'
        saveReplyEvent(e)
        atlasRemove(`career-reply-commands/${c.id}.json`)
        continue
      }
      if (c.action === 'approve' && ['review', 'blocked'].includes(e.status)) {
        command = c
        event = e
        break
      }
      atlasRemove(`career-reply-commands/${c.id}.json`)
    }
    if (command && event && initial.bossId !== event.bossId) {
      if (!(await chooseConversation(page, event.bossId))) return
    } else if (!command) {
      const initialKey = createHash('sha256')
        .update(`${initial.userId}|${initial.bossId}|${initial.messageId}|${initial.incoming}`)
        .digest('hex')
      if (initial.isSelf || !initial.incoming || history.some((e) => e.id === initialKey)) {
        if (!(await chooseConversation(page))) return
      }
    }
    const current = await snapshot(page)
    const followUp = !!command && event?.category === '主动跟进'
    if (
      command &&
      event &&
      (current.userId !== event.userId ||
        current.bossId !== event.bossId ||
        (current.isSelf && !followUp) ||
        current.messageId !== event.messageId)
    ) {
      event.status = 'blocked'
      event.reason = '会话或最新消息已变化，请重新确认'
      saveReplyEvent(event)
      atlasRemove(`career-reply-commands/${command.id}.json`)
      return
    }
    if (
      !current.userId ||
      current.userId !== initial.userId ||
      !current.bossId ||
      !current.messageId ||
      (!current.incoming && !followUp) ||
      (current.isSelf && !followUp) ||
      current.draft.trim()
    )
      return
    const profile = canonicalProfile()
    const decision = classifyReply(current.incoming, profile)
    const id =
      followUp && event
        ? event.id
        : createHash('sha256')
            .update(`${current.userId}|${current.bossId}|${current.messageId}|${current.incoming}`)
            .digest('hex')
    if (command) {
      if (!event || event.id !== id || current.bossId !== event.bossId) {
        if (event) {
          event.status = 'blocked'
          event.reason = '对方消息已变化，请重新阅读后确认'
          saveReplyEvent(event)
        }
        atlasRemove(`career-reply-commands/${command.id}.json`)
        return
      }
      event.draft = command.text
    } else {
      if (history.some((e) => e.id === id)) return
      event = {
        id,
        userId: current.userId,
        bossId: current.bossId,
        company: current.company,
        person: current.person,
        incoming: current.incoming.slice(0, 5000),
        messageId: current.messageId,
        receivedAt: current.receivedAt,
        createdAt: new Date().toISOString(),
        draft: decision.draft,
        reason: decision.reason,
        category: decision.category,
        status: 'review'
      }
      const block = mayAutoReply(event, settings, history)
      if (!decision.automatic || block) {
        event.reason = block || decision.reason
        saveReplyEvent(event)
        return
      }
    }
    if (!command) {
      event.status='queued'; event.reason='正在准备常规回复'; saveReplyEvent(event)
      let configured = false
      try { deepseekConfig(); configured = true } catch { /* keep approved deterministic reply when no official model */ }
      if (configured) {
        releaseLease(leaseKey, lease!); lease = null
        try {
          const context=atlasDb().prepare("SELECT body FROM platform_messages WHERE platform='boss' AND account_id=? AND conversation_id=? ORDER BY sent_at DESC LIMIT 20").all(current.userId,current.bossId).reverse().map((r:any)=>JSON.parse(r.body)).filter((m:any)=>m.type==='text' && m.text && ['sent','received'].includes(m.direction)).map((m:any)=>(m.direction==='sent'?'我：':'对方：')+m.text).join('\n')
          const drafted = await withExecutionTask('reply:'+id,()=>replyDraft({ accountId: current.userId, bossId:current.bossId, incoming: current.incoming, messageId: current.messageId, context, automatic: true }))
          if (drafted.review || !drafted.text) { event.status='review';event.reason = drafted.reason; saveReplyEvent(event); return }
          event.draft = drafted.text
          event.profileVersion=(drafted as any).profileVersion;event.evidenceIds=(drafted as any).evidenceIds
        } catch { event.status='review';event.reason = 'AI 回复未完成，保留规则草稿待本人确认'; saveReplyEvent(event); return }
        lease = acquireLease(leaseKey)
        if (!lease) { event.status='review';event.reason = '账号正在处理其他任务，草稿待本人确认'; saveReplyEvent(event); return }
        const refreshed = await snapshot(page)
        if (refreshed.userId !== current.userId || refreshed.bossId !== current.bossId || refreshed.messageId !== current.messageId || refreshed.incoming !== current.incoming || refreshed.draft.trim() || refreshed.typing || allAutomationPaused()) { event.status='review';event.reason = '分析期间会话或输入发生变化，请重新核实'; saveReplyEvent(event); return }
      }
    }
    // Re-check local decisions under the same lock as the UI before claiming a send.
    const sendEvent = event
    if(taskExecutionPaused('reply:'+id)){event.status='review';event.reason='本条流程已暂停，请核对草稿后处理';saveReplyEvent(event);return}
    const claimed = withCareerLock(() => {
      const latest = readLocalJson<ReplyEvent | null>(`career-replies/${sendEvent.id}.json`, null)
      if (latest?.status === 'dismissed') return 'dismissed'
      if (command) {
        const live = readLocalJson<any>(`career-reply-commands/${sendEvent.id}.json`, null)
        if (
          !live ||
          live.action !== 'approve' ||
          live.text !== command.text ||
          live.at !== command.at
        )
          return 'changed'
      }
      const blocked = claimSend({
        id: sendEvent.id,
        platform: 'boss',
        accountId: sendEvent.userId,
        recipientId: sendEvent.bossId,
        kind: followUp ? 'follow-up' : 'reply',
        automatic: !command,
        text: sendEvent.draft,
        context: {conversationId:sendEvent.bossId,incomingMessageId:sendEvent.messageId,textHash:fingerprint(sendEvent.draft),profileBasis:fingerprint(profile)}
      })
      if (blocked) {
        sendEvent.status = 'blocked'
        sendEvent.reason = blocked
        saveReplyEvent(sendEvent)
        return 'policy'
      }
      sendEvent.status = 'sending'
      saveReplyEvent(sendEvent)
      return 'claimed'
    })
    if (claimed !== 'claimed') return
    const native = page as any
    if (native.atlasWriteDraft) await native.atlasWriteDraft({ ...current, text: event.draft })
    else {
      const input = await page.$('.chat-conversation .message-controls .chat-input')
      if (!input) throw new Error('消息输入框不可用')
      await input.type(event.draft, { delay: 10 })
    }
    const verify = await snapshot(page)
    if (
      verify.userId !== event.userId ||
      verify.bossId !== event.bossId ||
      verify.messageId !== event.messageId ||
      verify.incoming !== current.incoming ||
      verify.draft.trim() !== event.draft.trim() ||
      readReplySettings().mode === 'off' ||
      runtimePolicy().paused || allAutomationPaused()
      || taskExecutionPaused('reply:'+event.id)
    )
      throw new Error('发送前会话或输入发生变化，未点击发送')
    if (native.atlasSendDraft) await native.atlasSendDraft({ ...current, text: event.draft })
    else {
      const send = await page.$(
        '.chat-conversation .message-controls .chat-op .btn-send:not(.disabled)'
      )
      if (!send) throw new Error('发送按钮不可用，内容已保留在输入框')
      await send.click()
    }
    let confirmed = false
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 600))
      const after = await snapshot(page)
      if (
        after.userId === event.userId &&
        after.bossId === event.bossId &&
        after.messageId !== event.messageId &&
        after.isSelf &&
        [1,2].includes(after.messageStatus) &&
        after.lastText === event.draft
      ) {
        atlasDb().prepare('UPDATE send_attempts SET proof=? WHERE id=?').run(JSON.stringify({method:'platform',accountId:after.userId,conversationId:after.bossId,messageId:after.messageId,textHash:fingerprint(after.lastText),at:new Date().toISOString()}),event.id)
        confirmed = true
        break
      }
    }
    event.status = confirmed ? 'sent' : 'uncertain'
    finishSend(event.id, confirmed ? 'sent' : 'uncertain')
    event.sentAt = new Date().toISOString()
    event.reason = confirmed
      ? command
        ? '本人确认后发送'
        : '常规咨询自动回复'
      : '发送结果未确认，请在 BOSS 核实，系统不重复发送'
    saveReplyEvent(event)
    if (command) atlasRemove(`career-reply-commands/${command.id}.json`)
  } catch (e) {
    if (event?.status === 'sending') {
      event.status = 'uncertain'
      finishSend(event.id, 'uncertain')
      event.error = String(e).slice(0, 300)
      event.reason = '发送中断，请核实页面；系统不自动重试'
      saveReplyEvent(event)
    }
    writeLocalJson('career-reply-heartbeat.json', {
      at: new Date().toISOString(),
      state: 'error',
      error: '消息页面结构变化或连接中断，自动发送已暂停'
    })
  } finally {
    if (lease) releaseLease(leaseKey, lease)
    busy = false
  }
}
