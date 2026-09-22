import type { CareerJob } from './career'
import type { ProjectEvidence } from './portfolio'

export type GreetingPurpose = 'preview' | 'automatic' | 'conversation'
export interface GreetingMatch {
  requirement: string
  evidenceId: string
  evidenceQuote: string
  relevance: string
}
export interface GreetingDraft {
  decision: 'draft' | 'insufficient'
  matches: GreetingMatch[]
  text: string
  gaps: string[]
}
export interface GreetingResult extends GreetingDraft {
  projects?: ProjectEvidence[]
  id: string
  job: CareerJob
  profileVersion: string
  jobHash: string
  textHash: string
  model: string
  promptVersion: string
  createdAt: string
  purpose: GreetingPurpose
  readyForAutomation: boolean
  reviewReasons: string[]
  quality: { grounded: boolean; relevant: boolean; concise: boolean; noCommitments: boolean }
  usage: { promptTokens: number; completionTokens: number; totalTokens: number; calls: number }
  cached: boolean
}

/** Preserve a rate's original label and population; do not special-case any person or percentage. */
export function assertMetricScopes(text: string, facts: string) {
  const source = [...facts.matchAll(/([^，,。；;\n!?！？]{0,24}(?:覆盖率|使用率|留存率|转化率|复购率|增长率|合格率|故障率|准确率|满意度|完成率))(?:达到|达|为|约|是|至)?\s*(\d+(?:\.\d+)?\s*[%％])/g)]
    .map(m=>({label:m[1].replace(/^(?:目前|其中|本项目|该项目|项目的|项目中)+/g,'').replace(/\s/g,''),value:m[2].replace(/\s|％/g,v=>v==='％'?'%':'')}))
  for (const m of text.matchAll(/\d+(?:\.\d+)?\s*[%％]/g)) {
    const value=m[0].replace(/\s|％/g,v=>v==='％'?'%':''), candidates=source.filter(s=>s.value===value)
    const before=text.slice(0,m.index).split(/[，,。；;\n!?！？]/).at(-1)!.replace(/\s/g,'')
    if(candidates.length && !candidates.some(s=>before.includes(s.label)))
      throw Error('百分比的指标口径或统计范围与所引经历不一致，请保留原始说明')
  }
}
