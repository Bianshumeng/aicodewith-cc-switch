# Management Server

## Environment Variables

- `DATABASE_URL` (required)
- `SYNC_TOKEN` (required)
- `ADMIN_TOKEN` (required)
- `BIND_ADDR` (optional, default: 0.0.0.0:8080)
- `GEOIP_DB_PATH` (optional, MaxMind database path)
- `TRUST_PROXY` (optional, true|false)

## Migrations

Apply SQL files in `server/migrations` before starting the service. You can use
`sqlx migrate run` or execute the SQL manually with your database tool.

## Run

```bash
cargo run
```
