import { store } from './store'
import { callProvider, providerHasCredential } from './providers'
import type { AiUsage, Card, IntentResult, IntentType, ProviderId, SkillDefinition } from '../shared/types'
import { actionMap } from '../shared/intent'
export { actionMap, heuristicIntent } from '../shared/intent'
import { rankProviderCandidates, shouldRequireVisionForCard } from '../shared/model-router'
import { getRegisteredModel } from './models'

function tr(zh: string, en: string) {
  return store.getSettings().locale === 'en-US' ? en : zh
}

function parseJsonLoose(text: string): any | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try { return JSON.parse(cleaned) } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)) } catch { return null }
    }
    return null
  }
}

function availableProviders(requireVision = false): ProviderId[] {
  const settings = store.getSettings()
  return (Object.keys(settings.providers) as ProviderId[]).filter((id) => {
    const p = settings.providers[id]
    return p.enabled && (!requireVision || p.supportsVision) && providerHasCredential(id)
  })
}

export function selectProviderDetailed(card: Card, requested: ProviderId | 'auto'):
  { provider: ProviderId | null; model: string; reason: string; isAuto: boolean } {
  const settings = store.getSettings()
  const imageStillAvailable = Boolean(card.screenshotPath)
  const needsVision = shouldRequireVisionForCard(card.type, imageStillAvailable, card.ocrText)

  if (requested !== 'auto') {
    const cfg = settings.providers[requested]
    const hasCredential = providerHasCredential(requested)
    const visionMismatch = needsVision && !cfg.supportsVision
    return {
      provider: cfg.enabled && hasCredential && !visionMismatch ? requested : null,
      model: cfg.model,
      reason: !cfg.enabled
        ? tr(`${cfg.label} 未启用`, `${cfg.label} is disabled`)
        : !hasCredential
          ? tr(`${cfg.label} 未配置凭据或本地服务`, `${cfg.label} has no credential or reachable local service`)
          : visionMismatch
            ? tr(`${cfg.label} 当前模型被标记为不支持图片输入；请开启视觉能力、等待 OCR 完成或切换视觉模型`, `${cfg.label}'s current model is marked as text-only. Enable vision only if the model supports it, wait for OCR, or switch to a vision model.`)
            : tr(`手动选择 ${cfg.label}`, `Manual selection: ${cfg.label}`),
      isAuto: false
    }
  }

  const available = availableProviders(needsVision)
  if (!available.length) return { provider: null, model: 'SnapFlow Demo Mock', reason: tr('没有已配置的可用 Provider，进入演示模式', 'No configured Provider is available; using Demo Mode'), isAuto: true }

  const ranked = rankProviderCandidates(card.type, needsVision, card.tags, available.map((id) => {
    const cfg = settings.providers[id]
    const model = getRegisteredModel(id, cfg.model)
    return { id, supportsVision: cfg.supportsVision, speed: model?.speed, costWeight: model?.costWeight }
  }))
  const provider = ranked[0].id
  const cfg = settings.providers[provider]
  return {
    provider,
    model: cfg.model,
    reason: tr(`Auto：${card.type} · ${cfg.supportsVision ? '支持视觉' : '文本'} · 当前已配置`, `Auto: ${card.type} · ${cfg.supportsVision ? 'vision' : 'text'} · configured`),
    isAuto: true
  }
}

export function selectProvider(card: Card, requested: ProviderId | 'auto') {
  return selectProviderDetailed(card, requested).provider
}

export type IntentRefinement = {
  intent: IntentResult
  provider: ProviderId
  model: string
  usage?: AiUsage
}

export async function refineIntent(card: Card): Promise<IntentRefinement | null> {
  const settings = store.getSettings()
  const available = availableProviders(true)
  if (!available.length || !card.screenshotPath) return null
  let provider: ProviderId
  if (settings.routerProvider !== 'auto' && available.includes(settings.routerProvider)) provider = settings.routerProvider
  else provider = (['gemini', 'openai', 'openrouter', 'xai', 'anthropic', 'ollama'].find((id) => available.includes(id as ProviderId)) as ProviderId) || available[0]

  const prompt = `你是 SnapFlow 的高速截图意图路由器。只返回 JSON，不要 Markdown。\n\n请观察截图，并结合应用信息：\napp=${card.appName}\nwindow=${card.windowTitle}\n\n返回：\n{\n  "type": "programming_error|code|paper|scientific_figure|chart|table|excel|webpage|equation|pdf|software_ui|translation|document|general|unknown",\n  "language": "主要语言",\n  "confidence": 0到1,\n  "ocrText": "尽量完整提取截图内可读文字，无法确认的不要编造",\n  "summary": "不超过40字的内容概括",\n  "actions": ["最值得用户下一步点击的3到5个动作"],\n  "tags": ["3到6个简短标签"]\n}\n\n规则：报错优先 programming_error；论文图、科研折线图、热图用 scientific_figure；普通统计图用 chart；论文正文用 paper；公式为主用 equation；应用设置/界面操作用 software_ui。`

  try {
    const result = await callProvider({ provider, prompt, screenshotPath: card.screenshotPath, ocrText: card.ocrText })
    const parsed = parseJsonLoose(result.text)
    if (!parsed) return null
    const type = actionMap[parsed.type as IntentType] ? (parsed.type as IntentType) : 'unknown'
    return {
      intent: {
        type,
        language: String(parsed.language || 'unknown').trim().slice(0, 80) || 'unknown',
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
        ocrText: String(parsed.ocrText || '').slice(0, 50_000),
        summary: String(parsed.summary || card.title).trim().slice(0, 240) || card.title,
        actions: Array.isArray(parsed.actions) && parsed.actions.length
          ? parsed.actions.map(String).map((x: string) => x.trim().slice(0, 120)).filter(Boolean).slice(0, 5)
          : actionMap[type],
        tags: Array.isArray(parsed.tags) && parsed.tags.length
          ? parsed.tags.map(String).map((x: string) => x.trim().slice(0, 80)).filter(Boolean).slice(0, 8)
          : [type]
      },
      provider,
      model: result.model,
      usage: result.usage
    }
  } catch {
    return null
  }
}

function threadContext(card: Card) {
  if (!card.previousCardId) return ''
  const previous = store.getCard(card.previousCardId)
  if (!previous) return ''
  const latest = previous.answers.at(-1)
  const english = store.getSettings().locale === 'en-US'
  const priorText = english
    ? [
        `Previous screenshot task: ${previous.title}`,
        previous.ocrText ? `Previous OCR: ${previous.ocrText.slice(0, 5000)}` : '',
        previous.question ? `Previous question: ${previous.question}` : '',
        latest ? `Previous AI answer: ${latest.text.slice(0, 6000)}` : ''
      ].filter(Boolean).join('\n')
    : [
        `上一张截图任务：${previous.title}`,
        previous.ocrText ? `上一张截图 OCR：${previous.ocrText.slice(0, 5000)}` : '',
        previous.question ? `上一轮问题：${previous.question}` : '',
        latest ? `上一轮 AI 回答：${latest.text.slice(0, 6000)}` : ''
      ].filter(Boolean).join('\n')
  if (!priorText) return ''
  return english
    ? `\n\n【Screenshot Thread context】\n${priorText}\n\nDecide whether the current screenshot truly continues the previous task. If not, do not force a connection.`
    : `\n\n【Screenshot Thread 上下文】\n${priorText}\n\n请判断当前截图是否延续上一问题；若不是，不要强行关联。`
}

export function buildActionPrompt(card: Card, action: string, customPrompt?: string, skill?: SkillDefinition | null) {
  const english = store.getSettings().locale === 'en-US'
  const base = english
    ? `You are handling a screenshot the user just captured in SnapFlow.\nApplication: ${card.appName || 'Unknown'}\nWindow: ${card.windowTitle || 'Unknown'}\nDetected type: ${card.type}\nAction: ${action}\n\nSolve the user's task directly. Ground the answer in visible evidence from the screenshot. Clearly mark anything that cannot be confirmed from the screenshot and do not invent details. Unless the user explicitly requests another language, answer in English.`
    : `你正在 SnapFlow 中处理一张用户刚截取的屏幕内容。\n应用：${card.appName || '未知'}\n窗口：${card.windowTitle || '未知'}\n识别类型：${card.type}\n动作：${action}\n\n请直接解决用户问题。先依据截图中可见证据回答；无法从截图直接确认的内容要明确说明，不要臆测。除非用户明确要求其他语言，否则使用中文回答。`
  const ocr = card.ocrText ? (english ? `\n\nOCR text (may contain recognition errors):\n${card.ocrText}` : `\n\nOCR 文字（可能含识别误差）：\n${card.ocrText}`) : ''
  const skillPrompt = skill ? `\n\n【Skill: ${skill.name}】\n${skill.systemPrompt}` : ''
  const extra = customPrompt?.trim() ? (english ? `\n\nUser note: ${customPrompt.trim()}` : `\n\n用户补充：${customPrompt.trim()}`) : ''
  return `${base}${skillPrompt}${ocr}${threadContext(card)}${extra}`
}

export function buildConsensusPrompt(card: Card, answers: Array<{ provider: string; text: string }>) {
  if (store.getSettings().locale === 'en-US') {
    return `You are consolidating answers from multiple AI models. Do not claim an absolute ground truth and do not invent precise confidence percentages. Output:\n1. Shared conclusions\n2. Main disagreements\n3. Priority recommendation\n4. Unique model-specific points worth checking\n5. Agreement: High / Moderate / Low (answer consistency only; not factual correctness)\n\nTask: ${card.title}\nType: ${card.type}\n\n${answers.map((a, i) => `【Model ${i + 1} ${a.provider}】\n${a.text}`).join('\n\n')}`
  }
  return `你是多模型答案共识整理器。不要声称存在绝对正确答案，也不要输出伪精确置信度。请输出：\n1. 共同判断\n2. 主要分歧\n3. 优先建议\n4. 各模型独有但值得核查的观点\n5. Agreement: High / Moderate / Low（仅基于答案一致程度，不代表事实正确率）\n\n任务：${card.title}\n类型：${card.type}\n\n${answers.map((a, i) => `【模型${i + 1} ${a.provider}】\n${a.text}`).join('\n\n')}`
}
