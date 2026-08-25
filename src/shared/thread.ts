import type { Card } from './types'

export function isThreadCandidate(candidate: Card, appName: string, windowTitle: string, now = Date.now(), maxAgeMs = 15 * 60 * 1000) {
  const ageMs = now - new Date(candidate.createdAt).getTime()
  if (ageMs < 0 || ageMs > maxAgeMs) return false
  if (!appName || candidate.appName !== appName) return false
  if (!windowTitle || !candidate.windowTitle) return true
  const a = windowTitle.toLowerCase()
  const b = candidate.windowTitle.toLowerCase()
  return a === b || a.includes(b) || b.includes(a)
}
