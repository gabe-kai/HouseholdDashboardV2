# Architecture Review - P0-008B r2

**Date:** 2026-10-05  
**Initial brief disposition:** ACCEPT / PROCEED
**Latest implementation review:** FIX REQUIRED
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
