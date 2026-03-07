mod quota;
mod device;
mod protobuf;
mod modules;

use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Windows 标志位：彻底隐藏控制台黑框
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 默认的 proxy_fix.py 内容，编译时嵌入二进制
const DEFAULT_PROXY_PY: &str = include_str!("../../proxy_fix.py");

/// 助手函数：创建一个正确配置的异步 Command
fn create_command(program: &str) -> Command {
    let mut std_cmd = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    {
        std_cmd.creation_flags(CREATE_NO_WINDOW);
    }
    Command::from(std_cmd)
}



// ─── Tauri Commands ───


#[tauri::command]
async fn check_docker() -> Result<String, String> {
    let output = create_command("docker")
        .args(["inspect", "-f", "{{.State.Status}}", "zerogravity"])
        .output()
        .await
        .map_err(|e: std::io::Error| e.to_string())?;

    if !output.status.success() {
        return Ok("not_found".into());
    }

    let status = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(status)
}

#[tauri::command]
async fn docker_action(action: &str) -> Result<String, String> {
    let args = match action {
        "start" => vec!["start", "zerogravity"],
        "stop" => vec!["stop", "zerogravity"],
        "restart" => vec!["restart", "zerogravity"],
        _ => return Err("Invalid action".into()),
    };

    let output = create_command("docker")
        .args(&args)
        .output()
        .await
        .map_err(|e: std::io::Error| e.to_string())?;

    if output.status.success() {
        Ok("Success".into())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

#[tauri::command]
async fn docker_logs(tail: Option<u32>) -> Result<String, String> {
    let tail_str = tail.unwrap_or(200).to_string();
    let output = create_command("docker")
        .args(["logs", "--tail", &tail_str, "zerogravity"])
        .output()
        .await
        .map_err(|e: std::io::Error| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    
    let combined = if stdout.is_empty() {
        stderr
    } else if stderr.is_empty() {
        stdout
    } else {
        format!("{}\n{}", stderr, stdout)
    };

    Ok(combined)
}


#[tauri::command]
async fn run_shell_command(command: &str) -> Result<String, String> {
    if cfg!(target_os = "windows") {
        // 自动处理 python/python3 差异
        let cmd = command.replace("python ", "python ").replace("python3 ", "python ");
        
        // 使用 chcp 65001 强制 UTF-8，防止乱码干扰
        let final_command = format!("chcp 65001 >nul && {}", cmd);
        
        let output = create_command("cmd")
            .arg("/C")
            .raw_arg(&final_command)
            .output()
            .await
            .map_err(|e| format!("Failed to spawn cmd: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if output.status.success() {
            Ok(stdout)
        } else {
            // 即使失败也返回内容，方便调试
            let combined = format!("{}{}", stdout, stderr).trim().to_string();
            if combined.is_empty() {
                Err(format!("Command failed with code: {}", output.status))
            } else {
                Err(combined)
            }
        }
    } else {
        let output = create_command("sh")
            .arg("-c")
            .arg(command)
            .output()
            .await
            .map_err(|e| format!("Failed to spawn sh: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if output.status.success() {
            Ok(stdout)
        } else {
            Err(format!("{}{}", stdout, stderr).trim().to_string())
        }
    }
}


#[tauri::command]
fn show_main_window(window: tauri::Window) {
    window.show().unwrap();
}


#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Cannot read {}: {}", path, e))
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("Cannot write {}: {}", path, e))
}

/// 初始化代理文件：若用户数据目录中不存在 proxy_fix.py，则写入默认内容
/// 返回 JSON: { py_path, log_path }
#[tauri::command]
fn init_proxy_files(app: AppHandle) -> Result<String, String> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {}", e))?;

    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Cannot create data dir: {}", e))?;

    let py_path = data_dir.join("proxy_fix.py");
    let log_path = data_dir.join("proxy_fix.log");

    // 首次运行：写入默认脚本
    if !py_path.exists() {
        std::fs::write(&py_path, DEFAULT_PROXY_PY)
            .map_err(|e| format!("Cannot write proxy_fix.py: {}", e))?;
    }

    // log 文件不存在时创建空文件（避免读失败）
    if !log_path.exists() {
        std::fs::write(&log_path, "").ok();
    }

    let result = serde_json::json!({
        "py_path": py_path.to_string_lossy(),
        "log_path": log_path.to_string_lossy(),
    });
    Ok(result.to_string())
}

#[tauri::command]
async fn docker_inspect() -> Result<String, String> {
    let output = create_command("docker")
        .args(["inspect", "zerogravity"])
        .output()
        .await
        .map_err(|e: std::io::Error| e.to_string())?;

    if !output.status.success() {
        return Err("Container not found".into());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
fn api_get(path: &str, port: Option<u16>) -> Result<String, String> {
    let p = port.unwrap_or(8741);
    let url = format!("http://localhost:{}{}", p, path);
    
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
        
    match client.get(&url).send() {
        Ok(res) => {
            let body = res.text().unwrap_or_default();
            Ok(body)
        }
        Err(e) => {
            Err(e.to_string())
        }
    }
}

#[tauri::command]
fn api_post(path: &str, body_json: &str, port: Option<u16>) -> Result<String, String> {
    let p = port.unwrap_or(8741);
    let url = format!("http://localhost:{}{}", p, path);
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
        
    match client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(body_json.to_string())
        .send()
    {
        Ok(res) => {
            let body = res.text().map_err(|e| e.to_string())?;
            Ok(body)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn api_delete(path: &str, body_json: Option<String>, port: Option<u16>) -> Result<String, String> {
    let p = port.unwrap_or(8741);
    let url = format!("http://localhost:{}{}", p, path);
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
        
    let mut req = client.delete(&url);
    if let Some(body) = body_json {
        if !body.is_empty() {
            req = req.header("Content-Type", "application/json").body(body);
        }
    }
    match req.send() {
        Ok(res) => {
            let res_body = res.text().map_err(|e| e.to_string())?;
            Ok(res_body)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn load_accounts() -> Result<String, String> {
    let output = create_command("docker")
        .args(["exec", "zerogravity", "cat", "/root/.config/zerogravity/accounts.json"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let home = std::env::var("HOME").unwrap_or_default();
        let path = std::path::PathBuf::from(&home)
            .join("Desktop/project/zerogravity_new/accounts.json");
        if path.exists() {
            tokio::fs::read_to_string(&path)
                .await
                .map_err(|e: std::io::Error| e.to_string())
        } else {
            Ok("{\"accounts\":[],\"active\":\"\"}".to_string())
        }
    }
}

#[tauri::command]
async fn save_accounts(json_data: &str) -> Result<String, String> {
    let path = std::path::PathBuf::from("../accounts.json");
    tokio::fs::write(&path, json_data)
        .await
        .map_err(|e: std::io::Error| e.to_string())?;
    
    let output = create_command("docker")
        .args(["restart", "zerogravity"])
        .output()
        .await
        .map_err(|e: std::io::Error| e.to_string())?;
        
    if output.status.success() {
        Ok("Success".to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

#[tauri::command]
async fn fetch_direct_quota(refresh_token: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        quota::get_quota_direct(&refresh_token)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_ide_active_email() -> Result<String, String> {
    let db_path = modules::db::get_db_path()?;
    let (email, _) = extract_auth_status(&db_path);
    Ok(email)
}

fn extract_auth_status(db_path: &PathBuf) -> (String, String) {
    let conn = match rusqlite::Connection::open(db_path) {
        Ok(c) => c,
        Err(_) => return (String::new(), String::new()),
    };

    let auth_json: Option<String> = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?",
            ["antigravityAuthStatus"],
            |row| row.get(0),
        )
        .ok();

    if let Some(json_str) = auth_json {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&json_str) {
            let email = val.get("email").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let name = val.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            return (email, name);
        }
    }

    (String::new(), String::new())
}

#[tauri::command]
fn import_from_ide(custom_db_path: Option<String>) -> Result<String, String> {
    let db_path = if let Some(p) = custom_db_path {
        PathBuf::from(p)
    } else {
        modules::db::get_db_path()?
    };

    let refresh_token = extract_refresh_token_from_db(&db_path)?;
    let (email, name) = extract_auth_status(&db_path);

    let result = serde_json::json!({
        "refresh_token": refresh_token,
        "email": email,
        "name": name,
        "db_path": db_path.to_string_lossy(),
    });

    Ok(result.to_string())
}

fn extract_refresh_token_from_db(db_path: &PathBuf) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    let new_data: Option<String> = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?",
            ["antigravityUnifiedStateSync.oauthToken"],
            |row| row.get(0),
        )
        .ok();

    if let Some(outer_b64) = new_data {
        let outer_blob = general_purpose::STANDARD.decode(&outer_b64).map_err(|e| e.to_string())?;
        let inner1 = crate::protobuf::pb_find_field(&outer_blob, 1)?.ok_or("Field 1 not found")?;
        let inner2 = crate::protobuf::pb_find_field(&inner1, 2)?.ok_or("Field 2 not found")?;
        let oauth_b64_bytes = crate::protobuf::pb_find_field(&inner2, 1)?.ok_or("Field 1 not found")?;
        let oauth_b64 = String::from_utf8(oauth_b64_bytes).map_err(|e| e.to_string())?;
        let oauth_blob = general_purpose::STANDARD.decode(&oauth_info_b64_cleanup(&oauth_b64)).map_err(|e| e.to_string())?;
        let refresh_bytes = crate::protobuf::pb_find_field(&oauth_blob, 3)?.ok_or("Refresh Token not found")?;
        return String::from_utf8(refresh_bytes).map_err(|e| e.to_string());
    }

    let old_data: String = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?",
            ["jetskiStateSync.agentManagerInitState"],
            |row| row.get(0),
        )
        .map_err(|_| "No OAuth data found".to_string())?;

    let blob = general_purpose::STANDARD.decode(&old_data).map_err(|e| e.to_string())?;
    let oauth_data = crate::protobuf::pb_find_field(&blob, 6)?.ok_or("Field 6 not found")?;
    let refresh_bytes = crate::protobuf::pb_find_field(&oauth_data, 3)?.ok_or("Field 3 not found")?;
    String::from_utf8(refresh_bytes).map_err(|e| e.to_string())
}

fn oauth_info_b64_cleanup(s: &str) -> String {
    s.trim_matches(|c| c == '\"' || c == '\'').to_string()
}

#[tauri::command]
async fn switch_ide_account(
    email: String,
    access_token: String,
    refresh_token: String,
    expiry: i64,
) -> Result<String, String> {
    let db_path = modules::db::get_db_path()?;
    
    // 1. Close Antigravity
    modules::process::close_antigravity(20)?;

    // 2. Inject token
    modules::db::inject_token(&db_path, &access_token, &refresh_token, expiry, &email)?;

    // 3. Restart Antigravity
    modules::process::start_antigravity()?;

    Ok("Success".to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            check_docker,
            docker_action,
            docker_logs,
            docker_inspect,
            run_shell_command,
            api_get,
            api_post,
            api_delete,
            import_from_ide,
            load_accounts,
            save_accounts,
            fetch_direct_quota,
            get_ide_active_email,
            switch_ide_account,
            device::get_device_profiles,
            device::bind_device_profile,
            device::preview_generate_profile,
            device::bind_device_profile_with_profile,
            device::restore_original_device,
            device::restore_device_version,
            device::delete_device_version,
            device::open_device_folder,
            read_file,
            write_file,
            init_proxy_files,
            show_main_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
