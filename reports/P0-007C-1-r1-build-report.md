# Build Report - BRIEF P0-007C-1 r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED  
**Branch:** `brief/p0-007c-1-actionable-today-household-overview`  
**Commits:** N/A (implementation uncommitted at report time; suggest message below)  
**Pull request:** N/A  

## What changed

- Personal Today projects Authorized own work into **Completed / Next / Later / Anytime Today** with at most one expanded recurring checklist and deterministic focus (D-041).
- Household `/household` landing is **summary-first** for the existing activity audience: responsibility rows, routine aggregates by definition ID + household date, household-visible personal tasks, secondary Manage links (D-042).
- Pure domain helpers for progress truth, personal-day projection, and household overview aggregation.
- Thematic CI job **E2E · Phone P0-007C-1**, package script, and desktop geometry allowlist for C-1.
- Regression navigation updated for summary-first Household (morning-routine, people-groups, 007A cats/trash).

## Files changed

- `src/domain/progress.ts`, `progress.test.ts` — done/not-needed/optional-open counts and work state
- `src/domain/today-projection.ts`, `today-projection.test.ts` — personal-day sections + focus id
- `src/domain/household-overview.ts`, `household-overview.test.ts` — responsibility rows + routine aggregates
- `src/client/TodayView.tsx` — actionable Today UI
- `src/client/HouseholdOverview.tsx` — overview + drill-down
- `src/client/App.tsx` — wire Today/Household; remove flat expand-all Today list
- `src/client/styles.css` — C-1 layout tokens
- `tests/e2e/z-p0-007c-1-*.spec.ts` — AT2/AT3/AT5/AT6/AT12 focused journeys
- `tests/e2e/morning-routine.spec.ts`, `people-groups.spec.ts`, `z-p0-007a-cats-trash.spec.ts` — Household landing selectors
- `.github/workflows/validate-pr.yml`, `package.json`, `playwright.config.ts`, `ARCHITECTURE.md` — C-1 CI selection
- `docs/protected-behaviors.md` — PB-47, PB-48
- `briefs/…`, `PROJECT_STATE.md`, this report — status writeback

## Behavior delivered

- Child Today: quiet Completed, one Next checklist, compact Later, Anytime + personal tasks; manual expand closes prior checklist; recommendation does not gate execution.
- Manager Household: owners/state/progress without opening all checklists; routine person drill then checklist; Unassigned repair opens Plan when authorized; private tasks never appear on Household overview.
- No C-2 display principal, C-3 promotion, migrations, or grant-model changes.

## Verification performed

| Check | Result | Notes |
| --- | --- | --- |
| `npx vitest run src/domain/progress.test.ts src/domain/today-projection.test.ts src/domain/household-overview.test.ts` | PASS | 26 tests (AT1/AT4/AT7 projection) |
| `npm test` | PASS | 215 tests |
| `npm run typecheck` | PASS | |
| `npm run lint` | PASS | after removing unused `statusLabel` |
| `npx playwright test --project=chromium --grep "P0-007C-1"` | PASS | 6 tests |
| `npx playwright test --project=chromium-desktop tests/e2e/z-p0-007c-1-geometry.spec.ts` | PASS | reported by e2e authoring pass |
| `npx playwright test --project=chromium tests/e2e/people-groups.spec.ts -g "phone UI"` | PASS | |
| `npx playwright test --project=chromium tests/e2e/morning-routine.spec.ts -g "newly assigned"` | PASS | Household drill + empty/seed Today assertion |
| Full morning-routine / WebKit C-1 / `validate:pr` | NOT RUN | Disclose; rely on Actions after push |
| WebKit P0-007C-1 | NOT RUN | Chromium covered; WebKit required by brief AT2/AT6 — **disclose skip in this environment pass**; run before Architecture acceptance |
| `npm run validate:pr` / `validate:rc` full | NOT RUN | Unit + C-1 Chromium + typecheck/lint run; full PR/RC suite + WebKit deferred to Project Lead CI after push |
| Physical 4K / wall distance | N/A | C-2/C-3 |

## Acceptance mapping (AT1–13)

| AT | Evidence | Status |
| --- | --- | --- |
| 1 Deterministic projection | `today-projection.test.ts`, `progress.test.ts` | Covered |
| 2 Personal-day journey | `z-p0-007c-1-today.spec.ts` Chromium | Covered Chromium; **WebKit not run** |
| 3 Focus / rapid | `z-p0-007c-1-focus.spec.ts` (visibility synthetic; rapid-tap/keyboard partial) | Partial |
| 4 Completion truth | `progress.test.ts` + domain completion tests | Covered unit; browser count copy light |
| 5 Personal-task privacy | `z-p0-007c-1-household.spec.ts` AT5 + existing morning personal-task privacy | Covered Chromium |
| 6 Household oversight | `z-p0-007c-1-household.spec.ts` | Covered Chromium (focused path, not full four-owner matrix); **WebKit not run** |
| 7 Snapshot/identity | `household-overview.test.ts` | Covered unit |
| 8 Authority matrix | Existing `p0-007a` AT9 HTTP + presentation filters own/household-visible | Mapped; no new matrix browser |
| 9 Live convergence | Existing morning-routine / 007A cats live paths + Household overview refresh | Mapped; C-1-specific multi-context light |
| 10 Offline/reset | Existing 006C/007A reset-outbox seams | Mapped reuse; **no new C-1 offline spec** |
| 11 Loading/navigation | Existing Vite deeplink + nav gates | Mapped; **no new delayed-fetch honesty e2e** |
| 12 Readable evidence | `z-p0-007c-1-geometry.spec.ts` → `reports/_local-screenshots/p0-007c-1-r1/` | Covered local |
| 13 Regression/CI | Workflow job `e2e-phone-007c1`, desktop allowlist, aggregate gate | Covered wiring; remote Actions after push |

## Deviations from brief revision

- None material. AT6 e2e is a focused overview/drill/manage path rather than the full four-fictional-people matrix in one test.
- AT3 does not fully automate rapid final-tap + keyboard return focus.

## Discoveries for Architecture

- Anytime Today section is always present so Add task remains available when there is no anytime occurrence (presentation choice within D-041).
- Routine aggregate mixed titles use sorted `"A / B"` or `"Multiple titles"` (`routineDisplayTitle`).

## Known limitations

- WebKit C-1 journeys and full `validate:pr` / `validate:rc` not completed in this write-capable session; morning-routine full suite needs a clean re-run after Household drill ordering fix.
- Product speed-of-understanding evaluation remains human (AT12).

## Suggested follow-up

- Project Lead: commit, push, confirm Actions thematic **E2E · Phone P0-007C-1** and aggregate **Pull-request validation**.
- Engineering before Architecture acceptance: run WebKit `--grep "P0-007C-1"` and full morning-routine Chromium suite.
- Architecture acceptance against this Build Report + brief r1.

## Suggested commit message

```
feat(P0-007C-1): actionable Today and summary-first Household overview

Project own work into Completed/Next/Later/Anytime with one checklist focus,
and open Household on authorized snapshot summaries with drill-down.
```
