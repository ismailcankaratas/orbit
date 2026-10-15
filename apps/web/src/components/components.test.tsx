import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderWith } from '../test/utils';
import { DatasetBadge, MoneyValue, QualityBadge } from './badges';
import { MONEY_LABEL_EN, MONEY_LABEL_TR } from '@orbit/core';

afterEach(cleanup);

describe('MoneyValue', () => {
  it('always exposes the estimated API-equivalent label (tr)', () => {
    const { container } = renderWith(<MoneyValue usd="12.400000" />);
    expect(container.textContent).toContain(MONEY_LABEL_TR);
    expect(container.textContent).toContain('$12,40');
  });
  it('keeps the label in the DOM for dense (sr) mode and in English', () => {
    const { container } = renderWith(<MoneyValue usd="12.4" labelMode="sr" />, { locale: 'en' });
    expect(container.querySelector('.sr-only')?.textContent).toContain(MONEY_LABEL_EN);
  });
  it('marks null as unpriced, never as zero', () => {
    const { container } = renderWith(<MoneyValue usd={null} />);
    expect(container.textContent).toContain('fiyatsız');
    expect(container.textContent).not.toContain('$0');
  });
});

describe('QualityBadge', () => {
  it('has an accessible name and a tooltip that opens on click/focus', () => {
    renderWith(<QualityBadge quality="estimated" />);
    const btn = screen.getByRole('button', { name: /Veri niteliği: tahmini/ });
    expect(btn.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByRole('tooltip').className).not.toContain('open');
    btn.click();
    return Promise.resolve().then(() => expect(screen.getByRole('tooltip').className).toContain('open'));
  });
});

describe('DatasetBadge', () => {
  it('shows an unmistakable demo warning', () => {
    renderWith(<DatasetBadge mode="demo" />);
    const el = screen.getByRole('status');
    expect(el.textContent).toBe('Demo — sentetik veri');
    expect(el.className).toContain('dataset-demo');
  });
  it('labels real data', () => {
    renderWith(<DatasetBadge mode="real" />);
    expect(screen.getByRole('status').textContent).toBe('Gerçek veri');
  });
});
