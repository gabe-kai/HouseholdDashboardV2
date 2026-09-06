# Build Report - BRIEF P0-001 r1

**Brief revision implemented:** 1
**Engineering status:** IMPLEMENTED
**Branch:** `brief/p0-001-shared-morning-routine`
**Commits:** `63a5b08` — P0-001: implement shared Morning Routine evaluation build
**Pull request:** N/A (not opened)

## What changed

- Established a single-package TypeScript application with React/Vite client, Fastify JSON + WebSocket server, SQLite (`better-sqlite3`), Zod validation, Vitest, and Playwright.
- Delivered evaluation profile sessions, one Morning Routine definition with future-effective revisions, child Today optimistic checklist + IndexedDB outbox, parent observation/history, and household sync notifications.
- Added migrations, fictional seeds, root scripts matching `ARCHITECTURE.md`, Node 24 pin (`.nvmrc` + `engines`), and acceptance-oriented automated tests.

## Files changed

- `package.json`, `package-lock.json`, `.nvmrc`, `.env.example`, `.gitignore` — toolchain and ignore rules
- `src/domain/*` — completion, recurrence, household time, optimistic reconcile
- `src/shared/schemas.ts` — shared API/domain schemas
- `src/server/*` — Fastify app, SQLite store, migrations/seed scripts, sync hub
- `src/client/*` — evaluation UI, outbox, Today/Routine/History
- `db/migrations/001_initial.sql`, `db/seeds/README.md`
- `tests/integration/p0-001.test.ts`, `tests/e2e/*`
- `ARCHITECTURE.md` — repository truth + working commands updated from implementation evidence
- `reports/P0-001-r1-build-report.md` — this report
- Config: `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig*.json`, `eslint.config.js`

## Behavior delivered

- Evaluation-mode banner and fictional parent + two child profiles; opaque HttpOnly session cookie; actor/capabilities derived server-side.
- Parent can create one Morning Routine and schedule a revision effective no earlier than the next household-local day without rewriting existing occurrence snapshots.
- Applicable household dates materialize one occurrence per assigned child with snapshotted steps/obligations.
- Child checklist updates optimistically, queues durable IndexedDB mutations, retries idempotently, and shows pending/offline/rejected text semantics.
- Parent observes progress (API forbids parent execution); history by household date; WebSocket household change notifications with reconnect refresh.
- Loopback bind by default; LAN requires `EVAL_LAN_ACCESS=1`.

## Verification performed

- `npm ci` / `npm install` — PASS (lockfile produced; Node `v24.16.0`, npm `12.0.2`)
- `npm run db:seed` — PASS
- `npm run validate` (`lint` + `typecheck` + `npm test`) — PASS (11 unit/integration tests)
- `npm run build` — PASS
- `npm run test:e2e` / `npx playwright test` — PASS (8/8 Chromium + WebKit)
- `npm run start` smoke (`GET /api/v1/health` + `GET /` on port 8788) — PASS
- Acceptance mapping:
  1. Fresh setup/command contract — PASS (commands above)
  2. Routine definition + occurrence identity — PASS (integration)
  3. Obligation semantics — PASS (domain unit + integration)
  4. Immediate rapid interaction — PASS (e2e delayed mutations)
  5. Transient interruption + IndexedDB retry — PASS (e2e)
  6. Shared propagation + missed-event recovery — PASS (e2e dual context)
  7. Assignment/execution separation + idempotency + cross-child forbid — PASS (integration)
  8. Prospective edit + trustworthy history — PASS (integration)
  9. Household timezone / DST / midnight — PASS (domain + integration)
  10. Phone + accessible behavior Chromium/WebKit — PASS (e2e)
  11. Focused physical-device evidence — NOT RUN (no iOS/Android device available in this environment)

## Deviations from brief revision

- None material. Seed module lives at `src/server/seeds/evaluation.ts` with `db/seeds/README.md` documenting the Architecture map location.
- E2e routine bootstrap uses authenticated API setup for stability; UI routine editor remains implemented for manual evaluation.

## Discoveries for Architecture

- Validated stack pins: Node 24 line, `better-sqlite3@13.0.3` on Windows.
- Mutation test hook header `x-mutation-delay-ms` supports delayed-response browser tests without changing product semantics.
- `runtime/` is gitignored for local SQLite files.

## Known limitations

- Evaluation identity only; not production authentication.
- Physical-device LAN check not performed.
- Fully offline first-load / PWA / push not in scope (by brief).
- Default editor weekdays include all ISO weekdays so evaluation days always apply; parents can narrow them.

## Suggested follow-up

Optional. This is not approved scope.

- Product durable update to `PRODUCT.md`.
- Architecture technical acceptance of this Build Report against P0-001 r1.
- Coordinator: update `PROJECT_STATE.md` / project card after acceptance.
