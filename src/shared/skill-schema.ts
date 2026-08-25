import type { IntentType, SkillDefinition } from './types'

const intents = new Set<IntentType>(['programming_error','code','paper','scientific_figure','chart','table','excel','webpage','equation','pdf','software_ui','translation','document','general','unknown'])

export function validateSkill(value: Partial<SkillDefinition>): { ok: true; skill: SkillDefinition } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const id = String(value.id || '').trim()
  const name = String(value.name || '').trim()
  const description = String(value.description || '').trim()
  const systemPrompt = String(value.systemPrompt || '').trim()
  const supportedIntent = Array.isArray(value.supportedIntent) ? value.supportedIntent.filter((x): x is IntentType => intents.has(x as IntentType)) : []
  const preferredModels = Array.isArray(value.preferredModels) ? value.preferredModels.filter((x): x is string => typeof x === 'string' && Boolean(x.trim())) : []
  const actions = Array.isArray(value.actions) ? value.actions.filter((x): x is string => typeof x === 'string' && Boolean(x.trim())) : []
  if (!/^[a-z0-9][a-z0-9-_]{1,80}$/i.test(id)) errors.push('id')
  if (!name) errors.push('name')
  if (!description) errors.push('description')
  if (!supportedIntent.length) errors.push('supportedIntent')
  if (!actions.length) errors.push('actions')
  if (!systemPrompt) errors.push('systemPrompt')
  if (errors.length) return { ok: false, errors }
  return { ok: true, skill: { id, name, description, supportedIntent, preferredModels, actions, systemPrompt, source: value.source, version: value.version, author: value.author } }
}
