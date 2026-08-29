import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SafeMarkdown } from './SafeMarkdown'
import type { AiAnswer, BootstrapData, Card, ProviderId, RoutePreview } from '../../../shared/types'
import { shouldRequireVisionForCard } from '../../../shared/model-router'
import { LanguageSwitch, useLanguage } from '../i18n'

function isExtractTextAction(action: string) {
  const value = action.trim().toLowerCase()
  return value === '提取文字' || value === 'extract text' || value === 'ocr'
}

function isTranslateAction(action: string) {
  const value = action.trim().toLowerCase()
  return value === '翻译' || value === 'translate' || value === 'translation'
}

function scrollTo(ref: React.RefObject<HTMLElement | null>) {
  window.setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 20)
}

export function QuickOverlay({ cardId }: { cardId: string }) {
  const { text, actionLabel, intentLabel } = useLanguage()
  const [boot, setBoot] = useState<BootstrapData | null>(null)
  const [card, setCard] = useState<Card | null>(null)
  const [image, setImage] = useState('')
  const [provider, setProvider] = useState<ProviderId | 'auto'>('auto')
  const [route, setRoute] = useState<RoutePreview | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareProviders, setCompareProviders] = useState<ProviderId[]>([])
  const [ephemeralAnswers, setEphemeralAnswers] = useState<AiAnswer[]>([])
  const [ocrOpen, setOcrOpen] = useState(false)
  const routeSequence = useRef(0)
  const ocrRef = useRef<HTMLPreElement | null>(null)
  const answersRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    Promise.all([
      window.snapflow.getBootstrap(),
      window.snapflow.getCard(cardId),
      window.snapflow.getCardImage(cardId)
    ]).then(([b, c, img]) => {
      setBoot(b)
      setCard(c)
      setImage(img)
      const enabled = Object.values(b.settings.providers).filter((p) => p.enabled && (p.id === 'ollama' || p.hasKey))
      const preferred = b.settings.defaultProvider
      setProvider(preferred !== 'auto' && enabled.some((p) => p.id === preferred) ? preferred : 'auto')
      setCompareProviders(enabled.slice(0, 3).map((p) => p.id))
      document.documentElement.dataset.theme = b.settings.theme
      document.documentElement.style.colorScheme = b.settings.theme === 'system' ? 'light dark' : b.settings.theme
    }).catch((e: any) => setError(e?.message || text('Quick Layer 初始化失败', 'Quick Layer failed to initialize')))
    return window.snapflow.onCardChanged((updated) => {
      if (updated.id === cardId) {
        setCard(updated)
        if (!updated.screenshotPath) setImage('')
      }
    })
  }, [cardId])

  useEffect(() => {
    if (!card) { setRoute(null); return }
    const sequence = ++routeSequence.current
    void window.snapflow.previewRoute(card.id, provider)
      .then((next) => { if (sequence === routeSequence.current) setRoute(next) })
      .catch(() => { if (sequence === routeSequence.current) setRoute(null) })
  }, [card?.id, card?.type, card?.ocrText, card?.screenshotPath, provider])

  const usableProviders = useMemo(
    () => boot ? Object.values(boot.settings.providers).filter((p) => p.enabled && (p.id === 'ollama' || p.hasKey)) : [],
    [boot]
  )
  const needsVision = Boolean(card && shouldRequireVisionForCard(card.type, Boolean(card.screenshotPath), card.ocrText))
  const compareEligibleProviders = useMemo(
    () => usableProviders.filter((p) => !needsVision || p.supportsVision),
    [usableProviders, needsVision]
  )

  useEffect(() => {
    const allowed = new Set(compareEligibleProviders.map((p) => p.id))
    setCompareProviders((current) => {
      const next = current.filter((id) => allowed.has(id))
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next
    })
  }, [compareEligibleProviders])

  async function refreshUntilOcr(maxWaitMs = 1800) {
    const deadline = Date.now() + maxWaitMs
    let latest = await window.snapflow.getCard(cardId)
    if (latest) setCard(latest)
    while (latest && !latest.ocrText?.trim() && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 250))
      latest = await window.snapflow.getCard(cardId)
      if (latest) setCard(latest)
    }
    return latest
  }

  async function runAction(action: string) {
    if (!card || !boot) return
    setBusy(action)
    setError('')
    try {
      if (isExtractTextAction(action)) {
        const latest = card.ocrText?.trim() ? card : await refreshUntilOcr()
        if (latest?.ocrText?.trim()) {
          setOcrOpen(true)
          scrollTo(ocrRef)
          return
        }
      }

      let latest = card
      if (isTranslateAction(action) && !latest.ocrText?.trim() && boot.settings.screenshot.localOcr) {
        latest = (await refreshUntilOcr()) || latest
      }

      if (isTranslateAction(action) && !latest.ocrText?.trim() && provider !== 'auto' && !boot.settings.providers[provider]?.supportsVision) {
        setError(text(
          '翻译需要先读到文字，但当前 AI 不支持图片输入。请切换“Auto”或视觉模型，或确认“设置 → 截图 → 本地 OCR”已开启。',
          'Translation needs readable text, but the selected AI cannot accept images. Switch to Auto/a vision model or enable local OCR in Settings → Screenshot.'
        ))
        return
      }

      const result = await window.snapflow.askCard({ cardId, action, provider })
      setCard(result.card)
      if (!result.persisted && result.answer) setEphemeralAnswers((current) => [...current, result.answer])
      if (result.route) setRoute(result.route)
      if (!result.answer) setError(text('本次操作没有返回结果，请重试。', 'This action returned no result. Please try again.'))
      else scrollTo(answersRef)
    } catch (e: any) {
      setError(e?.message || text('调用失败', 'Request failed'))
    } finally {
      setBusy('')
    }
  }

  async function compare() {
    if (compareProviders.length < 2) {
      setError(text('Compare 至少需要两个已连接的真实 Provider', 'Compare requires at least two connected real Providers'))
      return
    }
    setBusy('compare')
    setError('')
    try {
      const result = await window.snapflow.compareCard({
        cardId,
        action: card?.actions[0] || '解释',
        providers: compareProviders.map((p) => ({ provider: p }))
      })
      setCard(result.card)
      if (!result.persisted) {
        setEphemeralAnswers((current) => [
          ...current,
          ...(result.answers || []),
          ...(result.consensus ? [result.consensus] : [])
        ])
      }
      if (result.warning) setError(result.warning)
      scrollTo(answersRef)
    } catch (e: any) {
      setError(e?.message || text('Compare 失败', 'Compare failed'))
    } finally {
      setBusy('')
    }
  }

  async function resolveThread(mode: 'continue' | 'new') {
    setError('')
    try {
      const updated = await window.snapflow.resolveThread(cardId, mode)
      setCard(updated)
    } catch (e: any) { setError(e?.message || text('Thread 操作失败', 'Thread action failed')) }
  }

  async function patchCard(patch: Partial<Card>, failureMessage: string) {
    setError('')
    try {
      const updated = await window.snapflow.updateCard(cardId, patch)
      setCard(updated)
    } catch (e: any) { setError(e?.message || failureMessage) }
  }

  if ((!card || !boot) && error) return <div className="quick-shell loading-card quick-failed"><div><b>{text('Quick Layer 初始化失败', 'Quick Layer failed to initialize')}</b><span>{error}</span><button onClick={() => void window.snapflow.closeQuick(cardId)}>{text('关闭', 'Close')}</button></div></div>
  if (!card || !boot) return <div className="quick-shell loading-card">{text('正在识别截图…', 'Analyzing screenshot…')}</div>
  const latest = [...card.answers, ...ephemeralAnswers].slice(-4)
  const routeText = route?.provider
    ? `${provider === 'auto' ? 'Auto → ' : ''}${boot.settings.providers[route.provider]?.label || route.provider} · ${route.model}`
    : 'Demo → SnapFlow Mock'

  return (
    <div className="quick-shell">
      <div className="quick-titlebar drag-region">
        <div className="quick-title-group no-drag">
          <span className="intent-dot" />
          <div>
            <strong>{card.title}</strong>
            <small>{card.appName || 'Screen'} · {intentLabel(card.type)}</small>
          </div>
        </div>
        <div className="quick-title-actions no-drag"><LanguageSwitch compact /><button className="icon-button" onClick={() => void window.snapflow.closeQuick(cardId)}>×</button></div>
      </div>

      <div className="quick-content">
        {boot.demoMode && (
          <div className="demo-banner"><b>Demo Mode</b><span>{text('当前没有已连接的真实 Provider。请到“设置 → AI Providers”填写 API Key，并点击“测试连接”。', 'No real Provider is connected. Go to Settings → AI Providers, save an API key, then Test Connection.')}</span></div>
        )}

        {Boolean(card.metadata?.threadCandidateId) && (
          <div className="thread-suggestion">
            <div><b>{text('检测到可能是上一个问题的后续', 'This may continue the previous task')}</b><span>{text('相同应用/窗口且时间接近。由你决定是否继承上一张截图上下文。', 'Same app/window and close in time. You decide whether to inherit the previous screenshot context.')}</span></div>
            <div><button onClick={() => void resolveThread('continue')}>{text('继续上一个任务', 'Continue previous task')}</button><button className="ghost" onClick={() => void resolveThread('new')}>{text('作为新问题', 'New task')}</button></div>
          </div>
        )}
        {Boolean(card.metadata?.suggestedProjectId) && !card.projectId && (() => {
          const suggested = boot.projects.find((p) => p.id === card.metadata?.suggestedProjectId)
          return suggested ? <div className="project-suggestion"><span>{text('可能属于 Project：', 'Suggested Project: ')}<b>{suggested.name}</b></span><button onClick={() => void patchCard({ projectId: suggested.id, metadata: { suggestedProjectId: '' } }, text('归档到 Project 失败', 'Failed to add to Project'))}>{text('归入 Project', 'Add to Project')}</button><button className="ghost" onClick={() => void patchCard({ metadata: { suggestedProjectId: '' } }, text('忽略 Project 建议失败', 'Failed to dismiss Project suggestion'))}>{text('忽略', 'Ignore')}</button></div> : null
        })()}

        {image && <img className="quick-shot" src={image} alt="Screenshot" />}
        <div className="tag-row">
          <span className="pill accent">{intentLabel(card.type)}</span>
          {card.tags.slice(0, 4).map((tag) => <span className="pill" key={tag}>#{tag}</span>)}
          {card.ocrText && <button className="pill pill-button" onClick={() => setOcrOpen((v) => !v)}>{ocrOpen ? text('收起 OCR', 'Hide OCR') : 'OCR'}</button>}
        </div>
        {ocrOpen && card.ocrText && <pre ref={ocrRef} className="quick-ocr">{card.ocrText}</pre>}

        <div className="quick-actions">
          {card.actions.slice(0, 5).map((action) => (
            <button key={action} title={actionLabel(action)} disabled={Boolean(busy)} onClick={() => void runAction(action)}>
              {busy === action ? text('处理中…', 'Working…') : actionLabel(action)}
            </button>
          ))}
        </div>

        <div className="model-strip">
          <label>AI</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderId | 'auto')}>
            <option value="auto">{text('Auto · 自动选模', 'Auto · Best model')}</option>
            {usableProviders.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.model}</option>)}
          </select>
          <button className="ghost" onClick={() => setCompareOpen((v) => !v)}>Compare</button>
        </div>
        <div className="route-preview"><b>{routeText}</b>{route?.reason && <span>{route.reason}</span>}</div>

        {compareOpen && (
          <div className="compare-picker">
            {compareEligibleProviders.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={compareProviders.includes(p.id)}
                  onChange={(e) => setCompareProviders((current) =>
                    e.target.checked ? [...new Set([...current, p.id])] : current.filter((x) => x !== p.id)
                  )}
                />
                {p.label}
              </label>
            ))}
            <button disabled={Boolean(busy)} onClick={() => void compare()}>
              {busy === 'compare' ? text('并行询问中…', 'Comparing…') : text('开始多模型比较', 'Compare selected AI')}
            </button>
          </div>
        )}

        {error && <div className="error-banner">{error}</div>}

        {latest.length > 0 && (
          <div ref={answersRef} className="quick-answers">
            {latest.map((answer) => (
              <article key={answer.id} className={answer.action === 'AI Consensus' ? 'answer-card consensus' : 'answer-card'}>
                <header>
                  <b>{answer.isMock ? 'Demo Mock' : answer.action === 'AI Consensus' ? 'AI Consensus' : `${answer.provider} · ${answer.model}`}</b>
                  <span>{answer.credits} UI pts</span>
                </header>
                {answer.isMock && <div className="mock-label">{text('演示结果 · 非真实模型输出', 'Demo result · Not a real model output')}</div>}
                <SafeMarkdown className="quick-answer-markdown safe-markdown" text={answer.text} />
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="quick-footer">
        <button className="ghost" onClick={() => void patchCard({ starred: !card.starred }, text('保存 Card 失败', 'Failed to save Card'))}>
          {card.starred ? text('★ 已保存', '★ Saved') : text('☆ 保存', '☆ Save')}
        </button>
        <button className="primary" onClick={() => void window.snapflow.openWorkspace(cardId)}>{text('打开工作台 ↗', 'Open workspace ↗')}</button>
      </div>
    </div>
  )
}