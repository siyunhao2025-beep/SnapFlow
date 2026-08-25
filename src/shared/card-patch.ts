import type { Card } from './types'

/** Renderer-writable Card fields. Main-process-owned fields are intentionally ignored. */
export function sanitizeRendererCardPatch(patch: unknown): Partial<Card> {
  const safe: Partial<Card> = {}
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return safe
  const raw = patch as Partial<Card>
  if (typeof raw.starred === 'boolean') safe.starred = raw.starred
  if (Object.prototype.hasOwnProperty.call(raw, 'projectId')) {
    if (raw.projectId === undefined || typeof raw.projectId === 'string') safe.projectId = raw.projectId
  }
  if (Array.isArray(raw.tags)) safe.tags = raw.tags.map(String).map((x) => x.trim().slice(0, 80)).filter(Boolean).slice(0, 20)
  if (raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)) {
    const candidate = (raw.metadata as Record<string, unknown>).suggestedProjectId
    if (candidate === '') safe.metadata = { suggestedProjectId: '' }
  }
  return safe
}
