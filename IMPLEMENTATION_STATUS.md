# SnapFlow v2.0.0 — Implementation Status

Date: 2026-08-25

## Implemented in source

### P0/P1 desktop
- Local login/register/remember-me + Cloud login mode
- zh-CN/en-US
- global capture architecture / Quick Layer / Workspace
- Intent Router / Dynamic Actions
- Provider Registry: OpenAI/Anthropic/Gemini/xAI/DeepSeek/OpenRouter/Ollama
- dynamic model listing / real Test Connection
- Provider error/audit/rate/timeout
- Auto Router / data-driven Compare / Consensus
- Card/Thread/Project/Timeline/Gallery/Favorites
- lexical + local semantic/visual search
- Privacy policies / sensitive-app / redaction
- Skills schema / Marketplace
- Learned Workflow
- UI Credits / Provider usage separation

### Cloud/commercial foundation
- PostgreSQL schema
- Cloud auth JWT
- Cloud Provider discovery/models/AI Gateway
- authoritative Cloud Credits + ledger
- Stripe Checkout/Webhook signature path
- failed AI debit refund
- optional Card metadata sync

### P2
- UpdaterService + electron-updater architecture
- HTTPS manifest + SHA-256 downloaded artifact check
- website source/build/manifest injection

## Verified in current container

- `node scripts/preflight.cjs`: PASS
- `node scripts/verify-ipc.cjs`: 69/69 invoke, 11/11 event PASS
- `node scripts/offline-core-test.cjs`: 39/39 PASS
- `node scripts/release-validate.cjs`: PASS
- Cloud/Website/Node helper syntax: PASS
- website build: PASS, source remains <200KB
- static secret/security gates: PASS to the extent scanned

## NOT VERIFIED here

- Real `npm run typecheck` with npm-installed Electron/React dependency tree
- Windows Electron v2.0.0 startup
- Tray/globalShortcut/mixed-DPI/multi-monitor real device behavior
- private real Provider keys end-to-end
- Cloud PostgreSQL production
- Stripe production/test account end-to-end
- packaged updater Range/resume behavior
- Lighthouse target
- NSIS/Portable v2.0.0 actual artifact generation and clean-machine launch

These items must not be converted to PASS without evidence from Windows/external services.
