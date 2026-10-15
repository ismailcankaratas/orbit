import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { LiveProvider } from './api/live';
import { ApiRequestError } from './api/client';
import { I18nProvider, useT } from './i18n';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: (n, e) => n < 2 && e instanceof ApiRequestError && e.retryable,
    },
  },
});

function Live({ children }: { children: React.ReactNode }) {
  const t = useT();
  return <LiveProvider announceTexts={{ updated: t('live.updated') }}>{children}</LiveProvider>;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Live>
            <App />
          </Live>
        </BrowserRouter>
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
