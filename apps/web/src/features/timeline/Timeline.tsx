import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TimelineDTO } from '@orbit/core';
import { todayIn } from '../../api/dates';
import { useFilters } from '../../api/filters';
import { useTimeline } from '../../api/hooks';
import { Icon } from '../../components/icons';
import { Card, FLink, PageHeader } from '../../components/layout';
import { EmptyState, Query } from '../../components/states';
import { EntityFilters } from '../../components/Topbar';
import { useFormat, useT } from '../../i18n';
import { TimelineChart, type ActiveRef } from './TimelineChart';

export const PAGE_SIZE = 20;

type Zoom = '24h' | '7d' | '30d';

export function TimelineBody({ dto }: { dto: TimelineDTO }) {
  const t = useT();
  const fmt = useFormat();
  const [active, setActive] = useState<ActiveRef | null>(null);
  const [page, setPage] = useState(0);

  const rows = useMemo(
    () =>
      dto.lanes
        .flatMap((lane, li) => lane.intervals.map((iv, i) => ({ lane, li, iv, i })))
        .sort((a, b) => (a.iv.start < b.iv.start ? -1 : a.iv.start > b.iv.start ? 1 : 0)),
    [dto],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const cur = Math.min(page, pages - 1);
  const slice = rows.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE);
  const activeLane = active ? dto.lanes[active.lane] : undefined;
  const activeIv = activeLane?.intervals[active?.i ?? -1];

  if (rows.length === 0) return <EmptyState title={t('timeline.empty.title')} body={t('timeline.empty.body')} />;

  return (
    <>
      <TimelineChart dto={dto} active={active} onActive={(a) => setActive((p) => (p && p.lane === a.lane && p.i === a.i ? p : a))} />
      <div className="notice" role="status" aria-live="polite" data-testid="tl-active">
        <Icon name="info" size={16} />
        {activeIv && activeLane ? (
          <div>
            <strong className="wrap-safe">{activeLane.label}</strong>
            <dl className="kv" style={{ marginTop: 6 }}>
              <dt>{t('timeline.start')}</dt><dd>{fmt.dateTime(activeIv.start)}</dd>
              <dt>{t('timeline.end')}</dt><dd>{fmt.dateTime(activeIv.end)}</dd>
              <dt>{t('col.requests')}</dt><dd>{fmt.num(activeIv.requests)}</dd>
              <dt>{t('tokens.processed')}</dt><dd>{fmt.num(activeIv.processed)}</dd>
            </dl>
            <div className="row" style={{ marginTop: 6 }}>
              <FLink to={`/sessions/${encodeURIComponent(activeIv.sessionId)}`} className="btn sm">{t('timeline.openSession')}</FLink>
              {activeIv.agentId ? <FLink to="/agents" extra={{ agent: activeIv.agentId }} className="btn sm">{t('timeline.openAgent')}</FLink> : null}
            </div>
          </div>
        ) : (
          <span>{t('timeline.hint')}</span>
        )}
      </div>

      <h3 style={{ marginTop: 8 }}>{t('timeline.tableTitle')}</h3>
      <div className="table-scroll" role="region" aria-label={t('timeline.tableTitle')} tabIndex={0}>
        <table className="data">
          <caption className="sr-only">{t('timeline.tableCaption', { from: cur * PAGE_SIZE + 1, to: cur * PAGE_SIZE + slice.length, total: rows.length })}</caption>
          <thead>
            <tr>
              <th scope="col">{dto.groupBy === 'agent' ? t('col.role') : t('col.project')}</th>
              <th scope="col">{t('timeline.start')}</th>
              <th scope="col">{t('timeline.end')}</th>
              <th scope="col" className="num">{t('col.requests')}</th>
              <th scope="col" className="num">{t('tokens.processed')}</th>
              <th scope="col">{t('timeline.links')}</th>
            </tr>
          </thead>
          <tbody>
            {slice.map(({ lane, li, iv, i }) => (
              <tr key={`${lane.id}-${iv.start}-${i}`} className={active?.lane === li && active.i === i ? 'row-active' : undefined}>
                <th scope="row" className="cell-name">
                  <button type="button" className="th-btn" style={{ color: 'var(--accent)' }} onFocus={() => setActive({ lane: li, i })} onClick={() => setActive({ lane: li, i })} aria-label={t('timeline.select', { lane: lane.label, start: fmt.dateTime(iv.start) })}>
                    <span className="trunc" style={{ maxWidth: 200 }} title={lane.label}>{lane.label}</span>
                  </button>
                </th>
                <td className="nowrap">{fmt.dateTime(iv.start)}</td>
                <td className="nowrap">{fmt.dateTime(iv.end)}</td>
                <td className="num">{fmt.num(iv.requests)}</td>
                <td className="num">{fmt.num(iv.processed)}</td>
                <td className="nowrap">
                  <FLink to={`/sessions/${encodeURIComponent(iv.sessionId)}`} className="mono">{iv.sessionId.slice(0, 8)}</FLink>
                  {iv.agentId ? <> · <FLink to="/agents" extra={{ agent: iv.agentId }}>{t('timeline.agent')}</FLink></> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="table-hint">{t('table.scrollHint')}</p>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small muted" aria-live="polite">{t('timeline.page', { page: cur + 1, pages })}</span>
        <div className="row">
          <button type="button" className="btn sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}><Icon name="chevL" size={14} />{t('table.prev')}</button>
          <button type="button" className="btn sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>{t('table.next')}<Icon name="chevR" size={14} /></button>
        </div>
      </div>
    </>
  );
}

export function Timeline() {
  const t = useT();
  const f = useFilters();
  const [sp, setSp] = useSearchParams();
  const groupBy = sp.get('group') === 'agent' ? 'agent' : 'project';
  const q = useTimeline(f.query, groupBy);
  const days = Math.round((Date.parse(`${f.to}T00:00:00Z`) - Date.parse(`${f.from}T00:00:00Z`)) / 86_400_000) + 1;
  const zoom: Zoom | null = days === 1 ? '24h' : days === 7 ? '7d' : days === 30 ? '30d' : null;
  const setZoom = (z: Zoom) => {
    if (z === '24h') {
      const today = todayIn(f.tz);
      f.setRange(today, today);
    } else f.setPreset(z === '7d' ? 7 : 30);
  };
  const setGroup = (g: 'project' | 'agent') =>
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      if (g === 'agent') n.set('group', 'agent');
      else n.delete('group');
      return n;
    });
  return (
    <>
      <PageHeader eyebrow={t('nav.timeline')} title={t('timeline.title')} lead={t('timeline.lead')} />
      <div className="row">
        <div className="seg" role="group" aria-label={t('timeline.groupBy')}>
          {(['project', 'agent'] as const).map((g) => <button key={g} type="button" aria-pressed={groupBy === g} onClick={() => setGroup(g)}>{t(`timeline.group.${g}`)}</button>)}
        </div>
        <div className="seg" role="group" aria-label={t('timeline.zoom')}>
          {(['24h', '7d', '30d'] as const).map((z) => <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)}>{t(`timeline.zoom.${z}`)}</button>)}
        </div>
        <EntityFilters models />
      </div>
      <Card title={t('timeline.cardTitle')}>
        <p className="small muted" style={{ marginTop: -6 }}>{t('timeline.legend')}</p>
        <Query q={q} skeleton={320}>
          {(d) => (
            <>
              {d.truncated ? <div className="notice warn" role="note"><Icon name="alert" size={16} /><span>{t('timeline.truncated')}</span></div> : null}
              <TimelineBody key={`${d.groupBy}-${d.period.from}-${d.period.to}`} dto={d} />
            </>
          )}
        </Query>
      </Card>
    </>
  );
}
