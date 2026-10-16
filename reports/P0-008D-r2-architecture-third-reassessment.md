# Architecture Third Reassessment — P0-008D r2

**Date:** 2026-10-14  
**Disposition:** FIX REQUIRED — same revision 2  
**Reviewed commit:** `9c86257` on `brief/p0-008d-guided-first-household-day`  
**Build Report:** `reports/P0-008D-r2-build-report.md`  
**Contract:** `briefs/p0-008d-guided-first-household-day.md`

## Assessment

The committed follow-up materially closes the prior AT10 journey gaps and improves async fencing, causal soft refresh, responsibility-preview composition, and named cases for AT6, AT7, AT8, and AT9. The new AT10 browser flow exercises permission change, invitation redemption, work before departure, restore-sign-in redemption, backup, reset-with-backup-off, Welcome restore after restart, and saved guide-work recovery.

Architecture independently ran `npx vitest run tests/integration/p0-008d.test.ts --silent` on `9c86257`: **19/19 passed**. Engineering reports `validate:pr` and `validate:rc` passing with 335 unit/integration tests, 113 Chromium tests, 180 RC Playwright tests, and 6 Vite tests. Architecture did not independently rerun those full gates. No hosted service, Railway database, deployment, reset, or live data was touched.

The remaining gaps below are explicit parts of the r2 acceptance contract, not requests to make every edge case exhaustive. Reuse prior-slice evidence where it demonstrates the same assertion, and cite that exact evidence. The Build Report itself marks several as PARTIAL, so the brief is not yet technically accepted.

## Required closure

This expanded checklist clarifies the existing r2 ATs and prior findings; it adds no product behavior or acceptance requirement. The Build Report's remaining AT7 guide-return partial is included here explicitly, rather than waiting for another review. Repository names and helpers below are starting points, not mandated implementation structure.

### C1 — AT1: verify populated adoption preserves actual data

Extend the populated through-019 fixture and existing migration/adoption tests in `tests/integration/p0-008d.test.ts`. Exercise one image with A progress and one without it. Ensure representative custom grants, started/completed occurrence evidence, calendar editions/exceptions and departed members actually exist before migration.

Capture sorted before/after values for stable person/work/occurrence IDs, membership grants, locked snapshots/reports, calendar rows and departure facts. Apply D migrations twice; compare the values, not only row counts or the existence of a grant before migration. Verify `foreign_key_check` is empty and that only D's intended guide/schema changes occur. Preserve A timestamps; absent historical progress must not acquire invented Account/Household completion times.

With a populated installation-control store/catalog alongside the household DB, assert adoption preserves catalog entries and installation epoch. Use an authorized existing identity to open the guide without requiring another Account/Household wizard or creating demo/duplicate people. Exact prior evidence can close unchanged control-store assertions if the report identifies it.

### C2 — AT5: verify preview, saved work and stale consent agree

Use controlled household dates in disposable tests. Existing draft-preview and guide-save routes are the path under test. No production clock service is requested. A parameterized matrix is sufficient; a separate full browser journey for every pattern is unnecessary.

| Case | Required assertions |
| --- | --- |
| Weekday routine reviewed on a non-applicable day; intentional future start/edit | Correct next applicable/start date; no execution before the intended boundary; current plan is not replaced by a future edit. |
| School-only work excluded today; next school date more than seven days away; calendar absent | Filtered work is omitted today; the later known date is real; unknown context has an explicit reason instead of an invented date. |
| Routine assigned only to children, including group audience | Preview and saved work resolve the same child IDs/names and ordered applicable steps; the manager is not added by default. |
| Fixed, cyclic and weekly responsibility plans | Preview dates, phase, final owner and ordered work match the persisted definition's resolver/materialized work on applicable dates. |
| Scheduled addition with its own assignment; empty eligibility/Unassigned | Composed addition steps appear on the right days; the addition's final owner governs as specified; null ownership remains Unassigned. |
| Reviewed source changes or household midnight passes before Save | The old consent conflicts without saving domain/progress/receipt changes; the draft survives and a fresh review can save. |

For the preview calls, compare database state before/after to prove zero definitions, occurrences, reports, locks or assignment-phase changes. Verify a field correction retains the other draft values. Reuse exact domain tests for resolver internals, while retaining guide-specific assertions for preview/save agreement and review invalidation. Keep the already passing composed-step and no-basis cases.

### C3 — AT8: prove the guide ignores held responses after reset/restore

Add deterministic browser evidence for both lifecycle transitions. Hold a successful old guide-progress response or nested work-detail response **after the server has produced it**, perform reset or restore from another authorized context, let the client reach the new epoch, then release the old response. Holding delivery avoids blocking the server's exclusive lifecycle operation behind the test's own read.

For reset, the released reply must not restore the old household/guide/draft or a success state over Welcome/new setup. For restore, use a snapshot that restores the same record IDs but has different saved guide values from the held body; after fresh sign-in/load, releasing the old body must not overwrite the restored state. Verify inappropriate pending commands cannot write into the new epoch. Cite A/B server-denial tests for unchanged barrier/session mechanics; add the browser assertion for this guide's response fences. Use held responses and observable state, not a sleep followed only by a status-code check.

### C4 — AT11: prove missing backup generations and guide lifecycle state

Construct disposable, genuinely pre-D through-018 and through-019 snapshot files; assert their recorded migration tips before registration. A current image relabeled as an older schema is insufficient. Register and restore each through B's actual catalog/staging/activation API, as the existing through-017 test does. Assert source bytes/digest remain unchanged, D migrations apply successfully, data required by that schema is preserved, installation epoch advances correctly, and owner/catalog state stays outside the household replacement boundary.

Keep the existing actual D restore/all-three-claim-purpose sanitation and fresh-invitation test; do not repeat it for older schemas without those tables. Also add or precisely cite the following guide-specific assertions: reset while optional setup is incomplete produces fresh progress; reset after finish/dismissal produces fresh progress; Clear activity preserves optional statuses, saved person/work links and dismissal/configuration. The corresponding lower-level reset/clear tests close these only if they assert those guide fields.

### C5 — AT7: resolve the remaining guide-return partial

Keep the new unused-responsibility and used-person departure cases. For an ended or deleted linked definition, reopen the guide/recap and assert truthful ended/missing state or omission. Add an unrelated definition with the same title and prove the old stable link does not claim it; retry the retired guide command and prove it cannot recreate the removed work. An exact existing guide-specific test may close this item by citation. P0-005's general End/Delete evidence alone does not show how the guide returns to that linked work.

### C6 — AT12: finish the guide-specific presentation checks

Exercise representative guide screens at 768×1024 and 1280×800, plus 200% text/zoom. Use the longer first-work form, including assignment/scheduled-work controls and review, rather than testing only the shell or an Add-person button. Assert no unintended horizontal overflow or clipped/overlapping controls, clear identity/dates, reachable primary actions and visible focus. Keep the passing 360×800 and route-reload evidence.

Demonstrate keyboard operation with reduced motion and an actual touch-event ordering interaction using the guide's existing drag or Move control; save/reload and assert persisted order. A phone viewport operated by a mouse does not establish touch behavior. Include a focused phone/short-viewport primary-action smoke; label simulated keyboard geometry as such rather than claiming a physical-keyboard observation. Capture fictional representative screenshots under ignored `reports/_local-screenshots/p0-008d-r2/`.

### C7 — AT14: return a complete evidence map and final gates

At the start of this pass, map C1–C6 to named existing or planned tests. Return every required subcase as demonstrated or precisely reused, or explicitly report the concrete limitation as still unresolved. A green full suite cannot close a required subcase the suite does not select. A row with required PARTIAL subcases remains PARTIAL overall.

Update the Engineering-owned Build Report to pin committed correction `9c86257` and describe subsequent working-tree corrections accurately. For every closure cite the test file, exact test name, asserted behavior, selected browser/project when relevant, and result. Keep hosted/physical observations separate. After substantive corrections, run exact `npm run validate:pr` and `npm run validate:rc` on the final returned tree, with D phone Chromium/WebKit and desktop coverage selected. Perform focused tests while developing; return the consolidated pass after all closure items and gates, rather than another handoff closing only some rows.

## Next owner

**Engineering — FIX REQUIRED, P0-008D r2 unchanged.** Complete C1–C7 on the existing branch. No new readiness cycle, brief revision, product decision, deployment, or live-data operation is required. Return the named evidence and corrected Build Report in one consolidated handoff. Suggest a commit message but do not commit. Architecture can then reassess the same contract.

The user-facing card **Set up and manage my household without operator help** remains **In Progress**. Technical acceptance, merge, hosted release, and Product acceptance remain pending.

Suggested commit message (Project Lead manages Git):

```text
P0-008D: close remaining r2 acceptance evidence

Prove populated upgrade preservation, guide review truth, held-epoch
recovery, supported restore generations, and guide geometry; pin the
Build Report to the committed correction.
```
