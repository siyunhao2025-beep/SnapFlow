import React, { useEffect, useMemo, useState } from 'react'
import type { AuthState } from '../../../shared/types'
import { LanguageSwitch, useLanguage } from '../i18n'

type AccountMode = 'local' | 'cloud'
type FormMode = 'login' | 'register'

export function LoginPage({ initialState, onAuthenticated }: { initialState: AuthState; onAuthenticated: (state: AuthState) => void }) {
  const { text } = useLanguage()
  const [accountMode, setAccountMode] = useState<AccountMode>(initialState.mode === 'cloud' ? 'cloud' : 'local')
  const [mode, setMode] = useState<FormMode>(initialState.hasLocalAccount ? 'login' : 'register')
  const [cloudUrl, setCloudUrl] = useState(initialState.cloudBaseUrl || '')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (accountMode === 'local') setMode(initialState.hasLocalAccount ? 'login' : 'register')
  }, [initialState.hasLocalAccount, accountMode])

  const canSubmit = useMemo(() => {
    if (!email.trim() || password.length < (accountMode === 'cloud' ? 10 : 8)) return false
    if (accountMode === 'cloud' && !cloudUrl.trim()) return false
    if (mode === 'register' && (!displayName.trim() || confirmPassword !== password)) return false
    return true
  }, [accountMode, cloudUrl, email, password, displayName, confirmPassword, mode])

  function switchAccountMode(next: AccountMode) {
    setAccountMode(next)
    setError('')
    setPassword('')
    setConfirmPassword('')
    if (next === 'local') setMode(initialState.hasLocalAccount ? 'login' : 'register')
    else setMode('login')
  }

  async function resetLocalAccount() {
    if (busy || !initialState.hasLocalAccount) return
    const confirmation = window.prompt(text(
      '这会重置 SnapFlow 的本机登录账户。Card、Project、截图和普通设置会保留；已保存的 AI Provider API Key 会同时清除。\n\n请输入 RESET 继续：',
      'This resets the local SnapFlow account. Cards, Projects, screenshots and normal settings remain, but saved AI Provider API keys will be cleared.\n\nType RESET to continue:'
    ))
    if (confirmation !== 'RESET') return
    setBusy(true); setError('')
    try {
      const state = await window.snapflow.resetLocalAccount('RESET')
      setEmail(''); setDisplayName(''); setPassword(''); setConfirmPassword('')
      onAuthenticated(state)
    } catch (e: any) { setError(e?.message || text('重置本机登录账户失败', 'Failed to reset local account')) }
    finally { setBusy(false) }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !canSubmit) return
    setError('')
    if (mode === 'register' && password !== confirmPassword) { setError(text('两次输入的密码不一致', 'Passwords do not match')); return }
    setBusy(true)
    try {
      let state: AuthState
      if (accountMode === 'cloud') {
        state = mode === 'register'
          ? await window.snapflow.registerCloudAccount({ baseUrl: cloudUrl.trim(), email: email.trim(), displayName: displayName.trim(), password, rememberMe })
          : await window.snapflow.loginCloudAccount({ baseUrl: cloudUrl.trim(), email: email.trim(), password, rememberMe })
      } else {
        state = mode === 'register'
          ? await window.snapflow.registerLocalAccount({ email: email.trim(), displayName: displayName.trim(), password, rememberMe })
          : await window.snapflow.loginLocal({ email: email.trim(), password, rememberMe })
      }
      setPassword(''); setConfirmPassword(''); onAuthenticated(state)
    } catch (e: any) {
      setError(e?.message || text(mode === 'register' ? '创建账户失败' : '登录失败', mode === 'register' ? 'Could not create account' : 'Sign in failed'))
    } finally { setBusy(false) }
  }

  return <div className="login-shell">
    <div className="login-ambient login-ambient-one"/><div className="login-ambient login-ambient-two"/>
    <section className="login-card" aria-label="SnapFlow sign in">
      <div className="login-brand-row">
        <div className="login-brand"><div className="brand-mark login-brand-mark">S</div><div><b>SnapFlow</b><span>Anything on your screen → AI</span></div></div>
        <LanguageSwitch compact />
      </div>

      <div className="account-mode-switch" role="tablist" aria-label="Account mode">
        <button type="button" role="tab" aria-selected={accountMode === 'local'} className={accountMode === 'local' ? 'active' : ''} onClick={() => switchAccountMode('local')}>💻 {text('本机账户', 'Local account')}</button>
        <button type="button" role="tab" aria-selected={accountMode === 'cloud'} className={accountMode === 'cloud' ? 'active' : ''} onClick={() => switchAccountMode('cloud')}>☁ {text('SnapFlow Cloud', 'SnapFlow Cloud')}</button>
      </div>

      <div className="login-copy">
        <span className="login-kicker">PERSONAL VISUAL AI WORKSPACE</span>
        <h1>{mode === 'login' ? text('欢迎回来', 'Welcome back') : text('创建你的 SnapFlow', 'Create your SnapFlow')}</h1>
        <p>{accountMode === 'cloud'
          ? text('Cloud 模式适合商业部署：登录 Token 保存在系统安全存储，AI Master Key 与权威积分账本只存在服务器。', 'Cloud mode is for commercial deployments: the session token uses system secure storage while AI master keys and the authoritative credit ledger stay on the server.')
          : mode === 'login'
            ? text('登录后继续你的截图、Card、Project 与 AI 工作流。', 'Sign in to continue your screenshots, Cards, Projects and AI workflows.')
            : text('账户仅保存在这台电脑。本地密码使用加盐哈希保存，不会写入明文。', 'The account stays on this computer. Your local password is stored as a salted hash, never plaintext.')}</p>
      </div>

      <div className="login-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} disabled={accountMode === 'local' && !initialState.hasLocalAccount} onClick={() => { setMode('login'); setError('') }}>{text('登录', 'Sign in')}</button>
        <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} disabled={accountMode === 'local' && initialState.hasLocalAccount} onClick={() => { setMode('register'); setError('') }}>{text('注册', 'Register')}</button>
      </div>

      <form className="login-form" onSubmit={submit}>
        {accountMode === 'cloud' && <label>Cloud URL<input autoFocus value={cloudUrl} onChange={(e) => setCloudUrl(e.target.value)} placeholder="https://cloud.example.com"/><small>{text('生产环境必须 HTTPS；本机调试可使用 http://localhost。', 'Production must use HTTPS; localhost may use HTTP for development.')}</small></label>}
        {mode === 'register' && <label>{text('昵称', 'Display name')}<input autoFocus={accountMode === 'local'} autoComplete="name" maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={text('你的昵称', 'Your name')}/></label>}
        <label>{text('邮箱', 'Email')}<input autoFocus={accountMode === 'local' && mode === 'login'} type="email" inputMode="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com"/></label>
        <label>{text('密码', 'Password')}<div className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={text(accountMode === 'cloud' ? '至少 10 个字符' : '至少 8 个字符', accountMode === 'cloud' ? 'At least 10 characters' : 'At least 8 characters')}/><button type="button" onClick={() => setShowPassword((v) => !v)}>{showPassword ? text('隐藏', 'Hide') : text('显示', 'Show')}</button></div></label>
        {mode === 'register' && <label>{text('确认密码', 'Confirm password')}<input type={showPassword ? 'text' : 'password'} autoComplete="new-password" maxLength={256} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={text('再次输入密码', 'Enter password again')}/></label>}
        {<label className="login-remember"><input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}/><span><b>{text('记住我', 'Remember me')}</b><small>{accountMode === 'cloud' ? text('使用系统安全存储保存 Cloud Token；关闭后仅保持本次运行会话。', 'Stores the Cloud token in system secure storage; when off, the session lasts only for this app run.') : text('使用系统安全存储保存本机登录会话；不可用时仅保持当前会话。', 'Uses system secure storage for the local session; otherwise only the current session is kept.')}</small></span></label>}
        {accountMode === 'cloud' && <div className="cloud-login-note">🔐 {text('Cloud Token 使用 safeStorage/系统安全存储；Provider Master Key 不会下发到桌面端。', 'The Cloud token uses safeStorage/system secure storage. Provider master keys are never sent to the desktop.')}</div>}
        {error && <div className="login-error" role="alert">{error}</div>}
        <button className="login-submit" type="submit" disabled={busy || !canSubmit}>{busy ? text('处理中…', 'Working…') : mode === 'login' ? text('登录 SnapFlow', 'Sign in to SnapFlow') : text('创建账户并继续', 'Create account and continue')}</button>
        {accountMode === 'local' && mode === 'login' && initialState.hasLocalAccount && <button className="login-reset" type="button" disabled={busy} onClick={() => void resetLocalAccount()}>{text('忘记密码？重置本机登录账户', 'Forgot password? Reset local account')}</button>}
      </form>

      <div className="login-foot">
        <span>{accountMode === 'cloud' ? '☁ Cloud account' : '🔒 Local-first account'}</span>
        <span>{accountMode === 'cloud' ? text('服务器必须由你部署并使用 HTTPS', 'The server must be operator-deployed and use HTTPS') : text('登录控制应用入口，但不会加密磁盘上的历史截图文件', 'Sign-in protects app access; it does not encrypt screenshot files on disk')}</span>
        <span>{text('API Key / Cloud Token 均由系统安全存储保护', 'API keys / Cloud tokens are protected by system secure storage')}</span>
      </div>
    </section>
  </div>
}
