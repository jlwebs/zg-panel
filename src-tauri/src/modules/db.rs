use crate::modules::{version, logger};
use crate::protobuf;
use rusqlite::Connection;
use std::path::PathBuf;

/// Get Antigravity database path (cross-platform)
pub fn get_db_path() -> Result<PathBuf, String> {
    // Standard mode: use system default path
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or("Failed to get home directory")?;
        Ok(home.join("Library/Application Support/Antigravity/User/globalStorage/state.vscdb"))
    }

    #[cfg(target_os = "windows")]
    {
        let appdata =
            std::env::var("APPDATA").map_err(|_| "Failed to get APPDATA environment variable".to_string())?;
        Ok(PathBuf::from(appdata).join("Antigravity\\User\\globalStorage\\state.vscdb"))
    }

    #[cfg(target_os = "linux")]
    {
        let home = dirs::home_dir().ok_or("Failed to get home directory")?;
        Ok(home.join(".config/Antigravity/User/globalStorage/state.vscdb"))
    }
}

/// Inject Token and Email into database
pub fn inject_token(
    db_path: &PathBuf,
    access_token: &str,
    refresh_token: &str,
    expiry: i64,
    email: &str,
) -> Result<String, String> {
    logger::log_info("Starting Token injection...");
    
    // 1. Detect Antigravity version
    let version_result = version::get_antigravity_version();
    
    match version_result {
        Ok(ver) => {
            logger::log_info(&format!(
                "Detected Antigravity version: {}",
                ver.short_version
            ));
            
            // 2. Choose injection strategy based on version
            if version::is_new_version(&ver) {
                logger::log_info(
                    "Using new format injection (antigravityUnifiedStateSync.oauthToken)"
                );
                inject_new_format(db_path, access_token, refresh_token, expiry)
            } else {
                logger::log_info(
                    "Using old format injection (jetskiStateSync.agentManagerInitState)"
                );
                inject_old_format(db_path, access_token, refresh_token, expiry, email)
            }
        }
        Err(e) => {
            logger::log_warn(&format!(
                "Version detection failed, trying both formats for compatibility: {}",
                e
            ));
            
            let new_result = inject_new_format(db_path, access_token, refresh_token, expiry);
            let old_result = inject_old_format(db_path, access_token, refresh_token, expiry, email);
            
            if new_result.is_ok() || old_result.is_ok() {
                Ok("Token injection successful (dual format fallback)".to_string())
            } else {
                Err(format!(
                    "Both formats failed - New: {:?}, Old: {:?}",
                    new_result.err(),
                    old_result.err()
                ))
            }
        }
    }
}

/// New format injection (>= 1.16.5)
fn inject_new_format(
    db_path: &PathBuf,
    access_token: &str,
    refresh_token: &str,
    expiry: i64,
) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    
    let conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    
    // Create OAuthTokenInfo (binary)
    let oauth_info = protobuf::create_oauth_info(access_token, refresh_token, expiry);
    let oauth_info_b64 = general_purpose::STANDARD.encode(&oauth_info);
    
    let inner2 = protobuf::encode_string_field(1, &oauth_info_b64);
    let inner1 = protobuf::encode_string_field(1, "oauthTokenInfoSentinelKey");
    let inner = [inner1, protobuf::encode_len_delim_field(2, &inner2)].concat();
    let outer = protobuf::encode_len_delim_field(1, &inner);
    let outer_b64 = general_purpose::STANDARD.encode(&outer);
    
    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)",
        ["antigravityUnifiedStateSync.oauthToken", &outer_b64],
    )
    .map_err(|e| format!("Failed to write new format: {}", e))?;
    
    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)",
        ["antigravityOnboarding", "true"],
    )
    .map_err(|e| format!("Failed to write onboarding flag: {}", e))?;
    
    Ok("Token injection successful (new format)".to_string())
}

/// Old format injection (< 1.16.5)
fn inject_old_format(
    db_path: &PathBuf,
    access_token: &str,
    refresh_token: &str,
    expiry: i64,
    email: &str,
) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    
    let conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    
    // Read current data
    let current_data: Option<String> = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?",
            ["jetskiStateSync.agentManagerInitState"],
            |row| row.get(0),
        )
        .ok();
    
    if let Some(data) = current_data {
        let blob = general_purpose::STANDARD
            .decode(&data)
            .map_err(|e| format!("Base64 decoding failed: {}", e))?;
        
        let mut clean_data = protobuf::remove_field(&blob, 1)?; // UserID
        clean_data = protobuf::remove_field(&clean_data, 2)?;   // Email
        clean_data = protobuf::remove_field(&clean_data, 6)?;   // OAuthTokenInfo
        
        let new_email_field = protobuf::create_email_field(email);
        let new_oauth_field = protobuf::create_oauth_field(access_token, refresh_token, expiry);
        
        let final_data = [clean_data, new_email_field, new_oauth_field].concat();
        let final_b64 = general_purpose::STANDARD.encode(&final_data);
        
        conn.execute(
            "UPDATE ItemTable SET value = ? WHERE key = ?",
            [&final_b64, "jetskiStateSync.agentManagerInitState"],
        )
        .map_err(|e| format!("Failed to write data: {}", e))?;
    } else {
        return Err("Old format key does not exist".to_string());
    }
    
    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)",
        ["antigravityOnboarding", "true"],
    )
    .map_err(|e| format!("Failed to write onboarding flag: {}", e))?;
    
    Ok("Token injection successful (old format)".to_string())
}
