import { CHAPTERS, chapterBySlug, foldText } from '../experience/chapters';
import type { ChapterDefinition } from '../experience/contracts';

export const READY_CHAPTERS: readonly ChapterDefinition[] = CHAPTERS.filter((c) => c.status === 'ready');

/** Nearest ready chapter before/after the active one (explorer views count as position 0). */
export function readyNeighbour(active: string | null, dir: 1 | -1): ChapterDefinition | undefined {
  const n = chapterBySlug(active ?? undefined)?.number ?? 0;
  return dir === 1 ? READY_CHAPTERS.find((c) => c.number > n) : [...READY_CHAPTERS].reverse().find((c) => c.number < n);
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** Catalog filter: folded text match over localized title/summary + slug + aliases. */
export function matchChapter(c: ChapterDefinition, query: string, title: string, summary: string): boolean {
  const q = foldText(query.replace(/^\/+/, ''));
  if (!q) return true;
  const hay = [title, summary, c.slug, pad2(c.number), ...c.aliases].map(foldText);
  return hay.some((h) => h.includes(q));
}
