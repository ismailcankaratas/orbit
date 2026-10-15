import { useState } from 'react';
import type { RateEntry } from '@orbit/core';
import { ApiRequestError } from '../../api/client';
import { usePatchSettings } from '../../api/hooks';
import { Drawer } from '../../components/Overlay';
import { Icon } from '../../components/icons';
import { useT } from '../../i18n';
import { draftFromEntry, emptyDraft, hasOverlap, RATE_KEYS, validateDraft, type RateDraft, type RateErrors } from './rates';

const RATE_LABEL: Record<(typeof RATE_KEYS)[number], string> = {
  input: 'tokens.uncachedInput',
  output: 'tokens.output',
  cacheRead: 'tokens.cacheRead',
  cacheWrite5m: 'tokens.cacheWrite5m',
  cacheWrite1h: 'tokens.cacheWrite1h',
};

/** Drawer to add/edit/delete user rate overrides. Saves the complete list via PATCH /settings {rateOverrides}. */
export function RateEditor({ entries, prefillModelId, onClose }: { entries: RateEntry[]; prefillModelId?: string | null; onClose: () => void }) {
  const t = useT();
  const patch = usePatchSettings();
  const [draft, setDraft] = useState<RateDraft | null>(prefillModelId ? emptyDraft(prefillModelId) : null);
  const [editing, setEditing] = useState<number | null>(null);
  const [errors, setErrors] = useState<RateErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const save = (next: RateEntry[], done: () => void) => {
    patch.reset();
    patch.mutate({ rateOverrides: next }, { onSuccess: done });
  };

  const submit = () => {
    if (!draft) return;
    const { errors: errs, entry } = validateDraft(draft);
    setErrors(errs);
    setFormError(null);
    if (!entry) return;
    const orig = editing !== null ? entries[editing] : undefined;
    const merged: RateEntry = orig
      ? {
          ...entry,
          effectiveFrom: orig.effectiveFrom.slice(0, 10) === draft.effectiveFrom ? orig.effectiveFrom : entry.effectiveFrom,
          effectiveTo: orig.effectiveTo && orig.effectiveTo.slice(0, 10) === draft.effectiveTo ? orig.effectiveTo : entry.effectiveTo,
          ...(orig.longPromptTier ? { longPromptTier: orig.longPromptTier } : {}),
        }
      : entry;
    const next = editing !== null ? entries.map((e, i) => (i === editing ? merged : e)) : [...entries, merged];
    if (hasOverlap(next)) {
      setFormError(t('rates.err.overlap'));
      return;
    }
    save(next, () => {
      setDraft(null);
      setEditing(null);
    });
  };

  const set = <K extends keyof RateDraft>(k: K, v: RateDraft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const serverMsg = patch.error instanceof ApiRequestError ? patch.error : null;

  const field = (k: 'modelId' | 'displayName' | 'aliases' | 'effectiveFrom' | 'effectiveTo', label: string, props: { type?: string; mono?: boolean; autofocus?: boolean } = {}) => {
    const err = errors[k];
    return (
      <label className="field">
        <span>{label}</span>
        <input
          className={`input${props.mono ? ' mono' : ''}`}
          type={props.type ?? 'text'}
          value={draft?.[k] ?? ''}
          onChange={(e) => set(k, e.target.value)}
          aria-invalid={!!err}
          aria-describedby={err ? `err-${k}` : undefined}
          autoComplete="off"
          spellCheck={false}
          {...(props.autofocus ? { 'data-autofocus': true } : {})}
        />
        {err ? <span id={`err-${k}`} className="field-error" role="alert">{t(`rates.err.${err}`)}</span> : null}
      </label>
    );
  };

  return (
    <Drawer title={t('rates.title')} onClose={onClose}>
      <p className="small muted">{t('rates.intro')}</p>
      {entries.length === 0 ? <p className="muted">{t('settings.rates.none')}</p> : (
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {entries.map((e, i) => (
            <li key={`${e.modelId}-${e.effectiveFrom}-${i}`} className="card raised" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="wrap-safe"><strong>{e.displayName}</strong> <span className="mono muted">{e.modelId}</span></span>
                <span className="badge warn">{t('rates.local')}</span>
              </div>
              <div className="small muted">{t('rates.row', { input: e.rates.input, output: e.rates.output, cacheRead: e.rates.cacheRead, from: e.effectiveFrom.slice(0, 10), to: e.effectiveTo ? e.effectiveTo.slice(0, 10) : t('rates.open') })}</div>
              <div className="row" style={{ marginTop: 8 }}>
                <button type="button" className="btn sm" disabled={patch.isPending} onClick={() => { setDraft(draftFromEntry(e)); setEditing(i); setErrors({}); setFormError(null); }}>{t('rates.edit')}</button>
                <button type="button" className="btn sm danger" disabled={patch.isPending} onClick={() => save(entries.filter((_, j) => j !== i), () => { if (editing === i) { setDraft(null); setEditing(null); } })}>{t('rates.delete')}</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft ? (
        <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }} aria-label={editing !== null ? t('rates.editTitle') : t('rates.addTitle')}>
          <h3>{editing !== null ? t('rates.editTitle') : t('rates.addTitle')}</h3>
          {field('modelId', t('rates.modelId'), { mono: true, autofocus: true })}
          {field('displayName', t('rates.displayName'))}
          {field('aliases', t('rates.aliases'), { mono: true })}
          <div className="grid halves" style={{ gap: 12 }}>
            {field('effectiveFrom', t('rates.effectiveFrom'), { type: 'date' })}
            {field('effectiveTo', t('rates.effectiveTo'), { type: 'date' })}
          </div>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small muted" style={{ padding: 0 }}>{t('rates.perMTok')}</legend>
            <div className="grid halves" style={{ gap: 12 }}>
              {RATE_KEYS.map((k) => (
                <label key={k} className="field">
                  <span>{t(RATE_LABEL[k])}</span>
                  <input className="input mono" inputMode="decimal" value={draft.rates[k]} onChange={(e) => setDraft((d) => (d ? { ...d, rates: { ...d.rates, [k]: e.target.value } } : d))} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `err-${k}` : undefined} autoComplete="off" />
                  {errors[k] ? <span id={`err-${k}`} className="field-error" role="alert">{t(`rates.err.${errors[k]}`)}</span> : null}
                </label>
              ))}
            </div>
          </fieldset>
          {formError ? <p className="field-error" role="alert">{formError}</p> : null}
          {serverMsg ? <div className="notice danger" role="alert"><Icon name="alert" size={16} /><span><strong>{t('rates.serverRejected')}</strong><br /><span className="small wrap-safe">{serverMsg.message}</span></span></div> : patch.isError ? <p className="field-error" role="alert">{t('error.NETWORK.title')}</p> : null}
          <div className="row">
            <button type="submit" className="btn primary" disabled={patch.isPending}>{t('action.save')}</button>
            <button type="button" className="btn" onClick={() => { setDraft(null); setEditing(null); setErrors({}); setFormError(null); patch.reset(); }}>{t('action.cancel')}</button>
          </div>
        </form>
      ) : (
        <div>
          <button type="button" className="btn primary" onClick={() => { setDraft(emptyDraft()); setEditing(null); setErrors({}); }}><Icon name="plus" size={16} />{t('rates.add')}</button>
          {serverMsg ? <div className="notice danger" role="alert" style={{ marginTop: 12 }}><Icon name="alert" size={16} /><span className="small wrap-safe">{serverMsg.message}</span></div> : null}
        </div>
      )}
    </Drawer>
  );
}
