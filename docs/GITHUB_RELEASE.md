# GitHub public release and community handoff

## Public repository positioning
Recommended working name: `orbit-claude-dashboard` or `orbit-local-analytics`; final brand/trademark must be checked before public marketing. Description: "Local-first Claude Code usage, projects and subagent observability. Private by design. Beautiful by default." Avoid implying Anthropic endorsement or an official billing integration.

## MIT open source
Use `LICENSE` in root. Add appropriate license notices for all imported JS packages and art sources. Mockups are illustrations of Orbit concepts, not proof of working app. Release under MIT or a carefully reviewed alternative; do not copy Avenox assets or design source.

## README checklist
- 1 screen hero/screenshot (sanitized synthetic demo data) and optional 30s GIF.
- Feature matrix, examples of local data attribution and pricing/retention limitations.
- Who the app supports, minimum Node version, OS support tested, install/run in <=5 commands.
- Privacy model: storage locations, exact files read, network behavior, local data purge.
- Explain Pro/Max API-price-equivalent estimates vs actual bills.
- FAQ on missing history, unknown models, orphan agents, how to disable archive, and performance.
- Usage licenses, contributor guide, security reporting, changelog and issue templates.
- Source-of-truth official docs and date verified; disclaim changing private JSONL schema.
- No public logs, tokens, personal screenshots, names, API credentials or absolute home paths.

## Public release gates
- CI: typecheck, lint, unit, integration, E2E smoke, build on supported platform(s).
- Install from fresh checkout successful; production starts on loopback, no developer webpack/Vite hot path required.
- Mobile/tablet/desktop screenshots from running app using fixtures; tests include offline runtime test.
- Security review complete, `npm audit` findings triaged, packages license checked.
- `.gitignore` ignores `.env*` except `.env.example`, SQLite DB, archives, `~/.claude` mirrors, transcripts, private screenshots, logs, builds and `node_modules/`.
- Git history and staged files searched for tokens, sample real transcript text, machine path. Use secret scanning before first push.
- Release notes openly state unsupported sources, exact costs unavailable, retention caveats, safe telemetry promise.

## Versioning
- `v0.1.0-alpha`: read-only core + Overview + Projects + Sessions + Agents + local privacy.
- `v0.2.0-alpha`: timeline, reports and archive improvements.
- `v1.0.0`: accessibility, stable installer path, robust multi-version parser tests and documentation.

## Community operations
- Good first issues: locale strings, theme accessibility, export formats, parser fixtures for new schema variants.
- Bug template should request sanitized fixture and app version; explicitly warn **do not attach raw Claude logs**.
- SECURITY.md requires private vulnerability report channel (create with appropriate GitHub security settings when repo exists).
- No automatic uploading of usage data for support. Provide a `Generate sanitized diagnostics` function that can be inspected before sharing.

## Never do automatically
Do not publish to GitHub, create external repos, set public visibility or push to remote without a direct human approval in the current Claude session.
