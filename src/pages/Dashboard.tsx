import { Play, Square, RefreshCcw, Cpu, Clock, Network, Globe, Heart, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showToast } from '../components/common/ToastContainer';
import { request as invoke } from '../utils/request';
import { getActiveEmail } from '../services/accountService';
import { useConfigStore } from '../stores/useConfigStore';

interface QuotaModel {
    label: string;
    model_id: string;
    remaining_fraction: number;
    remaining_pct: number;
    reset_in_human: string;
    reset_time: string;
}

interface ZeroGravityQuota {
    last_updated: string;
    models: QuotaModel[];
    plan: {
        plan_name: string;
        tier_id?: string;
    };
}

interface HealthInfo {
    status: string;
    models: string[];
}

// Available API endpoints
const API_ENDPOINTS = [
    { method: 'POST', path: '/v1/chat/completions', color: 'text-green-400 bg-green-500/10' },
    { method: 'POST', path: '/v1/responses', color: 'text-green-400 bg-green-500/10' },
    { method: 'POST', path: '/v1/messages', color: 'text-green-400 bg-green-500/10' },
    { method: 'POST', path: '/v1beta/models/:model:generateContent', color: 'text-rose-400 bg-rose-500/10' },
    { method: 'GET', path: '/v1/models', color: 'text-cyan-400 bg-cyan-500/10' },
    { method: 'GET/POST', path: '/v1/search', color: 'text-amber-400 bg-amber-500/10' },
    { method: 'POST', path: '/v1/token', color: 'text-green-400 bg-green-500/10' },
    { method: 'GET', path: '/v1/accounts', color: 'text-cyan-400 bg-cyan-500/10' },
    { method: 'POST', path: '/v1/accounts', color: 'text-green-400 bg-green-500/10' },
    { method: 'GET', path: '/v1/usage', color: 'text-cyan-400 bg-cyan-500/10' },
    { method: 'GET', path: '/v1/quota', color: 'text-cyan-400 bg-cyan-500/10' },
    { method: 'GET', path: '/v1/images/*', color: 'text-cyan-400 bg-cyan-500/10' },
    { method: 'GET', path: '/health', color: 'text-cyan-400 bg-cyan-500/10' },
];

function Dashboard() {
    const { t } = useTranslation();
    const [dockerStatus, setDockerStatus] = useState<string>('unknown');
    const [actionLoading, setActionLoading] = useState(false);
    const [quota, setQuota] = useState<ZeroGravityQuota | null>(null);
    const [health, setHealth] = useState<HealthInfo | null>(null);
    const [models, setModels] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeEmail, setActiveEmail] = useState<string>('');

    const config = useConfigStore(state => state.config);
    const proxyPort = config?.proxy?.port || 8741;

    // Docker containers & port
    const [containers, setContainers] = useState<{ id: string, name: string, image: string, portPairs: { host: string, container: string, proto: string }[] }[]>([]);
    const [selectedContainer, setSelectedContainer] = useState<string>('');
    const [selectedPort, setSelectedPort] = useState<string>('');
    const [customPortInput, setCustomPortInput] = useState<string>('');

    const fetchDockerStatus = async () => {
        try {
            const status = await invoke<string>('check_docker');
            setDockerStatus(status);
        } catch (e) {
            setDockerStatus("error");
        }
    };

    const fetchContainers = async () => {
        try {
            const res = await invoke<string>('run_shell_command', {
                command: `docker ps --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}' 2>&1`
            });
            const lines = res.trim().split('\n').filter(l => l.trim());
            const parsed = lines.map(line => {
                const [id, name, image, ports] = line.split('\t');
                const portStr = ports || '';
                // Match: [host_ip:]host_port[-range]->container_port[-range]/proto
                const pairRe = /(?:[^,\s]+:)?(\d+)(?:-\d+)?->(\d+)(?:-\d+)?\/(\w+)/g;
                const portPairs: { host: string, container: string, proto: string }[] = [];
                let m;
                while ((m = pairRe.exec(portStr)) !== null) {
                    const pair = { host: m[1], container: m[2], proto: m[3] };
                    if (!portPairs.find(p => p.host === pair.host)) portPairs.push(pair);
                }
                return { id: id?.substring(0, 12) || '', name: name || '', image: image || '', portPairs };
            });
            setContainers(parsed);
        } catch { setContainers([]); }
    };

    const fetchHealth = async () => {
        try {
            const res = await invoke<string>("api_get", { path: "/health", port: proxyPort });
            const data = JSON.parse(res);
            setHealth(data);
        } catch (e) {
            setHealth(null);
        }
    };

    const fetchModels = async () => {
        try {
            const res = await invoke<string>("api_get", { path: "/v1/models", port: proxyPort });
            const data = JSON.parse(res);
            setModels(data.data || []);
        } catch (e) {
            setModels([]);
        }
    };

    const fetchQuota = async () => {
        setLoading(true);
        try {
            const res = await invoke<string>("api_get", { path: "/v1/quota", port: proxyPort });
            const data = JSON.parse(res);
            setQuota(data);
        } catch (e) {
            console.error('[Dashboard] Fetch Quota failed:', e);
        } finally {
            setLoading(false);
        }
    };

    const handleDockerAction = async (action: 'start' | 'stop' | 'restart') => {
        setActionLoading(true);
        try {
            await invoke("docker_action", { action });
            showToast(t('dashboard.toast.docker_success', { action }), 'success');
            // Wait a moment for services to start
            setTimeout(() => { refreshAll(); }, 2000);
        } catch (e) {
            showToast(t('dashboard.toast.docker_error', { action, error: String(e) }), 'error');
        } finally {
            setActionLoading(false);
        }
    };

    const refreshAll = () => {
        fetchDockerStatus();
        fetchHealth();
        fetchModels();
        fetchQuota();
        fetchContainers();
        getActiveEmail().then(setActiveEmail);
    };

    useEffect(() => {
        refreshAll();
        const interval = setInterval(refreshAll, 15000);
        return () => clearInterval(interval);
    }, []);

    const isRunning = dockerStatus.toLowerCase() === 'running';
    const isHealthy = health?.status === 'ok' || health?.status === 'healthy';

    return (
        <div className="h-full w-full overflow-y-auto">
            <div className="px-4 py-3 space-y-3 max-w-7xl mx-auto">

                {/* ——— Docker 对接 ——— */}
                {(() => {
                    const zgContainer = containers.find(c =>
                        c.name.toLowerCase().includes('zerogravity') || c.image.toLowerCase().includes('zerogravity')
                    );
                    const autoContainerName = zgContainer?.name || '';
                    const autoPairs = zgContainer?.portPairs || [];
                    const autoPort = autoPairs[0]?.host || String(proxyPort);
                    const effectiveContainer = selectedContainer || autoContainerName;
                    const effectivePort = selectedPort || String(proxyPort);
                    const isAuto = effectivePort === autoPort;

                    // Shared select style: borderless, blends with bar
                    const selCls = [
                        'appearance-none cursor-pointer',
                        'bg-base-content/[0.05] hover:bg-base-content/[0.09]',
                        'border border-base-content/[0.07] hover:border-base-content/[0.13]',
                        'text-[11px] font-mono text-base-content/75',
                        'rounded-lg pl-3 pr-7 py-1.5',
                        'focus:outline-none focus:border-base-content/20 focus:ring-0',
                        'transition-all duration-150',
                    ].join(' ');

                    return (
                        <div className="bg-base-100/60 rounded-xl px-4 py-2.5 border border-base-content/[0.06] flex items-center gap-5">

                            {/* Left badge + refresh */}
                            <div className="flex items-center gap-2 shrink-0">
                                <div className="w-5 h-5 rounded-md bg-base-content/8 flex items-center justify-center">
                                    <Settings2 className="w-3 h-3 text-base-content/40" />
                                </div>
                                <span className="text-[10px] font-semibold text-base-content/35 tracking-widest uppercase font-mono">Docker</span>
                                <button
                                    onClick={fetchContainers}
                                    className="p-1 rounded-md text-base-content/25 hover:text-base-content/60 hover:bg-base-content/8 transition-all"
                                    title={t('dashboard.docker.refresh_tooltip')}
                                >
                                    <RefreshCcw className="w-3 h-3" />
                                </button>
                            </div>

                            {/* Separator */}
                            <div className="self-stretch w-px bg-base-content/8" />

                            {/* Container group */}
                            <div className="flex items-center gap-2.5 min-w-0" style={{ flex: '0 1 220px' }}>
                                <span className="text-[9px] font-mono text-base-content/30 uppercase tracking-wider shrink-0 w-7 text-right">{t('dashboard.docker.container_label')}</span>
                                <div className="relative flex-1 min-w-0">
                                    <select
                                        value={effectiveContainer}
                                        onChange={e => setSelectedContainer(e.target.value)}
                                        className={`${selCls} w-full`}
                                    >
                                        {containers.length === 0 && <option value="">{t('dashboard.docker.no_containers')}</option>}
                                        {containers.map(c => (
                                            <option key={c.id} value={c.name}>{c.name}</option>
                                        ))}
                                        {!containers.find(c => c.name === effectiveContainer) && effectiveContainer && (
                                            <option value={effectiveContainer}>{effectiveContainer}</option>
                                        )}
                                        <option value="__custom__">{t('dashboard.docker.custom_option')}</option>
                                    </select>
                                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-base-content/30 text-[9px]">▾</span>
                                </div>
                                {autoContainerName && effectiveContainer === autoContainerName && (
                                    <span className="shrink-0 text-[9px] text-emerald-400/70 font-mono px-1.5 py-0.5 rounded-md bg-emerald-400/10">✓ {t('dashboard.docker.auto_badge')}</span>
                                )}
                            </div>

                            {/* Separator */}
                            <div className="self-stretch w-px bg-base-content/8" />

                            {/* Port group */}
                            <div className="flex items-center gap-2.5 shrink-0">
                                <Globe className="w-3.5 h-3.5 text-blue-400/50 shrink-0" />
                                <span className="text-[9px] font-mono text-base-content/30 uppercase tracking-wider shrink-0">{t('dashboard.docker.port_label')}</span>
                                <div className="relative">
                                    <select
                                        value={effectivePort}
                                        onChange={async e => {
                                            const val = e.target.value;
                                            setSelectedPort(val);
                                            if (val !== '__custom__') {
                                                setCustomPortInput('');
                                                const port = parseInt(val);
                                                if (!isNaN(port) && config && config.proxy.port !== port) {
                                                    try {
                                                        const newConfig = { ...config, proxy: { ...config.proxy, port } };
                                                        await useConfigStore.getState().saveConfig(newConfig);
                                                        showToast(t('common.update_success'), 'success');
                                                    } catch (err) {
                                                        showToast(String(err), 'error');
                                                    }
                                                }
                                            }
                                        }}
                                        className={selCls}
                                        style={{ width: '162px' }}
                                    >
                                        {autoPairs.map(p => (
                                            <option key={p.host} value={p.host}>{p.host} → {p.container}/{p.proto}</option>
                                        ))}
                                        {/* If config port is not in autoPairs, show it as an option */}
                                        {!autoPairs.find(p => p.host === String(proxyPort)) && (
                                            <option value={String(proxyPort)}>{proxyPort} → {proxyPort}/tcp</option>
                                        )}
                                        <option value="__custom__">{t('dashboard.docker.custom_option')}</option>
                                    </select>
                                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-base-content/30 text-[9px]">▾</span>
                                </div>
                                {selectedPort === '__custom__' && (
                                    <input
                                        autoFocus
                                        type="text"
                                        placeholder={t('dashboard.docker.port_label')}
                                        value={customPortInput}
                                        onChange={e => setCustomPortInput(e.target.value)}
                                        onKeyDown={async e => {
                                            if (e.key === 'Enter') {
                                                const port = parseInt(customPortInput);
                                                if (!isNaN(port) && config) {
                                                    try {
                                                        const newConfig = { ...config, proxy: { ...config.proxy, port } };
                                                        await useConfigStore.getState().saveConfig(newConfig);
                                                        showToast(t('common.update_success'), 'success');
                                                        setSelectedPort(String(port));
                                                        setCustomPortInput('');
                                                    } catch (err) {
                                                        showToast(String(err), 'error');
                                                    }
                                                }
                                            }
                                        }}
                                        className="w-16 bg-base-content/[0.06] border border-primary/40 text-[11px] font-mono text-base-content rounded-lg pl-3 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
                                    />
                                )}
                                {isAuto && autoPairs[0] && (
                                    <span className="text-[9px] text-emerald-400/70 font-mono px-1.5 py-0.5 rounded-md bg-emerald-400/10">✓</span>
                                )}
                            </div>


                        </div>
                    );
                })()}

                {/* ——— Top Status Cards ——— */}
                <div className="grid grid-cols-4 gap-2">
                    {/* Service Status */}
                    <div className={`rounded-lg p-3 border-t-2 ${isRunning ? 'border-t-green-400' : 'border-t-red-400'} bg-base-100/80 border border-base-content/5`}>
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-base-content/40 font-mono uppercase tracking-wider">{t('dashboard.status.service_status')}</span>
                            <Network className="w-4 h-4 text-base-content/20" />
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className={`relative flex h-2 w-2`}>
                                {isRunning && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
                                <span className={`relative inline-flex rounded-full h-2 w-2 ${isRunning ? 'bg-green-400' : 'bg-red-400'}`}></span>
                            </span>
                            <span className={`text-xs font-bold ${isRunning ? 'text-green-400' : 'text-red-400'}`}>
                                {isRunning ? t('dashboard.status.running') : t('dashboard.status.stopped')}
                            </span>
                        </div>
                        <p className="text-[9px] text-base-content/30 font-mono mt-1">{t('dashboard.status.service_desc')}</p>
                    </div>

                    {/* Proxy Port */}
                    <div className="rounded-lg p-3 border-t-2 border-t-blue-400 bg-base-100/80 border border-base-content/5">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-base-content/40 font-mono uppercase tracking-wider">{t('dashboard.status.proxy_port')}</span>
                            <Globe className="w-4 h-4 text-base-content/20" />
                        </div>
                        <span className="text-xl font-black font-mono text-base-content">{proxyPort}</span>
                        <p className="text-[9px] text-base-content/30 font-mono mt-0.5">http://127.0.0.1:{proxyPort}</p>
                    </div>

                    {/* Available Models */}
                    <div className="rounded-lg p-3 border-t-2 border-t-amber-400 bg-base-100/80 border border-base-content/5">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-base-content/40 font-mono uppercase tracking-wider">{t('dashboard.status.available_models')}</span>
                            <Cpu className="w-4 h-4 text-base-content/20" />
                        </div>
                        <span className="text-xl font-black font-mono text-base-content">{models.length}</span>
                        <p className="text-[9px] text-base-content/30 font-mono mt-0.5 truncate">
                            {models.length > 0 ? models.map(m => m.id).join(', ') : t('dashboard.status.no_models')}
                        </p>
                    </div>

                    {/* Health Check */}
                    <div className={`rounded-lg p-3 border-t-2 ${isHealthy ? 'border-t-green-400' : 'border-t-red-400'} bg-base-100/80 border border-base-content/5`}>
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-base-content/40 font-mono uppercase tracking-wider">{t('dashboard.status.health_check')}</span>
                            <Heart className="w-4 h-4 text-base-content/20" />
                        </div>
                        <span className={`text-sm font-bold ${isHealthy ? 'text-green-400' : 'text-red-400'}`}>
                            {isHealthy ? `✅ ${t('dashboard.status.healthy')}` : `❌ ${t('dashboard.status.unhealthy')}`}
                        </span>
                        <div className="mt-1">
                            <button
                                onClick={fetchHealth}
                                className="text-[9px] text-base-content/40 font-mono hover:text-primary transition-colors"
                            >↻ {t('common.refresh')}</button>
                        </div>
                    </div>
                </div>

                {/* ——— Service Control ——— */}
                <div className="bg-base-100/80 rounded-lg p-3 border border-base-content/5">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Network className="w-4 h-4 text-base-content/40" />
                            <span className="text-xs font-bold text-base-content">{t('dashboard.control.title')}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={() => handleDockerAction('start')}
                                disabled={actionLoading || isRunning}
                                className="btn btn-xs h-7 min-h-0 gap-1 text-[11px] bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20 disabled:opacity-30"
                            >
                                <Play className="w-3 h-3" /> {t('dashboard.control.start')}
                            </button>
                            <button
                                onClick={() => handleDockerAction('stop')}
                                disabled={actionLoading || !isRunning}
                                className="btn btn-xs h-7 min-h-0 gap-1 text-[11px] bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 disabled:opacity-30"
                            >
                                <Square className="w-3 h-3" /> {t('dashboard.control.stop')}
                            </button>
                            <button
                                onClick={() => handleDockerAction('restart')}
                                disabled={actionLoading || !isRunning}
                                className="btn btn-xs h-7 min-h-0 gap-1 text-[11px] bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20 disabled:opacity-30"
                            >
                                <RefreshCcw className="w-3 h-3" /> {t('dashboard.control.restart')}
                            </button>
                            <button
                                onClick={refreshAll}
                                className="btn btn-xs btn-ghost h-7 min-h-0 gap-1 text-[11px] text-base-content/50 hover:text-base-content"
                            >
                                <RefreshCcw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> {t('dashboard.control.refresh_status')}
                            </button>
                        </div>
                    </div>

                    {/* Model Chips — single scrollable row */}
                    {models.length > 0 && (
                        <div className="flex gap-1.5 mb-3 overflow-x-auto pb-0.5 scrollbar-hide">
                            {models.map((model) => (
                                <div key={model.id} className="bg-base-content/5 rounded-lg px-2.5 py-1.5 border border-base-content/5 hover:border-primary/30 transition-colors shrink-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                                        <span className="text-[11px] font-bold text-base-content whitespace-nowrap">{model.id}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* API Endpoints — compact method badges */}
                    <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[9px] text-base-content/30 font-mono mr-1">API</span>
                        {(() => {
                            const groups: Record<string, typeof API_ENDPOINTS> = {};
                            API_ENDPOINTS.forEach(ep => {
                                if (!groups[ep.method]) groups[ep.method] = [];
                                groups[ep.method].push(ep);
                            });
                            return Object.entries(groups).map(([method, eps]) => (
                                <div key={method} className="group relative">
                                    <span className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded cursor-default ${eps[0].color}`}>
                                        {method} <span className="text-[8px] opacity-60">×{eps.length}</span>
                                    </span>
                                    {/* Hover dropdown */}
                                    <div className="absolute left-0 top-full mt-1 z-50 hidden group-hover:block">
                                        <div className="bg-base-100 border border-base-content/10 rounded-lg shadow-xl py-1 min-w-[180px]">
                                            {eps.map((ep, i) => (
                                                <div key={i} className="px-2.5 py-1 text-[10px] font-mono text-base-content/60 hover:bg-base-content/5">
                                                    {ep.path}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ));
                        })()}
                    </div>
                </div>

                {/* ——— Quota Section ——— */}
                <div className="bg-base-100/80 rounded-lg p-3 border border-base-content/5">
                    <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-3.5 h-3.5 text-primary" />
                        <span className="text-xs font-bold text-base-content">{t('dashboard.quota.detailed_status')}</span>
                        {activeEmail && (
                            <span className="ml-1 flex items-center gap-1 text-[9px] font-mono text-base-content/40">
                                <span className="text-base-content/25">/</span>
                                <span className="text-emerald-400/70 truncate max-w-[180px]">{activeEmail}</span>
                            </span>
                        )}
                        <div className="flex-1"></div>
                        <button onClick={fetchQuota} className="text-[9px] text-base-content/40 font-mono hover:text-primary transition-colors flex items-center gap-1">
                            <RefreshCcw className={`w-2.5 h-2.5 ${loading ? 'animate-spin' : ''}`} /> {t('common.refresh')}
                        </button>
                    </div>

                    {(!quota?.models || quota.models.length === 0) ? (
                        <div className="text-center py-4 text-base-content/30 font-mono text-[11px] border border-dashed border-base-content/10 rounded">
                            {loading ? `> ${t('dashboard.quota.fetching')}` : `> ${t('dashboard.quota.no_data')}`}
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 lg:grid-cols-4 gap-1.5">
                            {quota.models.map((model, idx) => {
                                const pct = model.remaining_pct;
                                let barColor = 'bg-green-400';
                                let textColor = 'text-green-400';
                                if (pct < 30) { barColor = 'bg-red-400'; textColor = 'text-red-400'; }
                                else if (pct < 60) { barColor = 'bg-amber-400'; textColor = 'text-amber-400'; }

                                return (
                                    <div key={idx} className="bg-base-content/5 rounded-lg p-2 border border-base-content/5 hover:border-primary/20 transition-all">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-[10px] font-bold text-base-content truncate mr-1">{model.label}</span>
                                            <span className={`text-[11px] font-black font-mono tabular-nums ${textColor}`}>{Math.round(pct)}%</span>
                                        </div>
                                        <div className="w-full h-1 bg-base-content/10 rounded-full overflow-hidden mb-1">
                                            <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-[8px] text-base-content/30 font-mono">{model.reset_in_human || 'N/A'}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}

export default Dashboard;
