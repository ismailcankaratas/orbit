import { createContext, useContext } from 'react';

/**
 * Shell-provided actions that other experience modules (scenes, Orbit Ask) may call.
 * The shell (src/shell) creates the provider; consumers only use `useExperience()`.
 */
export interface ExperienceActions {
  /** Slug of the active chapter, or null when an explorer view is shown. */
  activeChapter: string | null;
  goToChapter: (slug: string) => void;
  /** Open the chapter catalog modal, optionally pre-filtered. */
  openCatalog: (filter?: string) => void;
  openHelp: () => void;
  openSettings: () => void;
  /** Navigate to a transitional data-explorer view, e.g. '/projects'. Filters are preserved. */
  openExplorer: (path: string) => void;
  /** Polite screen-reader announcement. */
  announce: (text: string) => void;
}

const noop = () => undefined;
export const ExperienceContext = createContext<ExperienceActions>({
  activeChapter: null,
  goToChapter: noop,
  openCatalog: noop,
  openHelp: noop,
  openSettings: noop,
  openExplorer: noop,
  announce: noop,
});

export const useExperience = () => useContext(ExperienceContext);
