# Fully synthetic Claude Code-like source fixtures

These files contain invented IDs, a fake home path and dummy prompt strings. **No real Claude user data is included.** Their shape is illustrative of commonly observed log records and must be validated against supported Claude Code variants by the source-investigator agent.

Use `fixtures/synthetic-home/.claude/projects` as the test source folder. `malformed-example.jsonl` intentionally contains invalid JSON to test tolerance.

Expected normalized results for the synthetic-home sample:
- Main snapshots with `message.id=msg_demo_main_01` count **once**, selecting output 25, not 5+25.
- One sonnet child agent linked **exactly** to parent toolUseId `toolu_demo_child_01`.
- One unknown-priced model request, with observed input/output token counts but no invented $0 price.
- Three unique API requests total: main 1 + child 1 + unknown 1.
- Token sums: uncached input 23; output 43; cache reads 80; cache write 5m 52; cache write 1h 0.
- Prompt, output text, private task description are never stored in Orbit's normalized DB, public API response or exports.
- Coverage is limited to first and last observed timestamps, not a whole account's history.
