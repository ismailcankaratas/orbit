/**
 * Orbit Ask parser: PURE and deterministic (no I/O, no LLM). Text in -> AskIntent out.
 * Everything is matched on ASCII-folded text (foldText) so "dışa-aktar" == "disa-aktar".
 */
import type { AskCommand, AskIntent, AskQuestion, AskRange } from '../experience/contracts';
import { CHAPTERS, foldText } from '../experience/chapters';
import { addDays, dayStartIso, todayIn } from '../api/dates';

export interface AskParseContext {
  now: Date;
  tz: string;
  locale: 'tr' | 'en';
  projectLabels: string[];
}

/** Explorer targets (data explorer routes) keyed by every accepted spelling. */
export const EXPLORER_TARGETS: Record<string, string> = {
  projeler: '/projects',
  projects: '/projects',
  oturumlar: '/sessions',
  sessions: '/sessions',
  ajanlar: '/agents',
  agents: '/agents',
  zaman: '/timeline',
  timeline: '/timeline',
  maliyetler: '/costs',
  costs: '/costs',
  raporlar: '/reports',
  reports: '/reports',
};

const CMD_HEADS: Record<string, AskCommand | 'export' | 'language_cmd' | 'explorer_cmd'> = {
  bolumler: 'chapters',
  bolum: 'chapters',
  chapters: 'chapters',
  chapter: 'chapters',
  yardim: 'help',
  help: 'help',
  'disa-aktar': 'export',
  disaaktar: 'export',
  export: 'export',
  ayarlar: 'settings',
  ayar: 'settings',
  settings: 'settings',
  tara: 'rescan',
  tarama: 'rescan',
  scan: 'rescan',
  rescan: 'rescan',
  demo: 'demo',
  gercek: 'real',
  real: 'real',
  gezgin: 'explorer_cmd',
  explore: 'explorer_cmd',
  explorer: 'explorer_cmd',
  dil: 'language_cmd',
  language: 'language_cmd',
  lang: 'language_cmd',
};

function parseCommand(f: string): AskIntent {
  let rest = f.slice(1).trim().replace(/^disa\s+aktar\b/, 'disa-aktar');
  if (rest === '') return { kind: 'catalog', filter: '' };
  const [head = '', ...tail] = rest.split(/\s+/);
  const arg = tail.join(' ');
  const cmd = CMD_HEADS[head];
  if (cmd === 'export') {
    if (arg === 'csv') return { kind: 'command', command: 'export_csv' };
    if (arg === 'json') return { kind: 'command', command: 'export_json' };
  } else if (cmd === 'explorer_cmd') {
    const path = EXPLORER_TARGETS[arg];
    if (path) return { kind: 'command', command: 'explorer', arg: path };
  } else if (cmd === 'language_cmd') {
    if (arg === 'tr' || arg === 'en') return { kind: 'command', command: 'language', arg };
  } else if (cmd && arg === '') {
    return { kind: 'command', command: cmd };
  }
  // export/explorer/language heads with a missing or invalid argument: let the user pick from the list
  if (cmd === 'export' || cmd === 'explorer_cmd' || cmd === 'language_cmd') return { kind: 'catalog', filter: rest };
  rest = rest.trim();
  const chapter = CHAPTERS.find((c) => c.slug === rest || c.aliases.includes(rest));
  if (chapter) return { kind: 'command', command: 'go', arg: chapter.slug };
  return { kind: 'catalog', filter: rest };
}

/* ---------------- time phrases ---------------- */

const MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6, temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const MONTH_RE = new RegExp(`\\b(${Object.keys(MONTHS).join('|')})(?:de|da|te|ta|\\s+ayinda|\\s+ayi)?(?:\\s+(20\\d\\d))?\\b`);

function ymdParts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return [y, m, d];
}
const pad = (n: number) => String(n).padStart(2, '0');
const mondayOf = (ymd: string): string => {
  const [y, m, d] = ymdParts(ymd);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(ymd, -((dow + 6) % 7));
};

function mk(fromYmd: string, toYmd: string, tz: string, today: string, labelKey: string, params?: Record<string, string | number>): AskRange {
  const clamp = addDays(today, 1);
  const end = toYmd > clamp ? clamp : toYmd;
  return { from: dayStartIso(fromYmd, tz), to: dayStartIso(end, tz), labelKey, ...(params ? { params } : {}) };
}

/** Finds ONE time phrase in folded text; returns the range and the text with the phrase removed. */
export function extractRange(f: string, ctx: Pick<AskParseContext, 'now' | 'tz'>): { range?: AskRange; rest: string } {
  const { tz } = ctx;
  const today = todayIn(tz, ctx.now.getTime());
  const cut = (m: RegExpMatchArray) => f.slice(0, m.index) + ' ' + f.slice((m.index ?? 0) + m[0].length);
  let m: RegExpMatchArray | null;

  if ((m = f.match(/\bson\s+(\d{1,3})\s+gun\w*|\b(?:last|past)\s+(\d{1,3})\s+days?\b/))) {
    const n = Number(m[1] ?? m[2]);
    if (n >= 1 && n <= 365) return { range: mk(addDays(today, -(n - 1)), addDays(today, 1), tz, today, 'ask.range.lastDays', { count: n }), rest: cut(m) };
  }
  if ((m = f.match(/\bgecen hafta\w*|\blast week\b/))) {
    const mon = mondayOf(today);
    return { range: mk(addDays(mon, -7), mon, tz, today, 'ask.range.lastWeek'), rest: cut(m) };
  }
  if ((m = f.match(/\bbu hafta\w*|\bthis week\b/))) {
    const mon = mondayOf(today);
    return { range: mk(mon, addDays(mon, 7), tz, today, 'ask.range.thisWeek'), rest: cut(m) };
  }
  if ((m = f.match(/\bgecen ay\w*|\blast month\b/))) {
    const [y, mo] = ymdParts(today);
    const thisFirst = `${y}-${pad(mo)}-01`;
    const py = mo === 1 ? y - 1 : y;
    const pm = mo === 1 ? 12 : mo - 1;
    return { range: mk(`${py}-${pad(pm)}-01`, thisFirst, tz, today, 'ask.range.lastMonth'), rest: cut(m) };
  }
  if ((m = f.match(/\bbu ay\b|\bthis month\b/))) {
    const [y, mo] = ymdParts(today);
    const ny = mo === 12 ? y + 1 : y;
    const nm = mo === 12 ? 1 : mo + 1;
    return { range: mk(`${y}-${pad(mo)}-01`, `${ny}-${pad(nm)}-01`, tz, today, 'ask.range.thisMonth'), rest: cut(m) };
  }
  if ((m = f.match(/\bbugun\b|\btoday\b/))) {
    return { range: mk(today, addDays(today, 1), tz, today, 'ask.range.today'), rest: cut(m) };
  }
  if ((m = f.match(/\bdun\b|\byesterday\b/))) {
    return { range: mk(addDays(today, -1), today, tz, today, 'ask.range.yesterday'), rest: cut(m) };
  }
  if ((m = f.match(MONTH_RE))) {
    const mo = MONTHS[m[1] as string] as number;
    const [cy] = ymdParts(today);
    let y = m[2] ? Number(m[2]) : cy;
    if (!m[2] && `${y}-${pad(mo)}-01` > today) y -= 1;
    const ny = mo === 12 ? y + 1 : y;
    const nm = mo === 12 ? 1 : mo + 1;
    return { range: mk(`${y}-${pad(mo)}-01`, `${ny}-${pad(nm)}-01`, tz, today, `ask.range.month.${mo}`, { year: y }), rest: cut(m) };
  }
  return { rest: f };
}

/* ---------------- questions ---------------- */

interface Rule {
  q: AskQuestion;
  weight: number;
  re: RegExp;
}

const RULES: Rule[] = [
  { q: 'price_coverage', weight: 9, re: /fiyat\w*\s+kapsam|fiyatsiz|fiyati\s+(yok|bilinmeyen)|price\s+coverage|pricing\s+coverage|unpriced|priced\s+(requests|share)/ },
  { q: 'cache_share', weight: 8, re: /onbellek|\bcache\b|cache[- ]?hit/ },
  { q: 'delegation_share', weight: 9, re: /alt\s+ajan\w*\s+(pay|oran)|ajan\w*\s+(pay|oran)|delegasyon|delegation|subagent\s+share|share\s+of\s+(the\s+)?sub-?agents?|ajanlardan\s+gelen/ },
  { q: 'top_project', weight: 8, re: /en\s+(cok|fazla|aktif|yogun|etkin)\s+\w*\s*proje|proje\w*\s+en\s+(cok|aktif)|top\s+project|most\s+(used|active)\s+project|biggest\s+project|busiest\s+project/ },
  { q: 'top_model', weight: 8, re: /en\s+(cok|fazla|aktif)\s+\w*\s*model|model\w*\s+en\s+(cok|fazla)|top\s+model|most\s+used\s+model|leading\s+model|biggest\s+model/ },
  { q: 'busiest_day', weight: 8, re: /en\s+(yogun|aktif|hareketli)\s+gun|busiest\s+day|peak\s+day|most\s+active\s+day/ },
  { q: 'subagents', weight: 6, re: /alt\s+ajan|sub-?\s?agent|ajan\s+sayisi/ },
  { q: 'estimated_value', weight: 5, re: /tahmini|harca|maliyet|\bcost|estimated|\bvalue|\bdeger|kac\s+dolar|\busd\b|\bspen[dt]|\$|fiyat\b|\bprice\b/ },
  { q: 'sessions', weight: 4, re: /oturum|session/ },
  { q: 'unique_requests', weight: 4, re: /benzersiz|unique|istek|request/ },
  { q: 'total_tokens', weight: 3, re: /token/ },
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Longest folded label that appears as a whole token in the folded text. */
function matchProject(f: string, labels: string[]): { label: string; folded: string } | null {
  let best: { label: string; folded: string } | null = null;
  for (const label of labels) {
    const folded = foldText(label);
    if (folded.length < 2) continue;
    if (best && folded.length <= best.folded.length) continue;
    if (new RegExp(`(?<![a-z0-9_-])${esc(folded)}(?![a-z0-9_-])`).test(f)) best = { label, folded };
  }
  return best;
}

export function parseAsk(input: string, ctx: AskParseContext): AskIntent {
  const raw = input.trim();
  const f = foldText(raw).replace(/\s+/g, ' ');
  if (f === '') return { kind: 'unknown', text: raw };
  if (f.startsWith('/')) return parseCommand(f);

  // project mention is removed before time parsing so labels like "march-app" cannot be read as months
  const project = matchProject(f, ctx.projectLabels);
  const withoutProject = project ? f.replace(new RegExp(`(?<![a-z0-9_-])${esc(project.folded)}(?![a-z0-9_-])`), ' ') : f;
  const { range, rest } = extractRange(withoutProject, ctx);
  const rangePart = range ? { range } : {};

  if (project) return { kind: 'question', question: 'project_summary', projectQuery: project.label, ...rangePart };

  let best: Rule | null = null;
  for (const r of RULES) if (r.re.test(rest) && (!best || r.weight > best.weight)) best = r;
  if (best) return { kind: 'question', question: best.q, ...rangePart };
  return { kind: 'unknown', text: raw };
}
