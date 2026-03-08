import { useState, useRef, useEffect } from 'react';
import {
    Send, Trash2, ImagePlus, X, Bot, User, Loader2,
    ChevronDown, Settings2, Sparkles, MessageSquare,
    Zap, Terminal, Image as ImageIcon, History,
    Command, LayoutGrid, Trash
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useConfigStore } from '../stores/useConfigStore';
import { invoke } from '@tauri-apps/api/core';

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    reasoning?: string;
    images?: string[];
    timestamp: number;
    model?: string;
    id?: string;
    isPolling?: boolean;
}

const ENDPOINT_TYPES = [
    { id: 'gemini', label: 'Gemini', path: '/v1beta' },
    { id: 'openai', label: 'OpenAI', path: '/v1' },
    { id: 'anthropic', label: 'Anthropic', path: '' },
];

const AVAILABLE_MODELS = [
    { id: 'gemini-3-flash', label: 'Gemini 3 Flash', group: 'Gemini', icon: Zap },
    { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', group: 'Gemini', icon: Sparkles },
    { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro High', group: 'Gemini', icon: Sparkles },
    { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro Low', group: 'Gemini', icon: Sparkles },
    { id: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image', group: 'Image', icon: ImageIcon },
    { id: 'sonnet-4.6', label: 'Claude Sonnet 4.7', group: 'Claude', icon: Bot },
];

const CATEGORIES = [
    { label: '画一只赛博朋克猫', icon: ImageIcon, prompt: '帮我画一只赛博朋克风格的粉色可爱小猫，带有霓虹灯效果' },
    { label: '写个快速排序脚本', icon: Terminal, prompt: '用 Python 写一个高效的快速排序算法，并带有详细注释' },
    { label: '今天天气怎么样', icon: Sparkles, prompt: '查一下今天上海的天气预报' },
    { label: '晚饭推荐吃什么', icon: MessageSquare, prompt: '我不知道晚饭该吃什么了，给我推荐几个健康的食谱吧' },
    { label: '讲个冷笑话', icon: LayoutGrid, prompt: '讲个冷笑话或者有趣的段子' },
];

function Chat() {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [selectedModel, setSelectedModel] = useState('gemini-3-flash');
    const [selectedEndpointType, setSelectedEndpointType] = useState('gemini');
    const [isStreaming, setIsStreaming] = useState(false);
    const [pendingImages, setPendingImages] = useState<string[]>([]);
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const [showEndpointDropdown, setShowEndpointDropdown] = useState(false);
    const [rightSidebarTab, setRightSidebarTab] = useState<'settings' | 'history' | null>(null);
    const [systemPrompt, setSystemPrompt] = useState('You are a helpful AI chatbot powered by ZeroGravity.');
    const [imageHistory, setImageHistory] = useState<{ url: string; timestamp: number }[]>([]);

    const config = useConfigStore(state => state.config);
    const proxyPort = config?.proxy?.port || 8741;
    const apiBase = `http://127.0.0.1:${proxyPort}`;


    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const endpointDropdownRef = useRef<HTMLDivElement>(null);
    const logToFile = async (_msg: string) => {
        // Logging disabled to prevent UI lag
    };

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowModelDropdown(false);
            }
            if (endpointDropdownRef.current && !endpointDropdownRef.current.contains(event.target as Node)) {
                setShowEndpointDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const pollForImage = async (msgId: string, startTime: number) => {
        let attempts = 0;
        const maxAttempts = 60;
        const interval = 2000;
        // Use 2-minute buffer to be absolutely safe about sync and generation delay
        const unixStartTime = Math.floor(startTime / 1000) - 120;

        logToFile(`POLLING_START: ID=${msgId} | StartTime=${new Date(startTime).toISOString()} | UnixRef=${unixStartTime}`);

        const check = async () => {
            if (attempts >= maxAttempts) {
                logToFile(`POLLING_TIMEOUT: ID=${msgId} after ${maxAttempts} attempts`);
                setMessages(prev => prev.map(m => m.id === msgId ? { ...m, isPolling: false } : m));
                return;
            }
            try {
                const cmd = `docker exec zerogravity find /tmp/.agcache/.gemini/antigravity/brain/ -name "*.png" -newermt "@${unixStartTime}" -printf "%T@ %p\\n" | sort -n | tail -n 1 | awk '{print $2}'`;
                const filePath = await invoke<string>('run_shell_command', { command: cmd });

                if (filePath && filePath.trim().startsWith('/tmp/')) {
                    const cleanPath = filePath.trim();
                    const parts = cleanPath.split('/');
                    if (parts.length >= 2) {
                        const filename = parts[parts.length - 1];
                        const folderUuid = parts[parts.length - 2];
                        const imageUrl = `${apiBase}/v1/images/${folderUuid}/${filename}`;

                        logToFile(`POLLING_SUCCESS: ID=${msgId} | Found=${imageUrl}`);
                        setImageHistory(prev => [{ url: imageUrl, timestamp: Date.now() }, ...prev.filter(u => u.url !== imageUrl)]);
                        setMessages(prev => prev.map(m => {
                            if (m.id === msgId) {
                                const currentImages = m.images || [];
                                if (currentImages.includes(imageUrl)) return { ...m, isPolling: false };
                                return { ...m, images: [...currentImages, imageUrl], isPolling: false };
                            }
                            return m;
                        }));
                        return;
                    }
                } else {
                    // Check docker logs for 429 or other upstream errors
                    try {
                        const logCmd = `docker logs --tail 50 zerogravity 2>&1 | grep "status=429" | tail -n 1`;
                        const lastError = await invoke<string>('run_shell_command', { command: logCmd });
                        if (lastError && (lastError.includes('status=429') || lastError.includes('upstream error'))) {
                            logToFile(`POLLING_DETECTED_ERROR: ID=${msgId} | Log=${lastError.trim()}`);
                            setMessages(prev => prev.map(m => {
                                if (m.id === msgId) {
                                    return {
                                        ...m,
                                        content: m.content + `\n\n❌ **图像生成失败**: 检测到上游服务限额 (429)。请稍后再试。`,
                                        isPolling: false
                                    };
                                }
                                return m;
                            }));
                            return;
                        }
                    } catch (err) { }

                    if (attempts % 5 === 0) logToFile(`POLLING_WAIT: ID=${msgId} | Attempt=${attempts}`);
                }
            } catch (e: any) {
                logToFile(`POLLING_ERROR: ID=${msgId} | Err=${e.message}`);
            }

            attempts++;
            setTimeout(check, interval);
        };
        check();
    };

    const refreshImageHistory = async () => {
        try {
            const cmd = `docker exec zerogravity find /tmp/.agcache/.gemini/antigravity/brain/ -name "*.png" -printf "%T@ %p\\n" | sort -rn`;
            const output = await invoke<string>('run_shell_command', { command: cmd });
            if (!output) {
                setImageHistory([]);
                return;
            }
            const lines = output.trim().split('\n');
            const history = lines.map(line => {
                const [ts, path] = line.split(' ');
                if (!ts || !path) return null;
                const parts = path.split('/');
                const filename = parts[parts.length - 1];
                const folderUuid = parts[parts.length - 2];
                return {
                    url: `${apiBase}/v1/images/${folderUuid}/${filename}`,
                    timestamp: parseFloat(ts) * 1000
                };
            }).filter(item => item !== null) as { url: string; timestamp: number }[];

            setImageHistory(history);
        } catch (e) {
            console.error('Failed to refresh image history', e);
        }
    };

    useEffect(() => {
        if (rightSidebarTab === 'history') {
            refreshImageHistory();
        }
    }, [rightSidebarTab]);

    const sendMessage = async (overridePrompt?: string) => {
        const currentInput = (overridePrompt || input).trim();
        if ((!currentInput && pendingImages.length === 0) || isStreaming) return;

        const userMessage: ChatMessage = {
            role: 'user',
            content: currentInput,
            images: pendingImages.length > 0 ? [...pendingImages] : undefined,
            timestamp: Date.now(),
        };

        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setPendingImages([]);
        setIsStreaming(true);

        const apiMessages = [];
        if (systemPrompt) apiMessages.push({ role: 'system', content: systemPrompt });
        messages.forEach(m => apiMessages.push({ role: m.role, content: m.content }));
        if (userMessage.images) {
            const contentParts: any[] = [{ type: 'text', text: userMessage.content }];
            userMessage.images.forEach(img => contentParts.push({ type: 'image_url', image_url: { url: img } }));
            apiMessages.push({ role: 'user', content: contentParts });
        } else {
            apiMessages.push({ role: 'user', content: userMessage.content });
        }

        let chatcmplId = 'unknown';
        let fullContent = '';
        let fullReasoning = '';
        let buffer = '';
        let isImageTaskDetected = false;

        const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: '',
            reasoning: '',
            timestamp: Date.now(),
            model: selectedModel,
            id: 'pending'
        };
        setMessages(prev => [...prev, assistantMessage]);

        const processLine = (line: string) => {
            const dataStr = line.trim().startsWith('data:') ? line.trim().slice(5).trim() : line.trim();
            if (!dataStr || dataStr === '[DONE]') return;
            try {
                const parsed = JSON.parse(dataStr);

                // Handle SSE-embedded errors (like 429 Rate Limits from proxy)
                if (parsed.error) {
                    const errMsg = parsed.error.message || `Error ${parsed.error.code}: ${parsed.error.type}`;
                    setMessages(prev => {
                        const updated = [...prev];
                        if (updated.length > 0) {
                            updated[updated.length - 1].content += `\n\n❌ **服务限额 (429)**: ${errMsg}`;
                            updated[updated.length - 1].isPolling = false;
                        }
                        return updated;
                    });
                    return;
                }

                let r_inc = '';
                let c_inc = '';

                if (parsed.candidates) {
                    // Gemini Native Format
                    const candidate = parsed.candidates[0];
                    if (candidate.content && candidate.content.parts) {
                        c_inc = candidate.content.parts[0].text || '';
                    }
                } else {
                    // OpenAI Format
                    const delta = parsed.choices?.[0]?.delta;
                    if (delta?.tool_calls?.some((tc: any) => tc.function?.name === 'generate_image')) isImageTaskDetected = true;
                    if (parsed.id && chatcmplId === 'unknown') {
                        chatcmplId = parsed.id;
                        setMessages(prev => {
                            const updated = [...prev];
                            if (updated.length > 0) updated[updated.length - 1].id = chatcmplId;
                            return updated;
                        });
                    }

                    r_inc = delta?.reasoning_content || '';
                    c_inc = delta?.content || parsed.choices?.[0]?.text || '';
                }

                if (r_inc) {
                    fullReasoning += r_inc;
                    setMessages(prev => {
                        const updated = [...prev];
                        if (updated.length > 0) updated[updated.length - 1].reasoning = fullReasoning;
                        return updated;
                    });
                }
                if (c_inc) {
                    fullContent += c_inc;
                    setMessages(prev => {
                        const updated = [...prev];
                        if (updated.length > 0) updated[updated.length - 1].content = fullContent;
                        return updated;
                    });
                }
            } catch (e) { }
        };

        try {
            const endpoint = ENDPOINT_TYPES.find(e => e.id === selectedEndpointType);
            let url = `${apiBase}${endpoint?.path || ''}/chat/completions`;
            let body: any = {
                model: selectedModel,
                messages: [],
                stream: true,
                temperature: 0.7,
                max_tokens: 4096
            };

            if (selectedEndpointType === 'gemini') {
                url = `${apiBase}/v1beta/models/${selectedModel}:streamGenerateContent?alt=sse`;
                const contents: any[] = [];
                messages.forEach(m => {
                    contents.push({
                        role: m.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: m.content }]
                    });
                });
                const currentParts: any[] = [{ text: userMessage.content }];
                if (userMessage.images) {
                    userMessage.images.forEach(img => {
                        const match = img.match(/^data:(image\/\w+);base64,(.+)$/);
                        if (match) {
                            currentParts.push({
                                inline_data: {
                                    mime_type: match[1],
                                    data: match[2]
                                }
                            });
                        }
                    });
                }
                contents.push({ role: 'user', parts: currentParts });
                body = {
                    contents,
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 4096,
                    }
                };
                if (systemPrompt) {
                    body.system_instruction = { parts: [{ text: systemPrompt }] };
                }
            } else {
                if (systemPrompt) body.messages.push({ role: 'system', content: systemPrompt });
                messages.forEach(m => body.messages.push({ role: m.role, content: m.content }));
                if (userMessage.images) {
                    const contentParts: any[] = [{ type: 'text', text: userMessage.content }];
                    userMessage.images.forEach(img => contentParts.push({ type: 'image_url', image_url: { url: img } }));
                    body.messages.push({ role: 'user', content: contentParts });
                } else {
                    body.messages.push({ role: 'user', content: userMessage.content });
                }
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            logToFile(`HTTP_STATUS: ${response.status}`);

            if (!response.ok) {
                const errText = await response.text();
                logToFile(`HTTP_ERROR_BODY: ${errText}`);
                let errMsg = errText;
                try {
                    const errJson = JSON.parse(errText);
                    errMsg = errJson.error?.message || errJson.message || errText;
                } catch (e) { }
                throw new Error(errMsg);
            }
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        // logToFile(`RAW_LINE: ${line}`);
                        processLine(line);
                    }
                }
                if (buffer) {
                    logToFile(`RAW_LINE_END: ${buffer}`);
                    processLine(buffer);
                }
            }
        } catch (error: any) {
            setMessages(prev => {
                const updated = [...prev];
                if (updated.length > 0) updated[updated.length - 1].content = `❌ Error: ${error.message}`;
                return updated;
            });
        } finally {
            setIsStreaming(false);
            const looksLikeImageIntent = /(画|绘|生成|图|像|照片|猫|狗|image|picture|photo|draw|create)/i.test(currentInput);
            const isConfirmedImageTask = isImageTaskDetected || selectedModel.includes('image') || looksLikeImageIntent;
            if (isConfirmedImageTask && chatcmplId !== 'unknown') {
                setMessages(prev => prev.map(m => m.id === chatcmplId ? { ...m, isPolling: true } : m));
                pollForImage(chatcmplId, assistantMessage.timestamp);
            }
            setTimeout(() => inputRef.current?.focus(), 10);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        files.forEach(file => {
            const reader = new FileReader();
            reader.onloadend = () => setPendingImages(prev => [...prev, reader.result as string]);
            reader.readAsDataURL(file);
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <div className="h-full flex flex-col bg-base-100 font-sans selection:bg-primary/30">
            {/* Header Toolbar */}
            <header className="flex items-center justify-between px-4 py-2 bg-base-200/50 border-b border-base-content/5 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-primary/10 border border-primary/20">
                        <Sparkles className="w-3.5 h-3.5 text-primary" />
                        <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Playground</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative" ref={endpointDropdownRef}>
                        <button
                            onClick={() => setShowEndpointDropdown(!showEndpointDropdown)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-base-content/5 hover:bg-base-content/10 transition-all text-xs font-medium border border-transparent hover:border-base-content/10"
                        >
                            <Terminal className="w-3.5 h-3.5 opacity-50" />
                            {ENDPOINT_TYPES.find(e => e.id === selectedEndpointType)?.label}
                            <ChevronDown className="w-3.5 h-3.5 opacity-50" />
                        </button>
                        {showEndpointDropdown && (
                            <div className="absolute right-0 top-10 w-40 z-[100] bg-base-100 border border-base-content/10 rounded-2xl shadow-2xl py-2">
                                {ENDPOINT_TYPES.map(e => (
                                    <button
                                        key={e.id}
                                        onClick={() => { setSelectedEndpointType(e.id); setShowEndpointDropdown(false); }}
                                        className={`w-full flex items-center justify-between px-4 py-2.5 text-xs hover:bg-primary/5 transition-colors ${selectedEndpointType === e.id ? 'text-primary font-bold' : 'text-base-content/70'}`}
                                    >
                                        {e.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="relative" ref={dropdownRef}>
                        <button
                            onClick={() => setShowModelDropdown(!showModelDropdown)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-base-content/5 hover:bg-base-content/10 transition-all text-xs font-medium border border-transparent hover:border-base-content/10"
                        >
                            {(() => {
                                const m = AVAILABLE_MODELS.find(m => m.id === selectedModel);
                                const Icon = m?.icon || Bot;
                                return <><Icon className="w-3.5 h-3.5" />{m?.label}</>;
                            })()}
                            <ChevronDown className="w-3.5 h-3.5 opacity-50" />
                        </button>
                        {showModelDropdown && (
                            <div className="absolute right-0 top-10 w-56 z-[100] bg-base-100 border border-base-content/10 rounded-2xl shadow-2xl py-2">
                                {AVAILABLE_MODELS.map(m => (
                                    <button
                                        key={m.id}
                                        onClick={() => { setSelectedModel(m.id); setShowModelDropdown(false); }}
                                        className={`w-full flex items-center justify-between px-4 py-2.5 text-xs hover:bg-primary/5 transition-colors ${selectedModel === m.id ? 'text-primary font-bold' : 'text-base-content/70'}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <m.icon className={`w-4 h-4 ${selectedModel === m.id ? 'text-primary' : 'opacity-40'}`} />
                                            {m.label}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="w-px h-4 bg-base-content/10 mx-1" />
                    <button onClick={() => setRightSidebarTab(rightSidebarTab === 'history' ? null : 'history')} className={`p-2 rounded-full transition-colors ${rightSidebarTab === 'history' ? 'bg-primary/10 text-primary' : 'hover:bg-base-content/5 text-base-content/40'}`}>
                        <ImageIcon className="w-4 h-4" />
                    </button>
                    <button onClick={() => setRightSidebarTab(rightSidebarTab === 'settings' ? null : 'settings')} className={`p-2 rounded-full transition-colors ${rightSidebarTab === 'settings' ? 'bg-primary/10 text-primary' : 'hover:bg-base-content/5 text-base-content/40'}`}>
                        <Settings2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => setMessages([])} className="p-2 rounded-full hover:bg-error/10 text-base-content/40 hover:text-error transition-colors">
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden relative">
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-8">
                        {messages.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center py-40 animate-in fade-in duration-500">
                                <div className="mb-12">
                                    <Bot className="w-16 h-16 text-primary/20" />
                                </div>
                                <div className="flex flex-wrap justify-center gap-1.5 max-w-4xl">
                                    {CATEGORIES.map((cat, i) => (
                                        <button
                                            key={i}
                                            onClick={() => sendMessage(cat.prompt)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-base-content/5 hover:bg-primary/10 hover:text-primary transition-all text-[11px] font-medium border border-transparent hover:border-primary/20 whitespace-nowrap"
                                        >
                                            <cat.icon className="w-3 h-3 opacity-40" />
                                            {cat.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            messages.map((msg, idx) => (
                                <div key={idx} className={`flex gap-4 group ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
                                    {msg.role === 'assistant' && (
                                        <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 shadow-sm"><Bot className="w-4 h-4 text-primary" /></div>
                                    )}
                                    <div className={`max-w-[85%] space-y-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                        <div className={`relative px-2.5 py-1.5 rounded-[1rem] text-[10.5px] leading-snug shadow-sm transition-all min-h-[32px] min-w-[40px] flex items-center ${msg.role === 'user' ? 'bg-primary text-primary-content rounded-tr-none' : 'bg-base-200 text-base-content rounded-tl-none border border-base-content/5'}`}>
                                            <div className="prose prose-invert max-w-none prose-p:my-0.5 prose-headings:text-[11px] prose-headings:my-1 prose-pre:my-1 prose-pre:p-2 prose-code:text-[9px] text-[10px] w-full">
                                                {msg.role === 'assistant' && (msg.reasoning || (!msg.content && !msg.reasoning)) && (
                                                    <div className={`mb-1.5 ${msg.content ? 'pb-1.5 border-b border-white/5 opacity-40' : ''}`}>
                                                        <div className="flex items-center gap-1.5 italic text-[9px] mb-1">
                                                            <Loader2 className={`w-2.5 h-2.5 ${(!msg.content && isStreaming) ? 'animate-spin' : ''}`} />
                                                            {msg.content ? '已思考' : '思考中'}...
                                                        </div>
                                                        {msg.reasoning && (
                                                            <div className="text-[9px] leading-tight font-light opacity-60 bg-black/10 p-1.5 rounded-lg border border-white/5 prose-p:my-0">
                                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.reasoning}</ReactMarkdown>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {msg.content ? (
                                                    <ReactMarkdown
                                                        remarkPlugins={[remarkGfm]}
                                                        components={{
                                                            pre: ({ node, ...props }) => <div className="p-2 my-1 rounded-lg overflow-x-auto bg-black/20 border border-white/5"><pre {...props} /></div>,
                                                            code: ({ node, className, children, ...props }) => {
                                                                const match = /language-(\w+)/.exec(className || '');
                                                                return match ? <code className={className} {...props}>{children}</code> : <code className="px-1 py-0.5 rounded bg-base-content/10 font-mono text-[9px]" {...props}>{children}</code>
                                                            }
                                                        }}
                                                    >{msg.content}</ReactMarkdown>
                                                ) : null}
                                            </div>
                                        </div>
                                        {((msg.images && msg.images.length > 0) || msg.isPolling) && (
                                            <div className="grid grid-cols-2 gap-2 w-full max-w-md pt-1">
                                                {msg.images?.map((img, i) => (
                                                    <div key={i} className="group/img relative rounded-xl overflow-hidden shadow-md border border-base-content/10 aspect-square bg-base-content/5">
                                                        <img src={img} alt="Generated" className="w-full h-full object-cover transition-transform duration-700 group-hover/img:scale-110" />
                                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity flex items-end p-3">
                                                            <a href={img} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-white uppercase tracking-widest hover:underline">查看大图</a>
                                                        </div>
                                                    </div>
                                                ))}
                                                {msg.isPolling && (
                                                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-primary/30 bg-primary/5 aspect-square animate-pulse">
                                                        <Loader2 className="w-6 h-6 text-primary animate-spin mb-2" />
                                                        <span className="text-[10px] font-bold text-primary/60 uppercase tracking-tighter">正在绘制图像...</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <div className="flex items-center gap-2 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <span className="text-[10px] font-mono text-base-content/30 uppercase">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            {msg.model && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-base-content/5 text-base-content/40 uppercase tracking-tighter">{msg.model}</span>}
                                        </div>
                                    </div>
                                    {msg.role === 'user' && (<div className="w-8 h-8 rounded-full bg-base-content/5 border border-base-content/10 flex items-center justify-center shrink-0 shadow-sm overflow-hidden"><User className="w-4 h-4 text-base-content/60" /></div>)}
                                </div>
                            ))
                        )}
                        <div ref={messagesEndRef} className="h-4" />
                    </div>
                </div>

                {/* Right Sidebar */}
                {rightSidebarTab && (
                    <aside className="w-80 bg-base-200/50 border-l border-base-content/5 flex flex-col animate-in slide-in-from-right duration-300">
                        {rightSidebarTab === 'settings' ? (
                            <div className="p-5 flex flex-col gap-6">
                                <section className="space-y-3">
                                    <div className="flex items-center gap-2 text-[10px] font-bold text-base-content/40 uppercase tracking-widest"><Command className="w-3 h-3" />System Prompt</div>
                                    <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} className="w-full h-40 bg-base-100 border border-base-content/5 rounded-2xl p-4 text-[12px] focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-all resize-none shadow-inner" placeholder="助手行为定义..." />
                                </section>
                                <section className="space-y-4">
                                    <div className="flex items-center gap-2 text-[10px] font-bold text-base-content/40 uppercase tracking-widest"><History className="w-3 h-3" />Session Context</div>
                                    <div className="p-4 rounded-2xl bg-base-100 border border-base-content/5 flex items-center justify-between">
                                        <span className="text-xs text-base-content/60">历史消息</span>
                                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold">{messages.length}</span>
                                    </div>
                                </section>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col overflow-hidden">
                                <div className="p-5 flex items-center justify-between border-b border-base-content/5">
                                    <div className="flex items-center gap-2 text-[10px] font-bold text-base-content/40 uppercase tracking-widest"><ImageIcon className="w-3 h-3" />Image Gallery</div>
                                    <button onClick={() => setImageHistory([])} className="p-1.5 rounded-lg hover:bg-error/10 text-error/60 hover:text-error transition-all flex items-center gap-1.5 text-[10px] font-bold uppercase"><Trash className="w-3 h-3" />Clear</button>
                                </div>
                                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                                    {imageHistory.length === 0 ? (
                                        <div className="h-full flex flex-col items-center justify-center opacity-20"><ImageIcon className="w-12 h-12 mb-2" /><p className="text-[10px] font-bold uppercase tracking-widest">No Images Yet</p></div>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-3">
                                            {imageHistory.map((img, i) => (
                                                <div key={i} className="group relative rounded-xl overflow-hidden aspect-square border border-base-content/5 shadow-sm bg-base-300/30">
                                                    <img src={img.url} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                                                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex flex-col items-center justify-center gap-2 p-2">
                                                        <a href={img.url} target="_blank" rel="noreferrer" className="p-2 rounded-full bg-white/20 hover:bg-white/40 transition-colors">
                                                            <LayoutGrid className="w-4 h-4 text-white" />
                                                        </a>
                                                        <span className="text-[9px] font-mono text-white/70 bg-black/40 px-1.5 py-0.5 rounded uppercase tracking-tighter">
                                                            {new Date(img.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    <div className="absolute bottom-1 right-1 opacity-40 group-hover:opacity-0 transition-opacity">
                                                        <span className="text-[8px] font-mono bg-black/50 text-white px-1 rounded">{new Date(img.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </aside>
                )}
            </div>

            <footer className="p-3 md:p-4 bg-base-100 shrink-0">
                <div className="max-w-4xl mx-auto">
                    {pendingImages.length > 0 && (
                        <div className="flex gap-2 mb-3 animate-in slide-in-from-bottom-2">
                            {pendingImages.map((img, i) => (
                                <div key={i} className="group relative w-12 h-12 rounded-lg overflow-hidden border border-primary/20 shadow-lg">
                                    <img src={img} className="w-full h-full object-cover" />
                                    <button onClick={() => setPendingImages(p => p.filter((_, idx) => idx !== i))} className="absolute -top-1 -right-1 bg-error text-white rounded-full p-0.5 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"><X className="w-3 h-3" /></button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="relative group/input">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/10 to-purple-500/10 rounded-[2rem] blur-lg opacity-0 group-hover/input:opacity-100 transition-opacity duration-500" />
                        <div className="relative flex items-end gap-1.5 bg-base-200/90 backdrop-blur-2xl rounded-[1.8rem] p-2 border border-base-content/5 shadow-xl focus-within:border-primary/20 transition-all">
                            <input type="file" ref={fileInputRef} onChange={handleFileUpload} multiple accept="image/*" className="hidden" />
                            <button onClick={() => fileInputRef.current?.click()} className="p-2 text-base-content/25 hover:text-primary transition-all active:scale-90"><ImagePlus className="w-4 h-4" /></button>
                            <textarea ref={inputRef} rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="Ask anything..." className="flex-1 bg-transparent border-none focus:ring-0 text-[11px] py-1.5 max-h-32 scrollbar-hide resize-none leading-tight placeholder:text-base-content/20" />
                            <button onClick={() => sendMessage()} disabled={isStreaming || (!input.trim() && pendingImages.length === 0)} className={`p-2 rounded-full transition-all duration-300 ${(input.trim() || pendingImages.length > 0) && !isStreaming ? 'bg-primary text-primary-content shadow-lg scale-95' : 'bg-base-content/5 text-base-content/10 scale-90'}`}><Send className="w-3.5 h-3.5" /></button>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
}

export default Chat;
