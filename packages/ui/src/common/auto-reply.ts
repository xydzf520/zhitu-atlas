import { recruitmentCities, normalizeCity } from './regions'
import type { CareerProfile } from './career'
import { isRecruiterDecline } from './hiring-guide'
export interface ReplySettings {
  mode: 'off' | 'review' | 'auto'
  dailyLimit: number
  cooldownMinutes: number
  startHour: number
  endHour: number
  activatedAt: string
}
export interface ReplyEvent {
  id: string
  userId: string
  bossId: string
  company: string
  person: string
  incoming: string
  messageId: string
  receivedAt: number
  createdAt: string
  draft: string
  reason: string
  category: string
  status: 'review' | 'queued' | 'sending' | 'sent' | 'dismissed' | 'uncertain' | 'blocked'
  sentAt?: string
  error?: string
  profileVersion?: string
  evidenceIds?: string[]
}
export const defaultReplySettings = (): ReplySettings => ({
  mode: 'off',
  dailyLimit: 20,
  cooldownMinutes: 10,
  startHour: 9,
  endHour: 21,
  activatedAt: ''
})
export function validateReplySettings(v: any): asserts v is ReplySettings {
  if (
    !v ||
    !['off', 'review', 'auto'].includes(v.mode) ||
    !Number.isInteger(v.dailyLimit) ||
    v.dailyLimit < 1 ||
    v.dailyLimit > 100 ||
    !Number.isInteger(v.cooldownMinutes) ||
    v.cooldownMinutes < 1 ||
    v.cooldownMinutes > 1440 ||
    !Number.isInteger(v.startHour) ||
    !Number.isInteger(v.endHour) ||
    v.startHour < 0 ||
    v.endHour > 24 ||
    v.startHour >= v.endHour ||
    typeof v.activatedAt !== 'string'
  )
    throw new Error('请检查回复时段（开始早于结束）、每日上限 1–100，以及间隔 1–1440 分钟；数值须为整数。')
}
export function classifyReply(text: string, profile: CareerProfile) {
  const manual = (reason: string, category = '待判断') => ({
    automatic: false,
    reason,
    category,
    draft: ''
  })
  if (!text || text.length > 1500) return manual('消息内容需要人工阅读')
  if (isRecruiterDecline(text)) return manual('对方已婉拒或岗位停止招聘，不自动继续介绍；由本人决定是否结束跟进', '结束与复盘')
  if (/\[非文本消息|\[合并消息过长/.test(text)) return manual('包含非文本消息或过多连续消息，请查看完整会话')
  if (/薪|工资|预算|待遇|报价|\d+\s*[kKwW万]|salary|compensation/i.test(text))
    return manual('薪资与待遇由本人确认', '薪资沟通')
  if (
    /面试|约个|约下|几点|明天|后天|周[一二三四五六日末]|入职|到岗|offer|interview|available|schedule|(?:安排|沟通|聊聊).{0,8}时间|时间.{0,8}(?:安排|沟通|聊聊)/i.test(
      text
    )
  )
    return manual('面试、时间与承诺由本人确认', '面试安排')
  if (
    /简历|附件|文件|邮箱|邮件|手机|电话|微信|身份证|住址|学历|毕业|年龄|性别|婚|目前薪|离职|离岗|resume|cv\b|phone|email|wechat/i.test(
      text
    )
  )
    return manual('资料发送及个人信息由本人确认', '资料与信息')
  if (
    /https?:|系统指令|忽略|执行.{0,8}(?:命令|代码|脚本|指令)|验证码|转账|缴费|下载|密码|密钥|ignore|instruction|token/i.test(
      text
    )
  )
    return manual('包含链接、指令或敏感请求', '其他事项')
  if (/(?:项目|平台|产品).{0,20}(?:多久|多长时间|多少(?:天|个月|年))/.test(text))
    return manual('需要先核对具体项目及已确认的起止时间', '项目咨询')
  if (/(?:介绍|说说).{0,10}(?:自己|你自己|您自己)|自我介绍/.test(text)) {
    const evidence = profile.evidence.find(e => e.confirmed === true && e.text.trim())
    if (!evidence) return manual('尚无已确认经历，请本人补充', '项目咨询')
    return { automatic: true, reason: '根据已确认经历作简短介绍', category: '项目咨询', draft: `您好，${evidence.text}` }
  }
  const topicMentioned = profile.evidence.some(e=>e.confirmed && e.keywords.some(k=>k.trim().length>1 && text.toLowerCase().includes(k.toLowerCase())))
  if (/技术|技能|项目|经历|做过|介绍|经验|平台/i.test(text) || topicMentioned) {
    const evidence =
      profile.evidence.find((e) =>
        e.confirmed === true && e.keywords.some((k) => k && k.trim().length > 1 && (/^[a-z]{1,4}$/i.test(k) ? new RegExp(`\\b${k}\\b`, 'i').test(text) : text.toLowerCase().includes(k.toLowerCase())))
      )
    if (!evidence?.text) return manual('该咨询未匹配到已确认的经历，请本人补充', '项目咨询')
    return {
      automatic: true,
      reason: '使用已确认的个人经历',
      category: '项目咨询',
      draft: `您好，${evidence.text}`
    }
  }
  if (/城市|工作地点|办公地点|(?:考虑|接受).{0,16}(?:机会|岗位|工作|吗)/.test(text)) {
    if (!profile.preferredCities.length) return manual('求职城市尚未设置', '工作城市')
    const mentioned = recruitmentCities.filter(c=>text.includes(c.name))
    if (mentioned.some(c=>!profile.preferredCities.map(normalizeCity).includes(normalizeCity(c.name)))) return manual('提到的城市不在本人偏好中，请确认是否考虑', '工作城市')
    if (/考虑|接受/.test(text) && !mentioned.length && !/(?:哪个|哪些|什么).{0,6}(?:城市|地点)/.test(text)) return manual('地点或工作方式需本人核实', '工作城市')
    return {
      automatic: true,
      reason: '使用已设置的求职城市',
      category: '工作城市',
      draft: `您好，我主要考虑${profile.preferredCities.join('、')}岗位。`
    }
  }
  if (
    /^(?:(?:你好|您好|hi|hello|在吗|您好呀|你好呀|在看机会吗|还在看机会吗|方便沟通吗|方便聊聊吗|有兴趣了解吗|对我们岗位感兴趣吗)[，,！!。.？?\s～~]*){1,3}$/i.test(
      text.trim()
    )
  )
    return {
      automatic: true,
      reason: '常规招呼，不包含承诺',
      category: '常规咨询',
      draft: '您好，我在关注合适的岗位，可以沟通。'
    }
  return manual('没有命中已确认的常规回复规则')
}
export function mayAutoReply(
  event: ReplyEvent,
  settings: ReplySettings,
  history: ReplyEvent[],
  now = Date.now()
) {
  if (settings.mode !== 'auto') return '自动发送未开启'
  const hour = Number(
    new Date(now).toLocaleString('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      hour12: false
    })
  )
  if (hour < settings.startHour || hour >= settings.endHour) return '当前不在回复时段'
  if (
    !event.receivedAt ||
    now - event.receivedAt > 10 * 60 * 1000 ||
    event.receivedAt > now + 60000 ||
    event.receivedAt < Date.parse(settings.activatedAt || '2100-01-01')
  )
    return '历史消息或时间无法核实，等待人工确认'
  const today = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  const sent = history.filter(
    (e) => e.userId === event.userId && ['sent', 'sending', 'uncertain'].includes(e.status)
  )
  if (
    sent.filter(
      (e) =>
        new Date(e.sentAt || e.createdAt).toLocaleDateString('sv-SE', {
          timeZone: 'Asia/Shanghai'
        }) === today
    ).length >= settings.dailyLimit
  )
    return '达到每日回复上限'
  if (
    sent.some(
      (e) =>
        e.bossId === event.bossId &&
        now - Date.parse(e.sentAt || e.createdAt) < settings.cooldownMinutes * 60000
    )
  )
    return '同一会话冷却中'
  if (
    sent.filter(
      (e) => e.bossId === event.bossId && now - Date.parse(e.sentAt || e.createdAt) < 86400000
    ).length >= 3
  )
    return '本会话已自动沟通三次，请本人接续'
  return ''
}
