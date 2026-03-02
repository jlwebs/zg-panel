use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Serialize, Deserialize)]
struct LoadCodeAssistResponse {
    #[serde(rename = "cloudaicompanionProject")]
    project_id: Option<String>,
    #[serde(rename = "currentTier")]
    current_tier: Option<Tier>,
    #[serde(rename = "paidTier")]
    paid_tier: Option<Tier>,
}

#[derive(Serialize, Deserialize)]
struct Tier {
    id: Option<String>,
}

pub fn get_quota_direct(refresh_token: &str) -> Result<String, String> {
    eprintln!(
        "[get_quota_direct] Starting fetch for token ending in: {}",
        &refresh_token.chars().rev().take(10).collect::<String>()
    );

    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;

    let body_str = format!(
        "client_id={}&client_secret={}&refresh_token={}&grant_type=refresh_token",
        std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default(),
        std::env::var("GOOGLE_CLIENT_SECRET").unwrap_or_default(),
        refresh_token
    );

    let token_res = client
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body_str)
        .send()
        .map_err(|e: reqwest::Error| {
            eprintln!("[get_quota_direct] Token request execution failed: {}", e);
            e.to_string()
        })?;

    if !token_res.status().is_success() {
        let err_txt = token_res.text().unwrap_or_default();
        eprintln!(
            "[get_quota_direct] Failed to get token. Server response: {}",
            err_txt
        );
        return Err(format!("Failed to get token: {}", err_txt));
    }

    let token_data: TokenResponse = token_res.json().map_err(|e: reqwest::Error| {
        eprintln!(
            "[get_quota_direct] Failed to parse TokenResponse JSON: {}",
            e
        );
        e.to_string()
    })?;
    let access_token = token_data.access_token;

    eprintln!("[get_quota_direct] Successfully retrieved access token. Fetching code assist...");

    // 2. Load code assist
    let ca_body = serde_json::json!({
        "metadata": { "ideType": "ANTIGRAVITY" }
    });

    let ca_res = client.post("https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/1.16.5 Chrome/132.0.6834.160 Electron/39.2.3 Safari/537.36")
        .json(&ca_body)
        .send()
        .map_err(|e| {
            eprintln!("[get_quota_direct] Load code assist request execution failed: {}", e);
            e.to_string()
        })?;

    let mut project_id = "bamboo-precept-lgxtn".to_string();
    let mut tier_name = "Free".to_string();

    if ca_res.status().is_success() {
        if let Ok(ca_data) = ca_res.json::<LoadCodeAssistResponse>() {
            if let Some(pid) = ca_data.project_id {
                project_id = pid;
            }
            if let Some(t) = ca_data
                .paid_tier
                .and_then(|t| t.id)
                .or_else(|| ca_data.current_tier.and_then(|t| t.id))
            {
                tier_name = t;
            }
        }
        eprintln!(
            "[get_quota_direct] Code assist loaded. Project ID: {}, Tier: {}",
            project_id, tier_name
        );
    } else {
        eprintln!(
            "[get_quota_direct] Warning: Failed to load code assist. Status: {}",
            ca_res.status()
        );
    }

    eprintln!("[get_quota_direct] Fetching available models...");

    // 3. Fetch models
    let payload = serde_json::json!({
        "project": project_id
    });

    let quota_res = client.post("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/1.16.5 Chrome/132.0.6834.160 Electron/39.2.3 Safari/537.36")
        .json(&payload)
        .send()
        .map_err(|e| {
            eprintln!("[get_quota_direct] Fetch models request execution failed: {}", e);
            e.to_string()
        })?;

    if !quota_res.status().is_success() {
        let err_txt = quota_res.text().unwrap_or_default();
        eprintln!("[get_quota_direct] Fetch models API failed: {}", err_txt);
        return Err(format!("Quota API failed: {}", err_txt));
    }

    let quota_json: serde_json::Value = quota_res.json().map_err(|e: reqwest::Error| {
        eprintln!("[get_quota_direct] Failed to parse models JSON: {}", e);
        e.to_string()
    })?;

    // Parse output format to match JS
    let mut models = vec![];

    if let Some(m_list) = quota_json.get("models").and_then(|m| m.as_array()) {
        eprintln!(
            "[get_quota_direct] Models is an array with {} items",
            m_list.len()
        );
        for item in m_list {
            let model_id = item.get("modelId").and_then(|v| v.as_str()).unwrap_or("");
            let key_lower = model_id.to_lowercase();

            // Filter out G2.5 models as requested
            if key_lower.contains("2.5") {
                continue;
            }

            if key_lower.contains("gemini")
                || key_lower.contains("claude")
                || key_lower.contains("image")
                || key_lower.contains("gpt")
            {
                let fraction = item
                    .get("quotaInfo")
                    .and_then(|q| q.get("remainingFraction"))
                    .and_then(|f| f.as_f64())
                    .unwrap_or(0.0);
                let pct = (fraction * 100.0).round() as i32;
                let reset_time = item
                    .get("quotaInfo")
                    .and_then(|q| q.get("resetTime"))
                    .and_then(|r| r.as_str())
                    .unwrap_or("");

                models.push(serde_json::json!({
                    "model_id": model_id,
                    "label": model_id,
                    "remaining_fraction": fraction,
                    "remaining_pct": pct,
                    "reset_time": reset_time
                }));
            }
        }
    } else if let Some(m_obj) = quota_json.get("models").and_then(|m| m.as_object()) {
        eprintln!(
            "[get_quota_direct] Models is an object with {} keys",
            m_obj.len()
        );
        for (key, val) in m_obj {
            let key_lower = key.to_lowercase();
            // Filter out G2.5 models as requested
            if key_lower.contains("2.5") {
                continue;
            }
            if key_lower.contains("gemini")
                || key_lower.contains("claude")
                || key_lower.contains("image")
                || key_lower.contains("gpt")
            {
                let fraction = val
                    .get("quotaInfo")
                    .and_then(|q| q.get("remainingFraction"))
                    .and_then(|f| f.as_f64())
                    .unwrap_or(0.0);
                let pct = (fraction * 100.0).round() as i32;
                let reset_time = val
                    .get("quotaInfo")
                    .and_then(|q| q.get("resetTime"))
                    .and_then(|r| r.as_str())
                    .unwrap_or("");

                models.push(serde_json::json!({
                    "model_id": key,
                    "label": key,
                    "remaining_fraction": fraction,
                    "remaining_pct": pct,
                    "reset_time": reset_time
                }));
            }
        }
    } else {
        eprintln!(
            "[get_quota_direct] Warning: 'models' field is missing or not a known type. JSON: {}",
            quota_json
        );
    }

    eprintln!(
        "[get_quota_direct] Models parsed successfully. Count: {}",
        models.len()
    );

    let result = serde_json::json!({
        "account_banned": false,
        "account_restricted": false,
        "last_updated": format!("{:?}", std::time::SystemTime::now()),
        "plan": { "tier_name": tier_name },
        "models": models
    });

    Ok(serde_json::to_string(&result).unwrap_or_default())
}
