# SnapFlow v2.0.0

> **框一下，让最合适的 AI 理解、处理并记住。**  
> **Capture once. Let the right AI understand, act, and remember.**

SnapFlow 是一个 Windows 优先、以截图为入口的个人 AI 工作台。v2.0.0 将 v1.x 的截图工作流升级为三层产品：**本地/BYOK 桌面客户端、可选 SnapFlow Cloud 商业网关、视觉知识与工作流层**，并附带自包含官网源码。

## 版本状态

- 源码版本：`2.0.0`
- 主入口：`./out/main/index.js`
- Electron：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
- Windows 打包目标：NSIS x64 + Portable x64
- 真实 Windows EXE、真实 Provider 私钥、Stripe Production、PostgreSQL Production：**NOT VERIFIED in this container**

## 用户主链

```text
登录 / 注册
├─ 本机账户（Local-first）
└─ SnapFlow Cloud（可选）
       ↓
首次配置：AI / 快捷键 / 隐私 / 开机启动
       ↓
托盘常驻 + Alt+A
       ↓
框选截图 → 本地 OCR / 视觉描述 → Intent Router
       ↓
Dynamic Action Menu
       ↓
Auto / 手动模型 / Compare
       ↓
BYOK Provider / Cloud Gateway / Demo Mock
       ↓
Quick Layer 即时回答
       ↓
Card / Thread / Project / History
       ↓
Semantic Search / Workflow / Skills / Marketplace
```

## v2.0.0 功能

### 1. 双登录模式

- 本机账户：邮箱 + 显示名 + 密码；密码保存为加盐 `scrypt` 哈希。
- Remember Me：仅在 Electron `safeStorage` 可用时持久化。
- Cloud 账户：可配置 HTTPS Cloud URL，支持 Cloud 注册/登录/退出、余额状态和 Provider 可用性。
- Cloud Token：使用 `safeStorage`，不会写入 Renderer/localStorage。
- Local 与 Cloud 是两种入口模式；云端主 Provider Key 永远只存在服务端。

### 2. 中文 / English

运行时语言切换覆盖 Login、Onboarding、Capture、Quick Layer、Workspace、Settings、Credits、About、Intent、Skills、Provider 错误与默认 AI 回答语言。语言设置持久化。

### 3. Capture / Quick Layer

- 默认全局快捷键 `Alt+A`；
- 暗屏、十字框选、反向拖拽、Esc/右键取消；
- DPI 计算包含 125% / 150% 单元回归；
- 多显示器按鼠标所在 Display 计算与截断；
- 可选鼠标、声音、本地 OCR；
- 截图后显示轻量 Quick Layer，不强制打开 Workspace；
- Quick Layer 限制在工作区内，并支持继续追问、切模型、打开工作台。

### 4. Intent Router / Dynamic Action Menu

支持 `Programming Error / Code / Paper / Scientific Figure / Chart / Table / Excel / Web Page / Equation / PDF / Software UI / Translation / Document / General / Unknown`。

### 5. Provider Registry + 真 AI

Provider 已拆为统一 Adapter/Registry：

```text
src/main/providers/
├─ base.ts
├─ registry.ts
├─ openai.ts
├─ claude.ts
├─ gemini.ts
├─ xai.ts
├─ deepseek.ts
├─ openrouter.ts
└─ ollama.ts
```

支持：OpenAI、Anthropic、Gemini、xAI、DeepSeek、OpenRouter、Ollama。设置页支持加密保存 Key、动态读取模型、真实 Test Connection、Vision 能力、Timeout/Rate Limit 和错误归一。

没有任何可用真实 Provider 时才进入 **Demo Mode**，Mock 回答有明确标识。

> DeepSeek 当前桌面策略保持 `ocr-only/text`，不会被 SnapFlow 伪装为直接截图视觉 Provider。

### 6. Provider 错误与审计

统一错误分类：`auth / rate / network / timeout / content / capability / server / unknown`。审计日志按日期写 JSONL，保存 provider/model/status/latency/httpStatus/requestId/token usage 等，敏感文本经过 redaction，图片只记录 hash，不保存图片 bytes。

### 7. Auto Router / Compare / Consensus

- Auto 综合 Intent、Vision、Provider 可用性、速度、费用权重与偏好；
- 路由结果透明显示；
- Compare 数据驱动并行调用；
- 单模型失败不吞掉其他成功结果；
- Consensus 不制造“97.45% 正确率”一类伪精度。

### 8. Visual Knowledge Base

Card 可保存 OCR、回答、Tag、Project、Thread、视觉描述、语义向量和图片 fingerprint。搜索同时支持 lexical 与 local semantic ranking，并可利用 dominant colors / brightness / saturation / edge density 等视觉描述改善类似“蓝色科研图”的本地检索。

当前实现不是 CLIP/image-text foundation embedding；视觉 embedding backend 仍可后续替换。

### 9. Screenshot Thread / Project / Learned Workflow

- Thread 只在用户明确确认后继承上一张截图/问题/回答；
- Project 只提供建议，不擅自移动 Card；
- Learned Workflow 统计重复真实操作并提供快捷动作建议，不未经授权自动执行。

### 10. Privacy

- keep / delete-after-analysis / manual-only 截图策略；
- OCR/回答/app/window/clipboard 独立开关；
- 敏感应用黑名单；
- 邮箱/手机号文本 redaction；
- 无可靠像素 bounding boxes 时，不会假装已涂黑图片：需要脱敏时可阻止原图上传并只发送脱敏 OCR；
- “截图前后 30 秒上下文”仍未启用，不会偷偷录屏。

### 11. Skills + Marketplace

内置 Skill 使用强 schema 校验；坏格式 Skill 被跳过而不是导致应用崩溃。支持本地用户 Skill、bundled marketplace index、可选 HTTPS remote index 和安装/卸载。

### 12. Credits：Demo / BYOK / Cloud 三者分离

- BYOK：本地 SnapFlow UI Credits 只作为产品内部用量视图；Provider token usage 单独记录。
- Demo：明确标记 Local Simulation。
- Cloud：服务端 Cloud Credits 是权威账本；AI 调用先扣费，Provider 失败时退款；Stripe Checkout/Webhook 只在 Cloud Server 上处理 Secret。

### 13. SnapFlow Cloud

`cloud-server/` 提供 PostgreSQL + JWT + Cloud Credits + AI Gateway + Provider model listing + Stripe Checkout/Webhook + 可选 Card metadata sync 的参考生产架构。请阅读 `docs/CLOUD_DEPLOYMENT.md`。

### 14. 自动更新

`UpdaterService` 已接入 `electron-updater` 架构：30 秒后检查、6 小时间隔、HTTPS manifest、下载进度、SHA-256 校验、失败丢弃。真实 Windows Range/断点更新仍需 packaged Windows 实测。

### 15. 官网

`snapflow-website/` 是单文件、自包含、移动优先官网，包含中英、Light/Dark、粒子 Hero、功能区、Before/After、开发者故事、场景、Windows 下载和 manifest 注入。`npm run website:build` 输出 `dist/site/`。

## 开发启动

推荐 Windows 10/11 x64、Node.js 22 LTS。

```powershell
npm install
npm run electron:ensure
npm run verify
npm run dev
```

完整发布前门禁：

```powershell
npm run verify:all
```

Windows 构建：

```powershell
.\BUILD_WINDOWS.cmd
```

目标文件：

```text
release\SnapFlow-Setup-2.0.0.exe
release\SnapFlow-Portable-2.0.0.exe
```

## 目录

```text
src/main/                 Electron Main / auth / capture / providers / cloud / updater
src/preload/              IPC whitelist
src/renderer/             React UI / i18n / overlays / worker
src/shared/               pure logic / privacy / semantic / workflow / schemas
resources/skills/         bundled Skills
resources/skill-marketplace.json
cloud-server/             PostgreSQL + Cloud AI Gateway + Stripe
billing-server/           legacy/reference local Stripe bridge
snapflow-website/         static website source
scripts/                  verification / Electron bootstrap / Windows build / website build
tests/                    core regression
```

## 必须诚实保留的限制

以下项目不能由当前非 Windows、无私人凭据的容器替代真实验收：Windows 全局快捷键/托盘/混合 DPI、多显示器、真实 OpenAI/Claude/Gemini 等私人 Key、Stripe Production、PostgreSQL Production、electron-updater packaged update、Lighthouse 目标、Setup/Portable 在纯净 Windows 启动。参见 `BUILD_VALIDATION.md` 与 `RELEASE_CHECKLIST.md`。
