import { EmptyState } from '../components/states';
import { FLink } from '../components/layout';
import { useT } from '../i18n';

export function NotFound() {
  const t = useT();
  return <EmptyState title={t('notfound.title')} body={t('notfound.body')} action={<FLink to="/" className="btn">{t('notfound.home')}</FLink>} />;
}
