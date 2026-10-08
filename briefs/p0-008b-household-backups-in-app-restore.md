# BRIEF P0-008B - Household Backups and In-App Restore

**Revision:** 2
**Status:** FIX REQUIRED — AT2/AT6/AT9 evidence closed at `34179f7`; current-tip PR/RC validation did not complete; Build Report metadata remains stale; r2 contract unchanged

Architecture inspected accepted A on merged `main` at `405c5db` (PR #24). This revision replaces the unreleased r1 draft. Engineering must review r2 against the repository before implementation; A's readiness does not carry forward. Product acceptance is separate.

## Why

Repeated reset is only part of the approved journey. A manager also needs an optional saved backup and an in-app way to recover it after all household accounts are gone. This slice completes the reset/restore loop using A's installation ownership and replacement boundary.

## Learning question

Can the parent choose whether to keep a backup, reset, and restore the expected household from either Settings or protected Welcome, with clear behavior when an operation fails?

## Player experience

Settings → Backups lists saved household names, dates and optional labels. The manager can create, restore or delete a saved backup. Reset gains **Save a backup before resetting**, off by default. Restore previews the saved household and replaces current data, optionally saving current state first, also off by default. Saved backups survive reset. Protected Welcome offers Restore after owner authorization even when no household account exists.

## Project card

**Card title:** Set up and manage my household without operator help
**Suggested column:** Shared card remains In Progress; B is the current technical slice
**Player-facing goal:** Recover a saved household through the app after starting over.
**Done when:** The parent saves a backup, resets without creating another, then restores from Welcome and securely signs in to the restored household.
**Tracking relationship:** Second slice under the P0-008 card; member management and guided first-day evaluation remain C/D.

## Current system

Inspected merged `main` / `origin/main` at `405c5db` (PR #24), with migrations through `018_household_lifecycle.sql` and accepted P0-008A r1. The actual Railway volume/schema and hosted A journey remain unverified release checkpoints.

- `src/server/installation-control.ts` persists installation identity, epoch, active database reference, owner/setup authority, lifecycle operations and recovery continuations in a separate control SQLite. It has no backup catalog or control-schema migration history. `activateCandidate` changes the active reference/epoch; `completeLifecycleOperation` records the result separately.
- `src/server/lifecycle-runtime.ts` gives ordinary `/api/v1` requests a shared barrier and reset an exclusive replacement path. `replaceWithEmptyDatabase` prepares/migrates an empty image, activates it, reopens runtime references and retires the old files. `reconcilePendingOperations` currently constructs reset-shaped results for pending operations; it cannot safely interpret a restore or optional-backup operation without extension.
- `src/server/lifecycle-routes.ts` provides `/owner`, one-use setup access, member reauthentication/reset and continuation-scoped operation recovery. Reset requires `household.lifecycle.manage`, recent password proof, `RESET` and the expected installation epoch. There are no backup catalog, optional-backup or restore routes.
- `src/server/scripts/backup.ts` uses SQLite's backup API against the active image but writes an unregistered file under `BACKUP_DIR`. `src/server/scripts/restore.ts` refuses to run when installation control exists; its legacy unlink/rename path is not an online restore implementation.
- `src/client/HouseholdSettings.tsx` exposes no-new-backup Reset. Welcome and `/owner` provide protected setup/recovery, not backup selection. Member/display outboxes and sessions use installation-epoch fencing; reset closes sockets and explains retired pending work. B has no CI selection or through-018 backup fixture yet.

## Behavioral contract

1. **One protected catalog.** Extend the persistent installation control store with an additive, replay-safe catalog migration that upgrades populated A installations. Catalog immutable backup files outside the replaceable household image. Record opaque backup ID, household identity/name, UTC creation time, optional bounded label, schema/migration manifest, format version, byte size and integrity digest. UI shows only friendly metadata to current `household.lifecycle.manage` holders or a specifically authenticated owner-recovery session. No filesystem paths, credential data or private-task previews. A reset continuation grants operation/setup recovery only; it cannot enumerate backups.
2. **Create and delete.** Create a consistent snapshot through the SQLite backup API and verify it before publishing a successful catalog entry. Serialize backup creation and selected-file deletion with reset/restore activation, so the catalog always names a complete file and a saved snapshot represents one coherent active state. Never copy an open WAL database with a plain file copy. Failure/cancellation leaves active data usable and no bogus success entry. Delete uses one targeted confirmation, removes only the selected catalog/file, and cannot race an active restore using that backup. Paths are server-generated and confined to configured persistent roots; the control database and active/candidate images cannot be catalog or deletion targets. No path or URL supplied by the browser is trusted.
3. **Optional means optional.** Reset and restore each offer a clearly labeled save-current-state option, default off for every new operation. With it off, no pre-operation backup is made. With it on, a verified named backup must finish before destructive activation, in the same serialized lifecycle operation so no write can slip between the saved state and the switch. A backup failure leaves current data active and offers Retry or a fresh explicit choice to proceed without a backup; changing intent creates a new confirmed command, not reuse of an old receipt. If a backup succeeds but later activation fails, report the saved backup and actual active state truthfully; replay must not create another copy. Existing saved backups survive both operations. State that provider snapshots may exist separately.
4. **Restore admission.** Restore is from a selected, locally managed backup, not arbitrary browser SQL uploads or external URLs. Verify the file/digest, recognized schema/migration sequence, SQLite integrity and foreign keys, and the single-household scope. Prepare a disposable candidate; run only application-owned forward migrations there. Reject corrupt, missing, unrecognized, newer-than-app or out-of-policy older backups before changing active data, explaining what version/support is needed. Do not rewrite the source backup. Support verified through-017 snapshots plus every schema delivered in this P0-008 series; add a compatibility fixture for each supported boundary. Installed app version never changes.
5. **Legacy operator backups.** Permit an owner-authorized scan/register of regular files already within configured `BACKUP_DIR`, including the documented `household-*.sqlite` outputs. Validate before catalog adoption; reject traversal, symlinks outside root, foreign/unknown schema, and unsupported multiple households. Never scan arbitrary disk or execute SQL supplied by a backup. Do not infer trust from a filename alone. The UI can identify an unsupported file without exposing private contents.
6. **Preview and authorization.** Before replacing anything, show saved household/date, current household being replaced, and the fact that people, credentials/permissions, work, calendar and saved setup progress return to that snapshot. Require current lifecycle authority plus recent password reauthentication, or fresh owner proof at Welcome, and one deliberate confirmation. Passwords revert to the saved credential state; explain how to sign in or recover the restored manager. Deleting a backup also requires recent proof. No public/display/member-only access can enumerate or restore backups.
7. **Sanitize access before activation.** Restore household data/IDs, password hashes, grants, work and historical device/actor identities, but invalidate every stored human/display session, invitation, bootstrap/setup claim and password-reset/access link in both the staged image and applicable control records. Rotate relevant authorization versions and allocate a fresh **installation** epoch outside the backup. Retain display identity/provenance as access-revoked records requiring explicit re-enrollment, not active wall credentials. Old current-installation credentials are invalid too. New signin uses restored current credentials; if unavailable, owner recovery targets an existing eligible manager without impersonation or changing work. Restoring a removed person present in an older snapshot is a deliberate data replacement, disclosed in preview; ordinary restore is not a member-undeletion shortcut.
8. **One recoverable operation.** Extend A's exclusive prepare/validate/activate path rather than adding a parallel file-switch mechanism. Bind a restore command to source epoch, backup ID/digest, optional-backup choice and initiator; stage and scrub the candidate before activation. Activation and recoverable operation outcome must commit together, or a durable typed journal must reconstruct the same truthful result after a crash. A's current pending-operation reconciliation assumes reset; B must distinguish backup creation, reset and restore and never return a reset-shaped success for a restore. Reads/writes cannot leak across the switch. A lost response or restart resumes/reports the same operation and preserves new data against replay. Failed preparation leaves the original household usable; a crash after committed activation resumes the restored household with sanitized access. Keep backup/control state outside restored content. The initiator retains only a restricted result/recovery session until authenticating to the restored household.
9. **Privacy and pending work.** Snapshots contain sensitive household data, including private content; protect storage through deployment filesystem permissions and authenticated operations. This slice provides no raw download/browse route or new manager right to inspect private tasks. Both client queues and all delayed reads/config/auth responses are fenced by the new epoch even if restored IDs and activity generation equal their old values. Keep D-045's disconnected stale-data limit; do not promise instantaneous erasure on an offline display.
10. **Clear results and release evidence.** Present progress, a stable operation-result route after reload, and clear failure/retry action without false success. Update the active-path operator tools so offline restore cannot bypass epoch/credential sanitation. Publish the supported-backup range and persistence layout. Prove the backup→reset→restore→signin journey locally before a Project Lead-authorized hosted candidate; record Railway restart/volume evidence separately.

## Implementation boundary

- Extend A's installation coordinator/control schema, active-image replacement, operation journal and recovery views; reuse SQLite backup and current forward migrations. Avoid a parallel restore stack and a reset-only pending-operation resolver.
- Settings/Backups and protected Welcome restore, typed API/route-policy/principal checks, epoch arbitration and operations docs. No email, external storage service, arbitrary upload/export or automatic backup schedule.
- Populated through-017 and through-018/A fixtures, crash/rollback tests, browser lifecycle journeys and explicit B CI selection. Visual artifacts remain under ignored `reports/_local-screenshots/p0-008b-r2/`.

## Do not change

- Reset never silently opts into backup. Saved backups are never wiped by reset/restore or swept merely for age.
- Ordinary activity clear, assignment/history semantics, private-task ownership and display provenance remain protected. Retain original snapshots; restore migrates a copy.
- No production database operation during implementation. No hosted deployment or Git action is authorized by this brief alone.

## Acceptance tests

1. **Settings journey:** Create a labeled backup, see durable metadata after reload, delete another selected backup, and leave the active household and other snapshots untouched. Unauthorized metadata/read/create/delete/restore attempts fail, including direct API and display credentials.
2. **Optional backup matrix:** Reset and restore with option off create zero saved copies. With it on, exactly one verified backup is created from the state immediately before the switch. Race a normal write with backup/reset or backup/restore: any old-epoch write acknowledged before replacement is in the snapshot; a write after the epoch switch is rejected or handled only under fresh authority, never acknowledged and lost between snapshot and activation. Inject backup failure; no reset/restore occurs until explicit retry or re-confirmed proceed-without. If a saved backup succeeds but activation fails, report its existence and active-data state accurately. Receipts bind the choice and backup without duplicate copies on retry.
3. **Welcome restore:** Save household with active accounts, profiles/order, both work kinds, future plans, locked history, personal tasks/promotion, groups/calendar and setup progress. Reset, restart the server, authenticate owner recovery at Welcome, restore and sign in to the preserved manager/household. All data semantics match except intentionally retired authority and fresh epoch.
4. **Settings restore:** Replace a different newly configured household with the saved one; preview correctly identifies both. Verify completion metadata, history snapshots, future assignment anchors and optional pre-restore backup.
5. **Credential resurrection:** Test human/display cookies, setup/invitation/password-reset tokens and queued commands captured before backup, after backup and before restore. None regains authority after restore. Device authorship remains readable; walls require enrollment again. Old membership IDs/generation cannot revive old queues after new sign-in.
6. **Compatibility:** Upgrade copies of through-017 and through-018/A backups, restore a current B backup, and retry after failure. Upgrade an existing populated A control database and repeat that upgrade safely. Check FK/integrity and unchanged source bytes. Reject newer, corrupt, tampered, unknown and multi-household images without touching current data. Register a valid legacy operator backup through protected UI; reject unsafe file paths and control/active-image aliases.
7. **Crash and concurrency:** Real server close/reopen at candidate creation, migration, credential scrub, activation, result and cleanup boundaries; retain intact old or committed new state. Race ordinary saves, reset, backup delete and restore. Verify type-correct pending-operation recovery for reset versus restore, and cleanup across successive mixed reset/restore epochs. No double activation, lost active DB, false success, reset-shaped restore result or completed-operation replay onto new work.
8. **Recovery UX:** Lost browser response, expired reauth, expired continuation and lost manager password each have a truthful result/owner recovery path. Public Welcome reveals no backup metadata. Reset recovery alone cannot enumerate old snapshots.
9. **Stale clients:** Owner/member/two displays hold old reads and queued work across restore/reconnect/visibility; no prior payload reappears in new scope. Normal same-epoch execution and D-034 clear still pass.
10. **Gates/evaluation:** Exact local `validate:pr`/`validate:rc`, B Chromium/WebKit journeys, desktop/narrow/zoom geometry and built/Vite recovery routes are selected by CI. Record authorized hosted backup/reset/restore/restart evidence and Product hands-on result separately; pending hosted checks remain release gates.

## Dependencies

- P0-008A r1 technically accepted and integrated at `405c5db` (PR #24). B readiness is against this merged A baseline; A's hosted Product evaluation remains a separate release checkpoint.
- Actual deployed volume contents and schema remain unverified until release preparation. Registered server-managed backups are the bounded supported restore source; external/provider exports remain operator disaster-recovery work.

## Relevant decisions

- D-050–D-053; retains D-017/D-034 and all history/display trust boundaries.

## Known risks / assumptions

- Disk-full, locked files, interrupted migration and SQLite runtime handles are material risks; success-path snapshot counts are insufficient evidence.
- Restoring saved roles/password hashes is intentional, while all bearer access is retired. Metadata/preview must make the replacement understandable.

## Engineering readiness

**Reviewed revision:** 2
**Readiness:** READY — consolidated Engineering review against merged A at `405c5db` (planning tip `e34a846`); report `reports/P0-008B-r2-engineering-readiness.md`. No BLOCKER/QUESTION.
**Architecture disposition:** AT2/AT6/AT9 evidence is closed at `34179f7`. FIX REQUIRED remains pending exact `npm run validate:pr` and `npm run validate:rc` results for this tip and corrected Build Report commit/tree metadata; Architecture's PR attempt passed lint/typecheck/unit/integration/build but Chromium e2e stalled and was interrupted, so it is not a pass. See `reports/P0-008B-r2-architecture-review.md`. No deploy/live database work. C/D remain out of scope.

## Revision history

- **r1:** Initial unreleased successor draft preserving optional backup and in-app restore.
- **r2:** Refreshed against merged/accepted A; made the control-store upgrade, serialized backup-before-switch boundary and typed restore recovery explicit, with focused compatibility/concurrency acceptance evidence. Engineering recorded READY (`reports/P0-008B-r2-engineering-readiness.md`); Architecture ACCEPT / PROCEED authorizes implementation.
