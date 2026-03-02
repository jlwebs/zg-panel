import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Play, Square, RefreshCw, X, Terminal, Save, RotateCcw, ChevronRight } from 'lucide-react';
import Editor from 'react-simple-code-editor';
import { highlight, languages } from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/themes/prism-tomorrow.css'; // 基础暗色主题

/** 预设配置（依赖动态路径） */
function buildPresets(pyPath: string, logPath: string) {
    return [
        {
            label: '🔍 调试 + 附加思考到正文',
            desc: '开启详细请求日志，将 reasoning_content 内联注入为引用块',
            cmd: `nohup python3 "${pyPath}" --debug --prepend-thinking > "${logPath}" 2>&1`,
        },
        {
            label: '💭 仅附加思考到正文（无日志）',
            desc: '注入思考内容到正文，不打印请求日志，适合日常使用',
            cmd: `nohup python3 "${pyPath}" --prepend-thinking > "${logPath}" 2>&1`,
        },
        {
            label: '📋 仅调试日志',
            desc: '只打印请求/响应 delta 日志，不做任何内容修改',
            cmd: `nohup python3 "${pyPath}" --debug > "${logPath}" 2>&1`,
        },
        {
            label: '⚡ 透明转发',
            desc: '纯透明代理，不做任何处理，直接转发到 zerogravity，性能最高',
            cmd: `nohup python3 "${pyPath}" --direct > "${logPath}" 2>&1`,
        },
        {
            label: '🚫 透明转发（无日志）',
            desc: '极简模式：纯转发，不写日志，适合生产稳定运行',
            cmd: `nohup python3 "${pyPath}" --direct > /dev/null 2>&1`,
        },
        {
            label: '🛠 自定义',
            desc: '手动编辑下方命令行',
            cmd: null,
        },
    ];
}

/** Geek 风格样式覆盖 */
const EDITOR_STYLING = {
    fontFamily: '"Fira Code", "JetBrains Mono", "Cascadia Code", "Source Code Pro", Menlo, Monaco, Consolas, "Courier New", monospace',
    fontSize: 12,
    lineHeight: '1.4',
    backgroundColor: '#1a1b26', // Tokyonight style dark
    color: '#c0caf5',
    minHeight: '100%',
};

function ProxyLayer() {
    const [pyPath, setPyPath] = useState('');
    const [logPath, setLogPath] = useState('');
    const [pathsReady, setPathsReady] = useState(false);
    const [presets, setPresets] = useState(buildPresets('', ''));
    const [code, setCode] = useState('');
    const [savedCode, setSavedCode] = useState('');
    const [startCmd, setStartCmd] = useState('');
    const [selectedPreset, setSelectedPreset] = useState(0);
    const [running, setRunning] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [logOpen, setLogOpen] = useState(false);
    const [logContent, setLogContent] = useState('');
    const [logLoading, setLogLoading] = useState(false);
    const [status, setStatus] = useState<'running' | 'stopped' | 'unknown'>('unknown');
    const [statusMsg, setStatusMsg] = useState('');
    const logRef = useRef<HTMLDivElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // 初始化：获取跨平台 app 数据目录路径
    const initPaths = useCallback(async () => {
        try {
            const raw = await invoke<string>('init_proxy_files');
            const { py_path, log_path } = JSON.parse(raw);
            setPyPath(py_path);
            setLogPath(log_path);
            const newPresets = buildPresets(py_path, log_path);
            setPresets(newPresets);
            // 默认选第一个预设
            setStartCmd(newPresets[0].cmd!);
            setPathsReady(true);
        } catch (e) {
            setStatusMsg(`✗ 无法初始化文件: ${e}`);
        }
    }, []);

    const loadFile = useCallback(async () => {
        if (!pyPath) return;
        try {
            const content = await invoke<string>('read_file', { path: pyPath });
            setCode(content);
            setSavedCode(content);
        } catch (e) {
            setCode(`# 无法读取文件: ${e}`);
        } finally {
            setLoading(false);
        }
    }, [pyPath]);

    // 检查代理状态
    const checkStatus = useCallback(async () => {
        try {
            const out = await invoke<string>('run_shell_command', {
                command: 'pgrep -f proxy_fix.py | head -1'
            });
            const pid = out.trim();
            setRunning(!!pid);
            setStatus(pid ? 'running' : 'stopped');
        } catch {
            setStatus('stopped');
            setRunning(false);
        }
    }, []);

    // 初始化 + 轮询
    useEffect(() => {
        initPaths();
        checkStatus();
        pollRef.current = setInterval(checkStatus, 3000);
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [initPaths, checkStatus]);

    // 路径就绪后加载文件
    useEffect(() => {
        if (pathsReady) loadFile();
    }, [pathsReady, loadFile]);

    // 日志自动滚动到底部
    useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [logContent]);

    // 读取日志（限制最后 500 行，避免文件过大卡死 UI）
    const loadLog = useCallback(async () => {
        if (!logPath) return;
        setLogLoading(true);
        try {
            const content = await invoke<string>('run_shell_command', {
                command: `tail -n 500 "${logPath}" || echo "无法读取日志"`
            });
            setLogContent(content);
        } catch (e) {
            setLogContent(`无法读取日志: ${e}`);
        } finally {
            setLogLoading(false);
        }
    }, [logPath]);

    useEffect(() => {
        if (logOpen) {
            loadLog();
            const t = setInterval(loadLog, 2000);
            return () => clearInterval(t);
        }
    }, [logOpen, loadLog]);

    // 保存代码
    const handleSave = async () => {
        setSaving(true);
        setStatusMsg('');
        try {
            await invoke('write_file', { path: pyPath, content: code });
            setSavedCode(code);
            setStatusMsg('✓ 已保存');
            setTimeout(() => setStatusMsg(''), 2000);
        } catch (e) {
            setStatusMsg(`✗ 保存失败: ${e}`);
        } finally {
            setSaving(false);
        }
    };

    // 启动代理
    const handleStart = async () => {
        setStatusMsg('正在启动...');
        try {
            // 先停止旧进程
            await invoke('run_shell_command', { command: 'pkill -f proxy_fix.py 2>/dev/null || true' });
            await new Promise(r => setTimeout(r, 500));
            // 启动新进程
            await invoke('run_shell_command', { command: `${startCmd} &` });
            await new Promise(r => setTimeout(r, 800));
            await checkStatus();
            setStatusMsg('✓ 已启动');
            setTimeout(() => setStatusMsg(''), 2000);
        } catch (e) {
            setStatusMsg(`✗ 启动失败: ${e}`);
        }
    };

    // 停止代理
    const handleStop = async () => {
        setStatusMsg('正在停止...');
        try {
            await invoke('run_shell_command', { command: 'pkill -f proxy_fix.py 2>/dev/null || true' });
            await new Promise(r => setTimeout(r, 600));
            await checkStatus();
            setStatusMsg('✓ 已停止');
            setTimeout(() => setStatusMsg(''), 2000);
        } catch (e) {
            setStatusMsg(`✗ 停止失败: ${e}`);
        }
    };

    const isDirty = code !== savedCode;

    return (
        <div className="h-full flex flex-col bg-base-100 relative overflow-hidden">
            {/* 顶部标题栏 */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-base-300 bg-base-100 shrink-0">
                <div className="flex items-center gap-3">
                    <Terminal size={16} className="text-primary" />
                    <span className="font-semibold text-sm">代理脚本</span>
                    <span className="text-xs text-base-content/40 font-mono">{pyPath || '初始化中...'}</span>
                    {isDirty && (
                        <span className="badge badge-warning badge-xs">未保存</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {statusMsg && (
                        <span className={`text-xs font-mono ${statusMsg.startsWith('✓') ? 'text-success' : statusMsg.startsWith('✗') ? 'text-error' : 'text-base-content/60'}`}>
                            {statusMsg}
                        </span>
                    )}
                    <button
                        className="btn btn-ghost btn-xs gap-1"
                        onClick={() => { setCode(savedCode); }}
                        disabled={!isDirty}
                        title="撤销修改"
                    >
                        <RotateCcw size={13} />
                    </button>
                    <button
                        className="btn btn-primary btn-xs gap-1"
                        onClick={handleSave}
                        disabled={saving || !isDirty}
                    >
                        <Save size={13} />
                        {saving ? '保存中...' : '保存'}
                    </button>
                </div>
            </div>

            {/* 代码编辑区 */}
            <div className="flex-1 overflow-auto relative bg-[#1a1b26]" style={{ minHeight: 0 }}>
                {loading ? (
                    <div className="flex items-center justify-center h-full text-base-content/40">
                        <span className="loading loading-spinner mr-2"></span> 加载中...
                    </div>
                ) : (
                    <div className="min-h-full flex relative">
                        {/* 行号 */}
                        <div
                            className="shrink-0 select-none text-right pr-3 pt-[14px] text-[11px] font-mono text-base-content/20 bg-[#16161e] border-r border-white/5 overflow-hidden"
                            style={{ minWidth: '3.5rem', lineHeight: '1.4' }}
                        >
                            {code.split('\n').map((_, i) => (
                                <div key={i}>{i + 1}</div>
                            ))}
                        </div>
                        {/* 编辑器 */}
                        <div className="flex-1 min-w-0">
                            <Editor
                                value={code}
                                onValueChange={code => setCode(code)}
                                highlight={code => highlight(code, languages.python, 'python')}
                                padding={14}
                                style={EDITOR_STYLING}
                                onKeyDown={e => {
                                    // Ctrl+S / Cmd+S 保存
                                    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                                        e.preventDefault();
                                        handleSave();
                                    }
                                }}
                                className="geek-editor"
                            />
                        </div>

                        {/* 嵌入样式修复 */}
                        <style>{`
                            .geek-editor textarea {
                                outline: none !important;
                                border: none !important;
                                box-shadow: none !important;
                                background: transparent !important;
                            }
                            .geek-editor pre {
                                pointer-events: none;
                            }
                            /* Prism 颜色微调以适配 Geek 风格 */
                            .token.comment, .token.prolog, .token.doctype, .token.cdata { color: #565f89; italic: true; }
                            .token.punctuation { color: #bb9af7; }
                            .token.namespace { opacity: .7; }
                            .token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol, .token.deleted { color: #ff9e64; }
                            .token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted { color: #9ece6a; }
                            .token.operator, .token.entity, .token.url, .language-css .token.string, .style .token.string { color: #89ddff; }
                            .token.atrule, .token.attr-value, .token.keyword { color: #7ad9ff; }
                            .token.function, .token.class-name { color: #7aa2f7; }
                            .token.regex, .token.important, .token.variable { color: #e0af68; }
                        `}</style>
                    </div>
                )}
            </div>

            {/* 底部控制栏 */}
            <div className="shrink-0 border-t border-base-300 bg-base-100 px-4 py-2">
                {/* 预设选择 + 命令行 */}
                <div className="flex flex-col gap-1.5 mb-2">
                    {/* 预设下拉 */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-base-content/50 shrink-0">预设</span>
                        <select
                            className="select select-xs select-bordered flex-1 font-sans text-xs"
                            value={selectedPreset}
                            onChange={e => {
                                const idx = Number(e.target.value);
                                setSelectedPreset(idx);
                                const preset = presets[idx];
                                if (preset.cmd !== null) {
                                    setStartCmd(preset.cmd);
                                }
                            }}
                        >
                            {presets.map((p, i) => (
                                <option key={i} value={i}>{p.label}</option>
                            ))}
                        </select>
                        <span className="text-xs text-base-content/40 shrink-0 max-w-[200px] truncate" title={presets[selectedPreset].desc}>
                            {presets[selectedPreset].desc}
                        </span>
                    </div>
                    {/* 命令行 */}
                    <div className="flex items-center gap-2">
                        <ChevronRight size={14} className="text-primary shrink-0" />
                        <input
                            type="text"
                            className="input input-xs input-bordered font-mono flex-1 text-xs"
                            value={startCmd}
                            onChange={e => {
                                setStartCmd(e.target.value);
                                // 手动修改后切换到「自定义」预设
                                setSelectedPreset(presets.length - 1);
                            }}
                            placeholder="启动命令..."
                        />
                    </div>
                </div>
                {/* 按钮行 */}
                <div className="flex items-center gap-3">
                    {/* 状态指示 */}
                    <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${status === 'running' ? 'bg-success animate-pulse' : status === 'stopped' ? 'bg-error' : 'bg-base-content/30'}`} />
                        <span className="text-xs text-base-content/60">
                            {status === 'running' ? '运行中' : status === 'stopped' ? '已停止' : '未知'}
                        </span>
                    </div>

                    <div className="flex-1" />

                    {/* 日志按钮 */}
                    <button
                        className={`btn btn-ghost btn-xs gap-1 ${logOpen ? 'btn-active' : ''}`}
                        onClick={() => setLogOpen(v => !v)}
                    >
                        <Terminal size={13} />
                        日志
                    </button>

                    {/* 停止 */}
                    <button
                        className="btn btn-error btn-xs gap-1"
                        onClick={handleStop}
                        disabled={!running}
                    >
                        <Square size={12} />
                        停止
                    </button>

                    {/* 启动 */}
                    <button
                        className="btn btn-success btn-xs gap-1"
                        onClick={handleStart}
                    >
                        <Play size={12} />
                        {running ? '重启' : '启动'}
                    </button>
                </div>
            </div>

            {/* 右侧日志抽屉 */}
            <div
                className="absolute top-0 right-0 h-full flex flex-col bg-base-300 border-l border-base-content/10 shadow-2xl transition-transform duration-300 z-50"
                style={{
                    width: '420px',
                    transform: logOpen ? 'translateX(0)' : 'translateX(100%)',
                }}
            >
                {/* 日志标题栏 */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-base-content/10 shrink-0">
                    <div className="flex items-center gap-2">
                        <Terminal size={14} className="text-primary" />
                        <span className="text-sm font-semibold">Log</span>
                        <span className="text-xs text-base-content/40 font-mono">{logPath}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <button className="btn btn-ghost btn-xs" onClick={loadLog} disabled={logLoading} title="刷新">
                            <RefreshCw size={13} className={logLoading ? 'animate-spin' : ''} />
                        </button>
                        <button className="btn btn-ghost btn-xs" onClick={() => setLogContent('')} title="清空显示">
                            清空
                        </button>
                        <button className="btn btn-ghost btn-xs" onClick={() => setLogOpen(false)}>
                            <X size={14} />
                        </button>
                    </div>
                </div>

                {/* 日志内容 */}
                <div
                    ref={logRef}
                    className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all text-base-content/80"
                    style={{ background: 'rgba(0,0,0,0.3)' }}
                >
                    {logLoading && !logContent ? (
                        <span className="text-base-content/40">加载日志...</span>
                    ) : logContent ? (
                        logContent
                    ) : (
                        <span className="text-base-content/40">暂无日志</span>
                    )}
                </div>
            </div>
        </div>
    );
}

export default ProxyLayer;
