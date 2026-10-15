# Orbit visual language and UI design system

> **BINDING PRODUCT DECISION (ADR-003, 2026-10-15):** Orbit is an **Immersive Interactive Data Storytelling Platform** — four persistent layers (Top Bar, one Interactive Scene, Orbit Ask, Chapter Rail) and 12 chapters, specified in `docs/EXPERIENCE.md`. Any sidebar, page-per-feature dashboard or long vertical card-stack description in this document is **superseded** by `docs/EXPERIENCE.md`. Data, privacy, cost and security requirements here remain binding.

## Creative direction
**Signature:** quiet, intellectual, cinematic data storytelling. Orbit is NOT a conventional admin template and NOT a clone of Avenox. We borrow general principles (readable data + narrative + interactivity), never exact compositions, character designs, visual art, copy, or navigation.

Product concept: a central orbit of interconnected AI work. Animated orbit paths and restrained particles suggest model/agent relationships, but actual data drives the visualization. The design must still work without any decorative art.

## Reference images included
- `design/references/orbit-overview-concept.png` - main summary composition; inspiration for hierarchy, cards, charts and cinematic top-right art.
- `design/references/orbit-live-agents-concept.png` - agent topology, task list and monitoring panel; **design-only**. Remove misleading `Assign task`, `Pause flow`, `New project` or unsupported control labels in v1.

Screens are illustrative AI mockups with fictional values. Use as direction, not literal pixel-perfect product specs. Real component architecture, accessibility and responsive design take priority.

## Design tokens (starting point, refine in code)

| Token | Value | Use |
| --- | --- | --- |
| `--bg-root` | `#0D0F11` | page background |
| `--bg-panel` | `#171717` | large containers |
| `--bg-raised` | `#211F1B` | highlighted cards |
| `--line` | `#34312C` | subtle borders |
| `--text-primary` | `#F0E9DC` | headings and data |
| `--text-secondary` | `#AFA79B` | captions |
| `--accent` | `#D8A84D` | signature gold |
| `--accent-soft` | `#6A4E24` | muted active track |
| `--teal` | `#7AB4AB` | independent category |
| `--coral` | `#D47C67` | independent category |
| `--violet` | `#A48CC4` | independent category |
| `--green` | `#8EBC94` | successful observed state |
| `--warning` | `#E0AE56` | incomplete coverage |
| `--danger` | `#D87772` | errors |

These values are guidelines. Achieve accessible contrast for small text and status indicators; use shape and labels, not color alone. No excessive neon glow.

## Typography
- Large editorial serif headings (`Georgia` or an openly licensed font available locally, with safe system fallback) for hero copy.
- UI body: `-apple-system`, `BlinkMacSystemFont`, `Inter` *only if packaged legally offline*, `Segoe UI`, sans-serif. Do NOT depend on Google Fonts CDN.
- Numbers: tabular numerals, clear separators, localized display, never confuse 1,000.00 and 1.000,00.
- Body default >=14px, main reading >=15-16px; don't squeeze tiny tooltips to match the concept art.

## Layout grid — SUPERSEDED by docs/EXPERIENCE.md §1/§5 (no sidebar; one scene per viewport on desktop)
- ~~Collapsible 224-256px sidebar~~ (superseded). Desktop 1440px design baseline, 28-36px content gutters, high-density but generous group separation. 12-column grid; card heights consistent within row.
- Tablet 768-1023px: ~~collapsible sidebar~~ scene adapts to two columns, prevent chart legend overflow.
- Mobile <=767px: single-column flows, bottom/sheet navigation or compact menu, no wide table overflow without clear scrolling. Key metrics visible without sideways scrolling.
- No hover-only essential interactions; keyboard navigation, visible focus and tooltips.

## Signature components
- **Orbit Hero**: title + one-sentence summary generated from actual simple metrics; decorative orbital constellation in right segment. CSS/SVG lightweight, no infinite WebGL demands.
- **KPI cards**: label, data, delta with baseline, mini sparkline and inline `observed/estimated` tooltip.
- **Rate coverage chip**: `94% priced`, `6% unpriced` with accessible explanation.
- **Signal graph**: main usage timeseries, brush/date range and token/cost/session toggle.
- **Model prism**: donut/stack view split by model with direct numeric legend.
- **Agent orbit graph**: interactive nodes connected by confirmed parent-child edges, inferred edge styles separately; keyboard-accessible list alternative.
- **Session river**: event timeline showing parent and child work, unknown intervals marked as such.
- **Story slide**: 16:9 narrative, large headline, one supported takeaway, 1-2 charts, slide index, arrow/space navigation.
- **Insight tile**: pure arithmetic rule, proof via clickable underlying numbers; never an invented AI-generated conclusion.

## Motion language
- Subtle 180-260ms interaction transitions; orbit ambient animation <=10-14s cycle and low contrast. Respect `prefers-reduced-motion` and stop nonessential animation when document is hidden.
- SSE changes can animate a single metric change, but no fake live activity indicators.
- Skeletons only while actual data loads; progressive large datasets without jank.

## Accessibility & i18n
- WCAG AA contrast target, meaningful keyboard focus order, screen-reader alternatives for visual graphs, proper labels for filters and menus.
- Color is never the only source for state or model type.
- Text/localization prepared for Turkish and English, with an English baseline and Turkish strings in locale files. No machine-translated nonsense or hard-coded text scattered through components.
- Date/time timezone explicit; percentages display consistent rounding.

## Originality and prohibited patterns
- Do not use a lemon mascot, wood-paneled orchestra/stage illustrations, instrument characters, Avenox logos, its brand line, type/layout copying, or supplied third-party screenshot assets.
- Our **orbit** motif is geometric planets/nodes connected by fine light trails, plus restrained abstract silhouettes at most. No borrowed mascot.
- Product UI is allowed to be similar to common dashboard interaction conventions; exact art and storytelling structure must be original.
- Don't generate copyrighted logo/brand imitation. Brand name `Orbit` is provisional and should be trademark-checked before marketing.

## Visual verification acceptance
- Screenshot at 1440x900 and 390x844 from real app, compare with direction not copied pixels.
- Every chapter scene must feel like part of one continuous story (shared shell, motifs and type).
- Very-long project names, long model IDs, no data, unknown price, low contrast theme, reduced motion, colorblind status and cramped date filters all remain usable.
- Every click/toggle seen in UI must be functional, accurately disabled with explanation, or removed.
