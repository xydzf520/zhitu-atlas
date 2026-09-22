import fs from 'node:fs'
import path from 'node:path'
import { atlasRoot, atlasOwned, atlasRead, atlasWrite, atlasList, atlasTransaction } from './atlas-store'
import { recordTask } from './atlas-task-records'
import {
  defaultReplySettings,
  validateReplySettings,
  type ReplyEvent,
  type ReplySettings
} from '../../common/auto-reply'
export const careerDirectory = () => path.join(atlasRoot(), 'config')
export function readLocalJson<T>(file: string, fallback: T): T {
  if (atlasOwned(file)) return atlasRead(file, fallback)
  const p = path.join(careerDirectory(), file)
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback
}
export function writeLocalJson(file: string, value: unknown) {
  if (atlasOwned(file)) { atlasWrite(file, value); return }
  const p = path.join(careerDirectory(), file)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, p)
  fs.chmodSync(p, 0o600)
}
export function readReplySettings(): ReplySettings {
  const policy = atlasRead<any>('atlas-career-policy', null)
  const v = policy ? { ...policy.sending, ...policy.replies } : readLocalJson('career-auto-reply.json', defaultReplySettings())
  validateReplySettings(v)
  return v
}
export function readReplyEvents(): ReplyEvent[] {
  return atlasList<ReplyEvent>('career-replies').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
export function saveReplyEvent(e: ReplyEvent) {
  if (!/^[a-f0-9]{64}$/.test(e.id)) throw new Error('回复标识无效')
  return atlasTransaction(()=>{
  const previous=atlasRead<ReplyEvent|null>(`career-replies/${e.id}.json`,null)
  if(previous?.status==='dismissed' && e.status!=='dismissed')return
  writeLocalJson(`career-replies/${e.id}.json`, e)
  recordTask({id:'reply:'+e.id,kind:'conversation-reply',accountId:e.userId,state:e.status,step:e.reason,createdAt:e.createdAt,input:{bossId:e.bossId,company:e.company,person:e.person,automatic:true},result:{replyId:e.id}})
  })
}
export function claimReply(id: string) {
  const p = path.join(careerDirectory(), 'career-reply-claims', id)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  try {
    const fd = fs.openSync(p, 'wx', 0o600)
    fs.writeSync(fd, new Date().toISOString())
    fs.closeSync(fd)
    return true
  } catch (e: any) {
    if (e.code === 'EEXIST') return false
    throw e
  }
}
