import { atlasDb, atlasTransaction } from './atlas-store'
import { executionTaskChanged } from './atlas-execution'
// Checkpoints for browser/read/send operations join the AI queue in one history.
// These kinds are observed by the queue; only their owning adapter can execute them.
export function recordTask(input: { id:string; kind:string; accountId:string; state:string; step:string; result?:any; input?:any; error?:string; createdAt?:string }) {
 return atlasTransaction(() => {
 const now=new Date().toISOString(),states:Record<string,string>={analyzing:'running',syncing:'running',details:'running',idle:'completed',waiting:'waiting',sending:'running',sent:'completed'}
 atlasDb().prepare(`INSERT INTO task_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,step=excluded.step,result=excluded.result,error=excluded.error,updated_at=excluded.updated_at,heartbeat_at=excluded.heartbeat_at`).run(input.id,input.kind,input.accountId || 'local',input.id,states[input.state]||input.state,input.step,JSON.stringify(input.input||{}),JSON.stringify(input.result||{}),input.error||'',input.createdAt||now,now,now)
 executionTaskChanged(input)
 })
}
