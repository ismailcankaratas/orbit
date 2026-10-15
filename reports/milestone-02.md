# Milestone 02 — Phase 2 (local backend) + Phase 3 (core UI), Wave B

Date: 2026-10-15. Orchestrator: Opus 5.5. Workers (general-purpose agents pinned to `model: sonnet`, role files from `.claude/agents/`): api-engineer, ui-engineer, qa-engineer.

## Delivered
- `apps/server`: Fastify 5 on 127.0.0.1:4317 only; node:sqlite (WAL, migrations, 0600 files, 0700 data dir); consent-gated scanner with per-file cursor, rotation/truncation handling, idempotent upsert; fs.watch + polling fallback; SSE invalidation; separate `demo.sqlite` built from `demoDataset()` through the same pipeline; overview/projects/sessions/agents/timeline/costs/story/diagnostics/settings/alias/scan/archive/export routes per `dto.ts`; Host/Origin/Sec-Fetch-Site/CSRF enforcement, CSP & hardening headers; CSV formula neutralization; no absolute paths stored in the DB.
- `apps/web`: React 18 + Vite; Turkish default + complete English (404 keys each, parity tested); onboarding consent screen; Overview, Projects, Project detail, Sessions, Session detail, Agents (topology + list + drawer), Settings; SSE + polling; URL-persisted filters; chart table alternatives; no agent-control buttons.
- QA: permanent 26-scenario cross-check, 5 new edge scenarios (inferred link, nested orphan, split>aggregate, invalid UTF-8, >4 MiB line), seeded property tests, `scripts/bench-core.ts`.

## Opus decisions on agent questions
- Archive default changed to **off** (`apps/server/src/config/settings.ts`) — the spec requires opt-in.
- Purge (`DELETE /archive`) keeps consent/settings; watcher scans pause until an explicit rescan.

## Evidence (commands run by Opus after integration)
| Command | Result |
| --- | --- |
| `npm run typecheck` (all workspaces) | exit 0 |
| `npm run lint` | exit 0 |
| `npx vitest run` | 17 files, 191 tests passed |
| `npm run build` | web: entry 397 kB (117.6 kB gz) + lazy charts 429 kB (116 kB gz) + CSS 15.9 kB; server bundle 170.6 kB |
| Built server smoke | `/health` 200; started with temp `ORBIT_DATA_DIR`; listener only on 127.0.0.1 (agent: lsof) |
| Playwright (Opus) 1440x900 + 390x844, onboarding → demo → 7 routes | 0 console errors, 0 page errors, **0 requests to any non-127.0.0.1 origin** |
| Overflow probe (Opus) | **FAIL** — horizontal overflow on `/`, `/agents`, `/sessions` (desktop) and `/`, `/projects`, `/agents`, `/sessions` (mobile). Routed to ui-engineer in Wave C. |
| Visual review (Opus) | Overview/Project detail match the Orbit direction; Agents topology unreadable at 234 agents; money label duplicated in two panels. Routed to Wave C. |

## Performance (api-engineer, M4 Pro, Node 22.19, synthetic corpus)
| Corpus | Initial scan | No-change rescan | Warm 30-day overview |
| --- | --- | --- | --- |
| 10k requests | 1.05 s | 107 ms | 19 ms |
| 100k requests | 13.5 s | 1.09 s | 255 ms |
Core-only pipeline (qa bench): 100k requests in 4.2 s, peak RSS 392 MB (holds all in memory; no DB).

## Known issues carried forward
- Layout overflow + agent topology (Wave C, ui-engineer).
- Renamed source file with archive ON can double count (Wave C, api-engineer).
- Native date inputs follow browser locale.
- Real Claude Code schema variants unverified (consent required).
