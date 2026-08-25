import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { SkillDefinition } from '../shared/types'
import { logger } from './logger'
import { validateSkill } from '../shared/skill-schema'
import { SkillsIndex } from '../shared/skills-index'
import { getSnapFlowPaths } from './paths'

function parseList(value: string | undefined) { return (value || '').split(',').map((x) => x.trim()).filter(Boolean) }

export function parseSkillContent(raw: string, source: SkillDefinition['source'] = 'bundled'): SkillDefinition | null {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) return null
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  const validated = validateSkill({
    id: meta.id, name: meta.name, description: meta.description || '',
    supportedIntent: parseList(meta.supportedIntent) as any,
    preferredModels: parseList(meta.preferredModels), actions: parseList(meta.actions), systemPrompt: match[2].trim(),
    source, version: meta.version || '1.0.0', author: meta.author || (source === 'bundled' ? 'SnapFlow' : 'User')
  })
  if (!validated.ok) {
    const errors = 'errors' in validated ? validated.errors : ['Unknown skill validation error']
    logger.warn('Invalid skill schema', { errors })
    return null
  }
  return validated.skill
}

function skillDirs() {
  const bundled = app.isPackaged ? path.join(process.resourcesPath, 'skills') : path.join(process.cwd(), 'resources', 'skills')
  const user = path.join(getSnapFlowPaths().root, 'skills')
  fs.mkdirSync(user, { recursive: true })
  return { bundled, user }
}

function readDir(dir: string, source: SkillDefinition['source']) {
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith('.md')).map((name) => {
      try { return parseSkillContent(fs.readFileSync(path.join(dir, name), 'utf8'), source) }
      catch (error) { logger.warn('Failed to parse skill', { file: name, error: String(error) }); return null }
    }).filter((item): item is SkillDefinition => Boolean(item))
  } catch { return [] }
}

export function listSkills(): SkillDefinition[] {
  const { bundled, user } = skillDirs()
  const index = new SkillsIndex()
  for (const skill of readDir(bundled, 'bundled')) index.add(skill)
  for (const skill of readDir(user, 'user')) index.add({ ...skill, source: 'user' })
  return index.values().sort((a, b) => a.name.localeCompare(b.name))
}

export function getSkill(id?: string) { return id ? listSkills().find((skill) => skill.id === id) || null : null }

export function installSkillContent(content: string, source: SkillDefinition['source'] = 'marketplace') {
  const skill = parseSkillContent(content, source)
  if (!skill) throw new Error('Skill schema validation failed')
  const { user } = skillDirs()
  const safeName = `${skill.id}.md`
  const target = path.join(user, safeName)
  fs.writeFileSync(target, content, 'utf8')
  return { ...skill, source }
}

export function uninstallUserSkill(id: string) {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '')
  if (!safe) return false
  const file = path.join(skillDirs().user, `${safe}.md`)
  if (!fs.existsSync(file)) return false
  fs.unlinkSync(file)
  return true
}
