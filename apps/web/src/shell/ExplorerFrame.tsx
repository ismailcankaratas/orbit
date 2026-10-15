import type { ReactNode } from 'react';
import { Icon } from '../components/icons';
import { useExperience } from '../experience/context';
import { useT } from '../i18n';

export type ExplorerView = 'projects' | 'project' | 'sessions' | 'session' | 'agents' | 'timeline' | 'costs' | 'reports' | 'story' | 'settings';

/** Transitional "Veri gezgini" wrapper: legacy views render inside the scene area, internally scrollable. */
export function ExplorerFrame({ view, children }: { view: ExplorerView; children: ReactNode }) {
  const t = useT();
  const x = useExperience();
  return (
    <section className="explorer" data-testid="explorer-frame" aria-label={t('shell.explorer.title')}>
      <div className="explorer-head">
        <p className="eyebrow">{t('shell.explorer.title')} · {t(`shell.explorer.view.${view}`)}</p>
        <button type="button" className="btn sm" onClick={() => x.goToChapter('merkez')}>
          <Icon name="chevL" size={16} />{t('shell.explorer.back')}
        </button>
      </div>
      <div className="explorer-body">{children}</div>
    </section>
  );
}
