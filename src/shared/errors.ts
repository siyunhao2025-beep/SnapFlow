import type { ProviderErrorCode } from './types'

export class ProviderError extends Error {
  readonly code: ProviderErrorCode
  readonly httpStatus?: number
  readonly requestId?: string
  readonly retryIn?: number
  readonly provider?: string

  constructor(message: string, options: {
    code?: ProviderErrorCode
    httpStatus?: number
    requestId?: string
    retryIn?: number
    provider?: string
    cause?: unknown
  } = {}) {
    super(message, { cause: options.cause })
    this.name = 'ProviderError'
    this.code = options.code ?? 'unknown'
    this.httpStatus = options.httpStatus
    this.requestId = options.requestId
    this.retryIn = options.retryIn
    this.provider = options.provider
  }
}

export class CapabilityError extends ProviderError {
  constructor(message: string, provider?: string) {
    super(message, { code: 'capability', provider })
    this.name = 'CapabilityError'
  }
}

export function classifyProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error
  const raw = error instanceof Error ? error.message : String(error)
  const statusMatch = raw.match(/\b(4\d\d|5\d\d)\b/)
  const httpStatus = statusMatch ? Number(statusMatch[1]) : undefined
  let code: ProviderErrorCode = 'unknown'
  if (httpStatus === 401 || httpStatus === 403 || /api.?key|unauthorized|authentication|permission/i.test(raw)) code = 'auth'
  else if (httpStatus === 429 || /rate.?limit|quota|too many/i.test(raw)) code = 'rate'
  else if (/abort|timeout|timed out/i.test(raw)) code = 'timeout'
  else if (/fetch failed|network|enotfound|econn|socket|dns/i.test(raw)) code = 'network'
  else if (httpStatus && httpStatus >= 500) code = 'server'
  else if (/content|safety|policy|moderation/i.test(raw)) code = 'content'
  return new ProviderError(raw, { code, httpStatus, cause: error })
}

export function providerErrorMessage(error: unknown, locale: 'zh-CN' | 'en-US' = 'zh-CN') {
  const item = classifyProviderError(error)
  const zh: Record<ProviderErrorCode, string> = {
    auth: `API Key 无效或无权限${item.httpStatus ? ` (${item.httpStatus})` : ''} · 请检查密钥`,
    rate: `请求过快或额度不足${item.retryIn ? ` · ${Math.ceil(item.retryIn / 1000)} 秒后可重试` : ''}`,
    network: '网络连接失败 · 请检查网络、代理或 Base URL',
    timeout: '模型响应超时 · 可重试或切换模型',
    content: '请求被内容/安全策略拒绝',
    capability: '当前模型不支持这个任务所需的能力',
    server: `Provider 服务端错误${item.httpStatus ? ` (${item.httpStatus})` : ''}`,
    unknown: item.message || '未知 Provider 错误'
  }
  const en: Record<ProviderErrorCode, string> = {
    auth: `Invalid or unauthorized API key${item.httpStatus ? ` (${item.httpStatus})` : ''} · check credentials`,
    rate: `Rate limit or quota reached${item.retryIn ? ` · retry in ${Math.ceil(item.retryIn / 1000)}s` : ''}`,
    network: 'Network error · check connectivity, proxy, or Base URL',
    timeout: 'Provider timed out · retry or switch model',
    content: 'Request rejected by content/safety policy',
    capability: 'The selected model does not support the required capability',
    server: `Provider server error${item.httpStatus ? ` (${item.httpStatus})` : ''}`,
    unknown: item.message || 'Unknown provider error'
  }
  return (locale === 'en-US' ? en : zh)[item.code]
}
