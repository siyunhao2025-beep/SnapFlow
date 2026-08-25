# SnapFlow Cloud v2.0.0 — Deployment Guide

## Architecture

```text
SnapFlow Desktop
  ↓ HTTPS + Bearer token
SnapFlow Cloud (Node 22)
  ├─ PostgreSQL
  ├─ Provider Master Keys
  ├─ Cloud Credits / Ledger
  ├─ AI Gateway
  ├─ Stripe Checkout / Webhook
  └─ Optional Card metadata sync
```

## 1. PostgreSQL

Create a dedicated database/user and apply:

```bash
psql "$DATABASE_URL" -f cloud-server/schema.sql
```

Tables: `users`, `credit_accounts`, `credit_ledger`, `synced_cards`.

## 2. Environment

Copy values conceptually from `cloud-server/.env.example`; **never commit the real file**.

Required production values:

- `DATABASE_URL`
- `JWT_SECRET` — at least 32 random bytes
- `CORS_ORIGIN`
- at least one Provider Master Key
- Stripe values only when payment is enabled

## 3. Run

```bash
cd cloud-server
npm install
npm run check
npm start
```

Put the process behind HTTPS (Nginx/Caddy/Cloudflare). Desktop production Cloud URL must use HTTPS; only localhost may use HTTP.

## 4. Provider boundary

Provider Master Keys never leave Cloud Server. Desktop calls `/v1/providers`, provider model endpoint and `/v1/ai/ask` using its Cloud bearer token.

## 5. Credits

Cloud registers users with welcome credits in the current reference schema. `/v1/ai/ask` debits before Provider call, annotates usage on success, and refunds the debit on Provider failure.

Adjust product pricing in server configuration/code only after defining a real commercial pricing policy; do not present local UI Credits as Provider invoice data.

## 6. Stripe

Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, success/cancel URL. Register webhook endpoint:

```text
POST /v1/stripe/webhook
```

Test in Stripe test mode before production. Webhook signature must verify before ledger credit.

## 7. Card sync

When enabled, Desktop can sync Card metadata. Server intentionally removes local screenshot/thumbnail path and image bytes from synced payload. Review privacy policy before enabling for real users.

## 8. Production hardening still required

The supplied Cloud server is a reference production-oriented foundation, not a completed compliance platform. Before public SaaS launch add/verify: email verification/password recovery, token rotation/revocation, CSRF/CORS strategy, rate limiting at reverse proxy/WAF, structured migrations, backup/restore, observability, privacy/retention policy, billing reconciliation, abuse controls and legal terms.

Do not mark these as implemented unless separately built and tested.
