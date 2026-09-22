export const mapProvider = {
  id: 'tianditu',
  name: '天地图',
  console: 'https://console.tianditu.gov.cn/api/key',
  documentation: 'https://lbs.tianditu.gov.cn/server/MapService.html',
  layers: ['vec', 'cva', 'ibo'] as const
}
export type MapTileRequest = { layer: 'vec' | 'cva' | 'ibo'; x: number; y: number; z: number; revision: string }
export function validateMapTile(input: unknown): MapTileRequest {
  const p = input as MapTileRequest
  if (!p || !mapProvider.layers.includes(p.layer) ||
      !Number.isInteger(p.z) || p.z < 1 || p.z > 18 ||
      !Number.isInteger(p.x) || !Number.isInteger(p.y) ||
      p.x < 0 || p.y < 0 || p.x >= 2 ** p.z || p.y >= 2 ** p.z ||
      typeof p.revision !== 'string' || !/^[a-f0-9]{64}$/.test(p.revision))
    throw Error('地图请求超出支持范围')
  return { layer: p.layer, x: p.x, y: p.y, z: p.z, revision: p.revision }
}
// The provider's Web Mercator layers use geographic coordinates, not GCJ-02.
// WGS84 reference points are approximate display anchors, not survey control points.
export const providerPoint = (lat: number, lng: number): [number, number] => [lat, lng]
