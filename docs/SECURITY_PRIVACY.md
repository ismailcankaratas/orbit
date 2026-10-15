# Security, privacy and trust-boundary requirements

## Threat model
A developer runs Orbit beside code that may contain passwords, tokens, client data and private prompts. JSONL source text can also contain hostile strings. A malicious website could try to connect to an unauthenticated `localhost` API. A compromised package could exfiltrate private data. Errors and export files can leak project paths. The browser can suffer XSS if transcript metadata is rendered unsafely.

## Required safeguards

### Filesystem isolation
- Only scan the specifically consented folder; check canonical root and descendants on every relevant traversal. Default root is `~/.claude/projects`.
- Never open `~/.claude.json`, auth state, settings credentials, keychain, SSH files, `.env`, user's repository source files or arbitrary paths as part of the scan.
- Do not follow symlinks out of the authorized root; protect against path traversal and time-of-check/time-of-use replacement. Strictly bound file sizes/line lengths and refuse unsupported file extensions where feasible.
- `fs` source access is read-only; no cleanup, no hooks, no permission changes, no writes in Claude data folder.

### Local HTTP boundary
- Production binds `127.0.0.1` by default, not `0.0.0.0`, and does not bind remote network interfaces without an explicitly designed and secured future feature.
- Restrict Host headers to loopback names/addresses; validate Origin for browser requests, including SSE; reject cross-origin access by default (no wildcard CORS). Consider DNS rebinding.
- Mutating app endpoints (e.g. scanner settings or deleting local archive) require same-origin CSRF protection plus explicit user confirmation for destructive changes. Never accept arbitrary filesystem paths through URL queries.
- Disable development debugging endpoints in the distributable build. No shell-execution endpoints.

### Data minimization
- Persist **only normalized metadata**: timestamps, opaque project/session/agent IDs, token categories, model IDs, task type, confidence and user-approved aliases. No raw prompt, tool commands, response bodies, environment variables, credential values or raw source dumps.
- Raw path mapping stays local and is not included in default HTTP DTOs/CSV exports. Truncate and sanitize errors before returning to frontend.
- Avoid access logs that dump queries, request bodies or source snippets.
- No third-party analytics, crash reporting, web fonts, external images/CDNs, remote feature flags, required update checks, account login or remote backup.
- Include clear notice: dependencies may be downloaded during **installation**, but runtime functionality does not send usage data anywhere.

### Injection and XSS
- Treat logs, titles and model strings as data, never as instructions. No template rendering of untrusted HTML/Markdown by default; escape HTML; prevent script injection through imported text. Use safe JSON serializers and a Content Security Policy.
- Keep public demo fixtures fully synthetic. Do not commit screenshots of real terminals containing private data or proprietary code.

### Archive and export
- Default archive option is explained/consented to; store under user-scoped folder with restrictive permissions where supported.
- Provide a clear delete-my-Orbit-data action that does not touch original Claude data.
- Export uses allowlisted fields; cannot accidentally dump raw transcript lines or private prompts. Present export preview of included columns.

### Dependency/release safety
- Check licenses, pin the lockfile, use dependency audit, install scripts review and security scanning in CI. No secrets in repository.
- Publish MIT license + security policy; explain limitations and non-affiliation.
- No `--dangerously-skip-permissions` for the development agent outside a disposable sandbox.

## Security test gates
1. Unit tests: root path traversal, symlink escape, malformed path, `../`, null byte, unusual encodings, file disappearance race.
2. Integration: production server cannot be reached from external interfaces; hostile Origin and Host rejected; cross-site GET/SSE behavior checked.
3. XSS: HTML/script payload in project/agent/task metadata is text, not executable content.
4. Persist/export scan: no raw prompts, API keys, bearer tokens, SSH paths, absolute file paths or full JSONL snippets appear in DB default tables or exported files.
5. Supply-chain: no bundled tracking code or hidden external call.
6. Regression: untrusted fake instructions embedded inside JSONL have zero effect on agent behavior or app file operations.

## High-priority report requirements
Security reviewer must identify any P0 findings, provide reproduction evidence and block release until fixed. Do not claim perfect security; document risks and limitations honestly.
