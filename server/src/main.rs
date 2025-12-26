use axum::{
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use maxminddb::Reader;
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgPoolOptions, types::Json as SqlxJson, PgPool};
use std::{
    env,
    net::{IpAddr, SocketAddr},
    sync::Arc,
};
use tower_http::trace::TraceLayer;

#[derive(Clone)]
struct AppState {
    pool: PgPool,
    geoip: Option<Arc<Reader<Vec<u8>>>>,
    sync_token: String,
    admin_token: String,
    trust_proxy: bool,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Json(serde_json::json!({
            "ok": false,
            "error": self.message,
        }));
        (self.status, body).into_response()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncRequest {
    device_id: String,
    app_version: Option<String>,
    applied_admin_version: Option<i64>,
    snapshot: serde_json::Value,
    client_time: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncResponse {
    ok: bool,
    server_time: String,
    admin_config: Option<serde_json::Value>,
    admin_version: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminConfigRequest {
    config: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminConfigResponse {
    ok: bool,
    version: i64,
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let database_url = require_env("DATABASE_URL");
    let sync_token = require_env("SYNC_TOKEN");
    let admin_token = require_env("ADMIN_TOKEN");
    let bind_addr = env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let trust_proxy = env::var("TRUST_PROXY")
        .map(|value| value == "true")
        .unwrap_or(false);

    let geoip = env::var("GEOIP_DB_PATH")
        .ok()
        .and_then(|path| Reader::open_readfile(path).ok())
        .map(Arc::new);

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("failed to connect to database");

    let state = AppState {
        pool,
        geoip,
        sync_token,
        admin_token,
        trust_proxy,
    };

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/api/v1/devices/sync", post(sync_device))
        .route(
            "/api/v1/admin/devices/:device_id/config",
            post(upsert_admin_config),
        )
        .with_state(state)
        .layer(TraceLayer::new_for_http());

    let addr: SocketAddr = bind_addr.parse().expect("invalid BIND_ADDR");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind address");

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .expect("server error");
}

async fn healthz() -> &'static str {
    "ok"
}

async fn sync_device(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(payload): Json<SyncRequest>,
) -> Result<Json<SyncResponse>, ApiError> {
    authorize(&headers, &state.sync_token)?;

    if payload.device_id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "device_id is required"));
    }

    let now = Utc::now();
    let ip = extract_ip(&headers, addr, state.trust_proxy);
    let geo = ip.and_then(|ip| lookup_geo(&state.geoip, ip));

    upsert_device(&state.pool, &payload, now, ip, geo.as_ref()).await?;
    insert_snapshot(&state.pool, &payload.device_id, &payload.snapshot, now).await?;

    let admin = fetch_admin_config(&state.pool, &payload.device_id).await?;

    Ok(Json(SyncResponse {
        ok: true,
        server_time: now.to_rfc3339(),
        admin_config: admin.as_ref().map(|item| item.config.clone()),
        admin_version: admin.map(|item| item.version),
    }))
}

async fn upsert_admin_config(
    State(state): State<AppState>,
    Path(device_id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<AdminConfigRequest>,
) -> Result<Json<AdminConfigResponse>, ApiError> {
    authorize(&headers, &state.admin_token)?;

    if device_id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "device_id is required"));
    }

    let now = Utc::now();
    let next_version = fetch_next_admin_version(&state.pool, &device_id).await?;

    sqlx::query(
        "INSERT INTO admin_configs (device_id, version, config, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (device_id)
         DO UPDATE SET version = EXCLUDED.version, config = EXCLUDED.config, updated_at = EXCLUDED.updated_at",
    )
    .bind(&device_id)
    .bind(next_version)
    .bind(SqlxJson(payload.config))
    .bind(now)
    .execute(&state.pool)
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;

    Ok(Json(AdminConfigResponse {
        ok: true,
        version: next_version,
    }))
}

fn authorize(headers: &HeaderMap, expected: &str) -> Result<(), ApiError> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");

    if auth != format!("Bearer {}", expected) {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "unauthorized"));
    }

    Ok(())
}

fn extract_ip(headers: &HeaderMap, addr: SocketAddr, trust_proxy: bool) -> Option<IpAddr> {
    if trust_proxy {
        if let Some(value) = headers.get("x-forwarded-for") {
            if let Ok(text) = value.to_str() {
                if let Some(first) = text.split(',').next() {
                    if let Ok(ip) = first.trim().parse::<IpAddr>() {
                        return Some(ip);
                    }
                }
            }
        }
    }
    Some(addr.ip())
}

fn lookup_geo(geoip: &Option<Arc<Reader<Vec<u8>>>>, ip: IpAddr) -> Option<GeoResult> {
    let reader = geoip.as_ref()?;
    let result = reader.lookup::<maxminddb::geoip2::City>(ip).ok()?;

    let country = result
        .country
        .and_then(|c| c.iso_code.map(|code| code.to_string()));
    let region = result
        .subdivisions
        .and_then(|subs| subs.first().and_then(|sub| sub.iso_code.map(|code| code.to_string())));
    let city = result
        .city
        .and_then(|city| city.names.and_then(|names| names.get("en").cloned()));

    Some(GeoResult {
        country,
        region,
        city,
    })
}

struct GeoResult {
    country: Option<String>,
    region: Option<String>,
    city: Option<String>,
}

async fn upsert_device(
    pool: &PgPool,
    payload: &SyncRequest,
    now: DateTime<Utc>,
    ip: Option<IpAddr>,
    geo: Option<&GeoResult>,
) -> Result<(), ApiError> {
    let ip_str = ip.map(|value| value.to_string());
    let geo_country = geo.and_then(|g| g.country.clone());
    let geo_region = geo.and_then(|g| g.region.clone());
    let geo_city = geo.and_then(|g| g.city.clone());

    sqlx::query(
        "INSERT INTO devices (device_id, fingerprint_hash, last_seen, last_ip, geo_country, geo_region, geo_city, app_version, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (device_id)
         DO UPDATE SET last_seen = EXCLUDED.last_seen,
                       last_ip = EXCLUDED.last_ip,
                       geo_country = EXCLUDED.geo_country,
                       geo_region = EXCLUDED.geo_region,
                       geo_city = EXCLUDED.geo_city,
                       app_version = EXCLUDED.app_version",
    )
    .bind(&payload.device_id)
    .bind(&payload.device_id)
    .bind(now)
    .bind(ip_str)
    .bind(geo_country)
    .bind(geo_region)
    .bind(geo_city)
    .bind(payload.app_version.clone())
    .bind(now)
    .execute(pool)
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;

    Ok(())
}

async fn insert_snapshot(
    pool: &PgPool,
    device_id: &str,
    snapshot: &serde_json::Value,
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO config_snapshots (device_id, snapshot, created_at) VALUES ($1, $2, $3)",
    )
    .bind(device_id)
    .bind(SqlxJson(snapshot.clone()))
    .bind(now)
    .execute(pool)
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;

    Ok(())
}

struct AdminConfigRow {
    version: i64,
    config: serde_json::Value,
}

async fn fetch_admin_config(
    pool: &PgPool,
    device_id: &str,
) -> Result<Option<AdminConfigRow>, ApiError> {
    let row = sqlx::query_as::<_, (i64, SqlxJson<serde_json::Value>)>(
        "SELECT version, config FROM admin_configs WHERE device_id = $1",
    )
    .bind(device_id)
    .fetch_optional(pool)
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;

    let Some((version, config)) = row else {
        return Ok(None);
    };

    Ok(Some(AdminConfigRow {
        version,
        config: config.0,
    }))
}

async fn fetch_next_admin_version(pool: &PgPool, device_id: &str) -> Result<i64, ApiError> {
    let row = sqlx::query_as::<_, (i64,)>(
        "SELECT version FROM admin_configs WHERE device_id = $1",
    )
    .bind(device_id)
    .fetch_optional(pool)
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;

    Ok(row.map(|(version,)| version + 1).unwrap_or(1))
}

fn require_env(key: &str) -> String {
    env::var(key).unwrap_or_else(|_| panic!("missing env: {}", key))
}
