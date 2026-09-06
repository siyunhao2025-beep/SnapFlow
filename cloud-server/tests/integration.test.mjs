import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const enabled = process.env.RUN_INTEGRATION === '1'
const port = Number(process.env.TEST_PORT || 8799)
const base = `http://127.0.0.1:${port}`

async function call(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } })
  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(`${response.status}: ${data.message || text}`)
  return data
}

test('Cloud administrator, literature, balances, logs and backup work together', { skip: !enabled, timeout: 40_000 }, async () => {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), JWT_SECRET: 'user-jwt-secret-with-at-least-32-bytes', ADMIN_JWT_SECRET: 'admin-jwt-secret-with-at-least-32-bytes', ADMIN_BOOTSTRAP_TOKEN: 'one-time-bootstrap-token', CORS_ORIGIN: 'https://siyunhao2025-beep.github.io' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { if ((await call('/health')).ok) break } catch { await delay(250) }
      if (attempt === 39) throw new Error('Cloud server did not become ready')
    }
    assert.equal((await call('/v1/admin/bootstrap/status')).configured, false)
    await call('/v1/admin/bootstrap', { method: 'POST', headers: { 'x-bootstrap-token': 'one-time-bootstrap-token' }, body: JSON.stringify({ username: 'owner', displayName: 'Owner', password: 'safe-admin-password-123' }) })
    assert.equal((await call('/v1/admin/bootstrap/status')).configured, true)
    const login = await call('/v1/admin/login', { method: 'POST', body: JSON.stringify({ username: 'owner', password: 'safe-admin-password-123' }) })
    const auth = { authorization: `Bearer ${login.token}` }
    const category = await call('/v1/admin/categories', { method: 'POST', headers: auth, body: JSON.stringify({ name: '空间天气', slug: 'space-weather', sortOrder: 1 }) })
    await call('/v1/admin/literature', { method: 'POST', headers: auth, body: JSON.stringify({ title: 'SABER MLT storm response', authors: ['Researcher'], year: 2026, doi: '10.0000/test', categoryId: category.item.id, status: 'published', abstract: 'Observed temperature response.' }) })
    const publicPage = await call('/v1/public/literature?q=SABER')
    assert.equal(publicPage.total, 1)
    const userRegistration = await call('/v1/auth/register', { method: 'POST', body: JSON.stringify({ email: 'user@example.com', displayName: 'User', password: 'user-password-123' }) })
    const users = await call('/v1/admin/users', { headers: auth })
    assert.equal(users.total, 1)
    const adjusted = await call(`/v1/admin/users/${users.items[0].id}/balance`, { method: 'POST', headers: auth, body: JSON.stringify({ delta: 25, reason: 'integration test' }) })
    assert.equal(adjusted.balance, 125)
    const order = await call('/v1/admin/orders', { method: 'POST', headers: auth, body: JSON.stringify({ userId: users.items[0].id, credits: 50, amountCents: 199, currency: 'cny', note: 'integration order' }) })
    await call(`/v1/admin/orders/${order.item.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'paid' }) })
    await call(`/v1/admin/orders/${order.item.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'paid' }) })
    assert.equal((await call('/v1/credits', { headers: { authorization: `Bearer ${userRegistration.token}` } })).balance, 175)
    assert.equal((await call('/v1/admin/recharges', { headers: auth })).total, 1)
    const editor = await call('/v1/admin/admins', { method: 'POST', headers: auth, body: JSON.stringify({ username: 'editor', displayName: 'Editor', password: 'safe-editor-password-123', role: 'editor' }) })
    await call(`/v1/admin/admins/${editor.item.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ role: 'viewer', active: true }) })
    await call(`/v1/admin/users/${users.items[0].id}/status`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'suspended' }) })
    await assert.rejects(call('/v1/credits', { headers: { authorization: `Bearer ${userRegistration.token}` } }), /403: Account suspended/)
    const backup = await call('/v1/admin/backups', { method: 'POST', headers: auth })
    assert.match(backup.backup.sha256, /^[0-9a-f]{64}$/)
    const logs = await call('/v1/admin/logs', { headers: auth })
    assert.ok(logs.total >= 4)
    const dashboard = await call('/v1/admin/dashboard', { headers: auth })
    assert.equal(dashboard.users, 1)
    assert.equal(dashboard.publishedLiterature, 1)
    assert.equal(dashboard.paidOrders, 1)
  } finally {
    child.kill('SIGTERM')
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3_000)])
  }
})
