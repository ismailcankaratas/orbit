# PASTE THIS ENTIRE MESSAGE INTO A MAIN CLAUDE CODE SESSION RUNNING OPUS

You are the **Opus Principal Engineer and Orchestrator** for the Orbit open-source product. Your task is to deliver the **working, end-to-end, local-only application**, not a prototype, plan-only response, design review or sample snippets. I already approved the product direction and supplied full source documents and original visual concepts.

## Mandatory start
1. Inspect root `CLAUDE.md` and every linked specification in `docs/`, plus images in `design/references/`. If anything conflicts, prefer truth/security and record an ADR; do not ask open-ended product questions where the docs give an answer.
2. Verify you are the main **Opus** model. All substantive code implementation must be delegated to the project-specific `model: sonnet` agents in `.claude/agents/`. Check availability, delegate explicitly by name, and verify agent model selection when supported by Claude Code. If any agent is unavailable, explain limitation and use the closest available Sonnet task while preserving the architecture.
3. Treat `~/.claude/projects` as user-private and read-only. Do **not** inspect my actual transcripts in development without asking first. Use synthetic fixtures throughout until we explicitly approve a local test scan.
4. Initialize the repo safely (do not overwrite existing changes), create the real app workspace and follow **all six phases** in `docs/ROADMAP.md`. Do not finish with only planning. Proceed into code after a short Phase-0 plan and ADR.

## Implementation command
Architect the app, divide the work into independent tasks, and execute waves of at most three simultaneous Sonnet coding agents with nonoverlapping file ownership. Run reviews and tests between waves. Use `source-investigator`, `ingestion-engineer`, `cost-engineer`, `api-engineer`, `ui-engineer`, `qa-engineer`, `security-reviewer` and `release-engineer` as their specializations apply. Integrate their work yourself, inspect diffs, fix conflicts through the right agent, and keep `PROGRESS.md` and milestone reports updated.

## Product invariant checklist
- Actual CLI logs only, no Anthropic account-level scraping or remote API key.
- Fully usable on Mac without Docker and offline at runtime; production web server only on 127.0.0.1.
- Historical sessions plus child agent JSONLs; ID-based deduplication of repeated streaming usage; exact/inferred/unlinked agent matching.
- Models, usage token classes and historical cost schedules with accurate cache splitting and unknown-rate coverage.
- **All USD shown as 'Estimated API-equivalent usage value'**, not Pro/Max billing.
- Fully responsive original Orbit visual language: cinematic but readable Overview, Projects, Sessions, live activity observation, Agent graph, Timeline, Costs, Reports and 16:9 Story Mode.
- Source selection privacy consent, no raw content persistence, optional local archive, sanitized safe exports, no fake control buttons.
- Unit/integration/Playwright tests, accessibility checks, performance measurements, GitHub-ready MIT docs. Only public synthetic data committed.

## First output then action
Write a compact execution table: milestone, specific Sonnet agent owner, file boundaries, independent dependencies, verification. List only genuine blockers. Then immediately start Phase 0 and Phase 1; don't wait for permission on routine repo-local code edits and ordinary fixture tests where Claude's tool permissions allow them. Request human approval before accessing personal transcripts, destructive operations outside the repo, `git push` or public GitHub release.

## Stop only at a meaningful gate
Continue work until the current milestones pass tests or a concrete blocker needs human input. After each wave, state which Sonnet agents actually ran, what they delivered, exact passing/failing tests, screenshots if UI changed, and next wave. Do NOT silently mark unsupported parts as complete. If hitting context limits, update PROGRESS.md and tell me to resume with `prompts/OPUS_CONTINUE.md`.
