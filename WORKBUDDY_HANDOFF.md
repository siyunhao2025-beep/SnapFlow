# SnapFlow v2.0.0 — WorkBuddy Handoff

## Mission

以当前 v2.0.0 为唯一基线做 Windows 实机封版；**不要从零重写**。

## 先读

1. `OWNER_GUIDE.md`
2. `PROVIDER_SETUP.md`
3. `docs/CLOUD_DEPLOYMENT.md`
4. `RELEASE_CHECKLIST.md`
5. `BUILD_VALIDATION.md`

## 不可破坏

- Local/Cloud 登录
- zh-CN/en-US
- Alt+A / Capture / Quick Layer
- Provider Registry / BYOK / Cloud Gateway / Demo separation
- History / Card / Thread / Project
- Semantic Search / Visual descriptor / Workflow
- Skills / Marketplace
- Credits 分账
- Privacy redaction / sensitive-app policy
- Updater
- Website build
- `contextIsolation=true`, `nodeIntegration=false`, `sandbox=true`

## Windows 最小执行链

```powershell
npm install
npm run electron:ensure
npm run preflight
npm run verify:ipc
npm run typecheck
npm test
npm run website:build
npm run release:validate
npm run dev
```

手动通过 `RELEASE_CHECKLIST.md` 后：

```powershell
.\BUILD_WINDOWS.cmd
```

必须真实存在：

```text
release\SnapFlow-Setup-2.0.0.exe
release\SnapFlow-Portable-2.0.0.exe
```

## Provider 实测

使用负责人自己的测试 Key，不写入仓库。至少：

- OpenAI：Load Models → Test Connection → Screenshot Vision/文本；
- Anthropic 或 Gemini：同样走一遍；
- DeepSeek：按 OCR/text-only 路径；
- Compare：两个真实 Provider 并行；
- 错 Key：验证 auth 401 友好错误和 audit log；
- Rate/Timeout：验证错误 code 与 UI。

## Cloud 实测

如果提供 Cloud 环境：

1. PostgreSQL apply `cloud-server/schema.sql`。
2. 启动 HTTPS Cloud Server。
3. Desktop Cloud 注册/登录。
4. `/v1/providers`、model list、ask。
5. Cloud Credit 扣费；Provider 失败时退款。
6. Stripe test mode Checkout + webhook；余额刷新。
7. Card metadata sync（若开启）。

没有真实 Cloud/Stripe 凭据则写 `NOT VERIFIED`。

## 输出报告

文件名：`validation-report-windows-v2.0.0-<name>-<YYYYMMDD>.md`。

表格列：分类 / 项目 / 期望 / 实测 / 结果 / 截图或日志。

规则：没有真实跑过就 `NOT VERIFIED`；开发模式成功不能替代 packaged EXE。
