# Orbit experience architecture (BINDING — ADR-003)

**Product decision (2026-10-15, user):** Orbit is an **Immersive Interactive Data Storytelling Platform**, not a classic SaaS/admin dashboard. This document overrides every earlier description of a fixed sidebar, page-per-feature dashboard, long vertical card stacks or "Overview/Projects/… pages" in CLAUDE.md, PRD.md, SCREENS.md, DESIGN_SYSTEM.md, ARCHITECTURE.md and README.md. **All technical data requirements (ingestion, dedupe, cost engine, privacy, security, API contracts, tests) remain unchanged and binding.**

Reference studied for UX behaviour only (not cloned, no assets/copy/art reused): full-screen presentation scenes, a chapter-selection overlay (↑/↓, Enter, Esc), `/` in a bottom prompt opening the section list, a chapter counter, keyboard-first navigation. Orbit keeps its own brand: carbon + warm gold, editorial serif, orbital metaphor.

## 1. Application shell — four persistent layers

| Layer | Contents | Rules |
| --- | --- | --- |
| **A. Top Bar** | Orbit mark; local data status (Gerçek veri / Demo — sentetik veri badge); last scan time + watcher state; **compact** date selector (one button showing "16 Eyl – 15 Eki 2026" that opens a popover with presets 7/30/90 gün + custom); settings button (opens the settings panel overlay). | ≤ 56 px tall on desktop. No navigation list. |
| **B. Interactive Scene** | Exactly one chapter scene fills the remaining viewport. Each scene has its own visual story, interactive graphics, headline and analysis. | Desktop ≥ 1024 px: the scene fits the viewport — **no page scroll** at 1440×900 (scene may use internal detail panels). Mobile ≤ 767 px: vertical scroll inside the scene is allowed and safe. |
| **C. Orbit Ask** | Always-visible command + question field at the bottom. `/` opens the chapter catalog (filterable as you type). Supported natural-language questions are answered **deterministically from local data** (no LLM, no network beyond the local API). | Fixed bottom on mobile with safe-area insets. Answers appear in a compact card above the field; never a page navigation unless the user picks the evidence link. |
| **D. Chapter Rail** | Active chapter "01 / 12 · Merkez", progress dots (one per chapter), prev/next, shortcut hints. | Planned chapters are visibly disabled with the reason "Henüz hazır değil" — never fake navigation. |

**Removed:** fixed left sidebar; page-per-feature dashboard as the primary experience; long scrolling card stacks as the main experience.

### Keyboard (ignored while typing in inputs, except Esc)
- `→` / `PageDown` next chapter, `←` / `PageUp` previous (skips planned chapters; announces "Sonraki bölüm henüz hazır değil" if none).
- `C` opens the **chapter catalog** modal; inside: `↑`/`↓` select, `Enter` go, `Esc` close; focus trapped; disabled entries explain why.
- `/` focuses Orbit Ask and opens the catalog list filtered by what follows (`/mer` → Merkez).
- `?` opens the shortcuts help overlay. `Esc` closes any overlay / clears Ask answer.
- `Home` / `End` first / last ready chapter.

### Routing
- `/` → `/bolum/merkez` (filters in query string preserved).
- `/bolum/:slug` renders chapter `slug` inside the shell.
- **Data explorer (transitional):** the existing detailed views (projects, project detail, sessions, session detail, agents, timeline, costs + rate editor, reports + export, story, settings) stay functional at their current routes but render **inside the new shell's scene area** as secondary "Veri gezgini" views, reachable only from in-scene drilldowns, Orbit Ask commands (`/gezgin projeler`, `/ayarlar`, `/disa-aktar csv`) and evidence links — never from a sidebar. They will be absorbed into chapters 02–12 and then removed.
- Onboarding/consent remains the first-run full-screen step (no shell) until consent or demo is chosen.

## 2. Chapter catalog (12)

| # | Slug | Title (tr) | Story | Data |
| --- | --- | --- | --- | --- |
| 01 | merkez | Merkez | The big picture of the selected period around an interactive orbit | overview, projects |
| 02 | yorungeler | Yörüngeler | Projects as orbits: weight, rhythm, share; same-name collisions | projects, project detail |
| 03 | oturumlar | Oturum Akışı | Sessions as a flowing river; span, models, delegation | sessions |
| 04 | orkestrasyon | Orkestrasyon | Parent → subagent constellations with exact/inferred/unlinked evidence | agents |
| 05 | zaman | Zaman Nehri | Swim lanes over time; inferred spans, not CPU time | timeline |
| 06 | modeller | Model Prizması | Model mix, unknown models, per-model value | overview.models, costs.byModel |
| 07 | onbellek | Önbellek Ekonomisi | Cache reads/writes 5m/1h/unsplit and their effect | costs.byCategory |
| 08 | deger | Tahmini Değer | API-equivalent value with caveats, coverage, rate schedule & overrides | costs |
| 09 | ritim | Ritim | Hour-of-day / weekday working rhythm | overview.agentLanes, daily |
| 10 | bulgular | Bulgular | Deterministic insights with evidence | overview.insights |
| 11 | kapsam | Kapsam ve Yöntem | What Orbit can and cannot see; diagnostics; methodology | coverage, diagnostics |
| 12 | kayit | Kayıt ve Dışa Aktarım | Sanitized CSV/JSON export, printable story | exports, reports/summary |

Delivery 1 builds **only 01** (+ shell, Ask, rail, catalog). 02–12 are `planned`.

## 3. Scene 01 — Merkez (Delivery 1)

Purpose: tell the user the big picture of their recorded Claude Code work in the selected period, in one screen.

- **Editorial headline** derived from real metrics (e.g. "30 günde 7 proje, 98 oturum."), with a one-line subline; no claim when data is empty.
- **Interactive orbit visualization (center):** the sun is the selected period's processed tokens; each project is a planet on its own orbit (size ∝ processed tokens, clamped; orbit order by share); an inner ring shows the model mix as arcs (arc length ∝ token share). Planets and arcs are focusable (keyboard Tab/arrow), hover/focus/tap highlights and fills the **detail area** (project: tokens, share, sessions, unique requests, subagents, estimated value, last activity, link to explorer; model: share, tokens, priced or not). Unknown/unpriced models are visibly marked. Slow ambient motion (≤ 1 revolution / 120 s), paused for `prefers-reduced-motion`, hidden tab or inactive scene.
- **Around the orbit (satellite readouts, not a card stack):** processed tokens (category breakdown on select), unique API requests, sessions, observed subagents, cache read share, **estimated API-equivalent value (USD)** with a visible "Pro/Max faturası değildir" note and price-coverage chip.
- **Small comparison panels:** vs previous equal period (only when `previous` exists — otherwise say "karşılaştırma yok"), main vs subagent share, cache composition bar.
- **Selection-driven detail area** (see above); default state shows the top project.
- Date range comes from the Top Bar compact selector.
- States: loading (skeleton orbit), empty period, not scanned, partial coverage, demo.
- Desktop 1440×900: headline + orbit + readouts + comparisons + detail fit together with Top Bar, Rail and Ask in one viewport. Mobile 390×844: stacked (headline → orbit → readouts → comparisons → detail) with scroll; Ask fixed.

## 4. Orbit Ask (Delivery 1)

- Field label "Orbit'e sor" / placeholder "Bir soru sorun veya / yazın".
- **Commands:** `/bölümler` (catalog), `/merkez` (and any chapter slug or alias; planned ones answer "henüz hazır değil"), `/yardım`, `/dışa-aktar csv|json` (downloads with current filters), `/ayarlar`, `/tara` (POST /scan; respects consent & rate limit), `/demo`, `/gerçek`, `/gezgin <projeler|oturumlar|ajanlar|zaman|maliyetler|raporlar>`, `/dil tr|en`. ASCII spellings accepted (`/bolumler`, `/disa-aktar`, `/yardim`, `/gercek`).
- **Questions (Turkish + English, deterministic parser, folded case/diacritics):** total tokens, unique requests, sessions, subagents, estimated value (always with the Pro/Max caveat), cache share, top project, top model, price coverage, busiest day, delegation share, project summary ("aurora-api hakkında", "aurora-api projesi kaç token"). Time phrases: bugün, dün, bu hafta, geçen hafta, son N gün, bu ay, geçen ay, ay adları (eylül…), today/yesterday/this week/last week/last N days/this month/last month. A question's time phrase applies to that answer only; without one, the global range is used.
- **Answer card:** sentence + headline figure + quality badge + evidence link; "anlayamadım" with example questions when unsupported. Never invents numbers; empty data → "Bu aralıkta kayıt yok".
- Privacy: input text is never persisted server-side, never logged, never sent anywhere except as structured query params to the local API.

## 5. Visual system (binding additions to DESIGN_SYSTEM.md)
Dark carbon background, warm gold accents, editorial serif headlines, high-quality data graphics, original orbit/exploration motifs, very subtle moving background layers (CSS/SVG, reduced-motion aware), meaningful micro-animations (180–260 ms), controlled density. Separate desktop and mobile layout behaviour (not just shrinking).

## 6. Acceptance for Delivery 1 (stop and ask the user for visual approval)
1. No sidebar or dashboard nav exists in the DOM on any shell route.
2. At 1440×900: Top Bar, Scene 01, Chapter Rail and Orbit Ask are all inside the first viewport; `scrollHeight <= innerHeight` on `/bolum/merkez`.
3. At 390×844: no horizontal overflow; Ask fixed and visible; scene scrolls.
4. Scene 01 numbers equal the API (`/api/v1/overview`) values for the same filters (E2E compares them) and equal fixture expectations on the synthetic source.
5. `/` opens the catalog; `/merkez` navigates; a supported question returns the right number; an unsupported one returns guidance.
6. Catalog modal and rail work by keyboard (C, ↑/↓, Enter, Esc, ←/→).
7. Estimated value always carries the "not a Pro/Max bill" caveat.
8. Existing CSV/JSON export, reports, settings and data deletion remain reachable (secondary).
9. axe: no serious/critical violations on the new shell + Scene 01.
10. Independent Sonnet QA review report.
