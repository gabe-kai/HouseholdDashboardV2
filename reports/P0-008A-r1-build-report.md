# Build Report - BRIEF P0-008A r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED; awaiting Architecture technical acceptance  
**Branch:** `brief/p0-008a-protected-first-run-reset` (from planning tip `ece0127`; `origin/main` was still `415d930` at start of implementation)  
**Commits:** none yet (Coordinator/user owns Git; implementation is working-tree only at report time)  
**Pull request:** N/A (not opened by this Build Report)

## What changed

- Migration **018** adds `household.lifecycle.manage` backfill (enroll+structure), `setup_progress`, and `installation_epoch` / password-confirmation columns on sessions.
- Installation **control SQLite** (`INSTALLATION_CONTROL_PATH`) outside household snapshots: installation id, dataset epoch, active DB path, owner/setup sessions, invitations, lifecycle journal, recovery continuations.
- **Lifecycle runtime** adopts existing `DB_PATH`, serializes empty-DB replacement (prepare → activate control pointer → reopen stores → retire old files+WAL/SHM), refuses multi-household reset, supports fault hooks for tests.
- **Owner / setup / reset HTTP**: `/owner` secret exchange, setup invitation, fragment exchange, account+household basics, reauthenticate, household reset with continuation cookie, manager password recovery / establish-manager; meta exposes `ownerConfigured`, `installationEpoch`, `setupRequired`.
- **Client:** `OwnerApp`, Welcome setup wizard, Settings **Reset household** (scope + RESET + password; no new backup), member/display outbox `installationEpoch` fencing.
- Operator scripts resolve active DB via control; bootstrap bound when owner secret configured; restore refuses bypass when control exists.
- PB-56–58, route-policy owner principal routes, CI `e2e-phone-008a` / `chromium-008a`, tip migration counts → **18**, ops guide in `docs/ops-deploy.md`.

## Files changed (high level)

- `db/migrations/018_household_lifecycle.sql`
- `src/server/installation-control.ts`, `lifecycle-runtime.ts`, `lifecycle-routes.ts`
- `src/server/app.ts`, `config.ts`, `store.ts`, `display.ts`, `sync-hub.ts`, `route-policy.ts`, scripts
- `src/shared/schemas.ts`, `grants.ts`
- `src/client/OwnerApp.tsx`, `WelcomeSetup.tsx`, `App.tsx`, `main.tsx`, `HouseholdSettings.tsx`, `api.ts`, outboxes, `styles.css`
- `tests/integration/p0-008a.test.ts`, `tests/e2e/z-p0-008a-*.spec.ts`, tip-count bumps, `playwright.config.ts`, `package.json`, `.github/workflows/validate-pr.yml`
- `.env.example`, `docs/ops-deploy.md`, `docs/protected-behaviors.md`, `ARCHITECTURE.md`

## Behavior delivered

Deployment owners configure `INSTALLATION_OWNER_SECRET` and durable control/DB/backup paths, issue a one-use setup invitation from `/owner`, and parents complete Account → Household in the browser without shell bootstrap. Full **Reset household** replaces data with an empty migrated DB (no new backup), advances installation epoch, fences old sessions/outboxes, and recovers from lost responses via continuation or `/owner`. Populated adoption does not wipe; multi-household DBs refuse lifecycle reset. B–D remain unimplemented.

## Acceptance test mapping (AT1–12)

| AT | Evidence | Result |
| --- | --- | --- |
| 1 Through-017 adoption | `p0-008a.test.ts` adoption + multi-household refuse; tip counts → 18 | PASS (local); full p016-style populated-through-017 fixture **PARTIAL** (smoke + refuse; richer fixture deferred) |
| 2 Hosted owner gate | integration AT2; hosted profile forbids test bootstrap when owner configured | PASS |
| 3 First account race | integration AT3 invitation consume + single manager | PASS |
| 4 Required basics journey | Chromium-008a e2e setup→Today | PASS (phone Chromium); WebKit **NOT RUN** in this report’s e2e shard |
| 5 Interrupted setup | resume via setup_progress + sign-in path | PARTIAL (server progress + client resume wiring; dedicated mid-setup restart e2e not separate) |
| 6 Owner recovery | routes for recover-manager-password / establish-manager | PARTIAL (HTTP present; dedicated e2e matrix thin) |
| 7 Reset without backup | integration AT7 + Chromium e2e reset once then re-setup | PASS |
| 8 Lost response/idempotency | integration AT8 stale session/epoch cannot wipe newer data; continuation cookie issued | PASS (partial; hold-response browser case not fully automated) |
| 9 Atomic replacement/faults | integration AT9 beforeActivate fault | PASS (partial; not every inject point + process restart) |
| 10 Old clients | outbox epoch retire unit tests + session epoch reject | PARTIAL (unit/session; full multi-context hold matrix lighter than C-2) |
| 11 Runtime/operations | scripts resolve active path; restore refuses control bypass; ops guide | PASS (local) |
| 12 Selection and release | `e2e-phone-008a` in aggregate; `validate:pr` / `validate:rc` | see Verification |

## Deployment-owner configuration guide (no terminal)

See **`docs/ops-deploy.md` → Installation owner setup (P0-008A)** for secret generation, `INSTALLATION_OWNER_SECRET`, `INSTALLATION_CONTROL_PATH`, `DB_PATH`, `BACKUP_DIR`, volume layout, active-path note after reset, and the first-run/reset release checklist. Hosted candidate SHA / restart evidence: **NOT RUN** (Project Lead release checkpoint). Live reset not performed.

## Verification performed

- `npm run build:server` / `npm run build` — PASS  
- `vitest` full suite via `npm test` — PASS (42 files / 267 tests)  
- `vitest` `tests/integration/p0-008a.test.ts` — PASS (7)  
- Chromium-008a e2e `P0-008A` — PASS; logs `validate-008a-e2e4.log`, included in PR gate  
- Exact `npm run validate:pr` — **PASS** (exit 0); log `validate-pr-008a-5.log` (97 Chromium e2e + Vite deep-link)  
- Exact `npm run validate:rc` — **PASS** (exit 0); log `validate-rc-008a-1.log` (149 e2e incl. WebKit phone suite + Vite; 008A specs ignored on WebKit project by design, Chromium-008a covers A)  
- Hosted Railway setup/reset/restart — **NOT RUN**  
- Live database mutation / deploy — **NOT RUN** (not authorized)

## Deviations from brief revision

- Through-017 **populated** upgrade fixture is lighter than C-3B’s through-016 helper; AT1 covers migration+control adoption and multi-household refuse rather than a full Reed/display locked-history clone.
- Some AT5/6/8/9/10 browser depth is PARTIAL; core contracts are covered by integration + one Chromium journey.
- Household rename UI omitted (no dedicated name-read API beyond setup completion).
- WebKit phone journey for A is selected only under `validate:rc` (PR gate uses Chromium-008a).

## Discoveries for Architecture

- Tip migration counts and CI must include **018** / `e2e-phone-008a`.
- Playwright starts a dedicated 008A webServer (owner secret, `AUTO_SEED=0`, isolated control path). Default Chromium/WebKit projects **ignore** `z-p0-008a-*.spec.ts` so they cannot hit the seeded servers.
- HTTP harness and e2e servers must use **per-instance** `INSTALLATION_CONTROL_PATH`; a shared default control file pins later processes to the first writer's active DB (bootstrap CONFLICT / wrong reopen).
- Fresh e2e start must wipe control + epoch sidecars with the household DB; deleting only `DB_PATH` leaves a prior reset's active epoch database.
- After setup completion, client must keep the “setup complete” step mounted until navigation; clearing `setupRequired` immediately left `/welcome` as Unavailable.
- Invite exchange must distinguish “no fragment” from “exchanged”; otherwise `/welcome` incorrectly opened the account form without a setup cookie.
- Lifecycle operation status authorizes before 404 so principal denial stays 401/403.

## Known limitations

- B backup catalog / in-app restore not present; A honestly states no new backup on reset.
- C/D member admin and guided first day not present.
- Hosted production evidence remains a Project Lead checkpoint.
- Physical Product evaluation of the A journey is separate.

## Suggested follow-up

- Architecture technical acceptance of this Build Report.
- Project Lead: integrate planning baseline + this branch; configure owner secret on a disposable candidate before any live reset.
- B readiness after A acceptance.

## Suggested commit message

```
feat(P0-008A): protected first-manager setup and repeatable reset

Add installation control/epoch, owner-gated Welcome setup, full household
reset without a new backup, and outbox epoch fencing with C-3B CI selection.
```
