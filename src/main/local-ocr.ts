import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { logger } from './logger'

const execFileAsync = promisify(execFile)

export type LocalOcrResult = { text: string; engine: 'windows' | 'tesseract' | 'none'; warning?: string }

async function tesseractOcr(filePath: string): Promise<LocalOcrResult> {
  try {
    const { stdout } = await execFileAsync('tesseract', [filePath, 'stdout', '-l', 'eng+chi_sim'], { windowsHide: true, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 })
    return { text: stdout.trim(), engine: 'tesseract' }
  } catch (error) {
    return { text: '', engine: 'none', warning: String(error) }
  }
}

async function windowsOcr(filePath: string): Promise<LocalOcrResult> {
  if (process.platform !== 'win32') return { text: '', engine: 'none', warning: 'Windows OCR requires Windows' }
  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'windows-ocr.ps1')
    : path.join(process.cwd(), 'scripts', 'windows-ocr.ps1')
  if (!fs.existsSync(scriptPath)) return { text: '', engine: 'none', warning: 'windows-ocr.ps1 missing' }
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', scriptPath, '-Path', filePath
    ], { windowsHide: true, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 })
    return { text: stdout.trim(), engine: 'windows' }
  } catch (error) {
    return { text: '', engine: 'none', warning: String(error) }
  }
}

export async function runLocalOcr(filePath: string, engine: 'auto' | 'windows' | 'tesseract' | 'off' = 'auto'): Promise<LocalOcrResult> {
  if (engine === 'off' || !filePath || !fs.existsSync(filePath)) return { text: '', engine: 'none' }
  if (engine === 'tesseract') return tesseractOcr(filePath)
  if (engine === 'windows') return windowsOcr(filePath)
  const native = await windowsOcr(filePath)
  if (native.text) return native
  const fallback = await tesseractOcr(filePath)
  if (!fallback.text && (native.warning || fallback.warning)) logger.info('Local OCR unavailable; visual provider can still refine intent', { native: native.warning, fallback: fallback.warning })
  return fallback.text ? fallback : native
}
