import { BaseProviderAdapter, toDataUrl, type AskContext } from './base'
import type { ProviderDescriptor, ProviderModelOption } from '../../shared/types'
import { providerSendsTemperature } from '../../shared/provider-policy'
import { ProviderError } from '../../shared/errors'

export const openRouterDescriptor: ProviderDescriptor = {
  id: 'openrouter', displayName: 'OpenRouter', defaultBaseURL: 'https://openrouter.ai/api/v1', capabilities: ['text','vision','stream','models'],
  defaultModel: 'openai/gpt-5.6-luna', speed: 'balanced', costWeight: 1, enabledByDefault: false
}
export class OpenRouterAdapter extends BaseProviderAdapter {
  constructor() { super(openRouterDescriptor) }
  private auth() { if (!this.secret) throw new ProviderError('OpenRouter API key is not configured', { code: 'auth', provider: this.id }); return { authorization: `Bearer ${this.secret}`, 'X-Title': 'SnapFlow' } }
  async listModels(signal?: AbortSignal): Promise<ProviderModelOption[]> {
    let body: any
    try { ({ body } = await this.fetchJson(`${this.baseUrl()}/models/user`, { headers: this.auth() }, undefined, signal)) }
    catch { ({ body } = await this.fetchJson(`${this.baseUrl()}/models`, { headers: this.auth() }, undefined, signal)) }
    return (Array.isArray(body.data) ? body.data : []).map((x: any) => ({ id: String(x.id), name: x.name || x.id, vision: Array.isArray(x?.architecture?.input_modalities) ? x.architecture.input_modalities.includes('image') : undefined, contextLength: x.context_length }))
  }
  protected async performAsk(ctx: AskContext) {
    const image = toDataUrl(ctx.image), context = toDataUrl(ctx.contextImage), baseUrl = this.baseUrl()
    const { body, requestId } = await this.fetchJson(`${baseUrl}/chat/completions`, {
      method: 'POST', headers: { ...this.auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ model: ctx.model, ...(providerSendsTemperature('openrouter', ctx.model, baseUrl) ? { temperature: this.config.temperature } : {}), max_tokens: this.config.maxTokens,
        messages: [{ role: 'user', content: image || context ? [{ type: 'text', text: ctx.text }, ...(context ? [{ type: 'image_url', image_url: { url: context } }] : []), ...(image ? [{ type: 'image_url', image_url: { url: image } }] : [])] : ctx.text }] })
    }, this.config.timeoutMs, ctx.signal)
    return { text: body.choices?.[0]?.message?.content || '', usage: this.normaliseUsage(body.usage), requestId }
  }
}
