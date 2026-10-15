# Product requirements document (PRD)

## Problem and audience
Claude Code developers using Pro/Max subscriptions can see current session activity but lack a unified, trustworthy, visually understandable record across locally available projects, main sessions and subagent invocations. Existing CLI token meters often separate costs from workload and hide uncertain attribution.

Primary audiences: a solo Claude Code developer with many local repos, an AI-assisted builder running several agents, and a maintainer sharing a transparent open-source tool. V1 is **single-user local software**, not a collaborative SaaS product.

## Goals
G1. Show **all recoverable** local history, not falsely claim all account history.
G2. Attribute unique token usage and pricing estimates to models, projects, sessions, parent agents and child agents when the evidence supports it.
G3. Enable fast visual understanding within 5 seconds of opening the dashboard.
G4. Offer near-real-time update of appended logs without disrupting Claude Code.
G5. Produce presentation-quality visual narratives without exposing private prompts.
G6. Enable safe local archive of normalized events so cleanup does not erase all historical usage metrics.
G7. Be usable without an API key or network connectivity after installation.

## Explicit non-goals for v1
- Actual Pro/Max monetary charges, account-wide usage, exact subscription quota or reset time.
- Cloud sync across devices, remote access, multi-user/team usage.
- Direct Claude Code control (create/stop/restart/reassign tasks).
- Running new AI analysis that sends private session text to an LLM.
- Recovering transcripts already deleted or stored only on other devices.
- Accurate billed cost for unsupported models, third-party gateways, taxes or plan-specific pricing.

## Priority-ranked features

### P0: required before any public release
- First launch: source selection, privacy policy summary, coverage caveats, scan progress, permission error handling, optional safe demo mode.
- Overview metrics for the selected date range: unique counted requests, processed token categories, estimated API-equivalent USD for priced requests only, projects, sessions, observed subagents, data coverage.
- Projects: friendly names, searchable/sortable list, project detail with trends/sessions/agents.
- Sessions: chronological list and detail with model breakdown, inferred duration, related agent calls, safe task descriptions (opt-in display if derived from private text).
- Agents: parent-child linkage from supported metadata/tool-use IDs; confidence levels and statuses based on timestamps; independent usage attribution.
- Metering: duplicate snapshot elimination, caching cost categories, versioned rate tables, unknown model rate handling.
- Near-live read-only updates; clear update timestamps and watcher fallback.
- Local SQLite normalized-data store, idempotent incremental import, optional archive toggle, delete local archive.
- Privacy: no unapproved network calls or reads beyond selected root, no `~/.claude.json`/credentials access, no prompt bodies persisted.
- Tests and static checks; synthetic fixture suite and visual smoke tests.
- Markdown English README and Turkish quickstart, attribution and MIT license.

### P1: release candidate enhancements
- Timeline overview with interactive zoom, model/project filters and nested subagent intervals.
- Reports: customizable period, charts, download CSV / sanitized JSON, Story Mode slides with keyboard controls.
- Insights based on deterministically computed local metrics with evidence links, e.g. change in cache hit share, most-active project; no narrative LLM requirement.
- Privacy-safe historical archive and coverage by day/source; restore previously archived aggregates even when raw source vanished.
- Model rate editor with time validity and proper recalculation.
- Diagnostics and errors page (unknown schema lines, watch state, data gaps, prices unavailable).

### P2: optional post-release
- Desktop packaging, signed releases, macOS/Linux/Windows onboarding helpers, read-only local API integration.
- Exportable image report / printable report, localization (TR/EN), richer file-metadata analytics where reliable.

## Core journeys and acceptance

**A. First run:** On `localhost`, the user sees a source consent screen, points Orbit at a directory, starts scan, sees honest progress/coverage, can choose demo mode or open an empty state. No secret/API-key prompt.

**B. Inspect historical spending:** Select previous 30 days -> identify most-used project -> open it -> view token model breakdown, estimated API-equivalent value, daily trend and source coverage -> inspect related sessions and agents. No monetary figure presented as a Pro/Max charge.

**C. Inspect a subagent:** From Agents -> select recorded invocation -> see parent project/session, delegated role, safe opt-in task title, captured tokens, estimated price, observed time range, and linkage confidence -> navigate back to the parent session.

**D. Live observation:** Start a separate Claude Code session with synthetic/test input -> Orbit picks up new records within a target of 2-5 seconds in typical local use -> updates without page reload -> never claims success/completion from mere inactivity.

**E. Publish a report:** Choose range -> switch to Story Mode -> panels use actual selected data with one takeaway per slide -> export sanitized CSV or JSON -> no raw secrets or prompts leave the machine.

**F. Incomplete data:** If all logs missing, one agent orphaned, model rate unknown or active write partially recorded, UI tells the truth and makes the uncertainty visible.

## Definition of success
All P0 acceptance tests pass on synthetic fixtures, a human can understand one month's activity without prior knowledge of token accounting, security review finds no unintended data upload, and onboarding runs on fresh macOS without Docker. A release is not complete if the application only shows polished demo data.
