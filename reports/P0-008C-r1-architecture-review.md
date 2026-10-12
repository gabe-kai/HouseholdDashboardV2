# Architecture Review - P0-008C r1

**Date:** 2026-10-11  
**Disposition:** FIX REQUIRED  
**Brief:** `briefs/p0-008c-member-access-removal.md`, revision 1  
**Implementation commit:** `aedd416` (`feat(P0-008C): member access, permissions, and safe removal`)  
**Baseline:** `f80d47b`; branch `brief/p0-008c-member-access-removal`  
**Build Report:** `reports/P0-008C-r1-build-report.md`

Architecture reviewed the committed implementation and Build Report. Engineering's exact `validate:pr` and `validate:rc` PASS results are recorded and were not rerun here. This review is based on the checked-in code, test names/content, and Build Report; no Railway/live database operation or deployment was performed.

## Findings

### 1. AT9 / D-054: removal must reconcile affected work and preview the actual next week

`AppStore.previewMemberRemoval` currently returns the person's groups, removal mode, and `canceledUnstartedOccurrencesFrom`; it does not resolve or show the actual next seven household days. `commitMemberRemoval` marks the person departed and calls `cancelUnstartedOccurrencesForMember`, which cancels every unstarted occurrence owned by that person from today forward. It does not reconcile each affected routine/responsibility through the domain resolver as required by the brief.

This misses D-054's explicit outcomes: routines stop creating the departed person's participation, fixed/weekly owners and empty turns become Unassigned, and nonempty cycles resolve using the existing dated phase with the departed person filtered out. The user must see the actual impact and repair path before confirming.

**Required:** Produce the version/date-bound seven-day preview from the authoritative assignment resolver, then atomically reconcile affected current/future unstarted work on departure while preserving occurrence identity and started snapshots. Add evidence for direct/group routines, fixed and weekly responsibilities, cyclic turns, and scheduled additions, including stale preview rejection and Unassigned cases.

### 2. AT10: prove both action-versus-departure orderings

The single `AT9/AT10` integration test checks a stale preview, successful removal, session invalidation, and rejection of a new checklist owned by the departed person. It does not drive a checklist action and departure in both orders, prove that first-action locks/history remain intact, or exercise the departed-owner rejection path through display status and stale receipt replay.

**Required:** Add deterministic tests for action-first and departure-first, covering member and display status commands. Verify action-first preserves the original accountability/steps/actor and becomes non-executable after departure; departure-first cannot create a new lock or report. Confirm stale member/display queues and receipt replays cannot apply after departure, while stored History remains truthful.

### 3. AT11: departed people and their promoted tasks remain in the display projection

`DisplayStore.listHouseholdPeople` selects all memberships for the household without filtering `departed_at`. `listPromotedOpenPersonalTasks` likewise selects household-visible promoted tasks without excluding departed owners. The ordinary removal route closes the removed member's socket and broadcasts member `membership`/`family_order` invalidations, but does not send a display `people` or `tasks` invalidation. Thus an enrolled display can continue rendering the former member and their promoted task, and may not learn of the withdrawal promptly.

**Required:** Exclude departed people and their personal tasks from current display responses, invalidate displays on departure, and add a two-display e2e with held reads/replies plus reconnect/visibility recovery. Assert no departed identity/task reappears and that private task identifiers, titles, and counts never enter a display response or event.

### 4. AT13 / AT14: close the stated backup-race and rollback evidence gaps

The implementation runs fixture remediation under `runtime.withExclusive`, and the optional backup correctly requires `lifecycle.manage`. However, the Build Report says the full race-with-write matrix is lighter than the brief, and AT13 only demonstrates a successful optional backup/removal and an underprivileged denial. AT14's requested injected failure matrix is also explicitly not expanded.

**Required:** Add deterministic evidence that a household write cannot slip between the reviewed fixture preview, optional snapshot, and batch apply; the backup reflects the exact pre-remediation dataset; and retry/recovery cannot create duplicate backups or partially apply removals. Inject failures during the removal/reconciliation transaction and prove grants, membership state, occurrences, access claims, and receipts roll back together. Existing D-017 CLI behavior must remain intact.

### 5. Build Report commit metadata is stale

`reports/P0-008C-r1-build-report.md` says the implementation is an uncommitted working tree and that no Engineering commit exists. The implementation and Build Report are committed at `aedd416` on the published branch.

**Required:** Correct the Build Report to pin `aedd416`, the actual branch/commit state, and current PR state. Do not imply a PR, deployment, or hosted validation unless one exists.

## Disposition

The brief contract remains unchanged. These are implementation/evidence corrections against P0-008C r1; no new readiness cycle or brief revision is required. Engineering should close the findings on the same branch and return an updated Build Report. Architecture will then re-review the corrected code and named evidence. The shared project card remains **In Progress**.

No deployment, live Railway operation, or Product acceptance is authorized by this review.
