import React, { useEffect, useMemo, useState } from 'react'
import type { AppSettings, ProviderId } from '../../../shared/types'
import { LanguageSwitch, useLanguage } from '../i18n'

export function Onboarding({ settings, onDone }: { settings: AppSettings; onDone: (settings: AppSettings) => void }) {
  const { text, locale } = useLanguage()
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<AppSettings>({ ...structuredClone(settings), locale })
  const [keys, setKeys] = useState<Partial<Record<ProviderId, string>>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const steps = [text('选择 AI', 'Choose AI'), text('截图快捷键', 'Capture hotkey'), text('隐私', 'Privacy'), text('开机启动', 'Startup')]
  const providers = useMemo(() => Object.values(draft.providers), [draft.providers])

  useEffect(() => window.snapflow.onSettingsChanged((next) => {
    if (next.onboardingCaptureVerified !== draft.onboardingCaptureVerified) {
      setDraft((current) => ({ ...current, onboardingCaptureVerified: next.onboardingCaptureVerified }))
    }
  }), [draft.onboardingCaptureVerified])

  function goToStep(index: number) {
    if (saving) return
    setError('')
    setStep(Math.max(0, Math.min(3, index)))
  }

  async function finish() {
    if (saving) return
    setError('')
    if (!draft.onboardingCaptureVerified) { setStep(3); setError(text('请先完成一次真实框选并获得回答（Demo Mock 或真实 AI 均可），再完成设置。', 'Complete one real capture and receive an answer (Demo Mock or real AI) before finishing setup.')); return }
    const hotkey = draft.hotkey.trim()
    if (!hotkey) { setStep(1); setError(text('截图快捷键不能为空', 'Capture hotkey cannot be empty')); return }
    const invalidModel = providers.find((p) => p.enabled && !p.model.trim())
    if (invalidModel) { setStep(0); setError(text(`${invalidModel.label} 的模型名称不能为空`, `${invalidModel.label} model name cannot be empty`)); return }
    setSaving(true)
    try {
      const staged = await window.snapflow.updateSettings({
        ...draft,
        locale,
        hotkey,
        privacy: { ...draft.privacy, readRecentContext: false },
        onboardingComplete: false
      })
      for (const [id, key] of Object.entries(keys) as [ProviderId, string][]) {
        if (key.trim()) await window.snapflow.setProviderKey(id, key.trim())
      }
      const saved = await window.snapflow.updateSettings({ ...staged, locale, onboardingComplete: true })
      onDone(saved)
    } catch (e: any) { setError(e?.message || text('保存设置失败', 'Failed to save settings')) }
    finally { setSaving(false) }
  }

  return <div className="onboarding-bg"><div className="onboarding-card">
    <div className="onboarding-topbar">
      <div className="brand-lockup"><div className="brand-mark">S</div><div><b>SnapFlow</b><span>Anything on your screen → AI</span></div></div>
      <LanguageSwitch compact />
    </div>
    <div className="stepper" aria-label="Onboarding steps">
      {steps.map((label, i) => <button type="button" className={i === step ? 'step active' : i < step ? 'step done' : 'step available'} key={`${i}-${label}`} onClick={() => goToStep(i)} onPointerDown={() => goToStep(i)} disabled={saving} aria-current={i === step ? 'step' : undefined} title={text(`转到第 ${i + 1} 步：${label}`, `Go to step ${i + 1}: ${label}`)}><span>{i < step ? '✓' : i + 1}</span><span className="step-label">{label}</span></button>)}
    </div>
    <div className="step-hint">{text('可直接点击 1–4 任意步骤切换；也可以使用底部“继续”。', 'Click any step 1–4 directly, or use Continue at the bottom.')}</div>

    <div className="onboarding-body">
      {step === 0 && <><h1>{text('选择你想使用的 AI', 'Choose the AI services you want')}</h1><p>{text('Provider 与 Model 分离。填写真实 API Key 后才会调用真实模型；不填写时 SnapFlow 会明确进入 Demo Mock，不会冒充真实 AI。', 'Provider and Model are separate. Real models are called only after you save a real API key. Without one, SnapFlow clearly uses Demo Mock and never impersonates a real AI.')}</p><div className="provider-grid onboarding-providers">{providers.map((p) => <div className={p.enabled ? 'provider-card enabled' : 'provider-card'} key={p.id}><div className="provider-head"><strong>{p.label}</strong><label className="switch"><input type="checkbox" checked={p.enabled} onChange={(e) => setDraft((d) => ({ ...d, providers: { ...d.providers, [p.id]: { ...d.providers[p.id], enabled: e.target.checked } } }))}/><span/></label></div><label>{text('默认模型', 'Default model')}<input value={p.model} onChange={(e) => setDraft((d) => ({ ...d, providers: { ...d.providers, [p.id]: { ...d.providers[p.id], model: e.target.value } } }))}/></label>{p.id !== 'ollama' ? <label>API Key<input type="password" placeholder={text('仅保存在本机加密存储', 'Encrypted local storage only')} value={keys[p.id] || ''} onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}/></label> : <label>{text('本地地址', 'Local endpoint')}<input value={p.baseUrl || ''} onChange={(e) => setDraft((d) => ({ ...d, providers: { ...d.providers, [p.id]: { ...d.providers[p.id], baseUrl: e.target.value } } }))}/></label>}</div>)}</div></>}
      {step === 1 && <><h1>{text('设置截图快捷键', 'Set your capture hotkey')}</h1><p>{text('默认 Alt+A。以后在任何软件里按下快捷键，框选后 SnapFlow 就接管后续流程。', 'Default: Alt+A. Press it in any app, select an area, and SnapFlow takes over the next steps.')}</p><div className="hotkey-demo"><span>{draft.hotkey || 'Alt+A'}</span><small>{text('全局截图快捷键', 'Global capture hotkey')}</small></div><label className="wide-label">{text('快捷键', 'Hotkey')}<input value={draft.hotkey} onChange={(e) => setDraft((d) => ({ ...d, hotkey: e.target.value }))}/></label></>}
      {step === 2 && <><h1>{text('明确 AI 能看到什么', 'Control what AI can see')}</h1><p>{text('截图、应用名、窗口标题、OCR 与回答都由你决定是否保存或读取。', 'You control whether screenshots, app names, window titles, OCR and answers are read or saved.')}</p><div className="privacy-grid"><label className="check-card"><input type="checkbox" checked={draft.privacy.readAppName} onChange={(e) => setDraft((d) => ({ ...d, privacy: { ...d.privacy, readAppName: e.target.checked } }))}/><span><b>{text('当前软件名称', 'Current app name')}</b><small>PyCharm / Chrome / Word…</small></span></label><label className="check-card"><input type="checkbox" checked={draft.privacy.readWindowTitle} onChange={(e) => setDraft((d) => ({ ...d, privacy: { ...d.privacy, readWindowTitle: e.target.checked } }))}/><span><b>{text('当前窗口标题', 'Current window title')}</b><small>{text('帮助识别项目与上下文', 'Helps identify project/context')}</small></span></label><label className="check-card"><input type="checkbox" checked={draft.privacy.saveOcr} onChange={(e) => setDraft((d) => ({ ...d, privacy: { ...d.privacy, saveOcr: e.target.checked } }))}/><span><b>{text('保存 OCR', 'Save OCR')}</b><small>{text('用于历史检索', 'Used for history search')}</small></span></label><label className="check-card"><input type="checkbox" checked={draft.privacy.saveAnswers} onChange={(e) => setDraft((d) => ({ ...d, privacy: { ...d.privacy, saveAnswers: e.target.checked } }))}/><span><b>{text('保存 AI 回答', 'Save AI answers')}</b><small>{text('关闭后回答仍可回看', 'Keep answers in history')}</small></span></label></div><label className="wide-label">{text('截图保存方式', 'Screenshot retention')}<select value={draft.privacy.screenshotPolicy} onChange={(e) => setDraft((d) => ({ ...d, privacy: { ...d.privacy, screenshotPolicy: e.target.value as AppSettings['privacy']['screenshotPolicy'] } }))}><option value="keep">{text('本地保存', 'Keep locally')}</option><option value="delete_after_analysis">{text('分析完成后删除图片', 'Delete after analysis')}</option><option value="manual_only">{text('仅保存手动收藏的截图', 'Keep only manually saved screenshots')}</option></select></label></>}
      {step === 3 && <><h1>{text('完成一次真实截图闭环', 'Complete one real capture loop')}</h1><p>{text('推荐开机启动并最小化到托盘。完成设置前，请真实按一次快捷键、框选内容，并在 Quick Layer 获得回答。没有 Provider 时可以使用明确标记的 Demo Mock。', 'Launch at sign-in and tray mode are recommended. Before finishing, use the real hotkey, select an area, and receive an answer in Quick Layer. If no Provider is configured, the clearly labeled Demo Mock is acceptable.')}</p><div className="privacy-grid"><label className="check-card"><input type="checkbox" checked={draft.autoStart} onChange={(e) => setDraft((d) => ({ ...d, autoStart: e.target.checked }))}/><span><b>{text('开机自动启动', 'Launch at sign-in')}</b><small>{text('Windows 登录后自动可用', 'Available after Windows sign-in')}</small></span></label><label className="check-card"><input type="checkbox" checked={draft.startMinimized} onChange={(e) => setDraft((d) => ({ ...d, startMinimized: e.target.checked }))}/><span><b>{text('启动后最小化到托盘', 'Start minimized to tray')}</b><small>{text('不打扰当前工作', 'Stay out of the way')}</small></span></label></div><div className={draft.onboardingCaptureVerified ? 'capture-verification ok' : 'capture-verification'}><div><b>{draft.onboardingCaptureVerified ? text('✓ 截图闭环已验证', '✓ Capture loop verified') : text('尚未完成截图闭环', 'Capture loop not verified yet')}</b><small>{text(`快捷键：${draft.hotkey || 'Alt+A'}。截图后点击任一 AI 操作并等待回答。`, `Hotkey: ${draft.hotkey || 'Alt+A'}. After capture, choose any AI action and wait for an answer.`)}</small></div><button type="button" className="primary" onClick={() => void window.snapflow.startCapture()}>{text('开始测试截图', 'Test capture now')}</button></div></>}
    </div>
    {error && <div className="onboarding-error">{error}</div>}
    <div className="onboarding-footer"><button type="button" className="ghost" disabled={step === 0 || saving} onClick={() => goToStep(step - 1)}>{text('上一步', 'Back')}</button><div/><button type="button" className="primary" disabled={saving || (step === 3 && !draft.onboardingCaptureVerified)} onClick={() => step === 3 ? void finish() : goToStep(step + 1)}>{saving ? text('保存中…', 'Saving…') : step === 3 ? text('完成设置', 'Finish setup') : text('继续', 'Continue')}</button></div>
  </div></div>
}
