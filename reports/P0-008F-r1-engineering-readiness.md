# Engineering Readiness Review - BRIEF P0-008F r1

**Brief revision reviewed:** 1
**Review round:** Initial consolidated pass
**Readiness:** READY
**Repository/Git state checked:** YES
**Current branch:** `refine-family-wall` @ `815f20d`
**Integrated code baseline inspected:** Clean `main` / `origin/main` at **`bd05ad0`** (PR **#28**, accepted P0-008E r1)
**Working tree at review:** Clean. `815f20d..main` is docs-only (P0-008F r1 brief, D-060, Family wall / P0-009A planning). No F implementation under `src/`, `db/`, `tests/`, or `.github/`. Unrelated Family wall planning on this checkout must stay off the F implementation branch.

> READY is the default when implementation can reasonably proceed. QUESTION/BLOCKER findings must be material, evidenced, and consolidated; ordinary implementation choices are not readiness gates.

## Verdict

**READY.** D-060 and P0-008F r1 agree with each other and with merged A–E at `bd05ad0`. The brief’s **Current system** claims match the repository: hosted config requires `PUBLIC_ORIGIN` / `DB_PATH` / `BACKUP_DIR` but not a persistent control path; `createLifecycleRuntime` opens/creates the control SQLite and `ensureAdopt`s configured `DB_PATH` at epoch 1; `reconcilePendingOperations` always calls `cleanupOrphanEpochFiles()`, which deletes other `*.epoch-*.sqlite` files without a completed lifecycle record. That is a faithful description of the reported Railway failure mode and is implementable as a fail-closed inversion of those two paths.

Fail-closed hosted validation, journal-gated epoch cleanup, SQLite-backup control relocation, and fresh-container / shared-volume tests can be built with existing `better-sqlite3`, temp-dir harnesses, and operator-script patterns. No new runtime dependency is required.

**No BLOCKER. No QUESTION.** This review does not authorize coding, Railway mutation, snapshot restore, or household rebuild; await Architecture **ACCEPT / PROCEED**. After local acceptance, AT13 remains a Project Lead configuration checkpoint on durable `/data` paths.

## Decision alignment

| Decision | Brief use | Repo / conflict |
| --- | --- | --- |
| **D-060** | Explicit hosted `INSTALLATION_CONTROL_PATH`; fail closed when control is missing/invalid and evidence remains; cleanup only with durable proof; process replacement reopens the exact active image; SQLite-backup relocation | Active planned; code still uses the ephemeral default and unconditional adopt/cleanup |
| **D-050** | Control remains installation authority outside household snapshots; owner/setup unchanged | Implemented; F preserves it and requires the file to live on the persistent volume |
| **D-051** | Epoch, active pointer, journal, prepare→activate→reopen, restart-safe retirement of the superseded image | Implemented. Silent `ensureAdopt(DB_PATH)` when control is missing is the behavior D-060 withdraws; not a contradiction. Journal today does not store the superseded path — Engineering will persist it as layout, not a new product rule |
| **D-052** | Backup catalog stays in the control store; restore remains a deliberate user action | Implemented; F must keep catalog/files across process replacement and must not treat a household backup as the live DB during relocation |
| **D-034 / D-043–D-049 / D-053–D-056** | Domain, sessions, displays, reset/restore meaning, `/` routing, Family wall | Out of scope; F only keeps them intact through deployment |

No Active-decision contradiction requiring Architecture revision of r1.

## Current-system claim check

Inspected at `bd05ad0` (same lifecycle sources on `815f20d`).

| Claim | Evidence | Verdict |
| --- | --- | --- |
| `INSTALLATION_CONTROL_PATH` defaults to `runtime/installation-control.sqlite`; hosted does not require it | `src/server/config.ts` hosted block requires origin/DB/backup only; default at lines 100–101 | Match |
| `createLifecycleRuntime` opens control and `ensureAdopt(configuredRelative)` | `lifecycle-runtime.ts` 203–211: `InstallationControl.open` → `ensureAdopt` → `openDatabase` → `migrate` | Match |
| New control starts at epoch 1 and adopts configured `DB_PATH` | `ensureAdopt` inserts `dataset_epoch = 1` with the configured relative path when `installation_state` is empty | Match |
| `reconcilePendingOperations` cleans orphan epoch files at startup | Called at end of `createLifecycleRuntime`; last step is `cleanupOrphanEpochFiles` | Match |
| Cleanup deletes other `*.epoch-*.sqlite` without a lifecycle journal proof | `cleanupOrphanEpochFiles` scans `baseStem.epoch-*.sqlite` and `fs.rmSync`s non-active matches, including `-wal`/`-shm` | Match |
| Control holds active pointer, epoch, journal, backup catalog | `installation-control.ts` schema + control migration `001` | Match |
| `InstallationControl.open` creates the file if missing | `mkdirSync` + `new DatabaseConstructor(controlPath)` + `CONTROL_SCHEMA` + migrations | Match (this is the mutation AT6/AT7 must not perform) |
| Completed reset/restore journal rows do not name the superseded file | `completeLifecycleOperation` stores result epoch + response JSON; `activateAndCleanup` deletes `oldDbPath` in-process only | Match |
| Operator scripts fall back to `DB_PATH` when control is absent | `resolveActiveHouseholdDbPath`: missing control → `resolveDbPath(config.dbPath)` | Match |
| SQLite backup API already used | `backup-catalog.ts`, `scripts/backup.ts`, `scripts/restore.ts`, `cleanup-fixtures.ts` | Match |
| Process reopen harnesses exist but reuse the same app/control paths | `p0-008a.test.ts` `reopenHarness`; `p0-007c-2-evidence.test.ts` rebuild with preserved control path | Match (AT4/AT5 need an extra empty-app-root / shared-volume case) |
| Startup logs host/port/profile only | `src/server/index.ts` | Match |
| Household migrations through **021**; control catalog **001** | `PROJECT_STATE.md`; `p0-008a.test.ts` asserts 21 schema migrations | Match |

No Current-system factual contradiction requiring Architecture revision of r1.

## Focused attention areas

### 1. Fail-closed before control creation or household open (contract §1–§3, AT1–AT3, AT6–AT7)

**Repo today:** Hosted `loadConfig` accepts a missing/relative control path. `InstallationControl.open` always creates a SQLite file. `ensureAdopt` then writes epoch 1 against `DB_PATH`. `openDatabase` creates/migrates that file. A readonly inspect path does not exist.

**Brief:** Hosted requires an explicit absolute `INSTALLATION_CONTROL_PATH`. When `RAILWAY_VOLUME_MOUNT_PATH` (or the equivalent exposed mount variable) is present, all three paths must resolve inside it. Empty volume: create control first, then open/migrate the household DB at epoch 1. Missing/unreadable/malformed/incompatible control with any household, epoch, or backup evidence: stop before open/migrate/replace/cleanup; name the missing setting/state; point at the documented recovery procedure; do not adopt `DB_PATH`.

**Disposition:** Implementable in `config.ts` + a pre-open inspector in `installation-control.ts` / `lifecycle-runtime.ts`. Ordinary choices: exact error strings; treating trimmed-empty `INSTALLATION_CONTROL_PATH` as absent; mount-containment helper (`path.resolve` then reject `..` escape); evidence scan covering the configured DB file plus `-wal`/`-shm`, `*.epoch-*.sqlite` in that directory, and files under `BACKUP_DIR`. **IMPORTANT:** inspect with `readonly` / `fileMustExist` so a fail-closed start does not create WAL or apply control migrations. Apply the same guard in `resolveActiveHouseholdDbPath` so `db:migrate` / `db:backup` / `auth:bootstrap` cannot recreate the incident. Existing P0-008A populated-upgrade tests that copy a household file then start with a *new* control path must pre-write valid control state; silent adopt is the behavior this brief removes.

### 2. Journal-proven epoch cleanup (contract §4, AT8–AT9)

**Repo today:** In-process `activateAndCleanup` deletes the previous active file after durable activate. Startup then glob-deletes every other `*.epoch-*.sqlite` sharing the stem. A freshly created control that adopted empty `household.sqlite` would classify a live `household.epoch-N.sqlite` as an orphan.

**Brief:** Cleanup may remove an inactive epoch image only when durable lifecycle state proves replacement completed and identifies that file; a newly created control cannot classify existing epoch files as disposable. Completed reset/restore still retire the superseded image per A/B.

**Disposition:** Feasible without a product change. Stop directory-wide orphan deletion. Record the superseded absolute/relative path on activation (additive JSON on the existing completed operation, or equivalent Engineering-owned journal field). Restart cleanup retries only those proven paths and never the active image. Completed operations that lack a path (pre-F journals) retain leftover files — fail-closed, matching AT8. Existing A/B lifecycle suites plus one focused process test cover AT9.

### 3. Fresh-container / shared-volume continuity (contract §5–§6, AT4–AT6, AT10)

**Repo today:** `reopenHarness` restarts Fastify against the same absolute temp DB + control paths. `repoRoot` is `import.meta.url`, so cwd replacement alone does not move the module tree. Relative active pointers are stored via `path.relative(repoRoot, …)` and still resolve for `/data` paths on Railway (`../data/household.sqlite` from `/app`).

**Brief:** Process B with a fresh application/container directory and the same persistent mount must serve the same household IDs, credentials, display enrollment, installation ID, epoch, journal, and backup catalog. After reset/restore, continue serving the epoch-N image with no base-path fallback. Ordinary startup never runs reset/restore.

**Disposition:** Implementable with disposable temp volumes and existing HTTP harnesses. Model the replaceable container as: absolute `DB_PATH` / `BACKUP_DIR` / `INSTALLATION_CONTROL_PATH` on a shared temp directory; empty or absent app-relative `runtime/`; terminate process A; start process B with the same env. An extra child-process start is optional, not required to make the assertion true. Do not change reset/restore meaning. **IMPORTANT:** AT5 must assert the opened file is the control store’s epoch path, not `DB_PATH`. AT6 must hash candidate names/bytes before and after the failed start.

### 4. Control-store relocation (contract §7, AT11)

**Repo today:** No relocation command. `Database.backup()` is already the in-repo copy primitive. `db:restore` refuses when control exists and is not a live-data tool for this brief.

**Brief:** One-time operator procedure from the current default location to a persistent target; SQLite backup API; verify installation ID/epoch/active pointer/catalog and the referenced active database; leave the source untouched until verification; abort without replacing either copy when a required image is missing; do not treat an older household backup as the live database.

**Disposition:** Narrow new script plus `docs/ops-deploy.md` / Railway example, provider-neutral in architecture. Ordinary choices: `tsx src/server/scripts/…` vs `npm run` name; write dest via temp then rename only after verify; refuse if dest already exists. **IMPORTANT:** never invoke relocation from startup; document “stop the process first”; verify the active pointer resolves to the live household file (not a `BACKUP_DIR` catalog image); keep the source file. This does not recover the already-lost Railway control store.

### 5. Non-secret diagnostic and hosted docs (contract §8, AT1–AT2, AT13)

**Repo today:** Startup log omits control/active/epoch. `docs/ops-deploy.md` still presents the application-relative control default. `.env.example` comments the same default. AT13 is a human Railway check.

**Disposition:** Log resolved control path, active database path, and epoch only. Document hosted absolute paths, mount-boundary rule, relocation, and a preserve-files recovery procedure (no older-snapshot restore). AT13 is **NOT RUN** by Engineering; the Project Lead verifies `DB_PATH=/data/household.sqlite`, `BACKUP_DIR=/data/backups`, `INSTALLATION_CONTROL_PATH=/data/installation-control.sqlite` after local acceptance.

## Acceptance-test feasibility (AT1–13)

| AT | Feasible on baseline? | Notes |
| --- | --- | --- |
| 1 Hosted control-path config | Yes | Extend `p0-002.test.ts` hosted `loadConfig`; development/test keep relative default |
| 2 Persistent-mount path validation | Yes | Temp volume root + `RAILWAY_VOLUME_MOUNT_PATH`; one path outside fails with no file creation |
| 3 Fresh install order | Yes | Empty volume; control file appears before household migrate; epoch 1; Welcome/setup still available |
| 4 Redeploy continuity from base image | Yes | Shared temp volume + fresh app-relative runtime; password + display session assertions |
| 5 Redeploy continuity after reset/restore | Yes | Same harness after epoch-N activate; assert no `DB_PATH` fallback |
| 6 Missing-control fail-closed | Yes | Hash candidates; expect throw before `openDatabase`; no new base DB |
| 7 Invalid-control matrix | Yes | Truncated/non-SQLite/unreadable/empty-state control + data files; readonly inspect |
| 8 Unproven epoch candidates retained | Yes | Plant extra `*.epoch-*.sqlite`; reconcile; files remain |
| 9 Proven cleanup + kind-correct result | Yes | Existing A/B suites + focused restart after completed reset/restore |
| 10 Backup catalog across replacement | Yes | Catalog rows + files on volume; process B lists the same ids |
| 11 Control relocation success/failure | Yes | Script/integration; source bytes unchanged; dest missing-active abort |
| 12 `validate:pr` / `validate:rc` | Yes | Exact commands from `ARCHITECTURE.md`; map each row in the Build Report |
| 13 Railway path checkpoint | Human only | Project Lead after local acceptance; no live write in this brief |

## Scope confirmation

- **In:** Hosted/config validation; startup ordering; evidence-aware control init; journal-gated cleanup; relocation command; `ops-deploy.md` Railway example; focused integration/process tests; non-secret startup diagnostic; operator-script fail-closed reuse.
- **Out:** Restoring October 16 / September 9 snapshots; inferring the pre-redeploy live image; automatic household rebuild; Railway mutation/deploy; `/` routing; P0-009A Family wall; hosted UI redesign; scheduled backups; multi-replica; new runtime dependency; changing reset/restore/session/display meaning except to keep them intact through deployment.

## Status for Architecture

**Readiness: READY** for P0-008F revision 1 against integrated `main` @ `bd05ad0` (planning tip `815f20d`).

Await **ACCEPT / PROCEED** before implementation. After that response, Engineering expects to build without another ordinary QUESTION/BLOCKER cycle unless a genuinely new repository fact appears. Suggested implementation branch after proceed: `brief/p0-008f-hosted-installation-continuity`, cut from `main` at `bd05ad0` (do not implement on `refine-family-wall`).

## Suggested commit message (readiness writeback only; not committed by this review)

```
docs(P0-008F): record Engineering readiness READY for r1
```
