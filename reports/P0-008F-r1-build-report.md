# Build Report - BRIEF P0-008F r1 (hosted installation continuity)

**Acting as:** Engineering  
**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED — FIX REQUIRED correction; awaiting Architecture re-review  
**Branch:** `brief/p0-008f-hosted-installation-continuity`  
**Baseline:** `main` at `bd05ad0`  
**Tested source state at handoff:** `bd05ad0` plus uncommitted working-tree delta on that branch (no Engineering commit)  
**Pull request:** not opened  
**Authorization:** Architecture FIX REQUIRED, same revision. No Railway mutation, snapshot restore, deploy, merge, or household rebuild.

Architecture findings: `reports/P0-008F-r1-architecture-acceptance.md`.

## FIX REQUIRED correction

1. **Active-target check.** `assertInstallationControlReady()` no longer returns a structurally valid control store without inspecting its active household pointer. For an existing installation it resolves the pointer, rejects a path outside `RAILWAY_VOLUME_MOUNT_PATH` when that mount is configured, and opens the target read-only with `fileMustExist` plus `quick_check`. Missing, unreadable, or outside-mount targets fail closed before `createLifecycleRuntime()` or operator `resolveActiveHouseholdDbPath()` can call writable `openDatabase()` / migrate. No fallback to `DB_PATH`, no other candidate selected, no cleanup. A genuine empty installation (control missing and no household/epoch/backup evidence) may still initialize control and create the first configured database.

2. **AT4 member session.** Process B now receives Process A's still-valid member session cookie. `GET /api/v1/auth/session` returns 200 with the same membership id; `GET /api/v1/people` is accepted and that membership belongs to the same household. New password login and the pre-existing display cookie remain separate assertions.

Process B remains a second in-process Fastify/lifecycle runtime on shared absolute volume paths, not an OS-level container replacement.

## What changed

Hosted startup requires an explicit absolute `INSTALLATION_CONTROL_PATH` and, when `RAILWAY_VOLUME_MOUNT_PATH` is set, rejects configured `DB_PATH` / `BACKUP_DIR` / control paths outside that mount. The same mount boundary now also covers the resolved active pointer. Startup and operator scripts inspect control read-only and fail closed if it is missing or invalid while evidence exists, or if a valid control names a missing/unreadable/out-of-volume active database.

Directory-wide epoch orphan cleanup is gone. Completed reset/restore records name `supersededDbPath`. `npm run db:relocate-control` copies control with SQLite `backup()`.

## Files changed (correction delta)

- `src/server/config.ts` — persist `volumeMountPath` on `AppConfig`
- `src/server/installation-control.ts` — `assertActiveHouseholdTargetReady` before writable open
- `tests/integration/p0-008f.test.ts` — AT4 member-cookie reuse; AT-target-a/b/c
- `docs/ops-deploy.md`, `docs/protected-behaviors.md` (PB-65), `ARCHITECTURE.md`
- Brief matrix and this report

Prior r1 files (control path, journal-named cleanup, relocate, harness wipes) remain.

## Acceptance evidence matrix

Matrix IDs follow the brief table as remapped in the Architecture acceptance review.

| ID / assertion | Exact evidence (named test / checkpoint) | Result |
| --- | --- | --- |
| AT1 Hosted absolute control path; local default | `tests/integration/p0-008f.test.ts` → `AT1 hosted config requires an explicit absolute control path; local default remains` | **PASS** |
| AT2 Volume-mount containment of configured paths | Same file → `AT2 volume-mount paths inside the mount pass; a path outside fails without writes` | **PASS** |
| AT3 Empty volume initializes control first | Same file → `AT3 empty volume initializes control first, epoch 1, and leaves setup available` | **PASS** |
| AT4 Process B reopens the household; **existing member session reused** | Same file → `AT4/AT6/AT10 process B on a fresh app runtime keeps household, auth, catalog; missing control fails closed`. Process A's cookie: `GET /api/v1/auth/session` → 200, `member.id` matches; `GET /api/v1/people` → 200; `household_memberships.household_id` matches Process A household. Separate new password login and display-cookie dashboard also 200. | **PASS** |
| AT5 Valid target opens exactly; invalid target fails closed | Valid: AT4 (base path) and `AT5/AT6/AT8/AT9` / AT9 restore (epoch-2 path). Invalid: `AT-target-a` missing pointer (leftover base/epoch/backup hashes unchanged; no file at the pointer); `AT-target-b` garbage target; `AT-target-c` existing sqlite outside the mount. Both `createLifecycleRuntime` and `resolveActiveHouseholdDbPath` throw. Fresh create remains AT3. | **PASS** |
| AT6 Missing control fails closed | AT4 trailing section plus `operator scripts share fail-closed resolution with startup` | **PASS** |
| AT7 Invalid control or invalid active target fails closed | `AT7 malformed or inconsistent control fails closed and preserves candidates` plus AT-target-a/b/c | **PASS** |
| AT8 Unproven epoch candidates retained | `AT8 unproven epoch candidates are retained when no completed replacement names them`; AT5 decoy | **PASS** |
| AT9 Proven superseded cleanup | AT5 reset + AT9 restore + existing P0-008A/B suites | **PASS** |
| AT10 Backup catalog across process replacement | Catalog assertions in AT4/AT6/AT10 | **PASS** |
| AT11 Control relocation | `AT11 relocates a verified control snapshot and aborts when the active database is missing` | **PASS** |
| AT12 `validate:pr` and `validate:rc` | Exact commands on this correction tree (below) | **PASS** |
| AT13 Railway `/data` path checkpoint | Project Lead after local Architecture acceptance. No live write. | **NOT RUN** |

## Verification performed

- `npx vitest run tests/integration/p0-008f.test.ts` — **14 passed** (includes AT-target-a/b/c and AT4 member-session reuse)
- Exact `npm run validate:pr` — **PASS** (exit 0, ~681s): lint + typecheck; Vitest **365 passed / 50 files**; Chromium Playwright **135 passed**; Vite smoke **6 passed**
- Exact `npm run validate:rc` — **PASS** (exit 0, ~1103s): lint + typecheck; Vitest **365 passed / 50 files**; Playwright **207 passed**; Vite smoke **6 passed**
- Hosted Railway / live volume — **NOT RUN** (AT13)

## Deviations from brief revision

- None material. Process B is still a second application runtime using absolute volume paths, not an OS-level container replacement.

## Discoveries for Architecture

- Readonly inspect of a WAL control store can recreate empty `-wal`/`-shm` sidecars. Candidate-preservation assertions ignore those two control sidecars and require every household/epoch/backup file, plus the control main file, to keep name and hash.
- `db:seed` still opens configured `DB_PATH` (evaluation). Hosted config still forbids `AUTO_SEED`.

## Known limitations

- AT13 remains the Project Lead Railway checkpoint.
- Member-session and display-cookie continuity are HTTP injects, not a browser session across a real container replace.
- No new runtime dependency.

## Suggested follow-up

Not approved scope. After Architecture re-review, the Project Lead runs AT13, then decides any household rebuild.

Suggested commit (not created):

```text
fix(P0-008F): fail-closed active-target check and reuse member sessions
```
