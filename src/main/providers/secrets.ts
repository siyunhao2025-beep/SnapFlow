import { safeStorage } from 'electron'
import type { ProviderId } from '../../shared/types'
import { store } from '../store'
import { logger } from '../logger'

function tr(zh: string, en: string) { return store.getSettings().locale === 'en-US' ? en : zh }
export function getProviderSecret(provider: ProviderId) {
  const encrypted = store.getEncryptedSecret(provider)
  if (!encrypted) return ''
  try {
    if (!safeStorage.isEncryptionAvailable()) return ''
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch (error) {
    logger.warn('Failed to decrypt provider secret', { provider, error: String(error) })
    return ''
  }
}
export function encryptSecret(secret: string) {
  if (!secret) return ''
  if (!safeStorage.isEncryptionAvailable()) throw new Error(tr('系统安全存储不可用，SnapFlow 不会以明文保存 API Key', 'System secure storage is unavailable. SnapFlow will not save API keys as plaintext.'))
  return safeStorage.encryptString(secret).toString('base64')
}
export function providerHasCredential(provider: ProviderId) { return provider === 'ollama' || Boolean(getProviderSecret(provider)) }
