# Tokens, pricing and uncertainty

## Truthful terminology
The default plan is **Claude Pro or Max via subscription**, not pay-as-you-go. Therefore:
- `Estimated API-equivalent usage value`: hypothetical model API rate applied to observed token usage.
- `Observed usage`: directly parsed usage counters.
- `Price coverage`: percentage of observed token usage/requests whose model and rate rules are known.
- `Not available`: actual Claude subscription invoice, exact remaining plan quota, unknown remote history.
Never name hypothetical API value `your bill`, `paid`, `charged`, `your subscription cost` or `money spent` without an explicit qualifier on **every** screen/export.

## Rate source and governance
Use Anthropic's official per-model pricing as the default reference. Model IDs can change; do not hard-code one global Opus/Sonnet rate for every generation. Keep versioned price entries with model identifier or anchored alias, rate source URL, effective date/time, last verified date and optional modifiers. Do not silently auto-download rates. Allow local user rate override; make all nonofficial overrides visually distinct.

Each rate record must support (USD per million tokens): `input`, `output`, `cache_read`, `cache_write_5m`, `cache_write_1h`. If additional classes (fast mode, data residency, long context, discounts, batch) cannot be determined confidently from local logs, surface `not modeled` and indicate estimated value may differ. Historical prices need effective intervals: recalculate with prices appropriate to observed event time; show which schedule was applied.

## Calculation
For a unique response `r`, where pricing class and model are supported:

```
estimatedUSD(r) = (
   input_tokens            * input_rate
 + output_tokens           * output_rate
 + cache_read_tokens       * cache_read_rate
 + cache_write_5m_tokens   * cache_write_5m_rate
 + cache_write_1h_tokens   * cache_write_1h_rate
 + cache_write_unsplit      * appropriate_disclosed_fallback_rate
) / 1_000_000
```

The `cache_creation_input_tokens` aggregate can equal the sum of the 5m/1h nested split. **Never charge both the aggregate and its split.** If split is partial/absent, retain a distinct `unsplit` amount and use an explicit documented fallback policy only if defensible; otherwise the price is incomplete. Unknown model or rate -> count known tokens but **exclude from monetary total**, with an `unpriced requests/tokens` indicator; never assume $0. Caches should be counted only once.

Other special cases: zero usage, negative/malformed values, duplicate snapshots, model changes across stream fragments, missing request ID, unsupported provider and rate schedule changes. Reject negative token counts, represent overflow safely, and use numeric precision suitable for financial display; store raw counters as integers and USD value as decimal integer micro-USD or decimal string, not cumulative floating-point rounding.

## Totals and percentages
Total estimated API-equivalent value is the sum of **priced unique responses**, with a clear coverage label. Percent-of-project uses the same priced subset when comparing estimated USD, and separately shows token share when coverage differs. Do not compare unlike bases. Exports must include `source_mode=local_claude_code`, `estimate_type=api_price_equivalent`, `rate_schedule_version`, `unknown_priced_requests` and `coverage_window`.

## Coverage and trust labels
For each metric, return one of `observed`, `derived`, `estimated`, `unknown`, with `reason` and optionally `source_span`. Examples:
- `observed`: input tokens in unique assistant usage.
- `derived`: daily sum from those observed responses.
- `estimated`: API equivalent USD, inferred session duration.
- `unknown`: actual Pro/Max subscription spend.

Render UI tooltip explanation. An estimate can be precise arithmetically and still not be an exact charge. Respect ISO/local timezone conversions and currency formatting; display USD not assumed TRY.

## Calculation acceptance fixtures
1. Two streaming snapshots for same message -> counted once, using most complete final usage.
2. Parent main and two subagent transcripts -> total equals sum of unique assistant requests from all three source streams, never main totals plus redundant nested aggregate.
3. Nested `cache_creation_input_tokens = 300` with `5m=100`, `1h=200` -> charge 100 + 200 only, not 600.
4. Unrecognized model -> tokens visible, price missing and coverage drops (never $0).
5. Price schedule change midmonth -> prior request priced against historical interval.
6. Project A and B share overlapping names -> events never merged incorrectly.
7. Archive replay -> identical totals before and after restart.

Source: https://platform.claude.com/docs/en/about-claude/pricing
