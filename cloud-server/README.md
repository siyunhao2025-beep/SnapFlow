# SnapFlow Cloud v2.0.0

Node 22 + PostgreSQL backend for Cloud account auth, server-side AI Provider keys, authoritative Cloud Credits, Stripe Checkout/Webhook, optional Card metadata sync, and AI Gateway.

## Quick start

```bash
psql "$DATABASE_URL" -f schema.sql
npm install
npm run check
npm start
```

Use environment variables based on `.env.example`; never commit real secrets. Put the server behind HTTPS. Configure Desktop `Settings → SnapFlow Cloud` with the HTTPS base URL, then Cloud register/login.

Provider Master Keys live only on this server; Desktop never receives them.

See `../docs/CLOUD_DEPLOYMENT.md` for production boundaries and hardening requirements.
