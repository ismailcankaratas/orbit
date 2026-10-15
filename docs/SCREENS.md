# Screen catalog, navigation and interactions

> **BINDING PRODUCT DECISION (ADR-003, 2026-10-15):** Orbit is an **Immersive Interactive Data Storytelling Platform** — four persistent layers (Top Bar, one Interactive Scene, Orbit Ask, Chapter Rail) and 12 chapters, specified in `docs/EXPERIENCE.md`. Any sidebar, page-per-feature dashboard or long vertical card-stack description in this document is **superseded** by `docs/EXPERIENCE.md`. Data, privacy, cost and security requirements here remain binding.

> All screens are **observability-first**. The Orbit designs include several promotional buttons that are NOT supported by read-only v1. Replace them with real navigation/filter actions.

## Global app shell — SUPERSEDED by docs/EXPERIENCE.md §1 (no sidebar)
~~Fixed desktop sidebar~~ (historical text kept for reference): Fixed desktop sidebar with Orbit symbol, search, Overview, Projects, Agents, Sessions, Timeline, Costs, Reports, Settings. Topbar with range picker, dataset `Real` or unmistakable `Demo`, latest scan timestamp, scan health, optional keyboard shortcut palette. Global filters (date, project, model) persist within an active view. Search input searches safe project aliases, sessions and agent roles, not raw secret/prompt content.

### 00. Welcome / privacy consent
- Animated geometrical Orbit hero, very short product description.
- Explicit data source selection (`~/.claude/projects` default), permission explanation, read-only guarantee, coverage note.
- `Scan my local history` and `Explore synthetic demo` separate actions.
- Optional local archive consent, editable later. Onboarding scan progress and empty/error guidance.
- Acceptance: no app data scan before the consent action; no API key or registration.

### 01. Overview → now Chapter 01 "Merkez" (docs/EXPERIENCE.md §3); items below describe its data, not its layout
- Hero `One workspace. Every local session.` with elegant orbital node art. Dynamic statement: measured metric, e.g. `3 projects were active this week` with cited filters. Avoid claims when data absent.
- KPIs: processed token categories, unique requests, estimated API equivalent USD, sessions, observed subagents, price coverage. Each card expandable/links to source detail.
- Daily token area/bar timeline with category toggle and hover breakdown; model distribution donut; project rank list; agent activity lanes; dated insight banner.
- Actions: date filter, navigate project/session, toggle chart metric, open report, download sanitized summary. No nonexistent `create project`.
- States: empty, partial logs, unknown model rate, watcher offline, demo.

### 02. Projects list
- Portfolio overview: each row has friendly name/alias, local hash code, unique sessions, token mix, priced API equivalent, trend and last observed usage.
- Filters: last 7/30/90 days/custom, name, model, min activity. Sort by project, activity, tokens, priced estimate.
- Clicking opens detail; user may locally assign an alias (Orbit DB only), not edit their actual repo.
- Duplicate basenames remain distinct entities and can be compared.

### 03. Project detail
- Project hero with alias, ID, selected date coverage, current/archived source indicator; do not default show absolute path.
- Tabs: Overview / Sessions / Agents / Models & Cost / Timeline.
- Sections: daily trend, unique requests, cache composition, parent vs child attribution, linked agent workflow graph, recent safe events.
- Click sessions/agents opens corresponding detail with breadcrumb and preserved filters.
- Warn about unlinked agents and incomplete sources.

### 04. Agents / Orchestration observed
- Central orbit topology: main sessions or task invocation roots -> agent nodes, edges styled solid when exact, dashed for inferred; orphaned agents in a separate category.
- Left side: recorded task event list with status based on evidence; filter role/model/project/last seen.
- Right side: totals, recently observed tasks, attribution confidence, any incomplete data diagnostics.
- Bottom: event sequence across agent calls with time range and per-agent token categories.
- Click node -> side drawer: agent ID alias, model, parent session, task kind (safe), usage, cost estimate, last event, exact/inferred link reason.
- **Never** render `Assign Task`, `Pause Flow`, `Stop Agent`, `Restart Agent` buttons in MVP. Instead use `View source session`, `Inspect task`, `Filter timeline`.
- Node animation indicates a fresh observed log event, never verified process liveness.

### 05. Session list + detail
- List: project alias, session ID shortened, first/last observed, observed span, message count (or request count, clearly labeled), model mix, subagents, estimated amount.
- Detail: parent session usage graph, subagent task tree, chronological tool-agent invocations, source-data availability, pricing confidence and matching status.
- Default hide raw prompt and output bodies; show safe event descriptions. Unknown title -> `Task title hidden`.
- The app does not offer to resume a Claude session or execute arbitrary commands.

### 06. Timeline
- Day/week visual swim lanes by project or agent; events are logs and intervals are inferred spans, not validated CPU utilization.
- Hover and keyboard focus show timestamp, confidence, source type, model, usage; click into session/agent.
- Zoom from 24h to 30d; avoid creating thousands of DOM nodes at large data volumes.

### 07. Costs / Usage
- Base-currency USD, model-rate schedule picker, 5m/1h cache write splits, read hits, token and rate coverage.
- Price source and effective date displayed. Monetary total says `Estimated API-equivalent value`, never `charged`.
- Unknown price table and config action. Warning when coverage below 100%.
- Trend comparisons require same data coverage and date spans; differences explicitly note incomplete logs.

### 08. Reports and Story Mode
- Report builder with date range, projects/models, privacy preview, export to CSV or JSON.
- Story Mode: 16:9 slide sequence with 5-8 coherent, data-grounded slides: introduction, activity, spending estimate with caveat, project distribution, model mix, agent delegation, cache efficiency, coverage/methodology.
- Each slide provides `View data`/source drilldown, keyboard navigation, reduced-motion mode, fullscreen option and sanitized print layout.
- Charts and statements update when filters change. No static mockup numbers or made-up savings claims.

### 09. Settings / Diagnostics
- Source path (explicit root), manual rescan, archive opt-in, local data size, delete Orbit archive confirmation, watch update interval, model rates, display language, privacy export settings, source coverage/parse warnings.
- A diagnostics panel lists counts of malformed lines, orphan agents, unpriced events and last successful scan without revealing transcript content.

## Navigation and interaction quality gates
- Every visible click target has its described action, disabled state with reason or is removed.
- Deep links preserve filter context and back navigation.
- Loading, empty, unauthorized folder, no logs, missing source, unsupported model, malformed rows, partial scan, privacy redaction and demo states have deliberately designed screens.
- Real/demo mode separated by a persistent global badge, a source indicator and non-shareable data IDs.
