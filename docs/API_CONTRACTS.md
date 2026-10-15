# API and normalized DTO contract (v1)

A proposed implementation-independent contract; types are illustrative. Confirm with Opus ADR before substantial backend/frontend parallelization. All routes should be versioned under `/api/v1/`, same-origin only and served over loopback. Responses contain only safe metadata and aggregate values.

## Shared conventions
- UTC timestamps in ISO-8601. UI localizes via selected timezone.
- Opaque stable IDs; no raw filesystem paths in standard responses.
- Prices stored as exact decimal text or integer micro-USD to prevent error; rendered USD.
- Request options: `from`, `to`, `projectId`, `modelId`, `limit` (max 200), `cursor` (opaque), `tz` (validated IANA timezone).
- Each metric with uncertain meaning contains a `quality` enum (`observed | derived | estimated | unknown`), `reason`, `coverage` and `asOf` where needed.
- Errors: `{ "error": { "code": "SOURCE_PERMISSION_DENIED", "message": "...", "retryable": true } }`; never include stack traces or private source text.

## Endpoints

| Route | Method | Response / purpose |
| --- | --- | --- |
| `/health` | GET | Local app readiness/version only; no private metrics |
| `/api/v1/overview` | GET | KPIs, model split, daily timeline, coverage and safe insight |
| `/api/v1/projects` | GET | Filtered/paginated safe project summaries |
| `/api/v1/projects/:id` | GET | Project aggregate, session/agent breakdown |
| `/api/v1/sessions` | GET | Filtered/paginated sessions |
| `/api/v1/sessions/:id` | GET | Session summary and agent invocation links |
| `/api/v1/agents` | GET | Parent/child agent nodes, filters, confidence |
| `/api/v1/agents/:id` | GET | Agent session usage, event timestamps and parent evidence |
| `/api/v1/timeline` | GET | Bounded event windows and group IDs |
| `/api/v1/costs` | GET | Estimated API value, token classes, coverage, price version |
| `/api/v1/reports/summary` | GET | Safe, deterministic story slide data |
| `/api/v1/exports?format=csv|json` | GET | Allowlisted safe analytics export, bounded size |
| `/api/v1/diagnostics` | GET | Ingestion health, malformed count and missing rates |
| `/api/v1/settings` | GET | Safe settings, redacted source label; no credentials |
| `/api/v1/settings` | PATCH | Local settings only, CSRF/origin validated |
| `/api/v1/scan` | POST | Explicit local rescan, rate limited, CSRF validated |
| `/api/v1/archive` | DELETE | Purge Orbit-only DB/archive, confirmation + CSRF required |
| `/api/v1/events` | GET | SSE `scan.updated`, `usage.updated`, `diagnostics.updated` |

## Example summary payload (fictional)

```json
{
  "mode": "real",
  "period": { "from": "2026-09-01T00:00:00.000Z", "to": "2026-10-01T00:00:00.000Z" },
  "asOf": "2026-10-01T00:00:00.000Z",
  "metrics": {
    "uniqueRequests": { "value": 237, "quality": "observed" },
    "tokens": {
      "uncachedInput": 1000,
      "output": 300,
      "cacheRead": 2500,
      "cacheWrite5m": 400,
      "cacheWrite1h": 100,
      "unsplitCacheWrite": 0,
      "quality": "observed"
    },
    "estimatedApiValue": {
      "usdDecimal": "0.042100",
      "quality": "estimated",
      "reason": "API rate equivalent, not subscription charge",
      "rateScheduleVersion": "example-2026-10",
      "pricedRequestCount": 230,
      "unpricedRequestCount": 7
    }
  },
  "coverage": { "sourceFirstAt": "2026-09-03T10:00:00.000Z", "unpricedRequestCount": 7, "unlinkedAgentCount": 2, "sourceStatus": "partial" }
}
```

## Incremental event delivery
`GET /api/v1/events` SSE sends minimal invalidation events, not transcript lines:
```
event: usage.updated
data: {"revision":182,"changedProjects":["p_opaque_1"]}
```
Frontend invalidates affected TanStack Query keys, not full reload. SSE reconnects with backoff; fallback GET polling without hammering local disk. Enforce Origin/Host checks even on SSE.

## Data model overview
Tables or equivalent: `source_files`, `projects`, `sessions`, `agent_invocations`, `api_requests`, `usage_categories`, `rate_schedules`, `parse_warnings`, `archive_settings`, `scan_checkpoints`, `aliases`. `api_requests` is unique on stable request key and event revision; separate relationship rows prevent duplicate counting. Schema migrations preserve existing archive; avoid long locks during incremental ingest.

## Error cases to design
`SOURCE_NOT_FOUND`, `PERMISSION_DENIED`, `SCAN_IN_PROGRESS`, `PARTIAL_TRANSCRIPT`, `RATE_NOT_FOUND`, `UNSUPPORTED_SOURCE_SCHEMA`, `INVALID_FILTER`, `EXPORT_TOO_LARGE`, `APP_ARCHIVE_NOT_INITIALIZED`, `NO_COVERAGE`, `CROSS_ORIGIN_DENIED`.

## Implementation notes (v0.1, see ADR-002)
- `PATCH /api/v1/settings` with a forbidden `sourceRoot` (`/`, home or its ancestors, `~/.ssh`, `~/.gnupg`, `~/Library/Keychains`, `/etc`, `/System`, or anything containing/inside Orbit's data dir) → 400 `SOURCE_NOT_ALLOWED`; the path is never echoed.
- `GET /api/v1/events` accepts at most 16 concurrent clients; beyond that 503 `RATE_LIMITED` (retryable).
- Oversized headers (431) and malformed requests (400) use the standard error shape with security headers.
- Exports above 100,000 aggregated rows → 413 `EXPORT_TOO_LARGE`.
