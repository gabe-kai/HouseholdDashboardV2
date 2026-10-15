# Architecture Fourth Reassessment — P0-008D r2

**Date:** 2026-10-15  
**Disposition:** FIX REQUIRED — same revision 2  
**Reviewed commit:** `02fb313` on `brief/p0-008d-guided-first-household-day`  
**Prior reviewed commit:** `9c86257`  
**Build Report:** `reports/P0-008D-r2-build-report.md`  
**Contract:** `briefs/p0-008d-guided-first-household-day.md`

## Assessment

This consolidated correction closes the prior C1–C7 findings substantially. Architecture independently ran `npx vitest run tests/integration/p0-008d.test.ts --silent` on `02fb313`: **27/27 passed**. Engineering reports exact `validate:pr` and `validate:rc` passes (343 unit/integration; 119 Chromium and 191 Playwright respectively; 6 Vite each). Architecture did not rerun the full PR/RC gates. No hosted service, Railway database, deployment, reset, or live data was touched.

The named reset/restore fences, supported snapshot generations, guide return truth, presentation evidence and final gate selection are now adequately mapped for C3–C7. The remaining items below are specific AT1/AT5 assertions in the unchanged r2 contract, plus a factual Build Report metadata correction. This is not a request to repeat the full C1–C7 suite or broaden product behavior.

## Remaining closure

### C1 — AT1: prove an existing control catalog survives populated adoption

The new populated through-019 test uses a fresh `INSTALLATION_CONTROL_PATH`, opens the migrated installation, and only then creates a backup/catalog entry. Calling `migrate(h.db)` again and finding that newly created entry proves neither preservation of a pre-existing catalog nor adoption with the installation's existing control store.

Use a populated control store/catalog alongside the through-019 household database before opening/adopting it. Capture the existing catalog entries (including stable IDs and relevant metadata) and installation epoch; after startup/adoption and repeated migration, assert exact catalog equality and unchanged epoch. Existing restore tests prove catalog survival across restore, not this adoption assertion; cite them only for the narrower restore claim.

### C2 — AT5: make the review evidence deterministic and compare saved results

The test named `C2/AT5: controlled-date preview agrees with saved work and stale consent conflicts` derives `today` from `new Date()` rather than a controlled household-date test seam. Make the preview/save test use an explicitly controlled household date in the disposable harness; no production clock service is required.

The school-year starts ten days later, but the assertion accepts either that date or `null` for `nextKnownDate`. Since the test creates a known all-weekday school year beginning at `schoolStart`, require the exact expected next date and assert the corresponding preview day is applicable. Keep the absent-calendar case's explicit unknown reason.

The responsibility matrix currently proves draft preview values for fixed, cyclic, weekly, scheduled-addition ownership and Unassigned, but those cases are not saved and compared with the saved definition's resolver/materialized output. The separate composed-preview test saves one responsibility and proves stale preview-basis rejection, but does not assert persisted owner/phase/ordered steps match preview. Add focused guide-specific parity assertions for the AT5 responsibility cases (the existing P0-007B resolver tests may be cited for resolver internals). Also compare the saved routine's applicable participants and ordered steps to its reviewed preview. Keep these as integration assertions; no additional browser journey is needed.

### Build Report metadata

The current report still says the correction is an uncommitted working tree and retains a suggested-commit block. It is now committed as `02fb313`. Update the report to identify that commit as the correction tip, remove superseded uncommitted/pending wording, and keep the PR/RC evidence and hosted/Product NOT RUN distinction intact.

## Next owner

**Engineering — FIX REQUIRED, P0-008D r2 unchanged.** Close only the C1, C2 and Build Report items above on the existing branch, then return a corrected evidence map. The current 27/27 focused integration pass and reported full PR/RC results are retained; rerun exact PR/RC gates after substantive test changes. No new readiness cycle, brief revision, deployment, or live-data operation is requested. The Project Lead continues to own Git operations.

Technical acceptance, merge, hosted release and Product acceptance remain separate. The shared card **Set up and manage my household without operator help** remains **In Progress**.
