# SnapFlow v2.0.0 — Validation Report

Date: 2026-08-25

## Current-container evidence

- Preflight: PASS
- IPC invoke: 69/69 PASS
- IPC event: 11/11 PASS
- Offline/core tests: 39/39 PASS
- Release validation: PASS
- Website build: PASS
- Cloud/server helper syntax: PASS
- TypeScript syntax gate: 57 parsed, 0 errors; 55 non-declaration files transpiled, 0 errors
- Secret/runtime artifact scan: 114 source/document files, 0 forbidden private/runtime files, 0 obvious secret hits
- Source/archive secret gate: performed again immediately before final ZIP

## Environment limitation

This container has Node/TypeScript available globally but no project `node_modules`; therefore real project `npm run typecheck`, Electron runtime and electron-builder cannot be represented as PASS here.

## Required Windows evidence

Use `RELEASE_CHECKLIST.md` and produce `validation-report-windows-v2.0.0-<name>-<date>.md`. At minimum attach evidence for:

- 0-error `npm run typecheck`
- Login/i18n/Onboarding
- Alt+A/Capture/Quick Layer
- 125/150% and multi-display
- real Provider Test Connection + screenshot answer
- Compare
- History/Search/Workflow/Skills
- packaged Setup + Portable launch

## External-service evidence

If commercial Cloud is in release scope, separately provide test evidence for PostgreSQL Cloud auth, Cloud AI debit/refund, Stripe test Checkout/Webhook and credit refresh.
