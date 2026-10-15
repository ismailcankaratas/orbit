import { Component, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Icon } from '../components/icons';
import { CHAPTERS, chapterBySlug } from '../experience/chapters';
import { useExperience } from '../experience/context';
import { SCENES } from '../experience/scenes';
import { useT } from '../i18n';
import { pad2 } from './chapterNav';

function Message({ eyebrow, title, body, children }: { eyebrow?: string; title: string; body: string; children: ReactNode }) {
  return (
    <section className="sh-message" data-testid="scene-message">
      <div className="sh-message-card">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p className="muted">{body}</p>
        <div className="row">{children}</div>
      </div>
    </section>
  );
}

export function PlannedScene({ slug }: { slug: string }) {
  const t = useT();
  const x = useExperience();
  const c = chapterBySlug(slug);
  if (!c) return null;
  return (
    <Message eyebrow={t('shell.planned.eyebrow', { n: pad2(c.number) })} title={t('shell.planned.title')} body={t('shell.planned.body', { title: t(c.titleKey) })}>
      <button type="button" className="btn primary" onClick={() => x.goToChapter('merkez')}><Icon name="chevL" size={16} />{t('shell.planned.back')}</button>
      <button type="button" className="btn" onClick={() => x.openCatalog()}><Icon name="chapters" size={16} />{t('shell.notfound.catalog')}</button>
    </Message>
  );
}

export function NotFoundScene() {
  const t = useT();
  const x = useExperience();
  return (
    <Message title={t('shell.notfound.title')} body={t('shell.notfound.body')}>
      <button type="button" className="btn primary" onClick={() => x.goToChapter('merkez')}><Icon name="chevL" size={16} />{t('shell.planned.back')}</button>
      <button type="button" className="btn" onClick={() => x.openCatalog()}><Icon name="chapters" size={16} />{t('shell.notfound.catalog')}</button>
    </Message>
  );
}

function CrashMessage({ reset }: { reset: () => void }) {
  const t = useT();
  const x = useExperience();
  return (
    <Message title={t('shell.error.title')} body={t('shell.error.body')}>
      <button type="button" className="btn primary" onClick={reset}>{t('action.retry')}</button>
      <button type="button" className="btn" onClick={() => x.goToChapter('merkez')}>{t('shell.planned.back')}</button>
    </Message>
  );
}

/** A crashing scene must never take the shell (rail, Ask, top bar) down with it. */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() {
    return this.state.failed ? <CrashMessage reset={() => this.setState({ failed: false })} /> : this.props.children;
  }
}

/** Route element for /bolum/:slug. */
export function ChapterScene() {
  const { slug } = useParams();
  const x = useExperience();
  const c = chapterBySlug(slug);
  if (!c || !slug) return <NotFoundScene />;
  const Scene = c.status === 'ready' ? SCENES[c.slug] : undefined;
  if (!Scene) return <PlannedScene slug={c.slug} />;
  return (
    <div className="scene-slot" key={c.slug} data-chapter={c.slug} data-chapters-total={CHAPTERS.length}>
      <SceneBoundary key={c.slug}>
        <Scene active goToChapter={x.goToChapter} />
      </SceneBoundary>
    </div>
  );
}
