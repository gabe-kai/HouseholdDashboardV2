# Architecture Acceptance Review — P0-008F r1

**Disposition:** FIX REQUIRED (same revision)  
**Brief:** P0-008F r1 — Keep a household intact through deployment  
**Engineering status:** IMPLEMENTED; exact PR/RC gates reported PASS  
**Implementation branch:** `brief/p0-008f-hosted-installation-continuity`  
**Implementation base:** `bd05ad0` plus the reported uncommitted working-tree delta  
**Date:** 2026-10-26

## Review result

Architecture reviewed the P0-008F Build Report and inspected the active-control and database-open paths. The reported gates and completed cases do not establish the full fail-closed contract. Two corrections are required before technical acceptance. No Railway operation, deployment, restore, or household rebuild is authorized by this review.

## FIX REQUIRED findings

### 1. A valid control pointer can silently create an empty database

In `src/server/installation-control.ts`, `assertInstallationControlReady()` returns immediately when `inspectInstallationControl()` reports a structurally valid store. It does not verify that the pointer's target exists, is readable, or remains inside the configured volume mount.

`createLifecycleRuntime()` then resolves the pointer and calls `openDatabase()` in `src/server/db.ts`. `openDatabase()` uses `new Database(dbPath)` without `fileMustExist`, enables WAL, and is followed by migrations. If a previously valid control store points to a missing active household file, startup can create and migrate a new empty database at that path. This recreates the destructive failure mode P0-008F is intended to prevent.

`resolveActiveHouseholdDbPath()` shares the control inspection but returns the pointer without validating its target. Operator commands that subsequently call `openDatabase()` can create the same replacement. The mount validation currently covers configured `DB_PATH`, `BACKUP_DIR`, and control path; it must also cover the resolved active pointer.

**Required correction:** Before any writable open or migration, verify the active target for an existing valid installation using a read-only, file-must-exist open and the required integrity/readability checks. Reject a missing or unreadable target, and reject a resolved target outside the configured mount boundary. Apply the same guard to server startup and operator active-path resolution. On failure, do not create a DB, fall back to `DB_PATH`, adopt another file, migrate, or clean up; prove candidate names and hashes are unchanged. Preserve the intentional fresh-install path: only when no installation evidence exists and this startup is initializing new control state may it create the first configured household DB.

**Required named evidence:** Add integration cases for a structurally valid control store that points to (a) a missing target, (b) an unreadable/invalid target, and (c) an existing target outside the configured mount. Exercise both `createLifecycleRuntime()` and `resolveActiveHouseholdDbPath()` (or the operator command boundary). Assert no replacement file/sidecars, migration, fallback, candidate deletion, or hash/name change. Retain the fresh-install AT3 success case.

### 2. AT4 does not prove existing member-session continuity

`tests/integration/p0-008f.test.ts` creates a member session in Process A. After Process B starts, the test verifies a new password login and uses the pre-existing display cookie, but never sends the pre-replacement member session cookie to Process B. The brief explicitly requires both existing member sessions and display credentials to remain valid subject to normal expiry/revocation rules.

**Required correction:** In the existing Process A → Process B case, send an authorized member request with Process A's still-unexpired session cookie and the corresponding CSRF/origin data where required. Assert the request is accepted and resolves to the same household/member. Keep the separate new-password-login and display-cookie assertions. Do not mark this assertion PASS solely because password authentication succeeds.

## Re-review requirements

- Keep the contract at P0-008F r1; these findings clarify existing continuity and fail-closed requirements.
- Update the evidence matrix and Build Report so the active-target failure cases and old member-cookie reuse are independently mapped. Do not claim all AT1–AT13 accepted until those assertions pass.
- Rerun exact `npm run validate:pr` and `npm run validate:rc` on the corrected final tree and pin the tested source state in the Build Report.
- Keep the Process B limitation explicit: current evidence is a second application runtime using absolute volume paths, not an OS-level container replacement.
- AT13 remains the Project Lead's Railway path/configuration checkpoint after local technical acceptance.

## Evidence inspected

- `reports/P0-008F-r1-build-report.md` — reported AT1–AT13 evidence and final PR/RC runs.
- `src/server/installation-control.ts` — valid-control fast return and active pointer inspection.
- `src/server/lifecycle-runtime.ts` — `createLifecycleRuntime()` and `resolveActiveHouseholdDbPath()`.
- `src/server/db.ts` — writable `openDatabase()` creates absent database files and enables WAL.
- `tests/integration/p0-008f.test.ts` — Process A/Process B continuity test and missing/invalid-control cases.
- `briefs/P0-008F-hosted-installation-continuity.md` — r1 continuity and fail-closed contract.

## Safety boundary

No live Railway database was read or changed during this acceptance review. Do not restore older snapshots, deploy, or rebuild the household under P0-008F until Architecture accepts the corrected local implementation and the Project Lead completes AT13.

## Review history

This was the initial FIX REQUIRED review. Its findings were closed on the same r1 and the implementation was technically accepted in `reports/P0-008F-r1-architecture-reacceptance.md` on 2026-10-26. This report is retained as the original finding record.
