import type { ModelDescriptor } from '../shared/types'

/**
 * Central model registry. UI components never hard-code provider/model capability rules.
 * Users may still override the active model string in Settings for newly released models.
 */
export const modelRegistry: ModelDescriptor[] = [
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    provider: 'openai',
    capabilities: ['general', 'coding', 'reasoning', 'vision', 'scientific'],
    vision: true,
    contextLength: 1_050_000,
    costWeight: 2.2,
    speed: 'quality',
    enabled: true
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    provider: 'openai',
    capabilities: ['general', 'coding', 'reasoning', 'vision'],
    vision: true,
    contextLength: 1_050_000,
    costWeight: 1.2,
    speed: 'balanced',
    enabled: true
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    provider: 'openai',
    capabilities: ['general', 'ocr', 'vision', 'fast'],
    vision: true,
    contextLength: 1_050_000,
    costWeight: 0.35,
    speed: 'fast',
    enabled: true
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    capabilities: ['general', 'coding', 'reasoning', 'vision', 'scientific'],
    vision: true,
    contextLength: 1_000_000,
    costWeight: 1.3,
    speed: 'balanced',
    enabled: true
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    provider: 'anthropic',
    capabilities: ['general', 'coding', 'reasoning', 'vision', 'scientific'],
    vision: true,
    contextLength: 1_000_000,
    costWeight: 2.1,
    speed: 'quality',
    enabled: true
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    provider: 'gemini',
    capabilities: ['general', 'coding', 'vision', 'ocr', 'scientific', 'fast'],
    vision: true,
    contextLength: 1_048_576,
    costWeight: 0.75,
    speed: 'fast',
    enabled: true
  },
  {
    id: 'grok-4.6',
    name: 'Grok 4.6',
    provider: 'xai',
    capabilities: ['general', 'coding', 'reasoning', 'vision'],
    vision: true,
    contextLength: 500_000,
    costWeight: 1.2,
    speed: 'balanced',
    enabled: true
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    capabilities: ['general', 'coding', 'text'],
    vision: false,
    costWeight: 0.4,
    speed: 'balanced',
    enabled: true
  },
  {
    id: 'openrouter-auto',
    name: 'OpenRouter (custom model)',
    provider: 'openrouter',
    capabilities: ['general', 'routing'],
    vision: true,
    costWeight: 1,
    speed: 'balanced',
    enabled: true
  },
  {
    id: 'llava:latest',
    name: 'Ollama Local Vision',
    provider: 'ollama',
    capabilities: ['general', 'vision', 'local', 'private'],
    vision: true,
    costWeight: 0,
    speed: 'balanced',
    enabled: true
  }
]

export function getRegisteredModel(provider: string, model: string) {
  return modelRegistry.find((item) => item.provider === provider && item.id === model)
}
