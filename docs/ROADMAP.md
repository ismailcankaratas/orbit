# End-to-end delivery roadmap for Opus / Sonnet agents

**Development roles:** main Opus = architect/orchestrator/reviewer/merge owner. Named Sonnet subagents = implementation and review workers. Each phase ships working verified code and progress notes. Do not stop after drawing mockups.

## Phase 0 - Foundations and validation (first run)
**Opus** reads docs, registers uncertainties, checks runtime/tool availability, initializes git and task ownership, creates ADR-001 stack choice and an execution plan in `PROGRESS.md`. `source-investigator` examines **public synthetic** source samples and validates required fields. `security-reviewer` checks permissions and privacy approach. Then proceed to Phase 1 immediately if blockers are cleared.

**Exit:** README truthful, initial clean repo, normalized event schema agreed, offline/security invariants written, task assignments created. No scanning private transcripts without user consent.

## Phase 1 - Data-core and test fixtures
`ingestion-engineer` implements discovery, parser, request dedupe, agent linking and bounded streaming readers. `cost-engineer` separately implements pure rate engine and coverage semantics. `qa-engineer` builds synthetic fixtures and unit tests. Opus merges after review.

**Exit:** test from sample transcripts yields exact expected token totals, no double counting, correct parent-child association, unknown models visible. Bad rows don't crash scan. No raw prompt persistent.

## Phase 2 - Local backend and archive
`api-engineer` implements SQLite schema and migrations, safe local scan API, indexed aggregates, opt-in historical archive, watcher, SSE, source settings and export. `security-reviewer` separately audits source paths/localhost. `qa-engineer` runs integration fixtures.

**Exit:** user can run server on 127.0.0.1; initial consent gating works; scan real approved root if available; SQLite idempotence passes; history archive can be deleted without touching Claude files; endpoints emit trustworthy quality/coverage labels.

## Phase 3 - Core polished UI
`ui-engineer` builds shell, onboarding, Overview, Projects, Project Detail, Sessions, Agents and state handling against real typed DTOs. `api-engineer` handles interface discrepancies only in backend-owned files. `qa-engineer` runs browser flows. Opus checks screenshots against `design/references` without copying third-party art.

**Exit:** no mocked real metrics, project and agent drilldowns work, charts change with filters, empty states and mobile layout usable. Local app communicates via same-origin API.

## Phase 4 - Timeline, costs and reports
`ui-engineer` implements Timeline, Cost transparency, Report builder and Story Mode. `cost-engineer` reviews calculations/coverage. `qa-engineer` checks export and keyboard controls. `security-reviewer` verifies no raw prompts in export.

**Exit:** a user can create a credible narrative from actual selected local data, download sanitized reports and inspect why a priced value is an estimate.

## Phase 5 - Stabilization and accessibility
`qa-engineer` executes all unit/integration/E2E/perf tests, `security-reviewer` conducts privacy threat-model audit, `source-investigator` compares parser against supported schema variants, `ui-engineer` completes mobile/a11y fixes. Opus resolves conflicts and updates docs.

**Exit:** tests reproducible on clean Mac/CI, known caveats documented, no high severity security issue, performance numbers measured and screenshots captured.

## Phase 6 - Open-source GitHub release
`release-engineer` prepares clean bilingual docs, install/run steps, MIT/license attribution, screenshots (synthetic), CI, changelog, issues templates, release notes and security policy. Opus performs sensitive-content review and final gating. **Ask human approval before `git push`, GitHub repo creation, public release or package publication.**

**Exit:** v0.1 public alpha reproducible without Claude API key, documented installation, no personal logs bundled, no promises of account-wide cost access. Publish only with approval.

## Parallel waves and file ownership
- Wave A: ingestion `packages/core/src/parser,attribution`; pricing `packages/core/src/cost`; QA `packages/test-fixtures` (concurrent after interface agreed).
- Wave B: backend `apps/server`; frontend `apps/web` after contracts stabilize; security read-only audit.
- Wave C: frontend screens; QA E2E tests; release docs after stable build.
- Never two agents editing same file concurrently. Agents report commits, conflicts and test results. Worktrees are optional based on branch and repo readiness.

## Human decision points
- Before scanning actual `~/.claude` for testing: explicit consent and privacy instructions.
- Before internet dependency install if policy requires: normal package install approval.
- Before destructive purge of Orbit DB: user confirmation.
- Before GitHub publication: manual privacy/source review + affirmative human approval.

## Stop conditions
Any high severity security issue, log data corruption, transcript modification attempt, silent unpriced usage, double counting, fake functionality, nonlocal network bind, or actual/private usage accidentally committed blocks the next phase until fixed.
