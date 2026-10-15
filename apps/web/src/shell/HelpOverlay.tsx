import { Modal } from '../ds';
import { useT } from '../i18n';

const KEYS: { keys: string[]; label: string }[] = [
  { keys: ['→', 'PgDn'], label: 'shell.help.key.next' },
  { keys: ['←', 'PgUp'], label: 'shell.help.key.prev' },
  { keys: ['Home', 'End'], label: 'shell.help.key.firstLast' },
  { keys: ['C'], label: 'shell.help.key.catalog' },
  { keys: ['/'], label: 'shell.help.key.ask' },
  { keys: ['?'], label: 'shell.help.key.help' },
  { keys: ['Esc'], label: 'shell.help.key.esc' },
];
const EXAMPLES = ['shell.help.ex.1', 'shell.help.ex.2', 'shell.help.ex.3', 'shell.help.ex.4', 'shell.help.ex.5', 'shell.help.ex.6'];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Modal title={t('shell.help.title')} onClose={onClose}>
      <section aria-label={t('shell.help.keys')}>
        <dl className="sh-keys">
          {KEYS.map((k) => (
            <div key={k.label} className="sh-key-row">
              <dt>{k.keys.map((c, i) => <span key={c}>{i > 0 ? ' ' : ''}<kbd>{c}</kbd></span>)}</dt>
              <dd>{t(k.label)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h3>{t('shell.help.askTitle')}</h3>
        <ul className="sh-examples">
          {EXAMPLES.map((k) => <li key={k}><code>{t(k)}</code></li>)}
        </ul>
        <p className="small muted">{t('shell.help.note')}</p>
      </section>
    </Modal>
  );
}
