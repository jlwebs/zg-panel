import { Terminal, RefreshCcw, Trash2, Play, ArrowDown } from 'lucide-react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { request as invoke } from '../utils/request';
import { useConfigStore } from '../stores/useConfigStore';


function Logs() {
    const [logs, setLogs] = useState<string>('');
    const [autoScroll, setAutoScroll] = useState(true);
    const [tailLines, setTailLines] = useState(200);
    const [loading, setLoading] = useState(false);

    const config = useConfigStore(state => state.config);
    const proxyPort = config?.proxy?.port || 8741;

    // Terminal state
    const [cmdInput, setCmdInput] = useState('');
    const [cmdHistory, setCmdHistory] = useState<Array<{ cmd: string; output: string; error?: boolean; time: string }>>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [cmdInputHistory, setCmdInputHistory] = useState<string[]>([]);

    const logRef = useRef<HTMLPreElement>(null);
    const termRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const result = await invoke<string>('docker_logs', { tail: tailLines });
            // Strip ANSI escape codes (e.g. \x1b[32m color codes, \x1b[0m resets)
            const clean = result.replace(/\x1b\[[0-9;]*[mGKHFABCDJsu]/g, '').replace(/\r/g, '');
            setLogs(clean);
        } catch (e) {
            setLogs(`[错误] 无法获取日志: ${e}`);
        } finally {
            setLoading(false);
        }
    }, [tailLines]);

    useEffect(() => {
        fetchLogs();
        const interval = setInterval(fetchLogs, 5000);
        return () => clearInterval(interval);
    }, [fetchLogs]);

    useEffect(() => {
        if (autoScroll && logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [logs, autoScroll]);

    useEffect(() => {
        if (termRef.current) {
            termRef.current.scrollTop = termRef.current.scrollHeight;
        }
    }, [cmdHistory]);

    const handleCommand = async (e: React.FormEvent) => {
        e.preventDefault();
        const cmd = cmdInput.trim();
        if (!cmd) return;

        const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

        // Save to input history
        setCmdInputHistory(prev => [...prev.filter(c => c !== cmd), cmd]);
        setHistoryIndex(-1);
        setCmdInput('');

        try {
            const result = await invoke<string>('run_shell_command', { command: cmd });
            const cleanOutput = result.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').replace(/\r/g, '');
            setCmdHistory(prev => [...prev, { cmd, output: cleanOutput, time }]);
        } catch (e) {
            setCmdHistory(prev => [...prev, { cmd, output: String(e), error: true, time }]);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowUp' && cmdInputHistory.length > 0) {
            e.preventDefault();
            const newIdx = historyIndex < cmdInputHistory.length - 1 ? historyIndex + 1 : historyIndex;
            setHistoryIndex(newIdx);
            setCmdInput(cmdInputHistory[cmdInputHistory.length - 1 - newIdx] || '');
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const newIdx = historyIndex > 0 ? historyIndex - 1 : -1;
            setHistoryIndex(newIdx);
            setCmdInput(newIdx < 0 ? '' : cmdInputHistory[cmdInputHistory.length - 1 - newIdx] || '');
        }
    };

    // Preset commands organized by category (Optimized for Windows & Linux)
    const isWindows = typeof window !== 'undefined' && /win/i.test(navigator.userAgent);

    const presetCategories = [
        {
            label: '🐳 Docker',
            commands: [
                { label: 'docker ps', cmd: 'docker ps --format "Names: {{.Names}} | Status: {{.Status}} | Ports: {{.Ports}}"' },
                { label: '容器资源', cmd: `docker stats zerogravity --no-stream --format "CPU: {{.CPUPerc}} | MEM: {{.MemUsage}} | NET: {{.NetIO}}"` },
                { label: '重启容器', cmd: 'docker restart zerogravity && echo "✅ 已重启"' },
                { label: '容器日志', cmd: 'docker logs --tail 30 zerogravity 2>&1' },
            ],
        },
        {
            label: '🚀 ZG 命令',
            commands: [
                { label: '状态 (status)', cmd: 'docker exec zerogravity zg status' },
                { label: '快速冒烟测试', cmd: 'docker exec zerogravity zg smoke --quick' },
                { label: '更新 (update)', cmd: 'docker exec zerogravity zg update' },
                { label: '账号 (accounts)', cmd: 'docker exec zerogravity zg accounts' },
                { label: '测试 (test)', cmd: 'docker exec zerogravity zg test "hi"' },
                { label: '快速重启', cmd: 'docker exec zerogravity zg restart' },
            ],
        },
        {
            label: '🔑 ZG 账号',
            commands: [
                { label: '提取Cookie', cmd: 'docker exec zerogravity zg extract --browser chrome 2>&1' },
                { label: '账号列表', cmd: `python -c "import urllib.request,json;r=urllib.request.urlopen('http://127.0.0.1:${proxyPort}/v1/accounts');print(json.dumps(json.loads(r.read()),indent=2,ensure_ascii=False))"` },
                { label: '配额查询', cmd: `python -c "import urllib.request,json;r=urllib.request.urlopen('http://127.0.0.1:${proxyPort}/v1/quota');print(json.dumps(json.loads(r.read()),indent=2,ensure_ascii=False))"` },
                { label: '使用统计', cmd: `python -c "import urllib.request,json;r=urllib.request.urlopen('http://127.0.0.1:${proxyPort}/v1/usage');print(json.dumps(json.loads(r.read()),indent=2,ensure_ascii=False))"` },
            ],
        },
        {
            label: '📡 API 测试',
            commands: [
                { label: '健康检查', cmd: `python -c "import urllib.request,json;r=urllib.request.urlopen('http://127.0.0.1:${proxyPort}/health');print(json.dumps(json.loads(r.read()),indent=2,ensure_ascii=False))"` },
                { label: '模型列表', cmd: `python -c "import urllib.request,json;r=urllib.request.urlopen('http://127.0.0.1:${proxyPort}/v1/models');print(json.dumps(json.loads(r.read()),indent=2,ensure_ascii=False))"` },
                {
                    label: 'Chat测试', cmd: isWindows
                        ? `python -c "import urllib.request,json;r=urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:${proxyPort}/v1/chat/completions',json.dumps({'model':'gemini-3-flash','messages':[{'role':'user','content':'hi'}],'max_tokens':10}).encode(),{'Content-Type':'application/json'}));print(json.dumps(json.loads(r.read()),indent=2,ensure_ascii=False))"`
                        : `curl -s http://127.0.0.1:${proxyPort}/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"gemini-3-flash","messages":[{"role":"user","content":"hi"}],"max_tokens":10}' | python -m json.tool`
                },
            ],
        },
        {
            label: '🖼️ 图像生成',
            commands: [
                {
                    label: 'Chat生图', cmd: `python -c "import urllib.request,json;r=urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:${proxyPort}/v1/chat/completions',json.dumps({'model':'gemini-3-pro-image','messages':[{'role':'user','content':'Draw a cute cyberpunk cat with neon lights'}],'max_tokens':4096}).encode(),{'Content-Type':'application/json'}));print(json.dumps(json.loads(r.read()),indent=2,ensure_ascii=False))"`
                },
                {
                    label: 'Gemini原生', cmd: `python -c "import urllib.request,json;r=urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:${proxyPort}/v1beta/models/gemini-3-pro-image:generateContent',json.dumps({'contents':[{'parts':[{'text':'Generate an image: a futuristic city skyline at sunset'}]}],'generationConfig':{'responseModalities':['TEXT','IMAGE']}}).encode(),{'Content-Type':'application/json'}));print(json.dumps(json.loads(r.read()),indent=2,ensure_ascii=False))"`
                },
                {
                    label: '像素龙', cmd: `python -c "import urllib.request,json;r=urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:${proxyPort}/v1/chat/completions',json.dumps({'model':'gemini-3-pro-image','messages':[{'role':'user','content':'Draw a pixel art dragon breathing fire'}],'max_tokens':4096}).encode(),{'Content-Type':'application/json'}));print(json.dumps(json.loads(r.read()),indent=2,ensure_ascii=False))"`
                },
                { label: '图片列表', cmd: 'docker exec zerogravity sh -c "find /tmp/.agcache/.gemini/antigravity/brain/ -name \'*.png\' -printf \'%T@ %p\\n\' | sort -rn | head -5"' },
            ],
        },
        {
            label: '🔧 诊断',
            commands: [
                { label: '端口检测', cmd: isWindows ? `netstat -ano | findstr :${proxyPort}` : `lsof -i :${proxyPort}` },
                { label: 'ZG版本', cmd: 'docker exec zerogravity cat /app/version.txt' },
                { label: '网络测试', cmd: `python -c "import urllib.request,time;s=time.time();r=urllib.request.urlopen('http://127.0.0.1:${proxyPort}/health');print(f'HTTP: {r.status} | Time: {time.time()-s:.3f}s')"` },
                { label: '磁盘占用', cmd: 'docker system df' },
            ],
        },
    ];

    const [activePresetCategory, setActivePresetCategory] = useState(0);

    // Resizable Divider Logic
    const [terminalHeight, setTerminalHeight] = useState(240);
    const isResizing = useRef(false);

    const startResizing = useCallback(() => {
        isResizing.current = true;
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', stopResizing);
        document.body.style.cursor = 'row-resize';
    }, []);

    const stopResizing = useCallback(() => {
        isResizing.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', stopResizing);
        document.body.style.cursor = 'default';
    }, []);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing.current) return;
        const newHeight = window.innerHeight - e.clientY - 20; // Adjust for footer/padding
        if (newHeight > 100 && newHeight < window.innerHeight * 0.7) {
            setTerminalHeight(newHeight);
        }
    }, []);

    const colorizeLog = (line: string): string => {
        // Simple colorization via CSS classes
        if (line.includes('ERROR') || line.includes('error') || line.includes('FATAL')) return 'text-red-400';
        if (line.includes('WARN') || line.includes('warn')) return 'text-amber-400';
        if (line.includes('INFO') || line.includes('info')) return 'text-cyan-400';
        if (line.includes('DEBUG') || line.includes('debug')) return 'text-base-content/40';
        return 'text-base-content/70';
    };

    return (
        <div className="h-full flex flex-col p-3 gap-0 overflow-hidden">

            {/* Docker Logs Section */}
            <div className="flex-1 flex flex-col bg-base-100/80 rounded-t-lg border border-base-content/5 overflow-hidden min-h-0">
                {/* Log Header */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-base-content/3 border-b border-base-content/5 shrink-0">
                    <div className="flex items-center gap-2">
                        <Terminal className="w-3.5 h-3.5 text-green-400" />
                        <span className="text-[11px] font-bold font-mono text-base-content/70 uppercase">Docker Logs</span>
                        <span className="text-[9px] text-base-content/30 font-mono">zerogravity</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <select
                            value={tailLines}
                            onChange={(e) => setTailLines(Number(e.target.value))}
                            className="select select-xs h-6 min-h-0 text-[10px] font-mono bg-base-content/5 border-base-content/10 text-base-content/50"
                        >
                            <option value={50}>50行</option>
                            <option value={100}>100行</option>
                            <option value={200}>200行</option>
                            <option value={500}>500行</option>
                            <option value={1000}>1000行</option>
                        </select>
                        <button
                            onClick={() => setAutoScroll(!autoScroll)}
                            className={`btn btn-xs h-6 min-h-0 text-[10px] font-mono gap-1 ${autoScroll ? 'btn-primary' : 'btn-ghost text-base-content/40'}`}
                        >
                            <ArrowDown className="w-2.5 h-2.5" /> {autoScroll ? 'AUTO' : 'MANUAL'}
                        </button>
                        <button onClick={fetchLogs} className="btn btn-xs btn-ghost h-6 min-h-0 text-base-content/40 hover:text-base-content">
                            <RefreshCcw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button onClick={() => setLogs('')} className="btn btn-xs btn-ghost h-6 min-h-0 text-base-content/40 hover:text-red-400">
                            <Trash2 className="w-3 h-3" />
                        </button>
                    </div>
                </div>

                {/* Log Content */}
                <pre
                    ref={logRef}
                    className="flex-1 overflow-auto p-2 text-[11px] font-mono leading-relaxed min-h-0"
                    onScroll={(e) => {
                        const el = e.currentTarget;
                        const isBottom = Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 30;
                        if (!isBottom && autoScroll) setAutoScroll(false);
                        if (isBottom && !autoScroll) setAutoScroll(true);
                    }}
                >
                    {logs ? logs.split('\n').map((line, i) => (
                        <div key={i} className={`${colorizeLog(line)} hover:bg-base-content/3 px-1`}>
                            {line || '\u00A0'}
                        </div>
                    )) : (
                        <div className="text-base-content/30 text-center py-8">
                            {loading ? '正在加载日志...' : '暂无日志'}
                        </div>
                    )}
                </pre>
            </div>

            {/* Resizable Divider */}
            <div
                onMouseDown={startResizing}
                className="h-1.5 w-full bg-base-300 hover:bg-primary/40 cursor-row-resize flex items-center justify-center transition-colors group relative z-10"
            >
                <div className="w-12 h-0.5 rounded-full bg-base-content/20 group-hover:bg-primary transition-colors"></div>
            </div>

            {/* Terminal Section */}
            <div
                style={{ height: `${terminalHeight}px` }}
                className="flex flex-col bg-[#0d1117] rounded-b-lg border border-base-content/5 overflow-hidden shrink-0"
            >
                {/* Terminal Header */}
                <div className="flex flex-col bg-[#161b22] border-b border-white/5 shrink-0">
                    <div className="flex items-center justify-between px-3 py-1 border-b border-white/3">
                        <div className="flex items-center gap-2">
                            <div className="flex gap-1">
                                <span className="w-2 h-2 rounded-full bg-red-500/80"></span>
                                <span className="w-2 h-2 rounded-full bg-amber-500/80"></span>
                                <span className="w-2 h-2 rounded-full bg-green-500/80"></span>
                            </div>
                            <span className="text-[11px] font-bold font-mono text-white/60 uppercase ml-1">ZG Terminal</span>
                        </div>
                        <div className="flex items-center gap-0.5">
                            {presetCategories.map((cat, ci) => (
                                <button
                                    key={ci}
                                    onClick={() => setActivePresetCategory(ci)}
                                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded transition-colors ${activePresetCategory === ci
                                        ? 'bg-white/10 text-white/70'
                                        : 'text-white/30 hover:text-white/50'
                                        }`}
                                >{cat.label}</button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-1 px-3 py-1 overflow-x-auto">
                        {presetCategories[activePresetCategory].commands.map((pc, i) => (
                            <button
                                key={i}
                                onClick={() => { setCmdInput(pc.cmd); inputRef.current?.focus(); }}
                                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-white/40 hover:text-cyan-400 hover:bg-white/10 transition-colors whitespace-nowrap shrink-0"
                            >{pc.label}</button>
                        ))}
                    </div>
                </div>

                {/* Terminal Output */}
                <div ref={termRef} className="flex-1 overflow-y-auto p-2 min-h-0">
                    {cmdHistory.length === 0 && (
                        <div className="text-white/20 text-[11px] font-mono">
                            <div>$ # ZeroGravity 终端 — 直接执行命令</div>
                            <div>$ # 支持 docker exec, curl, 或任意 shell 命令</div>
                            <div>$ # 按 ↑↓ 翻阅历史记录</div>
                        </div>
                    )}
                    {cmdHistory.map((entry, i) => (
                        <div key={i} className="mb-1.5">
                            <div className="flex items-center gap-1 text-[11px] font-mono">
                                <span className="text-green-400">$</span>
                                <span className="text-white/80">{entry.cmd}</span>
                                <span className="text-white/20 ml-auto text-[9px]">{entry.time}</span>
                            </div>
                            <pre className={`text-[10px] font-mono pl-3 whitespace-pre-wrap ${entry.error ? 'text-red-400' : 'text-white/50'}`}>
                                {entry.output || '(no output)'}
                            </pre>
                        </div>
                    ))}
                </div>

                {/* Command Input */}
                <form onSubmit={handleCommand} className="flex items-center gap-1 px-2 py-1.5 bg-[#0d1117] border-t border-white/5 shrink-0">
                    <span className="text-green-400 text-[11px] font-mono font-bold">$</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={cmdInput}
                        onChange={(e) => setCmdInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="输入命令..."
                        className="flex-1 bg-transparent text-white/80 text-[11px] font-mono placeholder:text-white/20 outline-none"
                        autoComplete="off"
                        spellCheck="false"
                    />
                    <button
                        type="submit"
                        disabled={!cmdInput.trim()}
                        className="btn btn-xs h-5 min-h-0 bg-green-500/20 text-green-400 border-green-500/20 hover:bg-green-500/30 disabled:opacity-30 text-[9px] font-mono"
                    >
                        <Play className="w-2.5 h-2.5" /> RUN
                    </button>
                </form>
            </div>

        </div>
    );
}

export default Logs;
