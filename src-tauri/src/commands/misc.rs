#![allow(non_snake_case)]

use crate::init_status::InitErrorPayload;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use futures::StreamExt;
use tokio::io::AsyncWriteExt;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 打开外部链接
#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> Result<bool, String> {
    let url = if url.starts_with("http://") || url.starts_with("https://") {
        url
    } else {
        format!("https://{url}")
    };

    app.opener()
        .open_url(&url, None::<String>)
        .map_err(|e| format!("打开链接失败: {e}"))?;

    Ok(true)
}

/// 获取当前运行平台（用于前端按系统选择安装包）。
///
/// 返回值与前端 `Pan123Platform` 对齐：`windows` / `macos` / `linux`。
#[tauri::command]
pub async fn get_runtime_platform() -> Result<String, String> {
    Ok(std::env::consts::OS.to_string())
}

#[derive(serde::Serialize)]
pub struct DownloadAndOpenResult {
    filePath: String,
}

fn sanitize_download_file_name(raw: &str) -> String {
    let fallback = "aicodewith-update.bin";
    let name = std::path::Path::new(raw)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or(fallback);

    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => out.push('_'),
            _ => out.push(ch),
        }
    }

    let trimmed = out.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.chars().take(120).collect()
    }
}

#[cfg(target_os = "windows")]
fn try_start_windows_msi_install(msi_path: &std::path::Path) -> Result<(), String> {
    use std::process::Command;

    // 业务约束：更新按钮触发的安装应尽量减少交互，避免“向导式安装页”打断用户。
    // 技术约束：MSI 本身无法在双击时强制静默；但应用内触发安装可以通过 `msiexec` 参数做到。
    Command::new("msiexec")
        .arg("/i")
        .arg(msi_path)
        .arg("/passive")
        .arg("/norestart")
        // 配合 `src-tauri/wix/per-user-main.wxs` 的自定义动作：安装完成后自动启动应用。
        .arg("AUTOLAUNCHAPP=1")
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("启动 Windows 安装器失败: {e}"))?;

    Ok(())
}

/// 下载网盘安装包并打开（触发系统安装流程）
#[tauri::command]
pub async fn download_and_open_update_package(
    app: AppHandle,
    url: String,
    #[allow(non_snake_case)] fileName: String,
) -> Result<DownloadAndOpenResult, String> {
    let parsed = url::Url::parse(&url).map_err(|e| format!("无效的下载链接: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("不支持的下载链接协议".to_string()),
    }

    // 安全兜底：仅允许从 123 云盘下载域名拉取安装包，避免被误用为“任意下载并打开”能力。
    if let Some(host) = parsed.host_str() {
        let host = host.to_lowercase();
        let trusted = host.ends_with(".cjjd19.com")
            || host.ends_with(".123pan.com")
            || host.ends_with(".123865.com");
        if !trusted {
            return Err("下载链接域名不受信任".to_string());
        }
    } else {
        return Err("下载链接缺少域名".to_string());
    }

    let file_name = sanitize_download_file_name(&fileName);
    let cache_dir = std::env::temp_dir().join("aicodewith-updates");
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("创建缓存目录失败: {e}"))?;

    let final_path = cache_dir.join(&file_name);
    let temp_path = cache_dir.join(format!("{file_name}.partial"));

    let client = reqwest::Client::builder()
        .user_agent(format!("AI-Code-With/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("创建下载客户端失败: {e}"))?;

    let res = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("下载请求失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("下载响应异常: {e}"))?;

    let mut file = tokio::fs::File::create(&temp_path)
        .await
        .map_err(|e| format!("创建下载文件失败: {e}"))?;

    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("读取下载数据失败: {e}"))?;
        file.write_all(&bytes)
            .await
            .map_err(|e| format!("写入下载文件失败: {e}"))?;
    }

    file.flush()
        .await
        .map_err(|e| format!("刷新下载文件失败: {e}"))?;
    drop(file);

    if let Err(e) = tokio::fs::rename(&temp_path, &final_path).await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(format!("保存下载文件失败: {e}"));
    }

    // Windows 下如果是 MSI，则用 msiexec 的 passive 模式启动安装，以避免向导式安装页面。
    #[cfg(target_os = "windows")]
    {
        if final_path
            .extension()
            .and_then(|v| v.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("msi"))
        {
            try_start_windows_msi_install(&final_path)?;
            return Ok(DownloadAndOpenResult {
                filePath: final_path.to_string_lossy().to_string(),
            });
        }
    }

    app.opener()
        .open_path(final_path.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| format!("打开安装包失败: {e}"))?;

    Ok(DownloadAndOpenResult {
        filePath: final_path.to_string_lossy().to_string(),
    })
}

/// 检查更新
#[tauri::command]
pub async fn check_for_updates(handle: AppHandle) -> Result<bool, String> {
    handle
        .opener()
        .open_url(
            "https://github.com/farion1231/cc-switch/releases/latest",
            None::<String>,
        )
        .map_err(|e| format!("打开更新页面失败: {e}"))?;

    Ok(true)
}

/// 判断是否为便携版（绿色版）运行
#[tauri::command]
pub async fn is_portable_mode() -> Result<bool, String> {
    let exe_path = std::env::current_exe().map_err(|e| format!("获取可执行路径失败: {e}"))?;
    if let Some(dir) = exe_path.parent() {
        Ok(dir.join("portable.ini").is_file())
    } else {
        Ok(false)
    }
}

/// 获取应用启动阶段的初始化错误（若有）。
/// 用于前端在早期主动拉取，避免事件订阅竞态导致的提示缺失。
#[tauri::command]
pub async fn get_init_error() -> Result<Option<InitErrorPayload>, String> {
    Ok(crate::init_status::get_init_error())
}

/// 获取 JSON→SQLite 迁移结果（若有）。
/// 只返回一次 true，之后返回 false，用于前端显示一次性 Toast 通知。
#[tauri::command]
pub async fn get_migration_result() -> Result<bool, String> {
    Ok(crate::init_status::take_migration_success())
}

#[derive(serde::Serialize)]
pub struct ToolVersion {
    name: String,
    version: Option<String>,
    latest_version: Option<String>, // 新增字段：最新版本
    error: Option<String>,
}

#[tauri::command]
pub async fn get_tool_versions() -> Result<Vec<ToolVersion>, String> {
    let tools = vec!["claude", "codex", "gemini"];
    let mut results = Vec::new();

    // 用于获取远程版本的 client
    let client = reqwest::Client::builder()
        .user_agent("cc-switch/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    for tool in tools {
        // 1. 获取本地版本 - 先尝试直接执行，失败则扫描常见路径
        let (local_version, local_error) = {
            // 先尝试直接执行
            let direct_result = try_get_version(tool);

            if direct_result.0.is_some() {
                direct_result
            } else {
                // 扫描常见的 npm 全局安装路径
                scan_cli_version(tool)
            }
        };

        // 2. 获取远程最新版本
        let latest_version = match tool {
            "claude" => fetch_npm_latest_version(&client, "@anthropic-ai/claude-code").await,
            "codex" => fetch_npm_latest_version(&client, "@openai/codex").await,
            "gemini" => fetch_npm_latest_version(&client, "@google/gemini-cli").await,
            _ => None,
        };

        results.push(ToolVersion {
            name: tool.to_string(),
            version: local_version,
            latest_version,
            error: local_error,
        });
    }

    Ok(results)
}

/// Helper function to fetch latest version from npm registry
async fn fetch_npm_latest_version(client: &reqwest::Client, package: &str) -> Option<String> {
    let url = format!("https://registry.npmjs.org/{package}");
    match client.get(&url).send().await {
        Ok(resp) => {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                json.get("dist-tags")
                    .and_then(|tags| tags.get("latest"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            } else {
                None
            }
        }
        Err(_) => None,
    }
}

/// 从版本输出中提取纯版本号
fn extract_version(raw: &str) -> String {
    // 匹配 semver 格式: x.y.z 或 x.y.z-xxx
    let re = regex::Regex::new(r"\d+\.\d+\.\d+(-[\w.]+)?").unwrap();
    re.find(raw)
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| raw.to_string())
}

/// 尝试直接执行命令获取版本
fn try_get_version(tool: &str) -> (Option<String>, Option<String>) {
    use std::process::Command;

    #[cfg(target_os = "windows")]
    let output = {
        Command::new("cmd")
            .args(["/C", &format!("{tool} --version")])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    };

    #[cfg(not(target_os = "windows"))]
    let output = {
        Command::new("sh")
            .arg("-c")
            .arg(format!("{tool} --version"))
            .output()
    };

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            if out.status.success() {
                let raw = if stdout.is_empty() { &stderr } else { &stdout };
                if raw.is_empty() {
                    (None, Some("未安装或无法执行".to_string()))
                } else {
                    (Some(extract_version(raw)), None)
                }
            } else {
                let err = if stderr.is_empty() { stdout } else { stderr };
                (
                    None,
                    Some(if err.is_empty() {
                        "未安装或无法执行".to_string()
                    } else {
                        err
                    }),
                )
            }
        }
        Err(e) => (None, Some(e.to_string())),
    }
}

/// 扫描常见路径查找 CLI
fn scan_cli_version(tool: &str) -> (Option<String>, Option<String>) {
    use std::process::Command;

    let home = dirs::home_dir().unwrap_or_default();

    // 常见的 npm 全局安装路径
    let mut search_paths: Vec<std::path::PathBuf> = vec![
        home.join(".npm-global/bin"),
        home.join(".local/bin"),
        home.join("n/bin"), // n version manager
    ];

    #[cfg(target_os = "macos")]
    {
        search_paths.push(std::path::PathBuf::from("/opt/homebrew/bin"));
        search_paths.push(std::path::PathBuf::from("/usr/local/bin"));
    }

    #[cfg(target_os = "linux")]
    {
        search_paths.push(std::path::PathBuf::from("/usr/local/bin"));
        search_paths.push(std::path::PathBuf::from("/usr/bin"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = dirs::data_dir() {
            search_paths.push(appdata.join("npm"));
        }
        search_paths.push(std::path::PathBuf::from("C:\\Program Files\\nodejs"));
    }

    // 扫描 nvm 目录下的所有 node 版本
    let nvm_base = home.join(".nvm/versions/node");
    if nvm_base.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_base) {
            for entry in entries.flatten() {
                let bin_path = entry.path().join("bin");
                if bin_path.exists() {
                    search_paths.push(bin_path);
                }
            }
        }
    }

    // 在每个路径中查找工具
    for path in &search_paths {
        let tool_path = if cfg!(target_os = "windows") {
            path.join(format!("{tool}.cmd"))
        } else {
            path.join(tool)
        };

        if tool_path.exists() {
            // 构建 PATH 环境变量，确保 node 可被找到
            let current_path = std::env::var("PATH").unwrap_or_default();
            let new_path = format!("{}:{}", path.display(), current_path);

            #[cfg(target_os = "windows")]
            let output = {
                Command::new(&tool_path)
                    .arg("--version")
                    .env("PATH", &new_path)
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
            };

            #[cfg(not(target_os = "windows"))]
            let output = {
                Command::new(&tool_path)
                    .arg("--version")
                    .env("PATH", &new_path)
                    .output()
            };

            if let Ok(out) = output {
                let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                if out.status.success() {
                    let raw = if stdout.is_empty() { &stderr } else { &stdout };
                    if !raw.is_empty() {
                        return (Some(extract_version(raw)), None);
                    }
                }
            }
        }
    }

    (None, Some("未安装或无法执行".to_string()))
}
