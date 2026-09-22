import {atlasRead,atlasWrite,atlasTransaction} from './atlas-store'
import {careerPolicy} from './atlas-policy'
export function discoveryDailyBudget() {
 const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}), key='atlas-discovery-budget/'+day
 return {key,day,...atlasRead<{candidates:string[];details:string[]}>(key,{candidates:[],details:[]})}
}
export function reserveDiscoveryRead(kind:'candidates'|'details',account:string,id:string) {
 return atlasTransaction(()=>{const b=discoveryDailyBudget(), item=account+':'+id, limit=kind==='candidates'?careerPolicy().discovery.maxJobs:careerPolicy().discovery.detailLimit
  if(b[kind].includes(item)) return true
  if(b[kind].length>=limit) return false
  atlasWrite(b.key,{candidates:b.candidates,details:b.details,[kind]:[...b[kind],item]});return true
 })
}
