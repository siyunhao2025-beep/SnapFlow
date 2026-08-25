import type { Card, SemanticSearchResult } from './types'
import { visualDescriptorText, visualQueryScore } from './visual'

const DIMS = 96
function tokens(value: string) {
  return value.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}_+-]{2,}/gu) ?? []
}
function hashToken(value: string) {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
export function localSemanticVector(text: string, dims = DIMS) {
  const v = Array.from({ length: dims }, () => 0)
  const ts = tokens(text)
  for (const token of ts) {
    const h = hashToken(token)
    const index = h % dims
    v[index] += ((h >>> 8) & 1) ? 1 : -1
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1
  return v.map((x) => x / norm)
}
export function cosine(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length)
  let dot = 0, aa = 0, bb = 0
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i] }
  return dot / ((Math.sqrt(aa) || 1) * (Math.sqrt(bb) || 1))
}
export function cardSemanticText(card: Card) {
  return [card.title, card.summary, card.ocrText, card.question, card.appName, card.windowTitle, card.tags.join(' '), visualDescriptorText(card.visual), ...card.answers.slice(-3).map((x) => x.text)].join('\n')
}
export function searchCardsSemantic(cards: Card[], query: string, limit = 60): SemanticSearchResult[] {
  const q = localSemanticVector(query)
  return cards.map((card) => {
    const v = card.semanticVector?.length ? card.semanticVector : localSemanticVector(cardSemanticText(card))
    const semantic = cosine(q, v)
    const lexicalTokens = tokens(query)
    const haystack = cardSemanticText(card).toLowerCase()
    const lexical = lexicalTokens.length ? lexicalTokens.filter((x) => haystack.includes(x)).length / lexicalTokens.length : 0
    const visual = visualQueryScore(query, card.visual)
    const score = Math.max(-1, Math.min(1, semantic * .62 + lexical * .24 + visual * .14))
    const reasons = [semantic > .4 ? 'semantic' : '', lexical > 0 ? 'text' : '', visual > 0 ? 'visual-color' : '', card.imageFingerprint ? 'visual-fingerprint' : ''].filter(Boolean)
    return { card, score, reasons }
  }).filter((x) => x.score > .08).sort((a, b) => b.score - a.score).slice(0, limit)
}
