# ADR-003: Orbit is an Immersive Interactive Data Storytelling Platform

Status: Accepted (2026-10-15) — user decision, supersedes UI-structure parts of SCREENS.md, DESIGN_SYSTEM.md (layout grid), PRD.md (screen list), ARCHITECTURE.md (ui module) and README.md ("What will be built").

## Context
After Phase 3–4 the web app was a fixed-sidebar, page-per-feature dashboard with long vertical card stacks. The user rejected this interaction architecture (not its CSS quality) and set a binding direction.

## Decision
- Four persistent layers: Top Bar, single Interactive Scene, Orbit Ask (bottom command/question field), Chapter Rail. Details: `docs/EXPERIENCE.md`.
- 12 chapters; Delivery 1 builds shell + Scene 01 (Merkez) + Orbit Ask + chapter navigation only, then stops for user visual approval.
- Orbit Ask answers supported questions with a deterministic local parser (no LLM, offline) — consistent with PRD non-goal "no running new AI analysis that sends private session text to an LLM".
- Backend, data analysis, filter logic, API contracts and existing tests are preserved. Existing detail views stay as a transitional secondary "Veri gezgini" inside the new shell so no working feature (export, settings, data deletion, rate overrides) is lost.
- Frontend work is split by ownership: `src/ds` + `src/shell` (+ App/main wiring), `src/scenes/merkez`, `src/ask`; shared contracts `src/experience/*` and i18n module catalogs `src/i18n/locales/modules/<module>.<locale>.json` (prefixes `shell.*`, `scene.merkez.*`, `ask.*`) are owned by Opus.
- The previous ADR-001 §3 i18n decision stands (Turkish default, English complete).

## Consequences
- The old `AppShell` sidebar, `Topbar` and `Overview` page are removed from the primary experience.
- E2E/a11y/layout specs are updated for the new shell; old sidebar-based navigation tests are replaced.
- Chapters 02–12 are visible as `planned` (disabled with reason) until built.
