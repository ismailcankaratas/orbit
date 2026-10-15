import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { OverviewDTO, ProjectSummary, Quality, StoryDTO } from '@orbit/core';
import { useFilters } from '../../api/filters';
import { useOverview, useProjects, useStory } from '../../api/hooks';
import { CoverageChip, MoneyValue, QualityBadge, useMoneyText } from '../../components/badges';
import { ErrorState } from '../../components/states';
import { TOKEN_KEYS } from '../../components/TokenMix';
import { useExperience } from '../../experience/context';
import type { SceneComponent } from '../../experience/contracts';
import { useFormat, useT } from '../../i18n';
import { Orbit, projectName, type SelectVia } from './Orbit';
import { buildModelArcs, buildPlanets, daysInRange, pctChange, type ModelArc, type Planet, type RestCluster } from './model';
import './merkez.css';

function useAmbientMotion(active: boolean): boolean {
  const [reduced, setReduced] = useState(() => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false));
  const [hidden, setHidden] = useState(() => (typeof document !== 'undefined' ? document.hidden : false));
  useEffect(() => {
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const onMq = () => setReduced(!!mq?.matches);
    const onVis = () => setHidden(document.hidden);
    mq?.addEventListener?.('change', onMq);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mq?.removeEventListener?.('change', onMq);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return active && !reduced && !hidden;
}

/* ---------------- readouts ---------------- */

function Readout({ id, label, quality, children, note, className = '' }: { id: string; label: string; quality: Quality; children: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <section className={`mz-ro ${className}`} aria-labelledby={`${id}-l`} data-readout={id}>
      <div className="mz-ro-top">
        <h3 id={`${id}-l`} className="mz-ro-label">{label}</h3>
        <QualityBadge quality={quality} />
      </div>
      <div className="mz-ro-val">{children}</div>
      {note ? <div className="mz-ro-note">{note}</div> : null}
    </section>
  );
}

function TokenReadout({ d }: { d: OverviewDTO }) {
  const t = useT();
  const fmt = useFormat();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [open, setOpen] = useState(false);
  const k = d.kpis.tokens;
  return (
    <section className={`mz-ro mz-ro-tokens${open ? ' is-open' : ''}`} aria-labelledby={`${uid}-l`} data-readout="tokens">
      <div className="mz-ro-top">
        <h3 id={`${uid}-l`} className="mz-ro-label">{t('scene.merkez.ro.tokens')}</h3>
        <QualityBadge quality={k.quality} />
      </div>
      <button type="button" className="mz-ro-val mz-ro-btn" aria-expanded={open} aria-controls={`${uid}-pop`} onClick={() => setOpen((v) => !v)} title={fmt.num(k.processed)}>
        <span>{fmt.compact(k.processed)}</span>
        <span className="mz-ro-hint">{t('scene.merkez.ro.tokens.breakdown')}</span>
      </button>
      <ul id={`${uid}-pop`} className="mz-pop" aria-label={t('scene.merkez.ro.tokens.breakdown')}>
        {TOKEN_KEYS.filter((key) => k[key] > 0).map((key) => (
          <li key={key}>
            <span className="mz-sw" style={{ background: `var(--c-${key})` }} aria-hidden="true" />
            <span className="mz-pop-n">{t(`tokens.${key}`)}</span>
            <span className="mz-pop-v">{fmt.compact(k[key])} · {fmt.pct(k[key] / (k.processed || 1), 1)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function useReadoutCtx(d: OverviewDTO) {
  const t = useT();
  const fmt = useFormat();
  const { label: moneyLabel } = useMoneyText();
  const k = d.kpis;
  const cacheShare = k.tokens.processed > 0 ? k.tokens.cacheRead / k.tokens.processed : 0;
  const valueId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return { t, fmt, moneyLabel, k, cacheShare, valueId };
}

function ColA({ d }: { d: OverviewDTO }) {
  const { t, fmt, k } = useReadoutCtx(d);
  return (
      <div className="mz-col mz-col-a">
        <TokenReadout d={d} />
        <Readout id="requests" label={t('scene.merkez.ro.requests')} quality={k.uniqueRequests.quality} note={t('scene.merkez.ro.requests.note')}>
          <span title={fmt.num(k.uniqueRequests.value)}>{fmt.num(k.uniqueRequests.value)}</span>
        </Readout>
        <Readout id="sessions" label={t('scene.merkez.ro.sessions')} quality={k.sessions.quality}>
          <span>{fmt.num(k.sessions.value)}</span>
        </Readout>
      </div>
  );
}

function ColB({ d }: { d: OverviewDTO }) {
  const { t, fmt, moneyLabel, k, cacheShare, valueId } = useReadoutCtx(d);
  return (
      <div className="mz-col mz-col-b">
        <Readout id="subagents" label={t('scene.merkez.ro.subagents')} quality={k.subagents.quality} note={t('scene.merkez.ro.subagents.note')}>
          <span>{fmt.num(k.subagents.value)}</span>
        </Readout>
        <Readout id="cache" label={t('scene.merkez.ro.cache')} quality="derived" note={t('scene.merkez.ro.cache.note')}>
          <span>{fmt.pct(cacheShare, 1)}</span>
        </Readout>
        <section className="mz-ro mz-ro-value" aria-labelledby={`${valueId}-l`} data-readout="value">
          <div className="mz-ro-top">
            <h3 id={`${valueId}-l`} className="mz-ro-label">{moneyLabel}</h3>
            <QualityBadge quality="estimated" reason="reason.estimatedValue" />
          </div>
          <div className="mz-ro-val"><MoneyValue usd={k.cost.usdDecimal} labelMode="compact" /></div>
          <div className="mz-ro-note">
            <strong className="mz-caveat">{t('scene.merkez.ro.value.caveat')}</strong>
            <CoverageChip coverage={d.coverage} cost={k.cost} />
          </div>
        </section>
      </div>
  );
}

/* ---------------- comparisons ---------------- */

function Delta({ cur, prev }: { cur: number; prev: number }) {
  const t = useT();
  const fmt = useFormat();
  const c = pctChange(cur, prev);
  if (c === null) return <span className="mz-delta flat">{t('scene.merkez.cmp.na')}</span>;
  const dir = Math.abs(c) < 0.005 ? 'flat' : c > 0 ? 'up' : 'down';
  const sign = dir === 'up' ? '▲ +' : dir === 'down' ? '▼ −' : '■ ';
  return (
    <span className={`mz-delta ${dir}`}>
      <span aria-hidden="true">{sign}{fmt.pct(Math.abs(c), 0)}</span>
      <span className="sr-only">{t(`scene.merkez.cmp.${dir}`)} {fmt.pct(Math.abs(c), 0)}</span>
    </span>
  );
}

function Comparisons({ d, story }: { d: OverviewDTO; story: { data?: StoryDTO | undefined; isError: boolean; isPending: boolean } }) {
  const t = useT();
  const fmt = useFormat();
  const prev = d.previous;
  const comparable = prev !== null && Math.abs(prev.requestCoverage - d.kpis.cost.requestCoverage) < 0.005;
  const k = d.kpis;
  const total = k.tokens.processed || 1;
  const del = story.data?.delegation;
  const delTotal = del ? del.mainRequests + del.agentRequests : 0;
  return (
    <div className="mz-cmp" aria-label={t('scene.merkez.cmp.title')} role="group">
      <section className="mz-panel" aria-labelledby="mz-cmp-prev">
        <h3 id="mz-cmp-prev" className="mz-panel-h">{t('scene.merkez.cmp.prev')}</h3>
        {comparable && prev ? (
          <dl className="mz-dl">
            <div><dt>{t('scene.merkez.cmp.tokens')}</dt><dd><Delta cur={k.tokens.processed} prev={prev.processedTokens} /></dd></div>
            <div><dt>{t('scene.merkez.cmp.requests')}</dt><dd><Delta cur={k.uniqueRequests.value} prev={prev.uniqueRequests} /></dd></div>
            <div><dt>{t('scene.merkez.cmp.sessions')}</dt><dd><Delta cur={k.sessions.value} prev={prev.sessions} /></dd></div>
            <div><dt>{t('scene.merkez.cmp.value')}</dt><dd><Delta cur={Number(k.cost.usdDecimal)} prev={Number(prev.usdDecimal)} /></dd></div>
          </dl>
        ) : (
          <p className="mz-muted">{t('scene.merkez.cmp.none')} <span className="mz-sub">{prev === null ? t('scene.merkez.cmp.none.noPrev') : t('scene.merkez.cmp.none.coverage')}</span></p>
        )}
      </section>

      <section className="mz-panel" aria-labelledby="mz-cmp-del">
        <h3 id="mz-cmp-del" className="mz-panel-h">{t('scene.merkez.cmp.delegation')}</h3>
        {del && delTotal > 0 ? (
          <>
            <div className="mz-bar" role="img" aria-label={t('scene.merkez.cmp.delegation.aria', { main: fmt.pct(del.mainRequests / delTotal, 0), sub: fmt.pct(del.agentRequests / delTotal, 0) })}>
              <i style={{ flex: del.mainRequests, background: 'var(--teal)' }} />
              <i style={{ flex: del.agentRequests, background: 'var(--violet)' }} />
            </div>
            <ul className="mz-legend">
              <li><span className="mz-sw" style={{ background: 'var(--teal)' }} aria-hidden="true" />{t('scene.merkez.cmp.main')} {fmt.num(del.mainRequests)} · {fmt.pct(del.mainRequests / delTotal, 0)}</li>
              <li><span className="mz-sw" style={{ background: 'var(--violet)' }} aria-hidden="true" />{t('scene.merkez.cmp.sub')} {fmt.num(del.agentRequests)} · {fmt.pct(del.agentRequests / delTotal, 0)}</li>
            </ul>
          </>
        ) : (
          <p className="mz-muted">{story.isPending ? t('state.loading') : story.isError ? t('scene.merkez.cmp.delegation.unavailable') : t('scene.merkez.cmp.delegation.none')}</p>
        )}
      </section>

      <section className="mz-panel" aria-labelledby="mz-cmp-cache">
        <h3 id="mz-cmp-cache" className="mz-panel-h">{t('scene.merkez.cmp.cache')}</h3>
        <div className="mz-bar" role="img" aria-label={`${t('scene.merkez.cmp.cache')}: ${TOKEN_KEYS.filter((key) => k.tokens[key] > 0).map((key) => `${t(`tokens.${key}`)} ${fmt.pct(k.tokens[key] / total, 1)}`).join(', ')}`}>
          {TOKEN_KEYS.map((key) => (k.tokens[key] > 0 ? <i key={key} style={{ flex: k.tokens[key], background: `var(--c-${key})` }} /> : null))}
        </div>
        <ul className="mz-legend mz-legend-wrap">
          {TOKEN_KEYS.filter((key) => k.tokens[key] > 0).map((key) => (
            <li key={key}><span className="mz-sw" style={{ background: `var(--c-${key})` }} aria-hidden="true" />{t(`tokens.${key}`)} {fmt.pct(k.tokens[key] / total, 0)}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ---------------- detail ---------------- */

type Picked = { kind: 'project'; planet: Planet } | { kind: 'model'; arc: ModelArc } | { kind: 'rest'; rest: RestCluster } | null;

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mz-stat"><dt>{label}</dt><dd>{children}</dd></div>
  );
}

function Detail({ d, picked, live }: { d: OverviewDTO; picked: Picked; live: boolean }) {
  const t = useT();
  const fmt = useFormat();
  const { openExplorer } = useExperience();
  const { label: moneyLabel } = useMoneyText();
  const body = (() => {
    if (!picked) return <p className="mz-muted">{t('scene.merkez.detail.none')}</p>;
    if (picked.kind === 'project') {
      const p = picked.planet.project;
      return (
        <>
          <div className="mz-d-head">
            <span className="mz-d-dot" style={{ background: picked.planet.color }} aria-hidden="true" />
            <h3 className="mz-d-name">{projectName(p)}</h3>
            {p.nameCollision ? <span className="badge unknown">{p.shortCode}</span> : null}
          </div>
          <dl className="mz-stats">
            <Stat label={t('scene.merkez.detail.share')}>{fmt.pct(picked.planet.share, 1)}</Stat>
            <Stat label={t('scene.merkez.detail.tokens')}>{fmt.compact(p.tokens.processed)}</Stat>
            <Stat label={t('scene.merkez.detail.sessions')}>{fmt.num(p.sessions)}</Stat>
            <Stat label={t('scene.merkez.detail.requests')}>{fmt.num(p.requests)}</Stat>
            <Stat label={t('scene.merkez.detail.subagents')}>{fmt.num(p.agents)}</Stat>
            <Stat label={t('scene.merkez.detail.last')}>{p.lastActiveAt ? fmt.dateTime(p.lastActiveAt) : t('scene.merkez.detail.lastNone')}</Stat>
          </dl>
          <p className="mz-d-value">
            <span className="mz-d-value-l">{moneyLabel}</span>
            <MoneyValue usd={p.usdDecimal} labelMode="compact" />
            <span className="mz-caveat-sm">{t('scene.merkez.ro.value.caveat')}</span>
          </p>
          <button type="button" className="btn sm mz-open" onClick={() => openExplorer(`/projects/${encodeURIComponent(p.id)}`)}>{t('scene.merkez.detail.open')}</button>
        </>
      );
    }
    if (picked.kind === 'model') {
      const m = picked.arc.model;
      return (
        <>
          <div className="mz-d-head">
            <span className={`mz-d-dot${picked.arc.unpriced ? ' hatch' : ''}`} style={picked.arc.unpriced ? undefined : { background: picked.arc.color }} aria-hidden="true" />
            <h3 className="mz-d-name">{m.displayName ?? m.modelId}</h3>
            <span className="badge unknown">{t('scene.merkez.detail.model')}</span>
          </div>
          <dl className="mz-stats">
            <Stat label={t('scene.merkez.detail.share')}>{fmt.pct(picked.arc.share, 1)}</Stat>
            <Stat label={t('scene.merkez.detail.tokens')}>{fmt.compact(m.tokens.processed)}</Stat>
            <Stat label={t('scene.merkez.detail.requests')}>{fmt.num(m.requests)}</Stat>
          </dl>
          {m.priced ? (
            <p className="mz-d-value">
              <span className="mz-d-value-l">{moneyLabel}</span>
              <MoneyValue usd={m.usdDecimal} labelMode="compact" />
              <span className="mz-caveat-sm">{t('scene.merkez.ro.value.caveat')}</span>
            </p>
          ) : (
            <p className="mz-d-value mz-unpriced"><strong>{t('scene.merkez.detail.unpriced')}</strong> <span className="mz-sub">{t('scene.merkez.detail.unpriced.why')}</span></p>
          )}
          <button type="button" className="btn sm mz-open" onClick={() => openExplorer('/costs')}>{t('scene.merkez.detail.openCosts')}</button>
        </>
      );
    }
    const r = picked.rest;
    return (
      <>
        <div className="mz-d-head"><span className="mz-d-dot rest" aria-hidden="true" /><h3 className="mz-d-name">{t('scene.merkez.detail.restName', { count: r.count })}</h3></div>
        <dl className="mz-stats">
          <Stat label={t('scene.merkez.detail.share')}>{fmt.pct(r.share, 1)}</Stat>
          <Stat label={t('scene.merkez.detail.tokens')}>{fmt.compact(r.tokens)}</Stat>
          <Stat label={t('scene.merkez.detail.sessions')}>{fmt.num(r.sessions)}</Stat>
          <Stat label={t('scene.merkez.detail.requests')}>{fmt.num(r.requests)}</Stat>
          <Stat label={t('scene.merkez.detail.subagents')}>{fmt.num(r.agents)}</Stat>
        </dl>
        <button type="button" className="btn sm mz-open" onClick={() => openExplorer('/projects')}>{t('scene.merkez.detail.openAll')}</button>
      </>
    );
  })();
  void d;
  return (
    <section className="mz-detail" aria-label={t('scene.merkez.detail.title')} aria-live={live ? 'polite' : 'off'}>
      <div className="mz-eyebrow">{t('scene.merkez.detail.title')}</div>
      <div className="mz-detail-body" key={picked ? (picked.kind === 'project' ? picked.planet.key : picked.kind === 'model' ? picked.arc.key : 'rest') : 'none'}>{body}</div>
    </section>
  );
}

/* ---------------- scene ---------------- */

function Alt({ arcs, planets, rest, total }: { arcs: ModelArc[]; planets: Planet[]; rest: RestCluster | null; total: number }) {
  const t = useT();
  const fmt = useFormat();
  return (
    <div className="sr-only">
      <table>
        <caption>{t('scene.merkez.alt.models')}</caption>
        <thead><tr><th scope="col">{t('scene.merkez.alt.name')}</th><th scope="col">{t('scene.merkez.detail.share')}</th><th scope="col">{t('scene.merkez.detail.tokens')}</th><th scope="col">{t('scene.merkez.alt.status')}</th></tr></thead>
        <tbody>
          {arcs.map((a) => <tr key={a.key}><th scope="row">{a.model.displayName ?? a.model.modelId}</th><td>{fmt.pct(a.share, 1)}</td><td>{fmt.num(a.model.tokens.processed)}</td><td>{a.unpriced ? t('scene.merkez.detail.unpriced') : t('scene.merkez.alt.priced')}</td></tr>)}
        </tbody>
      </table>
      <table>
        <caption>{t('scene.merkez.alt.projects')}</caption>
        <thead><tr><th scope="col">{t('scene.merkez.alt.name')}</th><th scope="col">{t('scene.merkez.detail.share')}</th><th scope="col">{t('scene.merkez.detail.tokens')}</th><th scope="col">{t('scene.merkez.detail.sessions')}</th></tr></thead>
        <tbody>
          {planets.map((p) => <tr key={p.key}><th scope="row">{projectName(p.project)}</th><td>{fmt.pct(p.share, 1)}</td><td>{fmt.num(p.project.tokens.processed)}</td><td>{fmt.num(p.project.sessions)}</td></tr>)}
          {rest ? <tr><th scope="row">{t('scene.merkez.detail.restName', { count: rest.count })}</th><td>{fmt.pct(rest.share, 1)}</td><td>{fmt.num(rest.tokens)}</td><td>{fmt.num(rest.sessions)}</td></tr> : null}
        </tbody>
      </table>
      <p>{t('scene.merkez.sun.label')}: {fmt.num(total)}</p>
    </div>
  );
}

function ModelLegend({ arcs }: { arcs: ModelArc[] }) {
  const t = useT();
  const fmt = useFormat();
  if (!arcs.length) return null;
  return (
    <ul className="mz-mlegend" aria-label={t('scene.merkez.legend.models')}>
      {arcs.map((a) => (
        <li key={a.key} className={a.unpriced ? 'unpriced' : ''}>
          <span className={`mz-sw${a.unpriced ? ' hatch' : ''}`} style={a.unpriced ? undefined : { background: a.color }} aria-hidden="true" />
          <span className="mz-ml-n">{a.model.displayName ?? a.model.modelId}</span> {fmt.pct(a.share, 0)}
          {a.unpriced ? <span className="mz-ml-flag"> · {t('scene.merkez.legend.unpriced')}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function SceneSkeleton() {
  const t = useT();
  return (
    <div className="mz-skeleton" role="status" aria-busy="true" aria-label={t('state.loading')}>
      <div className="mz-sk-text"><i /><i /><i /></div>
      <div className="mz-sk-orbit"><span /><span /><span /><b /></div>
      <div className="mz-sk-side"><i /><i /><i /></div>
    </div>
  );
}

export const MerkezScene: SceneComponent = ({ active }) => {
  const t = useT();
  const fmt = useFormat();
  const f = useFilters();
  const { openSettings } = useExperience();
  const overview = useOverview(f.query);
  const projectsQ = useProjects(f.query);
  const story = useStory(f.query);
  const moving = useAmbientMotion(active);
  const [userKey, setUserKey] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const d = overview.data;
  const projectItems = projectsQ.data?.items;
  const fallbackProjects = d?.topProjects;
  const projects: ProjectSummary[] = useMemo(() => projectItems ?? fallbackProjects ?? [], [projectItems, fallbackProjects]);
  const arcs = useMemo(() => buildModelArcs(d?.models ?? []), [d?.models]);
  const orbit = useMemo(() => buildPlanets(projects, d?.kpis.tokens.processed ?? 0), [projects, d?.kpis.tokens.processed]);

  if (!d) {
    if (overview.isError) return <div className="mz-root"><div className="mz-center"><ErrorState error={overview.error} onRetry={() => void overview.refetch()} /></div></div>;
    return <div className="mz-root"><SceneSkeleton /></div>;
  }

  const k = d.kpis;
  const empty = k.uniqueRequests.value === 0 || d.coverage.sourceStatus === 'empty' || d.coverage.sourceStatus === 'not_scanned';
  const notScanned = d.coverage.sourceStatus === 'not_scanned';
  const partial = d.coverage.sourceStatus === 'partial';
  const days = daysInRange(f.from, f.to);

  const defaultKey = orbit.planets[0]?.key ?? arcs[0]?.key ?? null;
  const valid = (key: string | null) => !!key && (orbit.planets.some((p) => p.key === key) || arcs.some((a) => a.key === key) || (key === 'rest' && !!orbit.rest));
  const selectedKey = valid(userKey) ? userKey : defaultKey;
  const picked: Picked = (() => {
    const p = orbit.planets.find((x) => x.key === selectedKey);
    if (p) return { kind: 'project', planet: p };
    const a = arcs.find((x) => x.key === selectedKey);
    if (a) return { kind: 'model', arc: a };
    if (selectedKey === 'rest' && orbit.rest) return { kind: 'rest', rest: orbit.rest };
    return null;
  })();
  const onSelect = (key: string, via: SelectVia) => {
    setUserKey(key);
    setLive(via !== 'pointer');
  };

  const header = (
    <header className="mz-head">
      <div className="mz-eyebrow">
        {t('scene.merkez.eyebrow')} · {fmt.day(f.from, true)} – {fmt.day(f.to, true)}
      </div>
      {empty ? (
        <>
          <h1 className="mz-h1">{t(notScanned ? 'scene.merkez.notScanned.title' : 'scene.merkez.empty.title')}</h1>
          <p className="mz-sub-line">{t(notScanned ? 'scene.merkez.notScanned.body' : 'scene.merkez.empty.body')}</p>
        </>
      ) : (
        <>
          <h1 className="mz-h1">
            {t('scene.merkez.headline', {
              days: t('scene.merkez.unit.days', { count: days }),
              projects: t('scene.merkez.unit.projects', { count: k.projects.value }),
              sessions: t('scene.merkez.unit.sessions', { count: k.sessions.value }),
            })}
          </h1>
          <p className="mz-sub-line">
            {t('scene.merkez.subline', { requests: t('scene.merkez.unit.requests', { count: k.uniqueRequests.value }), tokens: t('scene.merkez.unit.tokens', { tokens: fmt.compact(k.tokens.processed) }) })}
          </p>
        </>
      )}
      {partial ? <p className="mz-partial"><span className="badge warn">{t('scene.merkez.partial')}</span> <span className="mz-sub">{t('scene.merkez.partial.why')}</span></p> : null}
    </header>
  );

  return (
    <div className={`mz-root${empty ? ' is-empty' : ''}`}>
      <div className="mz-left">
        {header}
        {empty ? (
          <div className="mz-invite">
            <p>{t('scene.merkez.invite.range')}</p>
            <button type="button" className="btn primary" onClick={openSettings}>{t(notScanned ? 'scene.merkez.invite.scan' : 'scene.merkez.invite.settings')}</button>
          </div>
        ) : (
          <>
            <ColA d={d} />
            <Detail d={d} picked={picked} live={live} />
          </>
        )}
      </div>

      <div className="mz-stage">
        <Orbit arcs={empty ? [] : arcs} orbit={empty ? { planets: [], rest: null } : orbit} sunTokens={empty ? null : k.tokens.processed} selectedKey={empty ? null : selectedKey} onSelect={onSelect} moving={moving} decorative={empty} />
        {empty ? null : <ModelLegend arcs={arcs} />}
        {empty ? null : <Alt arcs={arcs} planets={orbit.planets} rest={orbit.rest} total={k.tokens.processed} />}
      </div>

      {empty ? null : (
        <div className="mz-right">
          <ColB d={d} />
          <Comparisons d={d} story={story} />
        </div>
      )}
    </div>
  );
};
