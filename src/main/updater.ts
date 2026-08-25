import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { app, BrowserWindow } from 'electron'
import type { UpdateState } from '../shared/types'
import { store } from './store'
import { logger } from './logger'

let state: UpdateState = { status: 'disabled' }
let started = false
let latestExpectedSha = ''
let latestVersion = ''

function emit(next: UpdateState) {
  state = next
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('update:state', state)
}
function safeManifestUrl(raw: string) {
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('Update manifest must use HTTPS')
  return url.toString()
}
async function fetchManifest(url: string) {
  const response = await fetch(safeManifestUrl(url), { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`Update manifest HTTP ${response.status}`)
  const body = await response.json() as any
  if (!body?.version) throw new Error('Update manifest has no version')
  latestExpectedSha = typeof body.sha256 === 'string' ? body.sha256.toLowerCase() : ''
  latestVersion = String(body.version)
  return body
}
async function sha256File(file: string) {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

export class UpdaterService {
  status() { return state }
  async checkNow() {
    const cfg = store.getSettings().updates
    if (!cfg.enabled || !cfg.manifestUrl || !app.isPackaged) { emit({ status: cfg.enabled ? 'error' : 'disabled', message: cfg.enabled ? 'Updater requires a packaged build and manifest URL' : 'Auto update disabled' }); return state }
    try {
      emit({ status: 'checking' })
      const manifest = await fetchManifest(cfg.manifestUrl)
      if (manifest.minSupported && String(app.getVersion()).localeCompare(String(manifest.minSupported), undefined, { numeric: true }) < 0) logger.warn('Current version is below minSupported', { current: app.getVersion(), minSupported: manifest.minSupported })
      const module = await import('electron-updater') as any
      const autoUpdater = module.autoUpdater
      const base = new URL(cfg.manifestUrl); base.pathname = base.pathname.replace(/[^/]+$/, '')
      autoUpdater.setFeedURL({ provider: 'generic', url: String(manifest.updateBaseUrl || base.toString()), channel: cfg.channel })
      autoUpdater.autoDownload = Boolean(cfg.autoDownload)
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.removeAllListeners('update-available')
      autoUpdater.removeAllListeners('update-not-available')
      autoUpdater.removeAllListeners('download-progress')
      autoUpdater.removeAllListeners('update-downloaded')
      autoUpdater.removeAllListeners('error')
      autoUpdater.on('update-available', (info: any) => emit({ status: 'available', version: info?.version || latestVersion }))
      autoUpdater.on('update-not-available', () => emit({ status: 'idle', version: app.getVersion(), message: 'Up to date' }))
      autoUpdater.on('download-progress', (progress: any) => emit({ status: 'downloading', version: latestVersion, progress: Number(progress?.percent || 0) }))
      autoUpdater.on('update-downloaded', (event: any) => {
        const file = String(event?.downloadedFile || '')
        if (latestExpectedSha) {
          if (!file || !fs.existsSync(file)) {
            emit({ status: 'error', version: latestVersion, message: 'Update file path missing; checksum cannot be verified.' })
            return
          }
          void sha256File(file).then((actual) => {
            if (actual !== latestExpectedSha) {
              try { fs.unlinkSync(file) } catch {}
              emit({ status: 'error', version: latestVersion, message: 'Update SHA-256 mismatch. Download discarded.' })
              return
            }
            emit({ status: 'downloaded', version: event?.version || latestVersion, progress: 100 })
          }).catch((error) => emit({ status: 'error', message: error instanceof Error ? error.message : String(error) }))
          return
        }
        logger.warn('Update manifest has no SHA-256; integrity relies on electron-updater metadata/signing')
        emit({ status: 'downloaded', version: event?.version || latestVersion, progress: 100 })
      })
      autoUpdater.on('error', (error: Error) => emit({ status: 'error', message: error.message }))
      await autoUpdater.checkForUpdates()
      return state
    } catch (error) {
      logger.warn('Update check failed', { error: String(error) })
      emit({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      return state
    }
  }
  async download() {
    const module = await import('electron-updater') as any
    emit({ status: 'downloading', version: latestVersion, progress: 0 })
    await module.autoUpdater.downloadUpdate()
    return state
  }
  async install() {
    const module = await import('electron-updater') as any
    module.autoUpdater.quitAndInstall(false, true)
  }
  start() {
    if (started) return
    started = true
    const cfg = store.getSettings().updates
    if (!cfg.enabled) { emit({ status: 'disabled' }); return }
    setTimeout(() => void this.checkNow(), 30_000).unref?.()
    setInterval(() => void this.checkNow(), 6 * 60 * 60 * 1000).unref?.()
  }
}
export const updaterService = new UpdaterService()
