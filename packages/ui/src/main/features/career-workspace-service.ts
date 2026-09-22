import { validateCareerState, opportunityKey } from '../../common/career'
import { writeLocalJson } from './career-reply-store'
import {
  checkRevision,
  readCareerSnapshot,
  withCareerLock,
  workspaceFiles
} from './career-file-state'
import { normalizeEvidence, profileHistory } from './atlas-profile'
import { atlasDb, atlasRead, atlasWrite } from './atlas-store'
import { exportResumeDocx } from './atlas-export'
import { buildOpportunities } from '../../common/dashboard'
import { indexOpportunity } from './atlas-pipeline'

export function registerCareerWorkspace(
  handle: (name: string, handler: (...args: any[]) => any) => void,
  copyText: (text: string) => void
) {
  handle('career-profile-docx', exportResumeDocx)
  handle('career-profile-history', () => ({
    versions: profileHistory(),
    migration: atlasRead('atlas-profile-migration', null)
  }))
  handle('career-profile-restore', (_, input: { id: string; baseRevision: string }) =>
    withCareerLock(() => {
      checkRevision(input.baseRevision, workspaceFiles)
      const row = atlasDb().prepare('SELECT value FROM profile_versions WHERE id=?').get(input.id)
      if (!row) throw new Error('资料版本不存在')
      const snapshot = readCareerSnapshot()
      snapshot.state.profile = JSON.parse(row.value)
      atlasWrite('career-workspace.json', snapshot.state, 'restore')
      return readCareerSnapshot()
    })
  )
  handle('career-copy-text', (_, value: string) => {
    if (typeof value !== 'string' || value.length > 100000) throw new Error('文本过长')
    copyText(value)
  })
  handle('career-workspace-load', () => withCareerLock(() => readCareerSnapshot().state))
  handle('career-workspace-snapshot', () =>
    withCareerLock(() => {
      const { state, revision } = readCareerSnapshot()
      return { state, revision, profileVersion: profileHistory()[0]?.id }
    })
  )
  handle('career-workspace-save', (_, input: string | { state: string; baseRevision: string }) =>
    withCareerLock(() => {
      if (typeof input === 'string')
        throw new Error('旧页面无法保存，请重新打开工作台以保留版本校验')
      const payload = input?.state
      if (typeof payload !== 'string' || Buffer.byteLength(payload) > 10 * 1024 * 1024)
        throw new Error('资料过大，无法保存')
      const value = JSON.parse(payload)
      validateCareerState(value)
      normalizeEvidence(value.profile)
      checkRevision(input.baseRevision, workspaceFiles)
      const { preferences, state: previous } = readCareerSnapshot()
      for (const evidence of value.profile.evidence) {
        const old = previous.profile.evidence.find((e) => e.id === evidence.id)
        if (
          old?.confirmed &&
          (['title', 'text', 'source', 'keywords', 'project'] as const).some(
            (key) => JSON.stringify(old[key]) !== JSON.stringify(evidence[key])
          )
        )
          evidence.confirmed = false
      }
      for (const item of value.opportunities) {
        const key = opportunityKey(item)
        if (preferences.overrides[key])
          preferences.overrides[key] = {
            ...preferences.overrides[key],
            stage: item.stage,
            nextDate: item.nextDate,
            note: item.note,
            address: item.job.address || '',
            updatedAt: new Date().toISOString()
          }
      }
      writeLocalJson('career-workspace.json', value)
      writeLocalJson('career-dashboard.json', preferences)
      for (const item of buildOpportunities(value, [], preferences)) indexOpportunity(item)
      const { state, revision } = readCareerSnapshot()
      return { state, revision, profileVersion: profileHistory()[0]?.id }
    })
  )
}
