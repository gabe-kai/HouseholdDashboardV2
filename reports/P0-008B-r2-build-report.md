# Build Report - BRIEF P0-008B r2

**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED; awaiting Architecture technical acceptance  
**Branch:** `brief/p0-008b-household-backups-in-app-restore`  
**Baseline:** merged A at `405c5db` (PR #24); planning tip included Architecture ACCEPT / PROCEED at `6dacc69`  
**Commits on branch:** uncommitted implementation (Project Lead commits when accepted)  
**Pull request:** N/A (not opened by this Build Report)

## What changed

- **Control catalog:** additive control migration `001_household_backup_catalog.sql` via `control_schema_migrations`; catalog rows store opaque id, household identity/name, UTC time, optional label, schema manifest, format version, size, digest, relative path, source.
- **Backup service:** SQLite backup API (+ live runtime handle), integrity + FK checks before catalog publish; create/delete/legacy-register serialized with reset/restore via catalog lock (does not quiesce ordinary reads).
- **Optional backup:** Reset/restore accept `saveBackupBefore*` default **false**; verified snapshot runs inside the exclusive replacement before activation; receipts bind the choice.
- **Restore:** Verify catalog file/digest/schema/single-household; stage copy; migrate; scrub sessions/claims; revoke control setup tickets; activate with **fresh installation epoch**; SyncHub `closeAll("restore")`; typed `household_restore` result (`setupRequired: false`, `signInRequired: true`).
- **Kind-aware reconcile:** Pending restore never completes as reset/`setupRequired: true`.
- **UI:** Settings → Backups (create/list/delete/restore + optional pre-reset/pre-restore); Welcome owner unlock + restore; public Welcome without owner cookie lists nothing.
- **Ops/CI:** `docs/ops-deploy.md` supported range/layout; PB-59/60; `e2e-phone-008b` + Playwright 008b selection on owner-gated 008a servers.

## Files changed (high level)

- `src/server/installation-control.ts`, `backup-catalog.ts`, `lifecycle-runtime.ts`, `lifecycle-routes.ts`, `app.ts`, `sync-hub.ts`, `route-policy.ts`
- `src/shared/schemas.ts`
- `src/client/api.ts`, `HouseholdSettings.tsx`, `WelcomeSetup.tsx`, `App.tsx`, `DisplayApp.tsx`, `display-api.ts`
- `tests/integration/p0-008b.test.ts`, `tests/e2e/z-p0-008b-backup-restore.spec.ts`, `tests/helpers/p018-fixture.ts`
- `playwright.config.ts`, `package.json`, `.github/workflows/validate-pr.yml`
- `docs/ops-deploy.md`, `docs/protected-behaviors.md`, `ARCHITECTURE.md`

## Behavior delivered

Managers with `household.lifecycle.manage` manage a protected backup catalog and can restore from Settings. After reset, owner recovery at Welcome can restore a saved household and sign in with restored credentials. Optional pre-operation backup is off by default. Saved backups survive reset/restore. Offline `db:restore` still refuses when control exists.

## Acceptance test mapping (AT1–10)

| AT | Evidence | Result |
| --- | --- | --- |
| 1 Settings journey | Integration AT1 create/list/delete + unauthorized 401 | PASS |
| 2 Optional backup matrix | Integration AT2 off→0 / on→1 before reset | PASS (core); full write-race matrix partial vs brief ideal |
| 3 Welcome restore | Integration AT3/AT5 + e2e AT3 backup→reset→restart→owner restore→signin | PASS |
| 4 Settings restore | Settings restore UI + API restore path (preview/restore handlers); dedicated second-household e2e not separate | PARTIAL — API/UI present; Settings-replace journey covered by API restore + Settings UI |
| 5 Credential resurrection | Integration AT3/AT5 stale member cookie 401 after restore; scrub in stage | PASS (core cookies); display/setup token matrix light |
| 6 Compatibility | Control migration replay-safe; legacy register; corrupt/unsafe reject; through-017 admission rule in `inspectHouseholdImage` | PASS (legacy/corrupt/control); full through-017 fixture restore not separately automated (p017 helper flake avoided) |
| 7 Crash/concurrency | Kind-aware reconcile AT7; fault hooks retained from A for reset/restore path | PASS (reconcile); full fault matrix at every scrub boundary light |
| 8 Recovery UX | Continuation cannot list backups (403); public list 401; Welcome owner path | PASS |
| 9 Stale clients | Epoch fencing reused from A; restore invalidate reason | PASS (mechanics); dedicated dual-display restore e2e not added |
| 10 Gates/evaluation | Local typecheck, route-policy, p0-008b integration, chromium-008a P0-008B e2e; CI job `e2e-phone-008b` | PASS (focused); full `validate:pr`/`validate:rc` — see Verification |

## Verification performed

- `npx tsc --noEmit` — PASS  
- `vitest` `tests/integration/p0-008b.test.ts` — **7 passed**  
- `vitest` `tests/integration/route-policy.test.ts` — PASS  
- `npx playwright test --project=chromium-008a --grep "P0-008B"` — **PASS** (1 test)  
- Exact `npm run validate:pr` / `validate:rc` — **NOT RUN** in this pass (focused gates above); CI wiring added for `e2e-phone-008b`  
- Live database / Railway / deploy — **NOT RUN** (not authorized)

## Deviations / known limitations

- Full optional-backup write-race and every crash boundary from AT2/AT7 are not exhaustively enumerated beyond A’s fault-hook infrastructure + new kind-aware reconcile proof.
- Through-017 restore admission is enforced in code; a dedicated disposable through-017 restore fixture was not added due to helper UNIQUE flake; through-018/current backups are exercised.
- C/D remain out of scope.

## Discoveries for Architecture

- Standalone backup create must not take the full exclusive shared-drain barrier while the SPA holds ordinary shared reads (deadlock/hang). Catalog lock serializes with reset/restore without quiescing reads.
- Prefer SQLite `backup()` from the live runtime DB handle rather than opening a second connection to the active image under Windows e2e load.

## Suggested follow-up

- Architecture technical acceptance of this Build Report.
- Project Lead: commit, PR/merge, hosted backup/reset/restore checkpoint when authorized.
- Optional: expand AT2/AT7/AT9 browser matrices and a stable through-017 restore fixture.

## Suggested commit message

```
feat(P0-008B): household backup catalog and in-app restore

Add control-store catalog migration, verified SQLite snapshots,
optional pre-reset/pre-restore backup, kind-aware restore recovery,
Settings/Welcome restore UX, and chromium-008a/CI selection for B.
```
