import { EXPORT_COLUMNS } from '@orbit/core';
import { useFilters } from '../../api/filters';
import { exportUrl, useProjects, useStory } from '../../api/hooks';
import { CoverageChip, MoneyValue, QualityBadge, useMoneyText } from '../../components/badges';
import { Icon } from '../../components/icons';
import { Card, FLink, PageHeader } from '../../components/layout';
import { Query } from '../../components/states';
import { DateRange, EntityFilters } from '../../components/Topbar';
import { useFormat, useT } from '../../i18n';

const EXCLUDED = ['prompts', 'outputs', 'paths', 'secrets', 'requestIds', 'sessionIds'] as const;

export function PrivacyPreview() {
  const t = useT();
  const { label } = useMoneyText();
  return (
    <div className="grid halves">
      <div className="stack">
        <h3>{t('reports.included')}</h3>
        <ul className="stack col-list" aria-label={t('reports.included')} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {EXPORT_COLUMNS.map((c) => (
            <li key={c} className="col-item">
              <code>{c}</code>
              <span className="small muted">{c === 'estimated_api_equivalent_usd' ? `${t(`export.col.${c}`)} — ${label}` : t(`export.col.${c}`)}</span>
            </li>
          ))}
        </ul>
        <p className="small muted">{t('reports.metaNote')}</p>
      </div>
      <div className="stack">
        <h3>{t('reports.excluded')}</h3>
        <ul className="stack" style={{ margin: 0, paddingLeft: 18 }} aria-label={t('reports.excluded')}>
          {EXCLUDED.map((k) => <li key={k}>{t(`reports.excluded.${k}`)}</li>)}
        </ul>
        <p className="small muted">{t('reports.aggregation')}</p>
      </div>
    </div>
  );
}

export function Reports() {
  const t = useT();
  const fmt = useFormat();
  const f = useFilters();
  const story = useStory(f.query);
  const projects = useProjects({ from: f.query.from, to: f.query.to, tz: f.tz });
  const projectOpts = (projects.data?.items ?? []).map((p) => ({ id: p.id, label: p.alias ?? p.label }));
  return (
    <>
      <PageHeader eyebrow={t('nav.reports')} title={t('reports.title')} lead={t('reports.lead')} />
      <Card title={t('reports.builder')}>
        <div className="stack" style={{ gap: 16 }}>
          <div className="stack"><h3>{t('filter.dateRange')}</h3><DateRange /></div>
          <EntityFilters projects={projectOpts} models />
        </div>
      </Card>

      <Card title={t('reports.preview')} aside={<QualityBadge quality="estimated" reason="reason.estimatedValue" />}>
        <Query q={story} skeleton={120}>
          {(s) => {
            const k = s.overview.kpis;
            return (
              <div className="stack">
                <dl className="kv">
                  <dt>{t('filter.dateRange')}</dt><dd>{`${fmt.day(f.from, true)} – ${fmt.day(f.to, true)}`}</dd>
                  <dt>{t('kpi.requests')}</dt><dd>{fmt.num(k.uniqueRequests.value)}</dd>
                  <dt>{t('kpi.sessions')}</dt><dd>{fmt.num(k.sessions.value)}</dd>
                  <dt>{t('nav.projects')}</dt><dd>{fmt.num(k.projects.value)}</dd>
                  <dt>{t('money.short')}</dt><dd><MoneyValue usd={k.cost.usdDecimal} labelMode="compact" /></dd>
                </dl>
                <div className="row"><CoverageChip coverage={s.overview.coverage} cost={k.cost} /></div>
              </div>
            );
          }}
        </Query>
        <h3 style={{ margin: '16px 0 8px' }}>{t('reports.privacy')}</h3>
        <PrivacyPreview />
      </Card>

      <Card title={t('reports.actions')}>
        <div className="row">
          <a className="btn primary" href={exportUrl(f.query, 'csv')} download><Icon name="download" size={16} />{t('reports.downloadCsv')}</a>
          <a className="btn" href={exportUrl(f.query, 'json')} download><Icon name="download" size={16} />{t('reports.downloadJson')}</a>
          <FLink to="/reports/story" className="btn"><Icon name="play" size={16} />{t('reports.startStory')}</FLink>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>{t('reports.downloadNote')}</p>
      </Card>
    </>
  );
}
