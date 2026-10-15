import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ApiRequestError } from '../api/client';
import { useT } from '../i18n';
import { Icon } from './icons';

export function Skeleton({ height = 80, label }: { height?: number; label?: string }) {
  const t = useT();
  return <div className="skeleton" style={{ height }} role="status" aria-busy="true" aria-label={label ?? t('state.loading')} />;
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state">
      <h3>{title}</h3>
      {body ? <p className="muted">{body}</p> : null}
      {action}
    </div>
  );
}

export function errorCode(e: unknown): string {
  return e instanceof ApiRequestError ? e.code : 'INTERNAL';
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const code = errorCode(error);
  const retryable = error instanceof ApiRequestError ? error.retryable : true;
  return (
    <div className="state error" role="alert">
      <h3 className="row">
        <Icon name="alert" /> {t(`error.${code}.title`)}
      </h3>
      <p className="muted">{t(`error.${code}.body`)}</p>
      <p className="small muted">
        {t('error.code')}: <code>{code}</code>
      </p>
      {onRetry && retryable ? (
        <button type="button" className="btn sm" onClick={onRetry}>
          {t('action.retry')}
        </button>
      ) : null}
    </div>
  );
}

/** Loading -> skeleton, error -> ErrorState (mapped to i18n), otherwise children(data). Keeps previous data visible while refetching. */
export function Query<T>({ q, children, skeleton = 160 }: { q: UseQueryResult<T>; skeleton?: number; children: (data: T) => ReactNode }) {
  if (q.data !== undefined) return <>{children(q.data)}</>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <Skeleton height={skeleton} />;
}
