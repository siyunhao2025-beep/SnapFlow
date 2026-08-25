import { cardMatchesSearch } from '../shared/search'
import { cardSemanticText, localSemanticVector, searchCardsSemantic } from '../shared/semantic'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import type {
  AppSettings,
  BootstrapData,
  Card,
  CreditEntry,
  CreditState,
  Project,
  ProviderId,
  ProviderConfig,
  UsageSummary
} from '../shared/types'
import { getSnapFlowPaths } from './paths'
import { logger } from './logger'
import { modelRegistry } from './models'
import { listSkills } from './skills'

export type StoredAuthAccount = {
  id: string
  email: string
  displayName: string
  passwordHash: string
  passwordSalt: string
  createdAt: string
  updatedAt: string
}

type StoredAuthState = {
  account: StoredAuthAccount | null
  rememberedUserId: string
  rememberTokenHash: string
  rememberTokenEncrypted: string
}

type DbShape = {
  settings: AppSettings
  cards: Card[]
  projects: Project[]
  credits: CreditState
  secrets: Partial<Record<ProviderId, string>>
  redeemedCodes: string[]
  auth: StoredAuthState
}

const providerDefaults: AppSettings['providers'] = {
  openai: {
    id: 'openai', label: 'ChatGPT / OpenAI Compatible', enabled: true,
    model: 'gpt-5.6-luna', baseUrl: 'https://api.openai.com/v1', supportsVision: true,
    temperature: 0.2, maxTokens: 4096, timeoutMs: 90000
  },
  anthropic: {
    id: 'anthropic', label: 'Claude', enabled: true,
    model: 'claude-sonnet-4-20250514', baseUrl: 'https://api.anthropic.com/v1', supportsVision: true,
    temperature: 0.2, maxTokens: 4096, timeoutMs: 90000
  },
  gemini: {
    id: 'gemini', label: 'Gemini', enabled: true,
    model: 'gemini-3.7-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', supportsVision: true,
    temperature: 0.2, maxTokens: 4096, timeoutMs: 90000
  },
  xai: {
    id: 'xai', label: 'Grok / xAI', enabled: false,
    model: 'grok-4.6', baseUrl: 'https://api.x.ai/v1', supportsVision: true,
    temperature: 0.2, maxTokens: 4096, timeoutMs: 90000
  },
  deepseek: {
    id: 'deepseek', label: 'DeepSeek', enabled: false,
    model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com', supportsVision: false,
    temperature: 0.2, maxTokens: 4096, timeoutMs: 90000
  },
  openrouter: {
    id: 'openrouter', label: 'OpenRouter', enabled: false,
    model: 'openai/gpt-5.6-luna', baseUrl: 'https://openrouter.ai/api/v1', supportsVision: true,
    temperature: 0.2, maxTokens: 4096, timeoutMs: 90000
  },
  ollama: {
    id: 'ollama', label: 'Ollama 本地模型', enabled: false,
    model: 'llava:latest', baseUrl: 'http://127.0.0.1:11434', supportsVision: true,
    temperature: 0.2, maxTokens: 4096, timeoutMs: 120000
  }
}

function defaultSettings(): AppSettings {
  return {
    onboardingComplete: false,
    onboardingCaptureVerified: false,
    locale: 'zh-CN',
    hotkey: 'Alt+A',
    autoStart: true,
    startMinimized: true,
    closeBehavior: 'tray',
    theme: 'dark',
    shortcutPaused: false,
    defaultProvider: 'auto',
    routerProvider: 'auto',
    privacy: {
      screenshotPolicy: 'keep',
      saveOcr: true,
      saveAnswers: true,
      readAppName: true,
      readWindowTitle: true,
      readClipboard: false,
      readRecentContext: false,
      autoMaskEmail: true,
      autoMaskPhone: true,
      sensitiveAppBlacklist: ['1Password', 'Bitwarden', 'KeePass', 'Password', 'Bank', '银行']
    },
    screenshot: {
      autoAnalyze: true,
      playSound: false,
      showCursor: false,
      localOcr: true,
      localOcrEngine: 'auto'
    },
    providers: structuredClone(providerDefaults),
    billingServerUrl: '',
    demoBillingEnabled: true,
    semanticSearchEnabled: true,
    learnedWorkflowEnabled: true,
    projectSuggestionsEnabled: true,
    marketplaceEnabled: true,
    marketplaceIndexUrl: '',
    workflowRules: [],
    cloud: { enabled: false, baseUrl: '', useCloudAuth: false, syncCredits: true, syncCards: false },
    updates: { enabled: false, manifestUrl: '', channel: 'stable', autoDownload: false },
    deviceId: `device_${randomUUID().replace(/-/g, '').slice(0, 14)}`
  }
}

function defaultDb(): DbShape {
  return {
    settings: defaultSettings(),
    cards: [],
    projects: [],
    credits: {
      balance: 100,
      spent: 0,
      billingSynced: 0,
      entries: [{
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        delta: 100,
        reason: 'Demo welcome credits',
        source: 'demo'
      }]
    },
    secrets: {},
    redeemedCodes: [],
    auth: { account: null, rememberedUserId: '', rememberTokenHash: '', rememberTokenEncrypted: '' }
  }
}

function dayStart(now = new Date()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function monthStart(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), 1)
  return d.getTime()
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function sanitizeCreditState(raw: Partial<CreditState> | undefined, fallback: CreditState): CreditState {
  const entries = Array.isArray(raw?.entries)
    ? raw!.entries.filter((entry): entry is CreditEntry => Boolean(entry && typeof entry === 'object' && Number.isFinite(Number((entry as CreditEntry).delta)))).slice(0, 1000)
    : fallback.entries
  return {
    balance: finiteNumber(raw?.balance, fallback.balance, 0, 100_000_000),
    spent: finiteNumber(raw?.spent, fallback.spent, 0, 100_000_000),
    billingSynced: finiteNumber(raw?.billingSynced, fallback.billingSynced, 0, 100_000_000),
    entries
  }
}

function sanitizeStoredAccount(raw: unknown): StoredAuthAccount | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Partial<StoredAuthAccount>
  if (
    typeof value.id !== 'string' || !/^user_[A-Za-z0-9_-]{8,100}$/.test(value.id) ||
    typeof value.email !== 'string' || value.email.length > 254 ||
    typeof value.displayName !== 'string' || !value.displayName.trim() || value.displayName.length > 80 ||
    typeof value.passwordHash !== 'string' || !/^[0-9a-f]{128}$/i.test(value.passwordHash) ||
    typeof value.passwordSalt !== 'string' || !/^[0-9a-f]{32}$/i.test(value.passwordSalt)
  ) return null
  return {
    id: value.id,
    email: value.email,
    displayName: value.displayName,
    passwordHash: value.passwordHash,
    passwordSalt: value.passwordSalt,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString()
  }
}

function sanitizeProviderConfig(id: ProviderId, config: Partial<ProviderConfig> | undefined): ProviderConfig {
  const fallback = providerDefaults[id]
  const raw = config ?? {}
  let model = typeof raw.model === 'string' ? raw.model.trim().slice(0, 200) : ''
  // Migrate only SnapFlow's former DeepSeek default. User-specified custom model IDs are preserved.
  if (id === 'deepseek' && model === 'deepseek-chat') model = 'deepseek-v4-pro'
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim().slice(0, 2048) : fallback.baseUrl
  return {
    id,
    label: fallback.label,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    model: model || fallback.model,
    baseUrl: baseUrl || fallback.baseUrl,
    supportsVision: typeof raw.supportsVision === 'boolean' ? raw.supportsVision : fallback.supportsVision,
    temperature: finiteNumber(raw.temperature, fallback.temperature, 0, 2),
    maxTokens: Math.round(finiteNumber(raw.maxTokens, fallback.maxTokens, 128, 1_000_000)),
    timeoutMs: Math.round(finiteNumber(raw.timeoutMs, fallback.timeoutMs, 3_000, 600_000))
  }
}

function sanitizeProviders(providers: Partial<AppSettings['providers']> | undefined): AppSettings['providers'] {
  return Object.fromEntries((Object.keys(providerDefaults) as ProviderId[]).map((id) => [
    id,
    sanitizeProviderConfig(id, providers?.[id])
  ])) as AppSettings['providers']
}

class SnapStore {
  private dbPath = ''
  private data: DbShape = defaultDb()

  init(allowBackupRestore = true) {
    const paths = getSnapFlowPaths()
    this.dbPath = path.join(paths.database, 'snapflow.json')

    // v0.1 migration: keep user data and move the DB into the production directory layout.
    const legacy = path.join(app.getPath('userData'), 'snapflow.json')
    if (!fs.existsSync(this.dbPath) && fs.existsSync(legacy)) {
      try {
        fs.copyFileSync(legacy, this.dbPath)
        logger.info('Migrated legacy database', { from: legacy, to: this.dbPath })
      } catch (error) {
        logger.error('Legacy database migration failed', { error: String(error) })
      }
    }

    if (!fs.existsSync(this.dbPath)) {
      this.flush()
      return
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.dbPath, 'utf8')) as Partial<DbShape>
      const defaults = defaultDb()
      this.data = {
        ...defaults,
        ...parsed,
        settings: {
          ...defaults.settings,
          ...(parsed.settings ?? {}),
          locale: parsed.settings?.locale === 'en-US' ? 'en-US' : 'zh-CN',
          privacy: { ...defaults.settings.privacy, ...(parsed.settings?.privacy ?? {}), readRecentContext: false, sensitiveAppBlacklist: Array.isArray(parsed.settings?.privacy?.sensitiveAppBlacklist) ? parsed.settings!.privacy.sensitiveAppBlacklist.filter((x): x is string => typeof x === 'string').slice(0, 100) : defaults.settings.privacy.sensitiveAppBlacklist },
          screenshot: { ...defaults.settings.screenshot, ...(parsed.settings?.screenshot ?? {}), localOcrEngine: ['auto','windows','tesseract','off'].includes(String(parsed.settings?.screenshot?.localOcrEngine)) ? parsed.settings!.screenshot.localOcrEngine : defaults.settings.screenshot.localOcrEngine },
          cloud: { ...defaults.settings.cloud, ...(parsed.settings?.cloud ?? {}) },
          updates: { ...defaults.settings.updates, ...(parsed.settings?.updates ?? {}) },
          workflowRules: Array.isArray(parsed.settings?.workflowRules) ? parsed.settings!.workflowRules.slice(0, 100) : [],
          providers: Object.fromEntries(
            (Object.keys(defaults.settings.providers) as ProviderId[]).map((id) => [
              id,
              sanitizeProviderConfig(id, { ...defaults.settings.providers[id], ...(parsed.settings?.providers?.[id] ?? {}) })
            ])
          ) as AppSettings['providers']
        },
        cards: (Array.isArray(parsed.cards) ? parsed.cards : []).map((card) => ({
          ...card,
          updatedAt: card.updatedAt || card.createdAt || new Date().toISOString(),
          title: card.title || card.summary || 'Screenshot',
          type: card.type || 'unknown',
          appName: card.appName || '',
          windowTitle: card.windowTitle || '',
          screenshotPath: card.screenshotPath || '',
          question: card.question || '',
          ocrText: card.ocrText || '',
          summary: card.summary || '',
          confidence: Number.isFinite(card.confidence) ? card.confidence : 0,
          actions: Array.isArray(card.actions) ? card.actions : [],
          tags: Array.isArray(card.tags) ? card.tags : [],
          answers: Array.isArray(card.answers) ? card.answers : [],
          starred: Boolean(card.starred),
          metadata: card.metadata ?? {}
        } as Card)),
        projects: (Array.isArray(parsed.projects) ? parsed.projects : []).map((project) => ({ ...project, updatedAt: project.updatedAt || project.createdAt })),
        credits: sanitizeCreditState(parsed.credits, defaults.credits),
        secrets: parsed.secrets && typeof parsed.secrets === 'object' && !Array.isArray(parsed.secrets) ? parsed.secrets : {},
        redeemedCodes: Array.isArray(parsed.redeemedCodes) ? parsed.redeemedCodes.filter((code): code is string => typeof code === 'string').slice(0, 1000) : [],
        auth: {
          account: sanitizeStoredAccount(parsed.auth?.account),
          rememberedUserId: typeof parsed.auth?.rememberedUserId === 'string' ? parsed.auth.rememberedUserId : '',
          rememberTokenHash: typeof parsed.auth?.rememberTokenHash === 'string' ? parsed.auth.rememberTokenHash : '',
          rememberTokenEncrypted: typeof parsed.auth?.rememberTokenEncrypted === 'string' ? parsed.auth.rememberTokenEncrypted : ''
        }
      }
      this.flush()
    } catch (error) {
      const rollingBackup = `${this.dbPath}.bak`
      try {
        if (allowBackupRestore && fs.existsSync(rollingBackup)) {
          // Restore once for both malformed JSON and structurally invalid primary data.
          // The recursive load disables a second restore attempt so a valid-JSON but
          // structurally corrupt backup can never cause an infinite recovery loop.
          JSON.parse(fs.readFileSync(rollingBackup, 'utf8'))
          fs.copyFileSync(rollingBackup, this.dbPath)
          logger.warn('Primary database was invalid; restored the last rolling backup', { error: String(error) })
          this.init(false)
          return
        }
      } catch (backupError) {
        logger.error('Rolling database backup could not be restored', { error: String(backupError) })
      }
      const quarantine = `${this.dbPath}.corrupt.${Date.now()}`
      try { fs.copyFileSync(this.dbPath, quarantine) } catch {}
      this.data = defaultDb()
      this.flush()
      logger.error('Database and rolling backup were invalid; created a clean database', { quarantine, error: String(error) })
    }
  }

  private flush() {
    if (!this.dbPath) return
    const temp = `${this.dbPath}.tmp`
    const backup = `${this.dbPath}.bak`
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true })
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8')
    try {
      if (fs.existsSync(this.dbPath)) fs.copyFileSync(this.dbPath, backup)
      fs.renameSync(temp, this.dbPath)
    } catch (error) {
      try {
        fs.copyFileSync(temp, this.dbPath)
        fs.unlinkSync(temp)
      } catch {
        throw error
      }
    }
  }

  bootstrap(): Omit<BootstrapData, 'appInfo' | 'auth'> {
    return {
      settings: structuredClone(this.data.settings),
      cards: structuredClone(this.data.cards.slice(0, 1000)),
      projects: structuredClone(this.data.projects),
      credits: structuredClone(this.data.credits),
      usageSummary: this.getUsageSummary(),
      models: structuredClone(modelRegistry),
      skills: listSkills(),
      demoMode: !this.hasAnyConfiguredProvider()
    }
  }

  getAuthRecord() { return structuredClone(this.data.auth) }

  setAuthAccount(account: StoredAuthAccount) {
    this.data.auth.account = structuredClone(account)
    this.flush()
    return structuredClone(account)
  }

  resetAuthAccount() {
    this.data.auth = { account: null, rememberedUserId: '', rememberTokenHash: '', rememberTokenEncrypted: '' }
    // A password-reset flow is intentionally possible without knowing the old password so
    // users cannot be locked out of local workspace data. Provider credentials are secrets,
    // however, and must not survive that bypass path: otherwise a different local user could
    // reset the account and spend the previous owner's API credentials.
    this.data.secrets = {}
    this.flush()
  }

  setRememberedSession(userId: string, tokenHash: string, encryptedToken: string) {
    this.data.auth.rememberedUserId = userId
    this.data.auth.rememberTokenHash = tokenHash
    this.data.auth.rememberTokenEncrypted = encryptedToken
    this.flush()
  }

  clearRememberedSession() {
    const auth = this.data.auth
    if (!auth.rememberedUserId && !auth.rememberTokenHash && !auth.rememberTokenEncrypted) return
    auth.rememberedUserId = ''
    auth.rememberTokenHash = ''
    auth.rememberTokenEncrypted = ''
    this.flush()
  }

  getSettings() { return structuredClone(this.data.settings) }

  updateSettings(patch: Partial<AppSettings>) {
    patch = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
    const current = this.data.settings
    const validProvider = (value: unknown): value is ProviderId | 'auto' => value === 'auto' || (typeof value === 'string' && value in providerDefaults)
    const hotkey = typeof patch.hotkey === 'string' && patch.hotkey.trim() ? patch.hotkey.trim().slice(0, 64) : current.hotkey
    const screenshotPolicy = patch.privacy?.screenshotPolicy
    const validPolicy = screenshotPolicy === 'keep' || screenshotPolicy === 'delete_after_analysis' || screenshotPolicy === 'manual_only'
    const nextPolicy: AppSettings['privacy']['screenshotPolicy'] = validPolicy ? screenshotPolicy : current.privacy.screenshotPolicy
    this.data.settings = {
      ...current,
      onboardingComplete: typeof patch.onboardingComplete === 'boolean' ? patch.onboardingComplete : current.onboardingComplete,
      onboardingCaptureVerified: typeof patch.onboardingCaptureVerified === 'boolean' ? patch.onboardingCaptureVerified : current.onboardingCaptureVerified,
      locale: patch.locale === 'en-US' || patch.locale === 'zh-CN' ? patch.locale : current.locale,
      hotkey,
      autoStart: typeof patch.autoStart === 'boolean' ? patch.autoStart : current.autoStart,
      startMinimized: typeof patch.startMinimized === 'boolean' ? patch.startMinimized : current.startMinimized,
      closeBehavior: patch.closeBehavior === 'quit' || patch.closeBehavior === 'tray' ? patch.closeBehavior : current.closeBehavior,
      theme: patch.theme === 'dark' || patch.theme === 'light' || patch.theme === 'system' ? patch.theme : current.theme,
      shortcutPaused: typeof patch.shortcutPaused === 'boolean' ? patch.shortcutPaused : current.shortcutPaused,
      defaultProvider: validProvider(patch.defaultProvider) ? patch.defaultProvider : current.defaultProvider,
      routerProvider: validProvider(patch.routerProvider) ? patch.routerProvider : current.routerProvider,
      privacy: {
        ...current.privacy,
        screenshotPolicy: nextPolicy,
        saveOcr: typeof patch.privacy?.saveOcr === 'boolean' ? patch.privacy.saveOcr : current.privacy.saveOcr,
        saveAnswers: typeof patch.privacy?.saveAnswers === 'boolean' ? patch.privacy.saveAnswers : current.privacy.saveAnswers,
        readAppName: typeof patch.privacy?.readAppName === 'boolean' ? patch.privacy.readAppName : current.privacy.readAppName,
        readWindowTitle: typeof patch.privacy?.readWindowTitle === 'boolean' ? patch.privacy.readWindowTitle : current.privacy.readWindowTitle,
        readClipboard: typeof patch.privacy?.readClipboard === 'boolean' ? patch.privacy.readClipboard : current.privacy.readClipboard,
        readRecentContext: false,
        autoMaskEmail: typeof patch.privacy?.autoMaskEmail === 'boolean' ? patch.privacy.autoMaskEmail : current.privacy.autoMaskEmail,
        autoMaskPhone: typeof patch.privacy?.autoMaskPhone === 'boolean' ? patch.privacy.autoMaskPhone : current.privacy.autoMaskPhone,
        sensitiveAppBlacklist: Array.isArray(patch.privacy?.sensitiveAppBlacklist) ? patch.privacy!.sensitiveAppBlacklist.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 100) : current.privacy.sensitiveAppBlacklist
      },
      screenshot: {
        autoAnalyze: typeof patch.screenshot?.autoAnalyze === 'boolean' ? patch.screenshot.autoAnalyze : current.screenshot.autoAnalyze,
        playSound: typeof patch.screenshot?.playSound === 'boolean' ? patch.screenshot.playSound : current.screenshot.playSound,
        showCursor: typeof patch.screenshot?.showCursor === 'boolean' ? patch.screenshot.showCursor : current.screenshot.showCursor,
        localOcr: typeof patch.screenshot?.localOcr === 'boolean' ? patch.screenshot.localOcr : current.screenshot.localOcr,
        localOcrEngine: patch.screenshot?.localOcrEngine && ['auto','windows','tesseract','off'].includes(patch.screenshot.localOcrEngine) ? patch.screenshot.localOcrEngine : current.screenshot.localOcrEngine
      },
      providers: patch.providers
        ? sanitizeProviders(Object.fromEntries((Object.keys(current.providers) as ProviderId[]).map((id) => [
            id,
            { ...current.providers[id], ...(patch.providers?.[id] ?? {}) }
          ])) as AppSettings['providers'])
        : sanitizeProviders(current.providers),
      billingServerUrl: typeof patch.billingServerUrl === 'string' ? patch.billingServerUrl.trim().slice(0, 2048) : current.billingServerUrl,
      demoBillingEnabled: typeof patch.demoBillingEnabled === 'boolean' ? patch.demoBillingEnabled : current.demoBillingEnabled,
      semanticSearchEnabled: typeof patch.semanticSearchEnabled === 'boolean' ? patch.semanticSearchEnabled : current.semanticSearchEnabled,
      learnedWorkflowEnabled: typeof patch.learnedWorkflowEnabled === 'boolean' ? patch.learnedWorkflowEnabled : current.learnedWorkflowEnabled,
      projectSuggestionsEnabled: typeof patch.projectSuggestionsEnabled === 'boolean' ? patch.projectSuggestionsEnabled : current.projectSuggestionsEnabled,
      marketplaceEnabled: typeof patch.marketplaceEnabled === 'boolean' ? patch.marketplaceEnabled : current.marketplaceEnabled,
      marketplaceIndexUrl: typeof patch.marketplaceIndexUrl === 'string' ? patch.marketplaceIndexUrl.trim().slice(0, 2048) : current.marketplaceIndexUrl,
      workflowRules: Array.isArray(patch.workflowRules) ? patch.workflowRules.slice(0, 100) : current.workflowRules,
      cloud: {
        ...current.cloud,
        ...(patch.cloud ?? {}),
        enabled: typeof patch.cloud?.enabled === 'boolean' ? patch.cloud.enabled : current.cloud.enabled,
        baseUrl: typeof patch.cloud?.baseUrl === 'string' ? patch.cloud.baseUrl.trim().slice(0, 2048) : current.cloud.baseUrl,
        useCloudAuth: typeof patch.cloud?.useCloudAuth === 'boolean' ? patch.cloud.useCloudAuth : current.cloud.useCloudAuth,
        syncCredits: typeof patch.cloud?.syncCredits === 'boolean' ? patch.cloud.syncCredits : current.cloud.syncCredits,
        syncCards: typeof patch.cloud?.syncCards === 'boolean' ? patch.cloud.syncCards : current.cloud.syncCards
      },
      updates: {
        ...current.updates,
        ...(patch.updates ?? {}),
        enabled: typeof patch.updates?.enabled === 'boolean' ? patch.updates.enabled : current.updates.enabled,
        manifestUrl: typeof patch.updates?.manifestUrl === 'string' ? patch.updates.manifestUrl.trim().slice(0, 2048) : current.updates.manifestUrl,
        channel: patch.updates?.channel === 'beta' ? 'beta' : patch.updates?.channel === 'stable' ? 'stable' : current.updates.channel,
        autoDownload: typeof patch.updates?.autoDownload === 'boolean' ? patch.updates.autoDownload : current.updates.autoDownload
      },
      // Device ID is generated and owned by the main process; renderer patches may not replace it.
      deviceId: current.deviceId
    }
    this.flush()
    return this.getSettings()
  }

  setSecret(provider: ProviderId, encrypted: string) {
    if (encrypted) this.data.secrets[provider] = encrypted
    else delete this.data.secrets[provider]
    this.flush()
  }
  getEncryptedSecret(provider: ProviderId) { return this.data.secrets[provider] }
  hasStoredSecret(provider: ProviderId) { return Boolean(this.data.secrets[provider]) }
  hasAnyConfiguredProvider() {
    return (Object.keys(this.data.settings.providers) as ProviderId[]).some((id) =>
      this.data.settings.providers[id].enabled && (id === 'ollama' || this.hasStoredSecret(id))
    )
  }

  createCard(card: Card) {
    const enriched = { ...card, semanticVector: card.semanticVector?.length ? card.semanticVector : localSemanticVector(cardSemanticText(card)) }
    this.data.cards.unshift(enriched); this.flush(); return structuredClone(enriched)
  }
  getCard(id: string) { const card = this.data.cards.find((x) => x.id === id); return card ? structuredClone(card) : null }
  updateCard(id: string, patch: Partial<Card>) {
    const index = this.data.cards.findIndex((x) => x.id === id)
    if (index < 0) return null
    this.data.cards[index] = { ...this.data.cards[index], ...patch, updatedAt: new Date().toISOString() }
    this.data.cards[index].semanticVector = localSemanticVector(cardSemanticText(this.data.cards[index]))
    this.flush()
    return structuredClone(this.data.cards[index])
  }
  deleteCard(id: string) {
    const index = this.data.cards.findIndex((x) => x.id === id)
    if (index < 0) return null
    const [card] = this.data.cards.splice(index, 1)
    for (const item of this.data.cards) {
      if (item.previousCardId === id) item.previousCardId = undefined
    }
    this.flush()
    return structuredClone(card)
  }
  listCards() { return structuredClone(this.data.cards.slice(0, 1000)) }

  searchCards(query: string, projectId?: string, favoritesOnly = false) {
    const q = query.trim().toLowerCase()
    const projectNames = new Map(this.data.projects.map((p) => [p.id, p.name]))
    return structuredClone(this.data.cards.filter((card) => {
      if (projectId && card.projectId !== projectId) return false
      if (favoritesOnly && !card.starred) return false
      if (!q) return true
      return cardMatchesSearch(card, q, card.projectId ? projectNames.get(card.projectId) || '' : '')
    }))
  }


  searchCardsSemantic(query: string, projectId?: string, favoritesOnly = false) {
    const cards = this.data.cards.filter((card) => (!projectId || card.projectId === projectId) && (!favoritesOnly || card.starred))
    return structuredClone(searchCardsSemantic(cards, query))
  }

  suggestProjectForCard(cardId: string) {
    const card = this.data.cards.find((x) => x.id === cardId)
    if (!card || !this.data.projects.length) return null
    const target = card.semanticVector?.length ? card.semanticVector : localSemanticVector(cardSemanticText(card))
    let best: { projectId: string; projectName: string; score: number; reason: string } | null = null
    for (const project of this.data.projects) {
      const peers = this.data.cards.filter((x) => x.projectId === project.id && x.id !== card.id).slice(0, 50)
      if (!peers.length) continue
      const joined = [project.name, ...peers.map(cardSemanticText)].join('\n')
      const pv = localSemanticVector(joined)
      let dot = 0
      for (let i = 0; i < Math.min(target.length, pv.length); i++) dot += target[i] * pv[i]
      const score = Math.max(0, dot)
      if (!best || score > best.score) best = { projectId: project.id, projectName: project.name, score, reason: 'semantic-history' }
    }
    return best && best.score >= .12 ? structuredClone(best) : null
  }

  createProject(name: string) {
    const clean = name.trim().slice(0, 120)
    if (!clean) throw new Error('项目名称不能为空')
    const project: Project = { id: randomUUID(), name: clean, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    this.data.projects.unshift(project); this.flush(); return structuredClone(project)
  }
  renameProject(id: string, name: string) {
    const project = this.data.projects.find((p) => p.id === id)
    if (!project) throw new Error('Project 不存在')
    const clean = name.trim().slice(0, 120)
    if (!clean) throw new Error('项目名称不能为空')
    project.name = clean; project.updatedAt = new Date().toISOString(); this.flush(); return structuredClone(project)
  }
  deleteProject(id: string) {
    const index = this.data.projects.findIndex((p) => p.id === id)
    if (index < 0) return false
    this.data.projects.splice(index, 1)
    for (const card of this.data.cards) {
      if (card.projectId === id) card.projectId = undefined
      if (card.metadata?.suggestedProjectId === id) card.metadata = { ...card.metadata, suggestedProjectId: '' }
    }
    this.flush(); return true
  }
  listProjects() { return structuredClone(this.data.projects) }

  getCredits() { return structuredClone(this.data.credits) }
  addCreditEntry(entry: Omit<CreditEntry, 'id' | 'createdAt'>) {
    const full: CreditEntry = { id: randomUUID(), createdAt: new Date().toISOString(), ...entry }
    this.data.credits.balance += entry.delta
    if (entry.delta < 0) this.data.credits.spent += Math.abs(entry.delta)
    this.data.credits.entries.unshift(full)
    this.data.credits.entries = this.data.credits.entries.slice(0, 1000)
    this.flush(); return this.getCredits()
  }
  redeemDemoCode(code: string, value: number) {
    const normalized = code.trim().toUpperCase()
    if (this.data.redeemedCodes.includes(normalized)) throw new Error('该兑换码已使用')
    this.data.redeemedCodes.push(normalized)
    return this.addCreditEntry({ delta: value, reason: `Demo redemption · ${normalized}`, source: 'demo' })
  }
  syncBillingTotal(remoteTotal: number) {
    const parsed = Number(remoteTotal)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000_000) throw new Error('Billing Server 返回的积分总额无效')
    const safeTotal = Math.floor(parsed)
    const already = Math.max(0, Math.floor(this.data.credits.billingSynced || 0))
    const delta = safeTotal - already
    if (delta <= 0) return this.getCredits()
    this.data.credits.billingSynced = safeTotal
    return this.addCreditEntry({ delta, reason: 'Stripe 充值到账', source: 'billing' })
  }
  hasEnoughCredits(cost: number) { return this.data.credits.balance >= cost }

  getUsageSummary(): UsageSummary {
    const now = new Date()
    const today = dayStart(now)
    const month = monthStart(now)
    let todaySpent = 0
    let monthSpent = 0
    const byModel = new Map<string, { model: string; provider: string; credits: number; calls: number }>()
    for (const entry of this.data.credits.entries) {
      if (entry.delta >= 0) continue
      const timestamp = new Date(entry.createdAt).getTime()
      const amount = Math.abs(entry.delta)
      if (timestamp >= today) todaySpent += amount
      if (timestamp >= month) monthSpent += amount
      const key = `${entry.provider || 'unknown'}:${entry.model || 'unknown'}`
      const current = byModel.get(key) || { model: entry.model || 'Unknown', provider: entry.provider || 'unknown', credits: 0, calls: 0 }
      current.credits += amount; current.calls += 1; byModel.set(key, current)
    }
    return {
      remaining: this.data.credits.balance,
      today: todaySpent,
      thisMonth: monthSpent,
      byModel: [...byModel.values()].sort((a, b) => b.credits - a.credits)
    }
  }
}

export const store = new SnapStore()
