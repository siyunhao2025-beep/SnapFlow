# Changelog

## 2.0.0 — 2026-08-25

### Desktop architecture
- Provider adapters 收敛为 `BaseProviderAdapter + ProviderRegistry`。
- Provider 错误分类、JSONL audit log、latency/requestId/token usage、redaction。
- Provider timeout/rate policy 与数据驱动 Compare。
- zh-CN / en-US 持久化。
- Local + Cloud 双登录入口与 `safeStorage` session/token。

### AI / Cloud / commercial foundation
- BYOK、Demo、Cloud Gateway 三模式分离。
- `cloud-server/`：PostgreSQL users/credits/ledger/cards、JWT、AI Gateway、Provider models、Stripe Checkout/Webhook。
- Cloud Credits 成为 Cloud 模式权威账本；Provider 失败退款。
- Cloud Card metadata sync 可选。

### Knowledge / workflow / privacy
- Local semantic search + visual descriptor/fingerprint。
- Project suggestions。
- Learned Workflow recommendations。
- Sensitive app blacklist、email/phone redaction、保守的 remote-image privacy policy。
- Local OCR / renderer worker 架构。

### Skills
- Skill schema/index 数据驱动。
- Skill Marketplace bundled/HTTPS remote index、安装/卸载。

### Security / update
- Safe Markdown / XSS URL filtering。
- Electron 安全隔离保持启用。
- electron-updater 服务：HTTPS manifest、定期检查、download progress、SHA-256 gate。

### Website
- 自包含移动优先官网：zh/en、Light/Dark、Hero particles、features、story、scenes、Windows release manifest。

### Verification
- Core regression：39/39 PASS（当前容器可验证）。
- IPC：69/69 invoke、11/11 event PASS。
- Preflight / release validation / website build PASS。
- Windows runtime、真实 Provider 私钥、Stripe/PostgreSQL production、Windows EXE：仍需实机，NOT VERIFIED。
