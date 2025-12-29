# Management Server

## Environment Variables

- `DATABASE_URL` (required)
- `SYNC_TOKEN` (required)
- `ADMIN_TOKEN` (required)
- `ADMIN_BASIC_USER` (optional, Basic Auth username)
- `ADMIN_BASIC_PASSWORD` (optional, Basic Auth password)
- `BIND_ADDR` (optional, default: 0.0.0.0:8080)
- `GEOIP_DB_PATH` (optional, MaxMind database path)
- `TRUST_PROXY` (optional, true|false)
- `UI_DIST_DIR` (optional, default: ui/dist)

## Migrations

Apply SQL files in `server/migrations` before starting the service. You can use
`sqlx migrate run` or execute the SQL manually with your database tool.

## Run

```bash
cargo run
```

## Admin UI

If UI assets are available, the admin panel is served at `/admin`.
The UI sends `ADMIN_TOKEN` by default. If you rely on Basic Auth at the proxy
layer, leave the token empty and ensure the proxy forwards the auth header.
