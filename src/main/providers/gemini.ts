import { BaseProviderAdapter, toBase64, type AskContext } from './base'
import type { ProviderDescriptor, ProviderModelOption } from '../../shared/types'
import { providerSendsTemperature } from '../../shared/provider-policy'
import { ProviderError } from '../../shared/errors'

export const geminiDescriptor: ProviderDescriptor = {
  id: 'gemini', displayName: 'Gemini', defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta', capabilities: ['text','vision','stream','models','embedding'],
  defaultModel: 'gemini-3.7-flash', speed: 'fast', costWeight: .8, enabledByDefault: true
}
export class GeminiAdapter extends BaseProviderAdapter {
  constructor() { super(geminiDescriptor, 'provider-default') }
  private key() { if (!this.secret) throw new ProviderError('Gemini API key is not configured', { code: 'auth', provider: this.id }); return this.secret }
  async listModels(signal?: AbortSignal): Promise<ProviderModelOption[]> {
    const { body } = await this.fetchJson(`${this.baseUrl()}/models?pageSize=1000`, { headers: { 'x-goog-api-key': this.key() } }, undefined, signal)
    return (Array.isArray(body.models) ? body.models : []).filter((x: any) => (x.supportedGenerationMethods || x.supported_actions || []).some((m: string) => /generate.?content/i.test(m)) || !(x.supportedGenerationMethods || x.supported_actions)?.length)
      .map((x: any) => ({ id: String(x.name || '').replace(/^models\//, ''), name: x.displayName || x.name, vision: true, contextLength: x.inputTokenLimit }))
  }
  protected async performAsk(ctx: AskContext) {
    const image = toBase64(ctx.image), context = toBase64(ctx.contextImage), baseUrl = this.baseUrl()
    const { body, requestId } = await this.fetchJson(`${baseUrl}/models/${encodeURIComponent(ctx.model)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key() },
      body: JSON.stringify({ contents: [{ parts: [
        ...(context ? [{ inlineData: { mimeType: 'image/png', data: context } }] : []), ...(image ? [{ inlineData: { mimeType: 'image/png', data: image } }] : []), { text: ctx.text }
      ] }], generationConfig: { maxOutputTokens: this.config.maxTokens, ...(providerSendsTemperature('gemini', ctx.model, baseUrl) ? { temperature: this.config.temperature } : {}) } })
    }, this.config.timeoutMs, ctx.signal)
    return { text: (body.candidates?.[0]?.content?.parts || []).filter((x: any) => typeof x.text === 'string').map((x: any) => x.text).join('\n'), usage: this.normaliseUsage(body.usageMetadata), requestId }
  }
}
