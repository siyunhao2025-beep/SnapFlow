import test from 'node:test'
import assert from 'node:assert/strict'
import {
  csvToObjects,
  hasPermission,
  normalizeLiterature,
  signAdminToken,
  validateAdminUsername,
  validateStrongPassword,
  verifyAdminToken
} from '../admin-core.mjs'

test('role permissions keep editorial and finance boundaries separate', () => {
  assert.equal(hasPermission('owner', 'backups'), true)
  assert.equal(hasPermission('editor', 'literature'), true)
  assert.equal(hasPermission('editor', 'balances'), false)
  assert.equal(hasPermission('finance', 'balances'), true)
  assert.equal(hasPermission('finance', 'literature'), false)
})

test('administrator credentials reject weak input', () => {
  assert.throws(() => validateAdminUsername('x'))
  assert.throws(() => validateStrongPassword('onlyletters'))
  assert.equal(validateAdminUsername('Cloud.Owner_1'), 'cloud.owner_1')
  assert.equal(validateStrongPassword('very-long-password-123'), 'very-long-password-123')
})

test('admin token verifies signature, scope and expiry', () => {
  const secret = 'a-secure-test-secret-with-more-than-32-bytes'
  const token = signAdminToken({ id: 'admin-1', username: 'owner', role: 'owner' }, secret, 60)
  assert.equal(verifyAdminToken(token, secret).sub, 'admin-1')
  assert.equal(verifyAdminToken(token, secret + 'x'), null)
  assert.equal(verifyAdminToken(signAdminToken({ id: 'admin-1', username: 'owner', role: 'owner' }, secret, -1), secret), null)
})

test('literature normalization preserves physical metadata and controls status', () => {
  const item = normalizeLiterature({ title: 'MLT response', authors: 'A; B', year: '2026', doi: 'https://doi.org/10.1/demo', keywords: 'SABER, Dst', status: 'published' })
  assert.deepEqual(item.authors, ['A', 'B'])
  assert.deepEqual(item.keywords, ['SABER', 'Dst'])
  assert.equal(item.year, 2026)
  assert.equal(item.doi, '10.1/demo')
  assert.equal(item.status, 'published')
})

test('CSV parser supports quoted commas and escaped quotes', () => {
  const rows = csvToObjects('title,authors,year\n"Storm, response","A; B",2026\n"A ""quoted"" title",C,2025')
  assert.equal(rows[0].title, 'Storm, response')
  assert.equal(rows[1].title, 'A "quoted" title')
})
