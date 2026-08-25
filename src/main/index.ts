import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray
} from 'electron'
import type {
  AiAnswer,
  AppInfo,
  AuthLoginRequest,
  AuthRegisterRequest,
  AuthState,
  AppSettings,
  AskRequest,
  Card,
  CompareRequest,
  ProviderId
} from '../shared/types'
import {
  cancelCapture,
  closeQuickWindow,
  completeCapture,
  getPendingCapture,
  getQuickCardId,
  startCapture
} from './capture'
import { authService } from './auth'
import { estimateCredits } from './credits'
import { logger } from './logger'
import { getSnapFlowPaths } from './paths'
import {
  callMockProvider,
  callProvider,
  encryptSecret,
  listProviderModels,
  providerHasCredential,
  providerUsesCloud,
  providerDescriptors,
  testProvider
} from './providers'
import {
  buildActionPrompt,
  buildConsensusPrompt,
  refineIntent,
  selectProviderDetailed
} from './router'
import { getSkill, installSkillContent, listSkills, uninstallUserSkill } from './skills'
import { listMarketplace, installMarketplaceSkill, uninstallMarketplaceSkill } from './skill-marketplace'
import { readRecentProviderAudit } from './audit-log'
import { runLocalOcr } from './local-ocr'
import { cloudService } from './cloud'
import { updaterService } from './updater'
import { redactSensitiveText } from '../shared/privacy'
import { deriveWorkflowRecommendations } from '../shared/workflow'
import { store } from './store'
import { sanitizeRendererCardPatch } from '../shared/card-patch'
import { shouldRequireVisionForCard } from '../shared/model-router'
import { classifyProviderError } from '../shared/errors'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let registeredHotkey = ''
let quitting = false
let ipcRegistered = false
let reservedCredits = 0
let hotkeyConflict = ''

const preloadPath = path.join(__dirname, '../preload/index.js')
const hasSingleInstanceLock = app.requestSingleInstanceLock()
const smokeTestMode = process.argv.includes('--smoke-test')
const providerIds = new Set<ProviderId>(['openai', 'anthropic', 'gemini', 'xai', 'deepseek', 'openrouter', 'ollama'])

function uiText(zh: string, en: string) {
  return store.getSettings().locale === 'en-US' ? en : zh
}

function cloudAuthState(state = cloudService.getCachedState()): AuthState {
  const user = state.connected && state.user ? {
    id: state.user.id,
    email: state.user.email,
    displayName: state.user.displayName,
    createdAt: ''
  } : null
  return {
    authenticated: Boolean(user),
    hasLocalAccount: Boolean(store.getAuthRecord().account),
    rememberMe: cloudService.isRemembered(),
    user,
    mode: user ? 'cloud' : undefined,
    cloudBaseUrl: store.getSettings().cloud.baseUrl
  }
}

function effectiveAuthStateCached(): AuthState {
  const local = authService.getState()
  if (local.authenticated) return { ...local, mode: 'local' }
  const cloudSettings = store.getSettings().cloud
  if (cloudSettings.enabled && cloudSettings.useCloudAuth && cloudService.hasToken()) {
    const cloud = cloudAuthState()
    if (cloud.authenticated) return cloud
  }
  return { ...local, mode: undefined, cloudBaseUrl: store.getSettings().cloud.baseUrl }
}

async function effectiveAuthState(): Promise<AuthState> {
  const local = authService.getState()
  if (local.authenticated) return { ...local, mode: 'local' }
  const cloudSettings = store.getSettings().cloud
  if (cloudSettings.enabled && cloudSettings.useCloudAuth && cloudService.hasToken()) {
    const status = await cloudService.status()
    const cloud = cloudAuthState(status)
    if (cloud.authenticated) return cloud
  }
  return { ...local, mode: undefined, cloudBaseUrl: store.getSettings().cloud.baseUrl }
}

function requireAuthorizedSession() {
  if (effectiveAuthStateCached().authenticated) return true
  throw new Error(uiText('请先登录 SnapFlow', 'Please sign in to SnapFlow first'))
}

function validatedCloudBaseUrl(value: unknown) {
  const raw = cleanText(value, '', 2048)
  if (!raw) throw new Error(uiText('请输入 SnapFlow Cloud URL', 'Enter a SnapFlow Cloud URL'))
  const url = new URL(raw)
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error(uiText('Cloud URL 必须使用 HTTPS；仅 localhost 可使用 HTTP', 'Cloud URL must use HTTPS; only localhost may use HTTP'))
  return url.toString().replace(/\/+$/, '')
}

function assertProviderId(value: unknown): ProviderId {
  if (typeof value !== 'string' || !providerIds.has(value as ProviderId)) throw new Error(uiText('未知 AI Provider', 'Unknown AI Provider'))
  return value as ProviderId
}

function cleanEntityId(value: unknown, label = 'ID') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error(uiText(`${label} 无效`, `${label} is invalid`))
  return value
}

function cleanText(value: unknown, fallback = '', maxLength = 20_000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : fallback
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try { return await fetch(url, { ...init, signal: controller.signal }) }
  catch (error) {
    if (error instanceof Error && /abort/i.test(error.name + error.message)) throw new Error(uiText('网络请求超时，请稍后重试', 'Network request timed out. Please try again.'))
    throw error
  } finally { clearTimeout(timer) }
}

function cleanCaptureRect(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error(uiText('截图区域无效', 'Invalid capture region'))
  const rect = value as Record<string, unknown>
  const x = Number(rect.x), y = Number(rect.y), width = Number(rect.width), height = Number(rect.height)
  if (![x, y, width, height].every(Number.isFinite) || width < 8 || height < 8 || width > 100_000 || height > 100_000) {
    throw new Error(uiText('截图区域无效', 'Invalid capture region'))
  }
  return { x, y, width, height }
}

function reserveCredits(cost: number) {
  if (cost <= 0) return true
  const available = store.getCredits().balance - reservedCredits
  if (available < cost) return false
  reservedCredits += cost
  return true
}

function releaseReservedCredits(cost: number) {
  if (cost > 0) reservedCredits = Math.max(0, reservedCredits - cost)
}

function commitReservedCredits(reservedCost: number, chargedCost: number, entry: Omit<Parameters<typeof store.addCreditEntry>[0], 'delta'>) {
  releaseReservedCredits(reservedCost)
  if (chargedCost > 0) store.addCreditEntry({ ...entry, delta: -chargedCost })
}

function rendererTarget(hash = '') {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) return { type: 'url' as const, value: `${dev}/#${hash}` }
  return { type: 'file' as const, value: path.join(__dirname, '../renderer/index.html') }
}

async function loadRenderer(win: BrowserWindow, hash = '') {
  const target = rendererTarget(hash)
  if (target.type === 'url') await win.loadURL(target.value)
  else await win.loadFile(target.value, { hash })
}

function hardenRendererWindow(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // SnapFlow has no renderer-driven navigation. Blocking post-load navigation prevents
  // a compromised renderer from turning our privileged preload bridge into a web bridge.
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('will-redirect', (event) => event.preventDefault())
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

function createMainWindow() {
  const settings = store.getSettings()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1050,
    minHeight: 680,
    show: false,
    title: 'SnapFlow',
    backgroundColor: settings.theme === 'light' ? '#f5f7fb' : '#0b1020',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  hardenRendererWindow(mainWindow)
  if (app.isPackaged) {
    mainWindow.webContents.on('devtools-opened', () => mainWindow?.webContents.closeDevTools())
  }

  if (smokeTestMode) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const expectedLogin = !(await effectiveAuthState()).authenticated
          const state = await mainWindow?.webContents.executeJavaScript(
            `({
              rendered: Boolean(document.getElementById('root')?.firstElementChild && document.body.textContent?.trim()),
              loginVisible: Boolean(document.querySelector('.login-shell')),
              fatalVisible: Boolean(document.querySelector('.fatal-renderer'))
            })`,
            true
          ) as { rendered?: boolean; loginVisible?: boolean; fatalVisible?: boolean } | undefined
          const rendered = Boolean(state?.rendered) && !state?.fatalVisible
          const loginOk = !expectedLogin || Boolean(state?.loginVisible)
          logger.info('Packaged renderer smoke test', { rendered, expectedLogin, loginVisible: Boolean(state?.loginVisible) })
          app.exit(rendered && loginOk ? 0 : expectedLogin && !state?.loginVisible ? 5 : 2)
        } catch (error) {
          logger.error('Packaged renderer smoke test failed', { error: String(error) })
          app.exit(3)
        }
      }, 1200)
    })
  }

  void loadRenderer(mainWindow).catch((error) => {
    logger.error('Renderer load failed', { error: String(error) })
    if (smokeTestMode) app.exit(4)
    else dialog.showErrorBox('SnapFlow 启动失败', '主界面加载失败。请查看 Logs 中的 error.log。')
  })
  mainWindow.on('close', (event) => {
    if (quitting) return
    const current = store.getSettings()
    if (current.closeBehavior === 'tray') {
      event.preventDefault()
      mainWindow?.hide()
      return
    }
    event.preventDefault()
    quitting = true
    app.quit()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  return mainWindow
}

function sendToMainWhenReady(channel: string, payload: unknown) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const send = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
  }
  if (mainWindow.webContents.isLoadingMainFrame()) mainWindow.webContents.once('did-finish-load', send)
  else send()
}

function showMain(cardId?: string, section?: string) {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
  if (cardId) sendToMainWhenReady('workspace:select-card', cardId)
  if (section) sendToMainWhenReady('workspace:navigate', section)
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
}

function notifyAll(channel: string, payload?: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

async function safeStartCapture(source: 'hotkey' | 'tray' | 'ipc' = 'ipc') {
  try {
    if (!effectiveAuthStateCached().authenticated) {
      logger.info('Capture requested while signed out', { source })
      showMain(undefined, 'login')
      notifyAll('app:error', { code: 'AUTH_REQUIRED', message: uiText('请先登录 SnapFlow，再使用截图与 AI 工作台。', 'Please sign in to SnapFlow before using Capture and the AI workspace.') })
      return
    }
    logger.info('Capture requested', { source })
    const existingQuickCardId = getQuickCardId()
    if (existingQuickCardId) closeQuickWithPrivacy(existingQuickCardId)
    await startCapture(preloadPath)
  } catch (error) {
    logger.error('Capture failed', { source, error: String(error) })
    notifyAll('app:error', {
      code: 'CAPTURE_FAILED',
      message: uiText('无法获取屏幕截图。请检查系统权限，或稍后重试。', 'Unable to capture the screen. Check system permissions or try again later.')
    })
    if (source !== 'hotkey') throw error
  }
}

function registerHotkey(hotkey: string) {
  try {
    if (registeredHotkey) globalShortcut.unregister(registeredHotkey)
  } catch (error) {
    logger.warn('Previous global shortcut could not be unregistered', { hotkey: registeredHotkey, error: String(error) })
  }
  registeredHotkey = ''
  const settings = store.getSettings()
  if (settings.shortcutPaused) {
    logger.info('Global shortcut paused')
    return true
  }
  try {
    const ok = globalShortcut.register(hotkey, () => void safeStartCapture('hotkey'))
    if (ok) {
      registeredHotkey = hotkey
      hotkeyConflict = ''
      notifyAll('hotkey:status', { ok: true, hotkey, conflict: '' })
      logger.info('Global shortcut registered', { hotkey })
    } else {
      hotkeyConflict = hotkey
      notifyAll('hotkey:status', { ok: false, hotkey, conflict: hotkey })
      if (process.platform === 'win32' && tray) { try { tray.displayBalloon({ title: 'SnapFlow', content: uiText(`${hotkey} 已被其他应用占用，请在设置中更换快捷键。`, `${hotkey} is already used by another app. Change it in Settings.`) }) } catch {} }
      logger.warn('Global shortcut registration failed', { hotkey })
    }
    return ok
  } catch (error) {
    hotkeyConflict = hotkey
    notifyAll('hotkey:status', { ok: false, hotkey, conflict: hotkey })
    if (process.platform === 'win32' && tray) {
      try { tray.displayBalloon({ title: 'SnapFlow', content: uiText(`${hotkey} 注册失败，请在设置中更换快捷键。`, `${hotkey} could not be registered. Change it in Settings.`) }) } catch {}
    }
    logger.warn('Global shortcut registration threw', { hotkey, error: String(error) })
    return false
  }
}

function applyAutoStart(settings: AppSettings) {
  if (smokeTestMode || process.platform !== 'win32' || !app.isPackaged) return
  const args = settings.startMinimized ? ['--hidden'] : []
  app.setLoginItemSettings({
    openAtLogin: settings.autoStart,
    path: process.execPath,
    args
  })
  logger.info('Windows login item updated', { enabled: settings.autoStart, hidden: settings.startMinimized })
}

function rebuildTrayMenu() {
  if (!tray) return
  const settings = store.getSettings()
  const auth = effectiveAuthStateCached()
  const zh = settings.locale !== 'en-US'
  const tr = (cn: string, en: string) => zh ? cn : en
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: auth.authenticated ? `${tr('账户', 'Account')}: ${auth.user?.displayName || auth.user?.email || 'Local user'}` : tr('未登录', 'Signed out'), enabled: false },
    { label: tr('打开 SnapFlow', 'Open SnapFlow'), click: () => showMain() },
    { label: tr('截图', 'Capture'), accelerator: registeredHotkey || undefined, click: () => void safeStartCapture('tray') },
    { label: tr('历史记录', 'History'), click: () => showMain(undefined, 'history') },
    { label: tr('设置', 'Settings'), click: () => showMain(undefined, 'settings') },
    { type: 'separator' },
    {
      label: tr('暂停快捷键', 'Pause hotkey'),
      type: 'checkbox',
      checked: settings.shortcutPaused,
      click: (item) => {
        const before = store.getSettings()
        const updated = store.updateSettings({ shortcutPaused: item.checked })
        if (!registerHotkey(updated.hotkey)) {
          const restored = store.updateSettings(before)
          registerHotkey(restored.hotkey)
          notifyAll('app:error', { code: 'HOTKEY_CONFLICT', message: tr(`${updated.hotkey} 已被其他应用占用，请更换快捷键。`, `${updated.hotkey} is already used by another app. Choose another hotkey.`) })
          notifyAll('settings:changed', restored)
        } else {
          notifyAll('settings:changed', updated)
        }
        rebuildTrayMenu()
      }
    },
    {
      label: tr('开机启动', 'Launch at sign-in'),
      type: 'checkbox',
      checked: settings.autoStart,
      click: (item) => {
        const before = store.getSettings()
        try {
          const updated = store.updateSettings({ autoStart: item.checked })
          applyAutoStart(updated)
          notifyAll('settings:changed', updated)
        } catch (error) {
          const restored = store.updateSettings(before)
          try { applyAutoStart(restored) } catch {}
          logger.warn('Tray auto-start update failed', { error: String(error) })
          notifyAll('app:error', { code: 'STARTUP_SETTING_FAILED', message: tr('无法修改 Windows 开机启动设置。', 'Unable to change Windows startup settings.') })
          notifyAll('settings:changed', restored)
        }
        rebuildTrayMenu()
      }
    },
    ...(auth.authenticated ? [{
      label: tr('退出登录', 'Sign out'),
      click: () => {
        const quickCardId = getQuickCardId()
        cancelCapture()
        if (quickCardId) closeQuickWithPrivacy(quickCardId)
        else closeQuickWindow()
        const state = authService.logout()
        notifyAll('auth:changed', state)
        rebuildTrayMenu()
        showMain(undefined, 'login')
      }
    } as Electron.MenuItemConstructorOptions] : []),
    { type: 'separator' },
    {
      label: tr('退出', 'Quit'),
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ]))
}

function createTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAr0lEQVRYhe2WQQqAMAwE9f8/9MjjwVvPjSgoWm2qHcQxRZtmJzTBmB4A+AFgG4BHIYQ1wL5p6t3uANz9Qz2A6QXgMUqE+wA8NYBXKCHsBvDTAFyhhLAbwE8DcIUSwm4APw3AFUoIuwH8NABXKCHsBvDTAFyhhLAbwE8DcIUSwm4APw3AFUoIuwH8NABXKCHsBvDTAFyhhLAbwE8DcIUSwm4APw3AFUoIuwH8NABXKCHsBvDTAFyhhLAb4AHYEUBH4qJrAAAAAElFTkSuQmCC'
  )
  tray = new Tray(icon)
  tray.setToolTip(store.getSettings().locale === 'en-US' ? 'SnapFlow — Capture anything, let AI take over' : 'SnapFlow — 框一下，让 AI 接管')
  rebuildTrayMenu()
  tray.on('double-click', () => showMain())
  logger.info('Tray created')
}

function appInfo(): AppInfo {
  const paths = getSnapFlowPaths()
  return {
    version: app.getVersion(),
    platform: process.platform,
    electronVersion: process.versions.electron ?? 'unknown',
    dataDirectory: paths.root,
    logsDirectory: paths.logs,
    autoUpdate: !store.getSettings().updates.enabled ? 'disabled' : store.getSettings().updates.manifestUrl ? 'enabled' : 'not_configured'
  }
}

function sendCardChanged(cardId: string) {
  const card = store.getCard(cardId)
  if (card) notifyAll('card:changed', card)
}

function sendCreditsChanged() {
  notifyAll('credits:changed', {
    credits: store.getCredits(),
    usageSummary: store.getUsageSummary()
  })
}

function sendCardDeleted(cardId: string) {
  notifyAll('card:deleted', cardId)
}

function deleteFileSafely(filePath?: string) {
  if (!filePath || !isManagedImagePath(filePath)) return
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch (error) {
    logger.warn('File deletion failed', { path: filePath, error: String(error) })
  }
}

function isManagedImagePath(filePath: string) {
  try {
    const paths = getSnapFlowPaths()
    const resolved = path.resolve(filePath)
    const roots = [paths.screenshots, paths.thumbnails].map((root) => `${path.resolve(root)}${path.sep}`)
    return roots.some((root) => resolved.startsWith(root))
  } catch {
    return false
  }
}

function validateBillingServerUrl(raw: string) {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error(uiText('Billing Server URL 无效', 'Billing Server URL is invalid')) }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(uiText('Billing Server 必须使用 HTTPS；仅 localhost 允许 HTTP', 'Billing Server must use HTTPS; only localhost may use HTTP.'))
  }
  return url.toString().replace(/\/$/, '')
}

function purgeManualOnlyUnstarredCards() {
  if (store.getSettings().privacy.screenshotPolicy !== 'manual_only') return
  for (const card of store.searchCards('')) {
    if (card.starred) continue
    deleteFileSafely(card.screenshotPath)
    deleteFileSafely(card.thumbnailPath)
    store.deleteCard(card.id)
  }
}

function removeScreenshotFiles(cardId: string) {
  const card = store.getCard(cardId)
  if (!card) return
  deleteFileSafely(card.screenshotPath)
  deleteFileSafely(card.thumbnailPath)
  store.updateCard(cardId, { screenshotPath: '', thumbnailPath: '' })
}

function applyPostAnalysisPrivacy(cardId: string) {
  if (store.getSettings().privacy.screenshotPolicy === 'delete_after_analysis') {
    removeScreenshotFiles(cardId)
    sendCardChanged(cardId)
  }
}

function closeQuickWithPrivacy(cardId?: string) {
  if (cardId && store.getSettings().privacy.screenshotPolicy === 'manual_only') {
    const card = store.getCard(cardId)
    if (card && !card.starred) {
      deleteFileSafely(card.screenshotPath)
      deleteFileSafely(card.thumbnailPath)
      store.deleteCard(cardId)
      sendCardDeleted(cardId)
    }
  }
  closeQuickWindow()
}

function ephemeralUserContext() {
  const settings = store.getSettings()
  if (!settings.privacy.readClipboard) return ''
  const text = clipboard.readText().trim()
  return text
    ? `\n\n用户允许读取的当前剪贴板（仅本次请求使用，不写入历史）：\n${text.slice(0, 12000)}`
    : ''
}

function persistedAnswer(card: Card, answer: AiAnswer) {
  const settings = store.getSettings()
  if (!settings.privacy.saveAnswers) return card.answers
  return [...card.answers, answer]
}

function threadContextScreenshot(card: Card) {
  if (!card.previousCardId) return ''
  const previous = store.getCard(card.previousCardId)
  return previous?.screenshotPath && isManagedImagePath(previous.screenshotPath) && fs.existsSync(previous.screenshotPath)
    ? previous.screenshotPath
    : ''
}

async function refineCardInBackground(cardId: string) {
  const card = store.getCard(cardId)
  if (!card || !store.getSettings().screenshot.autoAnalyze) return
  const reservation = 0
  let reservationReleased = true
  try {
    const currentSettings = store.getSettings()
    let workingCard = card
    if (currentSettings.screenshot.localOcr && card.screenshotPath && !card.ocrText.trim()) {
      try {
        const local = await runLocalOcr(card.screenshotPath, currentSettings.screenshot.localOcrEngine)
        const masked = redactSensitiveText(local.text || '', { email: currentSettings.privacy.autoMaskEmail, phone: currentSettings.privacy.autoMaskPhone })
        if (masked) {
          const locallyUpdated = store.updateCard(cardId, {
            ocrText: currentSettings.privacy.saveOcr ? masked : '',
            metadata: { ...(card.metadata || {}), localOcrEngine: local.engine, localOcrAvailable: true }
          })
          if (locallyUpdated) workingCard = locallyUpdated
          sendCardChanged(cardId)
        }
      } catch (error) {
        logger.info('Local OCR skipped', { cardId, error: String(error) })
      }
    }
    const result = await refineIntent(workingCard)
    if (!result) return
    const privacy = store.getSettings().privacy
    const routerCredits = result.provider === 'ollama' || providerUsesCloud(result.provider) ? 0 : 1
    if (routerCredits > 0 && store.getCredits().balance >= routerCredits) {
      store.addCreditEntry({
        delta: -routerCredits,
        reason: `${result.provider} · Intent Router`,
        cardId,
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        source: 'provider'
      })
      sendCreditsChanged()
    }
    const latest = store.getCard(cardId)
    if (!latest) return
    // The visual router runs in the background. Merge against the latest Card so a user
    // resolving a Thread/Project while the model is running is never overwritten by stale metadata.
    store.updateCard(cardId, {
      type: result.intent.type,
      title: result.intent.summary || latest.title,
      summary: result.intent.summary,
      ocrText: privacy.saveOcr ? result.intent.ocrText : '',
      confidence: result.intent.confidence,
      actions: result.intent.actions,
      tags: [...new Set([...(latest.tags || []), ...result.intent.tags])].slice(0, 20),
      metadata: {
        ...(latest.metadata || {}),
        routerProvider: result.provider,
        routerModel: result.model,
        ocrPersisted: privacy.saveOcr
      }
    })
    if (store.getSettings().projectSuggestionsEnabled) {
      const suggestion = store.suggestProjectForCard(cardId)
      if (suggestion) {
        const newest = store.getCard(cardId)
        store.updateCard(cardId, { metadata: { ...(newest?.metadata || {}), suggestedProjectId: suggestion.projectId, suggestedProjectName: suggestion.projectName, suggestedProjectScore: suggestion.score } })
      }
    }
    sendCardChanged(cardId)
  } catch (error) {
    logger.warn('Intent refinement failed', { cardId, error: String(error) })
  } finally {
    if (!reservationReleased) releaseReservedCredits(reservation)
  }
}

async function askCard(req: AskRequest) {
  if (!req || typeof req !== 'object') throw new Error(uiText('AI 请求无效', 'Invalid AI request'))
  const cardId = cleanEntityId(req.cardId, 'Card ID')
  const requestedProvider = req.provider === 'auto' ? 'auto' : assertProviderId(req.provider)
  const action = cleanText(req.action, '解释', 200) || '解释'
  const userPrompt = cleanText(req.prompt, '', 20_000)
  const skillId = req.skillId ? cleanEntityId(req.skillId, 'Skill ID') : undefined
  const requestedModel = cleanText(req.model, '', 200)
  const card = store.getCard(cardId)
  if (!card) throw new Error(uiText('Card 不存在', 'Card does not exist'))
  const route = selectProviderDetailed(card, requestedProvider)
  const settings = store.getSettings()
  const skill = getSkill(skillId)
  const prompt = buildActionPrompt(card, action, userPrompt, skill) + ephemeralUserContext()

  let answer: AiAnswer
  if (!route.provider && requestedProvider !== 'auto') {
    throw new Error(route.reason || uiText('所选 Provider 当前不可用', 'The selected Provider is currently unavailable'))
  }
  if (!route.provider) {
    const mock = callMockProvider({ prompt, ocrText: card.ocrText })
    answer = {
      id: randomUUID(),
      provider: 'mock',
      model: 'SnapFlow Demo Mock',
      action,
      text: mock.text,
      createdAt: new Date().toISOString(),
      usage: { estimated: true },
      credits: 0,
      isMock: true
    }
  } else {
    const provider = route.provider
    const model = requestedModel || route.model || settings.providers[provider].model
    const credits = providerUsesCloud(provider) ? 0 : estimateCredits(provider)
    if (!reserveCredits(credits)) {
      throw new Error(uiText(`本次调用需要 ${credits} UI Credits，当前可用余额不足`, `This request requires ${credits} UI Credits, but the available balance is insufficient.`))
    }
    let result
    try {
      result = await callProvider({
        provider,
        model,
        prompt,
        screenshotPath: card.screenshotPath,
        contextScreenshotPath: threadContextScreenshot(card),
        ocrText: card.ocrText,
        action
      })
    } catch (error) {
      releaseReservedCredits(credits)
      throw error
    }
    if (credits > 0) {
      commitReservedCredits(credits, credits, {
        reason: `${provider} · ${action}`,
        cardId: card.id,
        provider,
        model: result.model,
        usage: result.usage,
        source: 'provider'
      })
      sendCreditsChanged()
    }
    answer = {
      id: randomUUID(),
      provider,
      model: result.model,
      action,
      text: result.text,
      createdAt: new Date().toISOString(),
      usage: result.usage,
      credits,
      isMock: false,
      requestId: result.requestId,
      latencyMs: result.latencyMs
    }
  }

  const latestCard = store.getCard(card.id) ?? card
  const updated = store.updateCard(card.id, {
    question: userPrompt || action,
    answers: persistedAnswer(latestCard, answer),
    metadata: {
      ...(latestCard.metadata || {}),
      lastRouteReason: route.reason,
      lastRouteModel: answer.model,
      lastAnswerPersisted: settings.privacy.saveAnswers
    }
  })
  if (!settings.onboardingCaptureVerified) {
    const verified = store.updateSettings({ onboardingCaptureVerified: true })
    notifyAll('settings:changed', verified)
  }
  if (settings.projectSuggestionsEnabled) {
    const suggestion = store.suggestProjectForCard(card.id)
    if (suggestion) {
      const newest = store.getCard(card.id)
      store.updateCard(card.id, { metadata: { ...(newest?.metadata || {}), suggestedProjectId: suggestion.projectId, suggestedProjectName: suggestion.projectName, suggestedProjectScore: suggestion.score } })
    }
  }
  sendCardChanged(card.id)
  applyPostAnalysisPrivacy(card.id)
  logger.info('AI action completed', { cardId: card.id, provider: answer.provider, model: answer.model, mock: Boolean(answer.isMock) })
  return { card: store.getCard(card.id) ?? updated, answer, persisted: settings.privacy.saveAnswers, route }
}

async function compareCard(req: CompareRequest) {
  if (!req || typeof req !== 'object' || !Array.isArray(req.providers)) throw new Error(uiText('Compare 请求无效', 'Invalid Compare request'))
  const cardId = cleanEntityId(req.cardId, 'Card ID')
  const action = cleanText(req.action, '解释', 200) || '解释'
  const userPrompt = cleanText(req.prompt, '', 20_000)
  const providers = req.providers.slice(0, 8).map((item) => ({
    provider: assertProviderId(item?.provider),
    model: cleanText(item?.model, '', 200) || undefined
  }))
  const card = store.getCard(cardId)
  if (!card) throw new Error(uiText('Card 不存在', 'Card does not exist'))
  const settings = store.getSettings()
  const unique = providers.filter(
    (p, i, arr) => arr.findIndex((x) => x.provider === p.provider && (x.model || '') === (p.model || '')) === i
  )
  if (unique.length < 2) throw new Error(uiText('Compare 至少选择两个模型', 'Compare requires at least two models'))
  const needsVision = shouldRequireVisionForCard(card.type, Boolean(card.screenshotPath), card.ocrText)
  const available = unique.filter(({ provider }) => {
    const cfg = settings.providers[provider]
    return cfg.enabled && providerHasCredential(provider) && (!needsVision || cfg.supportsVision)
  })
  if (available.length < 2) {
    throw new Error(needsVision
      ? '当前截图仍需要视觉理解；Compare 至少需要两个已连接且支持图片输入的真实 Provider'
      : 'Compare 至少需要两个已连接的真实 Provider；Demo Mock 不会伪装成真实多模型对比')
  }
  const compareMinimum = available.reduce((sum, item) => sum + (providerUsesCloud(item.provider) ? 0 : estimateCredits(item.provider)), 0)
  if (!reserveCredits(compareMinimum)) throw new Error(uiText(`当前可用 UI Credits 不足：本次 Compare 需要 ${compareMinimum} pts`, `Insufficient UI Credits: this Compare requires ${compareMinimum} pts.`))

  const prompt = buildActionPrompt(card, action, userPrompt) + ephemeralUserContext()
  const compareController = new AbortController()
  const compareDeadline = setTimeout(() => compareController.abort(), 50_000)
  const results = await Promise.allSettled(
    available.map(async ({ provider, model }) => {
      const resolvedModel = model || settings.providers[provider].model
      try {
        const result = await callProvider({
          provider,
          model: resolvedModel,
          prompt,
          screenshotPath: card.screenshotPath,
          contextScreenshotPath: threadContextScreenshot(card),
          ocrText: card.ocrText,
          action: `Compare · ${action}`,
          signal: compareController.signal
        })
        return { provider, model: result.model, result, credits: providerUsesCloud(provider) ? 0 : estimateCredits(provider) }
      } catch (error) {
        if (classifyProviderError(error).code === 'timeout') compareController.abort()
        throw error
      }
    })
  ).finally(() => clearTimeout(compareDeadline))

  const storedAnswers = [...card.answers]
  const transientAnswers: AiAnswer[] = []
  const compareAnswers: Array<{ provider: string; text: string }> = []
  for (const [index, item] of results.entries()) {
    const reservedCost = providerUsesCloud(available[index].provider) ? 0 : estimateCredits(available[index].provider)
    if (item.status !== 'fulfilled') {
      releaseReservedCredits(reservedCost)
      logger.warn('Compare provider failed', { provider: available[index].provider, error: String(item.reason) })
      continue
    }
    const { provider, model, result, credits } = item.value
    if (credits > 0) {
      commitReservedCredits(reservedCost, credits, {
        reason: `${provider} · Compare`,
        cardId: card.id,
        provider,
        model,
        usage: result.usage,
        source: 'provider'
      })
    } else {
      releaseReservedCredits(reservedCost)
    }
    const answer: AiAnswer = {
      id: randomUUID(),
      provider,
      model,
      action: `Compare · ${action}`,
      text: result.text,
      createdAt: new Date().toISOString(),
      usage: result.usage,
      credits,
      requestId: result.requestId,
      latencyMs: result.latencyMs
    }
    transientAnswers.push(answer)
    if (settings.privacy.saveAnswers) storedAnswers.push(answer)
    compareAnswers.push({ provider: `${provider}/${model}`, text: result.text })
  }
  if (compareAnswers.length === 0) throw new Error(uiText('所选模型均调用失败；未产生有效 Compare 结果', 'All selected models failed; no valid Compare result was produced.'))

  store.updateCard(card.id, { answers: storedAnswers, question: userPrompt || action })
  sendCreditsChanged()
  sendCardChanged(card.id)

  if (compareAnswers.length < 2) {
    applyPostAnalysisPrivacy(card.id)
    return {
      card: store.getCard(card.id),
      answers: transientAnswers,
      consensus: null,
      persisted: settings.privacy.saveAnswers,
      warning: '仅一个模型调用成功，已保留该回答；至少两个成功结果才能生成 Consensus。'
    }
  }

  let consensusAnswer: AiAnswer | null = null
  let consensusWarning = ''
  try {
    const fresh = store.getCard(card.id)!
    const judgeRoute = selectProviderDetailed(fresh, 'auto')
    if (judgeRoute.provider) {
      const judgeCredits = providerUsesCloud(judgeRoute.provider) ? 0 : estimateCredits(judgeRoute.provider)
      if (!reserveCredits(judgeCredits)) throw new Error(uiText('Consensus Judge 已跳过：剩余 UI Credits 不足', 'Consensus Judge was skipped because the remaining UI Credits are insufficient.'))
      let judgeResult
      try {
        judgeResult = await callProvider({
          provider: judgeRoute.provider,
          model: judgeRoute.model,
          prompt: buildConsensusPrompt(fresh, compareAnswers),
          screenshotPath: fresh.screenshotPath,
          contextScreenshotPath: threadContextScreenshot(fresh),
          ocrText: fresh.ocrText,
          action: 'AI Consensus'
        })
      } catch (error) {
        releaseReservedCredits(judgeCredits)
        throw error
      }
      if (judgeCredits > 0) {
        commitReservedCredits(judgeCredits, judgeCredits, {
          reason: `${judgeRoute.provider} · Consensus Judge`,
          cardId: card.id,
          provider: judgeRoute.provider,
          model: judgeResult.model,
          usage: judgeResult.usage,
          source: 'provider'
        })
      }
      consensusAnswer = {
        id: randomUUID(),
        provider: judgeRoute.provider,
        model: judgeResult.model,
        action: 'AI Consensus',
        text: judgeResult.text,
        createdAt: new Date().toISOString(),
        usage: judgeResult.usage,
        credits: judgeCredits,
        requestId: judgeResult.requestId,
        latencyMs: judgeResult.latencyMs
      }
      if (settings.privacy.saveAnswers) {
        const current = store.getCard(card.id)!
        store.updateCard(card.id, { answers: [...current.answers, consensusAnswer] })
      }
    }
  } catch (error) {
    consensusWarning = error instanceof Error ? error.message : 'Consensus Judge 调用失败'
    logger.warn('Consensus judge failed', { cardId: card.id, error: String(error) })
  }

  sendCardChanged(card.id)
  sendCreditsChanged()
  applyPostAnalysisPrivacy(card.id)
  return {
    card: store.getCard(card.id),
    answers: transientAnswers,
    consensus: consensusAnswer,
    persisted: settings.privacy.saveAnswers,
    warning: consensusWarning
  }
}

function readDemoBillingConfig() {
  const candidates = [
    path.join(process.resourcesPath, 'demo-billing.json'),
    path.join(process.cwd(), 'resources', 'demo-billing.json')
  ]
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) as { packages?: number[]; codes?: Record<string, number> }
    } catch (error) {
      logger.warn('Demo billing config failed to load', { file, error: String(error) })
    }
  }
  return { packages: [100, 500, 1000], codes: {} }
}

function registerIpc() {
  if (ipcRegistered) return
  ipcRegistered = true

  ipcMain.handle('auth:get-state', () => effectiveAuthState())
  ipcMain.handle('auth:register', (_event, request: AuthRegisterRequest) => {
    const state = authService.register(request)
    notifyAll('auth:changed', state)
    rebuildTrayMenu()
    return state
  })
  ipcMain.handle('auth:login', (_event, request: AuthLoginRequest) => {
    const state = authService.login(request)
    notifyAll('auth:changed', state)
    rebuildTrayMenu()
    return state
  })
  ipcMain.handle('auth:cloud-login', async (_event, request: { baseUrl?: string; email?: string; password?: string; rememberMe?: boolean }) => {
    const baseUrl = validatedCloudBaseUrl(request?.baseUrl)
    const previousCloud = structuredClone(store.getSettings().cloud)
    store.updateSettings({ cloud: { ...previousCloud, enabled: true, useCloudAuth: true, baseUrl } })
    try {
      const cloud = await cloudService.login(cleanText(request?.email, '', 254), String(request?.password || ''), request?.rememberMe !== false)
      const state = cloudAuthState(cloud)
      notifyAll('auth:changed', state)
      rebuildTrayMenu()
      return state
    } catch (error) {
      store.updateSettings({ cloud: previousCloud })
      cloudService.logout()
      throw error
    }
  })
  ipcMain.handle('auth:cloud-register', async (_event, request: { baseUrl?: string; email?: string; displayName?: string; password?: string; rememberMe?: boolean }) => {
    const baseUrl = validatedCloudBaseUrl(request?.baseUrl)
    const previousCloud = structuredClone(store.getSettings().cloud)
    store.updateSettings({ cloud: { ...previousCloud, enabled: true, useCloudAuth: true, baseUrl } })
    try {
      const cloud = await cloudService.register(cleanText(request?.email, '', 254), cleanText(request?.displayName, '', 80), String(request?.password || ''), request?.rememberMe !== false)
      const state = cloudAuthState(cloud)
      notifyAll('auth:changed', state)
      rebuildTrayMenu()
      return state
    } catch (error) {
      store.updateSettings({ cloud: previousCloud })
      cloudService.logout()
      throw error
    }
  })
  ipcMain.handle('auth:logout', () => {
    const quickCardId = getQuickCardId()
    cancelCapture()
    if (quickCardId) closeQuickWithPrivacy(quickCardId)
    else closeQuickWindow()
    authService.logout()
    cloudService.logout()
    const state = effectiveAuthStateCached()
    notifyAll('auth:changed', state)
    rebuildTrayMenu()
    showMain(undefined, 'login')
    return state
  })
  ipcMain.handle('auth:reset-local', (_event, confirmation: unknown) => {
    const quickCardId = getQuickCardId()
    cancelCapture()
    if (quickCardId) closeQuickWithPrivacy(quickCardId)
    else closeQuickWindow()
    const state = authService.resetLocalAccount(confirmation)
    notifyAll('auth:changed', state)
    rebuildTrayMenu()
    showMain(undefined, 'login')
    return state
  })

  ipcMain.handle('ui:get-locale', () => store.getSettings().locale)
  ipcMain.handle('ui:set-locale', (_event, locale: unknown) => {
    const nextLocale = locale === 'en-US' ? 'en-US' : 'zh-CN'
    const settings = store.updateSettings({ locale: nextLocale })
    rebuildTrayMenu()
    notifyAll('settings:changed', settings)
    return settings.locale
  })

  const protectedHandle = (channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) => {
    ipcMain.handle(channel, (event, ...args) => {
      requireAuthorizedSession()
      return handler(event, ...args)
    })
  }

  protectedHandle('bootstrap:get', async () => {
    const data = store.bootstrap()
    if (data.settings.cloud.enabled && cloudService.hasToken()) {
      try { await cloudService.configuredProviders(true) } catch {}
    }
    for (const id of Object.keys(data.settings.providers) as ProviderId[]) {
      data.settings.providers[id].hasKey = providerHasCredential(id)
    }
    const liveConfigured = (Object.keys(data.settings.providers) as ProviderId[]).some((id) => data.settings.providers[id].enabled && providerHasCredential(id))
    return {
      ...data,
      providerDescriptors,
      appInfo: appInfo(),
      auth: await effectiveAuthState(),
      demoMode: !liveConfigured,
      cloud: await cloudService.status(),
      updates: updaterService.status()
    }
  })

  protectedHandle('settings:update', (_event, patch: Partial<AppSettings>) => {
    const safePatch = patch && typeof patch === 'object' && !Array.isArray(patch) ? { ...patch } : {}
    if (typeof safePatch.billingServerUrl === 'string' && safePatch.billingServerUrl.trim()) {
      safePatch.billingServerUrl = validateBillingServerUrl(safePatch.billingServerUrl.trim())
    }
    const before = store.getSettings()
    const settings = store.updateSettings(safePatch)
    try {
      if (settings.hotkey !== before.hotkey) {
        if (!registerHotkey(settings.hotkey)) {
          throw new Error(uiText(`快捷键 ${settings.hotkey} 已被其他应用占用，请更换快捷键`, `Hotkey ${settings.hotkey} is already used by another app. Choose another hotkey.`))
        }
      } else if (safePatch.shortcutPaused !== undefined) {
        if (!registerHotkey(settings.hotkey)) {
          throw new Error(uiText(`快捷键 ${settings.hotkey} 已被其他应用占用，请更换快捷键`, `Hotkey ${settings.hotkey} is already used by another app. Choose another hotkey.`))
        }
      }
      if (safePatch.autoStart !== undefined || safePatch.startMinimized !== undefined) applyAutoStart(settings)
      rebuildTrayMenu()
      notifyAll('settings:changed', settings)
      return settings
    } catch (error) {
      // Settings changes must be atomic from the user's perspective. A hotkey conflict
      // during onboarding must not leave onboardingComplete=true in storage.
      const restored = store.updateSettings(before)
      registerHotkey(restored.hotkey)
      try { applyAutoStart(restored) } catch (rollbackError) {
        logger.warn('Auto-start rollback failed', { error: String(rollbackError) })
      }
      rebuildTrayMenu()
      notifyAll('settings:changed', restored)
      throw error
    }
  })

  protectedHandle('provider:set-key', (_event, providerValue: ProviderId, secretValue: string) => {
    const provider = assertProviderId(providerValue)
    const clean = typeof secretValue === 'string' ? secretValue.trim().slice(0, 20_000) : ''
    store.setSecret(provider, clean ? encryptSecret(clean) : '')
    return providerHasCredential(provider)
  })
  protectedHandle('provider:has-key', (_event, provider: ProviderId) => providerHasCredential(assertProviderId(provider)))
  protectedHandle('provider:test', async (_event, provider: ProviderId) => testProvider(assertProviderId(provider)))
  protectedHandle('provider:list-models', async (_event, provider: ProviderId) => listProviderModels(assertProviderId(provider)))
  protectedHandle('provider:descriptors', () => providerDescriptors)
  protectedHandle('provider:audit', (_event, provider?: ProviderId) => readRecentProviderAudit(provider ? assertProviderId(provider) : undefined, 5))
  protectedHandle('router:preview', (_event, cardIdValue: string, providerValue: ProviderId | 'auto') => {
    const cardId = cleanEntityId(cardIdValue, 'Card ID')
    const provider = providerValue === 'auto' ? 'auto' : assertProviderId(providerValue)
    const card = store.getCard(cardId)
    if (!card) throw new Error(uiText('Card 不存在', 'Card does not exist'))
    return selectProviderDetailed(card, provider)
  })

  protectedHandle('capture:start', () => safeStartCapture('ipc'))
  protectedHandle('capture:get-pending', () => getPendingCapture())
  protectedHandle('capture:complete', async (_event, rect, renderedDataUrl?: string, visual?: unknown) => {
    const card = await completeCapture(cleanCaptureRect(rect), preloadPath, renderedDataUrl, visual as any)
    logger.info('Capture completed', { cardId: card.id, app: card.appName })
    void refineCardInBackground(card.id)
    return card
  })
  protectedHandle('capture:cancel', () => cancelCapture())

  protectedHandle('card:get', (_event, idValue: string) => store.getCard(cleanEntityId(idValue, 'Card ID')))
  protectedHandle('card:list', () => store.listCards())
  protectedHandle('card:search', (_event, queryValue: string, projectIdValue?: string, favoritesOnly?: boolean) => {
    const query = cleanText(queryValue, '', 500)
    const projectId = projectIdValue ? cleanEntityId(projectIdValue, 'Project ID') : undefined
    return store.searchCards(query, projectId, Boolean(favoritesOnly))
  })
  protectedHandle('card:search-semantic', (_event, queryValue: string, projectIdValue?: string, favoritesOnly?: boolean) => {
    const query = cleanText(queryValue, '', 500)
    const projectId = projectIdValue ? cleanEntityId(projectIdValue, 'Project ID') : undefined
    return store.searchCardsSemantic(query, projectId, Boolean(favoritesOnly))
  })
  protectedHandle('project:suggest', (_event, cardIdValue: string) => store.suggestProjectForCard(cleanEntityId(cardIdValue, 'Card ID')))
  protectedHandle('card:image', (_event, idValue: string, thumbnail = false) => {
    const id = cleanEntityId(idValue, 'Card ID')
    const card = store.getCard(id)
    const filePath = thumbnail ? card?.thumbnailPath : card?.screenshotPath
    if (!filePath || !isManagedImagePath(filePath) || !fs.existsSync(filePath)) return ''
    try { return `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}` }
    catch (error) {
      logger.warn('Card image read failed', { cardId: id, thumbnail: Boolean(thumbnail), error: String(error) })
      return ''
    }
  })
  protectedHandle('card:ask', (_event, req: AskRequest) => askCard(req))
  protectedHandle('card:compare', (_event, req: CompareRequest) => compareCard(req))
  protectedHandle('card:update', (_event, idValue: string, patch: Partial<Card>) => {
    const id = cleanEntityId(idValue, 'Card ID')
    const safePatch = sanitizeRendererCardPatch(patch)
    if (safePatch.projectId && !store.listProjects().some((project) => project.id === safePatch.projectId)) {
      throw new Error(uiText('目标 Project 不存在', 'Target Project does not exist'))
    }
    const current = store.getCard(id)
    if (!current) throw new Error(uiText('Card 不存在', 'Card does not exist'))
    if (safePatch.metadata) safePatch.metadata = { ...(current.metadata || {}), ...safePatch.metadata }
    const card = store.updateCard(id, safePatch)
    if (card) sendCardChanged(id)
    return card
  })
  protectedHandle('card:delete', (_event, idValue: string) => {
    const id = cleanEntityId(idValue, 'Card ID')
    const card = store.getCard(id)
    if (!card) return false
    deleteFileSafely(card.screenshotPath)
    deleteFileSafely(card.thumbnailPath)
    store.deleteCard(id)
    sendCardDeleted(id)
    logger.info('Card deleted', { cardId: id })
    return true
  })
  protectedHandle('thread:resolve', (_event, cardIdValue: string, mode: 'continue' | 'new') => {
    const cardId = cleanEntityId(cardIdValue, 'Card ID')
    if (mode !== 'continue' && mode !== 'new') throw new Error(uiText('Thread 操作无效', 'Invalid Thread action'))
    const card = store.getCard(cardId)
    if (!card) throw new Error(uiText('Card 不存在', 'Card does not exist'))
    const candidateId = typeof card.metadata?.threadCandidateId === 'string'
      ? card.metadata.threadCandidateId
      : card.previousCardId || ''
    const nextMetadata = { ...(card.metadata || {}), threadCandidateId: '' }
    if (mode === 'continue' && candidateId) {
      const previous = store.getCard(candidateId)
      if (previous) {
        const updated = store.updateCard(cardId, {
          previousCardId: previous.id,
          threadId: previous.threadId || previous.id,
          metadata: nextMetadata
        })
        sendCardChanged(cardId)
        return updated
      }
    }
    const updated = store.updateCard(cardId, { previousCardId: undefined, threadId: card.id, metadata: nextMetadata })
    sendCardChanged(cardId)
    return updated
  })

  protectedHandle('project:create', (_event, nameValue: string) => store.createProject(cleanText(nameValue, '', 120)))
  protectedHandle('project:list', () => store.listProjects())
  protectedHandle('project:rename', (_event, idValue: string, nameValue: string) => store.renameProject(cleanEntityId(idValue, 'Project ID'), cleanText(nameValue, '', 120)))
  protectedHandle('project:delete', (_event, idValue: string) => store.deleteProject(cleanEntityId(idValue, 'Project ID')))

  protectedHandle('workspace:open', (_event, cardIdValue?: string) => {
    const cardId = cardIdValue ? cleanEntityId(cardIdValue, 'Card ID') : undefined
    closeQuickWindow()
    showMain(cardId)
  })
  protectedHandle('quick:close', (_event, cardIdValue?: string) => {
    const cardId = cardIdValue ? cleanEntityId(cardIdValue, 'Card ID') : undefined
    return closeQuickWithPrivacy(cardId)
  })

  protectedHandle('workflow:recommendations', () => {
    if (!store.getSettings().learnedWorkflowEnabled) return []
    return deriveWorkflowRecommendations(store.listCards())
  })
  protectedHandle('workflow:list', () => store.getSettings().workflowRules)
  protectedHandle('workflow:create', (_event, recommendation: any) => {
    const intent = cleanText(recommendation?.intent, 'general', 80) as Card['type']
    const provider = recommendation?.provider === 'auto' ? 'auto' : assertProviderId(recommendation?.provider)
    const action = cleanText(recommendation?.action, '解释', 160) || '解释'
    const name = cleanText(recommendation?.name || recommendation?.suggestedName, `${intent} → ${action}`, 120)
    const rules = store.getSettings().workflowRules
    const existing = rules.find((x) => x.intent === intent && x.provider === provider && x.action === action)
    if (existing) return existing
    const rule: AppSettings['workflowRules'][number] = { id: `wf_${randomUUID().replace(/-/g, '').slice(0, 16)}`, name, intent, provider, action, skillId: recommendation?.skillId ? cleanEntityId(recommendation.skillId, 'Skill ID') : undefined, enabled: true, usageCount: 0, createdAt: new Date().toISOString() }
    store.updateSettings({ workflowRules: [...rules, rule] })
    notifyAll('settings:changed', store.getSettings())
    return rule
  })
  protectedHandle('workflow:delete', (_event, idValue: string) => {
    const id = cleanEntityId(idValue, 'Workflow ID')
    store.updateSettings({ workflowRules: store.getSettings().workflowRules.filter((x) => x.id !== id) })
    notifyAll('settings:changed', store.getSettings())
    return true
  })
  protectedHandle('skill:marketplace-list', () => listMarketplace())
  protectedHandle('skill:marketplace-install', async (_event, idValue: string) => {
    const installed = await installMarketplaceSkill(cleanEntityId(idValue, 'Skill ID'))
    notifyAll('skills:changed', listSkills())
    return installed
  })
  protectedHandle('skill:marketplace-uninstall', (_event, idValue: string) => {
    const result = uninstallMarketplaceSkill(cleanEntityId(idValue, 'Skill ID'))
    notifyAll('skills:changed', listSkills())
    return result
  })
  protectedHandle('skill:install-content', (_event, contentValue: string) => {
    const skill = installSkillContent(cleanText(contentValue, '', 200_000), 'user')
    notifyAll('skills:changed', listSkills())
    return skill
  })
  protectedHandle('skill:uninstall', (_event, idValue: string) => {
    const result = uninstallUserSkill(cleanEntityId(idValue, 'Skill ID'))
    notifyAll('skills:changed', listSkills())
    return result
  })
  protectedHandle('cloud:status', () => cloudService.status())
  protectedHandle('cloud:credits', () => cloudService.credits())
  protectedHandle('cloud:register', async (_event, email: string, displayName: string, password: string) => cloudService.register(cleanText(email, '', 254), cleanText(displayName, '', 80), String(password || '')))
  protectedHandle('cloud:login', async (_event, email: string, password: string) => cloudService.login(cleanText(email, '', 254), String(password || '')))
  protectedHandle('cloud:logout', () => {
    const wasCloudPrincipal = effectiveAuthStateCached().mode === 'cloud'
    const cloud = cloudService.logout()
    if (wasCloudPrincipal) {
      const state = effectiveAuthStateCached()
      notifyAll('auth:changed', state)
      rebuildTrayMenu()
      showMain(undefined, 'login')
    }
    return cloud
  })
  protectedHandle('cloud:checkout', async (_event, amount: number) => {
    const result = await cloudService.checkout(amount)
    if (result.url) {
      const url = new URL(result.url)
      if (url.protocol !== 'https:') throw new Error('Cloud checkout URL must use HTTPS')
      await shell.openExternal(url.toString())
    }
    return result
  })
  protectedHandle('cloud:sync-cards', () => {
    const privacy = store.getSettings().privacy
    const mask = (value: string) => redactSensitiveText(value || '', { email: privacy.autoMaskEmail, phone: privacy.autoMaskPhone })
    const cards = store.listCards().slice(0, 1000).map((card) => ({
      ...card,
      screenshotPath: '',
      thumbnailPath: '',
      imageFingerprint: card.imageFingerprint || '',
      title: mask(card.title),
      summary: mask(card.summary),
      question: mask(card.question),
      ocrText: privacy.saveOcr ? mask(card.ocrText) : '',
      appName: privacy.readAppName ? mask(card.appName) : '',
      windowTitle: privacy.readWindowTitle ? mask(card.windowTitle) : '',
      answers: privacy.saveAnswers ? card.answers.map((answer) => ({ ...answer, text: mask(answer.text) })) : []
    }))
    return cloudService.syncCards(cards)
  })
  protectedHandle('update:status', () => updaterService.status())
  protectedHandle('update:check', () => updaterService.checkNow())
  protectedHandle('update:download', () => updaterService.download())
  protectedHandle('update:install', () => updaterService.install())
  protectedHandle('hotkey:status', () => ({ ok: !hotkeyConflict, hotkey: store.getSettings().hotkey, conflict: hotkeyConflict }))
  protectedHandle('credits:get', () => ({ credits: store.getCredits(), usageSummary: store.getUsageSummary() }))
  protectedHandle('credits:add-demo', (_event, amount: number) => {
    const config = readDemoBillingConfig()
    if (!store.getSettings().demoBillingEnabled) throw new Error(uiText('Demo / Local Simulation 已关闭', 'Demo / Local Simulation is disabled'))
    const safe = Math.round(Number(amount))
    if (!config.packages?.includes(safe)) throw new Error(uiText('无效的 Demo 套餐', 'Invalid Demo package'))
    const state = store.addCreditEntry({
      delta: safe,
      reason: `Demo / Local Simulation · +${safe}`,
      source: 'demo'
    })
    sendCreditsChanged()
    return state
  })
  protectedHandle('credits:redeem-demo', (_event, code: string) => {
    if (!store.getSettings().demoBillingEnabled) throw new Error(uiText('Demo / Local Simulation 已关闭', 'Demo / Local Simulation is disabled'))
    const config = readDemoBillingConfig()
    const normalized = cleanText(code, '', 80).toUpperCase()
    const value = Number(config.codes?.[normalized] || 0)
    if (!value) throw new Error(uiText('兑换码无效', 'Invalid redeem code'))
    const state = store.redeemDemoCode(normalized, value)
    sendCreditsChanged()
    return state
  })
  protectedHandle('credits:checkout', async (_event, amount: number) => {
    const settings = store.getSettings()
    if (!settings.billingServerUrl) throw new Error(uiText('尚未配置可选 Billing Server URL；当前默认使用 Demo / Local Simulation', 'No optional Billing Server URL is configured; SnapFlow is currently using Demo / Local Simulation.'))
    const billingBase = validateBillingServerUrl(settings.billingServerUrl)
    const response = await fetchWithTimeout(`${billingBase}/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: settings.deviceId, credits: (() => {
        const credits = Math.round(Number(amount))
        if (!Number.isSafeInteger(credits) || credits < 1 || credits > 1_000_000) throw new Error(uiText('充值积分数量无效', 'Invalid credit purchase amount'))
        return credits
      })() })
    })
    const body = await response.json() as { url?: string; error?: string }
    if (!response.ok || !body.url) throw new Error(body.error || uiText('创建充值订单失败', 'Failed to create checkout order'))
    const checkoutUrl = validateBillingServerUrl(body.url)
    await shell.openExternal(checkoutUrl)
    return { ...body, url: checkoutUrl }
  })
  protectedHandle('credits:sync-billing', async () => {
    const settings = store.getSettings()
    if (!settings.billingServerUrl) return store.getCredits()
    const base = validateBillingServerUrl(settings.billingServerUrl)
    const response = await fetchWithTimeout(`${base}/credits/${encodeURIComponent(settings.deviceId)}`)
    const body = await response.json() as { balance?: number; error?: string }
    if (!response.ok) throw new Error(body.error || uiText('同步充值积分失败', 'Failed to sync purchased credits'))
    const state = store.syncBillingTotal(Number(body.balance || 0))
    sendCreditsChanged()
    return state
  })

  protectedHandle('clipboard:copy-text', (_event, value: unknown) => { clipboard.writeText(cleanText(value, '', 4000)); return true })
  protectedHandle('app:info', () => appInfo())
  protectedHandle('app:open-data', async () => shell.openPath(getSnapFlowPaths().root))
  protectedHandle('app:open-logs', async () => shell.openPath(getSnapFlowPaths().logs))
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMain())

  app.whenReady().then(async () => {
    store.init()
    authService.init()
    purgeManualOnlyUnstarredCards()
    const settings = store.getSettings()
    logger.info('SnapFlow starting', {
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron,
      packaged: app.isPackaged
    })
    applyAutoStart(settings)
    registerIpc()
    createMainWindow()
    createTray()
    if (!smokeTestMode && !registerHotkey(settings.hotkey)) {
      sendToMainWhenReady('app:error', {
        code: 'HOTKEY_CONFLICT',
        message: uiText(`${settings.hotkey} 已被其他应用占用。请在 Settings → Screenshot 中更换快捷键。`, `${settings.hotkey} is already used by another app. Change it in Settings → Screenshot.`)
      })
    }
    if (!smokeTestMode) updaterService.start()

    const hiddenByLaunchArg = process.argv.includes('--hidden')
    const startupAuth = await effectiveAuthState()
    if (smokeTestMode || !startupAuth.authenticated || !settings.onboardingComplete || !hiddenByLaunchArg) showMain()

    app.on('activate', () => showMain())
  }).catch((error) => {
    logger.error('Fatal startup error', { error: String(error) })
    app.quit()
  })
}


app.on('before-quit', () => {
  quitting = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  purgeManualOnlyUnstarredCards()
  logger.info('SnapFlow quitting')
})

app.on('window-all-closed', () => {
  // SnapFlow remains alive in the tray by design.
})
