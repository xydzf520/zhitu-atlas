// Only observed platform fields are normalized here. Missing values stay unknown.
import { isRecruiterDecline } from './hiring-guide'
export const bossText = (v: unknown, limit = 1000) =>
  typeof v === 'string' ? v.trim().slice(0, limit) : ''
export function bossId(v: unknown) {
  return typeof v === 'string'
    ? v.trim().slice(0, 250)
    : typeof v === 'number' && Number.isSafeInteger(v)
      ? String(v)
      : ''
}
export function bossTime(v: unknown): string {
  const value =
    typeof v === 'number'
      ? v < 1e11
        ? v * 1000
        : v
      : typeof v === 'string' && /^\d{4}-\d\d-\d\d[T ]/.test(v)
        ? Date.parse(v)
        : NaN
  return Number.isFinite(value) &&
    Number(value) >= 946684800000 &&
    Number(value) <= Date.now() + 86400000
    ? new Date(value).toISOString()
    : ''
}
export function bossSalary(value: unknown) {
  const salaryDesc = bossText(value, 150),
    range = salaryDesc.match(/^(\d+(?:\.\d+)?)\s*[-–~至]\s*(\d+(?:\.\d+)?)\s*[kK](?:\b|·|$)/),
    months = salaryDesc.match(/(?:·|•|\s)(\d{1,2})薪/)
  if (!range || Number(range[1]) > Number(range[2]) || /日|时|年/.test(salaryDesc))
    return { salaryDesc }
  return {
    salaryDesc,
    salaryLow: Number(range[1]),
    salaryHigh: Number(range[2]),
    ...(months && Number(months[1]) >= 1 && Number(months[1]) <= 36
      ? { salaryMonth: Number(months[1]) }
      : {})
  }
}
export function normalizeBossJob(data: any, detail = true) {
  const j = detail ? data?.jobInfo : data,
    b = data?.bossInfo || {},
    c = data?.brandComInfo || {}
  const id = bossId(j?.encryptId || j?.encryptJobId)
  if (!id) return null
  return {
    encryptJobId: id,
    jobName: bossText(j.jobName, 300),
    description: bossText(j.postDescription, 40000),
    encryptBossId: bossId(b.encryptBossId || j.encryptUserId || j.encryptBossId),
    encryptCompanyId: bossId(c.encryptBrandId || j.encryptBrandId),
    companyName: bossText(c.customerBrandName || c.brandName || j.brandName, 500),
    address: bossText(j.address, 1500),
    ...(Array.isArray(j.workAddresses) ? { workAddresses: [...new Set(j.workAddresses.map((v: unknown) => bossText(v, 1500)).filter(Boolean))].slice(0, 20) } : {}),
    cityName: bossText(j.cityName, 100),
    degreeName: bossText(j.degreeName, 100),
    experienceName: bossText(j.experienceName || j.jobExperience, 100),
    industryName: bossText(c.industryName || j.brandIndustry, 300),
    scaleName: bossText(c.scaleName || j.brandScaleName, 200),
    stageName: bossText(c.stageName || j.brandStageName, 200),
    bossName: bossText(b.name || j.bossName, 200),
    bossTitle: bossText(b.title || j.bossTitle, 300),
    activeStatus: bossText(b.activeTimeDesc || j.bossActiveTime, 200),
    ...bossSalary(j.salaryDesc),
    sourceUrl: `https://www.zhipin.com/job_detail/${encodeURIComponent(id)}.html`
  }
}
export function normalizeBossContact(row: any) {
  const id = bossId(row?.bossId)
  if (!id) return null
  return {
    bossId: id,
    bossName: bossText(row.bossName, 200),
    companyName: bossText(row.companyName, 500),
    jobName: bossText(row.jobName, 300),
    encryptJobId: bossId(row.encryptJobId),
    address: bossText(row.address, 1500),
    lastText: bossText(row.lastText, 3000),
    ...(typeof row.lastIsSelf === 'boolean' ? { lastIsSelf: row.lastIsSelf } : {}),
    ...(Number.isSafeInteger(row.unreadCount) && row.unreadCount >= 0
      ? { unreadCount: Math.min(row.unreadCount, 100000) }
      : {}),
    ...(row.lastMsgStatus === 2
      ? { lastRead: true }
      : row.lastMsgStatus === 1
        ? { lastRead: false }
        : {}),
    lastMessageAt: bossTime(row.updateTime || row.lastMessageAt)
  }
}
export function bossMessageType(platformType: string) {
  if (['dialog', 'articles'].includes(platformType)) return 'card'
  if (platformType === 'action') return 'action'
  if (platformType === 'hyperLink') return 'link'
  return ['text', 'image', 'resume', 'sticker', 'sound', 'comDesc'].includes(platformType) ? platformType : 'other'
}
export function normalizeBossMessage(raw: any) {
  const id = bossId(raw?.mid)
  if (!id || typeof raw.isSelf !== 'boolean') return null
  // Do not download attachment URLs or store signed URLs/unknown payloads.
  const platformType = bossText(raw.messageType || raw.type, 50)
  const type =
    raw.status === 3
      ? 'system'
      : bossMessageType(platformType)
  return {
    id,
    direction: raw.isSelf ? 'sent' : 'received',
    type,
    platformType,
    ...(Number.isSafeInteger(raw.dialogType) ? { cardType: raw.dialogType } : {}),
    text: bossText(raw.text, 16000),
    sentAt: bossTime(raw.time),
    ...(raw.status === 2 ? { read: true } : {})
  }
}
export function conversationPriority(c: any) {
  if (c.lastIsSelf === false && isRecruiterDecline(c.lastText || ''))
    return { bucket: 'unknown', rank: 4, label: '对方婉拒', reason: '已识别婉拒摘要；是否结束跟进由你决定，不自动重复联系' }
  // These platform receipts describe a completed action, not a recruiter's request.
  // Their lastIsSelf flag does not reliably indicate a human sender.
  if (/^(?:您的附件简历[\s\S]*已发送给(?:Boss|对方)|对方已同意[，,]?您的附件简历已发送给对方)/i.test(c.lastText || ''))
    return {
      bucket: c.unreadCount > 0 ? 'unread' : 'unknown',
      rank: c.unreadCount > 0 ? 2 : 4,
      label: c.unreadCount > 0 ? '有未读消息' : '平台提示',
      reason: '最近摘要是简历发送回执，请打开正文核实是否还有招聘方问题'
    }
  if (
    c.lastIsSelf === false &&
    /面试|约.*时间|薪资|期望.*薪|简历|附件|offer|录用|入职|到岗/i.test(c.lastText || '')
  )
    return {
      bucket: 'important',
      rank: 0,
      label: '重要事项待确认',
      reason: '对方消息涉及面试、薪资、简历或入职，请本人核对'
    }
  if (c.lastIsSelf === false && c.lastText)
    return {
      bucket: 'reply',
      rank: 1,
      label: '待我回复',
      reason: '最近一条消息来自招聘方；请结合正文判断是否需要回复'
    }
  if (c.unreadCount > 0)
    return {
      bucket: 'unread',
      rank: 2,
      label: '有未读消息',
      reason: '会话列表显示未读；消息正文可能尚未加载'
    }
  if (c.lastIsSelf === true)
    return {
      bucket: 'waiting',
      rank: 3,
      label: '等待对方',
      reason:
        c.lastRead === true
          ? '最后一条己方消息显示已读；不自动重复跟进'
          : '最后一条消息由你发送；对方阅读情况以平台为准'
    }
  return { bucket: 'unknown', rank: 4, label: '状态待核实', reason: '尚未读取足够消息信息' }
}
