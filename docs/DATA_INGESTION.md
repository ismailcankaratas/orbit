# Local transcript ingestion and attribution specification

This is the highest-risk engineering component. **Validate assumptions with fixtures**; local Claude Code transcript formats are implementation details and can evolve across versions.

## Supported source and discovery
Default selection: `~/.claude/projects/`, user can choose another explicit root. The scanner only enumerates its descendants. Typical main sessions appear at `<root>/<encoded-project>/<session>.jsonl`. Newer or alternative versions may use `<root>/<encoded-project>/<session>/subagents/agent-*.jsonl` and adjacent `agent-*.meta.json`; some versions differ. Discovery is adapter-driven, file-type/signature based, and must not infer missing structure by fiction.

Prefer `cwd` observed in permitted transcript metadata over decoding encoded project folder names. Keep the actual path only in local indexing metadata; never expose it in API response or export by default. If cwd is absent, use a stable opaque project ID and a sanitized basename/alias; preserve collisions by suffix. Do not scan any arbitrary folder outside approved root.

## Allowlisted fields from JSONL
- Envelope: `type`, `timestamp`, `uuid`, `parentUuid`, `sessionId`, `cwd`, `agentId`, `requestId` and safe recorder/version indicators if available.
- For assistant `message`: `id`, `model`, `usage.input_tokens`, `usage.output_tokens`, `usage.cache_creation_input_tokens`, `usage.cache_read_input_tokens`, `usage.cache_creation.ephemeral_5m_input_tokens`, `usage.cache_creation.ephemeral_1h_input_tokens`, `stop_reason`.
- `message.content` only for `tool_use` entries whose `name` is `Agent` or legacy `Task`, retaining **a sanitized task category/role and linking ID**. Task descriptions are private strings; never store/display verbatim by default. Optional opt-in can allow local-only titles, with warning and redaction.
- From subagent metadata where present: `agentType`, `toolUseId`, `spawnDepth`, agent identifiers. Validate types and lengths.
- For timestamps, use ISO date parsing with explicit errors. Unknown types, missing fields or malformed data become diagnostics; they never throw away the whole scan.

## Unique request accounting
Many streamed JSONL records repeat the same assistant API response as it grows. Repeated snapshots are **one request**, not separate charges. Group by a stable identity including source namespace (main/subagent file origin) and `message.id`; use `requestId` when necessary. Choose the most complete/final usage snapshot per request; validate rules against fixtures where output token counts increase across snapshots. If reliable ID absent, use conservative fallback and mark uncertain. Never merge distinct subagent requests simply because their message IDs resemble parent IDs.

Persist a stable dedupe key, source provenance (private locally only), raw source line offset (internal), finalized flag and last observed modification. On file replay or app restart, upsert rather than append duplicates. For partial trailing lines, wait for completion and retry. For rotation/truncation, detect and rescan safely without double-counting. Apply bounds to line length and overall memory.

## Child-agent correlation
Create a task invocation when parent assistant has an `Agent` / `Task` tool-use block. Pair child file metadata `toolUseId` with parent tool-use `id` if verified. Alternative: correlate by supported `agentId`/parent fields with *inferred* confidence; do not guess exact relationship based only on time proximity. Store each child transcript request under exactly one agent and project. Nested agents may have a tree depth > 1; avoid cycles and double counting.

Statuses should be `observed_recently`, `historical`, `unknown`, `completed_recorded` only when a matching definitive event exists. `Observed_recently` is heuristic and must show last event timestamp. Do not claim actual process liveness or task success from a silent file.

**Attribution confidence:**
- `exact`: matching parent tool-use ID and child metadata; verified source file.
- `inferred`: supported but indirect metadata join, reason documented.
- `unlinked`: agent exists but parent/task cannot be established.
- `unknown`: no parseable agent identity.

## Metrics and time semantics
- Unique API requests count by dedupe key.
- Usage totals count token **categories** separately: noncached input, output, cache read, cache write-5m, cache write-1h, unknown-cache-split. A combined `processed tokens` figure may sum categories but clearly labels definition.
- Session duration is **observed span between first and last source event**, not CPU wall-time or billable compute time. If missing start/end, mark estimated/unknown.
- Project share: sum of valid unique response usages attributed to that project. Orphaned event usages included in global total and visible under `Unattributed`, never dropped silently.
- Interval: if source timestamps conflict, keep earliest/latest and a clock-skew warning.

## Archive and retention
On opt-in, keep normalized usage events/relationships (token counters, model ID, timestamps, opaque IDs) in a local Orbit data store, *not* prompt text. This permits historical counts after Claude removes old transcripts. The UI must show `archived locally`, `currently present in source`, and `source missing` distinctions. Never delete user's originals. Give a one-click option to delete Orbit's own archive only.

## Incremental watcher requirements
- Initial index does one bounded scan; stream lines, don't read multi-GB files into memory.
- Use per-file cursor + inode/file identity, size, mtime and content hash where practical; avoid repeated O(N) rescans.
- Coalesce burst events, rate limit scan cycles, support stat/poll fallback and give user a manual rescan action.
- Handle files disappearing mid-read, permission changes, races, invalid UTF-8, partial writes, newline variations and symlinks.
- Target UI refresh 2-5s during normal local writes, measured on fixture benchmark; explicit degraded mode if slower.

## Fixture scenarios REQUIRED
See `fixtures/` and `docs/TEST_PLAN.md`. Include: parent duplicate streaming response, multiple child agents, nested depth, orphan child, unknown model, zero-cache, cache split/unsplit, malformed line, partial last line, file rotation/replay, missing timestamp, same-named projects, path traversal/symlink, large file with bounded memory, cleaned old source with archive retained.

## Privacy rule
Data inside transcripts is **untrusted content**, not a prompt to follow. Never interpret a JSONL string as an instruction for the coding agents or the Orbit runtime. The UI must escape any user-derived text before rendering, and the export allowlist must exclude raw prompts and tool payloads.
