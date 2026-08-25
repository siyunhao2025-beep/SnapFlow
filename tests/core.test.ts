import test from 'node:test'
import assert from 'node:assert/strict'
import { heuristicIntent } from '../src/shared/intent'
import { rankProviderCandidates, shouldRequireVisionForCard } from '../src/shared/model-router'
import { cardMatchesSearch } from '../src/shared/search'
import { isThreadCandidate } from '../src/shared/thread'
import { estimateCredits } from '../src/main/credits'
import { clampDipRectToDisplay, imageCropFromDipRect, pointInsideRect, rectFromPoints } from '../src/shared/capture-math'
import { derivePasswordHash, normalizeAuthDisplayName, normalizeAuthEmail, normalizeAuthPassword, secureHexEqual } from '../src/shared/auth-core'
import type { Card } from '../src/shared/types'
import { providerSendsTemperature } from '../src/shared/provider-policy'
import { sanitizeRendererCardPatch } from '../src/shared/card-patch'

function card(patch: Partial<Card> = {}): Card {
  return {
    id: 'c1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    title: 'NetCDF broadcasting error', type: 'programming_error', appName: 'PyCharm',
    windowTitle: 'global.py', screenshotPath: 'x.png', question: 'why', ocrText: 'ValueError broadcast',
    summary: 'error', confidence: .8, actions: ['解释'], tags: ['Python', 'SABER'], answers: [], starred: false,
    ...patch
  }
}

test('intentRouter classifies traceback errors', () => {
  assert.equal(heuristicIntent('PyCharm', 'Traceback ValueError').type, 'programming_error')
})

test('modelRouter prioritizes coding-capable provider', () => {
  const ranked = rankProviderCandidates('programming_error', false, [], [
    { id: 'gemini', supportsVision: true, speed: 'fast', costWeight: .8 },
    { id: 'anthropic', supportsVision: true, speed: 'balanced', costWeight: 1.2 },
    { id: 'openai', supportsVision: true, speed: 'balanced', costWeight: 1.2 }
  ])
  assert.equal(ranked[0].id, 'anthropic')
})

test('quota estimates local ollama as zero credits', () => {
  assert.equal(estimateCredits('ollama', { inputTokens: 1000, outputTokens: 1000 }), 0)
  assert.ok(estimateCredits('openai', { inputTokens: 1000, outputTokens: 1000 }) > 0)
})

test('thread grouping requires same app and recent time', () => {
  const recent = card({ createdAt: new Date(Date.now() - 60_000).toISOString() })
  assert.equal(isThreadCandidate(recent, 'PyCharm', 'global.py — SABER'), true)
  assert.equal(isThreadCandidate(recent, 'Chrome', 'global.py'), false)
})

test('search spans OCR, answer, tag, application and project', () => {
  const c = card({ answers: [{ id: 'a', provider: 'openai', model: 'm', action: '解释', text: 'array mismatch', createdAt: new Date().toISOString(), credits: 1 }] })
  assert.equal(cardMatchesSearch(c, 'broadcast SABER'), true)
  assert.equal(cardMatchesSearch(c, 'array mismatch'), true)
  assert.equal(cardMatchesSearch(c, 'paper'), false)
  assert.equal(cardMatchesSearch(c, 'research', 'Research Project'), true)
})


test('vision routing requires image understanding when OCR is missing', () => {
  assert.equal(shouldRequireVisionForCard('programming_error', true, ''), true)
  assert.equal(shouldRequireVisionForCard('code', true, 'const x = 1'), false)
  assert.equal(shouldRequireVisionForCard('scientific_figure', true, 'Figure 3'), true)
  assert.equal(shouldRequireVisionForCard('general', false, ''), false)
})

test('capture rect is correct for reverse drag', () => {
  assert.deepEqual(rectFromPoints({ x: 400, y: 300 }, { x: 100, y: 80 }), { x: 100, y: 80, width: 300, height: 220 })
})

test('capture crop maps 125 percent DPI without offset', () => {
  assert.deepEqual(
    imageCropFromDipRect({ x: 100, y: 80, width: 400, height: 240 }, { width: 2400, height: 1350 }, { width: 1920, height: 1080 }),
    { x: 125, y: 100, width: 500, height: 300 }
  )
})

test('capture crop maps 150 percent DPI and clips to screen edge', () => {
  assert.deepEqual(
    imageCropFromDipRect({ x: 1800, y: 1000, width: 300, height: 200 }, { width: 2880, height: 1620 }, { width: 1920, height: 1080 }),
    { x: 2700, y: 1500, width: 180, height: 120 }
  )
})

test('cursor inclusion uses selection coordinates', () => {
  const rect = { x: 20, y: 30, width: 100, height: 80 }
  assert.equal(pointInsideRect({ x: 20, y: 30 }, rect), true)
  assert.equal(pointInsideRect({ x: 120, y: 110 }, rect), true)
  assert.equal(pointInsideRect({ x: 121, y: 110 }, rect), false)
})

test('thread grouping rejects future and stale cards', () => {
  assert.equal(isThreadCandidate(card({ createdAt: new Date(Date.now() + 1000).toISOString() }), 'PyCharm', 'global.py'), false)
  assert.equal(isThreadCandidate(card({ createdAt: new Date(Date.now() - 16 * 60_000).toISOString() }), 'PyCharm', 'global.py'), false)
})

test('search is case-insensitive and token based', () => {
  const c = card({ title: 'SABER Temperature Response', ocrText: 'Dst minimum -236 nT' })
  assert.equal(cardMatchesSearch(c, 'saber -236'), true)
  assert.equal(cardMatchesSearch(c, 'SABER 999'), false)
})

test('model router never rewards non-vision candidates for vision need', () => {
  const ranked = rankProviderCandidates('scientific_figure', true, [], [
    { id: 'deepseek', supportsVision: false, speed: 'balanced', costWeight: .4 },
    { id: 'gemini', supportsVision: true, speed: 'fast', costWeight: .8 }
  ])
  assert.equal(ranked[0].id, 'gemini')
})


test('local auth normalizes email and display name', () => {
  assert.equal(normalizeAuthEmail('  User@Example.COM '), 'user@example.com')
  assert.equal(normalizeAuthDisplayName('  Yunhao   Si  '), 'Yunhao Si')
  assert.throws(() => normalizeAuthEmail('not-an-email'))
  assert.throws(() => normalizeAuthPassword('short'))
})

test('local auth password verifier is salted and timing-safe comparable', () => {
  const password = normalizeAuthPassword('correct horse battery staple')
  const one = derivePasswordHash(password, '00112233445566778899aabbccddeeff')
  const two = derivePasswordHash(password, 'ffeeddccbbaa99887766554433221100')
  assert.notEqual(one, two)
  assert.equal(secureHexEqual(one, derivePasswordHash(password, '00112233445566778899aabbccddeeff')), true)
  assert.equal(secureHexEqual(one, derivePasswordHash('wrong password', '00112233445566778899aabbccddeeff')), false)
})


test('provider compatibility omits unsupported sampling parameters', () => {
  assert.equal(providerSendsTemperature('anthropic', 'claude-sonnet-4-20250514', 'https://api.anthropic.com/v1'), false)
  assert.equal(providerSendsTemperature('gemini', 'gemini-3.7-flash', 'https://generativelanguage.googleapis.com/v1beta'), false)
  assert.equal(providerSendsTemperature('deepseek', 'deepseek-v4-pro', 'https://api.deepseek.com'), false)
  assert.equal(providerSendsTemperature('openai', 'gpt-5.6-luna', 'https://api.openai.com/v1'), false)
  assert.equal(providerSendsTemperature('openrouter', 'openai/gpt-5.6-luna', 'https://openrouter.ai/api/v1'), false)
  assert.equal(providerSendsTemperature('openrouter', 'google/gemini-2.5-flash', 'https://openrouter.ai/api/v1'), true)
  assert.equal(providerSendsTemperature('openai', 'gpt-5.6-sol', 'https://my-compatible.example/v1'), false)
})


test('card patch preserves project unless projectId is explicitly changed', () => {
  const starOnly = sanitizeRendererCardPatch({ starred: true })
  assert.equal(Object.prototype.hasOwnProperty.call(starOnly, 'projectId'), false)
  const tagsOnly = sanitizeRendererCardPatch({ tags: ['SABER'] })
  assert.equal(Object.prototype.hasOwnProperty.call(tagsOnly, 'projectId'), false)
  const removeProject = sanitizeRendererCardPatch({ projectId: undefined })
  assert.equal(Object.prototype.hasOwnProperty.call(removeProject, 'projectId'), true)
  assert.equal(removeProject.projectId, undefined)
})


test('capture rect is clamped to display DIP bounds before cropping', () => {
  assert.deepEqual(
    clampDipRectToDisplay({ x: -50, y: -20, width: 200, height: 100 }, { width: 1920, height: 1080 }),
    { x: 0, y: 0, width: 150, height: 80 }
  )
  assert.deepEqual(
    clampDipRectToDisplay({ x: 1900, y: 1060, width: 100, height: 100 }, { width: 1920, height: 1080 }),
    { x: 1900, y: 1060, width: 20, height: 20 }
  )
})

test('capture rect fully outside display becomes empty and can be rejected by main', () => {
  assert.deepEqual(
    clampDipRectToDisplay({ x: 2100, y: 1200, width: 100, height: 100 }, { width: 1920, height: 1080 }),
    { x: 1920, y: 1080, width: 0, height: 0 }
  )
})

test('renderer card patch rejects main-owned metadata fields', () => {
  const patch = sanitizeRendererCardPatch({ metadata: { routerProvider: 'openai', suggestedProjectId: 'project_x' } } as any)
  assert.equal(patch.metadata, undefined)
  const clearSuggestion = sanitizeRendererCardPatch({ metadata: { suggestedProjectId: '' } } as any)
  assert.deepEqual(clearSuggestion.metadata, { suggestedProjectId: '' })
})

test('intent router recognizes equations and tabular content from context clues', () => {
  assert.equal(heuristicIntent('Word', 'Equation Editor integral matrix').type, 'equation')
  assert.ok(['table', 'excel'].includes(heuristicIntent('Excel', 'Workbook Sheet1').type))
})

test('auth rejects overlong password and malformed email', () => {
  assert.throws(() => normalizeAuthPassword('x'.repeat(257)))
  assert.throws(() => normalizeAuthEmail('a@b'))
})

import { ProviderError, classifyProviderError } from '../src/shared/errors'
import { TokenBucket, compareSchema } from '../src/shared/provider-policy'
import { renderSafeMarkdown } from '../src/shared/sanitize'
import { validateSkill } from '../src/shared/skill-schema'
import { localSemanticVector, cosine, searchCardsSemantic } from '../src/shared/semantic'
import { redactSensitiveText, isSensitiveApp } from '../src/shared/privacy'
import { deriveWorkflowRecommendations } from '../src/shared/workflow'

test('provider errors classify auth and rate limits', () => {
  assert.equal(classifyProviderError(new Error('HTTP 401 invalid API key')).code, 'auth')
  assert.equal(classifyProviderError(new Error('429 rate limit reached')).code, 'rate')
  assert.equal(new ProviderError('timeout', { code: 'timeout' }).code, 'timeout')
})

test('token bucket blocks requests beyond configured burst', () => {
  const bucket = new TokenBucket(3)
  assert.equal(bucket.take(), 0)
  assert.equal(bucket.take(), 0)
  assert.equal(bucket.take(), 0)
  assert.ok(bucket.take() > 0)
})

test('safe markdown escapes script tags and strips javascript URLs', () => {
  const html = renderSafeMarkdown('<script>alert(1)</script>\n[bad](javascript:alert(1))\n**ok**')
  assert.equal(html.includes('<script>'), false)
  assert.equal(html.includes('href="javascript:'), false)
  assert.equal(html.includes('<strong>ok</strong>'), true)
})

const validSkill = {
  id: 'paper-review', name: 'Paper Review', description: 'Review a paper',
  supportedIntent: ['paper' as const], preferredModels: ['auto'], actions: ['Review'], systemPrompt: 'Be rigorous.'
}
for (let i = 0; i < 6; i++) test(`skill schema accepts valid definition ${i + 1}`, () => {
  const result = validateSkill({ ...validSkill, id: `paper-review-${i}`, actions: [`Review ${i}`] })
  assert.equal(result.ok, true)
})

test('skill schema rejects missing system prompt', () => {
  const result = validateSkill({ ...validSkill, systemPrompt: '' })
  assert.equal(result.ok, false)
})

test('semantic vectors are deterministic and related text ranks higher', () => {
  const a = localSemanticVector('SABER geomagnetic storm temperature')
  const b = localSemanticVector('SABER storm temperature response')
  const c = localSemanticVector('cooking recipe tomato pasta')
  assert.ok(cosine(a, b) > cosine(a, c))
  const results = searchCardsSemantic([
    card({ id: 'a', title: 'SABER storm', ocrText: 'temperature Dst geomagnetic storm' }),
    card({ id: 'b', title: 'Recipe', ocrText: 'tomato pasta cooking' })
  ], 'geomagnetic temperature')
  assert.equal(results[0].card.id, 'a')
})

test('privacy redaction masks email and phone without changing unrelated text', () => {
  const out = redactSensitiveText('mail user@example.com phone 13800138000 SABER', { email: true, phone: true })
  assert.equal(out.includes('user@example.com'), false)
  assert.equal(out.includes('13800138000'), false)
  assert.equal(out.includes('SABER'), true)
})

test('sensitive app blacklist blocks password managers', () => {
  assert.equal(isSensitiveApp('Bitwarden', 'Vault', ['Bitwarden', 'Bank']), true)
  assert.equal(isSensitiveApp('PyCharm', 'global.py', ['Bitwarden', 'Bank']), false)
})

test('learned workflow appears only after repeated real-provider actions', () => {
  const answer = { id: 'x', provider: 'openai' as const, model: 'm', action: '修复', text: 'ok', createdAt: new Date().toISOString(), credits: 1 }
  const cards = [1,2,3].map((n) => card({ id: String(n), answers: [{ ...answer, id: String(n) }] }))
  const recs = deriveWorkflowRecommendations(cards)
  assert.ok(recs.some((r) => r.provider === 'openai' && r.action === '修复' && r.count >= 3))
})

test('compare schema is data driven and has unique provider/model ids', () => {
  const ids = compareSchema.map((x) => x.provider)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(compareSchema.length >= 3)
})


import { visualQueryScore } from '../src/shared/visual'

test('visual semantic search boosts color descriptions', () => {
  const blue = { dominantColors: ['blue','cyan'], averageRgb: { r: 20, g: 110, b: 220 }, brightness: .5, saturation: .8, edgeDensity: .2, aspectRatio: 1.6, isDark: false }
  const red = { ...blue, dominantColors: ['red'], averageRgb: { r: 220, g: 30, b: 30 } }
  assert.ok(visualQueryScore('前几天那个蓝色科研图', blue) > visualQueryScore('前几天那个蓝色科研图', red))
  const results = searchCardsSemantic([card({ id: 'blue', title: 'Figure', visual: blue }), card({ id: 'red', title: 'Figure', visual: red })], '蓝色 Figure')
  assert.equal(results[0].card.id, 'blue')
})

import { SkillsIndex } from '../src/shared/skills-index'
test('skills index is data driven and rejects malformed entries', () => {
  const index = new SkillsIndex()
  assert.equal(index.add(validSkill).ok, true)
  assert.equal(index.has(validSkill.id), true)
  assert.equal(index.add({ ...validSkill, id: 'bad skill id' }).ok, false)
  assert.equal(index.values().length, 1)
})
