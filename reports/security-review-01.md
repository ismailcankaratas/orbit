# Security & privacy review 01

Date: 2026-10-15. Reviewer: security-reviewer (Sonnet, read-only). Target: build of apps/server + apps/web from Wave B (server started on 127.0.0.1 with synthetic data only).

**P0: none.**

| ID | Sev | Area | Finding | Status |
| --- | --- | --- | --- | --- |
| F-01 | P2 | supply chain | `@fastify/static` 8.3.0 has 4 advisories (high, fixed in >=10.1.6). Traversal probes against Orbit were blocked. | Fix: dependency upgrade (Opus) |
| F-02 | P3 | supply chain | `react-router(-dom)` 6.30.6 advisories (open redirect via backslash in Link targets; SSR-only issue). No data-built Link targets found. | Planned upgrade or documented |
| F-03 | P3 | dev-only | vitest/tinypool/@vitest/mocker advisories (dev dependencies only). | Upgrade before CI gate |
| F-04 | P3 | display spoofing | Bidi overrides / zero-width chars not stripped from alias and cwd-derived labels. | Routed to api-engineer |
| F-05 | P3 | source root | `sourceRoot` accepted `/` (or symlink to it); with consent the scanner walks it. | Routed: denylist |
| F-06 | P3 | TOCTOU | No post-open fstat/dev-ino check or O_NOFOLLOW when reading discovered files. | Routed |
| F-07 | P3 | DB minimization | `source_files.project_dir` stores the encoded absolute cwd (local DB only, never in DTOs). | Routed: hash it |
| F-08 | P3 | config | `ORBIT_DATA_DIR` chmod applied to any directory, e.g. `$HOME` by mistake. | Routed: marker file |
| F-09 | P3 | DoS | No cap on concurrent SSE clients. | Routed: cap 16 |
| F-10 | P3 | CSP | `style-src 'unsafe-inline'` (scripts still `'self'` only). | Accepted: inline styles from chart library; documented |
| F-11 | Info | HTTP | Node-generated 431 for oversized headers lacks Orbit error shape/CSP. | Optional |
| F-12 | Info | design | Any local same-user process can obtain the CSRF token (no auth on a local server). | Documented residual risk |

## Verified blocked (evidence summary)
- Listener only on `127.0.0.1` (lsof). Host variants (`evil.com`, `127.0.0.1.evil.com`, `localhost.`, `[::1]`, `0.0.0.0`, wrong port, duplicate Host, absolute-form URI) → 403.
- Origin variants (`null`, other localhost port, https scheme, suffix tricks) → 403; `Sec-Fetch-Site: cross-site|same-site` → 403; SSE and `/api/v1/session` protected the same way.
- CSRF: missing/empty/wrong token, query/cookie token, text/plain or form bodies, method-override headers → 403/400/415.
- Path traversal in API ids and static files → 400/404 or SPA index, never file contents.
- SQL injection in all params → 400 or parameterized no-op; DB intact.
- Scanner: symlinked file/dir and FIFO inside root skipped and counted; outside content never ingested.
- Leak scan over API responses, CSV/JSON exports, `orbit.sqlite`(+WAL), `settings.json`, stdout/stderr: 0 hits for canaries, fake secrets, prompt-injection text, `/Users/`, temp paths.
- CSV formula payloads neutralized; HTML payloads stored and returned as plain text; no HTML sinks in web source; CSRF token memory-only.
- Data dir 0700, DB/settings 0600. Web bundle: no external fetches, fonts, analytics.

## npm audit / licenses
- `npm audit --omit=dev`: 3 (1 high @fastify/static, 2 moderate react-router). Full: 6 incl. dev-only vitest chain.
- 133 production packages: MIT 99, ISC 20, BlueOak-1.0.0 8, BSD-3-Clause 5, MIT AND ISC 1. No copyleft, none missing.

## Residual risks
Unauthenticated local API by design; node:sqlite experimental; no DOM-level XSS execution test in a browser during this review (covered later by E2E); point-in-time review, not a guarantee.
