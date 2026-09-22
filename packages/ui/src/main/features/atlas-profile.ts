import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { emptyCareerState, type CareerProfile } from '../../common/career'
import { atlasDb, atlasRead, atlasRoot, atlasTransaction, atlasWrite } from './atlas-store'

export function normalizeEvidence(profile: CareerProfile) {
  profile.evidence = profile.evidence.map((e, i) => ({
    ...e,
    id:
      e.id || createHash('sha256').update(`${i}|${e.title}|${e.source}`).digest('hex').slice(0, 24),
    confirmed: e.confirmed === true
  }))
  return profile
}
export function migrateProfile() {
  return atlasTransaction(() => {
    if (atlasRead('atlas-profile-migration', null)) return
    const current = atlasRead('career-workspace.json', emptyCareerState())
    const file = path.join(atlasRoot(), 'config/resumes.json')
    const legacy = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))?.[0] : null
    if (!current.profile.resumeText && legacy?.content) {
      const c = legacy.content
      current.profile.name ||= c.name || ''
      current.profile.summary ||= c.userDescription || ''
      current.profile.targetRoles = current.profile.targetRoles.length
        ? current.profile.targetRoles
        : (c.expectJob || '').split(/[,，、]/).filter(Boolean)
      current.profile.resumeText = [
        c.name,
        c.expectJob,
        c.userDescription,
        ...(c.geekWorkExpList || []).map((x: any) =>
          [
            x.company,
            x.positionName,
            x.startYearMon,
            x.endYearMon,
            x.workDescription,
            x.performance
          ]
            .filter(Boolean)
            .join('\n')
        ),
        ...(c.geekProjExpList || []).map((x: any) =>
          [x.name, x.roleName, x.projectDescription, x.performance].filter(Boolean).join('\n')
        )
      ]
        .filter(Boolean)
        .join('\n\n')
    }
    normalizeEvidence(current.profile)
    // Preserve the older structured source for review, never use it as a second authority.
    atlasWrite('atlas-profile-migration', {
      at: new Date().toISOString(),
      legacy,
      source: 'career-workspace.json',
      note: '当前工作台资料为主；旧结构化简历保留为迁移参考。经历确认状态须逐项核对。'
    })
    atlasWrite('career-workspace.json', current, 'migration')
    if (!atlasDb().prepare('SELECT id FROM profile_versions LIMIT 1').get())
      atlasDb()
        .prepare('INSERT INTO profile_versions VALUES(?,?,?,?,?)')
        .run(
          randomUUID(),
          1,
          JSON.stringify(current.profile),
          'migration',
          new Date().toISOString()
        )
  })
}
export function canonicalProfile(): CareerProfile {
  migrateProfile()
  const profile = atlasRead('career-workspace.json', emptyCareerState()).profile
  return { ...profile, ...atlasRead<any>('atlas-career-policy', null)?.direction }
}
export function profileHistory() {
  migrateProfile()
  return atlasDb()
    .prepare(
      'SELECT id,version,source,created_at AS createdAt FROM profile_versions ORDER BY version DESC LIMIT 100'
    )
    .all()
}
