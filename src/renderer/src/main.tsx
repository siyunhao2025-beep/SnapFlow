import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import type { AuthState } from '../../shared/types'
import './styles.css'
import './workbuddy-polish.css'
import { CaptureOverlay } from './components/CaptureOverlay'
import { LoginPage } from './components/LoginPage'
import { QuickOverlay } from './components/QuickOverlay'
import { UiPolish } from './components/UiPolish'
import { Workspace } from './components/Workspace'
import { LanguageProvider, useLanguage } from './i18n'

function MainApp() {
  const { text } = useLanguage()
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [error, setError] = useState('')

  async function loadAuth() {
    try {
      setAuth(await window.snapflow.getAuthState())
      setError('')
    } catch (e: any) {
      setError(e?.message || text('无法读取登录状态', 'Unable to read sign-in state'))
    }
  }

  useEffect(() => {
    void loadAuth()
    return window.snapflow.onAuthChanged((next) => setAuth(next))
  }, [])

  if (error) return <div className="fatal-renderer"><div><b>{text('SnapFlow 登录服务初始化失败', 'SnapFlow sign-in service failed to initialize')}</b><span>{error}</span><button onClick={() => void loadAuth()}>{text('重试', 'Retry')}</button></div></div>
  if (!auth) return <div className="workspace-loading">{text('正在检查登录状态…', 'Checking sign-in state…')}</div>
  if (!auth.authenticated) return <LoginPage initialState={auth} onAuthenticated={setAuth} />
  return <Workspace />
}

function Root() {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash === 'capture') return <CaptureOverlay />
  if (hash.startsWith('quick=')) return <QuickOverlay cardId={hash.slice('quick='.length)} />
  return <MainApp />
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  componentDidCatch(error: unknown) { console.error('[SnapFlow renderer]', error) }
  render() {
    if (!this.state.error) return this.props.children
    return <div className="fatal-renderer"><div><b>SnapFlow UI error / 界面错误</b><span>{this.state.error}</span><button onClick={() => window.location.reload()}>Reload / 重新加载</button></div></div>
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary><LanguageProvider><UiPolish /><Root /></LanguageProvider></AppErrorBoundary>
)