import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'
import type { AuthLoginRequest, AuthRegisterRequest, AuthState, AuthUser } from '../shared/types'
import { derivePasswordHash, normalizeAuthDisplayName, normalizeAuthEmail, normalizeAuthPassword, secureHexEqual } from '../shared/auth-core'
import { logger } from './logger'
import { store, type StoredAuthAccount } from './store'

let sessionUser: AuthUser | null = null
let sessionRemembered = false

function authText(zh: string, en: string) {
  return store.getSettings().locale === 'en-US' ? en : zh
}

function localizedValidation<T>(run: () => T): T {
  try { return run() } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const map: Record<string, string> = {
      '请输入有效的邮箱地址': 'Please enter a valid email address',
      '昵称长度应为 1–80 个字符': 'Display name must contain 1–80 characters',
      '密码至少需要 8 个字符': 'Password must contain at least 8 characters',
      '密码不能超过 256 个字符': 'Password cannot exceed 256 characters'
    }
    if (store.getSettings().locale === 'en-US' && map[message]) throw new Error(map[message])
    throw error
  }
}

function publicUser(account: StoredAuthAccount): AuthUser {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    createdAt: account.createdAt
  }
}

function rememberTokenHash(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function clearRememberedSession() {
  try { store.clearRememberedSession() } catch (error) {
    logger.warn('Failed to clear remembered login session', { error: String(error) })
  }
}

function persistRememberedSession(account: StoredAuthAccount) {
  if (!safeStorage.isEncryptionAvailable()) {
    clearRememberedSession()
    sessionRemembered = false
    return false
  }
  try {
    const token = randomBytes(32).toString('base64url')
    const encrypted = safeStorage.encryptString(token).toString('base64')
    store.setRememberedSession(account.id, rememberTokenHash(token), encrypted)
    sessionRemembered = true
    return true
  } catch (error) {
    // Remember-me is optional. Authentication must still succeed when OS secure
    // storage is temporarily unavailable (for example after a Windows profile change).
    clearRememberedSession()
    sessionRemembered = false
    logger.warn('Remember-me session could not be persisted; using session-only login', { error: String(error) })
    return false
  }
}

function restoreRememberedSession() {
  const auth = store.getAuthRecord()
  const account = auth.account
  if (!account || !auth.rememberedUserId || auth.rememberedUserId !== account.id || !auth.rememberTokenHash || !auth.rememberTokenEncrypted) {
    clearRememberedSession()
    return false
  }
  if (!safeStorage.isEncryptionAvailable()) {
    clearRememberedSession()
    return false
  }
  try {
    const token = safeStorage.decryptString(Buffer.from(auth.rememberTokenEncrypted, 'base64'))
    if (!secureHexEqual(rememberTokenHash(token), auth.rememberTokenHash)) {
      clearRememberedSession()
      return false
    }
    sessionUser = publicUser(account)
    sessionRemembered = true
    return true
  } catch (error) {
    clearRememberedSession()
    logger.warn('Remembered login session could not be restored', { error: String(error) })
    return false
  }
}

export const authService = {
  init() {
    sessionUser = null
    sessionRemembered = false
    restoreRememberedSession()
  },

  getState(): AuthState {
    return {
      authenticated: Boolean(sessionUser),
      hasLocalAccount: Boolean(store.getAuthRecord().account),
      rememberMe: sessionRemembered,
      user: sessionUser ? { ...sessionUser } : null
    }
  },

  isAuthenticated() {
    return Boolean(sessionUser)
  },

  requireAuthenticated() {
    if (!sessionUser) throw new Error(authText('请先登录 SnapFlow', 'Please sign in to SnapFlow first'))
    return { ...sessionUser }
  },

  register(request: AuthRegisterRequest): AuthState {
    if (store.getAuthRecord().account) throw new Error(authText('此设备已经创建过 SnapFlow 本地账户，请直接登录', 'A local SnapFlow account already exists on this device. Please sign in.'))
    const email = localizedValidation(() => normalizeAuthEmail(request?.email))
    const displayName = localizedValidation(() => normalizeAuthDisplayName(request?.displayName))
    const password = localizedValidation(() => normalizeAuthPassword(request?.password))
    const now = new Date().toISOString()
    const salt = randomBytes(16).toString('hex')
    const account: StoredAuthAccount = {
      id: `user_${randomUUID().replace(/-/g, '')}`,
      email,
      displayName,
      passwordHash: derivePasswordHash(password, salt),
      passwordSalt: salt,
      createdAt: now,
      updatedAt: now
    }
    store.setAuthAccount(account)
    sessionUser = publicUser(account)
    sessionRemembered = false
    if (Boolean(request.rememberMe)) persistRememberedSession(account)
    else clearRememberedSession()
    logger.info('Local account created', { userId: account.id })
    return this.getState()
  },

  login(request: AuthLoginRequest): AuthState {
    const auth = store.getAuthRecord()
    const account = auth.account
    if (!account) throw new Error(authText('此设备还没有 SnapFlow 本地账户，请先注册', 'This device does not have a local SnapFlow account yet. Please register first.'))
    const email = localizedValidation(() => normalizeAuthEmail(request?.email))
    const password = localizedValidation(() => normalizeAuthPassword(request?.password))
    const candidate = derivePasswordHash(password, account.passwordSalt)
    if (email !== account.email || !secureHexEqual(candidate, account.passwordHash)) {
      throw new Error(authText('邮箱或密码不正确', 'Email or password is incorrect'))
    }
    sessionUser = publicUser(account)
    sessionRemembered = false
    if (Boolean(request.rememberMe)) persistRememberedSession(account)
    else clearRememberedSession()
    logger.info('Local account signed in', { userId: account.id, remembered: sessionRemembered })
    return this.getState()
  },

  logout(): AuthState {
    const userId = sessionUser?.id || ''
    sessionUser = null
    sessionRemembered = false
    clearRememberedSession()
    logger.info('Local account signed out', { userId })
    return this.getState()
  },

  resetLocalAccount(confirmation: unknown): AuthState {
    if (confirmation !== 'RESET') throw new Error(authText('重置确认文本不正确', 'Reset confirmation text is incorrect'))
    const account = store.getAuthRecord().account
    sessionUser = null
    sessionRemembered = false
    store.resetAuthAccount()
    logger.warn('Local login account reset; workspace preserved and provider credentials cleared', { userId: account?.id || '' })
    return this.getState()
  }
}
