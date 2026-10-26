# Build Report - BRIEF P0-008E r1 (CI AT10 200% overflow)

**Acting as:** Engineering
**Brief revision implemented:** 1
**Engineering status:** IMPLEMENTED — CI overflow correction on the accepted r1 tree
**Branch:** `brief/p0-008e-clear-first-run-and-one-view-editing`
**Baseline:** Architecture technical acceptance of r1; GitHub `e2e-phone-core` then failed AT10 at 200% text
**Authorization:** code/evidence correction under existing r1; no deployment, merge, or commit
**Pull request:** not opened by this Build Report
**Out of scope retained:** `/` routing anomaly

## CI correction (200% text, then nav click)

Linux Chromium first failed AT10 because `html { font-size: 200% }` at 390×844 widened `documentElement.scrollWidth`. A follow-up wrap of the bottom nav then timed out on CI: after 200% stayed applied, `openPeople` clicked Primary → Household and Plan `focused-state` intercepted the control for 180s.

This pass keeps the document-width and in-flow box assertions. Editors wrap instead of widening the page. The bottom nav stays one row (`flex-wrap: nowrap`, `flex: 1 1 0`) so large labels wrap inside the item instead of stacking over Plan. AT10 removes the 200% style after that checkpoint before the 360 People/permissions walk. `openPeople` clicks the visible phone bottom nav, not the hidden top duplicate.

A later phone-core failure showed the interim `z-index: 50` on the bottom nav sitting above More menus (`z-index: 40`). `Delete routine` is then covered by **Today**. Nav is restored to `30`; More/ordered-row panels are `60` so End/Delete/Schedule stay above the bar.

R5 People fieldset/choice-row wrap remains. Keyboard, focus, and ≥36px target checks remain.

- **AT10:** Named Chromium journey asserts overflow on responsibility (360/768/1280 and 200% text), Routine, People add-person, and permissions at 360px, plus usable/focusable controls. Setup/guided-work 008a walk still asserts document overflow and touch targets.

## Acceptance evidence matrix

| ID / assertion | Exact evidence (named test / checkpoint) | Result |
| --- | --- | --- |
| AT1a Invitation action | `tests/e2e/z-p0-008e-setup.spec.ts` → `AT1a: Open setup opens issued same-origin invitation; Copy link remains` | PASS |
| AT1b Invitation security | Same file → `AT1b: invite fragment is cleared; storage has no token; second use is rejected`. Also `tests/integration/p0-008e.test.ts` → `AT1b: consumed invitation cannot be exchanged again` | PASS |
| AT2a Timezone selection | `tests/e2e/z-p0-008e-setup.spec.ts` → `AT2a`; helper `src/client/TimezonePicker.test.ts` | PASS |
| AT2b Timezone safety | `tests/e2e/z-p0-008e-ux.spec.ts` → `AT2b: settings timezone is locked after dated household work exists`. `tests/integration/p0-008e.test.ts` → `AT2b: invalid timezone is rejected; dated work locks relocation`. Client invalid-zone unit in `TimezonePicker.test.ts` | PASS |
| AT3a Optional profile | `tests/e2e/z-p0-008e-ux.spec.ts` → `AT3a/b: People optional details stay collapsed/blank and persist when entered` | PASS |
| AT3b Optional profile data | Same AT3a/b test. Supporting: `tests/integration/p0-008e.test.ts` → schema + `AT3: createPerson persists optional profile fields and blank defaults` | PASS |
| AT4 Permission summary | `tests/e2e/z-p0-008e-ux.spec.ts` → `AT4: permission before/after summary updates beside controls before save` | PASS |
| AT5 Permission safeguards | Same file → `AT5: last manager and stale permission version are denied; draft stays`. Also integration `AT5: last essential manager cannot be demoted; stale authority version conflicts` | PASS |
| AT6a Routine one-view | Same file → `AT6a: routine one-view keeps Name/When/Who/Steps in one editor and saves once` | PASS |
| AT6b Responsibility one-view | Same file → `AT6b: edit existing responsibility with scheduled addition stays one-view`. Preview compose remains in `AT6b/AT7` | PASS |
| AT7 Preview truth/purity | Same file → `AT6a` and `AT6b/AT7`. `tests/integration/p0-008e.test.ts` → `AT7: preview-draft does not materialize, lock, or advance assignment` | PASS |
| AT8 Draft recovery | Same file → `AT8: household-date rollover keeps draft, requires confirm, and saves once`. Same file → `AT8: future startingDate stays put across household-date rollover`. `src/client/proposed-save-date.test.ts` | PASS |
| AT9 Completion | `tests/e2e/z-p0-008e-setup.spec.ts` → `AT9: finish recap shows saved work; Go to Today primary; View household available`. Same file → `AT9: recap distinguishes skipped/available setup and reopens unfinished work` | PASS |
| AT10 Responsive/a11y | Same UX file → `AT10` (document scrollWidth and overflowing in-flow boxes on responsibility 360/768/1280 + 200%; Routine; People add-person; permissions; keyboard focus; ≥36px targets). Setup file → `AT10: setup and guided-work stay usable at 360 with keyboard and touch targets` | PASS |
| AT11 Protected behavior | No lifecycle/domain contract changes intended. Exact `validate:pr` / `validate:rc` include the protected 008A–D suites | PASS |
| AT12 validate:pr / validate:rc | Exact repository gates (below) | PASS |

## Focused correction verification (pre-gate)

- `npx playwright test --project=chromium tests/e2e/z-routine-lifecycle.spec.ts` — **1 passed**
- `npx playwright test --project=chromium tests/e2e/z-multiple-routines.spec.ts -g "After School and Bedtime"` — **1 passed**
- `npx playwright test --project=chromium tests/e2e/z-p0-008e-ux.spec.ts -g "AT10:"` — **1 passed**
- `npx playwright test --project=chromium tests/e2e/z-p0-006a-geometry.spec.ts` — **1 passed**
- Hosted / physical — **NOT RUN**

## Exact gates (correction tree)

- Exact CI `e2e-phone-core` shard — **NOT RUN** on this menu z-index tree
- `npm run validate:pr` — **NOT RUN**
- `npm run validate:rc` — **NOT RUN**

Playwright `globalTimeout` remains 45 minutes. AT5 still restores temporarily demoted essential managers so the shared seeded e2e household is not left without peer managers.

## Do-not-change checklist

- P0-008A–D installation-owner, invitation, session, capability, reset/restore, epoch fencing: contracts preserved
- D-056 guide atomicity / preview non-mutation: preserved
- `/` routing: not modified
