import type { StatusDTO } from '@orbit/core';
import { usePatchSettings } from '../api/hooks';
import { DatasetBadge } from '../components/badges';
import { Icon, OrbitLogo } from '../components/icons';
import { FLink } from '../components/layout';
import { Popover } from '../ds';
import { LOCALES, LOCALE_IDS, useFormat, useI18n, useT } from '../i18n';
import { DateSelector } from './DateSelector';
import { useMedia } from './useMedia';

export function LangToggle() {
  const t = useT();
  const { locale, setLocale } = useI18n();
  const patch = usePatchSettings();
  return (
    <div className="seg sh-lang" role="group" aria-label={t('shell.lang.label')}>
      {LOCALE_IDS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={locale === l}
          aria-label={LOCALES[l].label}
          title={LOCALES[l].label}
          onClick={() => {
            setLocale(l);
            if (l === 'tr' || l === 'en') patch.mutate({ locale: l });
          }}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function ScanChip({ status }: { status: StatusDTO }) {
  const t = useT();
  const fmt = useFormat();
  const s = status.scan;
  const watcher = (
    <span className={`badge ${status.watcher === 'watching' ? 'good' : status.watcher === 'error' ? 'danger' : 'unknown'}`} title={t(`watcher.${status.watcher}.help`)}>
      <Icon name={status.watcher === 'watching' ? 'eye' : status.watcher === 'error' ? 'alert' : 'flat'} size={13} />
      {t(`watcher.${status.watcher}`)}
    </span>
  );
  return (
    <div className="sh-scan small" data-testid="scan-chip">
      {s.state === 'scanning' ? (
        <span className="badge warn" role="status"><Icon name="refresh" size={13} />{t('scan.scanning', { done: s.filesDone, total: s.filesTotal })}</span>
      ) : s.state === 'error' ? (
        <span className="badge danger"><Icon name="alert" size={13} />{t(`error.${s.lastError ?? 'INTERNAL'}.title`)}</span>
      ) : (
        <span className="muted sh-scan-time">{status.lastScanAt ? t('scan.last', { time: fmt.dateTime(status.lastScanAt) }) : t('scan.never')}</span>
      )}
      {watcher}
    </div>
  );
}

export function TopBar({ status, onSettings }: { status: StatusDTO | undefined; onSettings: () => void }) {
  const t = useT();
  const compact = useMedia('(max-width: 767px)');
  return (
    <header className="sh-top">
      <FLink to="/bolum/merkez" className="sh-brand" aria-label={t('shell.brand.home')}>
        <OrbitLogo size={26} />
        <span className="brand-name">orbit</span>
      </FLink>
      {status ? <DatasetBadge mode={status.mode} /> : null}
      {status?.mode === 'demo' && !compact ? <span className="sh-demo-note small muted" data-testid="demo-note">{t('shell.demo.notice')}</span> : null}
      <span className="spacer" />
      {compact ? (
        <>
          <DateSelector />
          <Popover
            triggerLabel={t('shell.menu.open')}
            triggerClassName="icon-btn"
            trigger={<Icon name="menu" />}
            panelLabel={t('shell.menu.title')}
          >
            {({ close }) => (
              <div className="stack">
                {status ? <ScanChip status={status} /> : null}
                <LangToggle />
                <button type="button" className="btn sm" onClick={() => { close(); onSettings(); }}><Icon name="gear" size={16} />{t('shell.settings.open')}</button>
              </div>
            )}
          </Popover>
        </>
      ) : (
        <>
          {status ? <ScanChip status={status} /> : null}
          <DateSelector />
          <LangToggle />
          <button type="button" className="icon-btn" onClick={onSettings} aria-label={t('shell.settings.open')} title={t('shell.settings.open')}><Icon name="gear" /></button>
        </>
      )}
    </header>
  );
}
