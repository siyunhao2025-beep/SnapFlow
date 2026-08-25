# SnapFlow Website v2.0.0 — Deployment

## Build

Without real artifacts:

```bash
npm run website:build
```

Download buttons remain unpublished.

With a real Windows release:

```bash
SNAPFLOW_WINDOWS_SETUP_URL=https://cdn.example.com/SnapFlow-Setup-2.0.0.exe \
SNAPFLOW_WINDOWS_PORTABLE_URL=https://cdn.example.com/SnapFlow-Portable-2.0.0.exe \
SNAPFLOW_WINDOWS_SHA256=<sha256> \
SNAPFLOW_PUBLISHED_AT=2026-08-25 \
SNAPFLOW_UPDATE_BASE_URL=https://cdn.example.com/update/ \
npm run website:build
```

PowerShell uses equivalent `$env:NAME='value'` assignments.

## Deploy

Upload `dist/site/` to Nginx/static hosting/object storage. Configure `index.html` as default, HTTPS, cache policy, and correct content types. Versioned EXE artifacts should use immutable CDN paths; manifest should have a short cache TTL.

## Gate

Manually test 375/768/1440, light/dark, zh/en, mobile navigation, reduced motion and download URL. Run Lighthouse and target Performance >=90 / Accessibility >=95. Do not mark Lighthouse PASS without actual browser measurement.
