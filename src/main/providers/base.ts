import type { AiUsage, AskDelta, ProviderCapability, ProviderConfig, ProviderDescriptor, ProviderId, ProviderModelOption, ProviderTestResult } from '../../shared/types'
import { CapabilityError, ProviderError, classifyProviderError, providerErrorMessage } from '../../shared/errors'
import { RATE_LIMITS, TIMEOUTS, TokenBucket } from '../../shared/provider-policy'
import { store } from '../store'
import { writeProviderAudit, imageHash } from '../audit-log'
import { getProviderSecret } from './secrets'

export type AskContext = {
  model: string
  text: string
  image?: Uint8Array
  contextImage?: Uint8Array
  signal?: AbortSignal
  action?: string
}

export type ProviderFetchResult = { body: any; status: number; headers: Headers; requestId?: string }

export abstract class BaseProviderAdapter {
  readonly id: ProviderId
  readonly displayName: string
  readonly defaultBaseURL: string
  readonly capabilities: ProviderCapability[]
  readonly samplerPolicy: 'provider-default' | 'configurable'
  readonly testPrompt = 'Reply with exactly: SNAPFLOW_OK'
  readonly descriptor: ProviderDescriptor
  private bucket: TokenBucket

  constructor(descriptor: ProviderDescriptor, samplerPolicy: 'provider-default' | 'configurable' = 'configurable') {
    this.id = descriptor.id
    this.displayName = descriptor.displayName
    this.defaultBaseURL = descriptor.defaultBaseURL
    this.capabilities = descriptor.capabilities
    this.samplerPolicy = samplerPolicy
    this.descriptor = descriptor
    this.bucket = new TokenBucket(RATE_LIMITS[descriptor.id])
  }

  get config(): ProviderConfig { return store.getSettings().providers[this.id] }
  get secret() { return getProviderSecret(this.id) }
  get locale() { return store.getSettings().locale }
  supports(cap: ProviderCapability) { return this.capabilities.includes(cap) }

  protected baseUrl(raw = this.config.baseUrl || this.defaultBaseURL) {
    let parsed: URL
    try { parsed = new URL(String(raw).replace(/\/+$/, '')) } catch { throw new ProviderError(`${this.displayName} Base URL is invalid`, { code: 'network', provider: this.id }) }
    const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new ProviderError('Base URL must use HTTPS; only localhost may use HTTP', { code: 'network', provider: this.id })
    return parsed.toString().replace(/\/+$/, '')
  }

  protected checkCapability(image?: Uint8Array) {
    if (image?.length && !this.supports('vision')) throw new CapabilityError(`${this.displayName} is configured as text/OCR only`, this.id)
  }

  protected checkRateLimit() {
    const retryIn = this.bucket.take()
    if (retryIn > 0) throw new ProviderError('Provider rate limit reached', { code: 'rate', retryIn, provider: this.id })
  }

  protected async fetchJson(url: string, init: RequestInit, timeoutMs?: number, outerSignal?: AbortSignal): Promise<ProviderFetchResult> {
    const controller = new AbortController()
    const timeout = Math.max(3_000, timeoutMs ?? (this.supports('vision') ? TIMEOUTS.visionDefault : TIMEOUTS.textDefault))
    const timer = setTimeout(() => controller.abort(), timeout)
    const abort = () => controller.abort()
    outerSignal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      const text = await response.text()
      let body: any
      try { body = text ? JSON.parse(text) : {} } catch { body = { raw: text } }
      const requestId = response.headers.get('x-request-id') || response.headers.get('request-id') || response.headers.get('cf-ray') || undefined
      if (!response.ok) {
        const message = body?.error?.message ?? body?.message ?? body?.raw ?? `${response.status} ${response.statusText}`
        throw new ProviderError(String(message), { code: response.status === 401 || response.status === 403 ? 'auth' : response.status === 429 ? 'rate' : response.status >= 500 ? 'server' : 'unknown', httpStatus: response.status, requestId, provider: this.id })
      }
      return { body, status: response.status, headers: response.headers, requestId }
    } catch (error) {
      const normalized = classifyProviderError(error)
      throw new ProviderError(providerErrorMessage(normalized, this.locale), { ...normalized, provider: this.id, cause: error })
    } finally {
      clearTimeout(timer)
      outerSignal?.removeEventListener('abort', abort)
    }
  }

  abstract listModels(signal?: AbortSignal): Promise<ProviderModelOption[]>
  protected abstract performAsk(ctx: AskContext): Promise<{ text: string; usage?: AiUsage; requestId?: string }>

  async *ask(ctx: AskContext): AsyncIterable<AskDelta> {
    this.checkCapability(ctx.image)
    this.checkRateLimit()
    const started = Date.now()
    let status: 'ok' | 'error' = 'ok'
    let errorCode: any
    let requestId: string | undefined
    let httpStatus: number | undefined
    let usage: AiUsage | undefined
    try {
      const result = await this.performAsk(ctx)
      requestId = result.requestId
      usage = result.usage
      if (!result.text.trim()) throw new ProviderError(`${this.displayName} returned an empty response`, { code: 'content', provider: this.id, requestId })
      yield { type: 'text', text: result.text.trim() }
      if (usage) yield { type: 'usage', usage }
      yield { type: 'done' }
    } catch (error) {
      status = 'error'
      const normalized = classifyProviderError(error)
      errorCode = normalized.code
      requestId = normalized.requestId
      httpStatus = normalized.httpStatus
      throw normalized
    } finally {
      writeProviderAudit({
        ts: new Date().toISOString(), provider: this.id, model: ctx.model, action: ctx.action || 'ask', status,
        latencyMs: Date.now() - started, httpStatus, errorCode, requestId, promptTokens: usage?.inputTokens, completionTokens: usage?.outputTokens,
        vision: Boolean(ctx.image?.length), imageHash: imageHash(ctx.image), textSnippetRedacted: ctx.text
      })
    }
  }

  async testConnection(model = this.config.model): Promise<ProviderTestResult> {
    const started = Date.now()
    try {
      let text = ''
      for await (const delta of this.ask({ model, text: this.testPrompt, action: 'test_connection' })) if (delta.type === 'text') text += delta.text || ''
      return { ok: Boolean(text.trim()), provider: this.id, model, message: 'Connected', latencyMs: Date.now() - started }
    } catch (error) {
      const normalized = classifyProviderError(error)
      return { ok: false, provider: this.id, model, message: providerErrorMessage(normalized, this.locale), latencyMs: Date.now() - started, requestId: normalized.requestId, errorCode: normalized.code }
    }
  }

  normaliseUsage(raw: any): AiUsage | undefined {
    if (!raw) return undefined
    const inputTokens = raw.input_tokens ?? raw.prompt_tokens ?? raw.promptTokenCount ?? raw.inputTokens
    const outputTokens = raw.output_tokens ?? raw.completion_tokens ?? raw.candidatesTokenCount ?? raw.outputTokens
    const totalTokens = raw.total_tokens ?? raw.totalTokenCount ?? raw.totalTokens ?? ((inputTokens ?? 0) + (outputTokens ?? 0))
    if (![inputTokens, outputTokens, totalTokens].some((x) => Number.isFinite(Number(x)))) return undefined
    return { inputTokens: Number(inputTokens || 0), outputTokens: Number(outputTokens || 0), totalTokens: Number(totalTokens || 0), estimated: false }
  }

  mapError(error: unknown) { return classifyProviderError(error) }
}

export function toDataUrl(buffer?: Uint8Array) { return buffer?.length ? `data:image/png;base64,${Buffer.from(buffer).toString('base64')}` : '' }
export function toBase64(buffer?: Uint8Array) { return buffer?.length ? Buffer.from(buffer).toString('base64') : '' }
export function openAIText(body: any) {
  if (typeof body?.output_text === 'string') return body.output_text
  const chunks: string[] = []
  for (const item of body?.output ?? []) for (const part of item?.content ?? []) if (typeof part?.text === 'string') chunks.push(part.text)
  return chunks.join('\n')
}
