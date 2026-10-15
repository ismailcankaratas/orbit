import type { ChapterDefinition } from './contracts';

/**
 * The 12-chapter catalog (docs/EXPERIENCE.md). Owned by Opus — a chapter flips to 'ready' only
 * after Opus accepts its scene. 'planned' chapters are shown in the catalog/rail as disabled
 * with the reason "Henüz hazır değil" (no fake navigation).
 */
export const CHAPTERS: readonly ChapterDefinition[] = [
  { number: 1, slug: 'merkez', titleKey: 'shell.chapter.merkez.title', summaryKey: 'shell.chapter.merkez.summary', status: 'ready', aliases: ['merkez', 'center', 'overview', 'genel', 'ozet', 'summary'] },
  { number: 2, slug: 'yorungeler', titleKey: 'shell.chapter.yorungeler.title', summaryKey: 'shell.chapter.yorungeler.summary', status: 'planned', aliases: ['yorungeler', 'projeler', 'projects', 'orbits'] },
  { number: 3, slug: 'oturumlar', titleKey: 'shell.chapter.oturumlar.title', summaryKey: 'shell.chapter.oturumlar.summary', status: 'planned', aliases: ['oturumlar', 'sessions', 'oturum akisi'] },
  { number: 4, slug: 'orkestrasyon', titleKey: 'shell.chapter.orkestrasyon.title', summaryKey: 'shell.chapter.orkestrasyon.summary', status: 'planned', aliases: ['orkestrasyon', 'ajanlar', 'agents', 'delegation', 'alt ajan'] },
  { number: 5, slug: 'zaman', titleKey: 'shell.chapter.zaman.title', summaryKey: 'shell.chapter.zaman.summary', status: 'planned', aliases: ['zaman', 'timeline', 'zaman nehri', 'cizelge'] },
  { number: 6, slug: 'modeller', titleKey: 'shell.chapter.modeller.title', summaryKey: 'shell.chapter.modeller.summary', status: 'planned', aliases: ['modeller', 'models', 'model prizmasi'] },
  { number: 7, slug: 'onbellek', titleKey: 'shell.chapter.onbellek.title', summaryKey: 'shell.chapter.onbellek.summary', status: 'planned', aliases: ['onbellek', 'cache', 'onbellek ekonomisi'] },
  { number: 8, slug: 'deger', titleKey: 'shell.chapter.deger.title', summaryKey: 'shell.chapter.deger.summary', status: 'planned', aliases: ['deger', 'maliyet', 'costs', 'value', 'fiyat', 'tahmini deger'] },
  { number: 9, slug: 'ritim', titleKey: 'shell.chapter.ritim.title', summaryKey: 'shell.chapter.ritim.summary', status: 'planned', aliases: ['ritim', 'rhythm', 'saatler', 'haftalik'] },
  { number: 10, slug: 'bulgular', titleKey: 'shell.chapter.bulgular.title', summaryKey: 'shell.chapter.bulgular.summary', status: 'planned', aliases: ['bulgular', 'insights', 'icgoruler'] },
  { number: 11, slug: 'kapsam', titleKey: 'shell.chapter.kapsam.title', summaryKey: 'shell.chapter.kapsam.summary', status: 'planned', aliases: ['kapsam', 'coverage', 'yontem', 'methodology'] },
  { number: 12, slug: 'kayit', titleKey: 'shell.chapter.kayit.title', summaryKey: 'shell.chapter.kayit.summary', status: 'planned', aliases: ['kayit', 'rapor', 'reports', 'export', 'disa aktar', 'csv'] },
];

export const DEFAULT_CHAPTER = 'merkez';

export function chapterBySlug(slug: string | undefined): ChapterDefinition | undefined {
  return CHAPTERS.find((c) => c.slug === slug);
}

/** ASCII-fold Turkish characters + lowercase, for catalog/ask matching. */
export function foldText(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}
