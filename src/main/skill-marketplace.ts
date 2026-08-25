import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { SkillMarketplaceItem } from '../shared/types'
import { installSkillContent, listSkills, uninstallUserSkill } from './skills'
import { store } from './store'

function bundledIndexPath() { return app.isPackaged ? path.join(process.resourcesPath, 'skill-marketplace.json') : path.join(process.cwd(), 'resources', 'skill-marketplace.json') }
function validateUrl(raw: string) { const u = new URL(raw); if (u.protocol !== 'https:') throw new Error('Marketplace URL must use HTTPS'); return u.toString() }

export async function listMarketplace(): Promise<SkillMarketplaceItem[]> {
  const installed = new Set(listSkills().map((x) => x.id))
  let items: any[] = []
  try { items = JSON.parse(fs.readFileSync(bundledIndexPath(), 'utf8'))?.skills || [] } catch {}
  const remote = store.getSettings().marketplaceIndexUrl
  if (store.getSettings().marketplaceEnabled && remote) {
    try {
      const response = await fetch(validateUrl(remote), { headers: { accept: 'application/json' } })
      if (response.ok) items = (await response.json())?.skills || items
    } catch {}
  }
  return items.filter((x) => x && typeof x.id === 'string').map((x) => ({
    id: String(x.id), name: String(x.name || x.id), description: String(x.description || ''), version: String(x.version || '1.0.0'), author: String(x.author || 'Unknown'),
    downloadUrl: typeof x.downloadUrl === 'string' ? x.downloadUrl : undefined,
    bundledContent: typeof x.bundledContent === 'string' ? x.bundledContent : undefined,
    installed: installed.has(String(x.id))
  }))
}

export async function installMarketplaceSkill(id: string) {
  const item = (await listMarketplace()).find((x) => x.id === id)
  if (!item) throw new Error('Marketplace skill not found')
  let content = item.bundledContent || ''
  if (!content && item.downloadUrl) {
    const response = await fetch(validateUrl(item.downloadUrl), { headers: { accept: 'text/markdown,text/plain' } })
    if (!response.ok) throw new Error(`Skill download failed (${response.status})`)
    content = await response.text()
  }
  if (!content) throw new Error('Skill package has no content')
  return installSkillContent(content, 'marketplace')
}
export function uninstallMarketplaceSkill(id: string) { return uninstallUserSkill(id) }
