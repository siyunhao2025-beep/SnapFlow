import 'dotenv/config'
import express from 'express'
import Stripe from 'stripe'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8787)
const ledgerPath = path.resolve(process.env.LEDGER_PATH || path.join(__dirname, 'ledger.json'))
const app = express()
const devicePattern = /^device_[A-Za-z0-9_-]{6,80}$/

function getStripe() {
  const key = String(process.env.STRIPE_SECRET_KEY || '').trim()
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(key)
}

function publicBaseUrl() {
  const raw = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`
  const url = new URL(raw)
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('PUBLIC_BASE_URL must use HTTPS outside localhost')
  }
  return url.toString().replace(/\/$/, '')
}

function loadLedger() {
  if (!fs.existsSync(ledgerPath)) return { devices: {}, processedEvents: [] }
  try {
    const value = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    return {
      devices: value?.devices && typeof value.devices === 'object' ? value.devices : {},
      processedEvents: Array.isArray(value?.processedEvents) ? value.processedEvents : []
    }
  } catch (error) {
    const quarantine = `${ledgerPath}.corrupt.${Date.now()}`
    try { fs.copyFileSync(ledgerPath, quarantine) } catch {}
    console.error('[ledger] Invalid ledger JSON; quarantined before reset:', quarantine, error)
    return { devices: {}, processedEvents: [] }
  }
}

function saveLedger(data) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true })
  const temp = `${ledgerPath}.tmp`
  const backup = `${ledgerPath}.bak`
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8')
  try { if (fs.existsSync(ledgerPath)) fs.copyFileSync(ledgerPath, backup) } catch {}
  try {
    fs.renameSync(temp, ledgerPath)
  } catch {
    fs.copyFileSync(temp, ledgerPath)
    fs.unlinkSync(temp)
  }
}

function addCredits(deviceId, credits, eventId) {
  if (!devicePattern.test(deviceId)) throw new Error('invalid deviceId')
  if (!Number.isSafeInteger(credits) || credits <= 0 || credits > 1_000_000) throw new Error('invalid credits')
  const db = loadLedger()
  if (eventId && db.processedEvents.includes(eventId)) return Number(db.devices[deviceId] || 0)
  db.devices[deviceId] = Number(db.devices[deviceId] || 0) + credits
  if (eventId) db.processedEvents.push(eventId)
  db.processedEvents = db.processedEvents.slice(-5000)
  saveLedger(db)
  return db.devices[deviceId]
}

// Stripe signature verification requires the raw request body before express.json().
app.post('/webhook', express.raw({ type: 'application/json', limit: '2mb' }), (req, res) => {
  try {
    const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim()
    if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured')
    const sig = req.headers['stripe-signature']
    if (typeof sig !== 'string') throw new Error('stripe-signature header missing')
    const event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret)
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const deviceId = String(session.metadata?.deviceId || '')
      const credits = Number(session.metadata?.credits || 0)
      if (devicePattern.test(deviceId) && Number.isSafeInteger(credits) && credits > 0 && session.payment_status === 'paid') {
        addCredits(deviceId, credits, event.id)
      }
    }
    res.json({ received: true })
  } catch (error) {
    console.error('[webhook]', error)
    res.status(400).json({ error: 'Webhook verification failed' })
  }
})

app.use(express.json({ limit: '128kb' }))

app.get('/health', (_req, res) => res.json({ ok: true, stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY) }))
app.get('/credits/:deviceId', (req, res) => {
  const deviceId = String(req.params.deviceId || '')
  if (!devicePattern.test(deviceId)) return res.status(400).json({ error: 'invalid deviceId' })
  const db = loadLedger()
  res.json({ deviceId, balance: Math.max(0, Number(db.devices[deviceId] || 0)) })
})

app.post('/checkout', async (req, res) => {
  try {
    const deviceId = String(req.body?.deviceId || '')
    const credits = Number(req.body?.credits || 0)
    if (!devicePattern.test(deviceId)) return res.status(400).json({ error: 'invalid deviceId' })
    const priceMap = {
      100: process.env.STRIPE_PRICE_100,
      500: process.env.STRIPE_PRICE_500,
      1000: process.env.STRIPE_PRICE_1000
    }
    const price = priceMap[credits]
    if (!price) return res.status(400).json({ error: 'unsupported credit package' })

    const base = publicBaseUrl()
    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: deviceId,
      metadata: { deviceId, credits: String(credits) },
      success_url: `${base}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/cancel`
    })
    if (!session.url) throw new Error('Stripe did not return a Checkout URL')
    res.json({ id: session.id, url: session.url })
  } catch (error) {
    console.error('[checkout]', error)
    res.status(500).json({ error: 'Unable to create checkout session' })
  }
})

app.get('/success', (_req, res) => res.type('html').send('<h2>SnapFlow 充值已提交</h2><p>支付回调确认后积分到账。你可以关闭此页面并返回 SnapFlow。</p>'))
app.get('/cancel', (_req, res) => res.type('html').send('<h2>已取消充值</h2><p>未产生扣款。</p>'))

app.listen(PORT, () => console.log(`SnapFlow billing server listening on :${PORT}`))
