import i18n from '../i18n';
import { Account, DeviceProfile, DeviceProfileVersion } from '../types/account';
import { request as invoke } from '../utils/request';
import { loadConfig } from './configService';

// 检查环境 (可选)
function ensureTauriEnvironment() {
    // Web 模式下 request 也是一个 function，所以这里不应抛错
    if (typeof invoke !== 'function') {
        throw new Error(i18n.t('common.tauri_api_not_loaded'));
    }
}

export const ZG_MODEL_MAP: Record<string, string> = {
    "MODEL_PLACEHOLDER_M26": "claude-opus-4-6-thinking",
    "MODEL_PLACEHOLDER_M37": "gemini-3-pro-high",
    "MODEL_PLACEHOLDER_M36": "gemini-3-pro-low",
    "MODEL_PLACEHOLDER_M18": "gemini-3-flash",
    "MODEL_PLACEHOLDER_M35": "claude-sonnet-4-5-thinking",
    "MODEL_OPENAI_GPT_OSS_120B_MEDIUM": "gpt-oss-120b"
};

export async function listAccounts(): Promise<any[]> {
    try {
        const resStr = await invoke<string>('load_accounts');
        let parsed: any = {};
        try {
            parsed = JSON.parse(resStr || '{}');
        } catch (e) {
            console.error("Failed to parse accounts.json", e);
        }

        const accountsArray = Array.isArray(parsed) ? parsed : (parsed.accounts || []);
        const activeEmail: string = parsed.active || '';

        if (accountsArray && Array.isArray(accountsArray)) {
            const enriched = accountsArray.map((acc: any) => {
                // Map fields to what Account type expects
                acc.id = acc.email;
                acc.name = acc.email;
                acc.isActive = activeEmail ? acc.email === activeEmail : false;

                // Provide required fields that ZeroGravity API doesn't return
                acc.token = acc.token || {
                    access_token: '',
                    refresh_token: acc.refresh_token || '',
                    expires_in: 0,
                    expiry_timestamp: 0,
                    token_type: 'Bearer',
                };
                acc.created_at = acc.created_at || Math.floor(Date.now() / 1000);
                acc.last_used = acc.last_used || Math.floor(Date.now() / 1000);

                // Initialize empty quota to avoid UI crash
                if (!acc.quota) {
                    acc.quota = {
                        is_forbidden: false,
                        subscription_tier: 'Loading...',
                        last_updated: Math.floor(Date.now() / 1000),
                        models: []
                    };
                }

                return acc;
            });

            return enriched;
        }
        return [];
    } catch (e) {
        console.error("listAccounts failed", e);
        return [];
    }
}

export async function getActiveEmail(): Promise<string> {
    try {
        const resStr = await invoke<string>('load_accounts');
        const parsed = JSON.parse(resStr || '{}');
        return parsed.active || '';
    } catch { return ''; }
}
export async function getCurrentAccount(): Promise<any | null> {
    return null; // ZeroGravity has no current account concept, global pool
}

export async function addAccount(email: string, refreshToken: string): Promise<any> {
    const payload = JSON.stringify([{ email, refresh_token: refreshToken }]);
    const b64Payload = btoa(unescape(encodeURIComponent(payload)));
    const cmd = `docker exec zerogravity sh -c "echo '${b64Payload}' | base64 -d > /tmp/import.json && zg import /tmp/import.json"`;

    try {
        await invoke('run_shell_command', { command: cmd });
    } catch (e) {
        console.error("zg import failed", e);
        throw e;
    }
    return { email, refresh_token: refreshToken };
}

export async function deleteAccount(accountId: string): Promise<void> {
    const cmd = `docker exec zerogravity zg accounts remove "${accountId}"`;
    try {
        await invoke('run_shell_command', { command: cmd });
        await invoke('run_shell_command', { command: 'docker restart zerogravity' });
    } catch (e) {
        console.error("zg accounts remove failed", e);
        throw e;
    }
}

export async function deleteAccounts(accountIds: string[]): Promise<void> {
    for (const id of accountIds) {
        await deleteAccount(id);
    }
}

export async function switchAccount(accountId: string): Promise<void> {
    try {
        const config = await loadConfig();
        const port = config?.proxy?.port || 8741;
        // Call the running daemon's hot-reload switch API
        await invoke('api_post', {
            path: '/v1/accounts/switch',
            bodyJson: JSON.stringify({ email: accountId }),
            port
        });

        // Also update the physical config so it persists across restarts
        const cmd = `docker exec zerogravity zg accounts set "${accountId}"`;
        await invoke('run_shell_command', { command: cmd });

        console.log(`[switchAccount] successfully switched active account to ${accountId}`);
    } catch (e) {
        console.error(`[switchAccount] Failed to switch to ${accountId}:`, e);
        throw e;
    }
}

export async function getIDEActiveEmail(): Promise<string> {
    try {
        return await invoke<string>('get_ide_active_email');
    } catch (e) {
        console.warn('[Service] Failed to get IDE active email:', e);
        return "";
    }
}

export async function switchIDEAccount(email: string, accessToken: string, refreshToken: string, expiry: number): Promise<void> {
    try {
        await invoke('switch_ide_account', {
            email,
            accessToken,
            refreshToken,
            expiry
        });
        console.log(`[switchIDEAccount] Successfully moved IDE to ${email}`);
    } catch (e) {
        console.error(`[switchIDEAccount] Failed to move IDE to ${email}:`, e);
        throw e;
    }
}

export async function fetchAccountQuota(accountId: string): Promise<any> {
    try {
        console.log(`[fetchAccountQuota] Start fetching for ${accountId}`);
        const resStr = await invoke<string>('load_accounts');
        const parsed = JSON.parse(resStr || '{}');
        const accountsArray = Array.isArray(parsed) ? parsed : (parsed.accounts || []);
        const acc = accountsArray.find((a: any) => a.email === accountId);

        if (!acc || !acc.refresh_token) {
            console.error(`[fetchAccountQuota] Account not found or missing refresh token for ${accountId}`);
            return { error: "Account not found or no refresh token" };
        }

        // Check if this is the active account in the daemon
        const activeEmail = await getActiveEmail();
        let rawJson: string;

        if (activeEmail === accountId) {
            console.log(`[fetchAccountQuota] ${accountId} is active, fetching from daemon /v1/quota`);
            const config = await loadConfig();
            const port = config?.proxy?.port || 8741;
            rawJson = await invoke<string>("api_get", { path: "/v1/quota", port });
        } else {
            console.log(`[fetchAccountQuota] ${accountId} is background, calling fetch_direct_quota`);
            rawJson = await invoke<string>('fetch_direct_quota', { refreshToken: acc.refresh_token });
        }

        if (!rawJson || rawJson.trim() === '') {
            console.error(`[fetchAccountQuota] Received empty response for ${accountId}`);
            return { error: "Empty response from server" };
        }

        console.debug(`[fetchAccountQuota] Raw response for ${accountId}:`, rawJson);
        const data = JSON.parse(rawJson);

        if (data.error) {
            console.error(`[fetchAccountQuota] API returned error for ${accountId}:`, data.error);
            return { error: String(data.error) };
        }

        // Unified mapping to UI-compatible QuotaData interface
        const mapped = {
            models: (data.models || []).map((m: any) => {
                const rawId = m.model_id || m.name || '';
                // Resolve friendly name: check ZG_MODEL_MAP first, then fallback to label or rawId
                const resolvedName = ZG_MODEL_MAP[rawId] || m.label || rawId;

                return {
                    name: resolvedName,
                    percentage: m.remaining_pct !== undefined ? m.remaining_pct : 0,
                    reset_time: m.reset_time || ''
                };
            }),
            last_updated: Math.floor(Date.now() / 1000),
            subscription_tier: data.plan?.plan_name || data.plan?.tier_name || 'PRO',
            is_forbidden: data.account_banned || data.account_restricted || false
        };

        console.log(`[fetchAccountQuota] Successfully mapped quota for ${accountId}, models count: ${mapped.models.length}`);
        return mapped;
    } catch (e) {
        console.error(`[fetchAccountQuota] Unexpected error for ${accountId}:`, e);
        return { error: `Unexpected error: ${e}` };
    }
}


export interface RefreshStats {
    total: number;
    success: number;
    failed: number;
    details: string[];
}

export async function refreshAllQuotas(): Promise<RefreshStats> {
    console.log('[Service] refreshAllQuotas: Loading accounts...');
    const resStr = await invoke<string>('load_accounts');
    let accounts: any[] = [];
    try {
        const parsed = JSON.parse(resStr || '{}');
        accounts = Array.isArray(parsed) ? parsed : (parsed.accounts || []);
    } catch (e) {
        console.error('[Service] refreshAllQuotas: Failed to parse accounts:', e);
        return { total: 0, success: 0, failed: 0, details: [] };
    }

    console.log(`[Service] refreshAllQuotas: Refreshing ${accounts.length} accounts...`);
    let success = 0;
    let failed = 0;
    const details: string[] = [];

    // Load existing cache
    const localCacheText = localStorage.getItem('ZG_QUOTA_CACHE');
    const localCache = localCacheText ? JSON.parse(localCacheText) : {};

    await Promise.all(accounts.map(async (acc) => {
        try {
            const result = await fetchAccountQuota(acc.email);
            if (result && !result.error) {
                success++;
                details.push(`✅ ${acc.email}`);
                // Update cache
                localCache[acc.email] = {
                    quota: result,
                    timestamp: Date.now()
                };
            } else {
                failed++;
                details.push(`❌ ${acc.email}: ${result?.error || 'empty response'}`);
            }
        } catch (e) {
            failed++;
            details.push(`❌ ${acc.email}: ${e}`);
        }
    }));

    // Persist cache
    localStorage.setItem('ZG_QUOTA_CACHE', JSON.stringify(localCache));
    console.log(`[Service] refreshAllQuotas completed. Success: ${success}, Failed: ${failed}`);

    return { total: accounts.length, success, failed, details };
}

// OAuth
export async function startOAuthLogin(): Promise<Account> {
    ensureTauriEnvironment();

    try {
        return await invoke('start_oauth_login');
    } catch (error) {
        // 增强错误信息
        if (typeof error === 'string') {
            // 如果是 refresh_token 缺失错误,保持原样(已包含详细说明)
            if (error.includes('Refresh Token') || error.includes('refresh_token')) {
                throw error;
            }
            // 其他错误添加上下文
            throw i18n.t('accounts.add.oauth_error', { error });
        }
        throw error;
    }
}

export async function completeOAuthLogin(): Promise<Account> {
    ensureTauriEnvironment();
    try {
        return await invoke('complete_oauth_login');
    } catch (error) {
        if (typeof error === 'string') {
            if (error.includes('Refresh Token') || error.includes('refresh_token')) {
                throw error;
            }
            throw i18n.t('accounts.add.oauth_error', { error });
        }
        throw error;
    }
}

export async function cancelOAuthLogin(): Promise<void> {
    ensureTauriEnvironment();
    return await invoke('cancel_oauth_login');
}

// 导入
export async function importV1Accounts(): Promise<Account[]> {
    return await invoke('import_v1_accounts');
}

export async function importFromDb(): Promise<Account> {
    return await invoke('import_from_db');
}

export async function importFromCustomDb(path: string): Promise<Account> {
    return await invoke('import_custom_db', { path });
}

export async function syncAccountFromDb(): Promise<Account | null> {
    return await invoke('sync_account_from_db');
}

export async function toggleProxyStatus(accountId: string, enable: boolean, reason?: string): Promise<void> {
    const payload = JSON.stringify({ enable, reason });
    const config = await loadConfig();
    const port = config?.proxy?.port || 8741;
    await invoke<string>('api_post', { path: `/api/accounts/${encodeURIComponent(accountId)}/toggle-proxy`, bodyJson: payload, port });
}

/**
 * 重新排序账号列表
 * @param accountIds 按新顺序排列的账号ID数组
 */
export async function reorderAccounts(accountIds: string[]): Promise<void> {
    const payload = JSON.stringify({ accountIds });
    const config = await loadConfig();
    const port = config?.proxy?.port || 8741;
    await invoke<string>('api_post', { path: '/api/accounts/reorder', bodyJson: payload, port });
}

// 设备指纹相关
export interface DeviceProfilesResponse {
    current_storage?: DeviceProfile;
    history?: DeviceProfileVersion[];
    baseline?: DeviceProfile;
}

export async function getDeviceProfiles(accountId: string): Promise<DeviceProfilesResponse> {
    const res = await invoke<string>('get_device_profiles', { accountId });
    return JSON.parse(res);
}

export async function bindDeviceProfile(accountId: string, mode: 'capture' | 'generate'): Promise<DeviceProfile> {
    const res = await invoke<string>('bind_device_profile', { accountId, mode });
    return JSON.parse(res);
}

export async function restoreOriginalDevice(): Promise<string> {
    return await invoke<string>('restore_original_device');
}

export async function listDeviceVersions(accountId: string): Promise<DeviceProfilesResponse> {
    const res = await invoke<string>('get_device_profiles', { accountId });
    return JSON.parse(res);
}

export async function restoreDeviceVersion(accountId: string, versionId: string): Promise<DeviceProfile> {
    const res = await invoke<string>('restore_device_version', { accountId, versionId });
    return JSON.parse(res);
}

export async function deleteDeviceVersion(accountId: string, versionId: string): Promise<void> {
    await invoke<string>('delete_device_version', { accountId, versionId });
}

export async function openDeviceFolder(): Promise<void> {
    await invoke<string>('open_device_folder');
}

export async function previewGenerateProfile(): Promise<DeviceProfile> {
    const res = await invoke<string>('preview_generate_profile');
    return JSON.parse(res);
}

export async function bindDeviceProfileWithProfile(accountId: string, profile: DeviceProfile): Promise<DeviceProfile> {
    const res = await invoke<string>('bind_device_profile_with_profile', { accountId, profile: JSON.stringify(profile) });
    return JSON.parse(res);
}

// 预热相关
export async function warmUpAllAccounts(): Promise<string> {
    const config = await loadConfig();
    const port = config?.proxy?.port || 8741;
    const res = await invoke<string>('api_post', { path: '/api/accounts/warmup', bodyJson: '{}', port });
    return res;
}

export async function warmUpAccount(accountId: string): Promise<string> {
    const config = await loadConfig();
    const port = config?.proxy?.port || 8741;
    const res = await invoke<string>('api_post', { path: `/api/accounts/${encodeURIComponent(accountId)}/warmup`, bodyJson: '{}', port });
    return res;
}

// 导出账号相关
export interface ExportAccountItem {
    email: string;
    refresh_token: string;
}

export interface ExportAccountsResponse {
    accounts: ExportAccountItem[];
}

export async function exportAccounts(accountIds: string[]): Promise<ExportAccountsResponse> {
    // Read from local accounts to ensure we get the real refresh_token
    try {
        const resStr = await invoke<string>('load_accounts');
        let parsed: any = {};
        try {
            parsed = JSON.parse(resStr || '{}');
        } catch (e) {
            console.error("Failed to parse accounts.json", e);
        }

        const accountsArray = Array.isArray(parsed) ? parsed : (parsed.accounts || []);

        if (accountsArray && Array.isArray(accountsArray)) {
            const filtered = accountsArray
                .filter((acc: any) => accountIds.includes(acc.email))
                .map((acc: any) => ({
                    email: acc.email,
                    refresh_token: acc.refresh_token || acc.token?.refresh_token || '',
                }));
            return { accounts: filtered };
        }
        return { accounts: [] };
    } catch (e) {
        console.error("exportAccounts failed:", e);
        return { accounts: [] };
    }
}

// 自定义标签相关 (client-side only, stored in localStorage)
export async function updateAccountLabel(accountId: string, label: string): Promise<void> {
    const KEY = 'zg_account_labels';
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (label) {
        stored[accountId] = label;
    } else {
        delete stored[accountId];
    }
    localStorage.setItem(KEY, JSON.stringify(stored));
}

export function getAccountLabels(): Record<string, string> {
    const KEY = 'zg_account_labels';
    return JSON.parse(localStorage.getItem(KEY) || '{}');
}

