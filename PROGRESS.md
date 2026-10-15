# Orbit delivery progress

Current state: **PHASE 1 IN PROGRESS** (2026-10-15). Decisions: docs/ADR-001-foundations.md.

| Phase | State | Owner(s) | Evidence | Blockers |
| --- | --- | --- | --- | --- |
| 0 - Validation | PASS | Opus | ADR-001, agents recreated, git init, fixtures hand-verified | - |
| 1 - Core parser/cost | IN PROGRESS | ingestion / cost / qa (Sonnet) | - | - |
| 2 - Backend/archive | NOT STARTED | api / security / qa | - | - |
| 3 - Premium UI | NOT STARTED | ui / qa | - | - |
| 4 - Reports/Story | NOT STARTED | ui / cost / qa | - | - |
| 5 - Stabilize | NOT STARTED | qa / security / source-investigator / ui | - | Real-data scan needs separate user consent (declined for now 2026-10-15) |
| 6 - Publish | NOT STARTED | release / Opus | - | Human approval before any push/repo creation |

## Execution plan

| Milestone | Sonnet owner | File boundary | Depends on | Verification |
| --- | --- | --- | --- | --- |
| M1a parser/dedupe/attribution/discovery | ingestion-engineer | packages/core/src/{parser,attribution,discovery} | schemas/types.ts | vitest core, fixture totals |
| M1b pricing engine + rate schedule | cost-engineer | packages/core/src/cost | schemas/types.ts | vitest cost acceptance fixtures |
| M1c synthetic generator + demo dataset | qa-engineer | packages/test-fixtures | schemas/types.ts | vitest fixtures, determinism |
| M2a SQLite repo, scanner, watcher, API, SSE | api-engineer | apps/server | M1a-c, schemas/dto.ts | Fastify inject integration tests |
| M2b security audit of server | security-reviewer | read-only | M2a | P0-P3 report |
| M3 shell, onboarding, Overview, Projects, Sessions, Agents, i18n tr/en | ui-engineer | apps/web | M2a DTOs | Playwright desktop+mobile screenshots |
| M4 Timeline, Costs, Reports, Story Mode, export | ui-engineer (+cost review) | apps/web, server export | M3 | E2E + export leak scan |
| M5 E2E/a11y/perf/security regression | qa-engineer, security-reviewer, source-investigator | e2e/, perf/, reports | M4 | measured numbers |
| M6 OSS release kit | release-engineer | README, docs, .github | M5 | fresh-clone install, CI dry run |

## Agent availability note
Project agents in `.claude/agents/` were recreated during this session; this running Claude Code session did not hot-load them (`Agent type 'ingestion-engineer' not found`). Per ADR-001 §10 each wave runs the general-purpose agent pinned to `model: sonnet`, instructed to read and follow the named role file. In a new session the named agents should be available directly.

## Environment notes
- Node v22.19.0 (Node 24 recommended), npm, Apple M4 Pro, macOS (Darwin 25.5).
- `~/.npm` cache has root-owned files (npm EACCES on one install); worked around with a session-local `--cache`. Human fix: `sudo chown -R 501:20 ~/.npm`.
