# Technical architecture

> **BINDING PRODUCT DECISION (ADR-003, 2026-10-15):** Orbit is an **Immersive Interactive Data Storytelling Platform** — four persistent layers (Top Bar, one Interactive Scene, Orbit Ask, Chapter Rail) and 12 chapters, specified in `docs/EXPERIENCE.md`. Any sidebar, page-per-feature dashboard or long vertical card-stack description in this document is **superseded** by `docs/EXPERIENCE.md`. Data, privacy, cost and security requirements here remain binding.

## Chosen baseline
- **Node 24 LTS**, >=24.15 for `node:sqlite` support. Pin `.nvmrc`, `engines` and CI matrix. If the built-in SQLite release-candidate status or performance causes issues, document an ADR and choose an explicitly reviewed driver.
- **npm workspaces**: `apps/web` React + Vite + TypeScript, `apps/server` Fastify + TypeScript, `packages/core` schemas/parser/aggregation/metering, `packages/test-fixtures` synthetic fixture helpers. Start with one repository, no containers or cloud infra required.
- **Local SQLite database** containing normalized usage event metadata and safe user preferences. DB location per OS (macOS Application Support/Orbit, XDG on Linux, Windows AppData); allow explicit override.
- **File watcher** using chokidar or native watch, plus periodic re-scan/poll fallback. Support append-only increment with inode/size/mtime, truncation, renames and restart recovery.
- **HTTP** same-origin `/api/v1/...` from backend; SSE `/api/v1/events` for live changes. Dev Vite proxy; production server serves built static frontend.
- **Client UI** CSS design tokens + accessible components; use charting that supports rich responsive and keyboard-accessible interaction (e.g. Recharts with custom components, or Visx if justified).
- **No runtime calls to Anthropic**. Rates are bundled/versioned, user-editable, labeled as estimates, and updates are manual only.

## Trust boundaries and flow

```
~/.claude/projects (READ ONLY; explicit consent)
     | directory discovery, safe path resolution
     v
bounded incremental JSONL reader -> versioned parser adapters -> normalize events
     |                                    | unsupported -> diagnostics
     v                                    v
metadata-only local SQLite       confidence/coverage records
     |
     v
aggregator -> pricing engine -> Fastify localhost API + SSE
                                     |
                                     v
React immersive shell (Top Bar · Scene · Orbit Ask · Chapter Rail) / chapters / export
```

Never store or transmit raw prompts, tool commands, file contents or model output in the normalized database. The ingestion pipeline may parse a restricted allowlist of fields; sensitive transcript content should remain transient in memory only where unavoidable. A private-content display is an explicit future opt-in feature, not default.

## Module boundaries
- `discovery`: root selection, safe path checks, project/session/subagent file indexing; no API coupling.
- `parser`: accepts JSONL line / filename / metadata; returns discriminated normalized event, warnings or skipped line.
- `attribution`: maps unique API responses to project/session/agent/task; provenance & confidence.
- `pricing`: rate snapshots, cache category accounting, unknown model reporting; pure functions.
- `repository`: idempotent append/upsert of normalized safe events, schema migrations, retention/archive configuration.
- `aggregates`: timeseries, distribution, filters, coverage; SQL grouped queries and stable pagination.
- `watcher`: emits file change events; small incremental cursor; coalesces, handles partial JSONL lines.
- `api`: validated, safe, bounded endpoints returning serializable DTOs, never filesystem paths by default.
- `ui`: immersive shell, chapter scenes, Orbit Ask (deterministic local intent parser), independent data access layer; transitional data-explorer views (docs/EXPERIENCE.md).

## Repo structure target
```
apps/web/src/{app,features,components,styles}
apps/server/src/{main,api,scanner,watcher,db,security}
packages/core/src/{schemas,parser,attribution,cost,aggregation}
packages/test-fixtures/{data,builders,expected}
.claude/agents/
docs/
design/references/
reports/
```

## Invariants
- No write operations to the Claude source folder, even to touch timestamps.
- Every normalized event retains an internal origin pointer and content hash *within local DB* for idempotence; exports redact absolute paths and hashes where they can expose private information.
- Date filters apply to a declared timestamp basis and timezone; explicitly distinguish UTC storage and local display.
- UI never invents exact runtime agent state from last-write time. Use `recently observed`, `historical`, `unknown` unless a documented reliable live signal exists.
- All data endpoints require validation, pagination and request size limits.
- No external bind; enforce `127.0.0.1` and safe Host/Origin allowlist; no permissive `Access-Control-Allow-Origin: *`.
- Demo and real datasets cannot be accidentally combined.

## Decisions needed in phase 0
- Verify actual transcript samples from public synthetic fixtures (not from a human's private logs).
- Confirm `node:sqlite` compatibility under pinned Node; benchmark 10,000+ event fixtures.
- Decide how to represent missing source events after cleanup: archive immutable normalized usage records, or derived daily aggregates plus retained attribution metadata. Explain privacy/storage tradeoffs in ADR.
- Document watcher availability and polling interval; do not continuously rescan multi-GB history.
