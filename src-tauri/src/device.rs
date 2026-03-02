use chrono::Local;
use rusqlite::Connection;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;
use std::process::Command;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeviceProfile {
    #[serde(rename = "machine_id", alias = "machineId")]
    pub machine_id: String,
    #[serde(rename = "mac_machine_id", alias = "macMachineId")]
    pub mac_machine_id: String,
    #[serde(rename = "dev_device_id", alias = "devDeviceId")]
    pub dev_device_id: String,
    #[serde(rename = "sqm_id", alias = "sqmId")]
    pub sqm_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeviceProfileVersion {
    pub id: String,
    pub created_at: i64,
    pub label: String,
    pub profile: DeviceProfile,
    pub is_current: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct DeviceProfilesResponse {
    pub current_storage: Option<DeviceProfile>,
    pub history: Option<Vec<DeviceProfileVersion>>,
    pub baseline: Option<DeviceProfile>,
}

const DATA_DIR: &str = ".antigravity_tools";
const GLOBAL_BASELINE: &str = "device_original.json";

fn get_data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("failed_to_get_home_dir")?;
    let data_dir = home.join(DATA_DIR);
    if !data_dir.exists() {
        fs::create_dir_all(&data_dir).map_err(|e| format!("failed_to_create_data_dir: {}", e))?;
    }
    Ok(data_dir)
}

fn get_accounts_path() -> PathBuf {
    PathBuf::from("../accounts.json")
}

pub fn get_storage_path() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or("failed_to_get_home_dir")?;
        let path = home.join("Library/Application Support/Antigravity/User/globalStorage/storage.json");
        if path.exists() { return Ok(path); }
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").map_err(|_| "failed_to_get_appdata_env".to_string())?;
        let path = PathBuf::from(appdata).join("Antigravity\\User\\globalStorage\\storage.json");
        if path.exists() { return Ok(path); }
    }
    Err("storage_json_not_found".to_string())
}

pub fn get_storage_dir() -> Result<PathBuf, String> {
    let path = get_storage_path()?;
    path.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "failed_to_get_storage_parent_dir".to_string())
}

pub fn get_state_db_path() -> Result<PathBuf, String> {
    Ok(get_storage_dir()?.join("state.vscdb"))
}

pub fn read_profile(storage_path: &Path) -> Result<DeviceProfile, String> {
    let content = fs::read_to_string(storage_path).map_err(|e| format!("read_failed ({:?}): {}", storage_path, e))?;
    let json: Value = serde_json::from_str(&content).map_err(|e| format!("parse_failed ({:?}): {}", storage_path, e))?;

    let get_field = |key: &str| -> Option<String> {
        if let Some(obj) = json.get("telemetry").and_then(|v| v.as_object()) {
            if let Some(v) = obj.get(key).and_then(|v| v.as_str()) { return Some(v.to_string()); }
        }
        if let Some(v) = json.get(format!("telemetry.{key}")).and_then(|v| v.as_str()) {
            return Some(v.to_string());
        }
        None
    };

    Ok(DeviceProfile {
        machine_id: get_field("machineId").ok_or("missing_machine_id")?,
        mac_machine_id: get_field("macMachineId").ok_or("missing_mac_machine_id")?,
        dev_device_id: get_field("devDeviceId").ok_or("missing_dev_device_id")?,
        sqm_id: get_field("sqmId").ok_or("missing_sqm_id")?,
    })
}

pub fn write_profile(storage_path: &Path, profile: &DeviceProfile) -> Result<(), String> {
    let content = fs::read_to_string(storage_path).unwrap_or_else(|_| "{}".to_string());
    let mut json: Value = serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}));

    if !json.get("telemetry").map_or(false, |v| v.is_object()) {
        json["telemetry"] = serde_json::json!({});
    }

    if let Some(telemetry) = json.get_mut("telemetry").and_then(|v| v.as_object_mut()) {
        telemetry.insert("machineId".to_string(), Value::String(profile.machine_id.clone()));
        telemetry.insert("macMachineId".to_string(), Value::String(profile.mac_machine_id.clone()));
        telemetry.insert("devDeviceId".to_string(), Value::String(profile.dev_device_id.clone()));
        telemetry.insert("sqmId".to_string(), Value::String(profile.sqm_id.clone()));
    }

    if let Some(map) = json.as_object_mut() {
        map.insert("telemetry.machineId".to_string(), Value::String(profile.machine_id.clone()));
        map.insert("telemetry.macMachineId".to_string(), Value::String(profile.mac_machine_id.clone()));
        map.insert("telemetry.devDeviceId".to_string(), Value::String(profile.dev_device_id.clone()));
        map.insert("telemetry.sqmId".to_string(), Value::String(profile.sqm_id.clone()));
        map.insert("storage.serviceMachineId".to_string(), Value::String(profile.dev_device_id.clone()));
    }

    fs::write(storage_path, serde_json::to_string_pretty(&json).unwrap()).map_err(|e| format!("write_failed: {}", e))?;

    let db_path = get_state_db_path()?;
    if db_path.exists() {
        if let Ok(conn) = Connection::open(&db_path) {
            let _ = conn.execute("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT);", []);
            let _ = conn.execute("INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('storage.serviceMachineId', ?1);", [&profile.dev_device_id]);
        }
    }
    Ok(())
}

pub fn load_global_original() -> Option<DeviceProfile> {
    if let Ok(dir) = get_data_dir() {
        let path = dir.join(GLOBAL_BASELINE);
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                return serde_json::from_str(&content).ok();
            }
        }
    }
    None
}

pub fn save_global_original(profile: &DeviceProfile) {
    if let Ok(dir) = get_data_dir() {
        let path = dir.join(GLOBAL_BASELINE);
        if !path.exists() {
            let _ = fs::write(&path, serde_json::to_string_pretty(profile).unwrap());
        }
    }
}

pub fn generate_profile() -> DeviceProfile {
    DeviceProfile {
        machine_id: format!("auth0|user_{}", Uuid::new_v4().to_string().replace("-", "")),
        mac_machine_id: Uuid::new_v4().to_string(),
        dev_device_id: Uuid::new_v4().to_string(),
        sqm_id: format!("{{{}}}", Uuid::new_v4().to_string().to_uppercase()),
    }
}

// Helpers for reading/writing accounts
fn read_accounts() -> Result<Value, String> {
    let path = get_accounts_path();
    if !path.exists() { return Err("accounts.json not found".to_string()); }
    let c = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&c).map_err(|e| e.to_string())
}

fn write_accounts(val: &Value) -> Result<(), String> {
    fs::write(get_accounts_path(), serde_json::to_string_pretty(val).unwrap()).map_err(|e| e.to_string())?;
    // Restart docker automatically to sync
    let _ = Command::new("docker").args(["restart", "zerogravity"]).output();
    Ok(())
}

fn get_account_idx<'a>(val: &'a mut Value, account_id: &str) -> Option<usize> {
    let arr = val.get("accounts")?.as_array()?;
    arr.iter().position(|a| a.get("id").and_then(|v| v.as_str()) == Some(account_id))
}

#[tauri::command]
pub async fn get_device_profiles(account_id: String) -> Result<String, String> {
    let current_storage = get_storage_path().ok().and_then(|p| read_profile(&p).ok());
    let mut accs = read_accounts().unwrap_or_else(|_| serde_json::json!({"accounts": []}));
    
    let mut bound_profile: Option<DeviceProfile> = None;
    let mut history = None;
    if let Some(idx) = get_account_idx(&mut accs, &account_id) {
        let acc = &accs["accounts"][idx];
        if let Some(p) = acc.get("device_profile") {
            bound_profile = serde_json::from_value(p.clone()).ok();
        }
        if let Some(h) = acc.get("device_history").and_then(|v| v.as_array()) {
            let mut arr: Vec<DeviceProfileVersion> = vec![];
            for item in h { if let Ok(parsed) = serde_json::from_value(item.clone()) { arr.push(parsed); } }
            history = Some(arr);
        }
    }
    
    let res = DeviceProfilesResponse {
        current_storage,
        history,
        baseline: load_global_original(),
    };
    // Include bound_profile in the response, mapped as per standard if needed, or structured differently.
    // However, JS is expecting standard shape. We manually splice it since struct differs slightly here for proxy-less context.
    let mut val = serde_json::to_value(&res).unwrap();
    if let Some(b) = bound_profile {
        val["bound_profile"] = serde_json::to_value(b).unwrap();
    }
    
    Ok(serde_json::to_string(&val).unwrap())
}

#[tauri::command]
pub async fn bind_device_profile(account_id: String, mode: String) -> Result<String, String> {
    let profile = match mode.as_str() {
        "capture" => read_profile(&get_storage_path()?)?,
        "generate" => generate_profile(),
        _ => return Err("Invalid mode".to_string()),
    };
    save_global_original(&profile);
    
    let mut accs = read_accounts()?;
    if let Some(idx) = get_account_idx(&mut accs, &account_id) {
        let mut acc = accs["accounts"][idx].take();
        acc["device_profile"] = serde_json::to_value(&profile).unwrap();
        
        let mut history: Vec<Value> = acc.get("device_history").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        for h in history.iter_mut() {
            if let Some(obj) = h.as_object_mut() { obj.insert("is_current".to_string(), Value::Bool(false)); }
        }
        
        let new_ver = DeviceProfileVersion {
            id: Uuid::new_v4().to_string(),
            created_at: Local::now().timestamp(),
            label: "generated".to_string(),
            profile: profile.clone(),
            is_current: true,
        };
        history.push(serde_json::to_value(&new_ver).unwrap());
        acc["device_history"] = Value::Array(history);
        accs["accounts"][idx] = acc;
        write_accounts(&accs)?;
    }
    Ok(serde_json::to_string(&profile).unwrap())
}

#[tauri::command]
pub async fn preview_generate_profile() -> Result<String, String> {
    Ok(serde_json::to_string(&generate_profile()).unwrap())
}

#[tauri::command]
pub async fn bind_device_profile_with_profile(account_id: String, profile: String) -> Result<String, String> {
    let profile_obj: DeviceProfile = serde_json::from_str(&profile).map_err(|e| e.to_string())?;
    save_global_original(&profile_obj);
    
    let mut accs = read_accounts()?;
    if let Some(idx) = get_account_idx(&mut accs, &account_id) {
        let mut acc = accs["accounts"][idx].take();
        acc["device_profile"] = serde_json::to_value(&profile_obj).unwrap();
        
        let mut history: Vec<Value> = acc.get("device_history").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        for h in history.iter_mut() {
            if let Some(obj) = h.as_object_mut() { obj.insert("is_current".to_string(), Value::Bool(false)); }
        }
        
        let new_ver = DeviceProfileVersion {
            id: Uuid::new_v4().to_string(),
            created_at: Local::now().timestamp(),
            label: "generated".to_string(),
            profile: profile_obj.clone(),
            is_current: true,
        };
        history.push(serde_json::to_value(&new_ver).unwrap());
        acc["device_history"] = Value::Array(history);
        accs["accounts"][idx] = acc;
        write_accounts(&accs)?;
    }
    
    // Also apply it to storage.json
    if let Ok(storage_path) = get_storage_path() {
        let _ = write_profile(&storage_path, &profile_obj);
    }
    
    Ok(serde_json::to_string(&profile_obj).unwrap())
}

#[tauri::command]
pub async fn restore_original_device() -> Result<String, String> {
    if let Some(baseline) = load_global_original() {
        if let Ok(storage_path) = get_storage_path() {
            let _ = write_profile(&storage_path, &baseline);
        }
        return Ok("Success".to_string());
    }
    Err("No original device profile found".to_string())
}

#[tauri::command]
pub async fn restore_device_version(account_id: String, version_id: String) -> Result<String, String> {
    let mut accs = read_accounts()?;
    if let Some(idx) = get_account_idx(&mut accs, &account_id) {
        let mut acc = accs["accounts"][idx].take();
        let history: Vec<Value> = acc.get("device_history").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        
        let mut target_profile = None;
        if version_id == "baseline" {
            target_profile = load_global_original();
        } else {
            for h in &history {
                if h.get("id").and_then(|v| v.as_str()) == Some(&version_id) {
                    let prof = h.get("profile").unwrap().clone();
                    target_profile = serde_json::from_value(prof).ok();
                    break;
                }
            }
        }
        
        if let Some(prof) = target_profile {
            acc["device_profile"] = serde_json::to_value(&prof).unwrap();
            let mut new_history = history;
            for h in new_history.iter_mut() {
                if let Some(obj) = h.as_object_mut() {
                    let is_curr = obj.get("id").and_then(|v| v.as_str()) == Some(&version_id);
                    obj.insert("is_current".to_string(), Value::Bool(is_curr));
                }
            }
            acc["device_history"] = Value::Array(new_history);
            accs["accounts"][idx] = acc;
            write_accounts(&accs)?;
            
            if let Ok(storage_path) = get_storage_path() {
                let _ = write_profile(&storage_path, &prof);
            }
            return Ok(serde_json::to_string(&prof).unwrap());
        }
    }
    Err("Failed to restore".to_string())
}

#[tauri::command]
pub async fn delete_device_version(account_id: String, version_id: String) -> Result<String, String> {
    let mut accs = read_accounts()?;
    if let Some(idx) = get_account_idx(&mut accs, &account_id) {
        let mut acc = accs["accounts"][idx].take();
        if let Some(history) = acc.get("device_history").and_then(|v| v.as_array()) {
            let filtered: Vec<Value> = history.iter().filter(|h| {
                h.get("id").and_then(|v| v.as_str()) != Some(&version_id)
            }).cloned().collect();
            acc["device_history"] = Value::Array(filtered);
            accs["accounts"][idx] = acc;
            write_accounts(&accs)?;
            return Ok("Success".to_string());
        }
    }
    Err("Failed".to_string())
}

#[tauri::command]
pub async fn open_device_folder(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if let Ok(dir) = get_storage_dir() {
        if let Some(s) = dir.to_str() {
            let _ = app.opener().open_path(s, None::<&str>);
        }
    }
    Ok(())
}
