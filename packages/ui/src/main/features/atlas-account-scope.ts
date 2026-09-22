import { atlasRead } from './atlas-store'
export const activeAccount = () =>
  atlasRead<any>('career-boss-sync.json', null)?.account?.id || 'local'
export const opportunityScope = (item: any) => ({
  platform: item.platform || (item.job?.encryptJobId || item.userId ? 'boss' : 'manual'),
  accountId: item.accountId || item.userId || ''
})
export function inAccountScope(item: any, accountId = activeAccount()) {
  const scope = opportunityScope(item)
  if (item.accountId && item.userId && item.accountId !== item.userId) return false
  return scope.accountId
    ? scope.accountId === accountId
    : ['manual', 'import', 'file'].includes(scope.platform)
}
export function sameOpportunityScope(a: any, b: any) {
  const left = opportunityScope(a),
    right = opportunityScope(b)
  return left.platform === right.platform && left.accountId === right.accountId
}
