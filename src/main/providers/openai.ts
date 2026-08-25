import { BaseProviderAdapter, openAIText, toDataUrl, type AskContext } from './base'
import type { ProviderDescriptor, ProviderModelOption } from '../../shared/types'
import { providerSendsTemperature } from '../../shared/provider-policy'
import { ProviderError } from '../../shared/errors'

export const openAIDescriptor: ProviderDescriptor = {
  id: 'openai', displayName: 'OpenAI', defaultBaseURL: 'https://api.openai.com/v1',
  capabilities: ['text','vision','stream','models','embedding'], defaultModel: 'gpt-5.6-luna', speed: 'balanced', costWeight: 1.2, enabledByDefault: true
}
export class OpenAIAdapter extends BaseProviderAdapter {
  constructor() { super(openAIDescriptor, 'provider-default') }
  async listModels(signal?: AbortSignal): Promise<ProviderModelOption[]> {
    if (!this.secret) throw new ProviderError('OpenAI API key is not configured', { code: 'auth', provider: this.id })
    const { body } = await this.fetchJson(`${this.baseUrl()}/models`, { headers: { authorization: `Bearer ${this.secret}` } }, undefined, signal)
    return (Array.isArray(body.data) ? body.data : []).map((x: any) => ({ id: String(x.id), name: String(x.id), vision: /gpt-4o|gpt-4\.1|gpt-5/i.test(String(x.id)) }))
  }
  protected async performAsk(ctx: AskContext) {
    if (!this.secret) throw new ProviderError('OpenAI API key is not configured', { code: 'auth', provider: this.id })
    const baseUrl = this.baseUrl()
    const image = toDataUrl(ctx.image), context = toDataUrl(ctx.contextImage)
    const official = /(^|\.)api\.openai\.com$/i.test(new URL(baseUrl).hostname)
    if (official) {
      const { body, requestId } = await this.fetchJson(`${baseUrl}/responses`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.secret}` },
        body: JSON.stringify({ model: ctx.model, max_output_tokens: this.config.maxTokens, input: [{ role: 'user', content: [
          { type: 'input_text', text: ctx.text },
          ...(context ? [{ type: 'input_image', image_url: context, detail: 'high' }] : []),
          ...(image ? [{ type: 'input_image', image_url: image, detail: 'high' }] : [])
        ] }] })
      }, this.config.timeoutMs, ctx.signal)
      return { text: openAIText(body), usage: this.normaliseUsage(body.usage), requestId }
    }
    const { body, requestId } = await this.fetchJson(`${baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.secret}` },
      body: JSON.stringify({ model: ctx.model, ...(providerSendsTemperature('openai', ctx.model, baseUrl) ? { temperature: this.config.temperature } : {}), max_tokens: this.config.maxTokens,
        messages: [{ role: 'user', content: image || context ? [
          { type: 'text', text: ctx.text }, ...(context ? [{ type: 'image_url', image_url: { url: context } }] : []), ...(image ? [{ type: 'image_url', image_url: { url: image } }] : [])
        ] : ctx.text }] })
    }, this.config.timeoutMs, ctx.signal)
    return { text: body.choices?.[0]?.message?.content || '', usage: this.normaliseUsage(body.usage), requestId }
  }
}
