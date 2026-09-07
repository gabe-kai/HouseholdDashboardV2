# Build Report - BRIEF P0-001 r1

**Brief revision implemented:** 1
**Engineering status:** IMPLEMENTED (FIX REQUIRED resolved)
**Branch:** `brief/p0-001-shared-morning-routine`
**Commits:** see branch tip after this fix commit
**Pull request:** N/A (not opened)

## What changed

- Established a single-package TypeScript application with React/Vite client, Fastify JSON + WebSocket server, SQLite (`better-sqlite3`), Zod validation, Vitest, and Playwright.
- Delivered evaluation profile sessions, one Morning Routine definition with future-effective revisions, child Today optimistic checklist + IndexedDB outbox, parent observation/history, and household sync notifications.
- Added migrations, fictional seeds, root scripts matching `ARCHITECTURE.md`, Node 24 pin (`.nvmrc` + `engines`), and acceptance-oriented automated tests.
- **FIX REQUIRED follow-up:** Made the Playwright suite self-bootstrapping and reproducible. `npm run test:e2e` now installs Chromium + WebKit for the lockfile’s `@playwright/test` revision before running; e2e webServer no longer reuses a stale process; e2e server handles SIGTERM/SIGINT; optimistic-interaction timing assertion tolerates WebKit overhead.

## Files changed

- `package.json`, `package-lock.json`, `.nvmrc`, `.env.example`, `.gitignore` — toolchain and ignore rules
- `src/domain/*` — completion, recurrence, household time, optimistic reconcile
- `src/shared/schemas.ts` — shared API/domain schemas
- `src/server/*` — Fastify app, SQLite store, migrations/seed scripts, sync hub
- `src/client/*` — evaluation UI, outbox, Today/Routine/History
- `db/migrations/001_initial.sql`, `db/seeds/README.md`
- `tests/integration/p0-001.test.ts`, `tests/e2e/*`
- `ARCHITECTURE.md` — repository truth + working commands (including Playwright browser install note)
- `playwright.config.ts` — dedicated webServer, health URL, global timeout, list reporter
- `reports/P0-001-r1-build-report.md` — this report

## Behavior delivered

- Evaluation-mode banner and fictional parent + two child profiles; opaque HttpOnly session cookie; actor/capabilities derived server-side.
- Parent can create one Morning Routine and schedule a revision effective no earlier than the next household-local day without rewriting existing occurrence snapshots.
- Applicable household dates materialize one occurrence per assigned child with snapshotted steps/obligations.
- Child checklist updates optimistically, queues durable IndexedDB mutations, retries idempotently, and shows pending/offline/rejected text semantics.
- Parent observes progress (API forbids parent execution); history by household date; WebSocket household change notifications with reconnect refresh.
- Loopback bind by default; LAN requires `EVAL_LAN_ACCESS=1`.

## Verification performed

Environment for this FIX REQUIRED verification: Windows, Node.js `v24.16.0`, npm `12.0.2`, `@playwright/test@1.63.0`. Browsers installed under `%LOCALAPPDATA%\ms-playwright` as Chromium build `1243` and WebKit build `2359` (confirmed via `npx playwright install --list` for this project’s `playwright-core`).

- `npm run validate` (`lint` + `typecheck` + `npm test`) — PASS (previously accepted; not re-blocked)
- `npm run build` — PASS (invoked by e2e webServer)
- `npm run test:e2e` — PASS — **8/8** (4 Chromium + 4 WebKit); process exited `0`
- `npm run test:e2e:chromium` — available; Chromium subset covered by full suite above
- Acceptance mapping:
  1. Fresh setup/command contract — PASS
  2. Routine definition + occurrence identity — PASS (integration)
  3. Obligation semantics — PASS (domain unit + integration)
  4. Immediate rapid interaction — PASS (e2e delayed mutations; pending visible after optimistic updates)
  5. Transient interruption + IndexedDB retry — PASS (e2e)
  6. Shared propagation + missed-event recovery — PASS (e2e dual context)
  7. Assignment/execution separation + idempotency + cross-child forbid — PASS (integration)
  8. Prospective edit + trustworthy history — PASS (integration)
  9. Household timezone / DST / midnight — PASS (domain + integration)
  10. Phone + accessible behavior Chromium/WebKit — PASS (e2e)
  11. Focused physical-device evidence — NOT RUN (no iOS/Android device available)

### Root cause of Architecture’s FIX REQUIRED evidence

Architecture observed all tests marked `x` within milliseconds and a non-exiting runner. That matches a **missing / version-mismatched Playwright browser binary** problem, not an application regression:

1. Browser binaries are **not** installed by `npm ci`. The original report ran `npx playwright install` only in the Engineering agent session (often into a Cursor sandbox `PLAYWRIGHT_BROWSERS_PATH`), so a clean Architecture checkout could have Chromium for an older Playwright revision and **no WebKit** for lockfile Playwright `1.63.0`.
2. Launching without the matching Chromium/WebKit builds fails immediately (tests marked failed/`x`) and previously could leave the webServer teardown looking hung when a stale server was reused (`reuseExistingServer: !CI`).

Mitigation now in-repo: `npm run test:e2e` runs `playwright install chromium webkit` first; config forces a fresh e2e server and waits on `/api/v1/health`; start-server exits on SIGTERM/SIGINT.

## Deviations from brief revision

- None material. Seed module lives at `src/server/seeds/evaluation.ts` with `db/seeds/README.md` documenting the Architecture map location.
- E2e routine bootstrap uses authenticated API setup for stability; UI routine editor remains implemented for manual evaluation.

## Discoveries for Architecture

- Validated stack pins: Node 24 line, `better-sqlite3@13.0.3` on Windows, Playwright `1.63.0` with Chromium `1243` + WebKit `2359`.
- Playwright browsers must be installed per machine/version; document and automate via `npm run test:e2e`.
- Mutation test hook header `x-mutation-delay-ms` supports delayed-response browser tests without changing product semantics.
- `runtime/` is gitignored for local SQLite files.

## Known limitations

- Evaluation identity only; not production authentication.
- Physical-device LAN check not performed.
- Fully offline first-load / PWA / push not in scope (by brief).
- Default editor weekdays include all ISO weekdays so evaluation days always apply; parents can narrow them.

## Suggested follow-up

Optional. This is not approved scope.

- Architecture re-acceptance of this updated Build Report against P0-001 r1 after `npm run test:e2e` on their checkout.
- Product durable update to `PRODUCT.md`.
- Coordinator: update `PROJECT_STATE.md` / project card after acceptance.
