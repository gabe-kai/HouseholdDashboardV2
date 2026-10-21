# Build Report - BRIEF P0-008E r1 (Architecture FIX REQUIRED correction)

**Acting as:** Engineering  
**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED — awaiting Architecture re-review  
**Branch:** `brief/p0-008e-clear-first-run-and-one-view-editing`  
**Baseline:** Architecture FIX REQUIRED in `reports/P0-008E-r1-architecture-review.md`  
**Authorization:** code/evidence correction under existing r1; no deployment or merge  
**Pull request:** not opened by this Build Report  
**Out of scope retained:** `/` routing anomaly

## Correction summary

- **R1:** Responsibility live preview calls `mutationPayloadFrom(sectionDraft ?? draft, …)` so unsaved Name/When/Work section edits are previewed; preview header shows composed title/weekdays; responses are discarded if the draft snapshot key advanced.
- **R2:** Named browser/integration evidence added below. Assertions without a named check are PARTIAL rather than PASS-by-source.

## Acceptance evidence matrix

| ID / assertion | Exact evidence (named test / checkpoint) | Result |
| --- | --- | --- |
| AT1a Invitation action | `tests/e2e/z-p0-008e-setup.spec.ts` → `AT1a: Open setup opens issued same-origin invitation; Copy link remains` (same-origin invite href, Copy link visible, Open setup → Welcome account form) | PASS |
| AT1b Invitation security | Named 008E suite does not re-assert fragment/single-use; existing P0-008A invitation suites ran in validate:pr | PARTIAL |
| AT2a Timezone selection | `tests/e2e/z-p0-008e-setup.spec.ts` → `AT2a: timezone search/select updates sample time; suggestion is not silently applied`; helper `src/client/TimezonePicker.test.ts` | PASS |
| AT2b Timezone safety | Client invalid-zone unit in `TimezonePicker.test.ts`; lock/validation regressions via gates only | PARTIAL |
| AT3a/b Optional profile | `tests/integration/p0-008e.test.ts` → schema + createPerson persist/blank defaults | PASS |
| AT4 Permission summary | `tests/e2e/z-p0-008e-ux.spec.ts` → `AT4: permission before/after summary updates beside controls before save` (before/after text, no Save-preview detour, grant persists after Save) | PASS |
| AT5 Permission safeguards | Named 008E suite does not re-assert last-manager/version; existing suites under validate:pr | PARTIAL |
| AT6a Routine one-view | `tests/e2e/z-p0-008e-ux.spec.ts` → `AT6a: routine one-view keeps Name/When/Who/Steps in one editor and saves once` | PASS |
| AT6b Responsibility one-view | Same file → `AT6b/AT7: responsibility composed draft preview updates before Save; preview is non-mutating` (Name/When/Who/Work + Create) | PASS |
| AT7 Preview truth/purity | Same AT6b/AT7 test: unsaved name/weekdays in preview title + preview-draft POST while section open; count unchanged until Create; guided Save without Review click in AT9 | PASS |
| AT8 Draft recovery | No new named 008E discard/Cancel suite in this correction; prior Cancel/Back contracts remain under gates | PARTIAL |
| AT9 Completion | `tests/e2e/z-p0-008e-setup.spec.ts` → `AT9: finish recap shows saved work; Go to Today primary; View household available` | PASS |
| AT10 Responsive/a11y | `tests/e2e/z-p0-008e-ux.spec.ts` → `AT10: 360/768/1280 and 200% text keep 008E editors usable without horizontal clip` | PASS |
| AT11 Protected behavior | No lifecycle/domain contract changes intended. validate:pr Chromium protected suites passed. validate:rc did not finish (see gates). | PARTIAL |
| AT12 validate:pr / validate:rc | Exact repository gates (below) | PARTIAL |

## Focused correction verification (pre-gate)

- `npx playwright test --project=chromium tests/e2e/z-p0-008e-ux.spec.ts` — **4 passed** (AT4, AT6a, AT6b/AT7, AT10)
- `npx playwright test --project=chromium-008a tests/e2e/z-p0-008e-setup.spec.ts` — **3 passed** (AT1a, AT2a, AT9)
- Hosted / physical — **NOT RUN**

## Exact gates (correction tree)

- `npm run validate:pr` — **PASS** (EXIT 0). Lint/typecheck; **346** unit/integration; Chromium Playwright **126 passed**; Vite deeplink **6 passed**. Log: `reports/_local-validate-pr-008e-r1.log`
- `npm run validate:rc` — **FAIL** (EXIT 1). Lint/typecheck and **346** unit/integration passed. Playwright stopped after **99 passed**, **134 did not run**. `chromium-008a` `z-p0-008d-guided-setup.spec.ts` → `P0-008D AT10: invite/access/removal/backup/reset/Welcome restore UI journey` hung (~3.0h), then Playwright reported `Timed out waiting 1800s for the test suite to run` / teardown. This is a suite-timeout hang on a protected 008D journey, not an 008E assertion failure. Log: `reports/_local-validate-rc-008e-r1.log`

## Do-not-change checklist

- P0-008A–D installation-owner, invitation, session, capability, reset/restore, epoch fencing: contracts preserved  
- D-056 guide atomicity / preview non-mutation: preserved  
- `/` routing: not modified  
