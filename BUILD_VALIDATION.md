# SnapFlow v2.0.0 — Build Validation

Date: 2026-08-25
Environment: non-Windows container; no project `node_modules` installed.

## Source/contract gates

| Gate | Result |
|---|---|
| package version 2.0.0 | PASS |
| Main entry `./out/main/index.js` | PASS |
| Preflight | PASS |
| IPC invoke symmetry | PASS — 69/69 |
| IPC event symmetry | PASS — 11/11 |
| Core regression | PASS — 39/39 |
| Release validation | PASS |
| Cloud server syntax | PASS |
| Website build script | PASS |
| Website source <200KB | PASS |
| NSIS + Portable targets declared | PASS |

## TypeScript

Final archive gate parsed **57 TS/TSX files with 0 parse errors** and transpiled **55 non-declaration TS/TSX files with 0 transpile errors** using the available TypeScript compiler. A **real** `npm run typecheck` still requires the project npm dependency tree. Running global `tsc --noEmit` without `node_modules` exits with `TS2688: Cannot find type definition file for node`, so this container intentionally does not claim real project typecheck PASS.

Status: **NOT VERIFIED with real project dependencies in this container**.

Windows owner/WorkBuddy must execute:

```powershell
npm install
npm run typecheck
```

and require 0 errors.

## Provider

Adapters/contracts exist for OpenAI, Anthropic, Gemini, xAI, DeepSeek, OpenRouter and Ollama. Private keys are deliberately absent from source.

Real external Provider E2E: **NOT VERIFIED**.

## Cloud

Cloud server syntax/schema/route contracts are statically validated. Production PostgreSQL, HTTPS, JWT, Provider master keys and Stripe are not available here.

Production Cloud E2E: **NOT VERIFIED**.

## Windows release

Configured target names:

```text
release/SnapFlow-Setup-2.0.0.exe
release/SnapFlow-Portable-2.0.0.exe
```

Windows runtime/build/packaged smoke/clean-machine installation: **NOT VERIFIED in this environment**.

## Website

`node scripts/build-website.cjs` builds `dist/site/` and injects release URLs from environment variables. With no real release URL, buttons remain unpublished/disabled by design.

Responsive/Lighthouse real browser measurement: **NOT VERIFIED**.
