import type { ProviderDescriptor, ProviderId, ProviderModelOption } from '../../shared/types'
import { BaseProviderAdapter } from './base'
import { OpenAIAdapter, openAIDescriptor } from './openai'
import { AnthropicAdapter, anthropicDescriptor } from './claude'
import { GeminiAdapter, geminiDescriptor } from './gemini'
import { XAIAdapter, xaiDescriptor } from './xai'
import { DeepSeekAdapter, deepseekDescriptor } from './deepseek'
import { OpenRouterAdapter, openRouterDescriptor } from './openrouter'
import { OllamaAdapter, ollamaDescriptor } from './ollama'

const adapters = [new OpenAIAdapter(), new AnthropicAdapter(), new GeminiAdapter(), new XAIAdapter(), new DeepSeekAdapter(), new OpenRouterAdapter(), new OllamaAdapter()]
const map = new Map<ProviderId, BaseProviderAdapter>(adapters.map((x) => [x.id, x]))
export const providerDescriptors: ProviderDescriptor[] = [openAIDescriptor, anthropicDescriptor, geminiDescriptor, xaiDescriptor, deepseekDescriptor, openRouterDescriptor, ollamaDescriptor]

export const ProviderRegistry = {
  descriptors: providerDescriptors,
  byId(id: ProviderId) { return map.get(id) },
  all() { return [...map.values()] },
  async listAllModels() {
    const rows: Array<{ provider: ProviderId; models: ProviderModelOption[]; error?: string }> = []
    for (const adapter of adapters) {
      try { rows.push({ provider: adapter.id, models: await adapter.listModels() }) }
      catch (error) { rows.push({ provider: adapter.id, models: [], error: error instanceof Error ? error.message : String(error) }) }
    }
    return rows
  }
}
