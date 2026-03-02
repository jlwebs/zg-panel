import { useState } from 'react';
import { Github, Heart, ExternalLink, Globe, Palette } from 'lucide-react';
import { useConfigStore } from '../stores/useConfigStore';

import { useTranslation } from 'react-i18next';

function Settings() {
    const { i18n } = useTranslation();
    const { config, updateLanguage, updateTheme } = useConfigStore();
    const [activeTab, setActiveTab] = useState<'general' | 'about'>('general');

    const tabs = [
        { id: 'general' as const, label: '通用' },
        { id: 'about' as const, label: '关于' },
    ];

    return (
        <div className="h-full w-full overflow-y-auto">
            <div className="px-4 py-3 space-y-3 max-w-7xl mx-auto">

                {/* Tab Bar + Save */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-0.5 bg-base-content/5 rounded-lg p-0.5">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`px-4 py-1.5 rounded-md text-[11px] font-bold font-mono uppercase tracking-wider transition-all ${activeTab === tab.id
                                    ? 'bg-primary text-primary-content shadow-sm'
                                    : 'text-base-content/40 hover:text-base-content/70'
                                    }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* General Settings */}
                {activeTab === 'general' && (
                    <div className="space-y-2">

                        {/* Language */}
                        <div className="bg-base-100/80 rounded-lg p-3 border border-base-content/5">
                            <div className="flex items-center gap-2 mb-2">
                                <Globe className="w-3.5 h-3.5 text-cyan-400" />
                                <span className="text-[11px] font-bold font-mono text-base-content/70 uppercase tracking-wider">语言 / Language</span>
                            </div>
                            <select
                                className="select select-sm w-full bg-base-content/5 border-base-content/10 text-base-content text-[12px] font-mono"
                                value={config?.language || 'zh'}
                                onChange={(e) => {
                                    const lang = e.target.value;
                                    i18n.changeLanguage(lang);
                                    updateLanguage(lang);
                                }}
                            >
                                <option value="zh">简体中文</option>
                                <option value="zh-TW">繁體中文</option>
                                <option value="en">English</option>
                                <option value="ja">日本語</option>
                                <option value="tr">Türkçe</option>
                                <option value="vi">Tiếng Việt</option>
                                <option value="pt">Português</option>
                                <option value="ko">한국어</option>
                                <option value="ru">Русский</option>
                                <option value="ar">العربية</option>
                                <option value="es">Español</option>
                                <option value="my">Bahasa Melayu</option>
                            </select>
                        </div>

                        {/* Theme */}
                        <div className="bg-base-100/80 rounded-lg p-3 border border-base-content/5">
                            <div className="flex items-center gap-2 mb-2">
                                <Palette className="w-3.5 h-3.5 text-purple-400" />
                                <span className="text-[11px] font-bold font-mono text-base-content/70 uppercase tracking-wider">主题 / Theme</span>
                            </div>
                            <select
                                className="select select-sm w-full bg-base-content/5 border-base-content/10 text-base-content text-[12px] font-mono"
                                value={config?.theme || 'dark'}
                                onChange={(e) => {
                                    updateTheme(e.target.value);
                                }}
                            >
                                <option value="dark">🌙 暗色 (Synthwave)</option>
                                <option value="light">☀️ 亮色 (Retro)</option>
                            </select>
                        </div>

                        {/* Docker Config Info */}
                        <div className="bg-base-100/80 rounded-lg p-3 border border-base-content/5">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-[11px] font-bold font-mono text-base-content/70 uppercase tracking-wider">🐳 Docker 配置</span>
                            </div>
                            <div className="space-y-1.5 text-[11px] font-mono text-base-content/50">
                                <div className="flex justify-between">
                                    <span>容器名称</span>
                                    <span className="text-base-content/80">zerogravity</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>API 地址</span>
                                    <span className="text-cyan-400">http://localhost:{config?.proxy?.port || 8741}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>刷新间隔</span>
                                    <span className="text-base-content/80">15s</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* About Tab */}
                {activeTab === 'about' && (
                    <div className="space-y-2">
                        <div className="bg-base-100/80 rounded-lg p-4 border border-base-content/5 text-center">
                            <div className="text-lg font-bold text-base-content mb-1">ZeroGravity Manager</div>
                            <div className="text-[11px] font-mono text-base-content/40 mb-3">v4.1.21 · Tauri + React</div>

                            <div className="flex items-center justify-center gap-3 mb-4">
                                <a
                                    href="https://github.com/NikkeTryHard/zerogravity"
                                    target="_blank"
                                    rel="noopener"
                                    className="btn btn-xs btn-ghost gap-1 text-[10px] font-mono text-base-content/50 hover:text-base-content"
                                >
                                    <Github className="w-3.5 h-3.5" /> GitHub
                                    <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                            </div>

                            <div className="border-t border-base-content/5 pt-3">
                                <p className="text-[10px] text-base-content/30 font-mono">
                                    Built with <Heart className="w-3 h-3 inline text-red-400" /> by the community
                                </p>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}

export default Settings;
