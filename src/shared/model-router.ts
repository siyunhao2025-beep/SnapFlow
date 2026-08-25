import type { IntentType, ProviderId } from './types'


export function shouldRequireVisionForCard(type: IntentType, hasImage: boolean, ocrText: string) {
  if (!hasImage) return false
  const visualFirst = new Set<IntentType>(['scientific_figure', 'chart', 'software_ui'])
  return !ocrText.trim() || visualFirst.has(type)
}

export type RouterCandidate = {
  id: ProviderId
  supportsVision: boolean
  speed?: 'fast' | 'balanced' | 'quality'
  costWeight?: number
}

export function scoreProviderCandidate(intent: IntentType, needsVision: boolean, tags: string[], candidate: RouterCandidate) {
  const id = candidate.id
  let points = 0
  if (intent === 'programming_error' || intent === 'code') {
    if (id === 'anthropic') points += 12
    if (id === 'openai') points += 10
    if (id === 'xai') points += 8
    if (id === 'gemini') points += 7
  } else if (['scientific_figure', 'chart', 'table', 'excel'].includes(intent)) {
    if (id === 'gemini') points += 12
    if (id === 'openai') points += 10
    if (id === 'anthropic') points += 8
    if (id === 'xai') points += 7
  } else if (['paper', 'document', 'pdf', 'equation'].includes(intent)) {
    if (id === 'openai') points += 12
    if (id === 'anthropic') points += 11
    if (id === 'gemini') points += 8
  } else {
    if (id === 'openai') points += 10
    if (id === 'gemini') points += 9
    if (id === 'anthropic') points += 8
  }
  if (needsVision && candidate.supportsVision) points += 5
  if (candidate.speed === 'fast') points += 2
  if ((candidate.costWeight ?? 1) <= 0.8) points += 1
  if (id === 'ollama' && tags.includes('private')) points += 15
  return points
}

export function rankProviderCandidates(intent: IntentType, needsVision: boolean, tags: string[], candidates: RouterCandidate[]) {
  return [...candidates].sort((a, b) => scoreProviderCandidate(intent, needsVision, tags, b) - scoreProviderCandidate(intent, needsVision, tags, a))
}
