import type { AiUsage, ProviderId } from '../shared/types'

const modelMultipliers: Partial<Record<ProviderId, number>> = {
  openai: 1.2,
  anthropic: 1.2,
  gemini: 0.8,
  xai: 1.1,
  deepseek: 0.4,
  openrouter: 1.0,
  ollama: 0
}

export function estimateCredits(provider: ProviderId, usage?: AiUsage, isRouter = false) {
  if (provider === 'ollama') return 0
  const multiplier = modelMultipliers[provider] ?? 1
  if (!usage?.totalTokens && !usage?.inputTokens && !usage?.outputTokens) {
    return Math.max(1, Math.ceil((isRouter ? 0.6 : 2) * multiplier))
  }
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const raw = 0.7 + input / 6000 + output / 2000
  return Math.max(1, Math.ceil(raw * multiplier * (isRouter ? 0.5 : 1)))
}
