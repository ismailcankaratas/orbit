# Architecture decisions and deliberately open issues

## Locked product decisions
1. Orbit = independent, MIT open-source, local-only read-only Claude Code observability dashboard.
2. Subscription mode = user-visible **estimated API-equivalent value** and observed tokens, not actual Pro/Max monetary charge or account-wide plan quota.
3. The software does not authenticate to Claude or call Anthropic services. Local source file access is consent-gated.
4. Source logs are never modified. No hooks, no credentials and no unauthorized file reads.
5. Main development model is Opus; `.claude/agents/*.md` workers are Sonnet.
6. Use **Orbit-original** charcoal / amber / editorial style; design reference images are included only as concepts.
7. Features must use real local normalized events or unmistakably separate synthetic demo data.
8. User opts into safe normalized archive (no raw prompt bodies).
9. Github publication needs explicit human approval.

## Default implementation choices to validate in ADR-001
- Node.js 24 LTS >=24.15, npm workspaces, Vite+React+TS, Fastify, Zod, node:sqlite, file watcher with fallback, Vitest+Playwright.
- One local HTTP server serving both static frontend and private API on 127.0.0.1.
- Incremental cursor plus SQLite idempotent upsert and model rate schedules.

## Questions that do not block implementing synthetic-fixture MVP
- Which local Claude version/schema variants are present on each user's computer?
- Can every child invocation be correlated exactly? If not, label orphan/confidence.
- What is the most robust local archive detail level without exposing content?
- Whether to release a single executable/Electron/Tauri packaging after web-local alpha.
- Precise exact model pricing modifiers when the source does not reveal request modes.
- Brand/trademark availability for short name `Orbit`.

## Decisions requiring actual user input later
- Permission to test against sanitized metadata structure of user's real `~/.claude/projects` folder (default no).
- Whether to opt in to archiving locally during onboarding.
- Whether to publish GitHub repo under user's account and exact organization/repo name.
