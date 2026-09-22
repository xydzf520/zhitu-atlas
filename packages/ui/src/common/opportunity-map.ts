import placesData from './data/map-places.json'
import { cityRecord, jobLocation, normalizeCity, validCoordinates } from './regions'
import type { DashboardOpportunity } from './dashboard'
export interface MapPlace {
  lat: number
  lng: number
  sourceId: string
  level: string
  province: string
  districts: Record<string, { lat: number; lng: number; sourceId: string }>
}
export const mapPlaces = placesData as Record<string, MapPlace>
export const nationalBounds: [[number, number], [number, number]] = [
  [2, 72],
  [55, 136]
]
export const defaultMapCity = (cities: string[] = []) =>
  cities.map(normalizeCity).find((c) => !!cityRecord(c)) || ''
export const preciseMapLocation = (o: DashboardOpportunity) =>
  validCoordinates(o.lng, o.lat) && o.crs === 'wgs84'
export function regionalMapGroups(items: DashboardOpportunity[], city = '') {
  const groups = new Map<
    string,
    {
      key: string
      city: string
      district: string
      label: string
      lat: number
      lng: number
      level: string
      items: DashboardOpportunity[]
    }
  >()
  for (const item of items) {
    if (city && preciseMapLocation(item)) continue
    const location = jobLocation(item.job),
      place = mapPlaces[location.city]
    if (!place || (city && location.city !== city)) continue
    // Regional centres are display anchors, never company coordinates or commute origins.
    const district = city && place.districts[location.district] ? location.district : ''
    const point = district ? place.districts[district] : place
    const level = district ? 'district' : place.level
    const label =
      district || (level === 'province' ? place.province + '（城市定位待补）' : location.city)
    const key = `${location.city}:${district || level}`
    const group = groups.get(key) || {
      key,
      city: location.city,
      district,
      label,
      lat: point.lat,
      lng: point.lng,
      level,
      items: []
    }
    group.items.push(item)
    groups.set(key, group)
  }
  return [...groups.values()]
}
