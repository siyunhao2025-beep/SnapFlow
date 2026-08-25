import { scryptSync, timingSafeEqual } from 'node:crypto'

export const AUTH_PASSWORD_MIN = 8
export const AUTH_PASSWORD_MAX = 256
export const AUTH_EMAIL_MAX = 254
export const AUTH_NAME_MAX = 80

export function normalizeAuthEmail(value: unknown) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!email || email.length > AUTH_EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('请输入有效的邮箱地址')
  }
  return email
}

export function normalizeAuthDisplayName(value: unknown) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (name.length < 1 || name.length > AUTH_NAME_MAX) throw new Error('昵称长度应为 1–80 个字符')
  return name
}

export function normalizeAuthPassword(value: unknown) {
  const password = typeof value === 'string' ? value : ''
  if (password.length < AUTH_PASSWORD_MIN) throw new Error(`密码至少需要 ${AUTH_PASSWORD_MIN} 个字符`)
  if (password.length > AUTH_PASSWORD_MAX) throw new Error(`密码不能超过 ${AUTH_PASSWORD_MAX} 个字符`)
  return password
}

export function derivePasswordHash(password: string, saltHex: string) {
  return scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex')
}

export function secureHexEqual(aHex: string, bHex: string) {
  try {
    const a = Buffer.from(aHex, 'hex')
    const b = Buffer.from(bHex, 'hex')
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
  } catch {
    return false
  }
}
