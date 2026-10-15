import { useState } from 'react';
import { useFilters } from '../../api/filters';
import { useProjects, useSessions } from '../../api/hooks';
import { EmptyState, Query } from '../../components/states';
import { PageHeader } from '../../components/layout';
import { EntityFilters } from '../../components/Topbar';
import { useT } from '../../i18n';
import { SessionsTable } from './SessionsTable';

export function Sessions() {
  const t = useT();
  const f = useFilters();
  const [q, setQ] = useState('');
  const query = useSessions(f.query);
  const projects = useProjects({ from: f.query.from, to: f.query.to, tz: f.tz });
  return (
    <>
      <PageHeader eyebrow={t('nav.sessions')} title={t('sessions.title')} lead={t('sessions.lead')} />
      <div className="row">
        <label className="field"><span>{t('filter.search')}</span><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('sessions.searchPlaceholder')} /></label>
        <EntityFilters models projects={(projects.data?.items ?? []).map((p) => ({ id: p.id, label: p.alias ?? p.label }))} />
      </div>
      <Query q={query} skeleton={300}>
        {(page) => {
          if (page.items.length === 0) return <EmptyState title={t('sessions.empty.title')} body={t('sessions.empty.body')} />;
          const needle = q.trim().toLowerCase();
          const rows = needle ? page.items.filter((s) => `${s.shortId} ${s.id} ${s.projectLabel} ${s.models.join(' ')}`.toLowerCase().includes(needle)) : page.items;
          return (
            <>
              <SessionsTable sessions={rows} />
              {page.total > page.items.length ? <p className="small muted">{t('state.truncated', { shown: page.items.length, total: page.total })}</p> : null}
              <p className="small muted">{t('sessions.requestNote')}</p>
              <p className="small muted">{t('money.footnote')}</p>
            </>
          );
        }}
      </Query>
    </>
  );
}
