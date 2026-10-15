import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { I18nProvider, type LocaleId } from '../i18n';

export function mockFetch(routes: Record<string, unknown>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://127.0.0.1');
    const body = routes[url.pathname];
    if (body === undefined) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x', retryable: false } }), { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function renderWith(ui: ReactElement, opts: { route?: string; locale?: LocaleId; tz?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nProvider initialLocale={opts.locale ?? 'tr'} initialTimezone={opts.tz ?? 'Europe/Istanbul'}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[opts.route ?? "/"]}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}
