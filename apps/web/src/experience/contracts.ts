/**
 * Experience contracts (ADR-003). Owned by Opus. Shared by the shell, scenes and Orbit Ask so
 * that those modules can be built in parallel without editing each other's files.
 */
import type { ComponentType } from 'react';

export type ChapterStatus = 'ready' | 'planned';

export interface ChapterDefinition {
  /** 1-based chapter number shown as "01". */
  number: number;
  /** URL slug: /bolum/<slug> */
  slug: string;
  /** i18n keys (shell module owns these strings): shell.chapter.<slug>.title / .summary */
  titleKey: string;
  summaryKey: string;
  status: ChapterStatus;
  /** Extra search terms for the `/` catalog filter (both languages, lowercase, ASCII-folded). */
  aliases: string[];
}

/** Props every scene receives from the shell. Scenes read global filters via api/filters hooks. */
export interface SceneProps {
  /** Shell-provided callback to open a chapter by slug (used by in-scene links). */
  goToChapter: (slug: string) => void;
  /** True when the scene is the active one (used to pause ambient motion when false). */
  active: boolean;
}

export type SceneComponent = ComponentType<SceneProps>;

/* ---------------- Orbit Ask ---------------- */

/** Result of parsing what the user typed into Orbit Ask. Pure data; no side effects. */
export type AskIntent =
  | { kind: 'command'; command: AskCommand; arg?: string }
  | { kind: 'question'; question: AskQuestion; range?: AskRange; projectQuery?: string }
  | { kind: 'catalog'; filter: string }
  | { kind: 'unknown'; text: string };

export type AskCommand =
  | 'chapters'
  | 'go'
  | 'help'
  | 'export_csv'
  | 'export_json'
  | 'settings'
  | 'rescan'
  | 'demo'
  | 'real'
  | 'explorer'
  | 'language';

export type AskQuestion =
  | 'total_tokens'
  | 'unique_requests'
  | 'sessions'
  | 'subagents'
  | 'estimated_value'
  | 'cache_share'
  | 'top_project'
  | 'top_model'
  | 'price_coverage'
  | 'busiest_day'
  | 'project_summary'
  | 'delegation_share';

/** A date range resolved from phrases like "geçen hafta" / "last 7 days" (local tz, end exclusive). */
export interface AskRange {
  from: string; // ISO UTC
  to: string; // ISO UTC
  labelKey: string; // i18n key describing the phrase, e.g. ask.range.lastWeek
  params?: Record<string, string | number>;
}

/** What the Ask panel renders after executing an intent against local data. */
export interface AskAnswer {
  status: 'answered' | 'no_data' | 'unsupported' | 'action_done' | 'error';
  /** i18n key + params for the main sentence. */
  messageKey: string;
  params?: Record<string, string | number>;
  /** Optional headline figure already formatted for display. */
  figure?: string;
  quality?: 'observed' | 'derived' | 'estimated' | 'unknown';
  /** Shown whenever money is involved: must be true for estimated_value answers. */
  moneyCaveat?: boolean;
  /** In-app route that proves the answer (chapter or explorer view). */
  evidenceHref?: string;
}
