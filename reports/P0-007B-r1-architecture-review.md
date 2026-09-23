# Architecture acceptance review - P0-007B r1

**Disposition:** FIX REQUIRED
**Reviewed implementation:** `32eca70` on `brief/p0-007b-assignment-patterns-scheduled-work`
**Baseline:** `51322e0` (merged P0-007A)
**Contract:** `briefs/p0-007b-assignment-patterns-scheduled-work.md`, revision **1**, unchanged
**Build Report:** `reports/P0-007B-r1-build-report.md`
**Next owner:** Engineering, same revision and branch; no new readiness round
**Card:** **Understand whose turn it is, including deep-clean days** remains **In Progress**.

## Decision

The implementation gates are green and the central Kitchen, Bathroom, Cats and Trash paths are present. Architecture cannot accept r1 yet because the Build Report explicitly marks required B-specific acceptance evidence as PARTIAL or NOT RUN. Prior A evidence may be reused only for unchanged contracts; it does not prove B's new composition, eligibility, offline, live-convergence, History, or reference behavior.

## Required corrections

Close the following against **P0-007B r1** and update the Build Report. Add focused regression evidence where the current result could regress; integration evidence is appropriate for transaction/authority/date oracles, and browser evidence is required for the specified normal UI and connected journeys.

1. **AT2 — assignment/date boundary evidence:** complete the missing cycle boundary, upcoming boundary move/delete, household-midnight/DST, and traveling-browser timezone cases. Prove the durable anchor and opportunity count remain deterministic across restart, repeated preview, completion, reset, and group-version arbitration.

2. **AT7 — group eligibility UI journey:** exercise linked group setup, exclusions, pending-access membership, next-day membership change, same-date winning version, ordered entrant/returnee behavior, family-order/name changes, reference protection/tombstone behavior, and repair of a fixed/weekly missing member through normal UI. Keep the explicit Unassigned result and occurrence identity.

3. **AT9 — scheduled-work lifecycle:** prove through the normal UI that removing used scheduled work is prospective, predecessor/anchor behavior survives upcoming edit/move/delete, and prior composed history remains unchanged. Include the occupied-date/collision path where relevant.

4. **AT10 — lock/race/rollback:** cover both ordering directions for first action versus assignment, group, addition and End changes. Add injectable failure evidence proving plan/group reconciliation, dependent occurrences and receipts roll back together with no notification after failure.

5. **AT11 — B-specific offline/replay:** add the required multi-context Kitchen journey. Queue a composed first action offline, reload, change owner/work or make it Unassigned, reconnect, and prove the old intent is explicitly rejected or acknowledged without moving to replacement work. Include delayed/out-of-order response, replay digest/target mismatch and safe A outbox compatibility.

6. **AT12 — B-specific live convergence:** add two manager Plan/detail/preview contexts and the old/new owner views. Prove pattern/addition save and group membership changes converge without reload, then suppress WS and prove reconnect/visibility recovery. Hold an older preview/detail response and prove it cannot restore obsolete owner/work; dirty drafts retain their pinned versions and recover explicitly.

7. **AT13 — mixed B History/reset:** prove stored History after pattern and scheduled-work changes retains exact final owner, headings, source steps and Unassigned state, with no current-rule reinterpretation or writes. Prove the existing mixed reset retains B configuration/anchors/additions and retires composed activity/outbox state without resetting assignment phase.

8. **AT14 — B authority/reference coverage:** extend the permission and fixture-reference evidence to assignment sources, exclusions, scheduled additions, preview-draft and configuration receipts. Prove structure management, responsibility management, own execution and foreign-household isolation independently; cleanup must not remove referenced people/groups or B history.

9. **AT15 — required browser surface:** provide the required WebKit evidence for the Kitchen journey and capture the specified B screenshots, including weekly/cyclic preview, addition editor, composed Today, Unassigned activity and History detail. Confirm the 360px, 1280px and 200% checks apply to the B controls, not only adapted A screens.

## Accepted evidence

AT1, AT3–6, AT8 and AT16 are materially evidenced in the Build Report, subject to the correction run preserving the reported green gates and prior screenshot hashes. No hosted or physical-device run is required. Product clarity of the preview remains a separate Project Lead evaluation after technical acceptance.

## Return handoff

Return an updated Build Report against the same r1 contract. Do not create a new readiness review or change the brief revision. Do not merge or deploy until Architecture re-reviews the corrected evidence. Keep P0-007C outside the branch.
