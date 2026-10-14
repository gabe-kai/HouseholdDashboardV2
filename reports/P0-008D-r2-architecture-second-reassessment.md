# Architecture Second Reassessment - P0-008D r2

**Date:** 2026-10-13
**Disposition:** FIX REQUIRED — same revision 2
**Reviewed commit:** `3320033`, clean `brief/p0-008d-guided-first-household-day`
**Previous correction/disposition:** `efc1f22` / `abed0e2`
**Contract:** `briefs/p0-008d-guided-first-household-day.md`
**Build Report:** `reports/P0-008D-r2-build-report.md`

## Verified improvements and evidence boundary

Architecture inspected the committed delta, guide/store/schema code, new through-019 fixture and named tests. Independently reran `npx vitest run tests/integration/p0-008d.test.ts --silent`: **13/13 PASS**, exit 0. Inspected Engineering's PR/RC log summaries: 329 unit/integration, 111 Chromium, 176 RC Playwright and 6 Vite. Full gates were not rerun by Architecture; these are Engineering evidence, not an independently repeated gate. No live database/deployment/Git mutation occurred.

The previous changed-scheduled-addition digest omission and no-basis creation path have regression tests and source fixes. Soft loads now honor the dirty branch; local creation retries retain person/work command objects. Weekly/cycle/group/step/addition controls and saved-definition loading were added. Preserve these improvements. They do not close all prior R1–R7 requirements.

## Remaining implementation corrections

### 1. Preserve saved-work meaning and select the intended plan (R1/R4)

`GuidedSetup.tsx:441–563` hydrates `revisions[revisions.length - 1]`. The store returns revisions in ascending effective-date order (`store.ts:8049–8054`), so this may be an upcoming revision. Save always sends `mode: "current"` (`GuidedSetup.tsx:935–966`), silently copying future configuration into today's plan instead of editing the intended current/upcoming entry under existing lifecycle rules.

Hydration drops logical step IDs, scheduled-addition IDs/independent assignment, and assignment anchor/group/exclusion/ring metadata. `buildAssignmentSpec` (`169–208`) resets the anchor to the session date and clears group/exclusion fields. `scheduledAdditionsPayload` (`212–230`) substitutes the parent assignment for every non-inherited addition. Fixed null owners fall back to the manager during hydration (`474–478`). A spelling correction must not assign previously Unassigned work to the manager, reset rotation phase, replace a scheduled owner's plan, or break personalization anchors by dropping step identity. Existing Plan editors retain the relevant domain fields; reuse that preservation rather than reconstructing a lossy subset.

Only `workDefinitionIds[0]` is offered by `hydrateSavedWork`, so Both/later items cannot individually be selected for correction. Hydrated weekly/cycle baselines also differ from loaded values (`529–543`), making some untouched forms dirty.

Recap uses `revisions[0]`, direct member IDs and `effectiveDate` (`404–431`) instead of the effective/current plan, dated group participants and next executable date. A group-only routine reads “no participants”; an old effective date is presented as “next from”; rotating work shows a mode word rather than the actual owner/date. Deleted/ended links need truthful state, not default creation.

**Required:** Select saved definitions and intended schedule explicitly; preserve domain IDs, owner nullability and complete assignment/addition state on ordinary edits. Derive clean baselines from the identical hydrated object. Resolve recap through dated current/next-work truth. Prove title-only edits of cyclic/group-backed/Unassigned/scheduled-owner work, stable personal anchors, Both selection and current-versus-upcoming behavior. These are existing R1/R4 and protected-boundary requirements, not new chore semantics.

### 2. Keep preview faithful to composed work and enforce its basis for edits too (R4)

The routine preview inserts **all** draft step texts into every applicable day's lines/basis (`GuidedSetup.tsx:831–844`), even when applicability filters individual steps. Responsibility lines likewise show base steps only and all addition names on every applicable date (`860–880`), not that date's composed additions/steps/final-owner meaning. This is not a truthful ordered review of executable work.

`guideSaveWork` improves participant/owner-day comparison, but optional window/version fields still fall back to first-day checks (`store.ts:1360–1455`); step/addition text fields in the basis are not compared to the draft/composition. Group version checks are conditional on a supplied version. More importantly, **saved-definition edits bypass `guideSaveWork` entirely** and call ordinary revision routes with no preview basis, date/epoch intent or immutable guide command (`GuidedSetup.tsx:929–989`). The new review consent can therefore become stale during an edit even though creation has some checks.

**Required:** Review actual date-specific filtered/composed ordered steps and final owners, including later known dates. Use a coherent authoritative date/source/draft basis that is checked atomically for both guide creations and saved edits. Preserve normal Plan behavior outside the guide. Complete the original controlled-date AT5 and held-review/source/day-change assertions; don't substitute only the group-union and no-basis tests.

### 3. Finish shared async arbitration and failed-command recovery (R3/R5)

`loadGuide` checks generation/epoch before `await hydrateSavedWork` and summary fetches, but those nested fetches apply fields without rechecking the boundary (`548–606`). A dirty edit begun while hydration is held can still be overwritten; an older load can finish after a newer one. Dirty soft loads also replace `progress` with the new version instead of retaining the draft's original command baseline (`589–595`).

Person/work **creation** have pending-command refs, but saved edits, school/progress/finish commands still reconstruct their versions/payloads; edits generate a new mutation ID each attempt. Save continuations do not check a shared session/epoch/request/version fence and don't invalidate older loads. The one-event `suppressSoftLoadRef` is not causal ordering: it can consume another manager's notification or a visibility event while a stale load remains in flight.

Pending person/work commands are kept after every error, including definitive validation/conflict. Editing the form and pressing Save can resubmit the original failed command instead of the corrected values unless the entire draft is discarded. Keep ambiguous retry immutable, but distinguish it from a known rejected/new command without losing the user's corrections.

**Required:** Arbitrate the whole load/hydration/preview/save chain; pin dirty baselines until explicit review, retire late scope changes, and give retry versus edit-after-rejection a deterministic path. Prove dropped-success/restart recovery, definitive-error correction, held hydration/save, two-manager newer/older ordering, actual socket loss/reconnect and reset/restore/authority retirement. Keep the improved soft-load and creation-command foundations.

## Required evidence still not delivered (R2/R6/R7)

| Claimed closure | What the current named test actually proves | Required remainder from r2 |
| --- | --- | --- |
| AT6 lock race | Two sequential guide saves; stale guide version conflicts (`p0-008d.test.ts:740`). No occurrence/action is started. | Guide calendar change versus another context's first action; started/history preservation and unstarted reconciliation. |
| AT8 foreign/display denial | Invalid member cookie and unauthenticated write (`788`). No valid foreign session or display principal is used. | Real principal/capability denial matrix, lifecycle-only member, loss of authority and held responses across epoch changes. |
| AT9 sync/reconnect | One context dispatches synthetic visibility and checks one field after a 500ms wait (`z-p0-008d-guided-setup.spec.ts:244`). | Two managers, authoritative change, actual socket outage/reconnect, convergence/conflict and delayed-order assertions. |
| AT10 complete lifecycle | Setup, weekly work/edit, then Settings visibility (`183–242`). Not even a backup is created. | The already specified ordinary-UI invite/redeem → permissions/revoke/restore → unused/used removal → backup → reset off → protected Welcome restore → fresh sign-in journey, Chromium and WebKit. |
| AT11 staged restore | Migrate a fixture and call `scrubRestoredAccess` directly on it; separately scrub a harness and redeem one restore-sign-in claim (`810`). No B restore/staging/activation is called and no source-copy hash is checked. | Actual B lifecycle through supported 017/018/019/D snapshots; exact D progress/links/dismissal, source immutability, all three unexpired claim purposes preview/redemption denial, fresh-link recovery and reset/clear preservation. |

The through-019 AT1 fixture is an improvement; remaining no-A-progress actual adoption, custom-grant/history/calendar/control-catalog preservation assertions still need named evidence. AT7 remains person + routine deletion, not both kinds and used/departed/ended returns. AT12 desktop/guide geometry and keyboard/touch/focus assertions were not expanded in this correction. Map genuine reused assertions precisely, not by broad suite name.

The report now labels these broader ATs PASS despite narrower evidence. Restore **PARTIAL/NOT RUN** for missing subcases, pin committed correction `3320033` and report only demonstrated closures. This is not a request to rerun full gates for metadata: after substantive fixes and required evidence, run exact PR/RC on the final returned tree.

## Next owner and scope

**Engineering — FIX REQUIRED, unchanged P0-008D r2.** Close the remaining requirements above; no new readiness/revision or Product decision is needed. The parent end-to-end lifecycle has been required in the brief and both prior reviews; do not replace it with another narrower test using the same AT number. If a required scenario cannot be delivered, return the concrete limitation instead of claiming closure.

No production code was edited by Architecture. Shared card **Set up and manage my household without operator help** remains **In Progress**. No merge, deployment, live reset or Product acceptance is implied. Suggest a commit message but do not commit.
