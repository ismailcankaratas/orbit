# ADR-002: Concrete HTTP DTO contract v1

Status: Accepted (2026-10-15)

`packages/core/src/schemas/dto.ts` is the single source of truth for server responses and web consumption, refining docs/API_CONTRACTS.md:

- Money is `usdDecimal` (6-decimal string). Every money surface in UI/export carries the label "Estimated API-equivalent value (USD)" / "Tahmini API eşdeğeri değer (USD)".
- Added routes beyond API_CONTRACTS: `GET /api/v1/session` (CSRF token, same-origin only), `GET /api/v1/status`, `PUT /api/v1/projects/:id/alias` (Orbit-local alias, CSRF). Demo/real switching is `PATCH /api/v1/settings {activeDataset}`; the demo DB is generated from `@orbit/test-fixtures` `demoDataset()` into a separate SQLite file.
- `sourceRoot` is accepted only in a PATCH body, validated to be an existing directory, canonicalized and never echoed (only a `~`-redacted label).
- `DELETE /api/v1/archive` requires CSRF header and body `{ "confirm": "DELETE_ORBIT_DATA" }`.
- Insights are deterministic `kind + params` rendered by i18n templates on the client; no free-text generation.
- Export: allowlisted `EXPORT_COLUMNS`, aggregated per local date × project × model (never per-request ids), CSV formula neutralization, JSON wraps rows with `ExportMeta`.
