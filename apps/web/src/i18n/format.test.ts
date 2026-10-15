import { describe, expect, it } from 'vitest';
import { makeFormatters } from './format';

describe('formatters', () => {
  it('compacts tokens per locale', () => {
    expect(makeFormatters('tr', 'UTC').compact(12_400_000)).toBe('12,4 Mn');
    expect(makeFormatters('en', 'UTC').compact(12_400_000)).toBe('12.4M');
    expect(makeFormatters('tr', 'UTC').compact(1_500)).toBe('1,5 B');
    expect(makeFormatters('en', 'UTC').compact(999_999)).toBe('1M');
    expect(makeFormatters('en', 'UTC').compact(842)).toBe('842');
  });
  it('formats USD (never TRY) in both locales', () => {
    const tr = makeFormatters('tr', 'UTC').usd('428.36');
    const en = makeFormatters('en', 'UTC').usd('428.36');
    expect(tr).toContain('428,36');
    expect(tr).toContain('$');
    expect(tr).not.toMatch(/₺|TRY/);
    expect(en).toBe('$428.36');
    expect(makeFormatters('en', 'UTC').usd('0.004200')).toBe('$0.0042');
  });
  it('percentages follow locale', () => {
    expect(makeFormatters('tr', 'UTC').pct(0.94)).toBe('%94');
    expect(makeFormatters('en', 'UTC').pct(0.94)).toBe('94%');
  });
  it('renders instants in the explicit timezone', () => {
    const iso = '2026-10-15T01:30:00Z';
    expect(makeFormatters('tr', 'Europe/Istanbul').time(iso)).toBe('04:30');
    expect(makeFormatters('tr', 'America/New_York').time(iso)).toBe('21:30');
    expect(makeFormatters('tr', 'America/New_York').date(iso)).not.toBe(makeFormatters('tr', 'Europe/Istanbul').date(iso));
    expect(makeFormatters('en', 'Europe/Istanbul').dateTime(iso)).toMatch(/04:30/);
  });
  it('formats durations with locale units', () => {
    expect(makeFormatters('tr', 'UTC').duration(2 * 3600_000 + 5 * 60_000)).toBe('2 sa 5 dk');
    expect(makeFormatters('en', 'UTC').duration(2 * 3600_000 + 5 * 60_000)).toBe('2 h 5 m');
  });
});
