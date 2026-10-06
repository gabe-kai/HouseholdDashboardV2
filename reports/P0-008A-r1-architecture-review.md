# Architecture Review - P0-008A r1

**Date:** 2026-10-04
**Disposition:** FIX REQUIRED
**Reviewed brief:** `briefs/p0-008a-protected-first-run-reset.md` revision 1
**Implementation:** `brief/p0-008a-protected-first-run-reset` @ `3448d7d`
**Build Report:** `reports/P0-008A-r1-build-report.md`
**Integrated baseline:** `main` / `origin/main` @ `415d930`; implementation branch is based on planning tip `ece0127`.

## Summary

The feature branch contains a useful first implementation and reports passing `validate:pr` and `validate:rc`. Architecture cannot accept r1 yet: critical operation-recovery/concurrency requirements are contradicted by the current code, and multiple mandatory acceptance tests are explicitly partial or not run. The contract is unchanged; Engineering should address these findings on the same branch and revision. No new readiness round is needed.

Hosted Railway evidence is correctly **NOT RUN** and is not an Architecture acceptance blocker. It remains a release checkpoint. No production database was accessed or changed.

## Required corrections and evidence

1. **Keep the active runtime coherent during reset and recover after activation.** `LifecycleRuntime.withMutex` currently protects `replaceWithEmptyDatabase`, but ordinary application requests do not enter that mutex. The reset path changes the control-store pointer, awaits `afterActivate`, then closes/reopens the database; the app keeps separate `store`/`db` references until `syncRuntimeRefs` runs after replacement returns. A failure at that boundary can leave the running process serving the old handles while control state points to the new image. The operation also remains `pending`; startup adopts the active path but does not finish/reconcile the pending operation. Add a lifecycle barrier or equivalent that quiesces ordinary writers/materialization and in-flight privileged work, swaps all runtime references as one controlled transition, and recovers journal/cleanup state after restart. Exercise concurrent reads/writes and faults before prepare, before activation, after durable activation, after reopen/before response, and during cleanup. For each case, close/reopen the real app and prove it serves one coherent old or new image with an accurate recoverable operation result; no partial success or stale handle may remain.

2. **Make the reset continuation independently recover its one operation.** `GET /api/v1/lifecycle/operations/:id` currently authorizes the continuation only when a valid member session also exists. Reset revokes all member sessions before replacing the database, so the initiator's continuation cannot authorize operation lookup after a lost response. The UI has no demonstrated continuation recovery journey. Give the continuation only the scoped authority promised by the brief—recover this operation/result and resume setup, not general owner or household access. Hold/drop the committed reset response, reload, recover through that cookie without the revoked member session, then create new household data and prove replay cannot erase it. Test wrong operation, other initiator, expiry, reuse with changed source/payload, and lost-cookie owner recovery.

3. **Supply a populated through-017 adoption fixture.** The current AT1 test migrates an empty database twice and separately refuses a database with two households. That does not prove preservation of the required active users, canonical fixture identities, displays, plans, personal work, and locked/history rows. Build the brief's disposable populated fixture, upgrade twice, and compare identities, grants, data, history/locks and pre-existing backup bytes before and after.

4. **Prove a real first-account race.** The test named “race sketch” exchanges the same invitation sequentially and creates one account. It does not submit competing first-account requests concurrently. Run two setup contexts concurrently and show exactly one manager/household is created, with safe retry behavior for the loser and lost response.

5. **Complete owner gate and recovery coverage.** The report marks owner recovery partial. Add named evidence for missing configuration, throttling/limit behavior, setup-ticket replacement/replay, mixed principal/cookie denial, secret rotation invalidating old sessions/tickets, existing sole-manager password recovery without identity/grant/work changes, and retained-data manager establishment when no viable manager exists. Route presence alone does not prove these cases.

6. **Complete setup and reset journeys on the required browsers and after restart.** AT4 requires phone Chromium and WebKit plus desktop setup; the report says the A journey was not run in WebKit, and Playwright intentionally excludes A specs there. Select an A setup journey under WebKit and prove desktop Account→Household completion, not geometry alone. AT5 requires an actual server restart after account save, cross-device resume, and reset during incomplete setup. AT7 requires two resets with the second household populated, no newly created backup, and unchanged saved-backup bytes. Add these explicit journeys/assertions; wiring alone is not PASS.

7. **Close the old-client matrix.** Unit tests for outbox retirement and session epoch rejection do not meet AT10. Use member and display contexts with queued actions and held reads across reset/restart; establish a new household, release/reconnect the old clients, and prove no request, receipt replay, delayed response, queue item, or socket can affect or repopulate the new epoch. Verify visible retirement notices and ordinary same-epoch offline recovery.

8. **Correct Build Report commit metadata.** It currently says `Commits: none yet` / working-tree-only, while the implementation is committed at `3448d7d`. Pin the actual implementation and any correction commits when updating the report.

## Evidence reviewed

- `reports/P0-008A-r1-build-report.md` maps AT1, AT5, AT6, AT8, AT9 and AT10 as partial; AT4 is phone Chromium only. AT9's only named fault test is `beforeActivate`.
- `tests/integration/p0-008a.test.ts`: AT1 empty-database adoption and multi-household refusal; AT3 sequential invitation exchange; AT7 one reset; AT8 stale revoked-session attempt; AT9 only `beforeActivate`.
- `tests/e2e/z-p0-008a-setup-reset.spec.ts`: one Chromium phone setup and one reset.
- `src/server/lifecycle-runtime.ts`: lifecycle-only mutex, pointer activation before reopen, and no pending-operation startup reconciliation.
- `src/server/lifecycle-routes.ts`: reset revokes sessions; operation-status access combines the continuation with a still-valid initiator member session.
- `playwright.config.ts`: the A specs are ignored in the WebKit project.

## Verification boundary

Architecture inspected code, tests and the committed Build Report. `validate:pr` and `validate:rc` results are reported by Engineering; Architecture did not rerun them. Hosted/deployment and live-data operations were not performed. Technical acceptance and Project Lead evaluation remain separate.

## Handoff

Engineering closes the eight items above against **P0-008A r1** on the existing branch, updates the Build Report and returns for Architecture re-review. Do not merge or deploy while FIX REQUIRED. No product contract change or new readiness review is requested. Suggest a commit message but do not commit.

## Re-review after Engineering correction commit

**Date:** 2026-10-05
**Disposition:** FIX REQUIRED (r1 unchanged)
**Implementation tip:** `a27221b` — `fix(P0-008A): lifecycle barrier, continuation recovery, acceptance gaps`

Architecture inspected the committed correction and updated code/tests. The shared request barrier, exclusive replacement, immediate runtime-reference swap after durable activation, startup/status reconciliation, and continuation-only operation lookup are present. The report names evidence for the populated through-017 fixture, concurrent first-account race, owner recovery cases, desktop/WebKit setup, repeated resets, and fault/restart paths. Findings 1–6 are closed.

Two items remain before acceptance:

7. **AT10 remains partial.** The named AT10 integration test proves old member/display sessions and a stale-epoch mutation are rejected after reset/rebuild. The Build Report explicitly says it does not replay the full C-2 multi-context held-read browser matrix. This does not meet brief AT10, which requires queued human and display actions, held reads and an async auth/config write across reset/restart, a new household with reused names, and release/reconnect of old contexts. Evidence must show no stale command, receipt replay, delayed response, snapshot or socket affects/repopulates the new epoch; retired work is visibly explained; normal same-epoch offline retry still works. Add the missing deterministic journey/evidence or identify equivalent existing tests that establish each required assertion.

8. **Build Report metadata remains stale.** Its Commits section still calls the correction pending/working-tree-only and omits committed tip `a27221b`; the closure table likewise says metadata is pending. Correct the report to pin the actual correction commit and remove instructions that the Project Lead still needs to commit it.

No new Engineering readiness round is needed. No behavior contract changed. Hosted evidence remains a release checkpoint; no live database/deployment action was performed. Return to Engineering on the existing branch and r1, then Architecture will re-review these two items together.

## Re-review of findings 7–8 after AT10 closure pass

**Date:** 2026-10-05
**Disposition:** FIX REQUIRED (r1 unchanged)
**Inspected tip:** `bab13b0` — `test(P0-008A): close AT10 old-client matrix; pin a27221b in build report`

The new AT10 integration evidence is useful and proves reset-barrier behavior, post-restart epoch fencing, stale member/display request rejection, and same-epoch mutation idempotency. However, the acceptance contract remains only partially demonstrated:

7. **AT10 is not yet closed.** The test’s `GET /api/v1/meta` request begins while reset holds the exclusive barrier and later returns the new epoch; it is not a response held from an old context and released after the new household is established. Delayed writes are allowed to return `[200, 401]` / `[401, 500]`, so the test does not establish the intended authoritative outcome for every in-flight operation. Outbox notices are asserted by creating local outbox arrays and calling retirement helpers directly; this does not show pending items persisted by a live member/display client being retired and explained in the UI. The test has no display socket or old browser contexts to reconnect. Existing C-2/3A WebSocket tests establish their own sync behavior, but do not demonstrate reset-epoch blanking/revocation, old-client release/reconnect, and no stale response resurrection across this reset. Close with deterministic client/server evidence for those required assertions, or map existing reset-specific tests that do.

8. **Build Report metadata is still inaccurate.** The repository is committed at `bab13b0`, but the Commits list stops at `aebad90`, labels the correction as working-tree-only, and reports `aebad90` as the branch tip. Pin `bab13b0` and update the status/commit wording to reflect the committed files. The report's substantive AT10 mapping should also distinguish proven integration/unit assertions from still-missing browser/socket assertions instead of marking the full AT PASS.

Other prior findings remain closed. Engineering's reported PR/RC gates are recorded but were not rerun by Architecture. No deploy or live database operation was performed. Return to Engineering on the same branch/revision for these two remaining items; then Architecture will re-review.

## Final re-review of findings 7–8

**Date:** 2026-10-05
**Disposition:** ACCEPTED (r1 unchanged)
**Reviewed baseline:** committed tip `bab13b0` plus the current uncommitted closure delta

Finding 7 is closed by the added AT10 evidence. The integration test now holds a previously authenticated `/api/v1/today` read and delayed member/display writes through reset revocation, then requires exact 401 outcomes, verifies zero new-epoch reports/tasks, and proves same-epoch idempotent retry. The dedicated `chromium-008a` multi-context e2e creates real pending member and display outbox items, observes display reset blanking and visible retirement notices, restarts the server, checks that the old member context remains signed out and the wall does not regain the old dashboard, then verifies same-epoch offline retry in the replacement household. The HTTP delay hooks revalidate credentials after the hold; display sockets receive reset invalidation before close. This is sufficient for A's reset-specific old-client contract. The broader multi-wall C-2 matrix remains separate and is not represented as rerun here.

Finding 8 is closed in the updated Build Report: committed tip `bab13b0` is pinned, the current closure delta is explicitly identified as uncommitted, and AT10's evidence boundary is stated without claiming the broader C-2 matrix.

Architecture accepts P0-008A r1 against this reviewed working tree. Engineering reports exact PR/RC passes; Architecture inspected the tests and report but did not rerun them. No hosted deployment or live database operation was performed. Project Lead should commit the reviewed closure before PR/merge. Product evaluation and hosted release evidence remain separate.
