# 截哥 Cloud 部署指南

## 架构与责任边界

```text
GitHub Pages 官网 /admin/  ─┐
                           ├─ HTTPS ─> 截哥 Cloud (Node 22) ─> PostgreSQL
Windows 桌面版             ─┘                       ├─> AI Provider
                                                       └─> Stripe（可选）
```

GitHub Pages 只托管静态页面，不能运行 Node.js API 或 PostgreSQL。Cloud 容器必须部署到支持长驻 Node.js/Docker 与出站 HTTPS 的主机，数据库使用 PostgreSQL 17 或兼容版本。

## 1. 必需配置

| 名称 | 用途 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `JWT_SECRET` | 普通用户会话签名，至少 32 字节 |
| `ADMIN_JWT_SECRET` | 管理员会话独立签名，至少 32 字节 |
| `ADMIN_BOOTSTRAP_TOKEN` | 首位 Owner 的一次性初始化令牌 |
| `CORS_ORIGIN` | 允许来源，多个用逗号分隔 |
| `JIEGE_CLOUD_API_URL` | GitHub 仓库 Variable，例如 `https://api.example.com` |

可选配置 AI Provider 密钥和 Stripe 密钥；未配置时对应能力返回 503，不会伪装成已开通。

```bash
openssl rand -base64 48
```

## 2. 数据库迁移

```bash
cd cloud-server
npm ci
npm run migrate
```

`migrate.mjs` 先对新库应用完整 schema，再按文件名顺序执行 `migrations/`。已执行迁移的 SHA-256 会记入 `schema_migrations`；事后篡改旧迁移会直接失败。

## 3. 容器启动顺序

```bash
docker build -t jiege-cloud ./cloud-server
docker run --rm --env-file cloud-server/.env jiege-cloud node migrate.mjs
docker run -d --restart unless-stopped --env-file cloud-server/.env -p 8787:8787 jiege-cloud
```

将服务放在 HTTPS 反向代理/负载均衡器后，健康检查为 `GET /health`。

## 4. GitHub 连接

在仓库 `Settings → Secrets and variables → Actions` 中配置：

1. Variable `JIEGE_CLOUD_API_URL` = 生产 Cloud API HTTPS 根地址。
2. Secret `CLOUD_DEPLOY_WEBHOOK_URL` = 主机提供的部署 Hook（如果该主机支持）。

`cloud-ci.yml` 启动 PostgreSQL 17，执行语法检查、单元测试、迁移、API 集成测试和 Docker 构建。`cloud-deploy.yml` 只在测试通过后调用部署 Hook；未配置 Hook 时会明确跳过部署，不影响代码检查。

Pages 工作流会把同一 `JIEGE_CLOUD_API_URL` 写入官网 `config.js`；Windows 构建也会将其编译为新用户默认 Cloud 地址。旧用户已保存的地址不会被覆盖。

## 5. 首次初始化

1. 确认 `https://<cloud-host>/health` 返回 `ok: true`。
2. 打开 `https://siyunhao2025-beep.github.io/SnapFlow/admin/`。
3. 如尚未配置 Variable，先输入 Cloud API HTTPS 地址。
4. 使用 `ADMIN_BOOTSTRAP_TOKEN` 创建首位 Owner。
5. 创建成功后立即在主机上轮换/删除 `ADMIN_BOOTSTRAP_TOKEN`。

## 6. 备份与恢复

管理台备份用于小型数据集和快速导出，单份限制 100 MB，默认 30 天过期。生产环境还必须开启数据库主机的自动快照/PITR，并定期执行恢复演练。网页备份不是 PITR 的替代品。

## 7. 上线前检查

- Cloud API 仅 HTTPS，`CORS_ORIGIN` 不使用 `*`；
- 数据库不暴露公网，密钥在主机端加密保存；
- 在 Stripe 测试模式完成支付、重放、退款与对账；
- 确认暂停用户无法继续调用 AI、同步或充值；
- 下载一份备份并核对 `x-checksum-sha256`；
- 在纯净 Windows 机器验收桌面版注册、Cloud 登录、文献列表和 AI 调用。
