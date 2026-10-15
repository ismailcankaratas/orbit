# Orbit: local-first Claude Code observability

> **Project status:** Build specification and Claude Code agent handoff kit. This archive intentionally contains **no finished application**. The code is to be implemented end to end by Claude Code using this specification.

Orbit is an open-source, privacy-first **immersive, interactive data-storytelling app** (not a classic dashboard — see `docs/EXPERIENCE.md`) for understanding *local* Claude Code activity: projects, sessions, model/token usage, estimated API-equivalent cost, delegated subagent tasks, timelines, and a presentation-quality narrative reporting mode.

![Orbit Center chapter: orbital activity scene for the last 30 days](docs/screenshots/orbit-center.png)

*Center chapter (01/12) — local activity, token usage, and estimated API-equivalent value.*

## Product contract

- Entire application runs on the user's machine. The production dashboard is served on `127.0.0.1`, not hosted remotely.
- Reads existing Claude Code session transcripts **read-only** from an explicitly approved local folder (default `~/.claude/projects`). Never modifies Claude settings, session files, credentials or user code.
- No account creation, API key, paid backend, remote database, analytics SDK, or runtime data transmission required.
- In Pro/Max mode, monetary numbers are **API-price-equivalent estimates**, **not** account charges, invoices, subscription spend, or remaining plan quota.
- Historical coverage is limited to files on disk and normalized usage events already archived locally. Missing logs cannot be recovered by signing into a Claude account.
- Distinguish observed events, inferred links, estimated prices and genuinely unknown data. Never simulate real activity without an unmistakable demo label.
- The runtime is **observability only** in v1. It does not create, pause, resume, or reassign actual Claude Code agents. The Opus/Sonnet architecture in this kit describes the **development team**, not a promise of runtime control.

## What will be built

> Delivered as chapters of one interactive story (docs/EXPERIENCE.md), not as sidebar pages. The list below names the data capabilities.

1. Overview: visually striking activity narrative, key metrics, usage graphs and trends.
2. Projects: sortable project portfolio, aliases and per-project breakdowns.
3. Sessions: history, search, model usage and duration estimates.
4. Agents: parent-to-subagent relationships, task events, token and cost attribution, confidence/status indicators.
5. Timeline: correlated activity across projects and sessions.
6. Costs: uncached input, output, prompt caching, model pricing, unknown-rate coverage.
7. Reports: local CSV/JSON export, presentation-style Story Mode.
8. Settings: data directory, scanning, local archiving, privacy controls, model rate configuration, diagnostics.

**Image concepts:** `design/references/`. These are illustrative, not accurate UI screenshots or source implementations.

## For the developer using Claude Code

1. Read `START_HERE_TR.md` for the local start commands.
2. Launch an Opus main session in the repository root: `claude --model opus`.
3. Paste the contents of `prompts/OPUS_KICKOFF.md` as the initial message.
4. Opus reads `CLAUDE.md`, the documents in `docs/`, and delegates bounded implementation tasks to the eight Sonnet subagents in `.claude/agents/`.
5. Every milestone requires working code, tests, visual verification and a short report in `reports/`.
6. Publish to GitHub only after the checks in `docs/GITHUB_RELEASE.md` pass and after a human reviews the repository contents.

## Implementation constraints

- Recommended: Node.js 24 LTS (minimum 24.15 for the proposed built-in SQLite interface), TypeScript, React + Vite, Fastify, Zod, node:sqlite, filesystem watcher with polling fallback, Vitest and Playwright.
- npm workspaces (`apps/web`, `apps/server`, `packages/core`). The implementation agent may propose justified changes in an architecture decision record before coding.
- Development can fetch/install dependencies; **production runtime** must not require third-party web services. Package versions and license notices must be checked.
- The UI needs real empty states, loading/error/partial-coverage states and adaptive layouts. Never fake data or hard-code demo numbers into real mode.

## Sources and licenses

- Official Claude Code documentation and known transcript caveats: `docs/RESEARCH_NOTES.md`.
- This kit is MIT licensed (see `LICENSE`). Orbit branding is a working name; trademark/domain availability has not been checked.
- Third-party Avenox screenshots were inspiration only and are **not distributed** here. The included Orbit mockups are AI-generated design concepts created for this project. Do not imitate third-party characters, scene layouts, artwork, exact copy, or marks.

## What this archive is not

It is not a prebuilt application, a Claude plugin or an Anthropic product. It is a detailed, versionable specification and agent setup for producing the full application on the user's Mac and, eventually, on other computers.
