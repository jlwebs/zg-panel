import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Database, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useAccountStore } from '../../stores/useAccountStore';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import { request as invoke } from '../../utils/request';
import { isTauri } from '../../utils/env';

interface AddAccountDialogProps {
    onAdd: (email: string, refreshToken: string) => Promise<void>;
    showText?: boolean;
}

type Status = 'idle' | 'loading' | 'success' | 'error';

function AddAccountDialog({ onAdd, showText = true }: AddAccountDialogProps) {
    const { t } = useTranslation();
    const fetchAccounts = useAccountStore(state => state.fetchAccounts);
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'extract' | 'token' | 'import'>('import');
    const [refreshToken, setRefreshToken] = useState('');

    // ZG Extract State
    const [extractOutput, setExtractOutput] = useState('');
    const [extractRunning, setExtractRunning] = useState(false);

    // Import State
    const [importOutput, setImportOutput] = useState('');

    // UI State
    const [status, setStatus] = useState<Status>('idle');
    const [message, setMessage] = useState('');

    const statusRef = useRef(status);

    useEffect(() => {
        statusRef.current = status;
    }, [status]);

    // Reset state when dialog opens or tab changes
    useEffect(() => {
        if (isOpen) {
            resetState();
        }
    }, [isOpen, activeTab]);

    const resetState = () => {
        setStatus('idle');
        setMessage('');
        setRefreshToken('');
        setExtractOutput('');
        setImportOutput('');
    };

    // ─── Refresh Token Submit ───
    const handleSubmit = async () => {
        if (!refreshToken) {
            setStatus('error');
            setMessage(t('accounts.add.token.error_token'));
            return;
        }

        setStatus('loading');

        // 1. Parse input
        let items: { email: string, token: string }[] = [];
        const input = refreshToken.trim();

        try {
            // Try JSON array
            if (input.startsWith('[') && input.endsWith(']')) {
                const parsed = JSON.parse(input);
                if (Array.isArray(parsed)) {
                    items = parsed
                        .filter((item: any) => typeof item.refresh_token === 'string' && item.refresh_token.startsWith('1//'))
                        .map((item: any) => ({
                            email: item.email || `imported_${Math.random().toString(36).substring(7)}@gmail.com`,
                            token: item.refresh_token
                        }));
                }
            }
        } catch (e) {
            console.debug('JSON parse failed, falling back to regex', e);
        }

        // 2. Fallback to regex
        if (items.length === 0) {
            const regex = /1\/\/[a-zA-Z0-9_\-]+/g;
            const matches = input.match(regex);
            if (matches) {
                items = [...new Set(matches)].map(t => ({
                    email: `imported_${Math.random().toString(36).substring(7)}@gmail.com`,
                    token: t
                }));
            }
        }

        if (items.length === 0) {
            setStatus('error');
            setMessage(t('accounts.add.token.error_token'));
            return;
        }

        // 3. Batch add
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < items.length; i++) {
            const currentItem = items[i];
            setMessage(t('accounts.add.token.batch_progress', { current: i + 1, total: items.length }));

            try {
                await onAdd(currentItem.email, currentItem.token);
                successCount++;
            } catch (error) {
                console.error(`Failed to add token ${i + 1}:`, error);
                failCount++;
            }
            await new Promise(r => setTimeout(r, 100));
        }

        // 4. Result feedback
        if (successCount === items.length) {
            setStatus('success');
            setMessage(t('accounts.add.token.batch_success', { count: successCount }));
            setTimeout(() => {
                setIsOpen(false);
                resetState();
            }, 1500);
        } else if (successCount > 0) {
            setStatus('success');
            setMessage(t('accounts.add.token.batch_partial', { success: successCount, fail: failCount }));
        } else {
            setStatus('error');
            setMessage(t('accounts.add.token.batch_fail'));
        }
    };

    // ─── Import from IDE (Option A) ───
    // Strip ANSI escape codes from shell output
    const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\[\d+;?\d*m/g, '');

    const handleImportDb = async () => {
        setStatus('loading');
        setMessage(t('accounts.add.import.status.extracting'));
        setImportOutput('');
        try {
            const resultStr = await invoke<string>('import_from_ide', { customDbPath: null });
            const result = JSON.parse(resultStr);
            setImportOutput(`DB: ${result.db_path}\nEmail: ${result.email}\nName: ${result.name}\nToken: ${result.refresh_token.substring(0, 30)}...`);

            const token = result.refresh_token;
            const email = result.email || '';
            const name = result.name || '';
            const display = email || name || token.substring(0, 20) + '...';
            setMessage(t('accounts.add.import.status.add_progress', { display }) || `Extracted (${display}), adding via API...`);
            try {
                await onAdd(email, token);
                setStatus('success');
                setMessage(t('accounts.add.import.status.success', { display }));
                await fetchAccounts();
                setTimeout(() => {
                    setIsOpen(false);
                    resetState();
                }, 2000);
            } catch (addErr) {
                setStatus('error');
                setMessage(t('accounts.add.import.status.add_fail', { error: String(addErr) }));
            }
        } catch (e) {
            setImportOutput(String(e));
            setStatus('error');
            const errStr = String(e);
            if (errStr.includes('not found')) {
                setMessage(t('accounts.add.import.status.not_found'));
            } else if (errStr.includes('No OAuth')) {
                setMessage(t('accounts.add.import.status.no_oauth'));
            } else {
                setMessage(t('accounts.add.import.status.fail', { error: errStr }));
            }
        }
    };

    const handleImportCustomDb = async () => {
        try {
            if (!isTauri()) {
                alert(t('common.tauri_api_not_loaded') || 'Storage import only works in desktop app.');
                return;
            }
            const selected = await open({
                multiple: false,
                filters: [{
                    name: 'VSCode DB',
                    extensions: ['vscdb']
                }, {
                    name: 'All Files',
                    extensions: ['*']
                }]
            });

            if (selected && typeof selected === 'string') {
                setStatus('loading');
                setMessage(t('accounts.add.import.status.importing', { name: selected.split('/').pop() }));
                setImportOutput('');
                try {
                    const resultStr = await invoke<string>('import_from_ide', { customDbPath: selected });
                    const result = JSON.parse(resultStr);
                    setImportOutput(`DB: ${result.db_path}\nEmail: ${result.email}\nName: ${result.name}\nToken: ${result.refresh_token.substring(0, 30)}...`);

                    const token = result.refresh_token;
                    const email = result.email || '';
                    const name = result.name || '';
                    const display = email || name || token.substring(0, 20) + '...';
                    setMessage(t('accounts.add.import.status.add_progress', { display }) || `Extracted (${display}), adding via API...`);
                    await onAdd(email, token);
                    setStatus('success');
                    setMessage(t('accounts.add.import.status.success', { display }));
                    await fetchAccounts();
                    setTimeout(() => {
                        setIsOpen(false);
                        resetState();
                    }, 2000);
                } catch (e) {
                    setImportOutput(String(e));
                    setStatus('error');
                    setMessage(t('accounts.add.import.status.fail', { error: String(e) }));
                }
            }
        } catch (err) {
            console.error('Failed to open dialog:', err);
        }
    };

    // Status component
    const StatusAlert = () => {
        if (status === 'idle' || !message) return null;

        const styles = {
            loading: 'alert-info',
            success: 'alert-success',
            error: 'alert-error'
        };

        const icons = {
            loading: <Loader2 className="w-5 h-5 animate-spin" />,
            success: <CheckCircle2 className="w-5 h-5" />,
            error: <XCircle className="w-5 h-5" />
        };

        return (
            <div className={`alert ${styles[status]} mb-4 text-sm py-2 shadow-sm`}>
                {icons[status]}
                <span>{message}</span>
            </div>
        );
    };

    return (
        <>
            <button
                className="px-2.5 lg:px-4 py-2 bg-white dark:bg-base-100 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-base-200 transition-colors flex items-center gap-2 shadow-sm border border-gray-200/50 dark:border-base-300 relative z-[100]"
                onClick={() => {
                    console.log('AddAccountDialog button clicked');
                    setIsOpen(true);
                }}
                title={!showText ? t('accounts.add_account') : undefined}
            >
                <Plus className="w-4 h-4" />
                {showText && <span className="hidden lg:inline">{t('accounts.add_account')}</span>}
            </button>

            {isOpen && createPortal(
                <div
                    className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
                >
                    {/* Draggable Top Region */}
                    <div data-tauri-drag-region className="fixed top-0 left-0 right-0 h-8 z-[1]" />

                    {/* Click outside to close */}
                    <div className="absolute inset-0 z-[0]" onClick={() => setIsOpen(false)} />

                    <div className="bg-white dark:bg-base-100 text-gray-900 dark:text-base-content rounded-2xl shadow-2xl w-full max-w-lg p-6 relative z-[10] m-4 max-h-[90vh] overflow-y-auto">
                        <h3 className="font-bold text-lg mb-4">{t('accounts.add.title')}</h3>

                        {/* Tab Navigation — 3 tabs: 从IDE导入 | ZG Extract | Refresh Token */}
                        <div className="bg-gray-100 dark:bg-base-200 p-1 rounded-xl mb-6 grid grid-cols-3 gap-1">
                            <button
                                className={`py-2 px-3 rounded-lg text-sm font-medium transition-all duration-200 ${activeTab === 'import'
                                    ? 'bg-white dark:bg-base-100 shadow-sm text-blue-600 dark:text-blue-400'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-base-300'
                                    } `}
                                onClick={() => setActiveTab('import')}
                            >
                                {t('accounts.add.tabs.import')}
                            </button>
                            <button
                                className={`py-2 px-3 rounded-lg text-sm font-medium transition-all duration-200 ${activeTab === 'extract'
                                    ? 'bg-white dark:bg-base-100 shadow-sm text-emerald-600 dark:text-emerald-400'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-base-300'
                                    } `}
                                onClick={() => setActiveTab('extract')}
                            >
                                {t('accounts.add.tabs.extract')}
                            </button>
                            <button
                                className={`py-2 px-3 rounded-lg text-sm font-medium transition-all duration-200 ${activeTab === 'token'
                                    ? 'bg-white dark:bg-base-100 shadow-sm text-blue-600 dark:text-blue-400'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-base-300'
                                    } `}
                                onClick={() => setActiveTab('token')}
                            >
                                {t('accounts.add.tabs.token')}
                            </button>
                        </div>

                        {/* Status Alert */}
                        <StatusAlert />

                        <div className="min-h-[200px]">
                            {/* ZG Extract — Cookie 提取 */}
                            {activeTab === 'extract' && (
                                <div className="space-y-4 py-2">
                                    <div className="text-center space-y-2 mb-4">
                                        <div className="text-3xl">🔑</div>
                                        <h4 className="font-medium text-gray-900 dark:text-gray-100">{t('accounts.add.extract.title')}</h4>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
                                            {t('accounts.add.extract.desc')}
                                        </p>
                                    </div>

                                    <div className="space-y-2">
                                        {[
                                            { label: t('accounts.add.extract.browsers.chrome_label'), browser: 'chrome', desc: t('accounts.add.extract.browsers.chrome_desc') },
                                            { label: t('accounts.add.extract.browsers.firefox_label'), browser: 'firefox', desc: t('accounts.add.extract.browsers.firefox_desc') },
                                            { label: t('accounts.add.extract.browsers.edge_label'), browser: 'edge', desc: t('accounts.add.extract.browsers.edge_desc') },
                                        ].map((item) => (
                                            <button
                                                key={item.browser}
                                                className="w-full px-4 py-3 bg-gray-50 dark:bg-base-200 text-gray-700 dark:text-gray-300 font-medium rounded-xl border border-gray-200 dark:border-base-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:border-emerald-300 dark:hover:border-emerald-700 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                                                onClick={async () => {
                                                    setExtractRunning(true);
                                                    setExtractOutput('');
                                                    setStatus('loading');
                                                    setMessage(t('accounts.add.extract.status.extracting', { browser: item.label }));
                                                    try {
                                                        const result = await invoke<string>('run_shell_command', {
                                                            command: `docker exec zerogravity zg extract --browser ${item.browser} 2>&1`
                                                        });
                                                        const clean = stripAnsi(result);
                                                        setExtractOutput(clean);

                                                        // Parse output for refresh token(s) and email(s)
                                                        const tokenMatches = clean.match(/(?:Refresh token|refresh_token):\s*(1\/\/[a-zA-Z0-9_\-\.]+)/gi);
                                                        const emailMatches = clean.match(/account:\s*([^\s\n]+@[^\s\n]+)/gi);

                                                        if (tokenMatches && tokenMatches.length > 0) {
                                                            let successCount = 0;
                                                            let failCount = 0;
                                                            for (let i = 0; i < tokenMatches.length; i++) {
                                                                const tokenPart = tokenMatches[i].match(/1\/\/[a-zA-Z0-9_\-\.]+/);
                                                                if (!tokenPart) continue;
                                                                const token = tokenPart[0];
                                                                const emailPart = emailMatches && emailMatches[i]
                                                                    ? emailMatches[i].match(/@/)
                                                                        ? emailMatches[i].replace(/^account:\s*/i, '')
                                                                        : ''
                                                                    : '';
                                                                setMessage(t('accounts.add.extract.status.adding', { current: i + 1, total: tokenMatches.length }));
                                                                try {
                                                                    await onAdd(emailPart, token);
                                                                    successCount++;
                                                                } catch {
                                                                    failCount++;
                                                                }
                                                            }
                                                            if (successCount > 0) {
                                                                setStatus('success');
                                                                const failStr = failCount > 0 ? t('accounts.add.extract.status.fail_count', { count: failCount }) : '';
                                                                setMessage(t('accounts.add.extract.status.success', { success: successCount, fail: failStr }));
                                                                await fetchAccounts();
                                                                setTimeout(() => {
                                                                    setIsOpen(false);
                                                                    resetState();
                                                                    setExtractOutput('');
                                                                }, 2000);
                                                            } else {
                                                                setStatus('error');
                                                                setMessage(t('accounts.add.extract.status.token_fail'));
                                                            }
                                                        } else {
                                                            // Fallback: try to find any 1// token in output
                                                            const fallback = clean.match(/1\/\/[a-zA-Z0-9_\-\.]{10,}/g);
                                                            if (fallback && fallback.length > 0) {
                                                                setMessage(t('accounts.add.extract.status.adding', { current: 1, total: 1 }));
                                                                try {
                                                                    await onAdd('', fallback[0]);
                                                                    setStatus('success');
                                                                    setMessage(t('accounts.add.extract.status.success', { success: 1, fail: '' }));
                                                                    await fetchAccounts();
                                                                    setTimeout(() => {
                                                                        setIsOpen(false);
                                                                        resetState();
                                                                        setExtractOutput('');
                                                                    }, 2000);
                                                                } catch (addErr) {
                                                                    setStatus('error');
                                                                    setMessage(t('accounts.add.extract.status.token_fail') + ': ' + addErr);
                                                                }
                                                            } else {
                                                                setStatus('error');
                                                                setMessage(t('accounts.add.extract.status.no_token', { browser: item.label }));
                                                            }
                                                        }
                                                    } catch (e) {
                                                        setExtractOutput(stripAnsi(String(e)));
                                                        setStatus('error');
                                                        setMessage(t('accounts.add.extract.status.fail', { error: stripAnsi(String(e)) }));
                                                    } finally {
                                                        setExtractRunning(false);
                                                    }
                                                }}
                                                disabled={extractRunning}
                                            >
                                                <div className="text-left">
                                                    <div className="text-sm">{item.label}</div>
                                                    <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{item.desc}</div>
                                                </div>
                                                {extractRunning ? (
                                                    <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                                                ) : (
                                                    <span className="text-[10px] text-gray-400">→</span>
                                                )}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Extract Output */}
                                    {extractOutput && (
                                        <div className="bg-[#0d1117] rounded-lg p-3 max-h-[120px] overflow-y-auto">
                                            <pre className="text-[10px] font-mono text-white/60 whitespace-pre-wrap">{extractOutput}</pre>
                                        </div>
                                    )}

                                    <div className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-base-200 rounded-lg p-2 border border-gray-100 dark:border-base-300">
                                        {t('accounts.add.extract.hint')}
                                    </div>
                                </div>
                            )}

                            {/* Refresh Token */}
                            {activeTab === 'token' && (
                                <div className="space-y-4 py-2">
                                    <div className="bg-gray-50 dark:bg-base-200 p-4 rounded-lg border border-gray-200 dark:border-base-300">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('accounts.add.token.label')}</span>
                                        </div>
                                        <textarea
                                            className="textarea textarea-bordered w-full h-32 font-mono text-xs leading-relaxed focus:outline-none focus:border-blue-500 transition-colors bg-white dark:bg-base-100 text-gray-900 dark:text-base-content border-gray-300 dark:border-base-300 placeholder:text-gray-400"
                                            placeholder={t('accounts.add.token.placeholder')}
                                            value={refreshToken}
                                            onChange={(e) => setRefreshToken(e.target.value)}
                                            disabled={status === 'loading' || status === 'success'}
                                        />
                                        <p className="text-[10px] text-gray-400 mt-2">
                                            {t('accounts.add.token.hint')}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Import from IDE */}
                            {activeTab === 'import' && (
                                <div className="space-y-4 py-2">
                                    <div className="text-center space-y-2 mb-4">
                                        <div className="text-3xl">💾</div>
                                        <h4 className="font-medium text-gray-900 dark:text-gray-100">{t('accounts.add.import.title')}</h4>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
                                            {t('accounts.add.import.desc')}
                                        </p>
                                    </div>

                                    <button
                                        className="w-full px-4 py-3 bg-gray-50 dark:bg-base-200 text-gray-700 dark:text-gray-300 font-medium rounded-xl border border-gray-200 dark:border-base-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-800 hover:text-blue-600 dark:hover:text-blue-400 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed mb-2 shadow-sm"
                                        onClick={handleImportDb}
                                        disabled={status === 'loading' || status === 'success'}
                                    >
                                        <Database className="w-4 h-4" />
                                        {t('accounts.add.import.btn_current')}
                                    </button>

                                    <button
                                        className="w-full px-4 py-3 bg-gray-50 dark:bg-base-200 text-gray-700 dark:text-gray-300 font-medium rounded-xl border border-gray-200 dark:border-base-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-200 dark:hover:border-indigo-800 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                                        onClick={handleImportCustomDb}
                                        disabled={status === 'loading' || status === 'success'}
                                    >
                                        <Database className="w-4 h-4" />
                                        {t('accounts.add.import.btn_custom')}
                                    </button>

                                    {/* Import Output */}
                                    {importOutput && (
                                        <div className="bg-[#0d1117] rounded-lg p-3 max-h-[120px] overflow-y-auto">
                                            <pre className="text-[10px] font-mono text-white/60 whitespace-pre-wrap">{importOutput}</pre>
                                        </div>
                                    )}

                                    <div className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-base-200 rounded-lg p-2 border border-gray-100 dark:border-base-300">
                                        {t('accounts.add.import.hint')}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 w-full mt-6">
                            <button
                                className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-base-200 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-base-300 transition-colors focus:outline-none focus:ring-2 focus:ring-200 dark:focus:ring-base-300"
                                onClick={() => setIsOpen(false)}
                                disabled={status === 'success'}
                            >
                                {t('accounts.add.btn_cancel')}
                            </button>
                            {activeTab === 'token' && (
                                <button
                                    className="flex-1 px-4 py-2.5 text-white font-medium rounded-xl shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 bg-blue-500 hover:bg-blue-600 focus:ring-blue-500 shadow-blue-100 dark:shadow-blue-900/30 flex justify-center items-center gap-2"
                                    onClick={handleSubmit}
                                    disabled={status === 'loading' || status === 'success'}
                                >
                                    {status === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                    {t('accounts.add.btn_confirm')}
                                </button>
                            )}
                        </div>
                    </div>
                </div >,
                document.body
            )
            }
        </>
    );
}

export default AddAccountDialog;
