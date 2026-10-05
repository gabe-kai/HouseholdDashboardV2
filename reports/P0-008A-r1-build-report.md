# Build Report - BRIEF P0-008A r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (FIX REQUIRED closed); awaiting Architecture re-review  
**Branch:** `brief/p0-008a-protected-first-run-reset`  
**Baseline:** planning tip `ece0127`; `main` / `origin/main` inspected at `415d930` when A began  
**Commits on branch (implementation + review):**
- `3448d7d` — feat(P0-008A): protected first-manager setup and repeatable reset  
- `9133936` — P0-008A: record r1 Architecture FIX REQUIRED findings  
- *(pending)* correction commit for Architecture FIX REQUIRED items 1–8 (working tree; not committed by Engineering)  
**Pull request:** N/A (not opened by this Build Report)  
**Architecture review addressed:** `reports/P0-008A-r1-architecture-review.md`

## What changed (initial + FIX REQUIRED)

- Migration **018** adds `household.lifecycle.manage` backfill, `setup_progress`, and `installation_epoch` / password-confirmation on sessions.
- Installation **control SQLite** outside household snapshots: installation id, dataset epoch, active DB path, owner/setup sessions, invitations, lifecycle journal, recovery continuations.
- **Lifecycle runtime barrier:** ordinary `/api/v1` requests take a shared barrier; replacement takes exclusive. Durable activate → reopen + `onRuntimeSwapped` (app `store`/`db` refs) before later faults. Startup/`reconcilePendingOperations` finishes pending ops after restart and cleans orphan epoch files.
- **Continuation-only recovery:** `GET /api/v1/lifecycle/operations/:id` and `GET /api/v1/lifecycle/recovery` authorize via recovery-continuation cookie **without** a member session (owner also allowed). Client recovers lost reset responses and boot-time Welcome.
- **First-manager race:** uniqueness rechecked inside the write transaction after passphrase hash await.
- Owner / Welcome / reset UI, outbox epoch fencing, PB-56–58, tip counts → **18**, ops guide unchanged in intent.
- CI: `chromium-008a`, `chromium-008a-desktop`, `webkit-008a` (RC); plain Chromium/WebKit ignore A specs.

## Files changed (high level)

- `db/migrations/018_household_lifecycle.sql`
- `src/server/installation-control.ts`, `lifecycle-runtime.ts`, `lifecycle-routes.ts`, `app.ts`, `store.ts`, `route-policy.ts`, …
- `src/client/OwnerApp.tsx`, `WelcomeSetup.tsx`, `App.tsx`, `HouseholdSettings.tsx`, `api.ts`, outboxes
- `tests/helpers/p017-fixture.ts`, `tests/integration/p0-008a.test.ts`, `tests/e2e/z-p0-008a-*.spec.ts`, `playwright.config.ts`, `package.json`
- Docs: `.env.example`, `docs/ops-deploy.md`, `docs/protected-behaviors.md`, `ARCHITECTURE.md`, `PROJECT_STATE.md`

## Behavior delivered

Deployment owners configure `INSTALLATION_OWNER_SECRET` and durable paths, issue a one-use setup invitation from `/owner`, and parents complete Account → Household without shell bootstrap. Full **Reset household** replaces data with an empty migrated DB (no new backup), advances installation epoch, fences old clients, and recovers a lost response via continuation cookie or `/owner`. Runtime replacement stays coherent under concurrent ordinary traffic and after restart. B–D remain unimplemented.

## Acceptance test mapping (AT1–12)

| AT | Evidence | Result |
| --- | --- | --- |
| 1 Through-017 adoption | `tests/helpers/p017-fixture.ts` + AT1 populated upgrade/idempotent migrate + backup byte check; multi-household refuse | PASS |
| 2 Hosted owner gate | Missing secret, wrong secret → 429, origin, bootstrap deny, mixed principals, invite replay/replace | PASS |
| 3 First account race | Two invitations/sessions `Promise.all` → one 200 + one 409; one manager | PASS |
| 4 Required basics journey | `chromium-008a`, `chromium-008a-desktop`, `webkit-008a` e2e Account→Household→Today | PASS (gates) |
| 5 Interrupted setup | E2E AT5: restart after account save; resume via other-context login; finish household | PASS |
| 6 Owner recovery | Secret rotation; sole-manager password recovery; establish-manager retains household data | PASS |
| 7 Reset without backup | Integration two resets + seeded backup hash unchanged + no new BACKUP_DIR files; e2e two resets | PASS |
| 8 Lost response/idempotency | Continuation-only ops/recovery; wrong id 403; stale replay cannot wipe newer data; e2e welcome reload | PASS |
| 9 Atomic replacement/faults | beforePrepare / beforeActivate / afterActivate / afterReopen / beforeCleanup + app reopen reconcile; concurrent meta barrier | PASS |
| 10 Old clients | Old member/display sessions + stale-epoch mutation → 401 after reset/rebuild; outbox epoch unit tests | PASS |
| 11 Runtime/operations | Active-path scripts; restore refuses control bypass; ops guide | PASS (local) |
| 12 Selection and release | PR/RC selection includes A Chromium (+ desktop); WebKit-008a in full e2e/RC | see Verification |

## Architecture FIX REQUIRED closure

| # | Finding | Closure |
| --- | --- | --- |
| 1 | Runtime coherent during reset / restart recovery | Shared+exclusive barrier; activate→reopen+ref swap before later faults; `reconcilePendingOperations` on startup and status reads |
| 2 | Continuation independently recovers operation | Continuation alone authorizes ops/:id and `/lifecycle/recovery`; client lost-response + boot recovery |
| 3 | Populated through-017 fixture | `p017-fixture` + AT1 identity/grant/data/backup proofs |
| 4 | Real first-account race | Concurrent dual setup accounts |
| 5 | Owner gate and recovery matrix | Named AT2/AT6 cases above |
| 6 | Browser journeys + restart | WebKit-008a + desktop-008a; AT5 restart e2e; AT7 two resets |
| 7 | Old-client matrix | AT10 integration after reset/rebuild |
| 8 | Build Report commit metadata | This report pins `3448d7d` / `9133936` and notes pending correction commit |

## Deployment-owner configuration guide (no terminal)

See **`docs/ops-deploy.md` → Installation owner setup (P0-008A)**. Hosted candidate SHA / restart evidence: **NOT RUN** (Project Lead release checkpoint). Live reset not performed.

## Verification performed

- `npm run typecheck` — PASS (during FIX REQUIRED)  
- `vitest` `tests/integration/p0-008a.test.ts` — PASS (20)  
- `vitest` denial-matrix regression — PASS  
- Focused Chromium-008a + desktop-008a e2e — PASS (6); log `validate-008a-e2e-fix5.log`  
- Exact `npm run validate:pr` — **PASS** (exit 0); log `validate-pr-008a-fix4.log` (280 vitest + 101 Chromium e2e + Vite)  
- Exact `npm run validate:rc` — **PASS** (exit 0); log `validate-rc-008a-fix.log` (includes `webkit-008a`)  
- Hosted Railway setup/reset/restart — **NOT RUN**  
- Live database mutation / deploy — **NOT RUN** (not authorized)

## Deviations from brief revision

- Household rename UI still omitted (no dedicated post-setup name-read API beyond setup completion).
- AT10 proves server rejection of stale member/display sessions and stale-epoch mutations after reset/rebuild; it does not replay the full C-2 multi-context held-read browser matrix.

## Discoveries for Architecture

- Exclusive replacement must not also hold the shared request barrier (deadlock on `/household/reset`).
- After durable activation, reopen + app ref swap must precede `afterActivate`/`afterReopen` faults so a live process never serves old handles against the new control pointer.
- Continuation must not require a still-valid member session; reset revokes those sessions before replacement.

## Known limitations

- B backup catalog / in-app restore not present; A honestly states no new backup on reset.
- C/D member admin and guided first day not present.
- Hosted production evidence remains a Project Lead checkpoint.

## Suggested follow-up

- Architecture re-review / technical acceptance of this updated Build Report.
- Project Lead owns commit of the FIX REQUIRED correction, PR/merge, and any hosted evaluation.
- B readiness after A acceptance.

## Suggested commit message

```
fix(P0-008A): lifecycle barrier, continuation recovery, acceptance gaps

Quiesce writers during reset, swap runtime refs on activate, reconcile
pending ops after restart, authorize continuation-only operation recovery,
and close AT1–10 evidence called out in Architecture FIX REQUIRED.
```
