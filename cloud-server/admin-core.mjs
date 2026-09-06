import crypto from 'node:crypto'

export const ADMIN_ROLES = Object.freeze(['owner', 'editor', 'finance', 'viewer'])

export const ROLE_PERMISSIONS = Object.freeze({
  owner: ['dashboard', 'literature', 'users', 'orders', 'balances', 'logs', 'backups', 'admins'],
  editor: ['dashboard', 'literature'],
  finance: ['dashboard', 'users', 'orders', 'balances'],
  viewer: ['dashboard']
})

export function safeEqualText(a, b) {
  const aa = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb)
}

export function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64).toString('hex')
}

export function validateAdminUsername(value) {
  const username = String(value || '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
    throw Object.assign(new Error('管理员账号需为 3 至 64 位字母、数字、点、横线或下划线'), { status: 400 })
  }
  return username
}

export function validateStrongPassword(value) {
  const password = String(value || '')
  if (password.length < 12 || password.length > 256 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw Object.assign(new Error('管理员密码需为 12 至 256 位，并同时包含字母和数字'), { status: 400 })
  }
  return password
}

export function normalizeText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max)
}

export function normalizeLiterature(input = {}) {
  const title = normalizeText(input.title, 500)
  if (!title) throw Object.assign(new Error('文献标题不能为空'), { status: 400 })
  const year = input.year === '' || input.year == null ? null : Number(input.year)
  if (year !== null && (!Number.isInteger(year) || year < 1500 || year > 2200)) {
    throw Object.assign(new Error('文献年份无效'), { status: 400 })
  }
  const status = ['draft', 'published', 'withdrawn'].includes(input.status) ? input.status : 'draft'
  return {
    title,
    authors: Array.isArray(input.authors)
      ? input.authors.map((x) => normalizeText(x, 200)).filter(Boolean).slice(0, 100)
      : normalizeText(input.authors, 4000).split(/[;；\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 100),
    year,
    doi: normalizeText(input.doi, 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ''),
    url: normalizeText(input.url, 2048),
    abstract: normalizeText(input.abstract, 40_000),
    keywords: Array.isArray(input.keywords)
      ? input.keywords.map((x) => normalizeText(x, 120)).filter(Boolean).slice(0, 100)
      : normalizeText(input.keywords, 4000).split(/[,，;；\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 100),
    categoryId: normalizeText(input.categoryId ?? input.category_id, 80) || null,
    status,
    source: normalizeText(input.source, 300),
    notes: normalizeText(input.notes, 20_000)
  }
}

export function parsePagination(url, defaults = { limit: 50, max: 200 }) {
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1))
  const limit = Math.min(defaults.max, Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || defaults.limit)))
  return { page, limit, offset: (page - 1) * limit }
}

export function hasPermission(role, permission) {
  return Boolean(ROLE_PERMISSIONS[role]?.includes(permission))
}

export function csvToObjects(csv) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const value = String(csv || '').replace(/^\uFEFF/, '')
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]
    if (char === '"' && quoted && value[i + 1] === '"') { cell += '"'; i += 1; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (char === ',' && !quoted) { row.push(cell); cell = ''; continue }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && value[i + 1] === '\n') i += 1
      row.push(cell); cell = ''
      if (row.some((entry) => entry.trim())) rows.push(row)
      row = []
      continue
    }
    cell += char
  }
  row.push(cell)
  if (row.some((entry) => entry.trim())) rows.push(row)
  if (rows.length < 2) return []
  const headers = rows[0].map((entry) => entry.trim().toLowerCase().replace(/\s+/g, '_'))
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}

function b64url(input) { return Buffer.from(input).toString('base64url') }

export function signAdminToken(admin, secret, ttlSeconds = 8 * 60 * 60) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    sub: admin.id,
    username: admin.username,
    role: admin.role,
    scope: 'admin',
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + ttlSeconds
  }))
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

export function verifyAdminToken(token, secret) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return null
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url')
  if (!safeEqualText(expected, parts[2])) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (payload.scope !== 'admin' || !payload.sub || !payload.jti || payload.exp <= Date.now() / 1000) return null
    return payload
  } catch { return null }
}
