import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  AppSettings,
  AuthLoginRequest,
  AuthRegisterRequest,
  AuthState,
  AskRequest,
  BootstrapData,
  Card,
  CapturePayload,
  CaptureRect,
  CompareRequest,
  CreditState,
  Project,
  ProviderId,
  ProviderModelOption,
  ProviderTestResult,
  ProviderDescriptor,
  ProviderAuditEntry,
  ProjectSuggestion,
  SemanticSearchResult,
  SkillMarketplaceItem,
  WorkflowRecommendation,
  WorkflowRule,
  CloudSessionState,
  UpdateState,
  RoutePreview,
  UsageSummary,
  VisualDescriptor,
  CloudCreditState
} from '../shared/types'

type CreditsPayload = { credits: CreditState; usageSummary: UsageSummary }

const api = {
  getAuthState: () => ipcRenderer.invoke('auth:get-state') as Promise<AuthState>,
  registerLocalAccount: (request: AuthRegisterRequest) => ipcRenderer.invoke('auth:register', request) as Promise<AuthState>,
  loginLocal: (request: AuthLoginRequest) => ipcRenderer.invoke('auth:login', request) as Promise<AuthState>,
  loginCloudAccount: (request: { baseUrl: string; email: string; password: string; rememberMe: boolean }) => ipcRenderer.invoke('auth:cloud-login', request) as Promise<AuthState>,
  registerCloudAccount: (request: { baseUrl: string; email: string; displayName: string; password: string; rememberMe: boolean }) => ipcRenderer.invoke('auth:cloud-register', request) as Promise<AuthState>,
  logout: () => ipcRenderer.invoke('auth:logout') as Promise<AuthState>,
  resetLocalAccount: (confirmation: 'RESET') => ipcRenderer.invoke('auth:reset-local', confirmation) as Promise<AuthState>,
  getBootstrap: () => ipcRenderer.invoke('bootstrap:get') as Promise<BootstrapData>,
  updateSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', patch) as Promise<AppSettings>,
  setProviderKey: (provider: ProviderId, key: string) => ipcRenderer.invoke('provider:set-key', provider, key) as Promise<boolean>,
  hasProviderKey: (provider: ProviderId) => ipcRenderer.invoke('provider:has-key', provider) as Promise<boolean>,
  testProvider: (provider: ProviderId) => ipcRenderer.invoke('provider:test', provider) as Promise<ProviderTestResult>,
  listProviderModels: (provider: ProviderId) => ipcRenderer.invoke('provider:list-models', provider) as Promise<ProviderModelOption[]>,
  getProviderDescriptors: () => ipcRenderer.invoke('provider:descriptors') as Promise<ProviderDescriptor[]>,
  getProviderAudit: (provider?: ProviderId) => ipcRenderer.invoke('provider:audit', provider) as Promise<ProviderAuditEntry[]>,
  getLocale: () => ipcRenderer.invoke('ui:get-locale') as Promise<'zh-CN' | 'en-US'>,
  setLocale: (locale: 'zh-CN' | 'en-US') => ipcRenderer.invoke('ui:set-locale', locale) as Promise<'zh-CN' | 'en-US'>,
  previewRoute: (cardId: string, provider: ProviderId | 'auto') => ipcRenderer.invoke('router:preview', cardId, provider) as Promise<RoutePreview>,
  startCapture: () => ipcRenderer.invoke('capture:start') as Promise<void>,
  getPendingCapture: () => ipcRenderer.invoke('capture:get-pending') as Promise<CapturePayload | null>,
  completeCapture: (rect: CaptureRect, renderedDataUrl?: string, visual?: VisualDescriptor) => ipcRenderer.invoke('capture:complete', rect, renderedDataUrl, visual) as Promise<Card>,
  cancelCapture: () => ipcRenderer.invoke('capture:cancel') as Promise<void>,
  getCard: (id: string) => ipcRenderer.invoke('card:get', id) as Promise<Card | null>,
  listCards: () => ipcRenderer.invoke('card:list') as Promise<Card[]>,
  searchCards: (query: string, projectId?: string, favoritesOnly?: boolean) => ipcRenderer.invoke('card:search', query, projectId, favoritesOnly) as Promise<Card[]>,
  searchCardsSemantic: (query: string, projectId?: string, favoritesOnly?: boolean) => ipcRenderer.invoke('card:search-semantic', query, projectId, favoritesOnly) as Promise<SemanticSearchResult[]>,
  suggestProject: (cardId: string) => ipcRenderer.invoke('project:suggest', cardId) as Promise<ProjectSuggestion | null>,
  getCardImage: (id: string, thumbnail = false) => ipcRenderer.invoke('card:image', id, thumbnail) as Promise<string>,
  askCard: (req: AskRequest) => ipcRenderer.invoke('card:ask', req) as Promise<{ card: Card; answer: any; persisted: boolean; route: RoutePreview }>,
  compareCard: (req: CompareRequest) => ipcRenderer.invoke('card:compare', req) as Promise<{ card: Card; answers: any[]; consensus: any | null; persisted: boolean; warning?: string }>,
  updateCard: (id: string, patch: Partial<Card>) => ipcRenderer.invoke('card:update', id, patch) as Promise<Card>,
  deleteCard: (id: string) => ipcRenderer.invoke('card:delete', id) as Promise<boolean>,
  resolveThread: (cardId: string, mode: 'continue' | 'new') => ipcRenderer.invoke('thread:resolve', cardId, mode) as Promise<Card>,
  createProject: (name: string) => ipcRenderer.invoke('project:create', name) as Promise<Project>,
  listProjects: () => ipcRenderer.invoke('project:list') as Promise<Project[]>,
  renameProject: (id: string, name: string) => ipcRenderer.invoke('project:rename', id, name) as Promise<Project>,
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id) as Promise<boolean>,
  openWorkspace: (cardId?: string) => ipcRenderer.invoke('workspace:open', cardId) as Promise<void>,
  closeQuick: (cardId?: string) => ipcRenderer.invoke('quick:close', cardId) as Promise<void>,
  getWorkflowRecommendations: () => ipcRenderer.invoke('workflow:recommendations') as Promise<WorkflowRecommendation[]>,
  listWorkflows: () => ipcRenderer.invoke('workflow:list') as Promise<WorkflowRule[]>,
  createWorkflow: (recommendation: Partial<WorkflowRecommendation> & { name?: string; skillId?: string }) => ipcRenderer.invoke('workflow:create', recommendation) as Promise<WorkflowRule>,
  deleteWorkflow: (id: string) => ipcRenderer.invoke('workflow:delete', id) as Promise<boolean>,
  listSkillMarketplace: () => ipcRenderer.invoke('skill:marketplace-list') as Promise<SkillMarketplaceItem[]>,
  installMarketplaceSkill: (id: string) => ipcRenderer.invoke('skill:marketplace-install', id),
  uninstallMarketplaceSkill: (id: string) => ipcRenderer.invoke('skill:marketplace-uninstall', id) as Promise<boolean>,
  installSkillContent: (content: string) => ipcRenderer.invoke('skill:install-content', content),
  uninstallSkill: (id: string) => ipcRenderer.invoke('skill:uninstall', id) as Promise<boolean>,
  getCloudStatus: () => ipcRenderer.invoke('cloud:status') as Promise<CloudSessionState>,
  registerCloud: (email: string, displayName: string, password: string) => ipcRenderer.invoke('cloud:register', email, displayName, password) as Promise<CloudSessionState>,
  loginCloud: (email: string, password: string) => ipcRenderer.invoke('cloud:login', email, password) as Promise<CloudSessionState>,
  logoutCloud: () => ipcRenderer.invoke('cloud:logout') as Promise<CloudSessionState>,
  checkoutCloudCredits: (amount: number) => ipcRenderer.invoke('cloud:checkout', amount) as Promise<{ url?: string; sessionId?: string }>,
  getCloudCredits: () => ipcRenderer.invoke('cloud:credits') as Promise<CloudCreditState>,
  syncCloudCards: () => ipcRenderer.invoke('cloud:sync-cards'),
  getUpdateStatus: () => ipcRenderer.invoke('update:status') as Promise<UpdateState>,
  checkForUpdates: () => ipcRenderer.invoke('update:check') as Promise<UpdateState>,
  downloadUpdate: () => ipcRenderer.invoke('update:download') as Promise<UpdateState>,
  installUpdate: () => ipcRenderer.invoke('update:install') as Promise<void>,
  getHotkeyStatus: () => ipcRenderer.invoke('hotkey:status') as Promise<{ ok: boolean; hotkey: string; conflict: string }>,
  getCredits: () => ipcRenderer.invoke('credits:get') as Promise<CreditsPayload>,
  addDemoCredits: (amount: number) => ipcRenderer.invoke('credits:add-demo', amount) as Promise<CreditState>,
  redeemDemoCode: (code: string) => ipcRenderer.invoke('credits:redeem-demo', code) as Promise<CreditState>,
  checkoutCredits: (amount: number) => ipcRenderer.invoke('credits:checkout', amount) as Promise<{ url?: string }>,
  syncBillingCredits: () => ipcRenderer.invoke('credits:sync-billing') as Promise<CreditState>,
  getAppInfo: () => ipcRenderer.invoke('app:info') as Promise<AppInfo>,
  openDataDirectory: () => ipcRenderer.invoke('app:open-data') as Promise<string>,
  openLogsDirectory: () => ipcRenderer.invoke('app:open-logs') as Promise<string>,
  copyText: (text: string) => ipcRenderer.invoke('clipboard:copy-text', text) as Promise<boolean>,
  onAuthChanged: (callback: (state: AuthState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AuthState) => callback(state)
    ipcRenderer.on('auth:changed', listener)
    return () => { ipcRenderer.removeListener('auth:changed', listener) }
  },
  onCardChanged: (callback: (card: Card) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, card: Card) => callback(card)
    ipcRenderer.on('card:changed', listener)
    return () => { ipcRenderer.removeListener('card:changed', listener) }
  },
  onCardDeleted: (callback: (cardId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, cardId: string) => callback(cardId)
    ipcRenderer.on('card:deleted', listener)
    return () => { ipcRenderer.removeListener('card:deleted', listener) }
  },
  onCreditsChanged: (callback: (payload: CreditsPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CreditsPayload) => callback(payload)
    ipcRenderer.on('credits:changed', listener)
    return () => { ipcRenderer.removeListener('credits:changed', listener) }
  },
  onSettingsChanged: (callback: (settings: AppSettings) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: AppSettings) => callback(settings)
    ipcRenderer.on('settings:changed', listener)
    return () => { ipcRenderer.removeListener('settings:changed', listener) }
  },
  onWorkspaceSelectCard: (callback: (cardId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, cardId: string) => callback(cardId)
    ipcRenderer.on('workspace:select-card', listener)
    return () => { ipcRenderer.removeListener('workspace:select-card', listener) }
  },
  onWorkspaceNavigate: (callback: (section: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, section: string) => callback(section)
    ipcRenderer.on('workspace:navigate', listener)
    return () => { ipcRenderer.removeListener('workspace:navigate', listener) }
  },
  onHotkeyStatus: (callback: (payload: { ok: boolean; hotkey: string; conflict: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { ok: boolean; hotkey: string; conflict: string }) => callback(payload)
    ipcRenderer.on('hotkey:status', listener)
    return () => { ipcRenderer.removeListener('hotkey:status', listener) }
  },
  onUpdateState: (callback: (state: UpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state)
    ipcRenderer.on('update:state', listener)
    return () => { ipcRenderer.removeListener('update:state', listener) }
  },
  onSkillsChanged: (callback: (skills: any[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, skills: any[]) => callback(skills)
    ipcRenderer.on('skills:changed', listener)
    return () => { ipcRenderer.removeListener('skills:changed', listener) }
  },
  onAppError: (callback: (payload: { code: string; message: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { code: string; message: string }) => callback(payload)
    ipcRenderer.on('app:error', listener)
    return () => { ipcRenderer.removeListener('app:error', listener) }
  }
}

contextBridge.exposeInMainWorld('snapflow', api)

export type SnapflowApi = typeof api
