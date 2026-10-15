import { useState } from 'react';
import type { SettingsDTO } from '@orbit/core';
import { useDeleteArchive, useDiagnostics, usePatchSettings, useSettings, useStartScan, useStatus } from '../../api/hooks';
import { ConfirmDialog } from '../../components/Overlay';
import { ErrorState, Query } from '../../components/states';
import { Card, PageHeader } from '../../components/layout';
import { Icon } from '../../components/icons';
import { RateEditor } from '../costs/RateEditor';
import { LOCALES, LOCALE_IDS, isLocale, useFormat, useI18n, useT } from '../../i18n';

const TZ = ['UTC', 'Europe/Istanbul', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Moscow', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney', 'Pacific/Auckland'];
const INTERVALS = [2000, 5000, 10000, 30000, 60000];

function fmtBytes(n: number, locale: string) {
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return n >= 1048576 ? `${nf.format(n / 1048576)} MB` : n >= 1024 ? `${nf.format(n / 1024)} KB` : `${nf.format(n)} B`;
}

function Diagnostics() {
  const t = useT();
  const fmt = useFormat();
  const { locale } = useI18n();
  const q = useDiagnostics();
  return (
    <Query q={q} skeleton={200}>
      {(d) => (
        <div className="grid halves">
          <dl className="kv">
            <dt>{t('diag.lastScan')}</dt><dd>{d.lastScan.finishedAt ? fmt.dateTime(d.lastScan.finishedAt) : '—'}</dd>
            <dt>{t('diag.duration')}</dt><dd>{d.lastScan.durationMs === null ? '—' : fmt.duration(d.lastScan.durationMs)}</dd>
            <dt>{t('diag.filesScanned')}</dt><dd>{fmt.num(d.lastScan.filesScanned)}</dd>
            <dt>{t('diag.filesSkipped')}</dt><dd>{fmt.num(d.lastScan.filesSkipped)}</dd>
            <dt>{t('diag.bytesRead')}</dt><dd>{fmtBytes(d.lastScan.bytesRead, locale)}</dd>
            <dt>{t('diag.orphanAgents')}</dt><dd>{fmt.num(d.orphanAgents)}</dd>
            <dt>{t('diag.unpriced')}</dt><dd>{fmt.num(d.unpricedRequests)}</dd>
            <dt>{t('diag.unpricedModels')}</dt><dd className="wrap-safe">{d.unpricedModels.join(', ') || '—'}</dd>
            <dt>{t('diag.watcher')}</dt><dd>{t(`watcher.${d.watcher}`)}</dd>
            <dt>{t('diag.dbSize')}</dt><dd>{fmtBytes(d.dbSizeBytes, locale)}</dd>
            <dt>{t('diag.schema')}</dt><dd>{d.schemaVersion}</dd>
          </dl>
          <div className="stack">
            <h3>{t('diag.warnings')}</h3>
            {Object.keys(d.warningsByCode).length === 0 ? <p className="muted">{t('diag.noWarnings')}</p> : (
              <dl className="kv">{Object.entries(d.warningsByCode).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt className="mono">{k}</dt><dd>{fmt.num(v)}</dd></div>)}</dl>
            )}
            <h3>{t('diag.discovery')}</h3>
            <dl className="kv">
              <dt>{t('diag.symlinks')}</dt><dd>{fmt.num(d.discovery.symlinksSkipped)}</dd>
              <dt>{t('diag.oversize')}</dt><dd>{fmt.num(d.discovery.oversizeSkipped)}</dd>
              <dt>{t('diag.ignored')}</dt><dd>{fmt.num(d.discovery.ignoredFiles)}</dd>
              <dt>{t('diag.unreadable')}</dt><dd>{fmt.num(d.discovery.unreadable)}</dd>
            </dl>
          </div>
        </div>
      )}
    </Query>
  );
}

function Body({ s }: { s: SettingsDTO }) {
  const t = useT();
  const fmt = useFormat();
  const { locale, setLocale, timezone, setTimezone } = useI18n();
  const status = useStatus();
  const patch = usePatchSettings();
  const scan = useStartScan();
  const del = useDeleteArchive();
  const [path, setPath] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [rateEditor, setRateEditor] = useState(false);
  const scanning = status.data?.scan.state === 'scanning';
  const tzs = TZ.includes(s.timezone) ? TZ : [s.timezone, ...TZ];
  const intervals = INTERVALS.includes(s.watchIntervalMs) ? INTERVALS : [...INTERVALS, s.watchIntervalMs].sort((a, b) => a - b);

  return (
    <>
      {patch.isError ? <ErrorState error={patch.error} /> : null}
      <div className="grid halves">
        <Card title={t('settings.display')}>
          <div className="stack">
            <label className="field"><span>{t('settings.language')}</span>
              <select className="input" value={locale} onChange={(e) => { const v = e.target.value; if (!isLocale(v)) return; setLocale(v); if (v === 'tr' || v === 'en') patch.mutate({ locale: v }); }}>
                {LOCALE_IDS.map((l) => <option key={l} value={l}>{LOCALES[l].label}</option>)}
              </select>
            </label>
            <label className="field"><span>{t('settings.timezone')}</span>
              <select className="input" value={s.timezone} onChange={(e) => { setTimezone(e.target.value); patch.mutate({ timezone: e.target.value }); }}>
                {tzs.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </label>
            <p className="small muted">{t('settings.timezoneHelp', { tz: timezone })}</p>
            <p className="small muted">{t('settings.moneyNote')}</p>
          </div>
        </Card>
        <Card title={t('settings.dataset')}>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="sr-only">{t('settings.dataset')}</legend>
            <label className="check"><input type="radio" name="ds" checked={s.activeDataset === 'real'} disabled={!s.consentGranted || patch.isPending} onChange={() => patch.mutate({ activeDataset: 'real' })} /><span><strong>{t('dataset.real')}</strong><br /><span className="small muted">{s.consentGranted ? t('settings.dataset.realHelp') : t('settings.dataset.needConsent')}</span></span></label>
            <label className="check"><input type="radio" name="ds" checked={s.activeDataset === 'demo'} disabled={patch.isPending} onChange={() => patch.mutate({ activeDataset: 'demo' })} /><span><strong>{t('dataset.demo')}</strong><br /><span className="small muted">{t('settings.dataset.demoHelp')}</span></span></label>
          </fieldset>
        </Card>
      </div>

      <Card title={t('settings.source')}>
        <div className="stack">
          <dl className="kv">
            <dt>{t('settings.sourceLabel')}</dt><dd><code>{s.sourceLabel ?? t('settings.noSource')}</code> {s.sourceIsDefault ? <span className="badge unknown">{t('settings.default')}</span> : null}</dd>
            <dt>{t('settings.dataDir')}</dt><dd><code>{s.dataDirLabel}</code></dd>
          </dl>
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (path.trim()) patch.mutate({ sourceRoot: path.trim() }, { onSuccess: () => setPath('') }); }}>
            <label className="field" style={{ flex: '1 1 320px' }}><span>{t('settings.changePath')}</span><input className="input mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/…/.claude/projects" autoComplete="off" spellCheck={false} /></label>
            <button type="submit" className="btn sm" disabled={!path.trim() || patch.isPending}>{t('action.save')}</button>
            {!s.sourceIsDefault ? <button type="button" className="btn sm" disabled={patch.isPending} onClick={() => patch.mutate({ sourceRoot: 'default' })}>{t('settings.resetPath')}</button> : null}
          </form>
          <p className="small muted">{t('settings.pathHelp')}</p>
          <div className="row">
            <button type="button" className="btn" disabled={scanning || scan.isPending || !s.consentGranted} onClick={() => scan.mutate()}><Icon name="refresh" size={16} />{t('settings.rescan')}</button>
            {scanning ? <span className="small muted" role="status">{t('settings.rescan.running')}</span> : null}
            {!s.consentGranted ? <span className="small muted">{t('settings.rescan.needConsent')}</span> : null}
          </div>
          {scan.isError ? <ErrorState error={scan.error} /> : null}
          {status.data?.lastScanAt ? <p className="small muted">{t('scan.last', { time: fmt.dateTime(status.data.lastScanAt) })}</p> : null}
        </div>
      </Card>

      <div className="grid halves">
        <Card title={t('settings.archive')}>
          <label className="check">
            <input type="checkbox" checked={s.archiveEnabled} disabled={patch.isPending} onChange={(e) => patch.mutate({ archiveEnabled: e.target.checked })} aria-describedby="arch-h" />
            <span><strong>{t('settings.archive.toggle')}</strong><br /><span id="arch-h" className="small muted">{t('onboard.archiveHelp')}</span></span>
          </label>
          <label className="field" style={{ marginTop: 14 }}><span>{t('settings.watch')}</span>
            <select className="input" value={s.watchIntervalMs} onChange={(e) => patch.mutate({ watchIntervalMs: Number(e.target.value) })}>
              {intervals.map((i) => <option key={i} value={i}>{t('settings.seconds', { count: i / 1000 })}</option>)}
            </select>
          </label>
        </Card>
        <Card title={t('settings.rates')}>
          {s.rateOverrides.length === 0 ? <p className="muted">{t('settings.rates.none')}</p> : (
            <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {s.rateOverrides.map((r, i) => <li key={`${r.modelId}-${i}`} className="wrap-safe"><strong>{r.displayName}</strong> <span className="mono muted">{r.modelId}</span> <span className="badge warn local-badge">{t('rates.local')}</span><br /><span className="small muted">{t('settings.rates.row', { input: r.rates.input, output: r.rates.output, cacheRead: r.rates.cacheRead })}</span></li>)}
            </ul>
          )}
          <p className="small muted" style={{ marginTop: 10 }}>{t('settings.rates.note')}</p>
          <div className="row"><button type="button" className="btn" onClick={() => setRateEditor(true)}><Icon name="gear" size={16} />{t('rates.manage')}</button></div>
        </Card>
      </div>

      <Card title={t('settings.diagnostics')}><Diagnostics /></Card>

      <Card title={t('settings.danger')} className="raised">
        <div className="stack">
          <p>{t('settings.delete.body')}</p>
          {del.isSuccess ? <p className="notice good" role="status">{t('settings.delete.done')}</p> : null}
          <div><button type="button" className="btn danger" onClick={() => { del.reset(); setConfirm(true); }}><Icon name="alert" size={16} />{t('settings.delete.button')}</button></div>
        </div>
      </Card>
      {rateEditor ? <RateEditor entries={s.rateOverrides} onClose={() => setRateEditor(false)} /> : null}
      {confirm ? (
        <ConfirmDialog title={t('settings.delete.title')} phrase="DELETE_ORBIT_DATA" confirmLabel={t('settings.delete.confirm')} busy={del.isPending}
          body={<><p>{t('settings.delete.body')}</p><p className="small muted">{t('settings.delete.sourceSafe')}</p></>}
          error={del.isError ? <ErrorState error={del.error} /> : null}
          onCancel={() => setConfirm(false)} onConfirm={() => del.mutate(undefined, { onSuccess: () => setConfirm(false) })} />
      ) : null}
    </>
  );
}

export function Settings({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useT();
  const q = useSettings();
  return (
    <>
      {embedded ? <p className="muted">{t('settings.lead')}</p> : <PageHeader eyebrow={t('nav.settings')} title={t('settings.title')} lead={t('settings.lead')} />}
      <Query q={q} skeleton={300}>{(s) => <Body s={s} />}</Query>
    </>
  );
}
