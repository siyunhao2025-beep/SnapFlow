import type { Card } from './types'

export function cardMatchesSearch(card: Card, query: string, projectName = '') {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  const haystack = [
    card.title, card.type, card.appName, card.windowTitle, card.ocrText, card.summary,
    card.question, card.tags.join(' '), projectName,
    ...card.answers.map((a) => `${a.provider} ${a.model} ${a.action} ${a.text}`)
  ].join('\n').toLowerCase()
  return tokens.every((token) => haystack.includes(token))
}
