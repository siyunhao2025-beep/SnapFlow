import type { CaptureRect } from './types'

export type CapturePoint = { x: number; y: number }

export function rectFromPoints(a: CapturePoint, b: CapturePoint): CaptureRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  }
}

export function imageCropFromDipRect(
  rect: CaptureRect,
  imageSize: { width: number; height: number },
  displaySize: { width: number; height: number }
): CaptureRect {
  const sx = imageSize.width / Math.max(1, displaySize.width)
  const sy = imageSize.height / Math.max(1, displaySize.height)
  const x = Math.max(0, Math.min(imageSize.width - 1, Math.round(rect.x * sx)))
  const y = Math.max(0, Math.min(imageSize.height - 1, Math.round(rect.y * sy)))
  const requestedWidth = Math.max(1, Math.round(rect.width * sx))
  const requestedHeight = Math.max(1, Math.round(rect.height * sy))
  return {
    x,
    y,
    width: Math.max(1, Math.min(requestedWidth, imageSize.width - x)),
    height: Math.max(1, Math.min(requestedHeight, imageSize.height - y))
  }
}

export function pointInsideRect(point: CapturePoint, rect: CaptureRect) {
  return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height
}


export function clampDipRectToDisplay(rect: CaptureRect, displaySize: { width: number; height: number }): CaptureRect {
  const maxW = Math.max(0, displaySize.width)
  const maxH = Math.max(0, displaySize.height)
  const left = Math.max(0, Math.min(maxW, rect.x))
  const top = Math.max(0, Math.min(maxH, rect.y))
  const right = Math.max(left, Math.min(maxW, rect.x + rect.width))
  const bottom = Math.max(top, Math.min(maxH, rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}
