use axum::{
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose, Engine as _};
use chrono::{DateTime, Utc};
use maxminddb::Reader;
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgPoolOptions, types::Json as SqlxJson, PgPool, Row};
use std::{
    env,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::Arc,
};
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

#[derive(Clone)]
struct AppState {
    pool: PgPool,
    geoip: Option<Arc<Reader<Vec<u8>>>>,
    sync_token: String,
    admin_token: String,
    admin_basic_user: Option<String>,
    admin_basic_password: Option<String>,
    trust_proxy: bool,
    ui_dir: PathBuf,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchConfigRequest {
    device_ids: Vec<String>,
    config: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchConfigResponse {
    ok: bool,
    updated: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeviceSummary {
    device_id: String,
    fingerprint_hash: String,
    last_seen: Option<DateTime<Utc>>,
    last_ip: Option<String>,
    geo_country: Option<String>,
    geo_region: Option<String>,
    geo_city: Option<String>,
    app_version: Option<String>,
    created_at: Option<DateTime<Utc>>,
    snapshot_count: i64,
    last_snapshot_at: Option<DateTime<Utc>>,
    admin_version: Option<i64>,
    admin_updated_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceListResponse {
    devices: Vec<DeviceSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotItem {
    id: i64,
    created_at: DateTime<Utc>,
    snapshot: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminConfigItem {
    version: i64,
    updated_at: DateTime<Utc>,
    config: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceDetailResponse {
    device: DeviceSummary,
    snapshots: Vec<SnapshotItem>,
    admin_config: Option<AdminConfigItem>,
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
    let ui_dir = env::var("UI_DIST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("ui/dist"));

    let (admin_basic_user, admin_basic_password) = match (
        env::var("ADMIN_BASIC_USER").ok(),
        env::var("ADMIN_BASIC_PASSWORD").ok(),
    ) {
        (Some(user), Some(pass)) if !user.trim().is_empty() && !pass.trim().is_empty() => {
            (Some(user), Some(pass))
        }
        _ => (None, None),
    };

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
        admin_basic_user,
        admin_basic_password,
        trust_proxy,
        ui_dir: ui_dir.clone(),
    };

    let ui_router = if ui_dir.exists() {
        let index_path = ui_dir.join("index.html");
        Router::new().nest_service(
            "/admin",
            ServeDir::new(ui_dir).not_found_service(ServeFile::new(index_path)),
        )
    } else {
        Router::new()
    };

    let app = Router::new()
        .merge(ui_router)
        .route("/healthz", get(healthz))
        .route("/api/v1/devices/sync", post(sync_device))
        .route("/api/v1/admin/devices", get(list_devices))
        .route("/api/v1/admin/devices/:device_id", get(get_device_detail))
        .route(
            "/api/v1/admin/devices/:device_id/config",
            post(upsert_admin_config),
        )
        .route(
            "/api/v1/admin/devices/config/batch",
            post(batch_admin_config),
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
    authorize_bearer(&headers, &state.sync_token)?;

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

async fn list_devices(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<DeviceListResponse>, ApiError> {
    authorize_admin(&headers, &state)?;

    let rows = sqlx::query(
        "SELECT d.device_id, d.fingerprint_hash, d.last_seen, d.last_ip, d.geo_country, d.geo_region, d.geo_city,
                d.app_version, d.created_at,
                COUNT(s.id) AS snapshot_count,
                MAX(s.created_at) AS last_snapshot_at,
                a.version AS admin_version,
                a.updated_at AS admin_updated_at
         FROM devices d
         LEFT JOIN config_snapshots s ON d.device_id = s.device_id
         LEFT JOIN admin_configs a ON d.device_id = a.device_id
         GROUP BY d.device_id, d.fingerprint_hash, d.last_seen, d.last_ip, d.geo_country, d.geo_region, d.geo_city,
                  d.app_version, d.created_at, a.version, a.updated_at
         ORDER BY d.last_seen DESC NULLS LAST",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;

    let devices = rows
        .into_iter()
        .map(|row| DeviceSummary {
            device_id: row.get("device_id"),
            fingerprint_hash: row.get("fingerprint_hash"),
            last_seen: row.get("last_seen"),
            last_ip: row.get("last_ip"),
            geo_country: row.get("geo_country"),
            geo_region: row.get("geo_region"),
            geo_city: row.get("geo_city"),
            app_version: row.get("app_version"),
            created_at: row.get("created_at"),
            snapshot_count: row
                .try_get::<i64, _>("snapshot_count")
                .unwrap_or_default(),
            last_snapshot_at: row.get("last_snapshot_at"),
            admin_version: row.get("admin_version"),
            admin_updated_at: row.get("admin_updated_at"),
        })
        .collect();

    Ok(Json(DeviceListResponse { devices }))
}

async fn get_device_detail(
    State(state): State<AppState>,
    Path(device_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<DeviceDetailResponse>, ApiError> {
    authorize_admin(&headers, &state)?;

    let row = sqlx::query(
        "SELECT device_id, fingerprint_hash, last_seen, last_ip, geo_country, geo_region, geo_city,
                app_version, created_at
         FROM devices WHERE device_id = $1",
    )
    .bind(&device_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;

    let Some(row) = row else {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "device not found"));
    };

    let summary_row = sqlx::query(
        "SELECT COUNT(id) AS snapshot_count, MAX(created_at) AS last_snapshot_at
         FROM config_snapshots WHERE device_id = $1",
    )
    .bind(&device_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;

    let snapshot_rows = sqlx::query(
        "SELECT id, created_at, snapshot
         FROM config_snapshots
         WHERE device_id = $1
         ORDER BY created_at DESC
         LIMIT 20",
    )
    .bind(&device_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;

    let snapshots = snapshot_rows
        .into_iter()
        .map(|row| SnapshotItem {
            id: row.get("id"),
            created_at: row.get("created_at"),
            snapshot: row
                .try_get::<SqlxJson<serde_json::Value>, _>("snapshot")
                .map(|value| value.0)
                .unwrap_or(serde_json::Value::Null),
        })
        .collect();

    let admin_row = sqlx::query_as::<_, (i64, SqlxJson<serde_json::Value>, DateTime<Utc>)>(
        "SELECT version, config, updated_at FROM admin_configs WHERE device_id = $1",
    )
    .bind(&device_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;

    let admin_config = admin_row.map(|(version, config, updated_at)| AdminConfigItem {
        version,
        updated_at,
        config: config.0,
    });

    let (admin_version, admin_updated_at) = admin_config
        .as_ref()
        .map(|config| (Some(config.version), Some(config.updated_at)))
        .unwrap_or((None, None));

    let device = DeviceSummary {
        device_id: row.get("device_id"),
        fingerprint_hash: row.get("fingerprint_hash"),
        last_seen: row.get("last_seen"),
        last_ip: row.get("last_ip"),
        geo_country: row.get("geo_country"),
        geo_region: row.get("geo_region"),
        geo_city: row.get("geo_city"),
        app_version: row.get("app_version"),
        created_at: row.get("created_at"),
        snapshot_count: summary_row
            .try_get::<i64, _>("snapshot_count")
            .unwrap_or_default(),
        last_snapshot_at: summary_row.get("last_snapshot_at"),
        admin_version,
        admin_updated_at,
    };

    Ok(Json(DeviceDetailResponse {
        device,
        snapshots,
        admin_config,
    }))
}

async fn upsert_admin_config(
    State(state): State<AppState>,
    Path(device_id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<AdminConfigRequest>,
) -> Result<Json<AdminConfigResponse>, ApiError> {
    authorize_admin(&headers, &state)?;

    if device_id.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "device_id is required"));
    }

    let now = Utc::now();
    let version = upsert_admin_config_value(&state.pool, &device_id, &payload.config, now).await?;

    Ok(Json(AdminConfigResponse {
        ok: true,
        version,
    }))
}

async fn batch_admin_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<BatchConfigRequest>,
) -> Result<Json<BatchConfigResponse>, ApiError> {
    authorize_admin(&headers, &state)?;

    if payload.device_ids.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "device_ids is required"));
    }

    let existing_ids = sqlx::query_scalar::<_, String>(
        "SELECT device_id FROM devices WHERE device_id = ANY($1)",
    )
    .bind(&payload.device_ids)
    .fetch_all(&state.pool)
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;

    let now = Utc::now();
    let mut updated = 0;

    for device_id in existing_ids {
        upsert_admin_config_value(&state.pool, &device_id, &payload.config, now).await?;
        updated += 1;
    }

    Ok(Json(BatchConfigResponse { ok: true, updated }))
}

fn authorize_bearer(headers: &HeaderMap, expected: &str) -> Result<(), ApiError> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");

    if auth != format!("Bearer {}", expected) {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "unauthorized"));
    }

    Ok(())
}

fn authorize_admin(headers: &HeaderMap, state: &AppState) -> Result<(), ApiError> {
    if let Some(token) = extract_bearer_token(headers) {
        if token == state.admin_token {
            return Ok(());
        }
    }

    if let (Some(user), Some(pass)) = (&state.admin_basic_user, &state.admin_basic_password) {
        if let Some((input_user, input_pass)) = extract_basic_auth(headers) {
            if input_user == *user && input_pass == *pass {
                return Ok(());
            }
        }
    }

    Err(ApiError::new(StatusCode::UNAUTHORIZED, "unauthorized"))
}

fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())?;
    let token = auth.strip_prefix("Bearer ")?;
    Some(token.to_string())
}

fn extract_basic_auth(headers: &HeaderMap) -> Option<(String, String)> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())?;
    let encoded = auth.strip_prefix("Basic ")?;
    let decoded = general_purpose::STANDARD.decode(encoded).ok()?;
    let decoded = String::from_utf8_lossy(&decoded);
    let (user, pass) = decoded.split_once(':')?;
    Some((user.to_string(), pass.to_string()))
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
        .and_then(|city| city.names.and_then(|names| names.get("en").map(|value| value.to_string())));

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

async fn upsert_admin_config_value(
    pool: &PgPool,
    device_id: &str,
    config: &serde_json::Value,
    now: DateTime<Utc>,
) -> Result<i64, ApiError> {
    let version = sqlx::query_scalar(
        "INSERT INTO admin_configs (device_id, version, config, updated_at)
         VALUES ($1, 1, $2, $3)
         ON CONFLICT (device_id)
         DO UPDATE SET version = admin_configs.version + 1, config = EXCLUDED.config, updated_at = EXCLUDED.updated_at
         RETURNING version",
    )
    .bind(device_id)
    .bind(SqlxJson(config.clone()))
    .bind(now)
    .fetch_one(pool)
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()))?;

    Ok(version)
}

fn require_env(key: &str) -> String {
    env::var(key).unwrap_or_else(|_| panic!("missing env: {}", key))
}
