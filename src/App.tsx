import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import ProxyLayer from './pages/ProxyLayer';
import CanvasPage from './pages/CanvasPage';
import ThemeManager from './components/common/ThemeManager';
import { useEffect } from 'react';
import { useConfigStore } from './stores/useConfigStore';
import { useTranslation } from 'react-i18next';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        index: true,
        element: <Dashboard />,
      },
      {
        path: 'logs',
        element: <Logs />,
      },
      {
        path: 'accounts',
        element: <Accounts />,
      },
      {
        path: 'chat',
        element: null, // Rendered in Layout instead for persistence
      },
      {
        path: 'proxy',
        element: <ProxyLayer />,
      },
      {
        path: 'canvas',
        element: <CanvasPage />,
      },
      {
        path: 'settings',
        element: <Settings />,
      },
    ],
  },
]);

function App() {
  const { config, loadConfig } = useConfigStore();
  const { i18n } = useTranslation();

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Sync language from config
  useEffect(() => {
    if (config?.language) {
      i18n.changeLanguage(config.language);
      if (config.language === 'ar') {
        document.documentElement.dir = 'rtl';
      } else {
        document.documentElement.dir = 'ltr';
      }
    }
  }, [config?.language, i18n]);

  return (
    <>
      <ThemeManager />
      <RouterProvider router={router} />
    </>
  );
}

export default App;