import type { CaptureRect, VisualDescriptor } from '../../../shared/types'

type ResizeRequest = { mode?: 'resize'; bitmap?: ImageBitmap; maxWidth?: number }
type VisualRequest = { mode: 'visual'; bitmap?: ImageBitmap; selection: CaptureRect; displayWidth: number; displayHeight: number }
type Request = ResizeRequest | VisualRequest

const palette = [
  { name: 'red', rgb: [220, 70, 70] },
  { name: 'orange', rgb: [230, 145, 55] },
  { name: 'yellow', rgb: [225, 205, 70] },
  { name: 'green', rgb: [70, 170, 90] },
  { name: 'cyan', rgb: [55, 185, 195] },
  { name: 'blue', rgb: [65, 110, 210] },
  { name: 'purple', rgb: [135, 85, 190] },
  { name: 'pink', rgb: [220, 95, 160] },
  { name: 'black', rgb: [30, 30, 35] },
  { name: 'gray', rgb: [135, 135, 140] },
  { name: 'white', rgb: [235, 235, 235] }
] as const

function nearestColor(r: number, g: number, b: number) {
  let best: (typeof palette)[number]['name'] = palette[0].name
  let bestDistance = Number.POSITIVE_INFINITY
  for (const item of palette) {
    const [pr, pg, pb] = item.rgb
    const distance = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
    if (distance < bestDistance) { bestDistance = distance; best = item.name }
  }
  return best
}

function analyze(bitmap: ImageBitmap, selection: CaptureRect, displayWidth: number, displayHeight: number): VisualDescriptor {
  const sx = bitmap.width / Math.max(1, displayWidth)
  const sy = bitmap.height / Math.max(1, displayHeight)
  const sourceX = Math.max(0, Math.round(selection.x * sx))
  const sourceY = Math.max(0, Math.round(selection.y * sy))
  const sourceW = Math.max(1, Math.min(bitmap.width - sourceX, Math.round(selection.width * sx)))
  const sourceH = Math.max(1, Math.min(bitmap.height - sourceY, Math.round(selection.height * sy)))
  const width = 48
  const height = 48
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable')
  ctx.drawImage(bitmap, sourceX, sourceY, sourceW, sourceH, 0, 0, width, height)
  const data = ctx.getImageData(0, 0, width, height).data
  let r = 0, g = 0, b = 0, saturation = 0, brightness = 0, edges = 0, samples = 0
  const counts = new Map<string, number>()
  const luminance: number[] = []
  for (let i = 0; i < data.length; i += 4) {
    const pr = data[i], pg = data[i + 1], pb = data[i + 2]
    r += pr; g += pg; b += pb; samples += 1
    const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb)
    saturation += max === 0 ? 0 : (max - min) / max
    const lum = (pr * .2126 + pg * .7152 + pb * .0722) / 255
    brightness += lum
    luminance.push(lum)
    const color = nearestColor(pr, pg, pb)
    counts.set(color, (counts.get(color) || 0) + 1)
  }
  for (let y = 1; y < height; y++) for (let x = 1; x < width; x++) {
    const idx = y * width + x
    const diff = Math.abs(luminance[idx] - luminance[idx - 1]) + Math.abs(luminance[idx] - luminance[idx - width])
    if (diff > .28) edges += 1
  }
  const dominantColors = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name)
  const count = Math.max(1, samples)
  const avgBrightness = brightness / count
  return {
    dominantColors,
    averageRgb: { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) },
    brightness: Number(avgBrightness.toFixed(4)),
    saturation: Number((saturation / count).toFixed(4)),
    edgeDensity: Number((edges / Math.max(1, (width - 1) * (height - 1))).toFixed(4)),
    aspectRatio: Number((selection.width / Math.max(1, selection.height)).toFixed(4)),
    isDark: avgBrightness < .38
  }
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const bitmap = event.data.bitmap
  if (!bitmap) return (self as any).postMessage({ ok: false, warning: 'No bitmap supplied' })
  try {
    if (event.data.mode === 'visual') {
      const descriptor = analyze(bitmap, event.data.selection, event.data.displayWidth, event.data.displayHeight)
      bitmap.close()
      return (self as any).postMessage({ ok: true, descriptor })
    }
    const maxWidth = Math.max(320, Math.min(2048, event.data.maxWidth || 1600))
    const scale = Math.min(1, maxWidth / bitmap.width)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(bitmap, 0, 0, width, height)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const buffer = await blob.arrayBuffer()
    bitmap.close()
    ;(self as any).postMessage({ ok: true, width, height, buffer }, [buffer])
  } catch (error) {
    try { bitmap.close() } catch {}
    ;(self as any).postMessage({ ok: false, warning: error instanceof Error ? error.message : String(error) })
  }
}
export {}
