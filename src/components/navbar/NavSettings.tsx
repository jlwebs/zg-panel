import { Sun, Moon, LogOut, HelpCircle, X, Minimize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LanguageDropdown, MoreDropdown } from './NavDropdowns';
import { LANGUAGES } from './constants';
import { isTauri } from '../../utils/env';
import { useViewStore } from '../../stores/useViewStore';
import { useState } from 'react';
import { useConfigStore } from '../../stores/useConfigStore';

interface NavSettingsProps {
    theme: 'light' | 'dark';
    currentLanguage: string;
    onThemeToggle: (event: React.MouseEvent<HTMLButtonElement>) => void;
    onLanguageChange: (langCode: string) => void;
}

function HelpGuideModal({ onClose }: { onClose: () => void }) {
    const config = useConfigStore(state => state.config);
    const proxyPort = config?.proxy?.port || 8741;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-base-100 w-[680px] max-h-[80vh] rounded-xl border border-base-content/10 shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 bg-base-content/3 border-b border-base-content/5">
                    <div className="flex items-center gap-2">
                        <HelpCircle className="w-4 h-4 text-primary" />
                        <span className="text-sm font-bold text-base-content">Docker 对接指南</span>
                    </div>
                    <button onClick={onClose} className="btn btn-xs btn-ghost btn-circle text-base-content/40 hover:text-base-content">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Content */}
                <div className="overflow-y-auto max-h-[calc(80vh-52px)] p-5 space-y-4 text-sm text-base-content/80">

                    {/* Quick Start */}
                    <section>
                        <h3 className="text-xs font-bold text-primary uppercase tracking-wider mb-2">🚀 快速开始</h3>
                        <p className="text-[12px] leading-relaxed mb-2">
                            ZeroGravity Manager 通过 Docker 容器管理代理服务。确保本机已安装 Docker，且容器名为 <code className="px-1.5 py-0.5 bg-base-content/5 rounded text-primary font-mono text-[11px]">zerogravity</code>。
                        </p>
                        <div className="bg-[#0d1117] rounded-lg p-3 font-mono text-[11px] text-white/70 space-y-1">
                            <div><span className="text-green-400">$</span> docker pull ghcr.io/nikketryard/zerogravity:latest</div>
                            <div><span className="text-green-400">$</span> docker run -d --name zerogravity -p {proxyPort}:{proxyPort} \</div>
                            <div className="pl-4">ghcr.io/nikketryard/zerogravity:latest</div>
                        </div>
                    </section>

                    {/* Container Recognition */}
                    <section>
                        <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2">🔍 容器识别原理</h3>
                        <p className="text-[12px] leading-relaxed mb-2">
                            本管理器通过以下方式识别并管理 Docker 容器：
                        </p>
                        <div className="space-y-1.5">
                            {[
                                { label: '容器名称', desc: '固定为 zerogravity，通过 docker inspect 检测状态' },
                                { label: '代理端口', desc: `默认映射 ${proxyPort} 端口到宿主机，所有 API 请求发往 localhost:${proxyPort}` },
                                { label: '健康检查', desc: '定期调用 /health 端点确认服务正常运行' },
                                { label: '日志获取', desc: '通过 docker logs --tail N zerogravity 获取容器日志' },
                            ].map((item, i) => (
                                <div key={i} className="flex gap-2 bg-base-content/3 rounded-lg px-3 py-2 border border-base-content/5">
                                    <span className="text-[11px] font-bold text-cyan-400 shrink-0 w-16">{item.label}</span>
                                    <span className="text-[11px] text-base-content/60">{item.desc}</span>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Common Issues */}
                    <section>
                        <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2">⚠️ 常见问题</h3>
                        <div className="space-y-2">
                            <div className="border-l-2 border-red-400/50 pl-3">
                                <p className="text-[12px] font-bold text-base-content/80">服务状态显示"已停止"或"error"</p>
                                <p className="text-[11px] text-base-content/50 mt-0.5">确认 Docker Desktop 已启动，且 zerogravity 容器存在。在终端执行 <code className="px-1 py-0.5 bg-base-content/5 rounded font-mono text-[10px]">docker ps -a</code> 检查。</p>
                            </div>
                            <div className="border-l-2 border-red-400/50 pl-3">
                                <p className="text-[12px] font-bold text-base-content/80">健康检查显示"异常"</p>
                                <p className="text-[11px] text-base-content/50 mt-0.5">容器可能正在启动中（需 10-30 秒），或端口 {proxyPort} 被其他进程占用。执行 <code className="px-1 py-0.5 bg-base-content/5 rounded font-mono text-[10px]">lsof -i :{proxyPort}</code> 排查。</p>
                            </div>
                            <div className="border-l-2 border-red-400/50 pl-3">
                                <p className="text-[12px] font-bold text-base-content/80">模型数量为 0</p>
                                <p className="text-[11px] text-base-content/50 mt-0.5">需要先在账号页添加 Google 账号并配置 cookie/refresh_token，服务才会加载可用模型。</p>
                            </div>
                            <div className="border-l-2 border-amber-400/50 pl-3">
                                <p className="text-[12px] font-bold text-base-content/80">容器名不是 zerogravity？</p>
                                <p className="text-[11px] text-base-content/50 mt-0.5">本管理器硬编码容器名为 <code className="px-1 py-0.5 bg-base-content/5 rounded font-mono text-[10px]">zerogravity</code>。如使用自定义名称，请重新创建：<code className="px-1 py-0.5 bg-base-content/5 rounded font-mono text-[10px]">docker rename 旧名 zerogravity</code></p>
                            </div>
                        </div>
                    </section>

                    {/* API Reference */}
                    <section>
                        <h3 className="text-xs font-bold text-green-400 uppercase tracking-wider mb-2">📡 API 端点说明</h3>
                        <div className="bg-[#0d1117] rounded-lg p-3 font-mono text-[11px] text-white/60 space-y-1">
                            <div><span className="text-green-400">POST</span> /v1/chat/completions    <span className="text-white/30">← OpenAI 兼容接口</span></div>
                            <div><span className="text-green-400">POST</span> /v1/responses           <span className="text-white/30">← OpenAI Responses API</span></div>
                            <div><span className="text-rose-400">POST</span> /v1beta/models/:model:generateContent  <span className="text-white/30">← Gemini 原生</span></div>
                            <div><span className="text-cyan-400">GET </span> /v1/models              <span className="text-white/30">← 可用模型列表</span></div>
                            <div><span className="text-cyan-400">GET </span> /v1/quota               <span className="text-white/30">← 配额信息</span></div>
                            <div><span className="text-cyan-400">GET </span> /health                 <span className="text-white/30">← 健康检查</span></div>
                            <div><span className="text-cyan-400">GET </span> /v1/usage               <span className="text-white/30">← 使用统计</span></div>
                        </div>
                    </section>

                    {/* CLI commands */}
                    <section>
                        <h3 className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">💻 实用命令</h3>
                        <p className="text-[11px] text-base-content/50 mb-2">可在日志页的 ZG Terminal 中直接执行：</p>
                        <div className="bg-[#0d1117] rounded-lg p-3 font-mono text-[11px] text-white/60 space-y-1">
                            <div><span className="text-white/30"># 查看容器状态</span></div>
                            <div><span className="text-green-400">$</span> docker ps --filter name=zerogravity</div>
                            <div className="mt-1"><span className="text-white/30"># 查看实时日志</span></div>
                            <div><span className="text-green-400">$</span> docker logs -f --tail 50 zerogravity</div>
                            <div className="mt-1"><span className="text-white/30"># 进入容器 shell</span></div>
                            <div><span className="text-green-400">$</span> docker exec -it zerogravity /bin/sh</div>
                            <div className="mt-1"><span className="text-white/30"># 查看资源占用</span></div>
                            <div><span className="text-green-400">$</span> docker stats zerogravity --no-stream</div>
                            <div className="mt-1"><span className="text-white/30"># 测试 API 连通性</span></div>
                            <div><span className="text-green-400">$</span> curl -s http://localhost:{proxyPort}/health | jq</div>
                        </div>
                    </section>

                </div>
            </div>
        </div>
    );
}

/**
 * 设置按钮组件
 */
export function NavSettings({
    theme,
    currentLanguage,
    onThemeToggle,
    onLanguageChange
}: NavSettingsProps) {
    const { t } = useTranslation();
    const { setMiniView } = useViewStore();
    const [showHelp, setShowHelp] = useState(false);

    const handleLogout = () => {
        sessionStorage.removeItem('abv_admin_api_key');
        localStorage.removeItem('abv_admin_api_key');
        window.location.reload();
    };

    return (
        <>
            {/* 独立按钮 (≥ 480px) */}
            <div className="hidden min-[480px]:flex items-center gap-1.5">
                {/* 迷你监控悬浮窗 */}
                <button
                    onClick={() => setMiniView(true)}
                    className="w-8 h-8 rounded-full bg-gray-100 dark:bg-base-200 hover:bg-gray-200 dark:hover:bg-base-100 flex items-center justify-center transition-colors"
                    title={t('nav.mini_view', '迷你监控')}
                >
                    <Minimize2 className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                </button>

                {/* 主题切换按钮 */}
                <button
                    onClick={onThemeToggle}
                    className="w-8 h-8 rounded-full bg-gray-100 dark:bg-base-200 hover:bg-gray-200 dark:hover:bg-base-100 flex items-center justify-center transition-colors"
                    title={theme === 'light' ? t('nav.theme_to_dark') : t('nav.theme_to_light')}
                >
                    {theme === 'light' ? (
                        <Moon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                    ) : (
                        <Sun className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                    )}
                </button>

                {/* 语言切换下拉菜单 */}
                <LanguageDropdown
                    currentLanguage={currentLanguage}
                    languages={LANGUAGES}
                    onLanguageChange={onLanguageChange}
                />

                {/* 帮助按钮 */}
                <button
                    onClick={() => setShowHelp(true)}
                    className="w-8 h-8 rounded-full bg-gray-100 dark:bg-base-200 hover:bg-gray-200 dark:hover:bg-base-100 flex items-center justify-center transition-colors"
                    title="Docker 对接指南"
                >
                    <HelpCircle className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                </button>

                {/* 登出按钮 - 仅 Web 模式显示 */}
                {!isTauri() && (
                    <button
                        onClick={handleLogout}
                        className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 flex items-center justify-center transition-colors"
                        title={t('nav.logout', '登出')}
                    >
                        <LogOut className="w-4 h-4 text-red-600 dark:text-red-400" />
                    </button>
                )}
            </div>

            {/* 更多菜单 (< 480px) */}
            <div className="min-[480px]:hidden">
                <MoreDropdown
                    theme={theme}
                    currentLanguage={currentLanguage}
                    languages={LANGUAGES}
                    onThemeToggle={onThemeToggle}
                    onLanguageChange={onLanguageChange}
                />
            </div>

            {/* Help Guide Modal */}
            {showHelp && <HelpGuideModal onClose={() => setShowHelp(false)} />}
        </>
    );
}
