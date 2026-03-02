import { AppConfig } from '../types/config';

const LOCAL_STORAGE_KEY = 'zerogravity_config';

const DEFAULT_CONFIG: AppConfig = {
    language: 'zh',
    theme: 'dark',
    auto_refresh: true,
    refresh_interval: 30,
    auto_sync: false,
    sync_interval: 300,
    auto_check_update: false,
    hidden_menu_items: [],
    scheduled_warmup: {
        enabled: false,
        monitored_models: [],
    },
    quota_protection: {
        enabled: false,
        threshold_percentage: 20,
        monitored_models: [],
    },
    pinned_quota_models: {
        models: [],
    },
    circuit_breaker: {
        enabled: false,
        backoff_steps: [],
    },
    proxy: {
        enabled: false,
        port: 8741,
        api_key: '',
        auto_start: false,
        request_timeout: 120,
        enable_logging: false,
        upstream_proxy: { enabled: false, url: '' },
    },
    cloudflared: {
        enabled: false,
        mode: 'quick',
        port: 8741,
        use_http2: false,
    },
};

export async function loadConfig(): Promise<AppConfig> {
    try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) {
            return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
        }
    } catch (e) {
        console.warn('[configService] Failed to parse stored config, using defaults', e);
    }
    return DEFAULT_CONFIG;
}

export async function saveConfig(config: AppConfig): Promise<void> {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
}
