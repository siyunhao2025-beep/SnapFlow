# SnapFlow v2.0.0 — 主负责人维护指南

适用对象：项目负责人、WorkBuddy/Codex/Claude Code/Cursor 等后续开发者。

## 1. 维护原则

1. **v2.0.0 是唯一主干基线，不再叠加 v1.x Hotfix。**
2. 不从零重写；小步增量修改。
3. Provider Master Key / Stripe Secret 不进 Desktop、Git、`.env.example` 真实值或 `app.asar`。
4. 保持 `contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`。
5. Renderer 不直接访问 Electron、文件系统、Provider 或 Cloud Secret；统一走 Preload IPC。
6. 修改后先 `npm run verify`，发布前 `npm run verify:all`。
7. Windows/真实凭据/真实支付没有实测就写 `NOT VERIFIED`。

## 2. 负责人日常操作

首次：

```powershell
npm install
npm run electron:ensure
npm run verify
npm run dev
```

日常：

```powershell
npm run verify
npm run dev
```

发布候选：

```powershell
npm run verify:all
.\BUILD_WINDOWS.cmd
```

## 3. 代码地图

| 目标 | 主要位置 |
|---|---|
| 主生命周期/Tray/IPC | `src/main/index.ts` |
| 本机账户 | `src/main/auth.ts`, `src/shared/auth-core.ts` |
| Cloud 登录/Gateway | `src/main/cloud.ts`, `cloud-server/` |
| 截图 | `src/main/capture.ts`, `src/shared/capture-math.ts` |
| 本地 OCR | `src/main/local-ocr.ts`, `src/renderer/src/workers/ocr.worker.ts` |
| Provider 基类/Registry | `src/main/providers/base.ts`, `src/main/providers/registry.ts` |
| Provider 对外入口 | `src/main/providers/index.ts` |
| Provider Secret | `src/main/providers/secrets.ts` |
| Provider adapters | `src/main/providers/*.ts` |
| Provider 错误 | `src/shared/errors.ts` |
| Provider Audit | `src/main/audit-log.ts` |
| Provider policy/限流 | `src/shared/provider-policy.ts` |
| Auto Router | `src/main/router.ts`, `src/shared/model-router.ts` |
| Intent | `src/shared/intent.ts` |
| 登录 UI | `src/renderer/src/components/LoginPage.tsx` |
| Onboarding | `src/renderer/src/components/Onboarding.tsx` |
| Quick Layer | `src/renderer/src/components/QuickOverlay.tsx` |
| Workspace | `src/renderer/src/components/Workspace.tsx` |
| 中英文 | `src/renderer/src/i18n.tsx` |
| Safe Markdown | `SafeMarkdown.tsx`, `src/shared/sanitize.ts` |
| Store/Card/Project | `src/main/store.ts` |
| Search | `src/shared/search.ts`, `src/shared/semantic.ts` |
| Visual descriptor | `src/shared/visual.ts` |
| Thread | `src/shared/thread.ts` |
| Workflow | `src/shared/workflow.ts` |
| Privacy | `src/shared/privacy.ts` |
| Skill schema/index | `src/shared/skill-schema.ts`, `src/shared/skills-index.ts` |
| Skill runtime | `src/main/skills.ts` |
| Marketplace | `src/main/skill-marketplace.ts`, `resources/skill-marketplace.json` |
| Credits | `src/main/credits.ts` |
| Updater | `src/main/updater.ts` |
| Preload 白名单 | `src/preload/index.ts` |
| Windows 打包 | `package.json`, `BUILD_WINDOWS.cmd`, `scripts/build-windows.ps1` |
| 官网 | `snapflow-website/`, `scripts/build-website.cjs` |

## 4. 新增/修改 Provider 的标准流程

不要在 `Workspace.tsx` 里直接写 HTTP。

1. `src/shared/types.ts` 增加 `ProviderId`（若是新 Provider）。
2. 新建 `src/main/providers/<provider>.ts`，继承 `BaseProviderAdapter`。
3. 定义 descriptor：capabilities、defaultBaseURL、defaultModel、cost/speed。
4. 在 `registry.ts` 注册。
5. `listModels()` 必须真实请求或明确返回受控 fallback。
6. `testConnection()` 必须发真实请求；不能“只验证 Key 非空”。
7. `ask()` 遵循 capability；非 vision 模型收到 image 必须主动拒绝/走 OCR 策略。
8. 错误统一映射为 `ProviderError`。
9. Token usage 统一 `normaliseUsage()`。
10. 增加 core test / registry test。
11. `npm run verify`。

## 5. Demo → 真 AI

Demo Mode 只意味着当前没有可路由的真实 Provider。负责人测试时：

```text
Settings → AI Providers
→ Enabled
→ Base URL
→ API Key
→ Save
→ Load available models
→ 选择模型
→ Save & Test Connection
→ Connected
```

Key 不应发送给开发者或写入测试脚本。

## 6. Cloud 商业模式

Desktop 只保存 Cloud URL + Cloud Session Token；Master Provider Key、Stripe Secret、数据库凭据只在 `cloud-server`。

生产部署顺序：PostgreSQL → schema → HTTPS reverse proxy → Cloud env → Provider Key → Stripe webhook → Desktop 配置 Cloud URL。详见 `docs/CLOUD_DEPLOYMENT.md`。

不要把本地 Demo Credits 与 Cloud Credits 混为一套账本。

## 7. 中英文维护

所有用户可见字符串修改时同时检查 zh-CN/en-US：Login、Onboarding、Capture、Quick Layer、Workspace、Settings、Credits、Cloud、Marketplace、Updater、错误和空状态。

语言入口：`src/renderer/src/i18n.tsx`。

## 8. Privacy 变更原则

- 对“像素已遮挡”不能虚假承诺。
- 没有 OCR bounding boxes 时，只能说“文本已脱敏 / 原图未上传”等真实状态。
- 敏感应用黑名单必须在截图上传之前生效。
- 日志永不记录 Key、完整 prompt、图片 bytes。

## 9. Skill / Marketplace

Bundled Skill：`resources/skills/*.md`。新增 Skill 必须通过 schema；坏文件应被跳过而不是崩溃。

Remote Marketplace 必须 HTTPS。不要把可执行 JS 当 Skill 下载执行；当前市场下载的是 Markdown/文本 Skill 内容。

## 10. Visual Knowledge / Workflow

当前 semantic/vector 与 visual descriptor 都是本地轻量实现，不要宣传为 CLIP。若替换为真正 image-text embedding，保持 Card schema 向后兼容，并给 migration/version 字段。

Workflow 只能“建议”，不能在用户未授权时自动执行敏感操作。

## 11. 自动更新

生产 manifest 必须 HTTPS；发布前生成真实 Windows artifact SHA-256。Updater 的真实下载、Range/续传、签名和安装行为必须在 packaged Windows 实测。

## 12. 官网发布

```powershell
$env:SNAPFLOW_WINDOWS_SETUP_URL='https://.../SnapFlow-Setup-2.0.0.exe'
$env:SNAPFLOW_WINDOWS_PORTABLE_URL='https://.../SnapFlow-Portable-2.0.0.exe'
$env:SNAPFLOW_WINDOWS_SHA256='<sha256>'
$env:SNAPFLOW_PUBLISHED_AT='2026-08-25'
npm run website:build
```

没有真实 artifact URL 时下载按钮保持不可用，不写假下载数据。

## 13. 版本策略

- Patch：Bug/security/doc，不破坏数据/API。
- Minor：新增可选能力、Provider、Skill。
- Major：账户/Cloud protocol/Card schema 等破坏性变更。

每次升级同步：`package.json`、CHANGELOG、README、Release Checklist、官网 manifest/default version。

## 14. 发布门禁

最少：

```powershell
npm run preflight
npm run verify:ipc
npm run typecheck
npm test
npm run website:build
npm run release:validate
```

Windows Release 再执行 `BUILD_WINDOWS.cmd`，并真实启动 Setup/Portable。未实测的项目不允许写 PASS。
