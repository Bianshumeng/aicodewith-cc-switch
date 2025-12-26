# 管理端部署说明（Docker）

## 目标

将 `server/` 部署到公网服务器，提供设备同步与管理端下发 API，供客户端每日 04:00 自动连接。

## 需要你提供/确认的信息

- 管理端公网地址（域名或公网 IP）
- 是否经过反向代理（决定 `TRUST_PROXY`）
- PostgreSQL 账号/密码/库名
- `SYNC_TOKEN` 与 `ADMIN_TOKEN`（建议随机生成）
- 是否启用 GeoIP（需要 GeoLite2-City.mmdb 路径）

## 快速部署步骤（Docker Compose）

1. 在服务器上准备目录并放入本项目代码。
2. 创建 `.env`（示例）：

```bash
POSTGRES_DB=ccswitch
POSTGRES_USER=ccswitch
POSTGRES_PASSWORD=change_me
DATABASE_URL=postgresql://ccswitch:change_me@db:5432/ccswitch
SYNC_TOKEN=sync_secret_here
ADMIN_TOKEN=admin_secret_here
TRUST_PROXY=false
```

3. 可选：放置 GeoIP 数据库文件  
将 `GeoLite2-City.mmdb` 放到 `./geoip/` 目录。

4. 启动服务：

```bash
docker compose up -d --build
```

5. 执行迁移（首次部署）：

```bash
docker compose exec -T db psql -U ccswitch -d ccswitch < server/migrations/20251225154000_init.sql
```

6. 健康检查：

```bash
curl http://<server-host>:8080/healthz
```

## 客户端对接所需配置

客户端运行环境需设置：

- `AI_CODE_WITH_MANAGEMENT_URL`（例如 `https://admin.aicodewith.com`）
- `AI_CODE_WITH_SYNC_TOKEN`（与 `SYNC_TOKEN` 一致）

## 请回传给我以下信息

- 公网访问地址（含 https）
- `SYNC_TOKEN`
- `ADMIN_TOKEN`
- 是否启用反向代理（以及是否设置 `TRUST_PROXY=true`）

