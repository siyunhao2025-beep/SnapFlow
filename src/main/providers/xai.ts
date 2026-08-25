import { BaseProviderAdapter, openAIText, toDataUrl, type AskContext } from './base'
import type { ProviderDescriptor, ProviderModelOption } from '../../shared/types'
import { ProviderError } from '../../shared/errors'

export const xaiDescriptor: ProviderDescriptor = {
  id: 'xai', displayName: 'Grok / xAI', defaultBaseURL: 'https://api.x.ai/v1', capabilities: ['text','vision','stream','models'],
  defaultModel: 'grok-4.6', speed: 'balanced', costWeight: 1, enabledByDefault: false
}
export class XAIAdapter extends BaseProviderAdapter {
  constructor() { super(xaiDescriptor, 'provider-default') }
  private auth() { if (!this.secret) throw new ProviderError('xAI API key is not configured', { code: 'auth', provider: this.id }); return { authorization: `Bearer ${this.secret}` } }
  async listModels(signal?: AbortSignal): Promise<ProviderModelOption[]> {
    const { body } = await this.fetchJson(`${this.baseUrl()}/models`, { headers: this.auth() }, undefined, signal)
    return (Array.isArray(body.data) ? body.data : []).map((x: any) => ({ id: String(x.id), name: x.name || x.id, vision: /grok-4|vision/i.test(String(x.id)) }))
  }
  protected async performAsk(ctx: AskContext) {
    const image = toDataUrl(ctx.image), context = toDataUrl(ctx.contextImage)
    const { body, requestId } = await this.fetchJson(`${this.baseUrl()}/responses`, {
      method: 'POST', headers: { ...this.auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ model: ctx.model, store: false, max_output_tokens: this.config.maxTokens, input: [{ role: 'user', content: [
        ...(context ? [{ type: 'input_image', image_url: context, detail: 'high' }] : []), ...(image ? [{ type: 'input_image', image_url: image, detail: 'high' }] : []), { type: 'input_text', text: ctx.text }
      ] }] })
    }, this.config.timeoutMs, ctx.signal)
    return { text: openAIText(body), usage: this.normaliseUsage(body.usage), requestId }
  }
}
