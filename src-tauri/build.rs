use std::{env, fs, path::PathBuf};

fn main() {
    tauri_build::build();
    build_management_secrets();
}

fn build_management_secrets() {
    println!("cargo:rerun-if-env-changed=AI_CODE_WITH_MANAGEMENT_URL");
    println!("cargo:rerun-if-env-changed=AI_CODE_WITH_SYNC_TOKEN");
    println!("cargo:rerun-if-env-changed=AI_CODE_WITH_SYNC_ON_START");

    let url = env::var("AI_CODE_WITH_MANAGEMENT_URL")
        .expect("AI_CODE_WITH_MANAGEMENT_URL is required at build time");
    let token =
        env::var("AI_CODE_WITH_SYNC_TOKEN").expect("AI_CODE_WITH_SYNC_TOKEN is required at build time");
    let sync_on_start = env::var("AI_CODE_WITH_SYNC_ON_START")
        .map(|value| value == "true" || value == "1")
        .unwrap_or(false);

    let key: u8 = 0x5A;
    let url_bytes: Vec<u8> = url.as_bytes().iter().map(|b| b ^ key).collect();
    let token_bytes: Vec<u8> = token.as_bytes().iter().map(|b| b ^ key).collect();

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));
    let dest = out_dir.join("management_secrets.rs");
    let contents = format!(
        "pub const MANAGEMENT_XOR_KEY: u8 = {key};\n\
pub const MANAGEMENT_URL_BYTES: &[u8] = &{url_bytes:?};\n\
pub const MANAGEMENT_TOKEN_BYTES: &[u8] = &{token_bytes:?};\n\
pub const SYNC_ON_START: bool = {sync_on_start};\n"
    );

    fs::write(dest, contents).expect("failed to write management secrets");
}
