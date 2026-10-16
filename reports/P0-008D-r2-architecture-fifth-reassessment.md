# Architecture Fifth Reassessment — P0-008D r2

**Date:** 2026-10-15  
**Disposition:** FIX REQUIRED — same revision 2  
**Committed baseline:** `02fb313`  
**Fourth reassessment:** `9c5927f`  
**Engineering evidence update:** working tree on `brief/p0-008d-guided-first-household-day`  
**Build Report:** `reports/P0-008D-r2-build-report.md`

## Assessment

The latest update closes the pre-existing catalog/epoch case, pins the date seam, requires the known school start date, and adds saved-result parity for routine and responsibility drafts. The Build Report now accurately describes its handoff state as uncommitted evidence changes on top of `02fb313`/`9c5927f`; it no longer incorrectly implies that the Project Lead did not commit the earlier correction.

Architecture reran `npx vitest run tests/integration/p0-008d.test.ts --silent`: **27/27 passed**. Engineering reports `validate:pr` and `validate:rc` passing on the evidence update. Architecture did not rerun those full gates. No hosted service or live data was touched.

## Remaining closure — AT5 assignment phase parity

The new saved-preview helper verifies assignment mode and one applicable saved day. However, the “cyclic” case uses a one-member ring (`savedRingOrder: [childId]`), and the weekly map assigns the same child on every weekday. These degenerate fixtures do not demonstrate a phase/owner change across dates or prove that draft review and saved preview agree over a changing assignment sequence.

The Build Report currently says phase parity is demonstrated, but the helper reads only the saved assignment mode, one `accountableMemberId`, and `stepCount`; it does not assert the saved preview's dates or phase. Align that claim with the final evidence map.

Add one focused integration assertion using a two-member rotation and a weekly map with different owners on at least two applicable dates. Compare the draft review with the saved definition's preview for those same dates: applicable dates, final owner, and ordered work. Existing P0-007B AT2 remains valid evidence for resolver internals; this is specifically the guide preview/save path. No additional browser journey is required.

Keep the Build Report honest if any requested subcase remains partial. After this focused change, rerun exact `npm run validate:pr` and `npm run validate:rc` on the final evidence tree.

## Next owner

**Engineering — FIX REQUIRED, P0-008D r2 unchanged.** Close only the AT5 non-degenerate phase-parity assertion and update the evidence map. Do not reopen AT1, the controlled-date/school-date checks, saved routine parity, C3–C7, or the commit timeline. Project Lead owns Git. No new readiness cycle, deployment, or live-data operation is requested.

Technical acceptance and Product acceptance remain separate. The shared card remains **In Progress**.
