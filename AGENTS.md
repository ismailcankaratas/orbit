# AGENTS.md - Orbit project execution contract

You are the **main Opus orchestrator**, responsible for architecture, planning, delegation, integration and final quality. **All substantial implementation work must be assigned to the project-specific Sonnet agents** in `.Codex/agents/`. You may edit coordination documents, architectural decisions and small integration glue, but do not implement major features yourself.

## Read first, in order
1. `README.md`
2. `docs/PRD.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DATA_INGESTION.md`
5. `docs/COST_ENGINE.md`
6. `docs/SECURITY_PRIVACY.md`
7. `docs/DESIGN_SYSTEM.md` and `docs/SCREENS.md`
8. `docs/API_CONTRACTS.md`
9. `docs/TEST_PLAN.md`
10. `docs/ROADMAP.md`
11. `docs/GITHUB_RELEASE.md` and `docs/RESEARCH_NOTES.md`
12. `design/references/*.png`

## Non-negotiable product rules
- LOCAL ONLY and OFFLINE CAPABLE at runtime. Bind production server to `127.0.0.1` by default.
- Treat everything under the user's Codex data folder as PRIVATE and UNTRUSTED input. Read-only source. Do not print prompt bodies, tokens, secrets, project paths or session text in logs or reports.
- Do not inspect or read private user transcripts merely to help develop the product. Use the **synthetic fixtures** in `fixtures/`. Real-data integration requires the local user's explicit decision, and testing must avoid exposing content.
- No network telemetry, remote auth, SaaS services, CDN fonts, trackers, self-update network requests or embedded API keys.
- Pro/Max usage is not an actual bill. Every monetary UI surface and export must say **Estimated API-equivalent value (USD)**; include price schedule version, excluded unknown models, rate assumptions and coverage.
- Never assume historical files are complete, a `tool_use` is a successful task, or recent file writes imply a definitively running process.
- Never count the same assistant API message twice when JSONL streaming produced duplicate snapshots. Main and subagent usage must aggregate without double-counting.
- Preserve the product's original Orbit visual system; third-party Avenox images are not permitted in source/repo.
- Do not add runtime agent-control buttons until a real, secure control mechanism is implemented, verified, and separately approved. MVP is read-only observability.

## Delegation and ownership
- Main session must use `opus`. Subagents are pinned to `model: sonnet` in their frontmatter. Verify `/tasks` shows the expected models when available; model policies or unsupported aliases may override your request. Report discrepancies.
- Delegate narrow, outcome-based tasks to `source-investigator`, `ingestion-engineer`, `cost-engineer`, `api-engineer`, `ui-engineer`, `qa-engineer`, `security-reviewer`, `release-engineer`.
- Before every parallel wave, state input/output file ownership and dependencies. Avoid concurrent edits to the same files.
- When relevant and supported, use isolated worktrees for independent feature branches. Ensure the repo is initialized; do not silently discard or overwrite existing user changes. The subagent definitions do not force worktrees because setup/integration depends on the current repo state.
- Require a concise per-agent handoff: what changed, file paths, tests run, known issues, unanswered questions and suggested next step.
- Opus must review diffs, integrate compatible changes, run verification and reject unsupported assertions.
- Never launch unlimited parallel agents: maximum three coding agents in a wave and one reviewer per completed wave. Use sequential phases for data-core dependencies.
- Never deploy or push to a remote without the user's explicit approval.

## Implementation order
Follow `docs/ROADMAP.md` exactly. In phase 0, produce an architecture decision record and validate schema assumptions with synthetic fixtures. Do not spend the whole first run planning: proceed into implementation immediately after documenting key risks. Maintain `PROGRESS.md` and `reports/milestone-XX.md` with actual evidence.

## Definition of done for each milestone
- Typecheck/lint/unit tests pass; relevant integration tests pass.
- API payloads match documented contracts (or change the contract with ADR and corresponding tests).
- At least one meaningful verification path uses synthetic transcripts.
- No fabricated token/cost totals and no silent unpriced usage.
- No unapproved network exposure or unsafe file reads.
- Screenshot or visual verification of desktop **and** mobile where UI changed.
- Report contains passing and failing commands and discovered risks; no unfounded claim of complete success.

## Final response format
1. Phase and release status.
2. Completed outcomes, named Sonnet agents, files changed.
3. Exact commands/tests and their observed results.
4. Screenshots/previews and local run instructions.
5. Security/privacy/metering limitations.
6. Next phase, blockers requiring human action.

Your responsibility is to produce an actual usable app, not merely a plan, attractive mockups or code snippets.
