import { BaseProviderAdapter, toBase64, type AskContext } from './base'
import type { ProviderDescriptor, ProviderModelOption } from '../../shared/types'

export const ollamaDescriptor: ProviderDescriptor = {
  id: 'ollama', displayName: 'Ollama', defaultBaseURL: 'http://127.0.0.1:11434', capabilities: ['text','vision','stream','models','local','embedding'],
  defaultModel: 'llava:latest', speed: 'balanced', costWeight: 0, enabledByDefault: false
}
export class OllamaAdapter extends BaseProviderAdapter {
  constructor() { super(ollamaDescriptor) }
  async listModels(signal?: AbortSignal): Promise<ProviderModelOption[]> {
    const { body } = await this.fetchJson(`${this.baseUrl()}/api/tags`, {}, undefined, signal)
    return (Array.isArray(body.models) ? body.models : []).map((x: any) => ({ id: String(x.model || x.name), name: x.name || x.model, vision: /llava|vision|minicpm|moondream|gemma3/i.test(String(x.model || x.name)) }))
  }
  protected async performAsk(ctx: AskContext) {
    const image = toBase64(ctx.image), context = toBase64(ctx.contextImage)
    const { body, requestId } = await this.fetchJson(`${this.baseUrl()}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: ctx.model, stream: false, options: { temperature: this.config.temperature, num_predict: this.config.maxTokens },
        messages: [{ role: 'user', content: ctx.text, ...((image || context) ? { images: [...(context ? [context] : []), ...(image ? [image] : [])] } : {}) }] })
    }, this.config.timeoutMs, ctx.signal)
    return { text: body.message?.content || body.response || '', usage: { inputTokens: body.prompt_eval_count, outputTokens: body.eval_count, totalTokens: (body.prompt_eval_count || 0) + (body.eval_count || 0), estimated: false }, requestId }
  }
}
