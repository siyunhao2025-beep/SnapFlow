import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SafeMarkdown } from './SafeMarkdown'
import type {
  AiAnswer,
  AppSettings,
  BootstrapData,
  Card,
  CreditState,
  Project,
  ProviderId,
  ProviderModelOption,
  ProviderTestResult,
  ProviderAuditEntry,
  ProviderDescriptor,
  SkillMarketplaceItem,
  WorkflowRecommendation,
  CloudSessionState,
  UpdateState,
  RoutePreview,
  UsageSummary
} from '../../../shared/types'
import { Onboarding } from './Onboarding'
import { providerSendsTemperature } from '../../../shared/provider-policy'
import { shouldRequireVisionForCard } from '../../../shared/model-router'
import { LanguageSwitch, useLanguage } from '../i18n'

type LibraryView = 'timeline' | 'gallery' | 'favorites'
type RightTab = 'ai' | 'credits' | 'settings' | 'about'

function groupLabel(iso: string, zh: boolean) {
  const date = new Date(iso)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startYesterday = startToday - 24 * 60 * 60 * 1000
  const startWeek = startToday - 7 * 24 * 60 * 60 * 1000
  const t = date.getTime()
  if (t >= startToday) return zh ? '今天' : 'Today'
  if (t >= startYesterday) return zh ? '昨天' : 'Yesterday'
  if (t >= startWeek) return zh ? '本周' : 'This Week'
  return zh ? '更早' : 'Earlier'
}

export function Workspace() {
  const { locale, zh, text, actionLabel, intentLabel, skillName, skillDescription, formatDateTime } = useLanguage()
  const [boot, setBoot] = useState<BootstrapData | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [credits, setCredits] = useState<CreditState | null>(null)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [image, setImage] = useState('')
  const [query, setQuery] = useState('')
  const [searchIds, setSearchIds] = useState<Set<string> | null>(null)
  const [projectFilter, setProjectFilter] = useState('')
  const [libraryView, setLibraryView] = useState<LibraryView>('timeline')
  const [prompt, setPrompt] = useState('')
  const [provider, setProvider] = useState<ProviderId | 'auto'>('auto')
  const [route, setRoute] = useState<RoutePreview | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [appError, setAppError] = useState('')
  const [startupError, setStartupError] = useState('')
  const [rightTab, setRightTab] = useState<RightTab>('ai')
  const [compareSet, setCompareSet] = useState<ProviderId[]>([])
  const [newProject, setNewProject] = useState('')
  const [keyDrafts, setKeyDrafts] = useState<Partial<Record<ProviderId, string>>>({})
  const [testStates, setTestStates] = useState<Partial<Record<ProviderId, ProviderTestResult | { ok: false; message: string }>>>({})
  const [providerModels, setProviderModels] = useState<Partial<Record<ProviderId, ProviderModelOption[]>>>({})
  const [modelsLoading, setModelsLoading] = useState<Partial<Record<ProviderId, boolean>>>({})
  const [providerAudits, setProviderAudits] = useState<Partial<Record<ProviderId, ProviderAuditEntry[]>>>({})
  const [marketplace, setMarketplace] = useState<SkillMarketplaceItem[]>([])
  const [workflowSuggestions, setWorkflowSuggestions] = useState<WorkflowRecommendation[]>([])
  const [cloudStatus, setCloudStatus] = useState<CloudSessionState | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)
  const [hotkeyStatus, setHotkeyStatus] = useState<{ ok: boolean; hotkey: string; conflict: string } | null>(null)
  const [searchMode, setSearchMode] = useState<'lexical' | 'semantic'>('semantic')
  const [cloudEmail, setCloudEmail] = useState('')
  const [cloudPassword, setCloudPassword] = useState('')
  const [cloudDisplayName, setCloudDisplayName] = useState('')
  const [redeemCode, setRedeemCode] = useState('')
  const [ephemeral, setEphemeral] = useState<Record<string, AiAnswer[]>>({})
  const [tagDraft, setTagDraft] = useState('')
  const searchSequence = useRef(0)
  const routeSequence = useRef(0)
  const imageSequence = useRef(0)

  const load = async () => {
    try {
      const b = await window.snapflow.getBootstrap()
      setBoot(b)
      setSettings(b.settings)
      setCards(b.cards)
      setProjects(b.projects)
      setCredits(b.credits)
      setUsage(b.usageSummary)
      setCloudStatus(b.cloud || null)
      setUpdateState(b.updates || null)
      setSearchMode(b.settings.semanticSearchEnabled ? 'semantic' : 'lexical')
      void window.snapflow.getHotkeyStatus().then(setHotkeyStatus).catch(() => undefined)
      void window.snapflow.getWorkflowRecommendations().then(setWorkflowSuggestions).catch(() => undefined)
      if (b.settings.marketplaceEnabled) void window.snapflow.listSkillMarketplace().then(setMarketplace).catch(() => undefined)
      for (const item of Object.values(b.settings.providers)) void window.snapflow.getProviderAudit(item.id).then((rows) => setProviderAudits((current) => ({ ...current, [item.id]: rows }))).catch(() => undefined)
      setStartupError('')
      setSelectedId((current) => current || b.cards[0]?.id || '')
      const usable = Object.values(b.settings.providers).filter((p) => p.enabled && (p.id === 'ollama' || p.hasKey))
      setProvider((current) => {
        if (current !== 'auto') return current
        const preferred = b.settings.defaultProvider
        return preferred !== 'auto' && usable.some((p) => p.id === preferred) ? preferred : 'auto'
      })
      setCompareSet((current) => current.length ? current.filter((id) => usable.some((p) => p.id === id)) : usable.slice(0, 3).map((p) => p.id))
    } catch (e: any) {
      setStartupError(e?.message || text('SnapFlow 初始化失败', 'SnapFlow initialization failed'))
    }
  }

  useEffect(() => {
    void load()
    const offCard = window.snapflow.onCardChanged((card) => {
      setCards((current) => {
        const exists = current.some((x) => x.id === card.id)
        return exists ? current.map((x) => x.id === card.id ? card : x) : [card, ...current]
      })
      if (!card.screenshotPath) {
        setSelectedId((current) => {
          if (current === card.id) setImage('')
          return current
        })
      }
    })
    const offDeleted = window.snapflow.onCardDeleted((cardId) => {
      setCards((current) => current.filter((x) => x.id !== cardId))
      setSelectedId((current) => current === cardId ? '' : current)
    })
    const offCredits = window.snapflow.onCreditsChanged((payload: any) => {
      if (payload?.credits) setCredits(payload.credits)
      else setCredits(payload)
      if (payload?.usageSummary) setUsage(payload.usageSummary)
    })
    const offSettings = window.snapflow.onSettingsChanged((next) => setSettings(next))
    const offSelect = window.snapflow.onWorkspaceSelectCard((cardId) => setSelectedId(cardId))
    const offNavigate = window.snapflow.onWorkspaceNavigate((section) => {
      if (section === 'settings') setRightTab('settings')
      if (section === 'history') { setLibraryView('timeline'); setProjectFilter('') }
    })
    const offError = window.snapflow.onAppError((payload) => setAppError(payload.message))
    const offHotkey = window.snapflow.onHotkeyStatus(setHotkeyStatus)
    const offUpdate = window.snapflow.onUpdateState(setUpdateState)
    const offSkills = window.snapflow.onSkillsChanged(() => { void load(); void window.snapflow.listSkillMarketplace().then(setMarketplace).catch(() => undefined) })
    return () => { offCard(); offDeleted(); offCredits(); offSettings(); offSelect(); offNavigate(); offError(); offHotkey(); offUpdate(); offSkills() }
  }, [])

  useEffect(() => {
    if (!selectedId) { setImage(''); return }
    const sequence = ++imageSequence.current
    void window.snapflow.getCardImage(selectedId)
      .then((next) => { if (sequence === imageSequence.current) setImage(next) })
      .catch(() => { if (sequence === imageSequence.current) setImage('') })
  }, [selectedId])

  useEffect(() => {
    if (!selectedId) { setRoute(null); return }
    const sequence = ++routeSequence.current
    void window.snapflow.previewRoute(selectedId, provider)
      .then((next) => { if (sequence === routeSequence.current) setRoute(next) })
      .catch(() => { if (sequence === routeSequence.current) setRoute(null) })
  }, [selectedId, provider, cards.find((c) => c.id === selectedId)?.type, cards.find((c) => c.id === selectedId)?.ocrText, cards.find((c) => c.id === selectedId)?.screenshotPath])

  useEffect(() => {
    if (!settings) return
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.style.colorScheme = settings.theme === 'system' ? 'light dark' : settings.theme
  }, [settings?.theme])

  const selected = useMemo(() => cards.find((x) => x.id === selectedId) || null, [cards, selectedId])
  const usableProviders = useMemo(
    () => settings ? Object.values(settings.providers).filter((p) => p.enabled && (p.id === 'ollama' || p.hasKey)) : [],
    [settings]
  )
  const selectedNeedsVision = Boolean(selected && shouldRequireVisionForCard(selected.type, Boolean(selected.screenshotPath), selected.ocrText))
  const compareEligibleProviders = useMemo(
    () => usableProviders.filter((p) => !selectedNeedsVision || p.supportsVision),
    [usableProviders, selectedNeedsVision]
  )
  useEffect(() => {
    const allowed = new Set(compareEligibleProviders.map((p) => p.id))
    setCompareSet((current) => {
      const next = current.filter((id) => allowed.has(id))
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next
    })
  }, [compareEligibleProviders])
  const visibleCards = useMemo(() => cards.filter((card) => {
    if (searchIds && !searchIds.has(card.id)) return false
    if (projectFilter && card.projectId !== projectFilter) return false
    if (libraryView === 'favorites' && !card.starred) return false
    return true
  }), [cards, searchIds, projectFilter, libraryView])
  const workflowRecommendation = useMemo(() => {
    const counts = new Map<string, { type: Card['type']; provider: ProviderId; action: string; count: number }>()
    for (const c of cards) for (const answer of c.answers) {
      if (answer.provider === 'mock' || answer.action === 'AI Consensus' || answer.action.startsWith('Compare')) continue
      const key = `${c.type}|${answer.provider}|${answer.action}`
      const current = counts.get(key) || { type: c.type, provider: answer.provider, action: answer.action, count: 0 }
      current.count += 1
      counts.set(key, current)
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).find((x) => x.count >= 3) || null
  }, [cards])

  async function search(value: string) {
    setQuery(value)
    const sequence = ++searchSequence.current
    if (!value.trim()) { setSearchIds(null); return }
    try {
      const semantic = searchMode === 'semantic' && settings?.semanticSearchEnabled
      const raw = semantic ? await window.snapflow.searchCardsSemantic(value) : await window.snapflow.searchCards(value)
      if (sequence !== searchSequence.current) return
      const result = semantic ? (raw as any[]).map((item) => item.card as Card) : raw as Card[]
      setCards((current) => {
        const map = new Map(current.map((card) => [card.id, card]))
        for (const card of result) map.set(card.id, card)
        return [...map.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      })
      const resultIds = new Set(result.map((c: Card) => c.id))
      setSearchIds(resultIds)
      setSelectedId((current) => current && resultIds.has(current) ? current : result[0]?.id || '')
    } catch (e: any) {
      if (sequence === searchSequence.current) setError(e?.message || text('搜索失败', 'Search failed'))
    }
  }

  function applyTransient(cardId: string, answers: AiAnswer[]) {
    if (!answers.length) return
    setEphemeral((current) => ({ ...current, [cardId]: [...(current[cardId] || []), ...answers] }))
  }

  async function runAction(action: string, skillId?: string) {
    if (!selected) return
    setBusy(action)
    setError('')
    try {
      const result = await window.snapflow.askCard({
        cardId: selected.id,
        action,
        prompt,
        provider,
        skillId
      })
      if (result.card) setCards((current) => current.map((x) => x.id === selected.id ? result.card : x))
      if (!result.persisted && result.answer) applyTransient(selected.id, [result.answer])
      if (result.route) setRoute(result.route)
      setPrompt('')
    } catch (e: any) {
      setError(e?.message || text('调用失败', 'Request failed'))
    } finally {
      setBusy('')
    }
  }

  async function runCompare() {
    if (!selected) return
    if (compareSet.length < 2) { setError(text('至少选择两个已连接的真实 Provider', 'Select at least two connected real Providers')); return }
    setBusy('compare')
    setError('')
    try {
      const result = await window.snapflow.compareCard({
        cardId: selected.id,
        action: selected.actions[0] || '解释',
        prompt,
        providers: compareSet.map((p) => ({ provider: p }))
      })
      if (result.card) setCards((current) => current.map((x) => x.id === selected.id ? result.card : x))
      if (!result.persisted) applyTransient(selected.id, [...(result.answers || []), ...(result.consensus ? [result.consensus] : [])])
      if (result.warning) setError(result.warning)
    } catch (e: any) {
      setError(e?.message || text('Compare 失败', 'Compare failed'))
    } finally {
      setBusy('')
    }
  }

  async function createProject() {
    if (!newProject.trim()) return
    setError('')
    try {
      const project = await window.snapflow.createProject(newProject.trim())
      setProjects((p) => [project, ...p])
      setNewProject('')
    } catch (e: any) { setError(e?.message || text('创建 Project 失败', 'Failed to create Project')) }
  }

  async function renameProject(project: Project) {
    const name = window.prompt(text('重命名 Project', 'Rename Project'), project.name)?.trim()
    if (!name || name === project.name) return
    try {
      const updated = await window.snapflow.renameProject(project.id, name)
      setProjects((items) => items.map((p) => p.id === project.id ? updated : p))
    } catch (e: any) { setError(e?.message || text('重命名 Project 失败', 'Failed to rename Project')) }
  }

  async function deleteProject(project: Project) {
    if (!window.confirm(text(`删除 Project “${project.name}”？Card 不会删除，只会移出该 Project。`, `Delete Project “${project.name}”? Cards will not be deleted; they will only be removed from the Project.`))) return
    try {
      await window.snapflow.deleteProject(project.id)
      setProjects((items) => items.filter((p) => p.id !== project.id))
      setCards((items) => items.map((c) => c.projectId === project.id ? { ...c, projectId: undefined } : c))
      if (projectFilter === project.id) setProjectFilter('')
    } catch (e: any) { setError(e?.message || text('删除 Project 失败', 'Failed to delete Project')) }
  }

  async function assignProject(projectId: string) {
    if (!selected) return
    setError('')
    try {
      const card = await window.snapflow.updateCard(selected.id, { projectId: projectId || undefined })
      setCards((current) => current.map((x) => x.id === card.id ? card : x))
    } catch (e: any) { setError(e?.message || text('移动 Card 失败', 'Failed to move Card')) }
  }

  async function toggleStar() {
    if (!selected) return
    setError('')
    try {
      const card = await window.snapflow.updateCard(selected.id, { starred: !selected.starred })
      setCards((current) => current.map((x) => x.id === card.id ? card : x))
    } catch (e: any) { setError(e?.message || text('收藏操作失败', 'Favorite action failed')) }
  }

  async function deleteSelected() {
    if (!selected || !window.confirm(text('删除这张 Card 及其本地截图？此操作不可撤销。', 'Delete this Card and its local screenshot? This cannot be undone.'))) return
    setError('')
    try { await window.snapflow.deleteCard(selected.id) }
    catch (e: any) { setError(e?.message || text('删除 Card 失败', 'Failed to delete Card')) }
  }

  async function addTag() {
    if (!selected || !tagDraft.trim()) return
    setError('')
    try {
      const tag = tagDraft.trim().replace(/^#/, '')
      const tags = [...new Set([...selected.tags, tag])].slice(0, 20)
      const card = await window.snapflow.updateCard(selected.id, { tags })
      setCards((current) => current.map((x) => x.id === card.id ? card : x))
      setTagDraft('')
    } catch (e: any) { setError(e?.message || text('添加 Tag 失败', 'Failed to add tag')) }
  }

  async function updateSettingsSafely(patch: Partial<AppSettings>) {
    setError('')
    try {
      const next = await window.snapflow.updateSettings(patch)
      setSettings(next)
      setAppError('')
      return next
    } catch (e: any) {
      setError(e?.message || text('设置保存失败', 'Failed to save settings'))
      try {
        const fresh = await window.snapflow.getBootstrap()
        setBoot(fresh)
        setSettings(fresh.settings)
      } catch {}
      return null
    }
  }

  async function saveProvider(id: ProviderId) {
    if (!settings) return false
    setError('')
    try {
      const key = keyDrafts[id]
      if (key !== undefined && key.trim()) await window.snapflow.setProviderKey(id, key.trim())
      await window.snapflow.updateSettings({ providers: settings.providers })
      const fresh = await window.snapflow.getBootstrap()
      setSettings(fresh.settings)
      setBoot(fresh)
      setKeyDrafts((d) => ({ ...d, [id]: '' }))
      return true
    } catch (e: any) {
      setError(e?.message || text('Provider 保存失败', 'Failed to save Provider'))
      return false
    }
  }

  async function clearProviderKey(id: ProviderId) {
    setError('')
    try {
      await window.snapflow.setProviderKey(id, '')
      const fresh = await window.snapflow.getBootstrap()
      setSettings(fresh.settings)
      setBoot(fresh)
      setKeyDrafts((d) => ({ ...d, [id]: '' }))
      setTestStates((s) => ({ ...s, [id]: { ok: false, message: text('API Key 已清除', 'API Key cleared') } }))
    } catch (e: any) {
      setError(e?.message || text('清除 API Key 失败', 'Failed to clear API Key'))
    }
  }

  async function testProvider(id: ProviderId) {
    setTestStates((s) => ({ ...s, [id]: { ok: false, message: text('正在测试…', 'Testing…') } }))
    try {
      const saved = await saveProvider(id)
      if (!saved) return
      const result = await window.snapflow.testProvider(id)
      setTestStates((s) => ({ ...s, [id]: result }))
      const audits = await window.snapflow.getProviderAudit(id).catch(() => [])
      setProviderAudits((current) => ({ ...current, [id]: audits }))
    } catch (e: any) {
      setTestStates((s) => ({ ...s, [id]: { ok: false, message: e?.message || text('连接失败', 'Connection failed') } }))
    }
  }

  async function loadProviderModels(id: ProviderId) {
    setModelsLoading((s) => ({ ...s, [id]: true }))
    setTestStates((s) => ({ ...s, [id]: { ok: false, message: text('正在读取可用模型…', 'Loading available models…') } }))
    try {
      const saved = await saveProvider(id)
      if (!saved) return
      const models = await window.snapflow.listProviderModels(id)
      setProviderModels((s) => ({ ...s, [id]: models }))
      setTestStates((s) => ({ ...s, [id]: { ok: true, message: text(`已读取 ${models.length} 个可用模型`, `Loaded ${models.length} available models`) } }))
    } catch (e: any) {
      setTestStates((s) => ({ ...s, [id]: { ok: false, message: e?.message || text('读取模型失败', 'Failed to load models') } }))
    } finally {
      setModelsLoading((s) => ({ ...s, [id]: false }))
    }
  }

  async function refreshAdvancedPanels() {
    try { setWorkflowSuggestions(await window.snapflow.getWorkflowRecommendations()) } catch {}
    try { if (settings?.marketplaceEnabled) setMarketplace(await window.snapflow.listSkillMarketplace()) } catch {}
    try { setCloudStatus(await window.snapflow.getCloudStatus()) } catch {}
  }

  async function saveWorkflow(rec: WorkflowRecommendation) {
    try {
      await window.snapflow.createWorkflow(rec)
      const fresh = await window.snapflow.getBootstrap()
      setSettings(fresh.settings)
      setBoot(fresh)
      setWorkflowSuggestions(await window.snapflow.getWorkflowRecommendations())
    } catch (e: any) { setError(e?.message || text('创建工作流失败', 'Failed to create workflow')) }
  }

  async function installMarketplace(id: string) {
    try {
      await window.snapflow.installMarketplaceSkill(id)
      await load()
      setMarketplace(await window.snapflow.listSkillMarketplace())
    } catch (e: any) { setError(e?.message || text('安装 Skill 失败', 'Failed to install Skill')) }
  }

  async function uninstallMarketplace(id: string) {
    try {
      await window.snapflow.uninstallMarketplaceSkill(id)
      await load()
      setMarketplace(await window.snapflow.listSkillMarketplace())
    } catch (e: any) { setError(e?.message || text('卸载 Skill 失败', 'Failed to uninstall Skill')) }
  }

  async function cloudLogin(register = false) {
    if (!settings) return
    try {
      await updateSettingsSafely({ cloud: { ...settings.cloud, enabled: true } })
      const state = register
        ? await window.snapflow.registerCloud(cloudEmail, cloudDisplayName, cloudPassword)
        : await window.snapflow.loginCloud(cloudEmail, cloudPassword)
      setCloudStatus(state)
      setCloudPassword('')
      await load()
    } catch (e: any) { setError(e?.message || text('SnapFlow Cloud 登录失败', 'SnapFlow Cloud sign-in failed')) }
  }

  async function cloudLogout() {
    try { setCloudStatus(await window.snapflow.logoutCloud()); await load() }
    catch (e: any) { setError(e?.message || text('Cloud 退出失败', 'Cloud sign-out failed')) }
  }

  async function buyCloudCredits(amount: number) {
    setError('')
    try {
      await window.snapflow.checkoutCloudCredits(amount)
      const creditState = await window.snapflow.getCloudCredits().catch(() => undefined)
      setCloudStatus((current) => current ? { ...current, ...(creditState ? { credits: creditState.balance, creditState } : {}) } : current)
    } catch (e: any) { setError(e?.message || text('Cloud 充值页面打开失败', 'Failed to open Cloud checkout')) }
  }

  async function refreshCloudCredits() {
    setError('')
    try {
      const creditState = await window.snapflow.getCloudCredits()
      setCloudStatus((current) => current ? { ...current, credits: creditState.balance, creditState } : current)
    } catch (e: any) { setError(e?.message || text('刷新 Cloud 积分失败', 'Failed to refresh Cloud credits')) }
  }

  async function applySuggestedProject() {
    if (!selected) return
    const id = String(selected.metadata?.suggestedProjectId || '')
    if (!id) return
    await assignProject(id)
  }

  async function addDemoCredits(amount: number) {
    setError('')
    try {
      await window.snapflow.addDemoCredits(amount)
      const payload = await window.snapflow.getCredits()
      setCredits(payload.credits)
      setUsage(payload.usageSummary)
    } catch (e: any) { setError(e?.message || text('Demo 充值失败', 'Demo top-up failed')) }
  }

  async function redeemDemo() {
    if (!redeemCode.trim()) return
    setError('')
    try {
      await window.snapflow.redeemDemoCode(redeemCode.trim())
      const payload = await window.snapflow.getCredits()
      setCredits(payload.credits)
      setUsage(payload.usageSummary)
      setRedeemCode('')
    } catch (e: any) { setError(e?.message || text('兑换失败', 'Redemption failed')) }
  }

  async function checkoutRealCredits(amount: number) {
    if (!settings?.billingServerUrl) { setError(text('请先在 Developer / Billing Extension 中配置受信任的 Billing Server URL', 'Configure a trusted Billing Server URL under Developer / Billing Extension first')); return }
    if (!window.confirm(text(`将在浏览器中打开真实支付页面，购买 ${amount} SnapFlow Credits。是否继续？`, `A real payment page will open in your browser to buy ${amount} SnapFlow Credits. Continue?`))) return
    setError('')
    try {
      await window.snapflow.checkoutCredits(amount)
    } catch (e: any) {
      setError(e?.message || text('无法创建真实支付订单', 'Could not create a real payment order'))
    }
  }

  async function syncRealCredits() {
    setError('')
    try {
      await window.snapflow.syncBillingCredits()
      const payload = await window.snapflow.getCredits()
      setCredits(payload.credits)
      setUsage(payload.usageSummary)
    } catch (e: any) { setError(e?.message || text('同步服务器积分失败', 'Failed to sync server credits')) }
  }

  async function logout() {
    if (!window.confirm(text('退出 SnapFlow 登录？当前本地截图、Card 和 Project 不会被删除。', 'Sign out of SnapFlow? Local screenshots, Cards and Projects will not be deleted.'))) return
    setError('')
    try {
      await window.snapflow.logout()
    } catch (e: any) {
      setError(e?.message || text('退出登录失败', 'Sign out failed'))
    }
  }

  if (startupError) return <div className="workspace-loading startup-failed"><div><b>{text('SnapFlow 初始化失败', 'SnapFlow initialization failed')}</b><span>{startupError}</span><button onClick={() => void load()}>{text('重试', 'Retry')}</button></div></div>
  if (!boot || !settings || !credits || !usage) return <div className="workspace-loading">{text('正在启动 SnapFlow…', 'Starting SnapFlow…')}</div>
  if (!settings.onboardingComplete) {
    return <Onboarding settings={settings} onDone={(s) => { setSettings(s); void load() }} />
  }

  const displayedAnswers = selected ? [...selected.answers, ...(ephemeral[selected.id] || [])] : []
  const routeText = route?.provider
    ? `${provider === 'auto' ? 'Auto → ' : ''}${settings.providers[route.provider]?.label || route.provider} · ${route.model}`
    : text('Demo → SnapFlow 模拟', 'Demo → SnapFlow Mock')

  return (
    <div className="workspace-shell">
      <aside className="left-sidebar">
        <div className="sidebar-brand-row"><div className="brand-lockup sidebar-brand"><div className="brand-mark">S</div><div><b>SnapFlow</b><span>{text('视觉 AI 工作台', 'Visual AI Workspace')}</span></div></div><LanguageSwitch compact /></div>
        <button className="capture-now" onClick={() => void window.snapflow.startCapture()}><span>⌁</span> {text('新建截图', 'New capture')} <kbd>{settings.hotkey}</kbd></button>
        <div className="search-box"><span>⌕</span><input placeholder={text('搜索所有内容…', 'Search everything…')} value={query} onChange={(e) => void search(e.target.value)} /><button className="search-mode" title={text('切换文字/语义搜索', 'Toggle lexical/semantic search')} onClick={() => { const next = searchMode === 'semantic' ? 'lexical' : 'semantic'; setSearchMode(next); if (query.trim()) void search(query) }}>{searchMode === 'semantic' ? '◎' : 'Aa'}</button></div>

        <section className="nav-section library-nav">
          <header><span>{text('档案馆', 'Library')}</span></header>
          <button className={libraryView === 'timeline' && !projectFilter ? 'nav-item active' : 'nav-item'} onClick={() => { setLibraryView('timeline'); setProjectFilter('') }}><span>◫</span>{text('时间线', 'Timeline')}<em>{cards.length}</em></button>
          <button className={libraryView === 'gallery' ? 'nav-item active' : 'nav-item'} onClick={() => { setLibraryView('gallery'); setProjectFilter('') }}><span>▦</span>{text('画廊', 'Gallery')}<em>{cards.length}</em></button>
          <button className={libraryView === 'favorites' ? 'nav-item active' : 'nav-item'} onClick={() => { setLibraryView('favorites'); setProjectFilter(''); setSelectedId(cards.find((c) => c.starred)?.id || '') }}><span>★</span>{text('收藏', 'Favorites')}<em>{cards.filter((c) => c.starred).length}</em></button>
        </section>

        <section className="nav-section">
          <header><span>{text('项目', 'Projects')}</span><button onClick={() => setNewProject((v) => v === '' ? ' ' : '')}>＋</button></header>
          {newProject !== '' && <div className="inline-create"><input autoFocus value={newProject.trimStart()} onChange={(e) => setNewProject(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void createProject()} placeholder={text('项目名称', 'Project name')} /><button onClick={() => void createProject()}>{text('添加', 'Add')}</button></div>}
          {projects.map((p) => (
            <div className="project-nav-row" key={p.id}>
              <button className={projectFilter === p.id ? 'nav-item active' : 'nav-item'} onClick={() => { setLibraryView('timeline'); setProjectFilter(p.id); setSelectedId(cards.find((c) => c.projectId === p.id)?.id || '') }}><span>▰</span>{p.name}<em>{cards.filter((c) => c.projectId === p.id).length}</em></button>
              <button title={text('重命名', 'Rename')} onClick={() => void renameProject(p)}>✎</button>
              <button title={text('删除项目', 'Delete Project')} onClick={() => void deleteProject(p)}>×</button>
            </div>
          ))}
        </section>

        <section className="history-list">
          <header><span>Visual Work History</span><small>{query ? text('搜索结果', 'Search results') : visibleCards.length}</small></header>
          {visibleCards.length === 0 && <div className="empty-list">{text('没有匹配的 Card', 'No matching Cards')}</div>}
          {visibleCards.map((card, index) => {
            const label = groupLabel(card.createdAt, zh)
            const prev = index > 0 ? groupLabel(visibleCards[index - 1].createdAt, zh) : ''
            return <React.Fragment key={card.id}>
              {libraryView !== 'gallery' && label !== prev && <div className="timeline-label">{label}</div>}
              <button className={card.id === selectedId ? 'history-card selected' : 'history-card'} onClick={() => setSelectedId(card.id)}>
                <div className="history-icon">{card.type === 'programming_error' ? '!' : card.type === 'scientific_figure' ? '⌁' : '▧'}</div>
                <div><b>{card.title || card.type}</b><span>{card.appName || text('屏幕', 'Screen')} · {formatDateTime(card.createdAt)}</span><small>{card.answers.length} {text('个回答', 'answers')} · {card.tags.slice(0, 2).map((t) => `#${t}`).join(' ')}</small></div>
                {card.starred && <i>★</i>}
              </button>
            </React.Fragment>
          })}
        </section>

        <div className="sidebar-account">
          <div className="sidebar-avatar">{(boot.auth.user?.displayName || boot.auth.user?.email || 'S').slice(0, 1).toUpperCase()}</div>
          <div className="sidebar-account-copy"><b>{boot.auth.user?.displayName || 'SnapFlow User'}</b><span>{boot.auth.user?.email || 'Local account'}</span></div>
          <button title={text('退出登录', 'Sign out')} onClick={() => void logout()}>↪</button>
        </div>
      </aside>

      <main className="main-panel">
        {libraryView === 'gallery' ? (
          <div className="gallery-view">
            <div className="gallery-head"><div><span>Visual Archive</span><h1>{text('画廊', 'Gallery')}</h1></div><small>{visibleCards.length} Cards</small></div>
            <div className="gallery-grid">
              {visibleCards.map((card) => <GalleryCard key={card.id} card={card} onOpen={() => { setSelectedId(card.id); setLibraryView('timeline') }} />)}
            </div>
          </div>
        ) : !selected ? (
          <div className="empty-workspace"><div className="empty-hero">⌁</div><h2>{text('框一下，就从这里开始', 'Capture anything to begin')}</h2><p>{text('按', 'Press')} <kbd>{settings.hotkey}</kbd>{text('，截图、理解、提问、比较并保存。', ' to capture, understand, ask, compare and remember.')}</p></div>
        ) : (
          <>
            <div className="task-header">
              <div><span className="breadcrumbs">{projects.find((p) => p.id === selected.projectId)?.name || 'Inbox'} / {intentLabel(selected.type)}</span><h1>{selected.title}</h1><div className="tag-row"><span className="pill accent">{intentLabel(selected.type)}</span>{selected.tags.map((t) => <span className="pill" key={t}>#{t}</span>)}</div></div>
              <div className="task-meta">
                <button onClick={() => void toggleStar()}>{selected.starred ? text('★ 收藏', '★ Favorite') : text('☆ 收藏', '☆ Favorite')}</button>
                <select value={selected.projectId || ''} onChange={(e) => void assignProject(e.target.value)}><option value="">{text('未归入项目', 'No project')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                {!selected.projectId && Boolean(selected.metadata?.suggestedProjectId) && <button className="suggest-project" onClick={() => void applySuggestedProject()}>{text(`建议：${String(selected.metadata?.suggestedProjectName || 'Project')}`, `Suggested: ${String(selected.metadata?.suggestedProjectName || 'Project')}`)}</button>}
                <button className="danger-button" onClick={() => void deleteSelected()}>{text('删除', 'Delete')}</button>
              </div>
            </div>

            <div className="task-scroll">
              {Boolean(selected.metadata?.threadCandidateId) && <div className="thread-banner"><b>Screenshot Thread</b><span>{text('检测到可能延续上一任务；在你确认前不会把上一任务发送给 AI。', 'This may continue the previous task. Previous context is not sent to AI until you confirm.')}</span><button onClick={() => void window.snapflow.resolveThread(selected.id, 'continue')}>{text('继续上一个任务', 'Continue previous task')}</button><button className="ghost" onClick={() => void window.snapflow.resolveThread(selected.id, 'new')}>{text('新任务', 'New task')}</button></div>}
              {selected.previousCardId && !selected.metadata?.threadCandidateId && <div className="thread-banner linked"><b>{text('已连接 Screenshot Thread', 'Screenshot Thread linked')}</b><span>{text('后续提问会携带上一任务的 OCR、问题与最近回答；若上一截图仍在本地，视觉模型也会同时参考它。', 'Follow-ups include previous OCR, question and recent answer; vision models can also reference the previous screenshot if it still exists locally.')}</span></div>}
              <section className="source-card">
                <header><b>{text('原始截图', 'Original screenshot')}</b><span>{selected.appName || 'Unknown app'} · {selected.windowTitle || 'Untitled'}</span></header>
                {image ? <img src={image} alt="Original screenshot" /> : <div className="image-removed">{text('截图已按隐私策略从本地删除', 'Screenshot removed according to privacy policy')}</div>}
                {selected.ocrText && <details open><summary>{text('OCR / 识别文字', 'OCR / recognized text')}</summary><pre>{selected.ocrText}</pre></details>}
              </section>

              <section className="action-section">
                <div className="section-label">Dynamic Action Menu</div>
                <div className="quick-actions workspace-actions">{selected.actions.map((action) => <button key={action} disabled={Boolean(busy)} onClick={() => void runAction(action)}>{busy === action ? text('处理中…', 'Working…') : actionLabel(action)}</button>)}</div>
                <div className="tag-editor"><input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addTag()} placeholder={text('添加 Tag', 'Add tag')}/><button onClick={() => void addTag()}>+</button></div>
              </section>

              {displayedAnswers.length > 0 && <section className="answer-stream">
                {displayedAnswers.map((answer) => (
                  <article key={answer.id} className={answer.action === 'AI Consensus' ? 'answer-card consensus' : 'answer-card'}>
                    <header><div><b>{answer.isMock ? 'Demo Mock' : answer.action === 'AI Consensus' ? 'AI Consensus' : `${answer.provider} · ${answer.model}`}</b><span>{actionLabel(answer.action)}</span></div><small>{answer.credits} UI pts · {new Date(answer.createdAt).toLocaleTimeString(locale)}</small></header>
                    {answer.isMock && <div className="mock-label">{text('Demo / Mock · 非真实模型输出', 'Demo / Mock · Not a real model output')}</div>}
                    <SafeMarkdown className="answer-text safe-markdown" text={answer.text} />
                    {answer.usage && <div className="usage-inline">Provider Usage: {answer.usage.inputTokens ?? '—'} in / {answer.usage.outputTokens ?? '—'} out {answer.usage.estimated ? '· Estimated' : ''}</div>}
                  </article>
                ))}
              </section>}
            </div>

            <div className="composer">
              {(error || appError) && <div className="error-banner dismissible"><span>{error || appError}</span><button onClick={() => { setError(''); setAppError('') }}>×</button></div>}
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={text('继续追问这张截图，或补充上下文…', 'Ask a follow-up about this screenshot or add context…')} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void runAction('继续追问') }} />
              <div className="composer-footer"><select value={provider} onChange={(e) => setProvider(e.target.value as ProviderId | 'auto')}><option value="auto">{text('Auto · 最适合的 AI', 'Auto · Best AI for this task')}</option>{usableProviders.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.model}</option>)}</select><span>{routeText}</span><button className="primary" disabled={Boolean(busy)} onClick={() => void runAction('继续追问')}>{busy === '继续追问' ? text('生成中…', 'Generating…') : text('发送', 'Send')}</button></div>
            </div>
          </>
        )}
      </main>

      <aside className="right-sidebar">
        <div className="right-tabs four"><button className={rightTab === 'ai' ? 'active' : ''} onClick={() => setRightTab('ai')}>{text('AI / 工具', 'AI / Tools')}</button><button className={rightTab === 'credits' ? 'active' : ''} onClick={() => setRightTab('credits')}>{text('积分', 'Credits')}</button><button className={rightTab === 'settings' ? 'active' : ''} onClick={() => setRightTab('settings')}>{text('设置', 'Settings')}</button><button className={rightTab === 'about' ? 'active' : ''} onClick={() => setRightTab('about')}>{text('关于', 'About')}</button></div>

        {rightTab === 'ai' && <div className="right-scroll">
          {boot.demoMode && <div className="demo-banner"><b>Demo Mode</b><span>{text('尚未连接真实 AI。进入“设置 → AI Providers”，填写 API Key，保存并点击“测试连接”。', 'No real AI is connected yet. Open Settings → AI Providers, save an API key, then click Test Connection.')}</span></div>}
          <section className="side-card"><header><b>Model Router</b><span>{provider === 'auto' ? 'Auto' : 'Manual'}</span></header><p>{text('路由结果透明显示，不会偷偷切换。', 'Routing is shown transparently; SnapFlow never switches models silently.')}</p><select value={provider} onChange={(e) => setProvider(e.target.value as ProviderId | 'auto')}><option value="auto">Auto</option>{usableProviders.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select><div className="route-preview"><b>{routeText}</b>{route?.reason && <span>{route.reason}</span>}</div></section>
          <section className="side-card"><header><b>{text('多模型对比', 'Compare')}</b><span>{compareSet.length} {text('个已选', 'selected')}</span></header><p>{text('并行询问至少两个与当前任务兼容的真实模型；Consensus 只总结一致与分歧，不代表事实正确率。', 'Ask at least two compatible real models in parallel. Consensus summarizes agreement and disagreement; it is not a truth score.')}</p>{compareEligibleProviders.map((p) => <label className="model-check" key={p.id}><input type="checkbox" checked={compareSet.includes(p.id)} onChange={(e) => setCompareSet((s) => e.target.checked ? [...new Set([...s, p.id])] : s.filter((x) => x !== p.id))} /><div><b>{p.label}</b><span>{p.model}</span></div></label>)}<button className="primary full" disabled={busy === 'compare' || !selected} onClick={() => void runCompare()}>{busy === 'compare' ? text('比较中…', 'Comparing…') : text('比较选中的 AI', 'Compare selected AI')}</button></section>
          <section className="side-card"><header><b>Skills</b><span>{boot.skills.length} {text('个已安装', 'installed')}</span></header>{boot.skills.map((skill) => <button className="skill-button" key={skill.id} disabled={!selected || Boolean(busy)} onClick={() => void runAction(skill.actions[0] || skill.name, skill.id)}><span>◇</span><div><b>{skillName(skill.id, skill.name)}</b><small>{skillDescription(skill.id, skill.description)}</small></div></button>)}</section>
          {workflowRecommendation && <section className="side-card workflow-card"><header><b>Learned Workflow</b><span>{text('推荐', 'Recommendation')}</span></header><p>{text(`你已重复执行 ${workflowRecommendation.count} 次：`, `You have repeated this ${workflowRecommendation.count} times: `)}{intentLabel(workflowRecommendation.type)} → {workflowRecommendation.provider} → {actionLabel(workflowRecommendation.action)}。{text('当前仅做本地统计与推荐，不会未经确认自动执行。', ' This is local-only statistics/recommendation and never auto-runs without confirmation.')}</p><button className="full" disabled={!selected || Boolean(busy)} onClick={() => { setProvider(workflowRecommendation.provider); void runAction(workflowRecommendation.action) }}>{text('使用这条快捷工作流', 'Use this workflow')}</button></section>}
          {settings.learnedWorkflowEnabled && workflowSuggestions.slice(0, 3).map((rec) => <section className="side-card workflow-card" key={rec.signature}><header><b>{text('工作流建议', 'Workflow suggestion')}</b><span>{rec.count}×</span></header><p>{intentLabel(rec.intent)} → {rec.provider} → {actionLabel(rec.action)}</p><div className="inline-actions"><button disabled={!selected || Boolean(busy)} onClick={() => { setProvider(rec.provider); void runAction(rec.action) }}>{text('执行', 'Run')}</button><button className="ghost" onClick={() => void saveWorkflow(rec)}>{text('保存快捷动作', 'Save shortcut')}</button></div></section>)}
          {settings.workflowRules.length > 0 && <section className="side-card"><header><b>{text('已保存工作流', 'Saved workflows')}</b><span>{settings.workflowRules.length}</span></header>{settings.workflowRules.filter((rule) => rule.enabled).map((rule) => <button className="skill-button" key={rule.id} disabled={!selected || Boolean(busy)} onClick={() => { setProvider(rule.provider); void runAction(rule.action, rule.skillId) }}><span>↯</span><div><b>{rule.name}</b><small>{intentLabel(rule.intent)} · {rule.provider}</small></div></button>)}</section>}
          {settings.marketplaceEnabled && <section className="side-card"><header><b>{text('Skill Marketplace', 'Skill Marketplace')}</b><span>{marketplace.length}</span></header>{marketplace.slice(0, 6).map((item) => <div className="marketplace-row" key={item.id}><div><b>{item.name}</b><small>{item.description} · v{item.version}</small></div><button className={item.installed ? 'ghost' : ''} onClick={() => void (item.installed ? uninstallMarketplace(item.id) : installMarketplace(item.id))}>{item.installed ? text('卸载', 'Uninstall') : text('安装', 'Install')}</button></div>)}</section>}
        </div>}

        {rightTab === 'credits' && <div className="right-scroll">
          <section className="credit-hero"><span>{text('SnapFlow UI Credits · 剩余', 'SnapFlow UI Credits · Remaining')}</span><strong>{usage.remaining}</strong><small>{text('今日', 'Today')} {usage.today} · {text('本月', 'This Month')} {usage.thisMonth}</small></section>
          <section className="side-card"><header><b>Provider Usage ≠ UI Credits</b><span>{text('透明计量', 'Transparent metering')}</span></header><p>{text('Provider 返回 token 时记录真实 input/output tokens；若 Provider 不返回，则显示 Estimated。UI Credits 是 SnapFlow 内部额度，不等同于各厂商账单金额。', 'When a Provider returns token usage, SnapFlow records real input/output tokens. Otherwise it is marked Estimated. UI Credits are an internal SnapFlow meter and are not the provider invoice amount.')}</p>{usage.byModel.slice(0, 6).map((m) => <div className="usage-row" key={`${m.provider}-${m.model}`}><div><b>{m.model}</b><span>{m.provider} · {m.calls} {text('次调用', 'calls')}</span></div><strong>{m.credits} pts</strong></div>)}</section>
          <section className="side-card demo-billing"><header><b>{text('充值 / 兑换', 'Top up / Redeem')}</b><span>Demo / Local Simulation</span></header><p>{text('当前默认是本地模拟，不会产生真实支付。测试兑换码来自 development/demo configuration。', 'The default mode is local simulation and does not create a real payment. Test redemption codes come from development/demo configuration.')}</p><div className="recharge-grid">{[100, 500, 1000].map((n) => <button key={n} onClick={() => void addDemoCredits(n)}>+{n} pts</button>)}</div><div className="redeem-row"><input value={redeemCode} onChange={(e) => setRedeemCode(e.target.value)} placeholder={text('兑换码', 'Redemption code')}/><button onClick={() => void redeemDemo()}>{text('兑换', 'Redeem')}</button></div></section>
          {settings.billingServerUrl && <section className="side-card real-billing"><header><b>{text('可选 Billing Server', 'Optional Billing Server')}</b><span>REAL PAYMENT</span></header><p>{text('以下按钮会打开真实支付页面。仅在你信任并自行部署 Billing Server 时使用；Stripe Secret Key 不进入 Electron 客户端。', 'These buttons open a real payment page. Use them only with a Billing Server you trust and deploy yourself. The Stripe Secret Key never enters the Electron client.')}</p><div className="recharge-grid">{[100, 500, 1000].map((n) => <button key={n} onClick={() => void checkoutRealCredits(n)}>{text('购买', 'Buy')} {n} pts</button>)}</div><button className="ghost full" onClick={() => void syncRealCredits()}>{text('支付完成后同步服务器积分', 'Sync server credits after payment')}</button></section>}
          <section className="side-card ledger"><header><b>{text('历史', 'History')}</b></header>{credits.entries.slice(0, 16).map((e) => <div className="ledger-row" key={e.id}><div><b>{e.reason}</b><span>{e.source || 'system'} · {formatDateTime(e.createdAt)}</span>{e.source === 'provider' && <small>{e.usage && (e.usage.inputTokens || e.usage.outputTokens || e.usage.totalTokens) ? `Provider usage · input ${e.usage.inputTokens ?? '—'} · output ${e.usage.outputTokens ?? '—'} · total ${e.usage.totalTokens ?? '—'}` : text('Usage: Estimated / Provider 未返回 token 明细', 'Usage: Estimated / Provider did not return token details')}</small>}</div><strong className={e.delta >= 0 ? 'positive' : ''}>{e.delta > 0 ? '+' : ''}{e.delta}</strong></div>)}</section>
        </div>}

        {rightTab === 'settings' && <div className="right-scroll">
          <section className="side-card settings-language-card">
            <header><b>{text('语言 / Language', 'Language / 语言')}</b><span>{locale}</span></header>
            <p>{text('切换后登录页、首次设置、截图层、Quick Layer 与主工作台会同步切换。', 'The sign-in page, onboarding, capture layer, Quick Layer and workspace switch together.')}</p>
            <LanguageSwitch />
          </section>

          <section className="side-card">
            <header><b>{text('常规', 'General')}</b></header>
            <label>{text('默认 AI', 'Default AI')}<select value={settings.defaultProvider} onChange={(e) => void updateSettingsSafely({ defaultProvider: e.target.value as ProviderId | 'auto' })}><option value="auto">{text('Auto · 自动选择', 'Auto · Smart routing')}</option>{Object.values(settings.providers).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
            <label>{text('外观', 'Appearance')}<select value={settings.theme} onChange={(e) => void updateSettingsSafely({ theme: e.target.value as AppSettings['theme'] })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label>
            <label className="check-row"><input type="checkbox" checked={settings.autoStart} onChange={(e) => void updateSettingsSafely({ autoStart: e.target.checked })}/>{text('开机自动启动', 'Launch at sign-in')}</label>
            <label className="check-row"><input type="checkbox" checked={settings.startMinimized} onChange={(e) => void updateSettingsSafely({ startMinimized: e.target.checked })}/>{text('启动后最小化到托盘', 'Start minimized to tray')}</label>
            <label>{text('关闭窗口时', 'When closing the window')}<select value={settings.closeBehavior} onChange={(e) => void updateSettingsSafely({ closeBehavior: e.target.value as AppSettings['closeBehavior'] })}><option value="tray">{text('最小化到托盘', 'Minimize to tray')}</option><option value="quit">{text('退出程序', 'Quit app')}</option></select></label>
          </section>

          <section className="side-card">
            <header><b>{text('截图', 'Screenshot')}</b></header>
            <label>{text('全局快捷键', 'Global hotkey')}<input value={settings.hotkey} onChange={(e) => setSettings((current) => current ? { ...current, hotkey: e.target.value } : current)} onBlur={() => void updateSettingsSafely({ hotkey: settings.hotkey })}/></label>
            <label className="check-row"><input type="checkbox" checked={!settings.shortcutPaused} onChange={(e) => void updateSettingsSafely({ shortcutPaused: !e.target.checked })}/>{text('启用全局快捷键', 'Enable global hotkey')}</label>
            <label className="check-row"><input type="checkbox" checked={settings.screenshot.autoAnalyze} onChange={(e) => void updateSettingsSafely({ screenshot: { ...settings.screenshot, autoAnalyze: e.target.checked } })}/>{text('截图后自动分析 Intent/OCR', 'Analyze Intent/OCR after capture')}</label>
            <label className="check-row"><input type="checkbox" checked={settings.screenshot.playSound} onChange={(e) => void updateSettingsSafely({ screenshot: { ...settings.screenshot, playSound: e.target.checked } })}/>{text('截图声音', 'Capture sound')}</label>
            <label className="check-row"><input type="checkbox" checked={settings.screenshot.showCursor} onChange={(e) => void updateSettingsSafely({ screenshot: { ...settings.screenshot, showCursor: e.target.checked } })}/>{text('在保存截图中显示鼠标位置', 'Show cursor in saved capture')}</label>
            <label className="check-row"><input type="checkbox" checked={settings.screenshot.localOcr} onChange={(e) => void updateSettingsSafely({ screenshot: { ...settings.screenshot, localOcr: e.target.checked } })}/>{text('优先使用本地 OCR（Windows OCR / Tesseract）', 'Prefer local OCR (Windows OCR / Tesseract)')}</label>
            <label>{text('本地 OCR 引擎', 'Local OCR engine')}<select value={settings.screenshot.localOcrEngine} onChange={(e) => void updateSettingsSafely({ screenshot: { ...settings.screenshot, localOcrEngine: e.target.value as AppSettings['screenshot']['localOcrEngine'] } })}><option value="auto">Auto</option><option value="windows">Windows OCR</option><option value="tesseract">Tesseract</option><option value="off">Off</option></select></label>
            {hotkeyStatus && !hotkeyStatus.ok && <div className="error-banner"><span>{text(`${hotkeyStatus.hotkey} 已被其他应用占用。建议 Alt+Shift+S。`, `${hotkeyStatus.hotkey} is already in use. Try Alt+Shift+S.`)}</span><button className="ghost" onClick={() => void updateSettingsSafely({ hotkey: 'Alt+Shift+S' })}>{text('改用 Alt+Shift+S', 'Use Alt+Shift+S')}</button></div>}
          </section>

          <section className="side-card">
            <header><b>{text('隐私', 'Privacy')}</b><span>Local-first</span></header>
            <label>{text('截图保存策略', 'Screenshot retention')}<select value={settings.privacy.screenshotPolicy} onChange={(e) => void updateSettingsSafely({ privacy: { ...settings.privacy, screenshotPolicy: e.target.value as AppSettings['privacy']['screenshotPolicy'] } })}><option value="keep">{text('本地保存', 'Keep locally')}</option><option value="delete_after_analysis">{text('分析完成后删除图片', 'Delete after analysis')}</option><option value="manual_only">{text('仅保存手动标记的 Card', 'Keep only manually saved Cards')}</option></select></label>
            <label className="check-row"><input type="checkbox" checked={settings.privacy.saveOcr} onChange={(e) => void updateSettingsSafely({ privacy: { ...settings.privacy, saveOcr: e.target.checked } })}/>{text('保存 OCR', 'Save OCR')}</label>
            <label className="check-row"><input type="checkbox" checked={settings.privacy.saveAnswers} onChange={(e) => void updateSettingsSafely({ privacy: { ...settings.privacy, saveAnswers: e.target.checked } })}/>{text('保存 AI 回答', 'Save AI answers')}</label>
            <label className="check-row"><input type="checkbox" checked={settings.privacy.readAppName} onChange={(e) => void updateSettingsSafely({ privacy: { ...settings.privacy, readAppName: e.target.checked } })}/>{text('读取当前软件名称', 'Read current app name')}</label>
            <label className="check-row"><input type="checkbox" checked={settings.privacy.readWindowTitle} onChange={(e) => void updateSettingsSafely({ privacy: { ...settings.privacy, readWindowTitle: e.target.checked } })}/>{text('读取当前窗口标题', 'Read current window title')}</label>
            <label className="check-row"><input type="checkbox" checked={settings.privacy.readClipboard} onChange={(e) => void updateSettingsSafely({ privacy: { ...settings.privacy, readClipboard: e.target.checked } })}/>{text('允许 AI 请求读取剪贴板', 'Allow AI requests to read clipboard')}</label>
            <label className="check-row"><input type="checkbox" checked={settings.privacy.autoMaskEmail} onChange={(e) => void updateSettingsSafely({ privacy: { ...settings.privacy, autoMaskEmail: e.target.checked } })}/>{text('发送前遮挡邮箱地址', 'Mask email addresses before sending')}</label>
            <label className="check-row"><input type="checkbox" checked={settings.privacy.autoMaskPhone} onChange={(e) => void updateSettingsSafely({ privacy: { ...settings.privacy, autoMaskPhone: e.target.checked } })}/>{text('发送前遮挡手机号', 'Mask phone numbers before sending')}</label>
            <label>{text('敏感应用黑名单（逗号分隔）', 'Sensitive app blacklist (comma-separated)')}<textarea value={settings.privacy.sensitiveAppBlacklist.join(', ')} onChange={(e) => setSettings((current) => current ? { ...current, privacy: { ...current.privacy, sensitiveAppBlacklist: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } } : current)} onBlur={() => void updateSettingsSafely({ privacy: settings.privacy })}/></label>
            <label className="check-row"><input type="checkbox" checked={settings.semanticSearchEnabled} onChange={(e) => void updateSettingsSafely({ semanticSearchEnabled: e.target.checked })}/>{text('语义搜索 / Visual Knowledge Search', 'Semantic / Visual Knowledge Search')}</label>
            <label className="check-row"><input type="checkbox" checked={settings.learnedWorkflowEnabled} onChange={(e) => void updateSettingsSafely({ learnedWorkflowEnabled: e.target.checked })}/>{text('Learned Workflow 建议', 'Learned Workflow suggestions')}</label>
            <label className="check-row"><input type="checkbox" checked={settings.projectSuggestionsEnabled} onChange={(e) => void updateSettingsSafely({ projectSuggestionsEnabled: e.target.checked })}/>{text('Project 智能归档建议（仅建议，不自动移动）', 'Smart Project suggestions (suggest only; never auto-move)')}</label>
            <small>{text('截图保存在：', 'Screenshots are stored in: ')}{boot.appInfo.dataDirectory}\screenshots · {text('截图只会上传给当前实际选择或 Auto 路由到的 Provider。', 'A screenshot is uploaded only to the Provider actually selected or chosen by Auto routing.')}</small>
          </section>

          <section className="side-card provider-guide">
            <header><b>{text('连接真实 AI', 'Connect real AI')}</b><span>{boot.demoMode ? 'DEMO' : 'READY'}</span></header>
            <p>{text('Demo Mode 的原因不是接口是假，而是当前没有已保存的真实 Provider 凭据。按下面顺序连接：①填写 API Key；②保存；③读取模型并选择；④测试连接。测试成功后，截图提问会直接调用该厂商 API。', 'Demo Mode does not mean the adapters are fake. It means no real Provider credential is saved. Connect in this order: 1) paste API key, 2) Save, 3) Load models and choose one, 4) Test Connection. After a successful test, screenshot questions call that provider API directly.')}</p>
          </section>

          <section className="side-card">
            <header><b>AI Providers</b><span>safeStorage</span></header>
            {Object.values(settings.providers).map((p) => {
              const options = providerModels[p.id] || []
              const status = testStates[p.id]
              const descriptor = boot.providerDescriptors?.find((item) => item.id === p.id)
              const audits = providerAudits[p.id] || []
              const configured = p.id === 'ollama' ? p.enabled : Boolean(p.hasKey)
              return <div className="provider-settings" key={p.id}>
                <div className="provider-head">
                  <div className="provider-title-with-status"><b>{p.label}</b><div className="capability-chips">{descriptor?.capabilities.map((cap) => <i key={cap}>{cap}</i>)}</div><span className={status?.ok ? 'provider-status connected' : configured ? 'provider-status configured' : 'provider-status'}>{status?.ok ? text('已连接', 'Connected') : configured ? text('已配置', 'Configured') : text('未配置', 'Not configured')}</span></div>
                  <label className="switch"><input type="checkbox" checked={p.enabled} onChange={(e) => setSettings((current) => current ? { ...current, providers: { ...current.providers, [p.id]: { ...current.providers[p.id], enabled: e.target.checked } } } : current)}/><span/></label>
                </div>
                <label>Base URL<input value={p.baseUrl || ''} onChange={(e) => setSettings((current) => current ? { ...current, providers: { ...current.providers, [p.id]: { ...current.providers[p.id], baseUrl: e.target.value } } } : current)}/></label>
                <label>Model<input list={`provider-models-${p.id}`} value={p.model} onChange={(e) => { const model = e.target.value; const known = options.find((item) => item.id === model); setSettings((current) => current ? { ...current, providers: { ...current.providers, [p.id]: { ...current.providers[p.id], model, ...(typeof known?.vision === 'boolean' ? { supportsVision: known.vision } : {}) } } } : current) }}/><datalist id={`provider-models-${p.id}`}>{options.map((model) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}</datalist></label>
                <div className="model-discovery-row"><button className="ghost" disabled={Boolean(modelsLoading[p.id])} onClick={() => void loadProviderModels(p.id)}>{modelsLoading[p.id] ? text('读取中…', 'Loading…') : text('读取当前可用模型', 'Load available models')}</button>{options.length > 0 && <span>{options.length} {text('个模型', 'models')}</span>}</div>
                <label className="provider-capability"><input type="checkbox" checked={p.supportsVision} onChange={(e) => setSettings((current) => current ? { ...current, providers: { ...current.providers, [p.id]: { ...current.providers[p.id], supportsVision: e.target.checked } } } : current)}/>{text('当前模型支持图片输入', 'Current model supports image input')}</label>
                {p.id !== 'ollama' && <label>API Key<input type="password" placeholder={p.hasKey ? text('已加密保存 · 留空表示不更改', 'Encrypted and saved · leave blank to keep it') : 'API Key'} value={keyDrafts[p.id] || ''} onChange={(e) => setKeyDrafts((d) => ({ ...d, [p.id]: e.target.value }))}/></label>}
                <div className="provider-grid-small">
                  <label>Temperature <small>{!providerSendsTemperature(p.id, p.model, p.baseUrl || '') ? text('（当前适配器不发送）', '(not sent by this adapter)') : ''}</small><input type="number" min="0" max="2" step="0.1" disabled={!providerSendsTemperature(p.id, p.model, p.baseUrl || '')} value={p.temperature} onChange={(e) => setSettings((current) => current ? { ...current, providers: { ...current.providers, [p.id]: { ...current.providers[p.id], temperature: Number(e.target.value) } } } : current)}/></label>
                  <label>Max Tokens<input type="number" min="128" value={p.maxTokens} onChange={(e) => setSettings((current) => current ? { ...current, providers: { ...current.providers, [p.id]: { ...current.providers[p.id], maxTokens: Number(e.target.value) } } } : current)}/></label>
                  <label>Timeout ms<input type="number" min="1000" value={p.timeoutMs} onChange={(e) => setSettings((current) => current ? { ...current, providers: { ...current.providers, [p.id]: { ...current.providers[p.id], timeoutMs: Number(e.target.value) } } } : current)}/></label>
                </div>
                <div className="provider-actions"><button onClick={() => void saveProvider(p.id)}>{text('保存', 'Save')}</button><button className="ghost" onClick={() => void testProvider(p.id)}>{text('保存并测试连接', 'Save & Test Connection')}</button>{p.id !== 'ollama' && p.hasKey && <button className="ghost danger-button" onClick={() => void clearProviderKey(p.id)}>{text('清除 Key', 'Clear Key')}</button>}</div>
                {status && <div className={status.ok ? 'test-status ok' : 'test-status'}>{status.ok ? '✓' : '×'} · {status.message}{'latencyMs' in status ? ` · ${(status as ProviderTestResult).latencyMs} ms` : ''}</div>}
                {audits.length > 0 && <details className="provider-audit"><summary>{text('最近 5 次调用', 'Last 5 calls')}</summary>{audits.map((row, index) => <div className="audit-row" key={`${row.ts}-${index}`}><span>{new Date(row.ts).toLocaleTimeString(locale)} · {row.status} · {row.latencyMs}ms</span><small>{row.errorCode || 'ok'} {row.requestId ? `· ${row.requestId}` : ''}</small>{row.requestId && <button className="ghost audit-copy" onClick={() => void window.snapflow.copyText(row.requestId || '')}>{text('复制请求 ID', 'Copy request ID')}</button>}</div>)}</details>}
              </div>
            })}
          </section>

          <section className="side-card cloud-settings"><header><b>SnapFlow Cloud</b><span>{cloudStatus?.connected ? 'CONNECTED' : 'OPTIONAL'}</span></header><p>{text('商业化模式：桌面端只保存登录 Token，Provider Master Key 与权威积分账本只存在服务器。未部署 Cloud 时继续使用 BYOK。', 'Commercial mode: the desktop stores only a session token. Provider master keys and the authoritative credit ledger stay on the server. BYOK keeps working when Cloud is not deployed.')}</p><label>Cloud URL<input value={settings.cloud.baseUrl} placeholder="https://cloud.example.com" onChange={(e) => setSettings((current) => current ? { ...current, cloud: { ...current.cloud, baseUrl: e.target.value } } : current)}/></label><label className="check-row"><input type="checkbox" checked={settings.cloud.enabled} onChange={(e) => void updateSettingsSafely({ cloud: { ...settings.cloud, enabled: e.target.checked } })}/>{text('启用 SnapFlow Cloud', 'Enable SnapFlow Cloud')}</label>{cloudStatus?.connected ? <><div className="test-status ok">✓ {cloudStatus.user?.email} · {cloudStatus.creditState?.balance ?? cloudStatus.credits ?? 0} cloud pts</div><div className="cloud-credit-grid"><span>{text('累计购买', 'Purchased')} <b>{cloudStatus.creditState?.purchased ?? 0}</b></span><span>{text('累计消耗', 'Spent')} <b>{cloudStatus.creditState?.spent ?? 0}</b></span></div><div className="inline-actions"><button onClick={() => void window.snapflow.syncCloudCards()}>{text('同步 Cards', 'Sync Cards')}</button><button className="ghost" onClick={() => void cloudLogout()}>{text('退出 Cloud', 'Sign out Cloud')}</button></div><div className="inline-actions"><button className="ghost" onClick={() => void buyCloudCredits(500)}>+500 pts</button><button className="ghost" onClick={() => void buyCloudCredits(1000)}>+1000 pts</button><button className="ghost" onClick={() => void buyCloudCredits(5000)}>+5000 pts</button><button className="ghost" onClick={() => void refreshCloudCredits()}>{text('支付后刷新', 'Refresh after payment')}</button></div>{cloudStatus.creditState?.entries?.length ? <details><summary>{text('Cloud 积分流水', 'Cloud credit ledger')}</summary>{cloudStatus.creditState.entries.slice(0, 8).map((entry) => <div className="audit-row" key={entry.id}><span>{entry.delta > 0 ? '+' : ''}{entry.delta} · {entry.reason}</span><small>{entry.provider || ''} {entry.model || ''}</small></div>)}</details> : null}</> : <><label>Email<input value={cloudEmail} onChange={(e) => setCloudEmail(e.target.value)}/></label><label>{text('显示名称（注册时）', 'Display name (registration)')}<input value={cloudDisplayName} onChange={(e) => setCloudDisplayName(e.target.value)}/></label><label>Password<input type="password" value={cloudPassword} onChange={(e) => setCloudPassword(e.target.value)}/></label><div className="inline-actions"><button onClick={() => void cloudLogin(false)}>{text('登录 Cloud', 'Sign in Cloud')}</button><button className="ghost" onClick={() => void cloudLogin(true)}>{text('注册 Cloud', 'Register Cloud')}</button></div></>}</section>
          <section className="side-card"><header><b>{text('自动更新', 'Auto Update')}</b><span>{updateState?.status || boot.appInfo.autoUpdate}</span></header><label className="check-row"><input type="checkbox" checked={settings.updates.enabled} onChange={(e) => void updateSettingsSafely({ updates: { ...settings.updates, enabled: e.target.checked } })}/>{text('启用自动更新检查', 'Enable update checks')}</label><label>Manifest URL<input value={settings.updates.manifestUrl} onChange={(e) => setSettings((current) => current ? { ...current, updates: { ...current.updates, manifestUrl: e.target.value } } : current)} onBlur={() => void updateSettingsSafely({ updates: settings.updates })}/></label><div className="inline-actions"><button onClick={() => void window.snapflow.checkForUpdates().then(setUpdateState)}>{text('立即检查', 'Check now')}</button>{updateState?.status === 'available' && <button onClick={() => void window.snapflow.downloadUpdate()}>{text('下载', 'Download')}</button>}{updateState?.status === 'downloaded' && <button onClick={() => void window.snapflow.installUpdate()}>{text('安装并重启', 'Install & restart')}</button>}</div></section>
          <section className="side-card"><header><b>{text('扩展功能', 'Advanced features')}</b></header><label className="check-row"><input type="checkbox" checked={settings.marketplaceEnabled} onChange={(e) => void updateSettingsSafely({ marketplaceEnabled: e.target.checked })}/>{text('Skill Marketplace', 'Skill Marketplace')}</label><label>Marketplace Index URL<input value={settings.marketplaceIndexUrl} onChange={(e) => setSettings((current) => current ? { ...current, marketplaceIndexUrl: e.target.value } : current)} onBlur={() => void updateSettingsSafely({ marketplaceIndexUrl: settings.marketplaceIndexUrl })}/></label></section>
          <section className="side-card"><header><b>Developer / Billing Extension</b></header><label>Billing Server URL<input placeholder={text('留空 = 仅 Demo / Local Simulation', 'Leave blank = Demo / Local Simulation only')} value={settings.billingServerUrl} onChange={(e) => setSettings((current) => current ? { ...current, billingServerUrl: e.target.value } : current)}/></label><button onClick={() => void updateSettingsSafely({ billingServerUrl: settings.billingServerUrl })}>{text('保存', 'Save')}</button></section>
        </div>}

        {rightTab === 'about' && <div className="right-scroll">
          <section className="side-card about-card"><div className="brand-mark about-mark">S</div><h2>SnapFlow</h2><p>{text('框一下，让最合适的 AI 理解、处理并记住。', 'Capture anything; let the right AI understand, act and remember.')}</p><dl><dt>Version</dt><dd>{boot.appInfo.version}</dd><dt>Platform</dt><dd>{boot.appInfo.platform}</dd><dt>Electron</dt><dd>{boot.appInfo.electronVersion}</dd><dt>License</dt><dd>UNLICENSED</dd><dt>Auto Update</dt><dd>{boot.appInfo.autoUpdate}</dd></dl><button className="full" onClick={() => void window.snapflow.openDataDirectory()}>{text('打开数据目录', 'Open Data Directory')}</button><button className="ghost full" onClick={() => void window.snapflow.openLogsDirectory()}>{text('打开日志', 'Open Logs')}</button><small>{boot.appInfo.dataDirectory}</small></section>
        </div>}
      </aside>
    </div>
  )
}

function GalleryCard({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const [thumb, setThumb] = useState('')
  const { text, intentLabel, formatDateTime } = useLanguage()
  useEffect(() => { void window.snapflow.getCardImage(card.id, true).then(setThumb).catch(() => setThumb('')) }, [card.id, card.thumbnailPath])
  return <button className="gallery-card" onClick={onOpen}>
    <div className="gallery-thumb">{thumb ? <img src={thumb} alt="Screenshot thumbnail"/> : <span>{text('图片已删除', 'Image removed')}</span>}</div>
    <div className="gallery-copy"><div><b>{card.title}</b>{card.starred && <i>★</i>}</div><span>{intentLabel(card.type)} · {card.appName || text('屏幕', 'Screen')}</span><small>{formatDateTime(card.createdAt)}</small></div>
  </button>
}
