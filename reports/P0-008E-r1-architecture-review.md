# P0-008E r1 Architecture Review

**Disposition:** FIX REQUIRED  
**Brief:** P0-008E r1  
**Branch:** `brief/p0-008e-clear-first-run-one-view-editing`  
**Build Report reviewed:** `reports/P0-008E-r1-build-report.md`  
**Contract:** unchanged; return directly to Engineering on r1.

## Findings

### R1 — Responsibility live preview does not preview the active section draft

In `src/client/Responsibilities.tsx`, `responsibilityPreviewKey` is derived from `sectionDraft ?? draft`, but the debounced preview calls `mutationPayload(draft.startingDate)`. The Name/When editors keep edits in `sectionDraft` until their Done action copies them into `draft`. Consequently, changing those visible fields triggers a preview request whose payload still contains the prior saved draft values. This fails the P0-008E AT6b/AT7 requirement that changing relevant draft fields immediately updates an authoritative preview.

Use the current composed editor draft as the preview payload, including the active section draft, and ensure preview output is causally tied to the exact draft snapshot that produced it. Add a focused regression that changes at least the responsibility name and schedule while the section editor remains open, and asserts the preview reflects those unsaved values before Save.

### R2 — Required UI evidence is not mapped to named assertions

The Build Report marks the full acceptance matrix PASS, but its evidence entries mostly point to implementation files or aggregate PR/RC gates. The repository changes add a focused integration test for the create-person API/schema and a timezone helper unit test; the existing P0-008C/P0-008D e2e edits shown in the diff update labels or adapt old flows, and do not establish all the new user-visible assertions. In particular, the Build Report does not identify named browser assertions for:

- AT1a: Open setup opens the issued same-origin invitation in the issuing browser while Copy link remains available.
- AT2a: search/selection, explicit confirmation, suggested-zone non-application, and sample-time change.
- AT4: permission before/after summary changes beside the controls before save, and saved grants match it.
- AT6a/AT6b: one persistent editing context with independent draft sections retained and saved, including responsibility assignment/additions.
- AT7: preview changes with unsaved edits and demonstrates no materialization/lock/assignment side effects; Save succeeds without Review.
- AT9: completion recap accurately reflects saved records and completed/skipped/available states, with the specified primary/alternative actions.
- AT10: geometry/accessibility checks on the changed P0-008E surfaces at the matrix viewports and 200% text/zoom.

Add or identify focused named evidence for these assertions and map each assertion (including subcases) to exact tests/checks in the Build Report. Existing broad gates are still required, but a green aggregate suite alone is not evidence for a matrix row. Keep unsupported assertions PARTIAL/NOT RUN rather than claiming PASS.

## Acceptance boundary

- This is a code/evidence correction under the existing r1 contract; no readiness rerun or brief revision is needed.
- Preserve P0-008A–D protected behavior and keep `/` routing out of scope.
- After the focused corrections, rerun exact `npm run validate:pr` and `npm run validate:rc`, and update the Build Report with the corrected-tree evidence and honest per-assertion results.
- No deploy, merge, or commit is authorized by this review.
