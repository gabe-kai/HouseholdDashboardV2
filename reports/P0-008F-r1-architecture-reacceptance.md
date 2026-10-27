# Architecture Re-acceptance — P0-008F r1

**Disposition:** ACCEPTED (technical; same r1)  
**Brief:** P0-008F r1 — Keep a household intact through deployment  
**Engineering status:** IMPLEMENTED  
**Implementation branch:** `brief/p0-008f-hosted-installation-continuity`  
**Baseline:** `main` at `bd05ad0` plus the corrected, uncommitted working-tree delta  
**Date:** 2026-10-26

## Review result

Architecture re-reviewed the corrected source, named integration cases, and updated Build Report. Both findings from the initial FIX REQUIRED review are closed. P0-008F r1 satisfies its local technical contract and is **ACCEPTED**.

This acceptance is based on Engineering's exact reported `validate:pr` and `validate:rc` runs; Architecture did not rerun them. AT13 remains **NOT RUN** and belongs to the Project Lead before any household rebuild. No Railway mutation, deployment, restore, or rebuild was performed or authorized by this acceptance.

## Findings closed

### Active database target validation

`assertInstallationControlReady()` now calls `assertActiveHouseholdTargetReady()` for an existing valid control store before runtime creation can reach writable `openDatabase()` or migration. The shared guard checks mount containment when configured and opens the active target read-only with `fileMustExist`, then runs SQLite `quick_check`. `resolveActiveHouseholdDbPath()` uses the same guard through `assertInstallationControlReady()`.

Named cases `AT-target-a`, `AT-target-b`, and `AT-target-c` cover missing, unreadable, and outside-mount targets. Each asserts both `createLifecycleRuntime()` and `resolveActiveHouseholdDbPath()` fail closed without creating a replacement, selecting the base DB, or changing candidate files. AT3 retains the fresh-install case, where a genuinely empty installation can initialize control and create its first database.

### Existing member session continuity

The Process A → Process B case now sends Process A's still-valid member cookie to `GET /api/v1/auth/session` and `GET /api/v1/people`. Both return 200, the membership ID matches, and its household ID matches Process A's household. New password login and the old display cookie remain independent checks.

## Evidence reviewed

- `reports/P0-008F-r1-build-report.md` — corrected AT4/AT5/AT7 map, exact final gates, and limitations.
- `src/server/installation-control.ts` — active-target read-only check, integrity check, and mount validation.
- `src/server/config.ts` — configured volume-mount boundary.
- `src/server/lifecycle-runtime.ts` — startup and operator path use of the shared control guard.
- `tests/integration/p0-008f.test.ts` — member-session reuse and AT-target-a/b/c preservation cases.
- `briefs/P0-008F-hosted-installation-continuity.md` — r1 contract and evidence matrix.

## Evidence limits and next checkpoint

- Process B is a second application runtime on shared absolute volume paths, not an OS-level container replacement. The Build Report states this accurately; this is sufficient for the local active-path/control continuity checks in this brief.
- `validate:pr`: PASS, 365 Vitest / 135 Chromium / 6 Vite. `validate:rc`: PASS, 365 Vitest / 207 Playwright / 6 Vite. These are reported Engineering results, not independently rerun by Architecture.
- AT13 remains for the Project Lead: verify `DB_PATH=/data/household.sqlite`, `BACKUP_DIR=/data/backups`, `INSTALLATION_CONTROL_PATH=/data/installation-control.sqlite`, and the non-secret startup diagnostic before any household rebuild.
- The last Project Lead-reported Railway shell showed the current control store at `/app/runtime/installation-control.sqlite`, while the household DB and backups are under `/data`; the control path was not yet configured as persistent. Before any deployment that replaces this container, the Project Lead must first preserve/relocate that current control store to `/data/installation-control.sqlite` and verify it. Do not trigger an automatic deployment by merging before this transition is ready. The current deployed image may not contain the new `db:relocate-control` command, so verify the exact safe way to run the SQLite backup-based copy in the still-running environment before relying on that command. Architecture has not performed this operation.
- The original `reports/P0-008F-r1-architecture-acceptance.md` records the initial FIX REQUIRED findings and is retained as the review history.

## Safety boundary

No live Railway database was read or changed during this re-review. Do not restore older snapshots or rebuild the household before the Project Lead completes AT13. This local technical acceptance does not itself authorize a Railway deployment or live-data operation.
