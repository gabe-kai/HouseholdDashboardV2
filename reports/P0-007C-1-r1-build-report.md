# Build Report - BRIEF P0-007C-1 r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (evidence corrected for Architecture re-acceptance)  
**Branch:** `brief/p0-007c-1-actionable-today-household-overview`  
**Commits:** N/A (implementation uncommitted at report time; suggest message below)  
**Pull request:** N/A  

## What changed

- Personal Today projects Authorized own work into **Completed / Next / Later / Anytime Today** with at most one expanded recurring checklist and deterministic focus (D-041).
- Household `/household` landing is **summary-first** for the existing activity audience: responsibility rows, routine aggregates by definition ID + household date, household-visible personal tasks, secondary Manage links (D-042).
- Pure domain helpers for progress truth, personal-day projection, and household overview aggregation.
- Pending completion pins auto-focus only; **manual expand of another card wins** so offline multi-card first actions remain possible.
- Today/Household show an honest loading status until the first Today read lands (not empty/all-done).
- Thematic CI job **E2E · Phone P0-007C-1**, package script, and desktop geometry allowlist for C-1.
- Regression helpers (`revealChecklist`) and selector updates for one-focus Today across morning-routine / 006 / 007A / 007B suites.

## Files changed

- `src/domain/progress.ts`, `progress.test.ts` — done/not-needed/optional-open counts and work state
- `src/domain/today-projection.ts`, `today-projection.test.ts` — personal-day sections + focus id
- `src/domain/household-overview.ts`, `household-overview.test.ts` — responsibility rows + routine aggregates
- `src/client/TodayView.tsx` — actionable Today UI; pending vs manual focus; loading honesty
- `src/client/HouseholdOverview.tsx` — overview + drill-down; loading honesty
- `src/client/App.tsx` — wire Today/Household; `occurrencesLoaded`
- `src/client/styles.css` — C-1 layout tokens
- `tests/helpers/e2e-shell.ts` — `revealChecklist`, `pinTodayFetches`
- `tests/e2e/z-p0-007c-1-*.spec.ts` — AT2/AT3/AT5/AT6/AT11/AT12 focused journeys
- `tests/e2e/morning-routine.spec.ts`, `people-groups.spec.ts`, and 006/007A/007B e2e updated for compact Today
- `.github/workflows/validate-pr.yml`, `package.json`, `playwright.config.ts`, `ARCHITECTURE.md` — C-1 CI selection
- `docs/protected-behaviors.md` — PB-47, PB-48
- `briefs/…`, `PROJECT_STATE.md`, this report — status writeback

## Behavior delivered

- Child Today: quiet Completed, one Next checklist, compact Later, Anytime + personal tasks; manual expand closes prior checklist; recommendation does not gate execution; rapid final tap retains controls while pending.
- Manager Household: owners/state/progress without opening all checklists; routine person drill then checklist; Unassigned repair opens Plan when authorized; private tasks never appear on Household overview.
- No C-2 display principal, C-3 promotion, migrations, or grant-model changes.

## Verification performed

| Check | Result | Notes |
| --- | --- | --- |
| `npx vitest run src/domain/progress.test.ts src/domain/today-projection.test.ts src/domain/household-overview.test.ts` | PASS | 26 tests (AT1/AT4/AT7 projection) |
| `npm test` | PASS | 215 tests (also via validate) |
| `npm run typecheck` / `npm run lint` | PASS | via `validate` |
| `npx playwright test --project=chromium --grep "P0-007C-1"` | PASS | focus/today/household (incl. AT3 rapid+keyboard, AT11 delayed Today) |
| `npx playwright test --project=webkit --grep "P0-007C-1"` | PASS | **7 passed, 1 skipped** (geometry skipped on WebKit by design; AT2 + AT6 covered) |
| `npx playwright test --project=webkit tests/e2e/z-p0-007c-1-today.spec.ts` | PASS | 2 passed after seed-Morning isolation for Next |
| `npx playwright test --project=chromium-desktop tests/e2e/z-p0-007c-1-geometry.spec.ts` | PASS | AT12 geometry |
| `npx playwright test --project=chromium tests/e2e/morning-routine.spec.ts` | PASS | **12 passed** full Chromium morning-routine regression |
| `npm run validate:pr` | PASS | exit 0; unit 215; Chromium e2e **62 passed** (+ Vite smoke) |
| `npm run validate:rc` | PASS | exit 0; unit 215; Chromium+WebKit e2e **97 passed** (+ Vite smoke) |
| Physical 4K / wall distance | N/A | C-2/C-3 |

## Acceptance mapping (AT1–13)

| AT | Evidence | Result |
| --- | --- | --- |
| 1 Deterministic projection | `progress.test.ts`, `today-projection.test.ts` | PASS (unit; in 215) |
| 2 Personal-day journey | `z-p0-007c-1-today.spec.ts` Chromium + WebKit | PASS both engines |
| 3 Focus / rapid / keyboard | `z-p0-007c-1-focus.spec.ts`: (1) Later focus survives visibility refresh; (2) rapid final tap keeps controls until pending settles + keyboard Enter return focus; (3) included in Chromium/WebKit C-1 greps | PASS |
| 4 Completion truth | `progress.test.ts` + domain completion tests | PASS unit |
| 5 Personal-task privacy | `z-p0-007c-1-household.spec.ts` AT5; `morning-routine.spec.ts` “personal-task UI projects private vs household visibility” | PASS |
| 6 Household oversight | `z-p0-007c-1-household.spec.ts` AT6 Chromium + WebKit | PASS focused overview/drill/manage path (not full four-owner matrix in one test) |
| 7 Snapshot/identity | `household-overview.test.ts` | PASS unit |
| 8 Authority matrix | Existing 007A HTTP/presentation boundaries; overview filters household-visible tasks | Mapped reuse (no new matrix browser) |
| 9 Live convergence | Named: `morning-routine.spec.ts` “newly assigned routine checklist syncs both ways without manual refresh” PASS; “manager sees child progress via sync and recovers after reconnect” PASS; “visibilitychange re-reads authoritative state after missed sync” PASS; `z-p0-007a-cats-trash.spec.ts` live Cats Complete on Household overview PASS (in validate:pr/rc) | PASS via named reuse |
| 10 Offline/reset | Named: `z-p0-006c-reset-outbox.spec.ts` “clear retires pending first-action outbox across contexts” PASS; “same-generation omit retention still keeps pending card” PASS; `z-p0-007a-reset-outbox.spec.ts` “clear retires mixed-kind pending outbox across contexts” PASS | PASS via named reuse |
| 11 Loading/navigation | Named: `z-p0-007c-1-focus.spec.ts` “AT11: delayed Today read is not an all-done result” PASS (Chromium + WebKit C-1); `morning-routine.spec.ts` “pending outbox survives reload during API interruption” PASS; Vite deeplink/nav remain in validate:pr/rc | PASS |
| 12 Readable evidence | `z-p0-007c-1-geometry.spec.ts` → `reports/_local-screenshots/p0-007c-1-r1/` | PASS local geometry; human speed-of-understanding remains Product |
| 13 Regression/CI | Job `e2e-phone-007c1`, desktop allowlist, aggregate gate; local `validate:pr` + `validate:rc` PASS | PASS local; first remote Actions after Project Lead push |

## Deviations from brief revision

- **AT6** browser coverage is a focused overview → drill → manage path, not a single test exercising the full four-fictional-people Kitchen/Cats/Bathroom/Trash matrix.
- **AT8** relies on existing authority/security coverage with named mapping rather than a new C-1-only matrix browser.
- No other material contract deviations. Prior “no material deviations” language that understated skipped WebKit / validate / AT3 / AT9–11 evidence is **corrected** by this report.

## Discoveries for Architecture

- Anytime Today section is always present so Add task remains available when there is no anytime occurrence (presentation choice within D-041).
- Routine aggregate mixed titles use sorted `"A / B"` or `"Multiple titles"` (`routineDisplayTitle`).
- Pending auto-focus must not override manual expand; otherwise offline dual-card first actions cannot reach the second checklist.

## Known limitations

- Product speed-of-understanding evaluation remains human (AT12 Product).
- Remote GitHub Actions evidence follows Project Lead push/PR; not published from this session.
- C-2 / C-3 remain out of scope.

## Suggested follow-up

- Project Lead: commit, push, confirm Actions thematic **E2E · Phone P0-007C-1** and aggregate **Pull-request validation**.
- Architecture re-acceptance against this Build Report + brief r1.

## Suggested commit message

```
feat(P0-007C-1): actionable Today and summary-first Household overview

Project own work into Completed/Next/Later/Anytime with one checklist focus,
and open Household on authorized snapshot summaries with drill-down.
```
