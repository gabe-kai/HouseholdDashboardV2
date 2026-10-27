# P0-008F - Keep a household intact through deployment

**Revision:** 1  
**Status:** ACCEPTED (technical)

Recommended lifecycle: DRAFT -> IN REVIEW -> READY -> IMPLEMENTING -> IMPLEMENTED -> ACCEPTED

A material contract change increments the revision and invalidates previous Engineering readiness.

`ACCEPTED` means Architecture has accepted the implementation against this technical contract. Project Lead/user acceptance of the experience is separate.

## Why

P0-008 added durable installation identity, epochs, active-database pointers, backup catalogs, reset and restore. Those protections only work if the installation-control database survives container replacement beside the household database. The hosted configuration did not require `INSTALLATION_CONTROL_PATH`; it defaulted to `runtime/installation-control.sqlite` inside the replaceable application container.

After the Project Lead's latest Railway redeploy, the new control store reported epoch 1 and selected `/data/household.sqlite`, which has zero households. The prior active image is absent from the mounted directory listing. Repository startup code can then delete epoch-named databases as “orphans.” A pre-redeploy Railway volume snapshot has not been identified. The older October 16 and September 9 app snapshots are explicitly not authorized for restoring this household.

This brief prevents recurrence and makes the new deployment safe before the household is rebuilt. It does not claim or attempt to recover the missing pre-redeploy household.

## Learning question

Can the existing single-process SQLite lifecycle retain its exact active household, credentials, display enrollment, epoch and backup catalog when a new container starts with the same mounted volume—and refuse to mutate data if installation control is missing or inconsistent?

## Player experience

After a code update, the family returns to the household they were using, with their normal sign-in and enrolled wall. If the app cannot identify its installation state safely, it stops with a clear operator-facing recovery message and leaves every candidate database untouched.

## Project card

**Card title:** Set up and manage my household without operator help

**Suggested column:** Up Next

**Player-facing goal:** Keep my household and devices connected when the app is updated.

**Done when:** A deployment keeps the household, sign-in and wall enrollment; missing installation state stops safely without replacing or deleting household files.

**Tracking relationship:** Contributes to the existing P0-008 card; no new infrastructure-only card.

## Current system

- `INSTALLATION_CONTROL_PATH` defaults to `runtime/installation-control.sqlite`, resolved relative to the application root. Hosted configuration currently requires `PUBLIC_ORIGIN`, `DB_PATH` and `BACKUP_DIR`, but does not require a persistent control path.
- `createLifecycleRuntime` opens that control store and calls `ensureAdopt(configuredRelative)`. A new control store starts at epoch 1 and adopts the configured `DB_PATH`, without discovering a prior active epoch file.
- `reconcilePendingOperations()` calls `cleanupOrphanEpochFiles()` at startup. That function removes other `*.epoch-*.sqlite` files based on the selected active path, without requiring a lifecycle journal to prove those files are superseded.
- The control store contains the active database pointer, installation epoch, lifecycle journal and in-app backup catalog. Household SQLite files and backup images live under `/data` in the current Railway configuration; the control store did not.
- The incident copies show the current control store at epoch 1 pointing to `/data/household.sqlite`; that active image has zero households and schema migration `021`. This is evidence of current empty state, not evidence that the prior live image is recoverable.
- A saved October 16 catalog image and a September 9 legacy image exist. They are older snapshots, not the requested pre-redeploy live state, and are outside this brief's recovery scope.
- P0-008A/B reset and restore are designed to replace the active image and advance an installation epoch. A successful operation within one container lifetime does not test a new deployment with a fresh container filesystem.

## Behavioral contract

1. Hosted startup requires an explicit absolute `INSTALLATION_CONTROL_PATH`; the ephemeral application-relative default is allowed only in local development/test. When the host exposes its persistent-volume mount path (Railway provides `RAILWAY_VOLUME_MOUNT_PATH`), validate that `DB_PATH`, `BACKUP_DIR` and `INSTALLATION_CONTROL_PATH` resolve inside that mount.
2. A truly fresh installation may initialize control state only when there is no existing household database, epoch database, backup image or other installation evidence. It then initializes control before opening/migrating the household database.
3. If control state is missing, unreadable, malformed or incompatible while any household, epoch or backup evidence exists, startup fails before opening/migrating/replacing a household database or cleaning files. The error names the missing setting/state and directs the operator to preserve files and use the documented recovery procedure. It does not auto-adopt `DB_PATH`, reset, reseed or delete candidates.
4. The active database pointer and epoch are authoritative. Startup cleanup may remove an inactive epoch image only when durable lifecycle state proves the replacement operation completed and the file is not the active image. A newly created control store cannot classify existing epoch files as disposable.
5. When a control store already exists and is valid, its active database pointer must resolve to an existing, readable SQLite database before any writable open or migration. If the target is missing or unreadable, startup and operator active-path resolution fail closed: they do not create the target, fall back to `DB_PATH`, adopt another candidate, migrate, or clean files. When a persistent-volume mount boundary is configured, the resolved active target must also remain inside that mount. Candidate paths and contents remain unchanged. This check must distinguish an existing installation from the fresh-install path in requirement 2: only a truly empty installation initializing new control state may create its first configured database.
6. On a new application container using the same persistent mount and valid control store, the app opens the exact previously active database and preserves household IDs, people, credentials/password hashes, grants, routines, responsibilities, history, display records/enrollment, installation ID, epoch, lifecycle journal and backup catalog. Existing member sessions and display credentials remain valid when their stored epoch and ordinary expiry/revocation rules allow.
7. In-app reset and restore remain deliberate user actions. Their current epoch fencing, access sanitation, optional-backup behavior, recovery continuations and post-activation cleanup remain intact; ordinary startup or deployment never invokes them.
8. Provide a safe, documented one-time control-store relocation/adoption procedure for deployments that currently keep control state on ephemeral storage. It uses SQLite's backup API, verifies the copied installation ID/epoch/active pointer/catalog and referenced active database, leaves the source untouched until verification, and refuses to proceed when a required image is missing. It must not treat an older household backup as the live database.
9. Add a non-secret startup diagnostic that reports the resolved control path, active database path and epoch, without logging credentials, tokens or household content.

## Implementation boundary

- Hosted configuration validation and startup ordering in `src/server/config.ts`, `src/server/installation-control.ts`, and `src/server/lifecycle-runtime.ts`.
- Lifecycle cleanup/reconciliation and any narrowly scoped control-store relocation command needed by the contract.
- Deployment instructions and Railway example in `docs/ops-deploy.md`; keep the core architecture provider-neutral.
- Focused integration/process-restart tests that model a replaceable container filesystem and a shared persistent data directory.
- No new runtime service or dependency is expected; Engineering must report any dependency change before adding it.

## Do not change

- Do not restore the October 16 or September 9 app snapshots, infer that either is the latest household, or overwrite a candidate database as part of this brief.
- Do not wipe or rebuild the household automatically. The Project Lead may rebuild only after the corrected release and persistent configuration are verified.
- Do not change the household domain model, member/display authority, session rules, checklist outbox, backup contents, or reset/restore meaning except where needed to keep those existing contracts intact through deployment.
- Do not make `/` routing, P0-009A family-wall work, hosted UI redesign, automatic backup scheduling, multi-replica support, or provider migration part of this slice.
- No Railway mutation, live database write, restore or deployment is authorized by this brief. The Project Lead performs hosted configuration and any later rebuild after reviewing the concrete result.

## Acceptance tests

1. Hosted configuration without an explicit absolute control path fails before database creation/migration; development/test still uses its documented local default.
2. When Railway's volume-mount environment variable is present, a control, database or backup path outside that mount fails before startup writes; paths inside the mount pass.
3. A completely empty installation starts with control state first, reaches first-manager setup, and records the configured database path at epoch 1.
4. A populated household with a valid control store is opened by process A, then process A is terminated and process B starts with a fresh application/container directory and the same persistent data directory. Process B serves the same household IDs, work/history, active path, installation ID and epoch; a new password login succeeds, and an unexpired member session cookie issued by process A remains accepted.
5. After a reset or restore has selected an epoch database, the same new-process scenario continues to serve that exact existing, readable active image; no base-path fallback occurs. If a previously valid control store points to a missing/unreadable active file, or the resolved target is outside the configured mount, startup and operator active-path resolution fail before writable open/migration. They preserve every candidate and do not create a replacement at the base path. Keep the fresh-install exception in requirement 2: only a genuinely empty install creating control state may create its first DB.
6. A valid enrolled display from before process replacement can still authenticate and read its allowed dashboard under the same epoch; member/display credentials are not retired by ordinary startup.
7. Remove the control file while a base/epoch database or backup evidence remains. Startup fails closed; byte hashes and names of every candidate remain unchanged, and no SQLite migration or database is created at the base path.
8. Supply malformed, unreadable or internally inconsistent control state with household files present. Startup fails closed and preserves all candidates; it never selects a different database based on filename or mtime.
9. Lifecycle cleanup with no proven completed replacement leaves every unreferenced epoch candidate untouched. A completed reset/restore removes only the superseded file(s) allowed by the existing lifecycle contract and preserves the active image.
10. Backup catalog rows and their referenced immutable files remain visible and restorable after process replacement; an absent catalog/control file cannot silently present an empty catalog as a new installation.
11. A one-time control-store relocation from the current default location to a persistent target produces an equivalent verified control snapshot and keeps the source unchanged. A missing active database or failed integrity/catalog check aborts without replacing either copy.
12. `npm run validate:pr` and `npm run validate:rc` pass on the final tree. The Build Report maps each assertion separately, including process boundary, failure preservation, and lifecycle cleanup evidence.
13. Before any household rebuild, the Project Lead can verify the Railway variables resolve to the `/data` volume (`DB_PATH=/data/household.sqlite`, `BACKUP_DIR=/data/backups`, `INSTALLATION_CONTROL_PATH=/data/installation-control.sqlite`) and the deployment logs report those resolved non-secret paths. This is a human checkpoint; no test may write to the current live Railway volume.

### Acceptance evidence matrix

| ID / brief assertion | Initial state / fixture | Action / transition | Exact expected observable or invariant | Evidence type and named test/checkpoint | Result |
| --- | --- | --- | --- | --- | --- |
| AT1 | Hosted config with control path absent/relative; development config | Load config/start server | Hosted startup rejects before DB writes; local default remains supported | Integration: `tests/integration/p0-008f.test.ts` AT1 | PASS |
| AT2 | Temporary volume root plus one deliberately external path | Load hosted config with Railway mount-path variable | All three paths inside mount pass; any path outside fails without file creation | Integration: `tests/integration/p0-008f.test.ts` AT2 | PASS |
| AT3 | Empty volume and configured persistent paths | Start app and begin first-manager setup | Control state exists first, epoch 1 points to configured DB, setup remains available | Integration: `tests/integration/p0-008f.test.ts` AT3 | PASS |
| AT4 | Populated DB, valid control, account with unexpired member session and display credential | Start process A and issue credentials; terminate A; start process B on same volume; use the pre-existing credentials | Same household IDs and epoch; new password login succeeds; Process A's still-valid member session and display credential both authenticate in B | Process-level integration: `tests/integration/p0-008f.test.ts` AT4/AT6/AT10 — Process A cookie reused on Process B via `GET /api/v1/auth/session` and `/api/v1/people` (same membership and household), plus new password login and display cookie | PASS |
| AT5 | Valid control pointing to an existing base or epoch DB; separate cases with a missing, unreadable, or outside-mount target | Start server and resolve operator active path | Valid target opens exactly. Invalid target fails before writable open/migration; no `DB_PATH` fallback; all candidate names/hashes remain unchanged. Truly empty fresh initialization remains able to create its first configured DB. | Integration: AT4/AT5 process-B valid targets; `AT-target-a` missing, `AT-target-b` unreadable, `AT-target-c` outside-mount; AT3 fresh install | PASS |
| AT6 | Control missing; household/epoch/backup candidates present | Start app | Startup fails before DB open/migration/cleanup; candidate hashes/names unchanged | Integration: missing-control section of AT4/AT6/AT10 plus operator-script fail-closed | PASS |
| AT7 | Malformed/unreadable/inconsistent control plus data files; separately valid control with invalid active target | Start app and invoke operator active-path resolution | Both invalid control and invalid active target fail closed; no candidate is created, migrated, selected, changed or deleted | Integration: `tests/integration/p0-008f.test.ts` AT7 plus AT-target-a/b/c | PASS |
| AT8 | Epoch files present; no completed lifecycle operation proving supersession | Reconcile pending operations/startup | All candidates remain; cleanup does not infer safety from the selected filename | Integration: `tests/integration/p0-008f.test.ts` AT8 (and AT5 decoy) | PASS |
| AT9 | Completed reset and completed restore fixtures | Run lifecycle reconciliation and new process | Active image survives; only proven superseded images are cleaned; operation result remains kind-correct | Existing P0-008A/B suites plus `p0-008f.test.ts` AT5 reset and AT9 restore | PASS |
| AT10 | Populated control catalog and backup files on volume | Replace process/container | Same catalog rows and images remain available; no false empty catalog | Integration: catalog assertions in AT4/AT6/AT10 | PASS |
| AT11 | Control store at old local/default path and valid active DB | Relocate via documented utility | Verified target equivalent; source untouched; failure leaves both copies intact | Integration: `tests/integration/p0-008f.test.ts` AT11 | PASS |
| AT12 | Final corrected implementation tree | Run exact PR and RC commands | Both exit 0; report maps all assertion rows independently | Exact `npm run validate:pr` and `npm run validate:rc` after the FIX REQUIRED corrections; `reports/P0-008F-r1-build-report.md` | PASS |
| AT13 | Railway configuration review, no household rebuild yet | Inspect values and resolved-path startup diagnostic | All paths resolve within `/data`; no secret/data values logged; no live write required | Project Lead configuration checkpoint | NOT RUN |

## Dependencies

- P0-008A/B/C/D/E are integrated at `bd05ad0`.
- Hosted deployment supplies a persistent volume at `/data`; confirmed current service variables include `DB_PATH=/data/household.sqlite` and `BACKUP_DIR=/data/backups`. `INSTALLATION_CONTROL_PATH` was absent from the reported deployment configuration. Railway documents `RAILWAY_VOLUME_MOUNT_PATH` as an automatically provided variable for an attached volume; implementation must still verify the actual runtime value before enforcing the boundary. See [Railway Variables Reference](https://docs.railway.com/variables/reference) and [Using Volumes](https://docs.railway.com/volumes).
- A pre-redeploy Railway volume snapshot has not been identified. Exact recovery of the pre-redeploy live household is not an acceptance requirement and must not be claimed from the October 16 app snapshot.

## Relevant decisions

- D-050–D-052: installation ownership, replacement epochs, and managed backup semantics.
- D-060: hosted installation control is persistent authority state; missing authority fails closed.

## Known risks / assumptions

- **Observed, not assumed:** the current active DB copy has zero households, and the current control copy is epoch 1 pointing at `/data/household.sqlite`.
- **Likely incident mechanism:** an ephemeral control store was recreated on redeploy; the new store adopted the base DB, and unconditional startup orphan cleanup can remove epoch-named files. Confirm exact prior active filename only if a matching Railway volume snapshot or other pre-deploy evidence is found.
- Railway automatically provides `RAILWAY_VOLUME_MOUNT_PATH` for an attached volume according to its current documentation; verify the deployed value. Other providers may not expose an equivalent, so path persistence remains an operator configuration requirement and the application contract stays provider-neutral.
- The live household may not be recoverable from the currently mounted files. This brief must not delay a truthful report or convert an older app snapshot into the requested live state.

## Engineering readiness

**Reviewed revision:** 1
**Readiness:** READY
**Review:** `reports/P0-008F-r1-engineering-readiness.md` (initial consolidated pass against `main` at `bd05ad0`)

## Architecture disposition

**Initial disposition:** ACCEPT / PROCEED for implementation of r1 (historical authorization only).

**Initial review:** `reports/P0-008F-r1-architecture-review.md`

The initial authorization covered local implementation and evidence only. It did not accept the implementation or authorize Railway mutation, restore, deployment, or household rebuild.

**Current implementation review:** ACCEPTED on the same r1 after closing the active-target and existing-session findings. See `reports/P0-008F-r1-architecture-reacceptance.md`; the initial findings remain recorded in `reports/P0-008F-r1-architecture-acceptance.md`. Engineering reports exact `validate:pr` and `validate:rc` PASS; Architecture did not rerun them. AT13 remains NOT RUN and is the Project Lead's Railway path/configuration checkpoint before any household rebuild. This technical acceptance does not itself authorize a deployment or live-data operation.

## Implementation

**Build Report:** `reports/P0-008F-r1-build-report.md`

## Revision history

- **r1:** Initial incident-driven brief after the 2026-10-26 Railway redeploy exposed loss of installation-control continuity.
