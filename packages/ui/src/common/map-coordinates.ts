/*!
The MIT License (MIT)

Copyright (c) 2015 记忆的残骸

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
// GCJ-02 display conversion adapted from wandergis/coordtransform (MIT).
// Copyright (c) 2015 记忆的残骸. See docs/licenses/coordtransform.txt.
// This is a display approximation, not survey-grade coordinate conversion.
const PI = Math.PI,
  a = 6378245,
  ee = 0.00669342162296594323
function outside(lng: number, lat: number) {
  return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55)
}
function deltaLat(x: number, y: number) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  r += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3
  r += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3
  return r + ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3
}
function deltaLng(x: number, y: number) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  r += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3
  r += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3
  return r + ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3
}
export function toMapPoint(lat: number, lng: number): [number, number] {
  if (outside(lng, lat)) return [lat, lng]
  const rad = (lat / 180) * PI,
    magic = 1 - ee * Math.sin(rad) ** 2,
    sqrt = Math.sqrt(magic)
  return [
    lat + (deltaLat(lng - 105, lat - 35) * 180) / (((a * (1 - ee)) / (magic * sqrt)) * PI),
    lng + (deltaLng(lng - 105, lat - 35) * 180) / ((a / sqrt) * Math.cos(rad) * PI)
  ]
}
// Invert the display transform before saving the existing WGS84 origin contract.
export function fromMapPoint(lat: number, lng: number): { lat: number; lng: number } {
  let y = lat,
    x = lng
  for (let i = 0; i < 8; i++) {
    const p = toMapPoint(y, x),
      dy = p[0] - lat,
      dx = p[1] - lng
    y -= dy
    x -= dx
    if (Math.abs(dy) + Math.abs(dx) < 1e-9) break
  }
  return { lat: y, lng: x }
}
