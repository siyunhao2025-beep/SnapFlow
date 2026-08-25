import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, desktopCapturer, nativeImage, screen } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CapturePayload, CaptureRect, Card, VisualDescriptor } from '../shared/types'
import { heuristicIntent } from './router'
import { store } from './store'
import { getSnapFlowPaths } from './paths'
import { logger } from './logger'
import { isThreadCandidate } from '../shared/thread'
import { clampDipRectToDisplay, imageCropFromDipRect } from '../shared/capture-math'
import { isSensitiveApp } from '../shared/privacy'

let pendingCapture: CapturePayload | null = null
let captureWindow: BrowserWindow | null = null
let quickWindow: BrowserWindow | null = null
let quickCardId = ''
let captureStarting = false
let captureGeneration = 0

const execFileAsync = promisify(execFile)

const visualPalette = new Set(['red','orange','yellow','green','cyan','blue','purple','pink','black','white','gray'])
function sanitizeVisualDescriptor(value: unknown): VisualDescriptor | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Partial<VisualDescriptor>
  const finite = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : undefined
  const r = finite(v.averageRgb?.r, 0, 255), g = finite(v.averageRgb?.g, 0, 255), b = finite(v.averageRgb?.b, 0, 255)
  const brightness = finite(v.brightness, 0, 1), saturation = finite(v.saturation, 0, 1), edgeDensity = finite(v.edgeDensity, 0, 1), aspectRatio = finite(v.aspectRatio, .05, 20)
  if ([r,g,b,brightness,saturation,edgeDensity,aspectRatio].some((x) => x === undefined)) return undefined
  const dominantColors = Array.from(new Set((Array.isArray(v.dominantColors) ? v.dominantColors : []).map(String).filter((x) => visualPalette.has(x)))).slice(0, 4)
  return { dominantColors, averageRgb: { r: r!, g: g!, b: b! }, brightness: brightness!, saturation: saturation!, edgeDensity: edgeDensity!, aspectRatio: aspectRatio!, isDark: Boolean(v.isDark) }
}

async function writeBufferChunks(filePath: string, buffer: Buffer, chunkSize = 16 * 1024) {
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(filePath, { flags: 'w' })
    stream.on('error', reject)
    stream.on('finish', resolve)
    let offset = 0
    const pump = () => {
      while (offset < buffer.length) {
        const end = Math.min(buffer.length, offset + chunkSize)
        if (!stream.write(buffer.subarray(offset, end))) { offset = end; stream.once('drain', pump); return }
        offset = end
      }
      stream.end()
    }
    pump()
  })
}

async function getWindowsForegroundContext() {
  if (process.platform !== 'win32') return { appName: '', windowTitle: '' }

  // Avoid native npm addons here. active-win@9 requires a prebuilt/native binary and
  // can fail to install on newer Node versions or restricted GitHub connections.
  // Windows PowerShell can query user32.dll directly without Visual Studio Build Tools.
  const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class SnapFlowForegroundWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
}
'@
$handle = [SnapFlowForegroundWindow]::GetForegroundWindow()
$processIdValue = [uint32]0
[SnapFlowForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processIdValue) | Out-Null
$buffer = New-Object System.Text.StringBuilder 2048
[SnapFlowForegroundWindow]::GetWindowText($handle, $buffer, $buffer.Capacity) | Out-Null
$process = Get-Process -Id $processIdValue -ErrorAction SilentlyContinue
[pscustomobject]@{
  appName = if ($process) { $process.ProcessName } else { '' }
  windowTitle = $buffer.ToString()
} | ConvertTo-Json -Compress
`

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 3000, maxBuffer: 64 * 1024 }
    )
    const parsed = JSON.parse(stdout.trim() || '{}') as { appName?: string; windowTitle?: string }
    return { appName: parsed.appName ?? '', windowTitle: parsed.windowTitle ?? '' }
  } catch (error) {
    logger.warn('Windows foreground context unavailable', { error: String(error) })
    return { appName: '', windowTitle: '' }
  }
}

async function getActiveContext() {
  const privacy = store.getSettings().privacy
  if (!privacy.readAppName && !privacy.readWindowTitle) return { appName: '', windowTitle: '' }
  const active = await getWindowsForegroundContext()
  return {
    appName: privacy.readAppName ? active.appName : '',
    windowTitle: privacy.readWindowTitle ? active.windowTitle : ''
  }
}

async function getScreenCapture(): Promise<CapturePayload> {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const contextPromise = getActiveContext()
  const targetW = Math.max(1, Math.round(display.bounds.width * display.scaleFactor))
  const targetH = Math.max(1, Math.round(display.bounds.height * display.scaleFactor))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: targetW, height: targetH },
    fetchWindowIcons: false
  })
  const source = sources.find((s) => s.display_id === String(display.id))
    ?? sources.find((s) => s.thumbnail.getSize().width >= targetW * 0.8)
    ?? sources[0]
  if (!source) throw new Error('无法获取屏幕截图。请检查系统权限。')
  const context = await contextPromise
  return {
    dataUrl: source.thumbnail.toDataURL(),
    displayBounds: display.bounds,
    displayScaleFactor: display.scaleFactor,
    appName: context.appName,
    windowTitle: context.windowTitle,
    cursorPosition: { x: cursor.x - display.bounds.x, y: cursor.y - display.bounds.y }
  }
}

function rendererLocation(hash: string) {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) return { type: 'url' as const, value: `${dev}/#${hash}` }
  return { type: 'file' as const, value: path.join(__dirname, '../renderer/index.html') }
}

async function loadWindow(win: BrowserWindow, hash: string) {
  const target = rendererLocation(hash)
  if (target.type === 'url') await win.loadURL(target.value)
  else await win.loadFile(target.value, { hash })
}

function hardenOverlayWindow(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('will-redirect', (event) => event.preventDefault())
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

export async function startCapture(preloadPath: string) {
  if (captureStarting || (captureWindow && !captureWindow.isDestroyed())) return
  captureStarting = true
  const generation = ++captureGeneration
  try {
    // The main process applies privacy policy before replacing an existing Quick Layer.
    if (quickWindow && !quickWindow.isDestroyed()) quickWindow.close()
    try {
      const captured = await getScreenCapture()
      if (generation !== captureGeneration) return
      pendingCapture = captured
    } catch (error) {
      if (generation !== captureGeneration) return
      logger.error('Screenshot acquisition failed', { error: String(error) })
      throw error
    }
    const bounds = pendingCapture.displayBounds
    captureWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  hardenOverlayWindow(captureWindow)
  captureWindow.setAlwaysOnTop(true, 'screen-saver')
  try {
    await loadWindow(captureWindow, 'capture')
    captureWindow.show()
    captureWindow.focus()
    captureWindow.on('closed', () => { captureWindow = null })
    logger.info('Capture overlay opened', { display: bounds, scaleFactor: pendingCapture.displayScaleFactor })
    } catch (error) {
      try { captureWindow.destroy() } catch {}
      captureWindow = null
      pendingCapture = null
      logger.error('Capture overlay failed to load', { error: String(error) })
      throw new Error('截图覆盖层加载失败，请重试。')
    }
  } finally {
    captureStarting = false
  }
}

export function getPendingCapture() { return pendingCapture }

export async function completeCapture(rect: CaptureRect, preloadPath: string, renderedDataUrl?: string, visual?: VisualDescriptor) {
  if (!pendingCapture) throw new Error('没有待处理的截图')
  const boundedRect = clampDipRectToDisplay(rect, {
    width: pendingCapture.displayBounds.width,
    height: pendingCapture.displayBounds.height
  })
  if (boundedRect.width < 8 || boundedRect.height < 8) throw new Error('截图区域太小或超出当前显示器')

  const fullImage = nativeImage.createFromDataURL(pendingCapture.dataUrl)
  const size = fullImage.getSize()
  if (fullImage.isEmpty() || size.width < 1 || size.height < 1) {
    throw new Error('屏幕截图数据为空，请重试或检查系统截图权限。')
  }
  const crop = imageCropFromDipRect(
    boundedRect,
    size,
    { width: pendingCapture.displayBounds.width, height: pendingCapture.displayBounds.height }
  )
  // Renderer may send a pre-rendered crop when the user enabled the optional cursor marker.
  // Otherwise main process performs the DPI-aware crop from the original full-resolution source.
  const safeRenderedDataUrl = renderedDataUrl && renderedDataUrl.startsWith('data:image/png;base64,') && renderedDataUrl.length <= 64 * 1024 * 1024
    ? renderedDataUrl
    : undefined
  const rendered = safeRenderedDataUrl ? nativeImage.createFromDataURL(safeRenderedDataUrl) : null
  const renderedSize = rendered?.getSize()
  const renderedMatchesCrop = Boolean(
    rendered && !rendered.isEmpty() && renderedSize &&
    Math.abs(renderedSize.width - crop.width) <= 4 && Math.abs(renderedSize.height - crop.height) <= 4
  )
  const cropped = renderedMatchesCrop && rendered ? rendered : fullImage.crop(crop)
  const croppedSize = cropped.getSize()
  if (cropped.isEmpty() || croppedSize.width < 1 || croppedSize.height < 1) {
    throw new Error('选区截图为空，请重新框选。')
  }

  const privacy = store.getSettings().privacy
  if (isSensitiveApp(pendingCapture.appName, pendingCapture.windowTitle, privacy.sensitiveAppBlacklist)) {
    throw new Error('当前应用位于 SnapFlow 敏感应用黑名单中，已阻止截图。请在 Settings → Privacy 中调整后重试。')
  }

  const paths = getSnapFlowPaths()
  const id = randomUUID()
  const screenshotPath = path.join(paths.screenshots, `${id}.png`)
  const thumbnailPath = path.join(paths.thumbnails, `${id}.png`)
  let imageFingerprint = ''
  try {
    const screenshotBuffer = cropped.toPNG()
    imageFingerprint = createHash('sha256').update(screenshotBuffer).digest('hex')
    await writeBufferChunks(screenshotPath, screenshotBuffer)
    const sourceSize = cropped.getSize()
    const thumbWidth = Math.min(360, sourceSize.width)
    const thumbHeight = Math.max(1, Math.round(sourceSize.height * (thumbWidth / Math.max(1, sourceSize.width))))
    const thumbnailBuffer = cropped.resize({ width: thumbWidth, height: thumbHeight, quality: 'good' }).toPNG()
    await writeBufferChunks(thumbnailPath, thumbnailBuffer)
  } catch (error) {
    try { if (fs.existsSync(screenshotPath)) fs.unlinkSync(screenshotPath) } catch {}
    try { if (fs.existsSync(thumbnailPath)) fs.unlinkSync(thumbnailPath) } catch {}
    logger.error('Failed to save screenshot files', { error: String(error) })
    throw new Error('无法保存截图到本地数据目录，请检查磁盘空间或目录权限。')
  }

  const intent = heuristicIntent(pendingCapture.appName, pendingCapture.windowTitle)
  const now = new Date().toISOString()
  const recent = store.listCards().find((candidate) =>
    isThreadCandidate(candidate, pendingCapture?.appName || '', pendingCapture?.windowTitle || '')
  )

  const card: Card = {
    id,
    createdAt: now,
    updatedAt: now,
    title: intent.summary || 'New Screenshot',
    type: intent.type,
    appName: pendingCapture.appName,
    windowTitle: pendingCapture.windowTitle,
    screenshotPath,
    thumbnailPath,
    question: '',
    ocrText: intent.ocrText,
    summary: intent.summary,
    confidence: intent.confidence,
    actions: intent.actions,
    tags: intent.tags,
    answers: [],
    projectId: undefined,
    threadId: id,
    previousCardId: undefined,
    starred: false,
    imageFingerprint,
    visual: sanitizeVisualDescriptor(visual),
    metadata: {
      displayScaleFactor: pendingCapture.displayScaleFactor,
      captureRect: boundedRect,
      threadCandidateId: recent?.id || '',
      suggestedProjectId: recent?.projectId || ''
    }
  }
  try {
    store.createCard(card)
  } catch (error) {
    try { if (fs.existsSync(screenshotPath)) fs.unlinkSync(screenshotPath) } catch {}
    try { if (fs.existsSync(thumbnailPath)) fs.unlinkSync(thumbnailPath) } catch {}
    throw error
  }

  captureWindow?.close()
  captureWindow = null
  const displayBounds = pendingCapture.displayBounds
  pendingCapture = null

  const workArea = screen.getDisplayMatching(displayBounds).workArea
  const quickWidth = Math.max(420, Math.min(540, workArea.width - 20))
  const quickHeight = Math.max(360, Math.min(680, workArea.height - 20))
  const preferredX = displayBounds.x + boundedRect.x + boundedRect.width + 12
  const preferredY = displayBounds.y + boundedRect.y
  const quickX = Math.round(Math.max(workArea.x + 10, Math.min(preferredX, workArea.x + workArea.width - quickWidth - 10)))
  const quickY = Math.round(Math.max(workArea.y + 10, Math.min(preferredY, workArea.y + workArea.height - quickHeight - 10)))

  quickWindow = new BrowserWindow({
    width: quickWidth,
    height: quickHeight,
    x: quickX,
    y: quickY,
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minWidth: 420,
    minHeight: 360,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  hardenOverlayWindow(quickWindow)
  quickWindow.setAlwaysOnTop(true, 'floating')
  quickCardId = id
  try {
    await loadWindow(quickWindow, `quick=${id}`)
    quickWindow.show()
    quickWindow.focus()
    quickWindow.on('closed', () => { quickWindow = null; quickCardId = '' })
  } catch (error) {
    // The screenshot/Card are already safely stored. A Quick Layer renderer failure must
    // not turn a successful capture into data loss or leave a hidden BrowserWindow behind.
    try { quickWindow.destroy() } catch {}
    quickWindow = null
    quickCardId = ''
    logger.error('Quick Layer failed to load', { cardId: id, error: String(error) })
  }
  logger.info('Capture saved', { cardId: id, width: crop.width, height: crop.height, threadCandidate: recent?.id || '' })
  return card
}

export function cancelCapture() {
  captureGeneration += 1
  pendingCapture = null
  captureWindow?.close()
  captureWindow = null
  logger.info('Capture cancelled')
}

export function getQuickCardId() { return quickCardId }

export function closeQuickWindow() {
  quickWindow?.close()
  quickWindow = null
  quickCardId = ''
}
