import type { BrowserPage as Page } from './platform-page'
import { saveBossSnapshot } from './career-boss-data'
import { writeLocalJson } from './career-reply-store'
import { bossCapturePath, ingestBossJobs, ingestBossPublicJobs } from './atlas-boss-sync'
export function readBossPageSnapshot() {
  const main = document.querySelector('.main-wrap') as any
  const documents = [document]
  for (const frame of Array.from(document.querySelectorAll('iframe')).slice(0, 10)) {
    try {
      const child = (frame as HTMLIFrameElement).contentDocument
      if (child && child.location.origin === location.origin) documents.push(child)
    } catch { /* A cross-origin frame is not an authorized account context. */ }
  }
  const detail = documents.map(doc => (doc.querySelector('.job-detail-box') as any)?.__vue__).find(Boolean)
  const user = main?.__vue__?.$store?.state?.userInfo || (document.querySelector('.page-jobs-main') as any)?.__vue__?.$store?.state?.userInfo || detail?.$store?.state?.userInfo
  // The existing platform adapter also reads this rendered job-detail component.
  // Copy only fields used by the normalizer, not the complete reactive platform object.
  const pick = (value: any, keys: string[]) => Object.fromEntries(keys
    .filter(key => ['string', 'number', 'boolean'].includes(typeof value?.[key]))
    .map(key => [key, value[key]]))
  const data = detail?.data
  const detailAccount = detail?.$store?.state?.userInfo?.encryptUserId
  const jobDetail = data?.jobInfo?.encryptId && (!detailAccount || detailAccount === user?.encryptUserId) ? {
    jobInfo: pick(data.jobInfo, ['encryptId', 'jobName', 'postDescription', 'address', 'cityName', 'degreeName', 'experienceName', 'salaryDesc']),
    bossInfo: pick(data.bossInfo, ['encryptBossId', 'name', 'title', 'activeTimeDesc']),
    brandComInfo: pick(data.brandComInfo, ['encryptBrandId', 'customerBrandName', 'brandName', 'industryName', 'scaleName', 'stageName'])
  } : null
  // Standalone job pages are server-rendered, so there is no Vue store or
  // job/detail.json response. The job identity must come from the page URL.
  const publicJobs = documents.flatMap(doc => {
    const match = doc.location?.pathname?.match(/^\/job_detail\/([^/]+)\.html$/)
    if (!match || doc.location?.hostname !== 'www.zhipin.com') return []
    const id = decodeURIComponent(match[1])
    const declaredId = (doc.defaultView as any)?._jobInfo?.job_id
    if (declaredId && declaredId !== id) return []
    const locations = Array.from(doc.querySelectorAll('.job-location .job-location-map[data-content], .job-address-box .js-open-map[data-content]'))
      .map(el => el.getAttribute('data-content')?.trim() || '').filter(Boolean)
    const addresses = [...new Set(locations)].slice(0, 20)
    const text = (selector: string, max: number) => {
      const el = doc.querySelector(selector) as HTMLElement | null
      return (el?.innerText || el?.textContent || '').trim().slice(0, max)
    }
    // An absent address must not discard an otherwise readable JD. Conversely,
    // an interstitial at the same URL must not count as a captured job.
    const jobName = text('.job-primary h1, .job-banner h1', 300)
    const description = text('.job-sec-text', 40000)
    if (!addresses.length && !jobName && !description) return []
    return [{
      jobInfo: { encryptId: id, jobName,
        postDescription: description, salaryDesc: text('.job-primary .salary, .detail-box .salary', 150),
        // Several sites must be chosen by the user; never silently pick the first.
        address: addresses.length === 1 ? addresses[0] : '', workAddresses: addresses },
      sourceKind: 'rendered-public-job', pageUrl: `https://www.zhipin.com/job_detail/${encodeURIComponent(id)}.html`
    }]
  })
  const visibleItems = Array.from(
    document.querySelectorAll(
      '.main-wrap .chat-user .user-list-content ul[role=group] li[role=listitem]'
    )
  ).map((el: any) => el.__vue__?.source || {})
  // BOSS virtualizes its sidebar: DOM rows are only the visible slice.
  const loadedItems = (document.querySelector('.main-wrap .chat-user') as any)?.__vue__?.list
  const sources = Array.isArray(loadedItems) ? loadedItems.slice(0, 5000) : visibleItems
  const items = sources.map((v: any) => {
    return {
      bossId: v.encryptBossId || '',
      bossName: v.name || '',
      companyName: v.brandName || '',
      jobName: v.jobName || '',
      encryptJobId: v.encryptJobId || '',
      address: v.address || '',
      lastText: v.lastText,
      lastIsSelf: v.lastIsSelf,
      lastMsgStatus: v.lastMsgStatus,
      unreadCount: v.unreadCount,
      updateTime: v.updateTime
    }
  })
  const selected = (document.querySelector('.chat-conversation') as any)?.__vue__?.selectedFriend$
  const record = (document.querySelector('.message-content .chat-record') as any)?.__vue__
  const header = (document.querySelector('.chat-conversation .chat-record') as any)?.__vue__?.boss
  const bossId = header?.encryptBossId || ''
  const verified = !!bossId && selected?.encryptBossId === bossId
  const raw = record?.list$
  const messages =
    verified && Array.isArray(raw)
      ? raw
          .slice(-2000)
          .map((m) => ({
            mid: m.mid,
            isSelf: m.isSelf,
            type: m.type,
            messageType: m.messageType,
            templateId: m.templateId,
            dialogType: m.dialog?.type,
            time: m.time,
            text: m.text,
            status: m.status
          }))
      : []
  const input = document.querySelector(
    '.chat-conversation .message-controls .chat-input'
  ) as HTMLElement | null
  return {
    account: { id: user?.encryptUserId || '', name: user?.name || '' },
    jobDetail,
    publicJobs,
    items,
    listAvailable: !!document.querySelector('.chat-user .user-list-content'),
    listSource: Array.isArray(loadedItems) ? 'loaded-store' : 'visible-rows',
    listFinished: /没有/.test(document.querySelector('.main-wrap .chat-user .user-list-content div[role=tfoot] .finished')?.textContent || ''),
    draftActive: !!input?.textContent?.trim(),
    conversation: verified
      ? {
          bossId,
          identityVerified: true,
          bossName: header?.name || '',
          companyName: selected?.brandName || '',
          encryptJobId: selected?.encryptJobId || '',
          messages
        }
      : null,
    diagnostics: {
      conversationVisible: !!document.querySelector('.chat-conversation'),
      identityVerified: verified,
      messageListAvailable: Array.isArray(raw),
      jobDetailVisible: !!jobDetail,
      publicJobPages: publicJobs.length
    }
  }
}
const attached = new WeakSet<Page>()
export async function syncCareerPage(page: Page) {
  if (page.isClosed() || !page.url().startsWith('https://www.zhipin.com/')) return
  try {
    const snapshot = await page.evaluate(readBossPageSnapshot)
    ingestBossPublicJobs(snapshot.publicJobs)
    if (!snapshot.account.id) {
      if (!page.url().startsWith('https://www.zhipin.com/web/geek/chat')) return
      writeLocalJson('career-data-heartbeat.json', {
        at: new Date().toISOString(),
        state: 'login-required'
      })
      return
    }
    const saved = saveBossSnapshot(snapshot)
    if (snapshot.jobDetail) ingestBossJobs(snapshot.account.id, { code: 0, zpData: snapshot.jobDetail }, '/wapi/zpgeek/job/detail.json')
    writeLocalJson('career-data-heartbeat.json', {
      at: new Date().toISOString(),
      state: 'connected',
      userId: snapshot.account.id,
      loadedCount: snapshot.items.length,
      totalCount: new Set((saved?.items || []).map(item=>item.bossId)).size,
      diagnostics: snapshot.diagnostics,
      draftActive: snapshot.draftActive
    })
  } catch {
    writeLocalJson('career-data-heartbeat.json', {
      at: new Date().toISOString(),
      state: 'error',
      error: '无法读取已加载会话，请检查登录状态或页面结构'
    })
  }
}
export function attachCareerDataSync(page: Page) {
  if (attached.has(page)) return
  attached.add(page)
  let busy = false
  const run = async () => {
    if (busy) return
    busy = true
    try {
      await syncCareerPage(page)
    } finally {
      busy = false
    }
  }
  const timer = setInterval(() => void run(), 10000)
  timer.unref()
  page.on('domcontentloaded', run)
  const response = async (res: any) => {
    const pathname = bossCapturePath(res.url())
    if (!pathname || res.status() !== 200 || page.isClosed()) return
    try {
      if (pathname === '/wapi/zpchat/geek/historyMsg') {
        await run()
        return
      }
      const before = await page.evaluate(readBossPageSnapshot)
      if (!before.account.id) return
      const payload = await res.json()
      if (JSON.stringify(payload).length > 2 * 1024 * 1024) return
      const after = await page.evaluate(readBossPageSnapshot)
      if (before.account.id !== after.account.id) return
      saveBossSnapshot(after)
      ingestBossJobs(after.account.id, payload, pathname)
    } catch {
      /* Keep previous data; the visible coverage continues to show missing details. */
    }
  }
  page.on('response', response)
  page.once('close', () => {
    clearInterval(timer)
    page.off('domcontentloaded', run)
    page.off('response', response)
  })
  void run()
}
