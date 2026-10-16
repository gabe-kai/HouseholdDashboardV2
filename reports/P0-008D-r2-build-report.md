# Build Report - BRIEF P0-008D r2 (fifth reassessment AT5 phase parity)

**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED — awaiting Architecture re-review  
**Branch:** `brief/p0-008d-guided-first-household-day`  
**Committed correction tip:** `02fb313`  
**Fourth reassessment commit:** `9c5927f`  
**Fifth reassessment:** `reports/P0-008D-r2-architecture-fifth-reassessment.md`  
**This evidence update:** working-tree AT5 phase-parity + Build Report on top of `02fb313` / `9c5927f` (Project Lead owns Git)  
**Authorization:** same r2; no contract revision / readiness cycle  
**Pull request:** not opened by this Build Report  

## Retained as closed

AT1 catalog/epoch; AT5 controlled-date and school `nextKnownDate`; routine save parity; C3–C7 from `02fb313`.

## Evidence map (fifth-reassessment remaining item)

| Item | File | Exact test name | Asserted behavior | Project | Result |
| --- | --- | --- | --- | --- | --- |
| AT5 cyclic phase parity | `tests/integration/p0-008d.test.ts` | `C2/AT5: controlled-date preview agrees with saved work and stale consent conflicts` | Two-member `take_turns` ring (`childId`, `siblingId`); draft applicable days show ≥2 distinct owners; after guide save, every draft applicable date matches saved preview for applicability, final owner, ordered work (`stepTexts` / `stepCount`) | integration | **PASS** |
| AT5 weekly phase parity | same | same | Weekly map assigns different owners on Mon vs Tue (and alternating later days); draft vs saved preview compared across those dates for applicability, owner, ordered work | integration | **PASS** |
| AT5 other cases | same | same | Controlled date `2026-03-09`; school `nextKnownDate === schoolStart`; routine parity; fixed/Unassigned single-day parity retained | integration | **PASS** |
| Resolver internals | `tests/integration/p0-007b.test.ts` | AT2 assignment oracle | Cited only for resolver internals; not a substitute for guide preview/save phase parity | integration | **PASS** (cited) |

**Honest remaining PARTIAL:** none for the fifth-reassessment AT5 phase-parity requirement. The Build Report no longer claims “phase” from a one-member ring or same-owner weekly map.

## Verification performed

- `npx vitest run tests/integration/p0-008d.test.ts --silent` — **27 passed**  
- Exact `npm run validate:pr` — **PASS** (`reports/_local-validate-pr-008d-r2g.log`): **343** unit/integration; **119** Chromium Playwright; **6** Vite  
- Exact `npm run validate:rc` — **PASS** (`reports/_local-validate-rc-008d-r2g.log`): **343** unit/integration; **191** Playwright passed (**31** skipped by project filters); **6** Vite  
- Hosted / physical — **NOT RUN** (separate Product checkpoints)

Gate note: an unrelated Chromium `z-p0-007b-group-eligibility` Primary-nav strict-mode ambiguity (two landmarks) was disambiguated with `.first()` so exact PR/RC could complete; not part of the AT5 contract.
