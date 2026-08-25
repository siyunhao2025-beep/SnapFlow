import type { Card, ProviderId, WorkflowRecommendation } from './types'

export function deriveWorkflowRecommendations(cards: Card[], threshold = 3): WorkflowRecommendation[] {
  const counts = new Map<string, WorkflowRecommendation>()
  for (const card of cards) for (const answer of card.answers) {
    if (answer.provider === 'mock' || answer.action === 'AI Consensus' || answer.action.startsWith('Compare')) continue
    const signature = `${card.type}|${answer.provider}|${answer.action}`
    const current = counts.get(signature) ?? {
      signature,
      intent: card.type,
      provider: answer.provider as ProviderId,
      action: answer.action,
      count: 0,
      suggestedName: `${card.type} → ${answer.provider} → ${answer.action}`
    }
    current.count += 1
    counts.set(signature, current)
  }
  return [...counts.values()].filter((x) => x.count >= threshold).sort((a, b) => b.count - a.count)
}
