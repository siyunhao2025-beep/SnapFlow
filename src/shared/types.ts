export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'xai'
  | 'deepseek'
  | 'openrouter'
  | 'ollama'

export type IntentType =
  | 'programming_error'
  | 'code'
  | 'paper'
  | 'scientific_figure'
  | 'chart'
  | 'table'
  | 'excel'
  | 'webpage'
  | 'equation'
  | 'pdf'
  | 'software_ui'
  | 'translation'
  | 'document'
  | 'general'
  | 'unknown'

export type ThemeMode = 'dark' | 'light' | 'system'
export type CloseBehavior = 'tray' | 'quit'
export type Locale = 'zh-CN' | 'en-US'
export type SearchMode = 'lexical' | 'semantic'
export type ProviderErrorCode = 'auth' | 'rate' | 'network' | 'timeout' | 'content' | 'capability' | 'server' | 'unknown'
export type ProviderCapability = 'text' | 'vision' | 'stream' | 'ocr-only' | 'local' | 'models' | 'embedding'

export interface AuthUser {
  id: string
  email: string
  displayName: string
  createdAt: string
}

export interface AuthState {
  authenticated: boolean
  hasLocalAccount: boolean
  rememberMe: boolean
  user: AuthUser | null
  mode?: 'local' | 'cloud'
  cloudBaseUrl?: string
}

export interface AuthRegisterRequest {
  email: string
  displayName: string
  password: string
  rememberMe: boolean
}

export interface AuthLoginRequest {
  email: string
  password: string
  rememberMe: boolean
}

export interface ModelDescriptor {
  id: string
  name: string
  provider: ProviderId
  capabilities: string[]
  vision: boolean
  contextLength?: number
  costWeight: number
  speed: 'fast' | 'balanced' | 'quality'
  enabled: boolean
}

export interface ProviderDescriptor {
  id: ProviderId
  displayName: string
  defaultBaseURL: string
  capabilities: ProviderCapability[]
  defaultModel: string
  speed: 'fast' | 'balanced' | 'quality'
  costWeight: number
  enabledByDefault: boolean
}

export interface RoutePreview {
  provider: ProviderId | null
  model: string
  reason: string
  isAuto: boolean
}

export interface ProviderConfig {
  id: ProviderId
  label: string
  enabled: boolean
  model: string
  baseUrl?: string
  hasKey?: boolean
  supportsVision: boolean
  temperature: number
  maxTokens: number
  timeoutMs: number
  rateLimitPerMinute?: number
}

export interface PrivacySettings {
  screenshotPolicy: 'keep' | 'delete_after_analysis' | 'manual_only'
  saveOcr: boolean
  saveAnswers: boolean
  readAppName: boolean
  readWindowTitle: boolean
  readClipboard: boolean
  readRecentContext: boolean
  autoMaskEmail: boolean
  autoMaskPhone: boolean
  sensitiveAppBlacklist: string[]
}

export interface ScreenshotSettings {
  autoAnalyze: boolean
  playSound: boolean
  showCursor: boolean
  localOcr: boolean
  localOcrEngine: 'auto' | 'windows' | 'tesseract' | 'off'
}

export interface CloudSettings {
  enabled: boolean
  baseUrl: string
  useCloudAuth: boolean
  syncCredits: boolean
  syncCards: boolean
}

export interface UpdateSettings {
  enabled: boolean
  manifestUrl: string
  channel: 'stable' | 'beta'
  autoDownload: boolean
}

export interface AppSettings {
  onboardingComplete: boolean
  onboardingCaptureVerified: boolean
  locale: Locale
  hotkey: string
  autoStart: boolean
  startMinimized: boolean
  closeBehavior: CloseBehavior
  theme: ThemeMode
  shortcutPaused: boolean
  defaultProvider: ProviderId | 'auto'
  routerProvider: ProviderId | 'auto'
  privacy: PrivacySettings
  screenshot: ScreenshotSettings
  providers: Record<ProviderId, ProviderConfig>
  billingServerUrl: string
  demoBillingEnabled: boolean
  deviceId: string
  semanticSearchEnabled: boolean
  learnedWorkflowEnabled: boolean
  projectSuggestionsEnabled: boolean
  marketplaceEnabled: boolean
  marketplaceIndexUrl: string
  workflowRules: WorkflowRule[]
  cloud: CloudSettings
  updates: UpdateSettings
}

export interface IntentResult {
  type: IntentType
  language: string
  confidence: number
  ocrText: string
  summary: string
  actions: string[]
  tags: string[]
}

export interface AiUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  estimated?: boolean
  estimatedCostUsd?: number
}

export interface AiAnswer {
  id: string
  provider: ProviderId | 'mock'
  model: string
  action: string
  text: string
  createdAt: string
  usage?: AiUsage
  credits: number
  isMock?: boolean
  requestId?: string
  latencyMs?: number
}

export interface VisualDescriptor {
  dominantColors: string[]
  averageRgb: { r: number; g: number; b: number }
  brightness: number
  saturation: number
  edgeDensity: number
  aspectRatio: number
  isDark: boolean
}

export interface Card {
  id: string
  createdAt: string
  updatedAt: string
  title: string
  type: IntentType
  appName: string
  windowTitle: string
  screenshotPath: string
  thumbnailPath?: string
  question: string
  ocrText: string
  summary: string
  confidence: number
  actions: string[]
  tags: string[]
  answers: AiAnswer[]
  projectId?: string
  threadId?: string
  previousCardId?: string
  starred: boolean
  semanticVector?: number[]
  imageFingerprint?: string
  visual?: VisualDescriptor
  metadata?: Record<string, unknown>
}

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt?: string
}

export interface ProjectSuggestion {
  projectId: string
  projectName: string
  score: number
  reason: string
}

export interface CreditEntry {
  id: string
  createdAt: string
  delta: number
  reason: string
  cardId?: string
  provider?: ProviderId | 'mock'
  model?: string
  usage?: AiUsage
  source?: 'provider' | 'demo' | 'billing' | 'system' | 'cloud'
}

export interface CreditState {
  balance: number
  spent: number
  /** Total purchased credits already imported from the billing server. */
  billingSynced: number
  entries: CreditEntry[]
}

export interface UsageSummary {
  remaining: number
  today: number
  thisMonth: number
  byModel: Array<{ model: string; provider: string; credits: number; calls: number }>
}

export interface AppInfo {
  version: string
  platform: string
  electronVersion: string
  dataDirectory: string
  logsDirectory: string
  autoUpdate: 'enabled' | 'disabled' | 'not_configured'
}

export interface SkillDefinition {
  id: string
  name: string
  description: string
  supportedIntent: IntentType[]
  preferredModels: string[]
  actions: string[]
  systemPrompt: string
  source?: 'bundled' | 'user' | 'marketplace'
  version?: string
  author?: string
}

export interface SkillMarketplaceItem {
  id: string
  name: string
  description: string
  version: string
  author: string
  downloadUrl?: string
  bundledContent?: string
  installed: boolean
}

export interface ProviderModelOption {
  id: string
  name?: string
  vision?: boolean
  contextLength?: number
}

export interface ProviderTestResult {
  ok: boolean
  provider: ProviderId
  model: string
  message: string
  latencyMs: number
  requestId?: string
  errorCode?: ProviderErrorCode
}

export interface ProviderAuditEntry {
  ts: string
  provider: ProviderId
  model: string
  action: string
  status: 'ok' | 'error'
  httpStatus?: number
  latencyMs: number
  errorCode?: ProviderErrorCode
  requestId?: string
  promptTokens?: number
  completionTokens?: number
  vision: boolean
  imageHash?: string
  textSnippetRedacted: string
}

export interface WorkflowRule {
  id: string
  name: string
  intent: IntentType
  provider: ProviderId | 'auto'
  action: string
  skillId?: string
  enabled: boolean
  usageCount: number
  createdAt: string
}

export interface WorkflowRecommendation {
  signature: string
  intent: IntentType
  provider: ProviderId
  action: string
  count: number
  suggestedName: string
}

export interface SemanticSearchResult {
  card: Card
  score: number
  reasons: string[]
}

export interface CloudCreditState {
  balance: number
  spent: number
  purchased: number
  entries: Array<{ id: string; delta: number; reason: string; provider?: string; model?: string; createdAt: string }>
}

export interface CloudSessionState {
  enabled: boolean
  connected: boolean
  baseUrl: string
  user?: { id: string; email: string; displayName: string }
  credits?: number
  creditState?: CloudCreditState
  message?: string
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'disabled'
  version?: string
  progress?: number
  message?: string
}

export interface BootstrapData {
  auth: AuthState
  settings: AppSettings
  cards: Card[]
  projects: Project[]
  credits: CreditState
  usageSummary: UsageSummary
  models: ModelDescriptor[]
  providerDescriptors?: ProviderDescriptor[]
  skills: SkillDefinition[]
  appInfo: AppInfo
  demoMode: boolean
  cloud?: CloudSessionState
  updates?: UpdateState
}

export interface CapturePayload {
  dataUrl: string
  displayBounds: { x: number; y: number; width: number; height: number }
  displayScaleFactor: number
  appName: string
  windowTitle: string
  cursorPosition?: { x: number; y: number }
}

export interface CaptureRect {
  x: number
  y: number
  width: number
  height: number
}

export interface AskRequest {
  cardId: string
  action: string
  prompt?: string
  provider: ProviderId | 'auto'
  model?: string
  skillId?: string
}

export interface CompareRequest {
  cardId: string
  action: string
  prompt?: string
  providers: Array<{ provider: ProviderId; model?: string }>
}

export interface ThreadSuggestion {
  candidateCardId: string
  threadId: string
  title: string
  appName: string
  windowTitle: string
  createdAt: string
}

export interface AskDelta {
  type: 'text' | 'usage' | 'done'
  text?: string
  usage?: AiUsage
}
