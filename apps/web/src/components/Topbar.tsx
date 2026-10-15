import { useEffect, useState } from 'react';
import { PRESETS, useFilters } from '../api/filters';
import { usePatchSettings, useOverview } from '../api/hooks';
import { LOCALES, LOCALE_IDS, isLocale, useFormat, useI18n, useT } from '../i18n';

export function LangSwitch({ id = 'lang' }: { id?: string }) {
  const { locale, setLocale } = useI18n();
  const t = useT();
  const patch = usePatchSettings();
  return (
    <label className="field" style={{ gridAutoFlow: 'column', alignItems: 'center', gap: 6 }} htmlFor={id}>
      <span className="sr-only">{t('settings.language')}</span>
      <select id={id} className="input" value={locale} onChange={(e) => {
        const v = e.target.value;
        if (!isLocale(v)) return;
        setLocale(v);
        if (v === 'tr' || v === 'en') patch.mutate({ locale: v });
      }}>
        {LOCALE_IDS.map((l) => <option key={l} value={l}>{LOCALES[l].label}</option>)}
      </select>
    </label>
  );
}

export function DateRange() {
  const t = useT();
  const f = useFilters();
  const [from, setFrom] = useState(f.from);
  const [to, setTo] = useState(f.to);
  useEffect(() => { setFrom(f.from); setTo(f.to); }, [f.from, f.to]);
  const fmt = useFormat();
  const valid = from && to && from <= to;
  const sameYear = f.from.slice(0, 4) === f.to.slice(0, 4);
  const summary = `${fmt.day(f.from, !sameYear)} – ${fmt.day(f.to, true)}`;
  return (
    <fieldset className="row" style={{ border: 0, padding: 0, margin: 0 }} aria-label={t('filter.dateRange')}>
      <div className="seg" role="group" aria-label={t('filter.presets')}>
        {PRESETS.map((p) => (
          <button key={p} type="button" aria-pressed={f.preset === p} onClick={() => f.setPreset(p)}>{t('filter.lastDays', { count: p })}</button>
        ))}
      </div>
      <label className="field"><span className="sr-only">{t('filter.from')}</span><input className="input" type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); if (e.target.value && to && e.target.value <= to) f.setRange(e.target.value, to); }} aria-invalid={!valid} /></label>
      <span aria-hidden="true">–</span>
      <label className="field"><span className="sr-only">{t('filter.to')}</span><input className="input" type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); if (e.target.value && from && from <= e.target.value) f.setRange(from, e.target.value); }} aria-invalid={!valid} /></label>
      <span className="small muted nowrap" data-testid="range-summary" title={t('filter.rangeSummary', { range: summary })}>{summary}</span>
      {!valid ? <span className="small" style={{ color: 'var(--danger)' }} role="alert">{t('filter.invalid')}</span> : null}
    </fieldset>
  );
}

/** Project/model filters (used on pages where the API supports them). */
export function EntityFilters({ projects, models }: { projects?: { id: string; label: string }[]; models?: boolean }) {
  const t = useT();
  const f = useFilters();
  const opts = useOverview({ from: f.query.from, to: f.query.to, tz: f.tz });
  const modelList = opts.data?.models ?? [];
  return (
    <div className="row">
      {projects ? (
        <label className="field"><span>{t('filter.project')}</span>
          <select className="input" value={f.project ?? ''} onChange={(e) => f.setEntity('project', e.target.value || null)}>
            <option value="">{t('filter.all')}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      ) : null}
      {models ? (
        <label className="field"><span>{t('filter.model')}</span>
          <select className="input" value={f.model ?? ''} onChange={(e) => f.setEntity('model', e.target.value || null)}>
            <option value="">{t('filter.all')}</option>
            {modelList.map((m) => <option key={m.modelId} value={m.modelId}>{m.displayName ?? m.modelId}</option>)}
            {f.model && !modelList.some((m) => m.modelId === f.model) ? <option value={f.model}>{f.model}</option> : null}
          </select>
        </label>
      ) : null}
    </div>
  );
}
