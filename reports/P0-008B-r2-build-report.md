# Build Report - BRIEF P0-008B r2

**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED; awaiting Architecture technical re-review after FIX REQUIRED  
**Branch:** `brief/p0-008b-household-backups-in-app-restore`  
**Baseline:** merged A at `405c5db` (PR #24); Architecture ACCEPT / PROCEED at `6dacc69`  
**Implementation commit:** `6545c5f` — `feat(P0-008B): household backup catalog and in-app restore`  
**Planning tip at review:** `b3b34b7` — Architecture FIX REQUIRED findings recorded  
**Working tree:** uncommitted FIX REQUIRED corrections on top of `6545c5f` / `b3b34b7` (Project Lead commits when accepted)  
**Pull request:** N/A (not opened by this Build Report)

## What changed (original `6545c5f`)

- **Control catalog:** additive control migration `001_household_backup_catalog.sql` via `control_schema_migrations`; catalog rows store opaque id, household identity/name, UTC time, optional label, schema manifest, format version, size, digest, relative path, source.
- **Backup service:** SQLite backup API (+ live runtime handle), integrity + FK checks before catalog publish; create/delete/legacy-register serialized with reset/restore via catalog lock (does not quiesce ordinary reads).
- **Optional backup:** Reset/restore accept `saveBackupBefore*` default **false**; verified snapshot runs inside the exclusive replacement before activation; receipts bind the choice.
- **Restore:** Verify catalog file/digest/schema/single-household; stage copy; migrate; scrub sessions/claims; revoke control setup tickets; activate with **fresh installation epoch**; SyncHub `closeAll("restore")`; typed `household_restore` result (`setupRequired: false`, `signInRequired: true`).
- **Kind-aware reconcile:** Pending restore never completes as reset/`setupRequired: true`.
- **UI:** Settings → Backups (create/list/delete/restore + optional pre-reset/pre-restore); Welcome owner unlock + restore; public Welcome without owner cookie lists nothing.
- **Ops/CI:** `docs/ops-deploy.md` supported range/layout; PB-59/60; `e2e-phone-008b` + Playwright 008b selection on owner-gated 008a servers.

## FIX REQUIRED corrections (uncommitted on this branch)

Closes findings in `reports/P0-008B-r2-architecture-review.md` without changing the r2 contract. C/D remain out of scope. No Railway/live database/deploy work.

1. **AT7 typed restore across activation crash window**
   - Persist progress (`restoredBackup`, `preOperationBackup`) via `recordLifecycleOperationProgress` before activation.
   - Same-epoch reconcile failure responses retain those fields (`activeDataUnchanged: true`) so retries can reuse them.
   - Session revoke / SyncHub close remain before the exclusive drain (preserves A AT10 in-flight revalidation).
   - Evidence: integration AT7 afterActivate crash recovers typed continuation/result; fault matrix for beforePrepare/beforeScrub/beforeActivate/beforeCleanup.

2. **AT2 optional-backup matrix**
   - Off→zero / on→one; delayed write across reset-with-backup; backup failure leaves household active then proceed-without; backup-success/activation-failure reports saved backup; same-digest retry reuses catalog entry (no duplicate) via `findFailedOperationByPayload` + `reusePreOperationBackup`.

3. **AT4 Settings restore e2e**
   - Playwright AT4: Original household backup → reset → Replacement household → Settings preview (both names) → restore → sign in as original manager.

4. **AT5 / AT9**
   - AT5: human session, setup invitation, and claimed display cookie all rejected after restore.
   - AT9: two display sessions + stale member mutate rejected after restore.

5. **AT6 through-017**
   - Disposable fixture `tests/helpers/through-017-backup-fixture.ts`; register → restore with migration; source bytes unchanged; bad digest rejected without epoch advance.

6. **AT7 / AT10 gates**
   - Extended restore fault matrix (above).
   - Exact `npm run validate:pr` and `npm run validate:rc` recorded under Verification.

## Files changed (high level)

- `src/server/installation-control.ts`, `backup-catalog.ts`, `lifecycle-runtime.ts`, `lifecycle-routes.ts`, `app.ts`, `sync-hub.ts`, `route-policy.ts`
- `src/shared/schemas.ts`
- `src/client/api.ts`, `HouseholdSettings.tsx`, `WelcomeSetup.tsx`, `App.tsx`, `DisplayApp.tsx`, `display-api.ts`
- `tests/integration/p0-008b.test.ts`, `tests/e2e/z-p0-008b-backup-restore.spec.ts`
- `tests/helpers/through-017-backup-fixture.ts` (new), `tests/helpers/p018-fixture.ts`
- `playwright.config.ts`, `package.json`, `.github/workflows/validate-pr.yml`
- `docs/ops-deploy.md`, `docs/protected-behaviors.md`, `ARCHITECTURE.md`

## Behavior delivered

Managers with `household.lifecycle.manage` manage a protected backup catalog and can restore from Settings. After reset, owner recovery at Welcome can restore a saved household and sign in with restored credentials. Optional pre-operation backup is off by default. Saved backups survive reset/restore. Offline `db:restore` still refuses when control exists. Activation-crash recovery reports truthful typed restore/backup metadata; failed same-digest retries do not duplicate optional backups.

## Acceptance test mapping (AT1–10)

| AT | Evidence | Result |
| --- | --- | --- |
| 1 Settings journey | Integration AT1 create/list/delete + unauthorized 401 | PASS |
| 2 Optional backup matrix | Integration AT2 off/on, write race, backup fail→proceed-without, activation-fail + non-duplicate replay | PASS |
| 3 Welcome restore | Integration AT3 + e2e AT3 backup→reset→restart→owner restore→signin | PASS |
| 4 Settings restore | e2e AT4 second-household preview + restore + original sign-in | PASS (see Verification e2e) |
| 5 Credential resurrection | Integration AT5 human/display/setup invitation after restore | PASS |
| 6 Compatibility | Control migration; legacy/corrupt; through-017 fixture restore + byte integrity | PASS |
| 7 Crash/concurrency | Kind-aware reconcile; afterActivate typed recovery; prepare/scrub/activate/cleanup fault matrix | PASS |
| 8 Recovery UX | Continuation cannot list backups (403); public list 401; Welcome owner path | PASS |
| 9 Stale clients | Integration AT9 dual-display + stale member write after restore; epoch fencing | PASS |
| 10 Gates/evaluation | Exact `validate:pr` / `validate:rc` below; CI `e2e-phone-008b` | PASS (local gates); hosted N/A |

## Verification performed

- `npx vitest run tests/integration/p0-008b.test.ts` — **14 passed**
- Exact `npm run validate:pr` — **PASS** (EXIT 0): lint/typecheck; **295** unit/integration tests; production build; Chromium e2e **104 passed** (~9.3m); Vite deeplink e2e **5 passed**
- Exact `npm run validate:rc` — **PASS** (EXIT 0): same validate+build; full Playwright e2e **163 passed** (~15.2m, includes webkit-008a P0-008B AT3/AT4); Vite deeplink e2e **5 passed**
- Live database / Railway / deploy — **NOT RUN** (not authorized)

## Deviations / known limitations

- Dual-display stale-client coverage is integration-level (two claimed display sessions + retired member write), not a separate multi-browser Playwright matrix.
- C/D remain out of scope.
- Hosted/Railway backup–reset–restore Product evaluation remains a separate release checkpoint.

## Discoveries for Architecture

- Standalone backup create must not take the full exclusive shared-drain barrier while the SPA holds ordinary shared reads (deadlock/hang). Catalog lock serializes with reset/restore without quiescing reads.
- Prefer SQLite `backup()` from the live runtime DB handle rather than opening a second connection to the active image under Windows e2e load.
- Same-epoch reconcile must retain typed progress (`preOperationBackup` / `restoredBackup`) when failing interrupted ops; otherwise activation-failure retries cannot bind receipts without duplicating catalog entries.
- Revoke/closeAll must stay before the exclusive shared drain so in-flight holders revalidate as 401 (A AT10). After backup/activation faults, managers re-authenticate via login; household data remains active for retry/proceed-without.
- Settings restore can run while an owner invite cookie is still present; dual CSRF must fall through to member CSRF, and catalog access should prefer the lifecycle manager when both cookies exist.

## Suggested follow-up

- Architecture technical re-review of this Build Report against FIX REQUIRED findings.
- Project Lead: commit corrections, PR/merge, hosted backup/reset/restore checkpoint when authorized.

## Suggested commit message

```
fix(P0-008B): close r2 FIX REQUIRED restore recovery and evidence

Persist typed restore/backup progress across the activation crash window,
reuse failed-op optional backups on same-digest retry, keep sessions until
activation, and complete AT2/4/5/6/7/9 evidence plus validate:pr/rc.
```
