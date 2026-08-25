# SnapFlow v2.0.0 — Windows Release Checklist

> 没有真实测试就写 `NOT VERIFIED`，不能用源码/开发模式成功替代 Installer/Portable。

## A. Source gate

- [ ] `package.json` = `2.0.0`
- [ ] `npm install`
- [ ] `npm run electron:ensure`
- [ ] `npm run preflight`
- [ ] `npm run verify:ipc`
- [ ] `npm run typecheck` → 0 errors
- [ ] `npm test` → 39/39 或更高
- [ ] `npm run website:build`
- [ ] `npm run release:validate`
- [ ] Secret scan 无真实 Key/.env/private key/runtime DB

## B. Login / i18n / onboarding

- [ ] Local Register/Login/Logout
- [ ] Remember Me 重启恢复
- [ ] Cloud Register/Login/Logout（有 Cloud 环境时）
- [ ] 中文 ↔ English 持久化
- [ ] Onboarding 1/2/3/4 可点击
- [ ] Onboarding 真截图完成门禁

## C. Desktop runtime

- [ ] 单实例
- [ ] Tray 菜单
- [ ] X 默认最小化托盘
- [ ] 开机启动开/关
- [ ] Alt+A
- [ ] 快捷键冲突错误可见
- [ ] Esc / 右键取消
- [ ] 100% / 125% / 150% / 4K
- [ ] 多显示器 / mixed-DPI
- [ ] Quick Layer 不越界

## D. Provider / AI

- [ ] 无 Key → Demo 明确标识
- [ ] OpenAI real key + model discovery + Test Connection
- [ ] Anthropic 或 Gemini real key + Test Connection
- [ ] Screenshot vision 真回答
- [ ] DeepSeek OCR/text-only
- [ ] Auto route 显示真实结果
- [ ] Manual model switch
- [ ] Compare ≥2 real Providers
- [ ] Consensus 不伪造置信度
- [ ] 错 Key → auth error + audit entry
- [ ] Timeout/Rate error UI

## E. Knowledge / privacy

- [ ] Card 保存截图+OCR+回答
- [ ] Thread 只有用户确认后继承上下文
- [ ] Project 创建/重命名/删除/移动
- [ ] Timeline/Gallery/Favorites
- [ ] Lexical Search
- [ ] Semantic/visual descriptor Search
- [ ] Project suggestion 不自动移动
- [ ] Learned Workflow 只建议
- [ ] Skill schema / Marketplace install/uninstall
- [ ] Sensitive App blacklist
- [ ] Email/phone redaction
- [ ] 截图 delete/manual-only 策略

## F. Credits / Cloud / Payment

- [ ] Demo UI Credits 与 Provider usage 分开
- [ ] BYOK usage 显示真实 token 或 Estimated
- [ ] Cloud Credits 权威余额
- [ ] Cloud AI 成功扣费
- [ ] Cloud AI Provider 失败退款
- [ ] Stripe test Checkout
- [ ] Stripe webhook signature
- [ ] 支付后刷新余额/ledger
- [ ] Cloud Card metadata sync（开启时）

无 Cloud/Stripe 环境的项目统一 `NOT VERIFIED`。

## G. Updater / Website

- [ ] packaged Windows 30s 检查更新
- [ ] HTTPS manifest
- [ ] download progress
- [ ] SHA-256 mismatch 丢弃下载
- [ ] 中断/Range 行为 Windows 实测
- [ ] 官网 375/768/1440 responsive
- [ ] Light/Dark + zh/en
- [ ] Download manifest 注入真实 EXE URL
- [ ] Lighthouse Performance ≥90 / Accessibility ≥95

## H. Packaging

```powershell
.\BUILD_WINDOWS.cmd
```

- [ ] `release\SnapFlow-Setup-2.0.0.exe`
- [ ] `release\SnapFlow-Portable-2.0.0.exe`
- [ ] `win-unpacked\SnapFlow.exe --smoke-test`
- [ ] Setup 双击安装/卸载
- [ ] Portable 双击启动
- [ ] 纯净 Win10/11 无 Node 机器测试
- [ ] EXE 无白屏 / preload / main.js / CSP 错误

## Release decision

只有 A–H 中所有“本版本必须项”真实通过，才可写 `Windows Release PASS`。其余保持 `NOT VERIFIED`。
