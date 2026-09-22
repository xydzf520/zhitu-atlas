<template>
  <div class="map-shell">
    <div class="map-toolbar">
      <label class="city-picker"
        >地区
        <select
          :value="currentCity"
          aria-label="地图城市"
          @change="chooseCity(($event.target as HTMLSelectElement).value)"
        >
          <option value="">全国</option>
          <option v-if="currentCity === '地点待核实'" value="地点待核实">地点待核实</option>
          <optgroup
            v-for="group in cityGroups"
            :key="group.province"
            :label="group.province === '台湾' ? '台湾省' : group.province"
          >
            <option v-for="c in group.cities" :key="c" :value="c">
              {{ c === '台湾' ? '台湾省' : c }}
            </option>
          </optgroup>
        </select>
      </label>
      <button :class="{ active: !currentCity }" @click="chooseCity('')">全国</button>
      <button :disabled="!defaultCity" @click="chooseCity(defaultCity || '')">
        当前城市{{ defaultCity ? ' · ' + defaultCity : '' }}
      </button>
      <button @click="fitLocations">重置视野</button>
      <button :disabled="!mapConfig?.configured" @click="toggleTiles">重新加载地图</button>
      <RouterLink class="tile-switch" to="/main-layout/CareerSettings?section=map">地图设置</RouterLink>
    </div>
    <div v-show="mapConfig?.configured && !mapUnavailable" class="map-canvas-wrap">
      <div
        ref="container"
        class="street-map"
        :aria-label="displayArea + '机会分布地图'"
      />
      <div class="map-caption" aria-live="polite">
        <strong>{{ displayArea }}</strong
        ><span>{{ shown.length }} 个机会</span>
      </div>
      <div v-if="!shown.length" class="map-empty-state">
        {{ currentCity || '当前范围' }}暂无机会，可切换地区或添加岗位
      </div>
    </div>
    <section v-if="!mapConfig?.configured || mapUnavailable" class="map-connect-state" aria-label="地图连接状态">
      <h3>{{ mapUnavailable ? '地图暂不可用' : '连接地图，查看机会位置' }}</h3>
      <p>{{ tileWarning || '在设置中填写自己的天地图 Key；全国和各城市共用一份配置。' }}</p>
      <RouterLink to="/main-layout/CareerSettings?section=map">配置地图</RouterLink>
      <div class="region-alternative" aria-label="地区分布列表">
        <button v-for="g in regionalGroups" :key="g.key" @click="currentCity ? emit('district', g.district || g.city) : chooseCity(g.city)">
          {{ g.label }} · {{ g.items.length }} 个机会
        </button>
      </div>
      <p>地址列表与地区筛选仍可使用；这里未显示离线地图。</p>
    </section>
    <div class="map-key">
      <span><i class="point-key" />确认位置 {{ locationCounts.precise }}</span
      ><span><i class="region-key" />地区汇总 {{ locationCounts.regional }}</span
      ><span>地点待核实 {{ locationCounts.missing }}</span>
    </div>
    <p class="map-note">
      地区圆点为区域汇总，不是企业门牌位置。点击圆点查看岗位；全国视图可进入城市。
    </p>
    <p v-if="warning || tileWarning" class="map-warning" role="status">
      {{ warning || tileWarning }}
    </p>
    <p v-if="currentPlace?.level === 'province'" class="map-warning">
      该城市暂无内置地理点，当前显示所属省区；已确认的企业坐标仍正常显示。
    </p>
    <p v-if="clicked" class="coordinates">
      所选位置：{{ clicked.lng.toFixed(6) }},
      {{ clicked.lat.toFixed(6) }}（经纬度近似值）<button @click="saveOrigin">
        设为通勤起点
      </button>
    </p>
    <p v-if="origin" class="coordinates">
      已设置通勤起点；仅确认坐标显示直线距离，通勤时间需手动填写。
    </p>
    <details class="address-panel" :open="!mapConfig?.configured || mapUnavailable">
      <summary>
        企业工作地址 · {{ locationCounts.precise }} 个确认位置 ·
        {{ locationCounts.regional }} 个区域定位 · {{ locationCounts.missing }} 个待定位
      </summary>
      <p>按岗位工作地址归属区域；企业注册地址不替代实际办公地址。点击公司可补充或核实位置。</p>
      <input
        v-model="addressQuery"
        aria-label="搜索地图企业或工作地址"
        placeholder="搜索企业或地址"
      />
      <div class="address-list">
        <button v-for="o in addressPageItems" :key="o.id" @click="locate(o)">
          <span :style="{ color: stageColors[o.stage] }"
            >● {{ o.job.companyName }} · {{ o.stage }}</span
          >
          <small>{{ o.job.address || '工作地址尚未同步' }} · {{ locationLabel(o) }}</small>
        </button>
      </div>
      <p v-if="!addressMatches.length">没有符合条件的企业。</p>
      <nav v-if="addressMatches.length > 8" aria-label="企业地址分页">
        <button :disabled="addressPage === 1" @click="addressPage--">上一页</button>
        <span>{{ addressPage }} / {{ Math.max(1, Math.ceil(addressMatches.length / 8)) }}</span>
        <button :disabled="addressPage * 8 >= addressMatches.length" @click="addressPage++">
          下一页
        </button>
      </nav>
    </details>
  </div>
</template>
<script setup lang="ts">
import {
  onMounted,
  onBeforeUnmount,
  onActivated,
  onDeactivated,
  nextTick,
  ref,
  watch,
  computed
} from 'vue'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { mapProvider, providerPoint as toMapPoint } from '../../../../common/map-provider'
import { jobLocation, recruitmentCities } from '../../../../common/regions'
import {
  defaultMapCity,
  mapPlaces,
  nationalBounds,
  preciseMapLocation as precise,
  regionalMapGroups
} from '../../../../common/opportunity-map'
import { stageColors, type DashboardOpportunity } from '../../../../common/dashboard'
const props = defineProps<{
  items: DashboardOpportunity[]
  selectedDistrict: string
  city?: string
  defaultCity?: string
}>()
const emit = defineEmits<{
  (e: 'select', v: DashboardOpportunity): void
  (e: 'district', v: string): void
  (e: 'city', v: string): void
}>()
const selectedCity = ref(defaultMapCity([props.defaultCity || '']))
const currentCity = computed(() => props.city ?? selectedCity.value)
const displayArea = computed(() => currentCity.value === '台湾' ? '台湾省' : currentCity.value || '全国')
const currentPlace = computed(() => mapPlaces[currentCity.value])
const shown = computed(() =>
  props.items.filter(
    (o) => !currentCity.value || (jobLocation(o.job).city || '地点待核实') === currentCity.value
  )
)
const cityGroups = [...new Set(recruitmentCities.map((c) => c.province))].map((province) => ({
  province,
  cities: recruitmentCities.filter((c) => c.province === province).map((c) => c.name)
}))
function chooseCity(city: string) {
  selectedCity.value = city
  clicked.value = null
  emit('district', '')
  emit('city', city)
}
const regionalGroups = computed(() => regionalMapGroups(shown.value, currentCity.value))
const locationCounts = computed(() => ({
  precise: shown.value.filter(precise).length,
  regional: shown.value.filter((o) => !precise(o) && jobLocation(o.job).city).length,
  missing: shown.value.filter((o) => !precise(o) && !jobLocation(o.job).city).length
}))
const addressQuery = ref(''),
  addressPage = ref(1)
const addressMatches = computed(() =>
  shown.value.filter((o) =>
    `${o.job.companyName} ${o.job.address || ''}`
      .toLowerCase()
      .includes(addressQuery.value.trim().toLowerCase())
  )
)
const addressPageItems = computed(() =>
  addressMatches.value.slice((addressPage.value - 1) * 8, addressPage.value * 8)
)
watch(addressQuery, () => {
  addressPage.value = 1
})
watch(
  () => addressMatches.value.length,
  (n) => {
    addressPage.value = Math.min(addressPage.value, Math.max(1, Math.ceil(n / 8)))
  }
)
function locationLabel(o: DashboardOpportunity) {
  return precise(o)
    ? '已确认位置'
    : [jobLocation(o.job).city, jobLocation(o.job).district].filter(Boolean).join(' · ') ||
        '地点待核实'
}
function locate(o: DashboardOpportunity) {
  if (precise(o)) map?.setView(toMapPoint(o.lat!, o.lng!), 14)
  emit('select', o)
}
const container = ref<HTMLDivElement>(),
  warning = ref(''),
  tileWarning = ref(''),
  mapConfig = ref<any>(),
  mapUnavailable = ref(false)
const origin = ref<{ lng: number; lat: number } | null>(null),
  originRevision = ref(''),
  clicked = ref<{ lng: number; lat: number } | null>(null)
let map: L.Map | undefined,
  markers: L.LayerGroup | undefined,
  tiles: L.GridLayer[] = [],
  generation = 0,
  loadingMap = false,
  errors = 0,
  active = true,
  resize: ResizeObserver | undefined
async function saveOrigin() {
  if (!clicked.value) return
  try {
    const saved = await electron.ipcRenderer.invoke('career-map-origin-save', {
      value: clicked.value,
      baseRevision: originRevision.value
    })
    origin.value = saved.value
    originRevision.value = saved.revision
    warning.value = '通勤起点已保存'
    draw()
  } catch (e) {
    warning.value = String(e)
  }
}
function distance(lat: number, lng: number) {
  if (!origin.value) return ''
  const rad = Math.PI / 180,
    a =
      Math.sin(((lat - origin.value.lat) * rad) / 2) ** 2 +
      Math.cos(lat * rad) *
        Math.cos(origin.value.lat * rad) *
        Math.sin(((lng - origin.value.lng) * rad) / 2) ** 2
  return ` · 直线 ${(12742 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1)} km`
}
function addGroup(
  items: DashboardOpportunity[],
  point: [number, number],
  label: string,
  regional: boolean,
  choose?: () => void
) {
  if (!markers) return
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.stage, (counts.get(item.stage) || 0) + 1)
  let start = 0
  const stops = [...counts].map(([stage, n]) => {
    const end = start + (100 * n) / items.length,
      s = `${stageColors[stage]} ${start}% ${end}%`
    start = end
    return s
  })
  const badge = document.createElement('div')
  badge.className = 'atlas-map-badge' + (regional ? ' regional' : ' precise')
  badge.style.background = `conic-gradient(${stops.join(',')})`
  const number = document.createElement('span')
  number.textContent = regional || items.length > 1 ? String(items.length) : '●'
  badge.append(number)
  const popup = document.createElement('div')
  popup.className = 'atlas-map-popup'
  const title = document.createElement('strong')
  title.textContent = label
  popup.append(title)
  const note = document.createElement('p')
  note.textContent = regional
    ? '地区汇总 · 非企业精确位置'
    : items.length > 1
      ? '已确认位置聚合'
      : '已确认 WGS84 位置' + distance(point[0], point[1])
  popup.append(note)
  if (choose) {
    const b = document.createElement('button')
    b.textContent = !currentCity.value ? '进入' + label + '地图' : '筛选该地区'
    b.onclick = choose
    popup.append(b)
  }
  for (const item of items.slice(0, 20)) {
    const b = document.createElement('button')
    b.textContent = `${item.job.companyName} · ${item.stage}`
    b.onclick = () => emit('select', shown.value.find((o) => o.id === item.id) || item)
    popup.append(b)
  }
  if (items.length > 20) {
    const more = document.createElement('p')
    more.textContent = '显示前20个，可用地区筛选及下方地址列表查看。'
    popup.append(more)
  }
  L.marker(toMapPoint(point[0], point[1]), {
    keyboard: true,
    title: `${label} · ${items.length}个机会 · ${regional ? '地区汇总' : '确认位置'}`,
    alt: label,
    icon: L.divIcon({
      html: badge.outerHTML,
      className: 'atlas-map-marker',
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    })
  })
    .bindTooltip(`${label} · ${items.length}个机会${regional ? '（地区汇总）' : ''}`)
    .bindPopup(popup)
    .addTo(markers)
}
function draw() {
  if (!map || !markers || !active) return
  markers.clearLayers()
  for (const g of regionalGroups.value)
    addGroup(g.items, [g.lat, g.lng], g.label, true, () => {
      if (!currentCity.value) chooseCity(g.city)
      else emit('district', g.district || g.city)
    })
  const groups = new Map<string, DashboardOpportunity[]>()
  for (const o of shown.value.filter(
    (o) => precise(o) && (currentCity.value || !mapPlaces[jobLocation(o.job).city])
  )) {
    const p = map.project(toMapPoint(o.lat!, o.lng!)),
      key = `${Math.floor(p.x / 44)}:${Math.floor(p.y / 44)}`
    groups.set(key, [...(groups.get(key) || []), o])
  }
  for (const items of groups.values())
    addGroup(
      items,
      [
        items.reduce((n, o) => n + o.lat!, 0) / items.length,
        items.reduce((n, o) => n + o.lng!, 0) / items.length
      ],
      items.length === 1 ? items[0].job.companyName : `${items.length}个确认位置`,
      false
    )
}
function fitLocations() {
  if (!map) return
  if (!currentCity.value) {
    map.fitBounds(nationalBounds, { padding: [12, 12], animate: false })
    return
  }
  if (currentCity.value === '台湾') {
    map.fitBounds([[20.5, 118], [26.5, 124]], { padding: [24, 24], maxZoom: 8, animate: false })
    return
  }
  const place = currentPlace.value,
    points = shown.value.filter(precise).map((o) => [o.lat!, o.lng!] as [number, number])
  points.push(...regionalGroups.value.map((g) => [g.lat, g.lng] as [number, number]))
  if (points.length)
    map.fitBounds(
      points.map((p) => toMapPoint(p[0], p[1])),
      { padding: [65, 65], maxZoom: 11, animate: false }
    )
  else if (place)
    map.setView(toMapPoint(place.lat, place.lng), place.level === 'province' ? 6 : 10, {
      animate: false
    })
  else map.fitBounds(nationalBounds, { animate: false })
}
function removeTiles() {
  generation++
  for (const layer of tiles) map?.removeLayer(layer)
  tiles = []
}
function toggleTiles() {
  removeTiles()
  if (!map || !mapConfig.value?.configured || !active) return
  const version = generation
  errors = 0; tileWarning.value = ''; mapUnavailable.value = false
  void nextTick(() => { map?.invalidateSize(); fitLocations() })
  for (const name of mapProvider.layers) {
    const Grid = L.GridLayer.extend({
      createTile(coords: L.Coords, done: L.DoneCallback) {
        const img = document.createElement('img')
        img.alt = ''; img.width = 256; img.height = 256
        const fail = () => {
          if (version !== generation || !active) return
          done(new Error('地图加载失败'), img)
          if (++errors >= 3) {
            tileWarning.value = '地图加载失败，请到地图设置检查连接；地址记录已保留。'
            mapUnavailable.value = true
            clicked.value = null
            removeTiles()
          }
        }
        electron.ipcRenderer.invoke('career-map-tile', {
          layer: name, x: coords.x, y: coords.y, z: coords.z, revision: mapConfig.value.revision
        }).then((data: string) => {
          if (version !== generation || !active) return
          img.onload = () => { if (version === generation) done(undefined, img) }
          img.onerror = fail
          img.src = data
        }).catch(fail)
        return img
      }
    })
    const layer = new Grid()
    L.setOptions(layer, { minZoom: 1, maxZoom: 18, noWrap: true, keepBuffer: 0,
      updateWhenIdle: true, attribution: name === 'vec'
        ? '&copy; <a href="https://www.tianditu.gov.cn/">天地图 · 国家地理信息公共服务平台</a>' : '' })
    tiles.push(layer.addTo(map))
  }
}
async function loadMapSettings() {
  if (loadingMap) return
  loadingMap = true
  try {
    const next = await electron.ipcRenderer.invoke('career-map-settings')
    const changed = next.revision !== mapConfig.value?.revision
    mapConfig.value = next
    if (!next.configured) { removeTiles(); clicked.value = null; mapUnavailable.value = false; return }
    await nextTick()
    initializeMap()
    if (changed || !tiles.length) toggleTiles()
    draw()
  } catch { tileWarning.value = '地图配置读取失败，请在设置中重新读取'; mapUnavailable.value = true }
  finally { loadingMap = false }
}
function initializeMap() {
  if (map || !container.value) return
  map = L.map(container.value, {
    scrollWheelZoom: false,
    zoomControl: true,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    minZoom: 3,
    maxZoom: 18
  }).setView([35, 105], 4)
  map.attributionControl.addAttribution('<a href="https://www.geonames.org/">参考点 © GeoNames</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>')
  markers = L.layerGroup().addTo(map)
  map.on('zoomend', draw)
  map.on('click', (e: L.LeafletMouseEvent) => {
    if (mapConfig.value?.configured && !mapUnavailable.value) clicked.value = { lat: e.latlng.lat, lng: e.latlng.lng }
  })
  resize = new ResizeObserver(() => map?.invalidateSize({ pan: false }))
  resize.observe(container.value)
  fitLocations()
  draw()
}
onMounted(async () => {
  await nextTick()
  window.addEventListener('atlas-map-settings-changed', loadMapSettings)
  await loadMapSettings()
  try {
    const v = await electron.ipcRenderer.invoke('career-map-origin')
    origin.value = v.value
    originRevision.value = v.revision
    draw()
  } catch {
    warning.value = '通勤起点读取失败，当前不能保存'
  }
})
watch(currentCity, async () => {
  await nextTick()
  fitLocations()
  draw()
})
// Routine background reads create fresh objects; keep open popups stable when map data is unchanged.
watch(
  () =>
    JSON.stringify(
      shown.value.map((o) => [
        o.id,
        o.stage,
        o.job.companyName,
        o.job.address,
        o.job.cityName,
        o.lat,
        o.lng,
        o.crs
      ])
    ),
  () => draw()
)
onActivated(() => {
  active = true
  void loadMapSettings()
  void nextTick(() => {
    map?.invalidateSize()
    draw()
  })
})
onDeactivated(() => {
  active = false
  removeTiles()
  markers?.clearLayers()
})
onBeforeUnmount(() => {
  active = false
  window.removeEventListener('atlas-map-settings-changed', loadMapSettings)
  removeTiles()
  resize?.disconnect()
  map?.remove()
  map = undefined
  markers = undefined
  tiles = []
})
</script>
<style scoped>
.map-connect-state{margin:0 18px;padding:28px;border:1px dashed var(--el-border-color);border-radius:12px;background:var(--atlas-panel);min-height:180px}.map-connect-state h3{margin:0 0 12px}.map-connect-state p{font-size:13px;line-height:1.7;color:var(--el-text-color-secondary)}.map-connect-state a,.tile-switch{color:var(--el-color-primary)}.region-alternative{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}.region-alternative button{padding:8px 12px;border:1px solid var(--el-border-color);border-radius:8px;background:var(--atlas-panel);font:inherit;color:inherit;cursor:pointer}

.map-shell {
  position: relative;
}
.map-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding: 4px 18px 14px;
  font-size: 12px;
}
.map-toolbar button,
.city-picker select {
  font: inherit;
  padding: 7px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 7px;
  background: var(--atlas-panel);
  color: var(--el-text-color-primary);
}
.city-picker {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.city-picker select {
  max-width: 190px;
}
.map-toolbar button {
  cursor: pointer;
}
.map-toolbar button:disabled {
  opacity: 0.45;
  cursor: default;
}
.map-toolbar .active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.tile-switch {
  display: flex;
  flex-direction: row;
  gap: 4px;
  align-items: center;
  margin-left: auto;
  color: var(--el-text-color-secondary);
}
.map-canvas-wrap {
  position: relative;
}
.street-map {
  height: 470px;
  background: #f1f5f9;
  z-index: 0;
}
.map-caption {
  position: absolute;
  top: 16px;
  left: 54px;
  z-index: 1;
  display: flex;
  gap: 10px;
  align-items: center;
  background: #fffffff0;
  border: 1px solid #dbe4ef;
  border-radius: 8px;
  padding: 9px 13px;
  pointer-events: none;
  font-size: 12px;
  color: #526681;
}
.map-caption strong {
  font-size: 15px;
  color: #223650;
}
.map-empty-state {
  position: absolute;
  bottom: 38px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1;
  background: #fffffff2;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 12px;
  white-space: nowrap;
  max-width: 85%;
  white-space: normal;
  pointer-events: none;
}
.map-key {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  padding: 12px 18px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.map-key span {
  display: flex;
  gap: 6px;
  align-items: center;
}
.map-key i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #7154b2;
}
.map-key .region-key {
  background: #fff;
  border: 2px dashed #7154b2;
}
.map-note,
.map-warning,
.coordinates {
  font-size: 11px;
  line-height: 1.65;
  color: var(--el-text-color-secondary);
  margin: 8px 18px;
}
.coordinates button {
  font: inherit;
  margin-left: 8px;
}
.map-shell:deep(.leaflet-tooltip) {
  font-family: inherit;
}
.map-shell:deep(.atlas-map-marker) {
  background: none;
  border: 0;
}
.map-shell:deep(.atlas-map-badge) {
  width: 38px;
  height: 38px;
  box-sizing: border-box;
  padding: 3px;
  border-radius: 50%;
  border: 2px solid white;
  box-shadow: 0 2px 8px #23385430;
  display: grid;
  place-items: center;
}
.map-shell:deep(.atlas-map-badge.regional) {
  border: 2px dashed white;
}
.map-shell:deep(.atlas-map-badge span) {
  display: grid;
  place-items: center;
  background: #fff;
  color: #334155;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 600;
}
.map-shell:deep(.atlas-map-marker:focus) {
  outline: 3px solid #2563c7;
  outline-offset: 3px;
  border-radius: 50%;
}
.map-shell:deep(.atlas-map-popup) {
  max-height: 230px;
  overflow: auto;
  min-width: 170px;
  font-family: inherit;
}
.map-shell:deep(.atlas-map-popup p) {
  font-size: 11px;
  color: #64748b;
}
.map-shell:deep(.atlas-map-popup button) {
  display: block;
  background: none;
  border: 0;
  border-bottom: 1px solid #edf1f6;
  padding: 9px 0;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: #2563c7;
  width: 100%;
}
@media (max-width: 900px) {
  .street-map {
    height: 390px;
  }
  .map-toolbar {
    padding: 4px 10px 12px;
  }
  .tile-switch {
    margin-left: 0;
  }
  .map-caption {
    top: 12px;
    left: 50px;
  }
}
.address-panel {
  margin: 14px 18px;
  color: var(--el-text-color-primary);
  font-size: 12px;
}
.address-panel summary {
  cursor: pointer;
  line-height: 1.7;
}
.address-panel p {
  color: var(--el-text-color-secondary);
  font-size: 11px;
  line-height: 1.6;
}
.address-panel input {
  box-sizing: border-box;
  width: 100%;
  padding: 9px;
  color: var(--el-text-color-primary);
  background: var(--atlas-panel);
  border: 1px solid var(--el-border-color);
  border-radius: 7px;
  font: inherit;
}
.address-list button {
  display: grid;
  gap: 4px;
  width: 100%;
  background: none;
  border: 0;
  border-bottom: 1px solid var(--el-border-color);
  padding: 10px 0;
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.address-list small {
  color: var(--el-text-color-secondary);
}
.address-panel nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
}
.address-panel nav button {
  color: var(--el-text-color-primary);
  background: var(--atlas-panel);
  border: 1px solid var(--el-border-color);
  border-radius: 5px;
  padding: 5px 8px;
  font: inherit;
}
.address-panel nav button:disabled {
  opacity: 0.35;
}
</style>

<style>
.atlas-place-label {
  text-align: center;
  color: #3d536b;
  font-size: 10px;
  white-space: nowrap;
  text-shadow:
    0 1px 2px white,
    1px 0 2px white,
    -1px 0 2px white;
  pointer-events: none;
}
</style>
