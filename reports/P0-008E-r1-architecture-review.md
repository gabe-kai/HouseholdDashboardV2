# P0-008E r1 Architecture Review

**Disposition:** ACCEPTED (technical acceptance; fifth review)
**Brief:** P0-008E r1  
**Branch:** `brief/p0-008e-clear-first-run-one-view-editing`  
**Build Report reviewed:** `reports/P0-008E-r1-build-report.md` (AT10 correction pass)
**Contract:** unchanged; return directly to Engineering on r1.

## Findings

### Closed — R1 responsibility preview source

The correction now captures `composedPreviewDraft = sectionDraft ?? draft`, sends it to the preview endpoint, and rejects responses whose snapshot is stale. The named AT6b/AT7 test asserts unsaved Name/When values in the preview and request before Save. R1 is closed.

### Closed — R2 named UI evidence

The correction adds named UI tests for AT1a, AT2a, AT4, AT6a, AT6b/AT7, AT9, and AT10. These demonstrate the named assertions reported as PASS. R2 is closed for those rows.

### Closed — R3 date-rollover retry loop and AT8 evidence

The correction now opens an explicit rollover confirmation, displays the new date, refreshes the preview on the new basis, disables the primary Save/Create button, and only saves after Confirm. It rebases an implicit start date and preserves an explicit later start date. Named AT8 tests verify the persisted date, explicit future-start preservation, and duplicate-free confirmation. R3 is closed.

### Closed — R4 matrix evidence and validation gates

The Build Report now maps named evidence to AT3a/b, AT6a/b, AT7, AT8, and AT9; the cited tests cover the required subassertions described there. Both exact `validate:pr` and `validate:rc` runs report PASS. The correction evidence is acceptable for those rows.

### Closed — R5 AT10 horizontal overflow on People and permissions

The correction constrains fieldsets, form controls, choice rows, and People focused layouts. The named AT10 browser test now checks both document scroll width and in-flow element bounds against the viewport, including People add-person and permissions at 360px; its setup/guided journey checks document overflow at 360px. The focused AT10 reruns pass. The new assertion is meaningful for the previously reported issue: it catches both scrollable document overflow and in-flow content extending beyond the viewport.

The ≥36px target and focus checks remain. Engineering reports the focused Chromium AT10 journeys passing and exact `npm run validate:pr` and `npm run validate:rc` passing on this tree. AT10 is accepted.

## Disposition

All required evidence rows in P0-008E r1 are now sufficiently mapped and demonstrated. Technical acceptance is **ACCEPTED**. Product acceptance remains with the Project Lead after hands-on evaluation; this does not authorize deployment or merge.

## Acceptance boundary

- This is a code/evidence correction under the existing r1 contract; no readiness rerun or brief revision is needed.
- Preserve P0-008A–D protected behavior and keep `/` routing out of scope.
- Engineering reports exact PR/RC gates PASS; Architecture inspected the named AT10 assertions and report mapping but did not independently rerun the full suites.
- No deploy or merge is authorized by this review. Project Lead owns Git operations.
