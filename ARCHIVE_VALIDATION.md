# SnapFlow v2.0.0 — Source Archive Validation

Date: 2026-08-25

This document defines the final source-archive gate. Final ZIP SHA-256 is written externally after packing.

## Required before packing

- package version `2.0.0`
- preflight PASS
- IPC 69/69 invoke + 11/11 event PASS
- core regression 39/39 PASS
- release validation PASS
- website build PASS
- Cloud/server/helper syntax PASS
- TypeScript syntax/transpile scan: 57 parsed / 55 transpiled, 0 errors
- no real secrets/private runtime artifacts

- Source/document files in gate scope before packing: 114

## Excluded

```text
node_modules/
out/
release/
dist/
.git/
.env
*.log
*.db
*.sqlite
*.sqlite3
*.pem
*.key
*.p12
*.pfx
coverage/
cache/
__pycache__/
.DS_Store
```

`.env.example` is allowed only when it contains placeholders.

## Reverse extraction

A clean extraction must include package 2.0.0, Login/i18n, Provider Registry, Cloud server/schema, Semantic/Workflow/Privacy, Marketplace, Updater, Website, Owner/Provider/Cloud/Release docs, Windows build scripts and tests.

The extracted tree must re-pass preflight, IPC, offline core and release validation.

## Scope

Archive PASS means source integrity/handoff PASS. It does **not** imply Windows Installer/Portable, real Provider or Cloud/Stripe production PASS.
