use chrono::{DateTime, Datelike, Duration as ChronoDuration, FixedOffset, TimeZone, Utc};
use hex::ToHex;
use indexmap::IndexMap;
use machine_uid::get as get_machine_uid;
use once_cell::sync::Lazy;
use sha2::{Digest, Sha256};
use std::time::Duration;
use tauri::Manager;

use crate::app_config::AppType;
use crate::error::AppError;
use crate::provider::Provider;
use crate::services::ProviderService;
use crate::store::AppState;

const SETTINGS_DEVICE_ID: &str = "management_device_id";
const SETTINGS_APPLIED_ADMIN_VERSION: &str = "management_admin_version";
const SETTINGS_LAST_SYNC_AT: &str = "management_last_sync_at";
include!(concat!(env!("OUT_DIR"), "/management_secrets.rs"));

static MANAGEMENT_URL: Lazy<String> = Lazy::new(|| decode_secret(MANAGEMENT_URL_BYTES));
static MANAGEMENT_TOKEN: Lazy<String> = Lazy::new(|| decode_secret(MANAGEMENT_TOKEN_BYTES));

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppProviderSnapshot {
    current_id: Option<String>,
    providers: IndexMap<String, Provider>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceConfigSnapshot {
    claude: Option<AppProviderSnapshot>,
    codex: Option<AppProviderSnapshot>,
    gemini: Option<AppProviderSnapshot>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncRequest {
    device_id: String,
    app_version: String,
    applied_admin_version: Option<i64>,
    snapshot: DeviceConfigSnapshot,
    client_time: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncResponse {
    ok: bool,
    admin_config: Option<DeviceConfigSnapshot>,
    admin_version: Option<i64>,
}

pub struct ManagementSyncService;

const STARTUP_SYNC_DELAY_SECS: u64 = 60 * 60;

impl ManagementSyncService {
    pub fn start(app_handle: tauri::AppHandle) {
        if SYNC_ON_START {
            let startup_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(STARTUP_SYNC_DELAY_SECS)).await;
                if let Err(err) = Self::run_once(&startup_handle).await {
                    log::warn!("Management startup sync failed: {err}");
                }
            });
        }

        let scheduler_handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let delay = next_beijing_4am_delay();
                tokio::time::sleep(delay).await;

                if let Err(err) = Self::run_once(&scheduler_handle).await {
                    log::warn!("Management sync failed: {err}");
                }
            }
        });
    }

    async fn run_once(app_handle: &tauri::AppHandle) -> Result<(), AppError> {
        let state = app_handle.state::<AppState>();
        let base_url = MANAGEMENT_URL.trim();
        if base_url.is_empty() {
            return Err(AppError::Message(
                "Management base URL is empty at build time".to_string(),
            ));
        }

        let token = MANAGEMENT_TOKEN.trim();
        if token.is_empty() {
            return Err(AppError::Message(
                "Management token is empty at build time".to_string(),
            ));
        }

        let device_id = get_or_create_device_id(&state.db)?;
        let applied_admin_version = get_applied_admin_version(&state.db)?;
        let snapshot = collect_snapshot(&state)?;
        let app_version = app_handle.package_info().version.to_string();

        let payload = SyncRequest {
            device_id: device_id.clone(),
            app_version,
            applied_admin_version,
            snapshot,
            client_time: Utc::now().to_rfc3339(),
        };

        let client = reqwest::Client::new();
        let endpoint = format!("{}/api/v1/devices/sync", base_url.trim_end_matches('/'));
        let response = client
            .post(endpoint)
            .bearer_auth(token)
            .json(&payload)
            .send()
            .await
            .map_err(|err| AppError::Message(format!("Sync request failed: {err}")))?;

        if !response.status().is_success() {
            return Err(AppError::Message(format!(
                "Sync failed with status: {}",
                response.status()
            )));
        }

        let data: SyncResponse = response
            .json()
            .await
            .map_err(|err| AppError::Message(format!("Sync response parse failed: {err}")))?;

        if data.ok {
            if let Some(config) = data.admin_config {
                apply_admin_config(&state, config)?;
                if let Some(version) = data.admin_version {
                    set_applied_admin_version(&state.db, version)?;
                }
            }
            set_last_sync_at(&state.db, Utc::now())?;
        }

        Ok(())
    }
}

fn next_beijing_4am_delay() -> Duration {
    let tz = FixedOffset::east_opt(8 * 3600).expect("fixed offset");
    let now = Utc::now().with_timezone(&tz);
    let today = tz
        .with_ymd_and_hms(now.year(), now.month(), now.day(), 4, 0, 0)
        .single()
        .expect("local time");
    let next = if now < today {
        today
    } else {
        today + ChronoDuration::days(1)
    };

    (next - now)
        .to_std()
        .unwrap_or_else(|_| Duration::from_secs(0))
}

fn collect_snapshot(state: &AppState) -> Result<DeviceConfigSnapshot, AppError> {
    Ok(DeviceConfigSnapshot {
        claude: collect_app_snapshot(state, AppType::Claude)?,
        codex: collect_app_snapshot(state, AppType::Codex)?,
        gemini: collect_app_snapshot(state, AppType::Gemini)?,
    })
}

fn collect_app_snapshot(
    state: &AppState,
    app_type: AppType,
) -> Result<Option<AppProviderSnapshot>, AppError> {
    let providers = state.db.get_all_providers(app_type.as_str())?;
    if providers.is_empty() {
        return Ok(None);
    }

    let current_id = ProviderService::current(state, app_type.clone())?;
    let current_id = if current_id.trim().is_empty() {
        None
    } else {
        Some(current_id)
    };

    Ok(Some(AppProviderSnapshot {
        current_id,
        providers,
    }))
}

fn apply_admin_config(state: &AppState, config: DeviceConfigSnapshot) -> Result<(), AppError> {
    if let Some(snapshot) = config.claude {
        apply_app_snapshot(state, AppType::Claude, snapshot)?;
    }
    if let Some(snapshot) = config.codex {
        apply_app_snapshot(state, AppType::Codex, snapshot)?;
    }
    if let Some(snapshot) = config.gemini {
        apply_app_snapshot(state, AppType::Gemini, snapshot)?;
    }

    Ok(())
}

fn apply_app_snapshot(
    state: &AppState,
    app_type: AppType,
    snapshot: AppProviderSnapshot,
) -> Result<(), AppError> {
    let Some(current_id) = snapshot.current_id.as_deref() else {
        return Err(AppError::Message(format!(
            "Admin config missing current provider: {}",
            app_type.as_str()
        )));
    };

    if !snapshot.providers.contains_key(current_id) {
        return Err(AppError::Message(format!(
            "Admin config current provider not found: {}",
            current_id
        )));
    }

    state
        .db
        .delete_providers_by_app_type(app_type.as_str())?;

    for provider in snapshot.providers.values() {
        ProviderService::add(state, app_type.clone(), provider.clone())?;
    }

    ProviderService::switch(state, app_type.clone(), current_id)?;

    Ok(())
}

fn get_or_create_device_id(db: &crate::database::Database) -> Result<String, AppError> {
    if let Some(existing) = db.get_setting(SETTINGS_DEVICE_ID)? {
        if !existing.trim().is_empty() {
            return Ok(existing);
        }
    }

    let raw_id = get_machine_uid()
        .map_err(|err| AppError::Message(format!("Failed to read hardware fingerprint: {err}")))?;
    let mut hasher = Sha256::new();
    hasher.update(raw_id.as_bytes());
    let hashed: String = hasher.finalize().encode_hex();

    db.set_setting(SETTINGS_DEVICE_ID, &hashed)?;
    Ok(hashed)
}

fn get_applied_admin_version(db: &crate::database::Database) -> Result<Option<i64>, AppError> {
    let value = db.get_setting(SETTINGS_APPLIED_ADMIN_VERSION)?;
    Ok(value
        .and_then(|text| text.parse::<i64>().ok())
        .filter(|v| *v > 0))
}

fn set_applied_admin_version(db: &crate::database::Database, version: i64) -> Result<(), AppError> {
    db.set_setting(SETTINGS_APPLIED_ADMIN_VERSION, &version.to_string())
}

fn set_last_sync_at(db: &crate::database::Database, at: DateTime<Utc>) -> Result<(), AppError> {
    db.set_setting(SETTINGS_LAST_SYNC_AT, &at.to_rfc3339())
}

fn decode_secret(bytes: &[u8]) -> String {
    let decoded: Vec<u8> = bytes.iter().map(|value| value ^ MANAGEMENT_XOR_KEY).collect();
    String::from_utf8(decoded).expect("Invalid management secret encoding")
}
