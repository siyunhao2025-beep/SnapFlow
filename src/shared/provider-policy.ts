import type { ProviderId } from './types'

export const TIMEOUTS = {
  textDefault: 25_000,
  visionDefault: 45_000,
  streamTickDefault: 8_000,
  modelsDefault: 20_000,
  testDefault: 20_000
} as const

export const RATE_LIMITS: Record<ProviderId, number> = {
  openai: 30,
  anthropic: 30,
  gemini: 30,
  xai: 30,
  deepseek: 30,
  openrouter: 30,
  ollama: 120
}

export type CompareSchemaItem = {
  provider: ProviderId
  display: string
  strengths: string[]
  costWeight: number
  speed: 'fast' | 'balanced' | 'quality'
}

export const compareSchema: CompareSchemaItem[] = [
  { provider: 'openai', display: 'OpenAI', strengths: ['vision', 'reasoning', 'code'], costWeight: 1.2, speed: 'balanced' },
  { provider: 'anthropic', display: 'Claude', strengths: ['code', 'long-context', 'writing'], costWeight: 1.2, speed: 'balanced' },
  { provider: 'gemini', display: 'Gemini', strengths: ['vision', 'speed', 'multimodal'], costWeight: .8, speed: 'fast' },
  { provider: 'xai', display: 'Grok', strengths: ['vision', 'reasoning'], costWeight: 1.0, speed: 'balanced' },
  { provider: 'deepseek', display: 'DeepSeek', strengths: ['text', 'code', 'cost'], costWeight: .4, speed: 'balanced' },
  { provider: 'openrouter', display: 'OpenRouter', strengths: ['model-choice', 'routing'], costWeight: 1.0, speed: 'balanced' },
  { provider: 'ollama', display: 'Ollama', strengths: ['local', 'privacy'], costWeight: 0, speed: 'balanced' }
]

export function providerSendsTemperature(provider: ProviderId, model: string, baseUrl = '') {
  const value = model.toLowerCase()
  if (provider === 'anthropic') return false
  if (provider === 'gemini' && /gemini-3\.[5-9]|gemini-4/i.test(value)) return false
  if (provider === 'deepseek' && /v4|reasoner/i.test(value)) return false
  if ((provider === 'openai' || provider === 'openrouter') && /gpt-5|o\d|reason/i.test(value)) return false
  if (provider === 'openai' && /api\.openai\.com/i.test(baseUrl) && /gpt-5/i.test(value)) return false
  return true
}

export class TokenBucket {
  private timestamps: number[] = []
  constructor(private readonly perMinute: number) {}

  take(now = Date.now()) {
    const cutoff = now - 60_000
    this.timestamps = this.timestamps.filter((x) => x > cutoff)
    if (this.timestamps.length >= Math.max(1, this.perMinute)) {
      return Math.max(1, 60_000 - (now - this.timestamps[0]))
    }
    this.timestamps.push(now)
    return 0
  }
}
