import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { AiUsage, CloudSessionState, ProviderId, ProviderModelOption } from '../shared/types'
import { getSnapFlowPaths } from './paths'
import { store } from './store'
import { ProviderError, classifyProviderError } from '../shared/errors'

let memoryToken = ''
let cachedProviders: { at: number; ids: ProviderId[] } = { at: 0, ids: [] }
let cachedState: CloudSessionState = { enabled: false, connected: false, baseUrl: '' }
function tokenPath() { return path.join(getSnapFlowPaths().config, 'cloud-session.bin') }
function cloudBaseUrl() {
  const raw = store.getSettings().cloud.baseUrl.trim()
  if (!raw) throw new Error('SnapFlow Cloud URL is not configured')
  const u = new URL(raw)
  const local = ['localhost','127.0.0.1','::1'].includes(u.hostname)
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('SnapFlow Cloud URL must use HTTPS; localhost may use HTTP')
  return u.toString().replace(/\/+$/, '')
}
function getToken() {
  if (memoryToken) return memoryToken
  try {
    if (!fs.existsSync(tokenPath()) || !safeStorage.isEncryptionAvailable()) return ''
    memoryToken = safeStorage.decryptString(fs.readFileSync(tokenPath()))
    return memoryToken
  } catch { return '' }
}
function clearPersistedToken() { try { fs.unlinkSync(tokenPath()) } catch {} }
function hasPersistedToken() { try { return fs.existsSync(tokenPath()) } catch { return false } }
function saveToken(token: string, persist = true) {
  memoryToken = token
  if (!token) { clearPersistedToken(); return }
  if (!persist) { clearPersistedToken(); return }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('System secure storage is unavailable; refusing to store cloud token')
  fs.mkdirSync(path.dirname(tokenPath()), { recursive: true })
  fs.writeFileSync(tokenPath(), safeStorage.encryptString(token))
}
async function request(pathname: string, init: RequestInit = {}) {
  const token = getToken()
  const response = await fetch(`${cloudBaseUrl()}${pathname}`, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } })
  const text = await response.text()
  let body: any = {}; try { body = text ? JSON.parse(text) : {} } catch { body = { message: text } }
  if (!response.ok) throw new ProviderError(body?.message || `Cloud HTTP ${response.status}`, { code: response.status === 401 || response.status === 403 ? 'auth' : response.status === 429 ? 'rate' : response.status >= 500 ? 'server' : 'unknown', httpStatus: response.status, provider: 'cloud' })
  return body
}

export const cloudService = {
  hasToken: () => Boolean(getToken()),
  isRemembered: () => hasPersistedToken(),
  getCachedState: () => ({ ...cachedState, user: cachedState.user ? { ...cachedState.user } : undefined }),
  canUseProviderSync(provider: ProviderId) {
    if (provider === 'ollama') return false
    return Boolean(store.getSettings().cloud.enabled && getToken() && cachedProviders.ids.includes(provider))
  },
  async register(email: string, displayName: string, password: string, rememberMe = true): Promise<CloudSessionState> {
    const body = await request('/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, displayName, password }) })
    saveToken(String(body.token || ''), rememberMe)
    cachedProviders = { at: 0, ids: [] }
    return this.status()
  },
  async login(email: string, password: string, rememberMe = true): Promise<CloudSessionState> {
    const body = await request('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    saveToken(String(body.token || ''), rememberMe)
    cachedProviders = { at: 0, ids: [] }
    return this.status()
  },
  logout() {
    saveToken('')
    cachedProviders = { at: 0, ids: [] }
    cachedState = { enabled: store.getSettings().cloud.enabled, connected: false, baseUrl: store.getSettings().cloud.baseUrl }
    return { ...cachedState }
  },
  async status(): Promise<CloudSessionState> {
    const settings = store.getSettings().cloud
    if (!settings.enabled || !settings.baseUrl || !getToken()) {
      cachedState = { enabled: settings.enabled, connected: false, baseUrl: settings.baseUrl, message: !settings.enabled ? 'Cloud disabled' : 'Not signed in' }
      if (!getToken()) cachedProviders = { at: 0, ids: [] }
      return { ...cachedState }
    }
    try {
      const body = await request('/v1/me')
      const creditState = await this.credits().catch(() => undefined)
      cachedState = { enabled: true, connected: true, baseUrl: settings.baseUrl, user: body.user, credits: Number(creditState?.balance ?? body.credits ?? 0), creditState }
      try { await this.configuredProviders(true) } catch {}
      return { ...cachedState, user: cachedState.user ? { ...cachedState.user } : undefined }
    } catch (error) {
      cachedState = { enabled: true, connected: false, baseUrl: settings.baseUrl, message: classifyProviderError(error).message }
      cachedProviders = { at: 0, ids: [] }
      return { ...cachedState }
    }
  },
  async configuredProviders(force = false): Promise<ProviderId[]> {
    if (!store.getSettings().cloud.enabled || !getToken()) { cachedProviders = { at: 0, ids: [] }; return [] }
    if (!force && Date.now() - cachedProviders.at < 60_000) return cachedProviders.ids
    const body = await request('/v1/providers')
    const allowed = new Set<ProviderId>(['openai','anthropic','gemini','xai','deepseek','openrouter','ollama'])
    const ids = (Array.isArray(body.providers) ? body.providers : []).map((x: any) => String(x.id || x)).filter((x: string): x is ProviderId => allowed.has(x as ProviderId))
    cachedProviders = { at: Date.now(), ids }
    return ids
  },
  async canUseProvider(provider: ProviderId) { try { return (await this.configuredProviders()).includes(provider) } catch { return false } },
  async listModels(provider: ProviderId, signal?: AbortSignal): Promise<ProviderModelOption[]> {
    const body = await request(`/v1/providers/${encodeURIComponent(provider)}/models`, { signal })
    return Array.isArray(body.models) ? body.models : []
  },
  async ask(args: { provider: ProviderId; model: string; text: string; image?: Uint8Array; contextImage?: Uint8Array; action?: string; signal?: AbortSignal }): Promise<{ text: string; usage?: AiUsage; requestId?: string; cloudCredits?: number }> {
    const body = await request('/v1/ai/ask', { method: 'POST', signal: args.signal, body: JSON.stringify({ provider: args.provider, model: args.model, text: args.text, action: args.action || 'ask', imageBase64: args.image?.length ? Buffer.from(args.image).toString('base64') : undefined, contextImageBase64: args.contextImage?.length ? Buffer.from(args.contextImage).toString('base64') : undefined }) })
    return { text: String(body.text || ''), usage: body.usage, requestId: body.requestId, cloudCredits: body.creditsCharged }
  },
  async checkout(credits: number) {
    const amount = Math.round(Number(credits))
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) throw new Error('Invalid cloud credit amount')
    return request('/v1/billing/checkout', { method: 'POST', body: JSON.stringify({ credits: amount }) }) as Promise<{ url?: string; sessionId?: string }>
  },
  async credits() {
    const body = await request('/v1/credits')
    return {
      balance: Number(body.balance || 0),
      spent: Number(body.spent || 0),
      purchased: Number(body.purchased || 0),
      entries: (Array.isArray(body.entries) ? body.entries : []).map((row: any) => ({
        id: String(row.id || ''), delta: Number(row.delta || 0), reason: String(row.reason || ''),
        provider: row.provider ? String(row.provider) : undefined, model: row.model ? String(row.model) : undefined,
        createdAt: String(row.createdAt || row.created_at || '')
      }))
    }
  },
  async syncCards(cards: unknown[]) { if (!store.getSettings().cloud.syncCards || !getToken()) return { ok: false, skipped: true }; return request('/v1/cards/sync', { method: 'POST', body: JSON.stringify({ cards }) }) }
}
