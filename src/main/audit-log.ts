import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ProviderAuditEntry, ProviderId } from '../shared/types'
import { getSnapFlowPaths } from './paths'
import { redactSensitiveText } from '../shared/privacy'

const MAX_BYTES = 5 * 1024 * 1024
function fileForDate(date = new Date()) { return path.join(getSnapFlowPaths().logs, `provider-${date.toISOString().slice(0, 10)}.jsonl`) }
function safeSnippet(value: string) {
  return redactSensitiveText(value)
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9._-]{8,}\b/gi, '[REDACTED_KEY]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi, 'Bearer [REDACTED]')
    .replace(/(["']?(?:api[-_ ]?key|authorization|x-api-key)["']?\s*[:=]\s*["']?)[^"'\s,}]{8,}/gi, '$1[REDACTED]')
    .slice(0, 240)
}
export function imageHash(buffer?: Uint8Array) { return buffer?.length ? createHash('sha256').update(buffer).digest('hex') : undefined }

function rotate(file: string) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < MAX_BYTES) return
    const rotated = file.replace(/\.jsonl$/, `-${Date.now()}.jsonl`)
    fs.renameSync(file, rotated)
  } catch {}
}

export function writeProviderAudit(entry: ProviderAuditEntry) {
  const file = fileForDate(new Date(entry.ts))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  rotate(file)
  const sanitized: ProviderAuditEntry = { ...entry, textSnippetRedacted: safeSnippet(entry.textSnippetRedacted) }
  fs.appendFileSync(file, `${JSON.stringify(sanitized)}\n`, 'utf8')
}

export function readRecentProviderAudit(provider?: ProviderId, limit = 5): ProviderAuditEntry[] {
  const files = fs.existsSync(getSnapFlowPaths().logs)
    ? fs.readdirSync(getSnapFlowPaths().logs).filter((x) => /^provider-.*\.jsonl$/.test(x)).sort().reverse().slice(0, 7)
    : []
  const entries: ProviderAuditEntry[] = []
  for (const name of files) {
    try {
      const lines = fs.readFileSync(path.join(getSnapFlowPaths().logs, name), 'utf8').trim().split('\n').reverse()
      for (const line of lines) {
        if (!line.trim()) continue
        const item = JSON.parse(line) as ProviderAuditEntry
        if (!provider || item.provider === provider) entries.push(item)
        if (entries.length >= limit) return entries
      }
    } catch {}
  }
  return entries
}
