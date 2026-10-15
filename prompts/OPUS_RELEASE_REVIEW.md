# Final alpha release audit (paste into Opus main session)

Run a skeptical final readiness audit of Orbit against all P0 PRD requirements, architecture, ingestion, costs, privacy, UI, E2E and GitHub release docs. Delegate independent Sonnet code review, security review and QA run. Verify repo is clean of real transcripts, credentials, home paths, user names, secrets and unwanted telemetry. Prove localhost-only binding and offline runtime. Verify ambiguous token caching cannot double count and unpriced usage isn't misreported as zero. Validate screens against design references using actual working app and synthetic fixtures, including 1440x900 and 390x844. Run the full verification suite and record exact observed results.

Create `reports/RELEASE_REVIEW.md` with a release checklist marked PASS / FAIL / NOT RUN, reproducible evidence and blockers. Prepare publish commands but **do not execute a remote push, create a public repository or publish a release until I explicitly approve**.
