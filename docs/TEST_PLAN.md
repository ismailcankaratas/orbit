# Quality assurance and end-to-end test strategy

## Test pyramid
1. **Pure unit tests**: parser adapters, duplicate message snapshot logic, token classes, pricing, parent-child link confidence, date bucketing, project collision handling, export redaction.
2. **Integration tests**: bounded directory scan + SQLite upsert, incremental replay, watcher/partial JSONL, API filtering/pagination, SSE update, archive cleanup.
3. **Browser E2E**: initial consent -> scan synthetic fixture -> overview -> project -> agent -> session -> rate warning -> export -> Story Mode -> settings. Real and demo cannot mix.
4. **Security regression**: path traversal, hostile origin/host, cross-origin SSE, malicious JSONL text, no auth reads, symlink escape, no raw prompt persistence, no internet runtime.
5. **Performance/resilience**: large synthetic corpus, cold scan, incremental update, memory growth, DB migration, malformed rows and mid-read file deletion.
6. **Visual regression**: screen shots for overview, agents, project detail, mobile layout, empty states, reduced motion. Compare to Orbit mockups **for visual direction**, not literal image equality.

## Fixtures and expected assertions
`fixtures/` contains public **synthetic** records only. Expand with deterministic generator (in `packages/test-fixtures`) that never calls Claude, never reads `~/.claude` and has no personally identifiable information. Required cases:

- Duplicate assistant snapshots for same `message.id` where output changes 5 -> 19 -> 25. Expected one unique request and output 25.
- Main agent tool use and matching child metadata `toolUseId`; child requests counted once and attributed to child agent and parent project.
- Two distinct child agents both report same fake human-readable role; remain separate by IDs.
- `cache_creation_input_tokens` equals sum of 5m and 1h breakdown; never double counted.
- Mismatching metadata -> orphan with `unlinked`; total usage remains included.
- Invalid JSON line between valid lines -> continue parsing, mark warning.
- Trailing partial JSONL -> hold cursor and retry on append, no duplicate.
- Unknown model price -> tokens present, estimated price is missing/partial coverage, not zero.
- Source file shrinks/rotates -> idempotent snapshot rebuild/merge.
- Old source disappears after archive -> archive preserves safe normalized past totals, clearly marked unavailable in source.
- Conflicting timestamps -> parse warning, never negative durations.
- Project ID collision and unsafe HTML in alias/title -> stable identity and escaped display.
- Timezones DST boundary (e.g. Europe/Istanbul no DST, America/New_York with DST) -> accurate daily grouping.

## Required security test details
- Symlink nested inside approved root pointing to private `.ssh`: scanner must not follow.
- Crafted file name with `../` path and unicode normalizations: cannot escape root.
- Cross-origin requests via malicious Origin, Host and preflight: blocked (include GET/SSE, not only PATCH).
- Malicious `"<script>"` or markdown content inside JSONL fields: cannot execute on web page, cannot alter agent system prompts.
- Search/CSV export with formula injection prefix `=`, `+`, `-`, `@`: exported cells must be safely neutralized.
- Source transcript with fake `api_key` / `password` string -> absent from normalized DB, HTTP response, log, screenshot and exported files.
- No dependency to remote resources in Playwright network trace when built app is loaded offline.

## Performance objectives (measure, don't assume)
- Typical cold scan of 10k synthetic usage requests completes in target < 15s on development Mac. Adjust target and document actual environment; memory bounded as input scales.
- New appended completed JSONL usage observed in UI within 2-5 seconds during normal conditions.
- 30-day Overview API response target < 400ms after DB warmup for 100k safe normalized events. Use benchmarks and indexes; report actual measured numbers.
- Responsive UI avoids long main-thread stalls; timeline can handle 5000 rows via virtualization/aggregation.

## Browser matrix
- macOS current Chrome/Chromium and Safari where automated/available; desktop 1440x900 and mobile-like 390x844 viewport.
- Test keyboard navigation, no hover dependency, chart text alternatives, `prefers-reduced-motion` and data density.

## Exact project commands expected by release
- `npm install` (once), `npm run dev`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:e2e`, `npm run verify` (composes appropriate checks), `npm run start` (build production, localhost only).
- Tests **must really exist** and run; placeholder `echo "ok"` scripts are prohibited.
- Use network-disabled test of built app to demonstrate offline behavior.

## Reporting format
Each milestone writes `reports/milestone-XX.md` containing commands run, observed exit codes, passing test counts, screenshots/artifacts if applicable, failed scenarios, known limitations, next action and reviewer attribution. A claim of 100% success without logs is not evidence.
