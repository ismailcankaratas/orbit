import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Page, ProjectSummary } from '@orbit/core';
import { apiGet } from '../api/client';
import { useFilters } from '../api/filters';
import { usePatchSettings, useStartScan } from '../api/hooks';
import { QualityBadge } from '../components/badges';
import { CHAPTERS, foldText } from '../experience/chapters';
import type { AskAnswer, AskIntent } from '../experience/contracts';
import { useExperience } from '../experience/context';
import { useI18n } from '../i18n';
import { executeAsk, wideQuery, type AskDeps } from './execute';
import { EXPLORER_TARGETS, parseAsk } from './parse';
import './ask.css';

interface Suggestion {
  id: string;
  label: string;
  desc: string;
  terms: string;
  intent: AskIntent;
  disabledReason?: string;
}

const EXAMPLE_KEYS = ['ask.example.1', 'ask.example.2', 'ask.example.3', 'ask.example.4'] as const;
const SILENT_COMMANDS = new Set(['chapters', 'help', 'settings', 'explorer', 'go']);

function downloadFile(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function OrbitAsk() {
  const { t, locale, setLocale, timezone, fmt } = useI18n();
  const exp = useExperience();
  const filters = useFilters();
  const qc = useQueryClient();
  const patch = usePatchSettings();
  const scan = useStartScan();
  const uid = useId();
  const listId = `${uid}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);

  // Project labels are looked up lazily (once the field is used) from the local API only.
  const projects = useQuery({
    queryKey: ['ask-projects', timezone],
    enabled: focused || text !== '',
    staleTime: 60_000,
    queryFn: ({ signal }) => apiGet<Page<ProjectSummary>>('/api/v1/projects', { ...wideQuery(timezone, new Date()), sort: 'tokens', limit: 200 }, signal),
  });
  const projectLabels = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects.data?.items ?? []) {
      if (p.alias) set.add(p.alias);
      set.add(p.label);
    }
    return [...set];
  }, [projects.data]);

  const parse = useCallback((s: string) => parseAsk(s, { now: new Date(), tz: timezone, locale, projectLabels }), [timezone, locale, projectLabels]);

  /* ---------- suggestions for "/" ---------- */
  const catalog = useMemo<Suggestion[]>(() => {
    const cmd = (id: string, command: Extract<AskIntent, { kind: 'command' }>['command'], arg: string | undefined, terms: string): Suggestion => ({
      id,
      label: t(`ask.cmd.${id}.label`),
      desc: t(`ask.cmd.${id}.desc`),
      terms: foldText(`${t(`ask.cmd.${id}.label`)} ${t(`ask.cmd.${id}.desc`)} ${terms}`),
      intent: { kind: 'command', command, ...(arg ? { arg } : {}) },
    });
    const list: Suggestion[] = [
      cmd('chapters', 'chapters', undefined, 'bolumler chapters katalog catalog'),
      cmd('help', 'help', undefined, 'yardim help kisayol shortcuts'),
      cmd('export_csv', 'export_csv', undefined, 'disa-aktar export csv indir download'),
      cmd('export_json', 'export_json', undefined, 'disa-aktar export json indir download'),
      cmd('settings', 'settings', undefined, 'ayarlar settings'),
      cmd('rescan', 'rescan', undefined, 'tara scan rescan tarama'),
      cmd('demo', 'demo', undefined, 'demo sentetik synthetic'),
      cmd('real', 'real', undefined, 'gercek real'),
    ];
    for (const key of ['projects', 'sessions', 'agents', 'timeline', 'costs', 'reports']) {
      const path = EXPLORER_TARGETS[key];
      const termsTr = { projects: 'projeler', sessions: 'oturumlar', agents: 'ajanlar', timeline: 'zaman', costs: 'maliyetler', reports: 'raporlar' }[key];
      list.push(cmd(`explorer.${key}`, 'explorer', path, `gezgin explore explorer ${termsTr} ${key}`));
    }
    list.push(cmd('language.tr', 'language', 'tr', 'dil language turkce turkish'), cmd('language.en', 'language', 'en', 'dil language ingilizce english'));
    for (const c of CHAPTERS) {
      const title = t(c.titleKey);
      const num = String(c.number).padStart(2, '0');
      list.push({
        id: `chapter.${c.slug}`,
        label: `/${c.slug}`,
        desc: t('ask.suggest.chapter', { number: num, title }),
        terms: foldText(`${c.slug} ${title} ${c.aliases.join(' ')} ${num}`),
        intent: { kind: 'command', command: 'go', arg: c.slug },
        ...(c.status === 'planned' ? { disabledReason: t('ask.suggest.planned') } : {}),
      });
    }
    return list;
  }, [t]);

  const open = text.startsWith('/') && !dismissed;
  const suggestions = useMemo(() => {
    if (!text.startsWith('/')) return [];
    const toks = foldText(text.slice(1)).split(/\s+/).filter(Boolean);
    return catalog.filter((s) => toks.every((tok) => s.terms.includes(tok)));
  }, [text, catalog]);

  /* ---------- running ---------- */
  const deps = useCallback(
    (): AskDeps => ({
      now: new Date(),
      tz: timezone,
      t,
      fmt,
      query: filters.query,
      search: filters.search,
      get: (path, q) => apiGet(path, q),
      actions: {
        goToChapter: exp.goToChapter,
        openCatalog: exp.openCatalog,
        openHelp: exp.openHelp,
        openSettings: exp.openSettings,
        openExplorer: exp.openExplorer,
        download: downloadFile,
        rescan: () => scan.mutateAsync(),
        setDataset: (mode) => patch.mutateAsync({ activeDataset: mode }),
        setLanguage: async (l) => {
          await patch.mutateAsync({ locale: l });
          setLocale(l);
        },
      },
    }),
    [timezone, t, fmt, filters.query, filters.search, exp, scan, patch, setLocale],
  );

  const run = useCallback(
    async (intent: AskIntent) => {
      const id = ++reqId.current;
      setDismissed(true);
      setActive(-1);
      setAnswer(null);
      setLoading(true);
      const res = await executeAsk(intent, deps());
      if (id !== reqId.current) return;
      setLoading(false);
      const silent = res.status === 'action_done' && (intent.kind === 'catalog' || (intent.kind === 'command' && SILENT_COMMANDS.has(intent.command)));
      if (silent) {
        setText('');
        setAnswer(null);
        return;
      }
      setAnswer(res);
      if (res.status === 'action_done') setText('');
      qc.invalidateQueries({ queryKey: ['ask-projects'] });
    },
    [deps, qc],
  );

  const ask = (q: string) => {
    setText(q);
    void run(parse(q));
  };

  const submit = () => {
    const s = text.trim();
    if (!s) return;
    const pick = active >= 0 ? suggestions[active] : undefined;
    if (pick) return void run(pick.intent);
    const intent = parse(s);
    if (intent.kind === 'catalog') {
      if (suggestions.length === 1 && suggestions[0]) return void run(suggestions[0].intent);
      return void run(intent);
    }
    void run(intent);
  };

  const dismiss = () => {
    reqId.current++;
    setAnswer(null);
    setLoading(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && open && suggestions.length) {
      e.preventDefault();
      setActive((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === 'ArrowUp' && open && suggestions.length) {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      const something = text !== '' || answer !== null || loading;
      if (something) {
        e.stopPropagation();
        dismiss();
        setText('');
        setDismissed(false);
      } else {
        e.currentTarget.blur();
      }
    }
  };

  const showChips = focused && text === '' && !answer && !loading;
  const message = answer ? t(answer.messageKey, answer.params) : '';
  const unsupported = answer?.messageKey === 'ask.answer.unsupported';
  const activeId = open && active >= 0 && suggestions[active] ? `${uid}-opt-${active}` : undefined;

  return (
    <div
      className="ask"
      ref={rootRef}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(e) => {
        // Esc from the answer card (close button, link, chips) behaves like Esc in the field.
        if (e.key === 'Escape' && e.target !== e.currentTarget.querySelector('.ask-input') && (answer || loading)) {
          e.stopPropagation();
          dismiss();
        }
      }}
    >
      {open ? (
        suggestions.length ? (
          <ul className="ask-pop" role="listbox" id={listId} aria-label={t('ask.suggest.label')} onMouseDown={(e) => e.preventDefault()}>
            {suggestions.map((s, i) => (
              <li
                key={s.id}
                id={`${uid}-opt-${i}`}
                role="option"
                className="ask-opt"
                aria-selected={i === active}
                {...(s.disabledReason ? { 'aria-disabled': true } : {})}
                onClick={() => void run(s.intent)}
                onMouseMove={() => active !== i && setActive(i)}
              >
                <span className="ask-opt-label">{s.label}</span>
                <span className="ask-opt-desc">{s.desc}</span>
                {s.disabledReason ? <span className="ask-opt-reason">{s.disabledReason}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="ask-pop" id={listId}>
            <p className="ask-empty" role="status">
              {t('ask.suggest.empty')}
            </p>
          </div>
        )
      ) : null}

      <div className="ask-live" aria-live="polite" aria-atomic="true">
        {loading ? (
          <div className="ask-card" aria-busy="true">
            {t('ask.loading')}
          </div>
        ) : null}
        {answer && !open ? (
          <section className={`ask-card ${answer.status}`} aria-label={t('ask.label')} data-status={answer.status}>
            <button type="button" className="ask-close" aria-label={t('ask.close')} onClick={() => dismiss()}>
              <span aria-hidden="true">×</span>
            </button>
            {answer.figure ? <div className="ask-figure">{answer.figure}</div> : null}
            <p className="ask-text">{message}</p>
            {answer.moneyCaveat ? <p className="ask-caveat">{t('ask.moneyCaveat')}</p> : null}
            {answer.quality || answer.evidenceHref ? (
              <div className="ask-meta">
                {answer.quality ? <QualityBadge quality={answer.quality} /> : null}
                {answer.evidenceHref ? (
                  <Link className="ask-link" to={answer.evidenceHref} onClick={() => dismiss()}>
                    {t('ask.evidence')}
                  </Link>
                ) : null}
              </div>
            ) : null}
            {unsupported ? (
              <>
                <p className="ask-examples-title">{t('ask.answer.unsupportedHint')}</p>
                <div className="ask-chips">
                  {EXAMPLE_KEYS.map((k) => (
                    <button key={k} type="button" className="ask-chip" onClick={() => ask(t(k))}>
                      {t(k)}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        ) : null}
        {showChips ? (
          <div className="ask-chips-wrap" onMouseDown={(e) => e.preventDefault()}>
            <p className="ask-sr">{t('ask.examples.title')}</p>
            <div className="ask-chips" role="group" aria-label={t('ask.examples.title')}>
              {EXAMPLE_KEYS.slice(0, 3).map((k) => (
                <button key={k} type="button" className="ask-chip" onClick={() => ask(t(k))}>
                  {t(k)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <form
        className="ask-form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={`${uid}-input`} className="ask-sr">
          {t('ask.label')}
        </label>
        <input
          id={`${uid}-input`}
          data-orbit-ask-input=""
          className="ask-input"
          type="text"
          role="combobox"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="send"
          maxLength={200}
          placeholder={t('ask.placeholder')}
          aria-label={t('ask.label')}
          aria-describedby={`${uid}-hint`}
          aria-autocomplete="list"
          aria-expanded={open}
          {...(open ? { 'aria-controls': listId } : {})}
          {...(activeId ? { 'aria-activedescendant': activeId } : {})}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(-1);
            setDismissed(false);
            if (answer) setAnswer(null);
          }}
          onKeyDown={onKeyDown}
        />
        <span id={`${uid}-hint`} className="ask-sr">
          {t('ask.hint')}
        </span>
        <kbd className="ask-kbd" aria-hidden="true">
          /
        </kbd>
        <button type="submit" className="ask-submit" disabled={text.trim() === ''}>
          {t('ask.submit')}
        </button>
      </form>
    </div>
  );
}
