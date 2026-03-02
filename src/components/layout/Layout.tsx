import { Outlet, useLocation } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import Navbar from '../navbar/Navbar';
import ToastContainer from '../common/ToastContainer';
import Chat from '../../pages/Chat';
import { useViewStore } from '../../stores/useViewStore';
import MiniView from './MiniView';
import { useEffect } from 'react';
import { isTauri } from '../../utils/env';
import { ensureFullViewState } from '../../utils/windowManager';

function Layout() {
    const { isMiniView } = useViewStore();
    const location = useLocation();
    const isChat = location.pathname === '/chat';

    useEffect(() => {
        if (!isMiniView && isTauri()) {
            ensureFullViewState();
        }
    }, [isMiniView]);

    if (isMiniView) {
        return (
            <>
                <ToastContainer />
                <MiniView />
            </>
        );
    }

    return (
        <div className="h-screen flex flex-col bg-base-200 text-base-content">
            {/* 全局窗口拖拽区域 */}
            <div
                className="fixed top-0 left-0 right-0 h-9"
                style={{
                    zIndex: 9999,
                    backgroundColor: 'rgba(0,0,0,0.001)',
                    cursor: 'default',
                    userSelect: 'none',
                    WebkitUserSelect: 'none'
                }}
                data-tauri-drag-region
                onMouseDown={() => {
                    getCurrentWindow().startDragging();
                }}
            />
            <ToastContainer />
            <Navbar />
            <main className="flex-1 overflow-hidden flex flex-col relative">
                {/* Persistent Chat */}
                <div className={isChat ? "h-full w-full block" : "hidden"}>
                    <Chat />
                </div>
                {/* Other Routes */}
                <div className={isChat ? "hidden" : "h-full w-full flex flex-col"}>
                    <Outlet />
                </div>
            </main>
        </div>
    );
}

export default Layout;
