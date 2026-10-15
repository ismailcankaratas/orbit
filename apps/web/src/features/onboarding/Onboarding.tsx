import { useState } from 'react';
import type { StatusDTO } from '@orbit/core';
import { ApiRequestError } from '../../api/client';
import { usePatchSettings, useStartScan } from '../../api/hooks';
import { LangSwitch } from '../../components/Topbar';
import { OrbitHero } from '../../components/OrbitHero';
import { ErrorState } from '../../components/states';
import { Icon, OrbitLogo } from '../../components/icons';
import { useT } from '../../i18n';

export function Onboarding({ status }: { status: StatusDTO | undefined }) {
  const t = useT();
  const patch = usePatchSettings();
  const scan = useStartScan();
  const [custom, setCustom] = useState('');
  const [archive, setArchive] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const s = status?.scan;
  const scanning = s?.state === 'scanning';
  const pct = s && s.filesTotal > 0 ? Math.round((s.filesDone / s.filesTotal) * 100) : 0;
  const lastError = s?.state === 'error' ? s.lastError : null;

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const path = custom.trim();
      if (path) await patch.mutateAsync({ sourceRoot: path });
      await patch.mutateAsync({ consentGranted: true, archiveEnabled: archive });
      await scan.mutateAsync();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const demo = async () => {
    setError(null);
    setBusy(true);
    try {
      await patch.mutateAsync({ activeDataset: 'demo' });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <a className="skip-link" href="#main">{t('a11y.skip')}</a>
      <main id="main" className="onboard">
        <div className="stack" style={{ gap: 18 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="brand" style={{ padding: 0 }}><OrbitLogo size={32} />orbit</span>
            <LangSwitch id="lang-onboard" />
          </div>
          <div className="eyebrow">{t('onboard.eyebrow')}</div>
          <h1>{t('onboard.title')}</h1>
          <p className="muted" style={{ fontSize: 17, maxWidth: '56ch' }}>{t('onboard.lead')}</p>

          <section className="card stack" aria-labelledby="src-h">
            <h2 id="src-h">{t('onboard.source')}</h2>
            <p className="small"><code>~/.claude/projects</code> <span className="muted">— {t('onboard.sourceDefault')}</span></p>
            <label className="field">
              <span>{t('onboard.customPath')}</span>
              <input className="input mono" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="/Users/…/.claude/projects" autoComplete="off" spellCheck={false} aria-describedby="path-help" />
            </label>
            <p id="path-help" className="small muted">{t('onboard.customPathHelp')}</p>
            <ul className="step-list">
              <li>{t('onboard.readonly')}</li>
              <li>{t('onboard.coverage')}</li>
              <li>{t('onboard.estimate')}</li>
              <li>{t('onboard.noNetwork')}</li>
              <li>{t('onboard.noConsentNoScan')}</li>
            </ul>
            <label className="check">
              <input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} aria-describedby="arch-help" />
              <span><strong>{t('onboard.archive')}</strong><br /><span id="arch-help" className="small muted">{t('onboard.archiveHelp')}</span></span>
            </label>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => void start()} disabled={busy || scanning}><Icon name="search" size={16} />{t('onboard.scan')}</button>
              <button type="button" className="btn" onClick={() => void demo()} disabled={busy || scanning}><Icon name="eye" size={16} />{t('onboard.demo')}</button>
            </div>
            <p className="small muted">{t('onboard.demoHelp')}</p>
            {scanning || busy ? (
              <div role="status" aria-live="polite" className="stack">
                <span>{scanning ? t('scan.scanning', { done: s?.filesDone ?? 0, total: s?.filesTotal ?? 0 }) : t('onboard.preparing')}</span>
                <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('scan.progress')}><i style={{ width: `${pct}%` }} /></div>
              </div>
            ) : null}
            {error ? <ErrorState error={error} /> : lastError ? <ErrorState error={new ApiRequestError(lastError, '', false, 0)} /> : null}
          </section>
        </div>
        <div className="art"><OrbitHero /></div>
      </main>
    </div>
  );
}
