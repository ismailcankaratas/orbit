import { useState } from 'react';
import { PRESETS, useFilters } from '../api/filters';
import { Icon } from '../components/icons';
import { Popover } from '../ds';
import { useFormat, useT } from '../i18n';

/** Compact date selector: one button with the locale-formatted range, popover with presets and a custom range. */
export function DateSelector() {
  const t = useT();
  const fmt = useFormat();
  const f = useFilters();
  const sameYear = f.from.slice(0, 4) === f.to.slice(0, 4);
  const summary = `${fmt.day(f.from, !sameYear)} – ${fmt.day(f.to, true)}`;
  return (
    <Popover
      triggerLabel={t('shell.date.button', { range: summary })}
      triggerClassName="btn sm sh-date"
      trigger={<><Icon name="calendar" size={16} /><span data-testid="range-summary" className="sh-date-text">{summary}</span><Icon name="chevD" size={14} /></>}
      panelLabel={t('shell.date.title')}
      panelClassName="sh-date-panel"
    >
      {({ close }) => <DatePanel close={close} />}
    </Popover>
  );
}

function DatePanel({ close }: { close: () => void }) {
  const t = useT();
  const f = useFilters();
  const [from, setFrom] = useState(f.from);
  const [to, setTo] = useState(f.to);
  const valid = Boolean(from && to && from <= to);
  return (
    <div className="stack">
      <div className="stack" role="group" aria-label={t('filter.presets')}>
        <div className="seg sh-presets">
          {PRESETS.map((p) => (
            <button key={p} type="button" aria-pressed={f.preset === p} data-autofocus={f.preset === p ? '' : undefined} onClick={() => { f.setPreset(p); close(); }}>
              {t('filter.lastDays', { count: p })}
            </button>
          ))}
        </div>
      </div>
      <fieldset className="sh-custom">
        <legend className="small muted">{t('shell.date.custom')}</legend>
        <div className="row">
          <label className="field"><span>{t('filter.from')}</span><input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-invalid={!valid} /></label>
          <label className="field"><span>{t('filter.to')}</span><input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-invalid={!valid} /></label>
        </div>
        {!valid ? <p className="small" style={{ color: 'var(--danger)', margin: '6px 0 0' }} role="alert">{t('filter.invalid')}</p> : null}
        <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
          <span className="small muted">{t('shell.date.tz', { tz: f.tz })}</span>
          <button type="button" className="btn primary sm" disabled={!valid} onClick={() => { f.setRange(from, to); close(); }}>{t('shell.date.apply')}</button>
        </div>
      </fieldset>
    </div>
  );
}
