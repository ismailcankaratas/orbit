# Milestone 01 — Phase 0 + Phase 1 (data core)

Date: 2026-10-15. Orchestrator: Opus 5.5. Workers: general-purpose agents pinned to `model: sonnet` acting as ingestion-engineer, cost-engineer, qa-engineer (project agents were not hot-loaded by the running session; see PROGRESS.md).

## Delivered
- Phase 0: git repo, `.claude/agents/*` (8 Sonnet roles), ADR-001 (stack, i18n tr default, rates, unsplit policy, dedupe key, archive, security), ADR-002 (DTO contract), npm workspaces, TS/Vitest/ESLint/Playwright toolchain.
- `packages/core/src/parser` — allowlist JSONL parser, bounded streaming reader with cursor/partial-line handling, snapshot dedupe, meta reader.
- `packages/core/src/attribution` — exact/inferred/unlinked/unknown agent linking, cycle/depth guards.
- `packages/core/src/discovery` — root-confined discovery, no symlink following, typed root errors.
- `packages/core/src/cost` — bigint micro-USD pricing, official schedule `anthropic-2026-10-15` (20 models, transcribed from https://platform.claude.com/docs/en/about-claude/pricing on 2026-10-15), overrides with intervals, coverage summary, TR/EN money labels.
- `packages/test-fixtures` — 21 deterministic scenarios, seeded corpus generator, demo dataset (7 projects, 2415 requests), canary scanner, safe CLI.

## Evidence (commands run by Opus after integration)
| Command | Result |
| --- | --- |
| `npx tsc -p packages/core/tsconfig.json --noEmit` | exit 0 |
| `npx vitest run` | core 64 + fixtures 34 = 98 tests passed |
| `npx eslint .` | exit 0 |
| Opus end-to-end script over `fixtures/synthetic-home` | 3 unique requests; 0.001135 USD estimated (opus-5 955 µUSD + sonnet-5 180 µUSD); 1 unpriced (`model-unsupported-for-test`), request coverage 66.7%; no `PRIVATE` text, no `/Users/demo` path in output |
| Opus cross-check: core pipeline vs independently computed generator expectations, all 21 scenarios | 21/21 match (requests, 6 token classes, exact links, unlinked, unknown-model, malformed) |
| 10k-request corpus generation | 277–379 ms (M4 Pro, Node 22.19) |

## Known limitations / risks
- Schema is inferred from synthetic fixtures; real Claude Code variants unverified (needs consent; declined for now).
- Price history before 2026-10-15 not recorded; current official rates applied to past events (shown in "not modeled").
- `inferred` link path has unit tests but no generator scenario.
- Final-snapshot tie-break offset not persisted (only matters for equal output counts).
- Symlink/traversal/rotation cases are tested in core unit tests with temp dirs, not as generator scenarios.

## Next
Wave B: api-engineer (apps/server), ui-engineer (apps/web shell + i18n), qa-engineer (scenario cross-check test + core perf bench).
