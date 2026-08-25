import fs from 'node:fs'
import path from 'node:path'
import { getSnapFlowPaths } from './paths'

function sanitize(message: unknown) {
  const text = typeof message === 'string' ? message : message instanceof Error ? message.stack || message.message : JSON.stringify(message)
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED_KEY]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_KEY]')
    .replace(/xai-[0-9A-Za-z_-]{12,}/gi, '[REDACTED_KEY]')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(api[_ -]?key\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 12000)
}

function rotateIfNeeded(filePath: string) {
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 5 * 1024 * 1024) return
    const backup = `${filePath}.1`
    try { if (fs.existsSync(backup)) fs.unlinkSync(backup) } catch {}
    fs.renameSync(filePath, backup)
  } catch {
    // Rotation is best-effort.
  }
}

function append(file: 'app.log' | 'error.log', level: string, message: unknown, meta?: Record<string, unknown>) {
  try {
    const filePath = path.join(getSnapFlowPaths().logs, file)
    rotateIfNeeded(filePath)
    const line = `${new Date().toISOString()} [${level}] ${sanitize(message)}${meta ? ` ${sanitize(meta)}` : ''}\n`
    fs.appendFileSync(filePath, line, 'utf8')
  } catch {
    // Logging must never crash the desktop process.
  }
}

export const logger = {
  info(message: unknown, meta?: Record<string, unknown>) { append('app.log', 'INFO', message, meta) },
  warn(message: unknown, meta?: Record<string, unknown>) { append('app.log', 'WARN', message, meta) },
  error(message: unknown, meta?: Record<string, unknown>) { append('error.log', 'ERROR', message, meta) }
}
