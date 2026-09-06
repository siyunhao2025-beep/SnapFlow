# 截哥 Cloud 2.1

Node.js 22 + PostgreSQL 后端，同时服务于官网管理台和桌面版“截哥”。

已实现：

- 用户注册、登录、停用及 Cloud Credits 权威账本；
- Owner / Editor / Finance / Viewer 管理员角色与独立签名会话；
- 文献新增、编辑、下架、分类、JSON/CSV 批量导入和公开查询；
- 用户、余额、订单、充值记录及 Stripe Webhook；
- 管理员操作日志、一致性 GZIP 数据库快照和 SHA-256；
- 服务端 AI Provider 密钥、模型列表、AI 调用扣费/失败退费；
- 可重复运行的数据库迁移、单元/集成测试、Docker 和 GitHub Actions。

## 本地启动

```bash
cp .env.example .env
docker compose up --build
```

或使用自有 PostgreSQL：

```bash
npm ci
npm run migrate
npm run check
npm test
npm start
```

Cloud API 默认监听 `http://localhost:8787`。管理台在官网 `/admin/`，首次打开后使用 `ADMIN_BOOTSTRAP_TOKEN` 创建唯一的首位 Owner；初始化成功后该入口会在数据层关闭。

生产环境必须使用 HTTPS，并把真实密钥保存在主机密钥管理中，不要提交 `.env`。详见 [`../docs/CLOUD_DEPLOYMENT.md`](../docs/CLOUD_DEPLOYMENT.md) 和 [`../docs/ADMIN_CONSOLE.md`](../docs/ADMIN_CONSOLE.md)。
