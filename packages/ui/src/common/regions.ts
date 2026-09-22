import cities from './data/boss-cities.json'
export const recruitmentCities = cities
export const normalizeCity = (value: string) => value.trim().replace(/市$/, '')
export const cityRecord = (value: string) =>
  cities.find((c) => normalizeCity(c.name) === normalizeCity(value))
export function bossCityCode(city: string) {
  const record = cityRecord(city)
  if (!record) throw Error(`尚未识别城市“${city || '未设置'}”，请在求职方向选择具体城市`)
  return record.code
}
export const validCoordinates = (lng: unknown, lat: unknown): boolean =>
  Number.isFinite(lng) &&
  Number.isFinite(lat) &&
  Number(lng) >= -180 &&
  Number(lng) <= 180 &&
  Number(lat) >= -85 &&
  Number(lat) <= 85
const districts = new Map<string, string[]>()
for (const c of cities)
  for (const d of c.districts) districts.set(d, [...(districts.get(d) || []), c.name])
const districtPattern = new RegExp(
  [...districts.keys()]
    .filter((d) => d.length >= 3)
    .sort((a, b) => b.length - a.length)
    .join('|'),
  'g'
)
// Names and platform search IDs only. Unknown coordinate systems are never geocoded.
function resolveJobLocation(job: { cityName?: string; address?: string }) {
  const address = String(job.address || ''),
    explicit = cityRecord(String(job.cityName || ''))
  const matches = cities.filter(
    (c) =>
      c.name.length >= 2 &&
      (address === c.name ||
        address.includes(c.name + '市') ||
        (/[州盟]$/.test(c.name) && address.startsWith(c.name)) ||
        c.districts.some((d) => address.startsWith(c.name + d)) ||
        address.includes(c.province + c.name))
  )
  const names = [...new Set(matches.map((c) => c.name))]
  if (names.length > 1 || (explicit && names.length && !names.includes(explicit.name)))
    return { city: '', district: '', reason: '地点信息冲突' }
  let city = explicit?.name || names[0] || ''
  // A district can contradict the platform city even when no city appears in the address.
  // Shared district names are not unique city evidence; district-named roads are not districts.
  const candidates: [string, string[]][] = [...address.matchAll(districtPattern)]
    .filter((m) => !/^(?:路|街|大道|大街)/.test(address.slice(m.index! + m[0].length)))
    .map((m) => [m[0], districts.get(m[0])!])
  const uniqueCities = [
    ...new Set(
      candidates.filter(([, owners]) => owners.length === 1).flatMap(([, owners]) => owners)
    )
  ]
  if (uniqueCities.length > 1 || (city && uniqueCities.some((name) => name !== city)))
    return { city: '', district: '', reason: '城市与行政区信息冲突' }
  if (!city) {
    const possible = [...new Set(candidates.flatMap(([, owners]) => owners))]
    if (possible.length === 1) city = possible[0]
  }
  const district = city ? cityRecord(city)?.districts.find((d) => address.includes(d)) || '' : ''
  return { city, district, reason: city ? (district ? '行政区定位' : '城市定位') : '地点待核实' }
}
const locationCache = new Map<string, ReturnType<typeof resolveJobLocation>>()
export function jobLocation(job: { cityName?: string; address?: string }) {
  const key = JSON.stringify([job.cityName || '', job.address || ''])
  const cached = locationCache.get(key)
  if (cached) return { ...cached }
  const result = resolveJobLocation(job)
  if (key.length <= 2048) {
    if (locationCache.size >= 1024) locationCache.delete(locationCache.keys().next().value!)
    locationCache.set(key, result)
  }
  return { ...result }
}
export function locationGroups(items: { job: any }[], city = '') {
  const groups = new Map<string, number>()
  for (const item of items) {
    const place = jobLocation(item.job)
    if (city && place.city !== city) continue
    const label = city ? place.district || '行政区待补充' : place.city || '地点待核实'
    groups.set(label, (groups.get(label) || 0) + 1)
  }
  return [...groups]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
}
