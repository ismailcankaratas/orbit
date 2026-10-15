# Research notes and verification links

Last specification review: 2026-10-14. The Claude Code JSONL layout is a **local implementation detail**, not a contract. Recheck official docs and versions when implementing; treat public community-reported schemas as examples, not definitive guarantees.

## Official sources
- Claude Code subagents and frontmatter: https://code.claude.com/docs/en/sub-agents
  - Project agents go in `.claude/agents/` with YAML frontmatter and `model: sonnet`.
  - Main session can start with `claude --model opus` (CLI model alias).
  - `isolation: worktree` is available for isolated agent work; do not assume automatic conflict-free merges.
  - Model availability and configured policy can override intended alias.
- Claude Code CLI: https://code.claude.com/docs/en/cli-reference
- Claude Code local transcript storage and retention: https://code.claude.com/docs/en/data-usage
  - Plaintext local transcripts appear under `~/.claude/projects/`; default cleanup is 30 days (subject to configuration and exceptions).
- Claude API per-model pricing: https://platform.claude.com/docs/en/about-claude/pricing
  - Rates include base input, output, prompt caching reads and writes; model generation differences matter.
- Anthropic organization Usage & Cost Admin API: https://platform.claude.com/docs/en/manage-claude/usage-cost-api
  - This is for API/organization use and **not** a general Pro/Max individual account historical cost endpoint.

## Example-only community evidence for parser tests
- Public reports describing `message.usage` fields, repeated streaming snapshots and subagent files: https://github.com/anthropics/claude-code/issues/74318
- Discussion of subagent usage visibility and missing aggregate values in some environments/versions: https://github.com/anthropics/claude-code/issues/23254
- Example of per-message agent transcript records: https://github.com/anthropics/claude-code/issues/59076

## Deliberate unknowns to investigate, not assume
1. Exact schema variants and metadata presence across installed Claude Code versions.
2. Whether local logs contain all subagent model calls, especially older versions and interrupted sessions.
3. Whether a log message is definitively complete when no stop reason was recorded.
4. Which special pricing modifiers can be deduced from local data.
5. Whether live process information can be safely correlated; v1 uses `recent observed event` instead.
6. OS-specific default config paths and exact retention behavior of newer Claude Desktop sessions.
7. Local historic availability: does the machine still contain prior months of files? Never invent backfilled history.

## Notes for the implementation team
Do not use protected user transcripts as a substitute for research or commit them. Run synthetic tests, inspect only file structure with consent in local QA, sanitize all diagnostics. If an assumption changes, write an ADR with evidence and update tests, PRD and public limitations.
