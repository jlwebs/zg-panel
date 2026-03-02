import { create } from 'zustand';
import { Account } from '../types/account';
import * as accountService from '../services/accountService';

interface AccountState {
    accounts: Account[];
    currentAccount: Account | null;
    activeAccount: string | null; // Added as per diff
    ideActiveEmail: string | null; // Added as per instruction
    loading: boolean;
    error: string | null;
    lastQuotaRefreshTS: number | null;

    // Actions
    fetchAccounts: () => Promise<void>;
    fetchCurrentAccount: () => Promise<void>;
    addAccount: (email: string, refreshToken: string) => Promise<void>;
    deleteAccount: (accountId: string) => Promise<void>;
    deleteAccounts: (accountIds: string[]) => Promise<void>;
    switchAccount: (accountId: string) => Promise<void>;
    refreshQuota: (accountId: string) => Promise<void>;
    refreshAllQuotas: () => Promise<accountService.RefreshStats>;
    reorderAccounts: (accountIds: string[]) => Promise<void>;
    checkIDEActiveEmail: () => Promise<void>; // Added as per instruction
    applyToIDE: (accountId: string) => Promise<void>; // Added as per instruction

    // 新增 actions
    startOAuthLogin: () => Promise<void>;
    completeOAuthLogin: () => Promise<void>;
    cancelOAuthLogin: () => Promise<void>;
    importV1Accounts: () => Promise<void>;
    importFromDb: () => Promise<void>;
    importFromCustomDb: (path: string) => Promise<void>;
    syncAccountFromDb: () => Promise<void>;
    toggleProxyStatus: (accountId: string, enable: boolean, reason?: string) => Promise<void>;
    warmUpAccounts: () => Promise<string>;
    warmUpAccount: (accountId: string) => Promise<string>;
    updateAccountLabel: (accountId: string, label: string) => Promise<void>;

    // Background async handlers
    refreshAllQuotasBackground: () => Promise<void>;
}

export const useAccountStore = create<AccountState>((set, get) => ({
    accounts: [],
    currentAccount: null,
    activeAccount: null, // Initialized as per diff
    ideActiveEmail: null, // Initialized as per instruction
    loading: false,
    error: null,
    lastQuotaRefreshTS: parseInt(localStorage.getItem('ZG_QUOTA_TS') || '0', 10) || null,

    fetchAccounts: async () => {
        set({ loading: true, error: null });
        try {
            console.log('[Store] Fetching accounts...');
            const newAccounts = await accountService.listAccounts();

            // Sync IDE active email
            const ideEmail = await accountService.getIDEActiveEmail();
            set({ ideActiveEmail: ideEmail });

            // Preserve existing quota state to avoid UI flicker
            const currentAccounts = get().accounts;
            const updatedAccounts = newAccounts.map(na => {
                const existing = currentAccounts.find(ca => ca.id === na.id);
                // Try from memory first, then LocalStorage cache
                const localCacheText = localStorage.getItem('ZG_QUOTA_CACHE');
                const localCache = localCacheText ? JSON.parse(localCacheText) : {};

                if (existing && existing.quotaInfo) {
                    na.quota = existing.quota;
                    na.quotaInfo = existing.quotaInfo;
                } else if (localCache[na.id]) {
                    na.quota = localCache[na.id].quota;
                    na.quotaInfo = localCache[na.id].quotaInfo;
                }
                return na;
            });

            set({ accounts: updatedAccounts, loading: false });

            // Only fetch background quota if 2 hours have passed or never fetched
            const now = Date.now();
            const lastSync = get().lastQuotaRefreshTS;
            if (!lastSync || now - lastSync > 2 * 60 * 60 * 1000) {
                get().refreshAllQuotasBackground();
            }

            // Feature spec: Fetch active account quota directly bypassing the 2 hour cache
            const activeAccount = updatedAccounts.find(a => a.isActive);
            if (activeAccount) {
                accountService.fetchAccountQuota(activeAccount.email).then(quotaData => {
                    if (quotaData && !quotaData.error && quotaData.models) {
                        const storeAccounts = get().accounts;
                        const idx = storeAccounts.findIndex(a => a.id === activeAccount.id);
                        if (idx !== -1) {
                            const newAccounts = [...storeAccounts];
                            newAccounts[idx].quota = quotaData;
                            set({ accounts: newAccounts });

                            // Update local cache specifically for this active account
                            const localCacheText = localStorage.getItem('ZG_QUOTA_CACHE');
                            const localCache = localCacheText ? JSON.parse(localCacheText) : {};
                            localCache[activeAccount.id] = {
                                quota: newAccounts[idx].quota,
                                timestamp: Date.now()
                            };
                            localStorage.setItem('ZG_QUOTA_CACHE', JSON.stringify(localCache));
                        }
                    }
                }).catch(err => console.error('[Store] Failed to fetch active account quota:', err));
            }

        } catch (error) {
            console.error('[Store] Fetch accounts failed:', error);
            set({ error: String(error), loading: false });
        }
    },

    fetchCurrentAccount: async () => {
        set({ loading: true, error: null });
        try {
            const account = await accountService.getCurrentAccount();
            set({ currentAccount: account, loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
        }
    },

    addAccount: async (email: string, refreshToken: string) => {
        set({ loading: true, error: null });
        try {
            await accountService.addAccount(email, refreshToken);
            await get().fetchAccounts();
            set({ loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    deleteAccount: async (accountId: string) => {
        set({ loading: true, error: null });
        try {
            await accountService.deleteAccount(accountId);
            await Promise.all([
                get().fetchAccounts(),
                get().fetchCurrentAccount()
            ]);
            set({ loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    deleteAccounts: async (accountIds: string[]) => {
        set({ loading: true, error: null });
        try {
            await accountService.deleteAccounts(accountIds);
            await Promise.all([
                get().fetchAccounts(),
                get().fetchCurrentAccount()
            ]);
            set({ loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },


    switchAccount: async (accountId: string) => {
        set({ loading: true, error: null });
        try {
            await accountService.switchAccount(accountId);
            await get().fetchAccounts();
            set({ loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    refreshQuota: async (accountId: string) => {
        set({ loading: true, error: null });
        try {
            console.log(`[Store] Refreshing quota for: ${accountId}`);
            const quota = await accountService.fetchAccountQuota(accountId);

            if (quota && !quota.error) {
                // Update specific account in state
                const currentAccounts = get().accounts;
                const updatedAccounts = currentAccounts.map(acc =>
                    acc.id === accountId ? { ...acc, quota } : acc
                );
                set({ accounts: updatedAccounts });

                // Update LocalStorage cache
                const localCacheText = localStorage.getItem('ZG_QUOTA_CACHE');
                const localCache = localCacheText ? JSON.parse(localCacheText) : {};
                localCache[accountId] = {
                    quota,
                    timestamp: Date.now()
                };
                localStorage.setItem('ZG_QUOTA_CACHE', JSON.stringify(localCache));
                set({ lastQuotaRefreshTS: Date.now() });
                console.log(`[Store] Quota refreshed and cached for: ${accountId}`);
            } else {
                console.error(`[Store] Failed to refresh quota for ${accountId}:`, quota?.error);
                throw new Error(quota?.error || 'Unknown error fetching quota');
            }

            set({ loading: false });
        } catch (error) {
            console.error(`[Store] refreshQuota failed for ${accountId}:`, error);
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    refreshAllQuotas: async () => {
        set({ loading: true, error: null });
        try {
            console.log('[Store] Starting manual refresh of all quotas...');
            const stats = await accountService.refreshAllQuotas();

            // After bulk refresh, we should re-fetch accounts to pick up the changes
            // However, refreshAllQuotas in service doesn't persist to cache.
            // Let's rely on refreshAllQuotasBackground or update fetchAccounts to be smarter.
            // Actually, for now, let's just trigger fetchAccounts which will at least 
            // reload from whatever state we have.

            set({ lastQuotaRefreshTS: Date.now() });
            localStorage.setItem('ZG_QUOTA_TS', Date.now().toString());

            await get().fetchAccounts();
            set({ loading: false });
            return stats;
        } catch (error) {
            console.error('[Store] refreshAllQuotas failed:', error);
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    /**
     * 重新排序账号列表
     * 采用乐观更新策略：先更新本地状态再调用后端持久化，以提供流畅的拖拽体验
     */
    reorderAccounts: async (accountIds: string[]) => {
        const { accounts } = get();

        // 创建 ID 到账号的映射
        const accountMap = new Map(accounts.map(acc => [acc.id, acc]));

        // 按新顺序重建账号数组
        const reorderedAccounts = accountIds
            .map(id => accountMap.get(id))
            .filter((acc): acc is Account => acc !== undefined);

        // 添加未在新顺序中的账号（保持原有顺序）
        const remainingAccounts = accounts.filter(acc => !accountIds.includes(acc.id));
        const finalAccounts = [...reorderedAccounts, ...remainingAccounts];

        // 乐观更新本地状态
        set({ accounts: finalAccounts });

        try {
            await accountService.reorderAccounts(accountIds);
        } catch (error) {
            // 后端失败时回滚到原始顺序
            console.error('[AccountStore] Reorder accounts failed:', error);
            set({ accounts });
            throw error;
        }
    },

    startOAuthLogin: async () => {
        set({ loading: true, error: null });
        try {
            await accountService.startOAuthLogin();
            await get().fetchAccounts();
            set({ loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    completeOAuthLogin: async () => {
        set({ loading: true, error: null });
        try {
            await accountService.completeOAuthLogin();
            await get().fetchAccounts();
            set({ loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    cancelOAuthLogin: async () => {
        try {
            await accountService.cancelOAuthLogin();
            set({ loading: false, error: null });
        } catch (error) {
            console.error('[Store] Cancel OAuth failed:', error);
        }
    },

    importV1Accounts: async () => {
        set({ loading: true, error: null });
        try {
            await accountService.importV1Accounts();
            await get().fetchAccounts();
            set({ loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    importFromDb: async () => {
        set({ loading: true, error: null });
        try {
            await accountService.importFromDb();
            await Promise.all([
                get().fetchAccounts(),
                get().fetchCurrentAccount()
            ]);
            set({ loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    importFromCustomDb: async (path: string) => {
        set({ loading: true, error: null });
        try {
            await accountService.importFromCustomDb(path);
            await Promise.all([
                get().fetchAccounts(),
                get().fetchCurrentAccount()
            ]);
            set({ loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    syncAccountFromDb: async () => {
        try {
            const syncedAccount = await accountService.syncAccountFromDb();
            if (syncedAccount) {
                console.log('[AccountStore] Account synced from DB:', syncedAccount.email);
                await get().fetchAccounts();
                set({ currentAccount: syncedAccount });
            }
        } catch (error) {
            console.error('[AccountStore] Sync from DB failed:', error);
        }
    },

    toggleProxyStatus: async (accountId: string, enable: boolean, reason?: string) => {
        try {
            await accountService.toggleProxyStatus(accountId, enable, reason);
            await get().fetchAccounts();
        } catch (error) {
            console.error('[AccountStore] Toggle proxy status failed:', error);
            throw error;
        }
    },

    warmUpAccounts: async () => {
        set({ loading: true, error: null });
        try {
            const result = await accountService.warmUpAllAccounts();
            await get().fetchAccounts();
            set({ loading: false });
            return result;
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    warmUpAccount: async (accountId: string) => {
        set({ loading: true, error: null });
        try {
            const result = await accountService.warmUpAccount(accountId);
            await get().fetchAccounts();
            set({ loading: false });
            return result;
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    updateAccountLabel: async (accountId: string, label: string) => {
        try {
            await accountService.updateAccountLabel(accountId, label);
            // 乐观更新本地状态
            const { accounts } = get();
            const updatedAccounts = accounts.map(acc =>
                acc.id === accountId ? { ...acc, custom_label: label || undefined } : acc
            );
            set({ accounts: updatedAccounts });
        } catch (error) {
            console.error('[AccountStore] Update label failed:', error);
            throw error;
        }
    },

    refreshAllQuotasBackground: async () => {
        const accounts = get().accounts;
        if (!accounts || accounts.length === 0) return;

        // Prevent multiple concurrent syncs by immediately updating TS
        set({ lastQuotaRefreshTS: Date.now() });
        console.log(`[Store] Starting background quota fetch for ${accounts.length} accounts...`);
        // Use Promise.all to fetch concurrently!
        await Promise.all(accounts.map(async (acc) => {
            try {
                const quotaInfo = await accountService.fetchAccountQuota(acc.email);
                if (quotaInfo && !quotaInfo.error) {
                    const quota = {
                        is_forbidden: false,
                        subscription_tier: quotaInfo?.plan?.tier_name || 'Free',
                        last_updated: Math.floor(Date.now() / 1000),
                        models: (quotaInfo?.models || []).map((m: any) => {
                            const internalName = accountService.ZG_MODEL_MAP[m.model_id] || m.label?.toLowerCase().replace(/ /g, '-') || m.model_id;
                            return {
                                name: internalName,
                                percentage: m.remaining_pct ?? 0,
                                reset_time: m.reset_time || ''
                            };
                        })
                    };

                    const currentAccounts = get().accounts;
                    const updated = currentAccounts.map(a =>
                        a.id === acc.id ? { ...a, quotaInfo, quota } : a
                    );
                    set({ accounts: updated });

                    // Update LocalStorage cache
                    const localCacheText = localStorage.getItem('ZG_QUOTA_CACHE');
                    const localCache = localCacheText ? JSON.parse(localCacheText) : {};
                    localCache[acc.id] = { quota, quotaInfo };
                    localStorage.setItem('ZG_QUOTA_CACHE', JSON.stringify(localCache));
                    localStorage.setItem('ZG_QUOTA_TS', Date.now().toString());
                }
            } catch (error) {
                console.error(`[Store] Background quota fetch failed for ${acc.email} - ${error}`);
            }
        }));
    },

    checkIDEActiveEmail: async () => {
        const email = await accountService.getIDEActiveEmail();
        set({ ideActiveEmail: email });
    },

    applyToIDE: async (accountId: string) => {
        set({ loading: true, error: null });
        try {
            console.log(`[Store] Applying account to IDE: ${accountId}`);
            const accounts = get().accounts;
            const acc = accounts.find(a => a.id === accountId);

            if (!acc || !acc.token) {
                throw new Error("Account or token not found");
            }

            await accountService.switchIDEAccount(
                acc.email,
                acc.token.access_token,
                acc.token.refresh_token,
                acc.token.expiry_timestamp
            );

            set({ ideActiveEmail: acc.email });
            set({ loading: false });
        } catch (error) {
            console.error('[Store] applyToIDE failed:', error);
            set({ error: String(error), loading: false });
            throw error;
        }
    },
}));
