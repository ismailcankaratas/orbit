# Orbit browser E2E + accessibility suite

Playwright (chromium) against the **production build**, with deterministic synthetic fixtures only
(`@orbit/test-fixtures` scenarios). It never reads `~/.claude`, makes no network calls and binds only to 127.0.0.1.

## Run

```bash
npm run build          # REQUIRED first: the suite serves apps/server/dist + apps/web/dist
npm run test:e2e       # = npx playwright test
npx playwright test e2e/a11y.spec.ts --project=mobile   # a single spec / project
npx playwright show-report                               # html report (playwright-report/)
```

Artifacts (gitignored): `playwright-report/`, `test-results/` (failure screenshots/traces) and
`test-results/screens/<project>-<route>.png` (one full-page screenshot per route per viewport).

## How it is wired (`playwright.config.ts`)

* The config creates a temp root (`ORBIT_E2E_ROOT`), **snapshots** the built `dist` folders into it (so a concurrent
  `npm run build` cannot break a running suite) and starts two real servers from the snapshot:
  * `:4450` main server, fresh `ORBIT_DATA_DIR`, mutated by `onboarding.spec.ts`, then used by all other specs;
  * `:4451` fresh server that never gets consent, used only to render/scan the onboarding screen.
* `global-setup.ts` writes the synthetic scenarios tree with `npx tsx packages/test-fixtures/src/cli.ts <tmp>/source --scenarios`.
  `global-teardown.ts` deletes the temp root.
* Projects: `onboarding` (desktop, runs first, stateful consent -> scan flow), `chromium` (1440x900) and `mobile` (390x844,
  isMobile + hasTouch). `security.spec.ts` runs on desktop only (HTTP-level, viewport independent). 1 worker, 0 retries.
* Locale `tr-TR`, timezone `Europe/Istanbul`. UI strings come from `apps/web/src/i18n/locales/tr.json` via `e2e/support/index.ts`
  (`t(key)`), never hard-coded. All data routes use a wide explicit range (`from=2020-01-01&to=2027-06-30`) because the
  synthetic scenarios span 2026-03..2026-11.

## Specs

| Spec | Covers |
| --- | --- |
| `onboarding.spec.ts` | no scan before consent (status/overview `not_scanned`); custom source = synthetic root -> scan -> Overview KPI equals `combinedExpected.uniqueRequests`/`sessions`, estimated-value label; demo switch shows the persistent "Demo - sentetik veri" badge, demo never contains real labels/numbers, switching back restores real |
| `navigation.spec.ts` | overview -> top project -> session; filters in URL kept across hops and browser back; session -> agent drawer -> "Kaynak oturumu goruntule" -> same session; Escape closes the drawer; no agent-control buttons; 404 page; unknown project id error state |
| `privacy-offline.spec.ts` | every request in a full walkthrough is to `http://127.0.0.1:4450`; DOM + API bodies contain no canaries/secrets/`/Users/demo`; `setOffline(true)` pass (no page errors, content or an error state); XSS (html-payloads project): no dialogs, no injected elements; CSV/JSON downloads clean, formula cells neutralized |
| `security.spec.ts` | cross-origin `Origin` on GET `/overview` `/events` `/status` `/projects` -> 403; `Sec-Fetch-Site: cross-site`; `Host: evil.com`; missing/wrong CSRF -> 403 (valid token positive control); mutations with foreign Origin; CORS preflight; no `access-control-allow-origin`; CSP/nosniff; path traversal |
| `a11y.spec.ts` | axe (wcag2a + wcag2aa) on onboarding, overview, projects, project detail, sessions, session detail, agents graph + list, agent drawer, timeline/costs/reports/story; skip link is first Tab stop and moves focus into `#main`; every Tab stop has a visible focus indicator (outline/box-shadow/graph ring); `prefers-reduced-motion` leaves no running animation on overview and story |
| `layout.spec.ts` | `documentElement.scrollWidth <= clientWidth` for every route at both viewports (reports the first overflowing elements); screenshots |
| `phase4.spec.ts` | timeline reachable; costs: unpriced model + coverage warning + label, "Fiyat tanimla" editor, add override changes total, delete restores it; reports: CSV/JSON download clean; story: Right/Left/End/Home/Escape, caveat on the money slide, drilldown links. Auto-skips when the Phase 4 strings are absent from `tr.json` |

## Known limits

* Scan of the synthetic tree finishes in milliseconds, so the transient onboarding progress bar cannot be observed reliably;
  the test asserts the end state (`filesDone === filesTotal`, totals).
* Chromium date inputs expose a native picker button as a tab stop that draws its own ring; the focus-visibility check skips
  that single stop. Safari/WebKit is not covered (chromium only).
* Specs share server state and are order dependent by design (onboarding first); do not run with `--workers>1`.
