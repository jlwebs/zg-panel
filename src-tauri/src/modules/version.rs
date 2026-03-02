use crate::modules::process;
use std::fs;
use std::path::PathBuf;

/// Antigravity Version Info
#[derive(Debug, Clone)]
pub struct AntigravityVersion {
    pub short_version: String,
    pub bundle_version: String,
}

/// Extract semver from string
fn extract_semver(raw: &str) -> Option<String> {
    for token in raw.split(|c: char| c.is_whitespace() || c == ',' || c == ';') {
        let t = token.trim_matches(|c: char| c == '"' || c == '\'' || c == '(' || c == ')');
        if t.is_empty() {
            continue;
        }
        let mut parts = t.split('.');
        let p1 = parts.next();
        let p2 = parts.next();
        let p3 = parts.next();
        if p1.is_some()
            && p2.is_some()
            && p3.is_some()
            && [p1.unwrap(), p2.unwrap(), p3.unwrap()]
                .iter()
                .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
        {
            return Some(t.to_string());
        }
    }
    None
}

/// Get Antigravity version
pub fn get_antigravity_version() -> Result<AntigravityVersion, String> {
    let exe_path = process::get_antigravity_executable_path()
        .ok_or("Unable to locate Antigravity executable")?;
    
    #[cfg(target_os = "macos")]
    {
        get_version_macos(&exe_path)
    }
    
    #[cfg(target_os = "windows")]
    {
        get_version_windows(&exe_path)
    }
    
    #[cfg(target_os = "linux")]
    {
        get_version_linux(&exe_path)
    }
}

#[cfg(target_os = "macos")]
fn get_version_macos(exe_path: &PathBuf) -> Result<AntigravityVersion, String> {
    use plist::Value;
    
    let path_str = exe_path.to_string_lossy();
    let app_path = if let Some(idx) = path_str.find(".app") {
        PathBuf::from(&path_str[..idx + 4])
    } else {
        exe_path.clone()
    };
    
    let info_plist_path = app_path.join("Contents/Info.plist");
    if !info_plist_path.exists() {
        return Err(format!("Info.plist not found: {:?}", info_plist_path));
    }
    
    let content = fs::read(&info_plist_path)
        .map_err(|e| format!("Failed to read Info.plist: {}", e))?;
    
    let plist: Value = plist::from_bytes(&content)
        .map_err(|e| format!("Failed to parse Info.plist: {}", e))?;
    
    let dict = plist.as_dictionary()
        .ok_or("Info.plist is not a dictionary")?;
    
    let short_version = dict.get("CFBundleShortVersionString")
        .and_then(|v| v.as_string())
        .ok_or("CFBundleShortVersionString not found")?;
    
    let bundle_version = dict.get("CFBundleVersion")
        .and_then(|v| v.as_string())
        .unwrap_or(short_version);
    
    Ok(AntigravityVersion {
        short_version: short_version.to_string(),
        bundle_version: bundle_version.to_string(),
    })
}

#[cfg(target_os = "windows")]
fn get_version_windows(exe_path: &PathBuf) -> Result<AntigravityVersion, String> {
    use std::process::Command;
    
    let output = Command::new("powershell")
        .args([
            "-Command",
            &format!(
                "(Get-Item '{}').VersionInfo.FileVersion",
                exe_path.display()
            ),
        ])
        .output()
        .map_err(|e| format!("Failed to execute PowerShell: {}", e))?;
    
    if !output.status.success() {
        return Err("Failed to read version from executable".to_string());
    }
    
    let version = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_string();
    
    if version.is_empty() {
        return Err("Version information not found in executable".to_string());
    }
    
    Ok(AntigravityVersion {
        short_version: version.clone(),
        bundle_version: version,
    })
}

#[cfg(target_os = "linux")]
fn get_version_linux(exe_path: &PathBuf) -> Result<AntigravityVersion, String> {
    use std::process::Command;
    
    let output = Command::new(exe_path)
        .arg("--version")
        .output();
    
    if let Ok(result) = output {
        if result.status.success() {
            let raw_version = String::from_utf8_lossy(&result.stdout)
                .trim()
                .to_string();
            if !raw_version.is_empty() {
                let version = extract_semver(&raw_version).unwrap_or_else(|| {
                    raw_version
                        .lines()
                        .next()
                        .unwrap_or_default()
                        .trim()
                        .to_string()
                });
                return Ok(AntigravityVersion {
                    short_version: version.clone(),
                    bundle_version: raw_version,
                });
            }
        }
    }
    
    Err("Unable to determine Antigravity version on Linux".to_string())
}

/// Check if it is a new version (>= 1.16.5)
pub fn is_new_version(version: &AntigravityVersion) -> bool {
    compare_version(&version.short_version, "1.16.5") >= std::cmp::Ordering::Equal
}

/// Compare version strings
fn compare_version(v1: &str, v2: &str) -> std::cmp::Ordering {
    let parts1: Vec<u32> = v1
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();
    let parts2: Vec<u32> = v2
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();
    
    for i in 0..parts1.len().max(parts2.len()) {
        let p1 = parts1.get(i).unwrap_or(&0);
        let p2 = parts2.get(i).unwrap_or(&0);
        match p1.cmp(p2) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}
