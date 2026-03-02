import { useMemo, useState } from 'react';
import { ArrowRightLeft, RefreshCw, Trash2, Copy, Info, Lock, Ban, Diamond, Gem, Circle, Fingerprint, Tag, X, Check, MonitorSmartphone } from 'lucide-react';
import { Account } from '../../types/account';
import { cn } from '../../utils/cn';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '../../stores/useConfigStore';
import { QuotaItem } from './QuotaItem';
import { MODEL_CONFIG, sortModels } from '../../config/modelConfig';

interface AccountCardProps {
    account: Account;
    selected: boolean;
    onSelect: () => void;
    isCurrent: boolean;
    isRefreshing: boolean;
    isSwitching?: boolean;
    onSwitch: () => void;
    onRefresh: () => void;
    onViewDevice: () => void;
    onViewDetails: () => void;
    onCopyToken: () => void;
    onDelete: () => void;
    onUpdateLabel?: (label: string) => void;
    onViewError: () => void;
    isIDECurrent?: boolean;
    onApplyToIDE?: () => void;
}

// 使用统一的模型配置
const DEFAULT_MODELS = Object.entries(MODEL_CONFIG).map(([id, config]) => ({
    id,
    label: config.label,
    protectedKey: config.protectedKey,
    Icon: config.Icon
}));

function AccountCard({ account, selected, onSelect, isCurrent: propIsCurrent, isRefreshing, isSwitching = false, onSwitch, onRefresh, onViewDetails, onCopyToken, onDelete, onViewDevice, onUpdateLabel, onViewError, isIDECurrent = false, onApplyToIDE }: AccountCardProps) {
    const { t } = useTranslation();
    const { config, showAllQuotas } = useConfigStore();
    const isDisabled = Boolean(account.disabled);

    // 自定义标签编辑状态
    const [isEditingLabel, setIsEditingLabel] = useState(false);
    const [labelInput, setLabelInput] = useState(account.custom_label || '');

    // Use the prop directly from parent component
    const isCurrent = propIsCurrent;

    const handleSaveLabel = () => {
        if (onUpdateLabel) {
            onUpdateLabel(labelInput.trim());
        }
        setIsEditingLabel(false);
    };

    const handleCancelLabel = () => {
        setLabelInput(account.custom_label || '');
        setIsEditingLabel(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSaveLabel();
        } else if (e.key === 'Escape') {
            handleCancelLabel();
        }
    };

    const displayModels = useMemo(() => {
        // Build map of friendly labels and icons from DEFAULT_MODELS
        const iconMap = new Map(DEFAULT_MODELS.map(m => [m.id, m.Icon]));

        // Get all models from account (source of truth)
        const accountModels = account.quota?.models?.map(m => {
            const safeName = m.name || m.model_id || m.label || '';
            const fullConfig = MODEL_CONFIG[safeName.toLowerCase()];
            return {
                id: safeName,
                label: fullConfig?.shortLabel || fullConfig?.label || safeName,
                protectedKey: fullConfig?.protectedKey,
                Icon: iconMap.get(safeName),
                data: m
            };
        }) || [];

        let models: typeof accountModels;

        if (showAllQuotas) {
            models = accountModels;
        } else {
            // Filter for pinned or defaults
            const pinned = config?.pinned_quota_models?.models;
            if (pinned && pinned.length > 0) {
                models = accountModels.filter(m => pinned.includes(m.id));
            } else {
                // Default fallback: show known default models
                models = accountModels.filter(m => DEFAULT_MODELS.some(d => d.id === m.id));
            }
        }

        // 应用排序并过滤过期模型
        return sortModels(models).filter(m => m.id !== 'claude-sonnet-4-5-thinking' && m.id !== 'claude-opus-4-5-thinking');
    }, [config, account, showAllQuotas]);

    const isModelProtected = (key?: string) => {
        if (!key) return false;
        return account.protected_models?.includes(key);
    };

    return (
        <div className={cn(
            "flex flex-col p-2.5 rounded-xl border transition-all hover:shadow-md relative",
            isCurrent
                ? "bg-blue-50/30 border-blue-200 dark:bg-blue-900/10 dark:border-blue-900/30"
                : "bg-white dark:bg-base-100 border-gray-200 dark:border-base-300",
            (isRefreshing || isDisabled) && "opacity-70"
        )}>

            {/* Header: Checkbox + Email + Badges */}
            <div className="flex-none flex items-start gap-2 mb-1.5">
                <input
                    type="checkbox"
                    className="mt-1 checkbox checkbox-xs rounded border-2 border-gray-400 dark:border-gray-500 checked:border-blue-600 checked:bg-blue-600 [--chkbg:theme(colors.blue.600)] [--chkfg:white]"
                    checked={selected}
                    onChange={() => onSelect()}
                    onClick={(e) => e.stopPropagation()}
                />
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <h3 className={cn(
                        "font-semibold text-xs truncate w-full",
                        isCurrent ? "text-blue-700 dark:text-blue-400" : "text-gray-900 dark:text-base-content"
                    )} title={account.email}>
                        {account.email}
                    </h3>
                    <div className="flex items-center justify-between w-full gap-1.5">
                        <div className="flex items-center gap-1 flex-wrap">
                            {isCurrent && (
                                <span className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[8px] font-bold">
                                    {t('accounts.current').toUpperCase()}
                                </span>
                            )}
                            {isIDECurrent && (
                                <span className="px-1 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[8px] font-bold flex items-center gap-0.5">
                                    <MonitorSmartphone className="w-2 h-2" />
                                    IDE 当前
                                </span>
                            )}
                            {isDisabled && (
                                <span className="px-1 py-0.5 rounded bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[8px] font-bold flex items-center gap-0.5">
                                    <Ban className="w-2 h-2" />
                                    {t('accounts.disabled').toUpperCase()}
                                </span>
                            )}
                            {account.proxy_disabled && (
                                <span className="px-1 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 text-[8px] font-bold flex items-center gap-0.5">
                                    <Ban className="w-2 h-2" />
                                    PROXY OFF
                                </span>
                            )}
                            {account.quota?.is_forbidden && (
                                <span className="px-1 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-[8px] font-bold flex items-center gap-0.5">
                                    <Lock className="w-2 h-2" />
                                    {t('accounts.forbidden').toUpperCase()}
                                </span>
                            )}
                            {/* 订阅类型徽章 */}
                            {account.quota?.subscription_tier && (() => {
                                const tier = account.quota.subscription_tier.toLowerCase();
                                if (tier.includes('ultra')) {
                                    return (
                                        <span className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-gradient-to-r from-purple-600 to-pink-600 text-white text-[8px] font-bold">
                                            <Gem className="w-2 h-2 fill-current" />
                                            ULTRA
                                        </span>
                                    );
                                } else if (tier.includes('pro')) {
                                    return (
                                        <span className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[8px] font-bold">
                                            <Diamond className="w-2 h-2 fill-current" />
                                            PRO
                                        </span>
                                    );
                                } else {
                                    return (
                                        <span className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 text-[8px] font-bold">
                                            <Circle className="w-2 h-2" />
                                            FREE
                                        </span>
                                    );
                                }
                            })()}
                            {/* 自定义标签 */}
                            {account.custom_label && (
                                <span className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 text-[8px] font-bold">
                                    <Tag className="w-2 h-2" />
                                    {account.custom_label}
                                </span>
                            )}
                        </div>
                        <span className="text-[9px] text-gray-400 dark:text-gray-500 font-mono shrink-0 whitespace-nowrap">
                            {new Date(account.last_used * 1000).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                </div>
            </div>


            {/* 配额展示 */}
            <div className="flex-1 px-1 mb-1.5 overflow-y-auto scrollbar-none">
                {isDisabled || account.quota?.is_forbidden || account.proxy_disabled ? (
                    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 h-full py-3 text-center">
                        <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
                            {isDisabled || account.proxy_disabled ? <Ban className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                            <span className="text-[10px] font-bold">
                                {isDisabled ? t('accounts.status.disabled') : account.proxy_disabled ? t('accounts.status.proxy_disabled') : t('accounts.forbidden_msg')}
                            </span>
                        </div>
                        <button
                            onClick={(e) => { e.stopPropagation(); onViewError(); }}
                            className="text-[9px] text-blue-600 dark:text-blue-400 hover:underline font-medium"
                        >
                            {t('accounts.view_error')}
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-1.5 content-start">
                        {displayModels.map((model) => (
                            <QuotaItem
                                key={model.id}
                                label={model.label}
                                percentage={model.data?.percentage || 0}
                                resetTime={model.data?.reset_time}
                                isProtected={isModelProtected(model.protectedKey)}
                                Icon={model.Icon}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Footer: Actions */}
            <div className="flex-none flex items-center justify-center pt-1.5 border-t border-gray-100 dark:border-base-200">
                {/* 标签编辑弹出框 */}
                {isEditingLabel && (
                    <div className="absolute inset-0 bg-white/95 dark:bg-base-100/95 rounded-xl z-10 flex items-center justify-center p-3">
                        <div className="flex items-center gap-2 w-full max-w-xs">
                            <input
                                type="text"
                                className="flex-1 px-2 py-1 text-xs border border-orange-300 dark:border-orange-700 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white dark:bg-base-200"
                                placeholder={t('accounts.custom_label_placeholder', 'Enter custom label')}
                                value={labelInput}
                                onChange={(e) => setLabelInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                autoFocus
                                maxLength={15}
                            />
                            <button
                                className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-md transition-all"
                                onClick={handleSaveLabel}
                                title={t('common.save', 'Save')}
                            >
                                <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                                className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-all"
                                onClick={handleCancelLabel}
                                title={t('common.cancel', 'Cancel')}
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                )}
                <div className="flex items-center justify-center gap-0.5 w-full">
                    <button
                        className="p-1 text-gray-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/30 rounded-md transition-all"
                        onClick={(e) => { e.stopPropagation(); onViewDetails(); }}
                        title={t('common.details')}
                    >
                        <Info className="w-3 h-3" />
                    </button>
                    <button
                        className="p-1 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-md transition-all"
                        onClick={(e) => { e.stopPropagation(); onViewDevice(); }}
                        title={t('accounts.device_fingerprint')}
                    >
                        <Fingerprint className="w-3 h-3" />
                    </button>
                    {/* 自定义标签按钮 */}
                    {onUpdateLabel && (
                        <button
                            className={cn(
                                "p-1 rounded-md transition-all",
                                account.custom_label
                                    ? "text-orange-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/30"
                                    : "text-gray-400 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/30"
                            )}
                            onClick={(e) => { e.stopPropagation(); setIsEditingLabel(true); }}
                            title={t('accounts.edit_label', 'Edit Label')}
                        >
                            <Tag className="w-3 h-3" />
                        </button>
                    )}
                    <button
                        className={`p-1 rounded-md transition-all ${(isSwitching || isDisabled) ? 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/10 cursor-not-allowed' : 'text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30'}`}
                        onClick={(e) => { e.stopPropagation(); onSwitch(); }}
                        title={isDisabled ? t('accounts.disabled_tooltip') : (isSwitching ? t('common.loading') : t('common.switch'))}
                        disabled={isSwitching || isDisabled}
                    >
                        <ArrowRightLeft className={`w-3 h-3 ${isSwitching ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        className={`p-1 rounded-md transition-all ${isRefreshing
                            ? 'text-green-600 bg-green-50'
                            : 'text-gray-400 hover:text-green-600 hover:bg-green-50'}`}
                        onClick={(e) => { e.stopPropagation(); onRefresh(); }}
                        disabled={isRefreshing || isDisabled}
                        title={isDisabled ? t('accounts.disabled_tooltip') : t('common.refresh')}
                    >
                        <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-md transition-all"
                        onClick={(e) => { e.stopPropagation(); onCopyToken(); }}
                        title="复制 Refresh Token"
                    >
                        <Copy className="w-3 h-3" />
                    </button>
                    <button
                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all"
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        title={t('common.delete')}
                    >
                        <Trash2 className="w-3 h-3" />
                    </button>
                    {onApplyToIDE && (
                        <button
                            className={cn(
                                "ml-auto p-1 rounded-md transition-all",
                                isIDECurrent
                                    ? "text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/20"
                                    : "text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:text-emerald-400 dark:hover:bg-emerald-900/20"
                            )}
                            onClick={(e) => { e.stopPropagation(); onApplyToIDE(); }}
                            title="移动至 IDE (覆盖配置)"
                        >
                            <MonitorSmartphone className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>
        </div >
    );
}

export default AccountCard;
