# Architecture Technical Acceptance — P0-008D r2

**Date:** 2026-10-15  
**Disposition:** ACCEPTED (technical)  
**Current committed tree inspected:** `brief/p0-008d-guided-first-household-day` at `c5f9867`  
**Brief:** `briefs/p0-008d-guided-first-household-day.md`, revision 2  
**Build Report:** `reports/P0-008D-r2-build-report.md`

## Acceptance basis

The final remaining fifth-reassessment assertion was that guide responsibility review must prove assignment phase parity over multiple dates, rather than relying on a degenerate one-person ring or same-owner weekly map. The committed correction closes it:

- The `take_turns` case uses a two-member saved ring. Draft preview contains at least two applicable dates and both owners; after save, the saved responsibility preview is compared against each reviewed applicable date for applicability, owner, and work. The saved revision's ordered step text is also checked.
- The weekly case assigns different members on Monday and Tuesday and alternates the remaining weekdays. Guide draft preview is compared with the saved preview across reviewed dates for ownership and work.
- The cases remain on the controlled-date guide preview/save path, while the focused suite preserves the other AT5 date, school-start, routine, fixed, and Unassigned evidence.

Architecture independently ran:

```text
npx vitest run tests/integration/p0-008d.test.ts --silent
27 tests passed
```

Engineering reports the final-tree gates as passing: `npm run validate:pr` (343 unit/integration, 119 Chromium e2e, 6 Vite) and `npm run validate:rc` (343 unit/integration, 191 Playwright passed, 31 skipped by project filters, 6 Vite). Architecture did not rerun those full gates. The earlier Build Report correctly describes its evidence as uncommitted at Engineering handoff; the Project Lead subsequently committed the correction as `c5f9867`.

## Limits and next owner

Hosted Railway reset/backup/restore/restart evidence and physical/hands-on Product evaluation were **not run**. These are not reasons to withhold technical acceptance of the local r2 contract, and they are not implied or authorized by this acceptance. Product acceptance remains with the Project Lead.

**Next owner:** Project Lead — evaluate the complete P0-008 journey using `docs/p0-008-release-evaluation.md`, including hosted operations only when separately authorized. Project card **Set up and manage my household without operator help** moves to **Ready to Evaluate**, not Accepted.
