import { StrictMode, useMemo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import ruRU from 'antd/locale/ru_RU';
import { useTranslation } from 'react-i18next';
import App from './App.tsx';
import { AuthProvider } from '@/auth/AuthContext';
import { adminTheme } from '@/theme';
import '@/i18n';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function AntdProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const locale = useMemo(
    () => (i18n.language.startsWith('ru') ? ruRU : enUS),
    [i18n.language],
  );

  return (
    <ConfigProvider theme={adminTheme} locale={locale}>
      {children}
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AntdProvider>
        <AntApp>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </AntApp>
      </AntdProvider>
    </QueryClientProvider>
  </StrictMode>,
);
