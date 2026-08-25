import { BaseProviderAdapter, toBase64, type AskContext } from './base'
import type { ProviderDescriptor, ProviderModelOption } from '../../shared/types'
import { ProviderError } from '../../shared/errors'

export const anthropicDescriptor: ProviderDescriptor = {
  id: 'anthropic', displayName: 'Claude / Anthropic', defaultBaseURL: 'https://api.anthropic.com/v1', capabilities: ['text','vision','stream','models'],
  defaultModel: 'claude-sonnet-4-20250514', speed: 'balanced', costWeight: 1.2, enabledByDefault: true
}
export class AnthropicAdapter extends BaseProviderAdapter {
  constructor() { super(anthropicDescriptor, 'provider-default') }
  private headers() { if (!this.secret) throw new ProviderError('Anthropic API key is not configured', { code: 'auth', provider: this.id }); return { 'x-api-key': this.secret, 'anthropic-version': '2023-06-01' } }
  async listModels(signal?: AbortSignal): Promise<ProviderModelOption[]> {
    const { body } = await this.fetchJson(`${this.baseUrl()}/models`, { headers: this.headers() }, undefined, signal)
    return (Array.isArray(body.data) ? body.data : []).map((x: any) => ({ id: String(x.id), name: x.display_name || x.id, vision: true }))
  }
  protected async performAsk(ctx: AskContext) {
    const image = toBase64(ctx.image), context = toBase64(ctx.contextImage)
    const { body, requestId } = await this.fetchJson(`${this.baseUrl()}/messages`, {
      method: 'POST', headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ model: ctx.model, max_tokens: this.config.maxTokens, messages: [{ role: 'user', content: [
        ...(context ? [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: context } }] : []),
        ...(image ? [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } }] : []),
        { type: 'text', text: ctx.text }
      ] }] })
    }, this.config.timeoutMs, ctx.signal)
    return { text: (body.content || []).filter((x: any) => x.type === 'text').map((x: any) => x.text).join('\n'), usage: this.normaliseUsage(body.usage), requestId }
  }
}
