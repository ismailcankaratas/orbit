import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { StoryDTO } from '@orbit/core';
import { useFilters } from '../../api/filters';
import { useStory } from '../../api/hooks';
import { CoverageChip, MoneyValue, useMoneyText } from '../../components/badges';
import { Icon } from '../../components/icons';
import { FLink } from '../../components/layout';
import { ErrorState, Skeleton } from '../../components/states';
import { TokenLegend, TokenMixBar } from '../../components/TokenMix';
import { useFormat, useT, type TFn } from '../../i18n';
import { DailyBars, HBars } from './StoryCharts';

export interface Slide {
  id: string;
  title: string;
  /** one deterministic, data-grounded statement; null when the data cannot support a claim */
  takeaway: string | null;
  href: string;
  body: ReactNode;
}

const MODEL_TONES = ['var(--accent)', 'var(--teal)', 'var(--coral)', 'var(--violet)', 'var(--green)', '#c9b79c'];

export function buildSlides(s: StoryDTO, t: TFn, fmt: ReturnType<typeof useFormat>, range: { from: string; to: string }, money: { label: string; disclaimer: string }): Slide[] {
  const { kpis, daily, models, topProjects, coverage } = s.overview;
  const req = kpis.uniqueRequests.value;
  const processed = kpis.tokens.processed;
  const empty = req === 0;
  const emptyBody = <p className="muted story-empty">{t('story.empty')}</p>;
  const sched = s.schedule;

  const peak = daily.reduce<(typeof daily)[number] | null>((m, d) => (d.tokens.processed > (m?.tokens.processed ?? 0) ? d : m), null);
  const topProject = topProjects[0];
  const topModel = [...models].sort((a, b) => b.tokens.processed - a.tokens.processed)[0];
  const totalRoleReq = s.delegation.mainRequests + s.delegation.agentRequests;
  const cost = kpis.cost;

  return [
    {
      id: 'intro',
      title: t('story.s1.title'),
      takeaway: empty ? null : t('story.s1.takeaway', { requests: t('count.requests', { count: req }), sessions: t('count.sessions', { count: kpis.sessions.value }), projects: t('count.projects', { count: kpis.projects.value }) }),
      href: '/',
      body: (
        <div className="stack">
          <p className="story-lead">{t('story.s1.range', { from: fmt.day(range.from, true), to: fmt.day(range.to, true) })}</p>
          <p className="muted">{t('story.s1.scope')}</p>
          {empty ? emptyBody : (
            <dl className="story-stats">
              <div><dt>{t('kpi.requests')}</dt><dd>{fmt.num(req)}</dd></div>
              <div><dt>{t('kpi.sessions')}</dt><dd>{fmt.num(kpis.sessions.value)}</dd></div>
              <div><dt>{t('nav.projects')}</dt><dd>{fmt.num(kpis.projects.value)}</dd></div>
              <div><dt>{t('tokens.processed')}</dt><dd>{fmt.compact(processed)}</dd></div>
            </dl>
          )}
        </div>
      ),
    },
    {
      id: 'activity',
      title: t('story.s2.title'),
      takeaway: peak && peak.tokens.processed > 0 ? t('story.s2.takeaway', { date: fmt.day(peak.date, true), tokens: fmt.compact(peak.tokens.processed) }) : null,
      href: '/',
      body: empty || daily.length === 0 ? emptyBody : <DailyBars daily={daily} />,
    },
    {
      id: 'value',
      title: t('story.s3.title'),
      takeaway: empty ? null : cost.unpricedRequestCount === 0 ? t('story.s3.takeawayFull', { pct: fmt.pct(cost.requestCoverage, 0) }) : t('story.s3.takeaway', { pct: fmt.pct(cost.requestCoverage, 1), count: cost.unpricedRequestCount }),
      href: '/costs',
      body: (
        <div className="stack">
          <div className="story-big"><MoneyValue usd={cost.usdDecimal} /></div>
          <div className="row"><CoverageChip coverage={coverage} cost={cost} /></div>
          <p className="notice warn story-caveat"><Icon name="alert" size={16} /><span>{money.disclaimer} {t('story.s3.caveat')}</span></p>
        </div>
      ),
    },
    {
      id: 'projects',
      title: t('story.s4.title'),
      takeaway: topProject && processed > 0 ? t('story.s4.takeaway', { project: topProject.alias ?? topProject.label, pct: fmt.pct(topProject.tokens.processed / processed, 0) }) : null,
      href: '/projects',
      body: topProjects.length === 0 ? emptyBody : (
        <HBars label={t('story.s4.title')} rows={topProjects.slice(0, 6).map((p) => ({ key: p.id, label: p.alias ?? p.label, share: processed ? p.tokens.processed / processed : 0, text: `${fmt.pct(processed ? p.tokens.processed / processed : 0, 0)} · ${fmt.compact(p.tokens.processed)}` }))} />
      ),
    },
    {
      id: 'models',
      title: t('story.s5.title'),
      takeaway: topModel && processed > 0 ? t('story.s5.takeaway', { model: topModel.displayName ?? topModel.modelId, pct: fmt.pct(topModel.tokens.processed / processed, 0) }) : null,
      href: '/costs',
      body: models.length === 0 ? emptyBody : (
        <HBars label={t('story.s5.title')} rows={[...models].sort((a, b) => b.tokens.processed - a.tokens.processed).slice(0, 6).map((m, i) => ({ key: m.modelId, label: `${m.displayName ?? m.modelId}${m.priced ? '' : ` (${t('money.unpricedShort')})`}`, share: processed ? m.tokens.processed / processed : 0, text: `${fmt.pct(processed ? m.tokens.processed / processed : 0, 0)} · ${fmt.compact(m.tokens.processed)}`, tone: MODEL_TONES[i % MODEL_TONES.length] as string }))} />
      ),
    },
    {
      id: 'delegation',
      title: t('story.s6.title'),
      takeaway: totalRoleReq === 0 ? null : s.delegation.agentRequests === 0 ? t('story.s6.none') : t('story.s6.takeaway', { pct: fmt.pct(s.delegation.agentShare, 0), agent: fmt.num(s.delegation.agentRequests), total: fmt.num(totalRoleReq) }),
      href: '/agents',
      body: totalRoleReq === 0 ? emptyBody : (
        <div className="stack">
          <HBars label={t('story.s6.title')} rows={[
            { key: 'main', label: t('attr.kind.main'), share: s.delegation.mainRequests / totalRoleReq, text: fmt.num(s.delegation.mainRequests) },
            { key: 'agent', label: t('attr.kind.agent'), share: s.delegation.agentRequests / totalRoleReq, text: fmt.num(s.delegation.agentRequests), tone: 'var(--violet)' },
          ]} />
          {s.delegation.topRoles.length ? <p className="small muted">{t('story.s6.roles')}: {s.delegation.topRoles.map((r) => `${r.role ?? t('agent.roleUnknown')} (${fmt.num(r.requests)})`).join(', ')}</p> : null}
          <p className="small muted">{t('story.s6.confidence', { exact: s.delegation.byConfidence.exact, inferred: s.delegation.byConfidence.inferred, unlinked: s.delegation.byConfidence.unlinked })}</p>
        </div>
      ),
    },
    {
      id: 'cache',
      title: t('story.s7.title'),
      takeaway: empty || processed === 0 ? null : t('story.s7.takeaway', { pct: fmt.pct(s.cache.cacheReadShare, 0) }),
      href: '/costs',
      body: empty || processed === 0 ? emptyBody : (
        <div className="stack">
          <TokenMixBar tokens={kpis.tokens} />
          <TokenLegend tokens={kpis.tokens} />
          <dl className="story-stats">
            <div><dt>{t('tokens.cacheRead')}</dt><dd>{fmt.pct(s.cache.cacheReadShare, 0)}</dd></div>
            <div><dt>{t('story.s7.write')}</dt><dd>{fmt.pct(s.cache.cacheWriteShare, 0)}</dd></div>
            <div><dt>{t('tokens.uncachedInput')}</dt><dd>{fmt.pct(s.cache.uncachedInputShare, 0)}</dd></div>
          </dl>
        </div>
      ),
    },
    {
      id: 'method',
      title: t('story.s8.title'),
      takeaway: empty ? null : cost.unpricedRequestCount === 0 ? t('story.s8.takeawayFull', { pct: fmt.pct(cost.requestCoverage, 0) }) : t('story.s8.takeaway', { pct: fmt.pct(cost.requestCoverage, 1), count: cost.unpricedRequestCount }),
      href: '/costs',
      body: (
        <div className="stack">
          <dl className="kv">
            <dt>{t('story.s8.value')}</dt><dd>{money.label}</dd>
            <dt>{t('coverage.rateVersion')}</dt><dd className="mono wrap-safe">{sched.version}</dd>
            <dt>{t('costs.lastVerified')}</dt><dd>{sched.lastVerified}</dd>
            <dt>{t('coverage.tokenCoverage')}</dt><dd>{fmt.pct(cost.tokenCoverage, 1)}</dd>
            <dt>{t('coverage.excludedModels')}</dt><dd className="wrap-safe">{cost.unpricedModels.length ? cost.unpricedModels.join(', ') : '—'}</dd>
            <dt>{t('costs.overrides')}</dt><dd>{fmt.num(sched.overrideCount)}</dd>
          </dl>
          <p className="small muted">{money.disclaimer}</p>
          <p className="small muted">{t('story.s8.notModeled')}: {sched.notModeled.slice(0, 3).join('; ')}{sched.notModeled.length > 3 ? '…' : ''}</p>
        </div>
      ),
    },
  ];
}

function typing(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  return !!n && (/^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName) || n.isContentEditable);
}

export function StoryStage({ story, range }: { story: StoryDTO; range: { from: string; to: string } }) {
  const t = useT();
  const fmt = useFormat();
  const money = useMoneyText();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const wrap = useRef<HTMLDivElement>(null);
  const [pseudo, setPseudo] = useState(false);
  const [native, setNative] = useState(false);
  const slides = useMemo(() => buildSlides(story, t, fmt, range, money), [story, t, fmt, range, money]);
  const total = slides.length;
  const idx = Math.max(0, Math.min(total - 1, (Number(sp.get('slide')) || 1) - 1));
  const demo = story.mode === 'demo';

  const go = useCallback((n: number) => {
    const c = Math.max(0, Math.min(total - 1, n));
    setSp((prev) => { const o = new URLSearchParams(prev); o.set('slide', String(c + 1)); return o; }, { replace: true });
  }, [setSp, total]);

  const exit = useCallback(() => void nav({ pathname: '/reports', search: '' }), [nav]);
  const toggleFs = useCallback(async () => {
    const el = wrap.current;
    if (!el) return;
    if (document.fullscreenElement) { await document.exitFullscreen().catch(() => undefined); return; }
    if (pseudo) { setPseudo(false); return; }
    if (typeof el.requestFullscreen === 'function') {
      try { await el.requestFullscreen(); return; } catch { /* fall back to the in-page stage */ }
    }
    setPseudo(true);
  }, [pseudo]);

  useEffect(() => {
    const onFs = () => setNative(document.fullscreenElement === wrap.current && !!wrap.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const onControl = (e.target as HTMLElement | null)?.closest?.('button,a,summary') != null;
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': go(idx + 1); break;
        case ' ': case 'Spacebar': if (onControl) return; go(idx + 1); break;
        case 'ArrowLeft': case 'PageUp': go(idx - 1); break;
        case 'Home': go(0); break;
        case 'End': go(total - 1); break;
        case 'Escape':
          if (pseudo) setPseudo(false);
          else if (!document.fullscreenElement) exit();
          break;
        default: return;
      }
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [go, idx, total, pseudo, exit]);

  const isFs = native || pseudo;
  const cur = slides[idx] as Slide;
  return (
    <div ref={wrap} className={`story-wrap${isFs ? ' is-fs' : ''}${pseudo ? ' pseudo-fs' : ''}`}>
      <div className="stage" role="group" aria-roledescription={t('story.carousel')} aria-label={t('story.stageLabel')}>
        {slides.map((s, i) => (
          <section key={s.id} className={`slide${i === idx ? ' active' : ''}`} hidden={i !== idx} data-slide={s.id} {...(i === idx ? { 'data-testid': 'slide-active' } : {})} aria-roledescription={t('story.slide')} aria-label={`${i + 1} / ${total}: ${s.title}`}>
            <header>
              <div className="eyebrow">{t('story.kicker')}</div>
              <h2 className="slide-title">{s.title}</h2>
            </header>
            <div className="slide-body">{s.body}</div>
            <footer className="slide-foot">
              {s.takeaway ? <p className="takeaway">{s.takeaway}</p> : <p className="takeaway muted">{t('story.noClaim')}</p>}
              <FLink to={s.href} className="btn sm no-print">{t('story.viewData')} <Icon name="chevR" size={14} /></FLink>
            </footer>
            {demo ? <div className="watermark" aria-hidden="false">{t('story.watermark')}</div> : null}
          </section>
        ))}
      </div>
      <div className="story-controls no-print">
        <button type="button" className="btn sm" onClick={() => go(idx - 1)} disabled={idx === 0} aria-label={t('story.prev')}><Icon name="chevL" size={16} />{t('story.prev')}</button>
        <span className="story-index" aria-hidden="true" data-testid="story-index">{idx + 1} / {total}</span>
        <button type="button" className="btn sm primary" onClick={() => go(idx + 1)} disabled={idx === total - 1} aria-label={t('story.next')}>{t('story.next')}<Icon name="chevR" size={16} /></button>
        <span className="spacer" />
        <button type="button" className="btn sm" onClick={() => void toggleFs()} aria-pressed={isFs}><Icon name="full" size={16} />{isFs ? t('story.exitFullscreen') : t('story.fullscreen')}</button>
        <button type="button" className="btn sm" onClick={exit}><Icon name="close" size={16} />{t('story.exit')}</button>
      </div>
      <p className="small muted no-print story-keys">{t('story.keys')}</p>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{t('story.live', { n: idx + 1, total, title: cur.title })}</div>
    </div>
  );
}

export function Story() {
  const t = useT();
  const f = useFilters();
  const q = useStory(f.query);
  const range = useMemo(() => ({ from: f.from, to: f.to }), [f.from, f.to]);
  return (
    <>
      <div className="story-head no-print">
        <div className="eyebrow">{t('nav.reports')}</div>
        <h1 style={{ fontSize: 'clamp(24px,3.4vw,34px)' }}>{t('story.title')}</h1>
      </div>
      {q.data ? <StoryStage story={q.data} range={range} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <Skeleton height={420} />}
    </>
  );
}
