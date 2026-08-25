# SnapFlow v2.0.0 — Real AI Provider Setup

## 1. 三种 AI 模式

### BYOK
用户在本机输入自己的 API Key。Key 由 Electron Main 使用 `safeStorage` 保存；Renderer 不读取明文 Key。

### SnapFlow Cloud
Desktop 登录 Cloud，AI 请求发送到 SnapFlow AI Gateway；Provider Master Key 只在 Cloud Server。

### Demo
没有可用真实 Provider/Cloud 时才使用明确标注的 Mock。

## 2. BYOK 配置

`Settings → AI Providers`：

1. Enabled。
2. Base URL（官方地址优先）。
3. API Key。
4. Save。
5. Load available models。
6. 选择真实返回的 model。
7. 设置 Vision 能力（必须与模型真实能力一致）。
8. Save & Test Connection。
9. 看到 `Connected` 后再截图提问。

## 3. Provider

| Provider | Desktop Adapter | Vision policy |
|---|---|---|
| OpenAI | `providers/openai.ts` | 由 adapter/model capability 决定 |
| Anthropic | `providers/claude.ts` | 支持视觉模型时发送图片 |
| Gemini | `providers/gemini.ts` | 支持视觉模型时发送图片 |
| xAI | `providers/xai.ts` | 支持视觉模型时发送图片 |
| DeepSeek | `providers/deepseek.ts` | SnapFlow 当前按 OCR/text-only |
| OpenRouter | `providers/openrouter.ts` | 取决于所选上游模型 |
| Ollama | `providers/ollama.ts` | 取决于本地模型；无云 Key |

## 4. 错误分类

- `auth`：Key 无效/权限不足；
- `rate`：限流；
- `network`：网络失败；
- `timeout`：超时；
- `content`：内容/请求错误；
- `capability`：模型不支持当前能力；
- `server`：Provider 5xx；
- `unknown`：未归类。

审计日志不保存明文 Key/图片 bytes。

## 5. Cloud Provider

Cloud Server 通过环境变量配置 Provider Master Key。Desktop 只会看到 `/v1/providers` 返回的可用 Provider，并通过 Cloud Gateway 调用。

生产环境 Cloud URL 必须 HTTPS；localhost 调试可 HTTP。

## 6. 安全规则

- 不把 Key 发给开发者。
- 不把 Key 放 `.env.example`、截图、Issue、日志。
- 不在 Renderer 直接 fetch Provider。
- Test Connection 必须真实请求，不能只检查 Key 字符串。
- DeepSeek 未经验证不得在 UI 宣称直接截图视觉。
