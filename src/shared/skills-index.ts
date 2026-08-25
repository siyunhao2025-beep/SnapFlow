import type { SkillDefinition } from './types'
import { validateSkill } from './skill-schema'

export class SkillsIndex {
  private readonly map = new Map<string, SkillDefinition>()
  add(value: Partial<SkillDefinition>) {
    const checked = validateSkill(value)
    if (!checked.ok) return { ok: false as const, errors: checked.errors }
    this.map.set(checked.skill.id, checked.skill)
    return { ok: true as const, skill: checked.skill }
  }
  get(id: string) { return this.map.get(id) }
  has(id: string) { return this.map.has(id) }
  values() { return [...this.map.values()] }
  clear() { this.map.clear() }
}
