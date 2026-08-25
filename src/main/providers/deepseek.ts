import { BaseProviderAdapter, type AskContext } from './base'
import type { ProviderDescriptor, ProviderModelOption } from '../../shared/types'
import { providerSendsTemperature } from '../../shared/provider-policy'
import { ProviderError } from '../../shared/errors'

export const deepseekDescriptor: ProviderDescriptor = {
  id: 'deepseek', displayName: 'DeepSeek', defaultBaseURL: 'https://api.deepseek.com', capabilities: ['text','ocr-only','models'],
  defaultModel: 'deepseek-v4-pro', speed: 'balanced', costWeight: .4, enabledByDefault: false
}
export class DeepSeekAdapter extends BaseProviderAdapter {
  constructor() { super(deepseekDescriptor, 'provider-default') }
  private auth() { if (!this.secret) throw new ProviderError('DeepSeek API key is not configured', { code: 'auth', provider: this.id }); return { authorization: `Bearer ${this.secret}` } }
  async listModels(signal?: AbortSignal): Promise<ProviderModelOption[]> {
    const { body } = await this.fetchJson(`${this.baseUrl()}/models`, { headers: this.auth() }, undefined, signal)
    return (Array.isArray(body.data) ? body.data : []).map((x: any) => ({ id: String(x.id), name: x.id, vision: false }))
  }
  protected async performAsk(ctx: AskContext) {
    const baseUrl = this.baseUrl()
    const { body, requestId } = await this.fetchJson(`${baseUrl}/chat/completions`, {
      method: 'POST', headers: { ...this.auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ model: ctx.model, ...(providerSendsTemperature('deepseek', ctx.model, baseUrl) ? { temperature: this.config.temperature } : {}), max_tokens: this.config.maxTokens, messages: [{ role: 'user', content: ctx.text }] })
    }, this.config.timeoutMs, ctx.signal)
    return { text: body.choices?.[0]?.message?.content || '', usage: this.normaliseUsage(body.usage), requestId }
  }
}
