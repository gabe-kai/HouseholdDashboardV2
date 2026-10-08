# Architecture Review - P0-008B r2

**Date:** 2026-10-05  
**Initial brief disposition:** ACCEPT / PROCEED
**Latest implementation review:** ACCEPTED (technical acceptance at evidence tip `34179f7`; docs-only report update `4448c56`)
**Brief:** `briefs/p0-008b-household-backups-in-app-restore.md`, revision 2  
**Engineering readiness:** READY against integrated A at `405c5db`; `reports/P0-008B-r2-engineering-readiness.md`  
**Implementation branch:** `brief/p0-008b-household-backups-in-app-restore`

## Review

Engineering reports no BLOCKER or QUESTION. The readiness review inspected the merged P0-008A baseline and verified that the brief's current-system account matches the repository: A supplies the durable installation control store, active-image replacement, lifecycle barrier, owner/continuation authorization and epoch fences; it has no backup catalog or restore route, and pending-operation reconciliation currently assumes reset-shaped results.

Those are the intended B implementation seams, not contradictions requiring a brief revision. The r2 contract explicitly requires an additive populated-control-store upgrade, serialized optional backup before replacement, restore candidate validation and credential sanitation, fresh installation epoch, typed operation recovery, and Settings/Welcome flows. It gives Engineering discretion over internal schema/helper choices while defining the observable safety and recovery outcomes.

The readiness report maps all ten acceptance tests to feasible repository patterns and identifies control migration, backup/activation ordering, typed recovery, restore barriers, credential retirement, and crash/concurrency behavior as material implementation focus. C and D remain out of scope.

## Acceptance boundary

- Engineering may implement P0-008B r2 on `brief/p0-008b-household-backups-in-app-restore` and return with an evidence-mapped Build Report for technical acceptance.
- Use disposable local installations and the specified PR/RC/CI gates. Do not operate on Railway or any live database, deploy, or claim hosted/Product acceptance under this authorization.
- P0-008A's hosted setup/reset evaluation remains a separate release checkpoint. The actual Railway volume, schema, deployed SHA and backup inventory have not been inspected here.
- The Project Lead owns Git commits and integration; Architecture acceptance is not merge authorization or Product acceptance.

## Implementation review — 2026-10-06

The implementation is committed at `6545c5f` on `brief/p0-008b-household-backups-in-app-restore`. Architecture reviewed the Build Report, implementation diff, lifecycle recovery code, and named tests. Focused checks reported by Engineering are useful, but several required acceptance tests remain partial and the full PR/RC gates were not completed.

### FIX REQUIRED findings

1. **AT7 — Restore recovery must retain a useful truthful result.** In `src/server/lifecycle-runtime.ts`, `recoveredRestoreResponse` reconstructs success after activation advances the epoch. If the route has not persisted its response, it returns `restoredBackup: null` and `preOperationBackup: null`. A continuation can therefore report completed restore without identifying the restored snapshot or a successfully created optional pre-operation backup. Persist enough typed operation intent/result before activation, or otherwise reconstruct those values durably. Add crash/restart evidence after activation and before response completion, including optional backup on/off and the continuation result. The current AT7 test creates a synthetic pending operation after a completed restore; it does not exercise this crash window.

2. **AT2 — Close the optional-backup transaction and failure journey.** The current test proves off→zero and on→one before reset, while the Build Report leaves the write race, backup-failure retry or fresh proceed-without choice, activation-failure truth, and duplicate-free replay partial. Add deterministic race/fault tests proving acknowledged old-epoch writes are included in the snapshot or rejected across the epoch boundary; backup failure leaves the active household usable and offers the contracted retry/re-confirm path; backup-success/activation-failure reports both outcomes; and replay does not create another catalog entry.

3. **AT4 — Demonstrate Settings restore as a browser journey.** API restore plus Settings UI presence does not prove the required second-household replacement preview and resulting sign-in/recovery behavior. Add a normal UI e2e: configure a different current household, select the saved backup in Settings, verify the before/after preview and confirmation, restore, and verify the displayed result and subsequent sign-in state.

4. **AT5 / AT9 — Prove access and stale-client retirement across restore.** Current evidence covers an old member cookie and reuses epoch fencing, but the report calls display/setup-token coverage light and has no dual-display restore e2e. Add explicit restore tests for pre-backup/pre-restore human and display sessions, setup/invitation claims, queued member/display actions and held old reads. Verify actor/history data remains readable as intended, displays require re-enrollment, and no old payload is rendered or applied after reconnect/visibility recovery.

5. **AT6 — Exercise the promised through-017 compatibility boundary.** Admission logic alone does not establish migration compatibility. Add a stable disposable through-017 restore fixture and prove candidate migration, intact source bytes, integrity/FK checks, and rejection of unknown/newer/corrupt/multi-household inputs before activation. The reported helper flake is not a reason to leave this contract untested; stabilize or replace the fixture.

6. **AT7 / AT10 — Run required release-candidate gates and restore fault matrix.** Extend real close/reopen fault evidence across candidate copy/migration, scrub, activation, runtime reopen, operation-result persistence and cleanup; assert either old data remains active or the new epoch is recoverable with the correct typed result. Then run exact `npm run validate:pr` and `npm run validate:rc` and record results. Architecture's local `validate:pr` attempt passed lint, typecheck, all **288** unit/integration tests and production build, but Chromium/Vite produced no output for several minutes and was stopped; it is **not a pass**. RC was not run.

7. **Build Report metadata.** The report still describes the implementation as uncommitted. Update it to pin implementation commit `6545c5f`, the actual branch state and any correction commits, without implying PR/merge or hosted validation.

These are focused r2 recovery and evidence corrections. The approved product boundary and scope do not change. Do not deploy or operate on Railway/live data. Architecture will re-review the corrected Build Report and exact local gates.

No live database or hosted service was accessed. Architecture did not change application code or commit.

## Re-review — 2026-10-07

Engineering's correction is committed at `abe5fff`; implementation remains pinned at `6545c5f`. The updated Build Report reports exact `validate:pr` and `validate:rc` PASS results. Architecture inspected the changed recovery code, the revised Build Report, and named tests; Architecture did not rerun the full gates.

### Closed findings

- **AT7 recovery result:** Restore intent/result metadata is durably recorded before activation. The after-activation fault test closes and reopens the app, then retrieves a typed `household_restore` result, including the restored backup and optional pre-operation backup, through the continuation credential.
- **AT4 Settings restore:** A browser journey replaces a different household, previews both identities, restores the selected snapshot, and verifies sign-in to the restored manager.
- **AT10 gates:** The correction Build Report records exact passing `validate:pr` and `validate:rc` runs. Hosted/live DB work remains explicitly unrun and unauthorized.

### Remaining FIX REQUIRED findings

1. **AT2 — race a real household-data write with the backup boundary.** The added `delayed write` test delays `POST /api/v1/auth/reauthenticate`, then races another reauthentication with reset. It checks status and backup count, but does not race a normal household mutation or inspect the snapshot. Replace or extend it with a deterministic household-data mutation (for example a personal task, routine revision, or setting) and prove that an acknowledged pre-switch write is present in the saved backup, or that the write is rejected across the epoch boundary. Do not accept a successful response for a write absent from both the old active state and the snapshot.

2. **AT6 — prove the remaining restore-admission rejection cases.** Through-017 migration, source-byte preservation, corrupt input and bad digest are now evidenced. The required newer-than-app, unknown migration/schema, and multi-household rejection cases are not named in the current evidence. Add disposable negative fixtures/cases and assert rejection before epoch advancement or active-data change; alternatively mark AT6 partial in the Build Report and complete the required cases before acceptance.

3. **AT9 — prove restore fencing for display work and stale views.** The integration test enrolls two displays, restores, then checks their session endpoints return 401/403; it also checks a post-restore stale member backup-create request is rejected. It does not hold old display reads or queued display checklist work across restore, nor exercise socket close/reconnect/visibility and assert that a stale payload is not rendered or applied. Add focused evidence at the restore epoch boundary for old display pending work and stale reads on the two walls, including recovery/reconnect behavior and no stale data resurfacing. This can reuse the existing P0-007C display harness patterns; a broad redesign or full duplicated matrix is not required.

4. **Build Report metadata:** `reports/P0-008B-r2-build-report.md` still calls the FIX REQUIRED corrections uncommitted, although the correction commit is now `abe5fff`. Pin the actual correction tip and working-tree state; do not imply PR/merge or hosted validation.

The r2 contract and scope remain unchanged. No deploy, Railway operation, or live database access is authorized. C/D remain out of scope. Architecture will re-review the focused corrections and existing exact local gate evidence.

## Re-review — second evidence pass, 2026-10-07

The Project Lead committed the second evidence pass at `34179f7` (`test(P0-008B): close remaining AT2/AT6/AT9 restore evidence`). Architecture inspected the tests and diff. The prior PR/RC passes are pinned to `abe5fff`; the new commit changes `src/server/app.ts` with non-hosted delay/revalidation hooks and adds the AT2/AT6/AT9 integration evidence. Engineering reported the focused `p0-008b.test.ts` suite at **15 passed** and did not rerun PR/RC on `34179f7`.

### Closed findings

- **AT2:** A delayed personal-task creation races reset-with-backup. If acknowledged, the task is asserted in the backup image; if rejected, it is absent from the new active image. This closes the prior reauthentication-only race gap.
- **AT6:** Newer-than-app, unknown-schema and multi-household fixtures are rejected as `UNSUPPORTED`; the test checks epoch, active household state, and catalog remain unchanged.
- **AT9:** Two displays hold dashboard reads and checklist writes across restore. Old reads/writes are rejected, no step reports are applied, stale session/dashboard/replay requests remain denied, and queued outbox items are retired for the new epoch.

### Current-tip validation review

Architecture initially ran `npm run validate:pr` at `34179f7`; lint, typecheck, all **296** unit/integration tests, and production build passed, but its Chromium e2e stage appeared silent and was interrupted. Engineering later diagnosed the expected quiet startup of piped Playwright web servers and reported exact detached-tip runs at `34179f7`: `validate:pr` PASS (296 tests, Chromium 104, Vite 5) and `validate:rc` PASS (296 tests, e2e 163, Vite 5). The Build Report update at `4448c56` pins those results and distinguishes the evidence tip from later docs-only branch commits. Architecture inspected the report and commit history; it did not independently rerun the gates after Engineering's pass.

### Final technical disposition — ACCEPTED

The exact PR/RC gate results at `34179f7`, the closed AT2/AT6/AT9 evidence, and Build Report metadata update at `4448c56` satisfy the r2 technical acceptance contract. **P0-008B r2 is technically ACCEPTED.** The branch remains unmerged; this is not merge authorization, hosted deployment, or Product acceptance. The Project Lead owns Git integration. No live database or hosted service was accessed, and no deploy is authorized by this acceptance.
