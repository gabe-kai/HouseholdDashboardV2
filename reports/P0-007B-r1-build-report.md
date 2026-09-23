# Build Report - BRIEF P0-007B r1

**Brief revision implemented:** 1  
**Engineering status:** FIX REQUIRED closed (local; awaiting Architecture re-acceptance)  
**Branch:** `brief/p0-007b-assignment-patterns-scheduled-work`  
**Base:** Architecture ACCEPT/PROCEED `ee71cf7`; integrated main parent **`51322e0`**  
**Prior implementation tip:** `32eca70`  
**Architecture review:** `reports/P0-007B-r1-architecture-review.md` (FIX REQUIRED)  
**Corrections (this pass):** uncommitted evidence on the same branch after `d69ef33`  
**Pull request:** N/A  

## Readiness

Contract unchanged; **no new readiness round**. Architecture FIX REQUIRED findings for AT2, AT7, AT9–15 are closed with B-specific automated evidence below. Card **Understand whose turn it is, including deep-clean days** remains **In Progress**.

## What changed (FIX REQUIRED pass)

- **Store / plan:** `shiftPlanAnchorsForBoundaryMove` + `updateResponsibilityPlan`; schedule move shifts cycle anchors (and matching addition anchors) with the boundary; `setResponsibilityPlanFailureHook` / `setGroupUpdateFailureHook`; `previewDraftResponsibility` requires `responsibility.manage`; History LEFT JOIN for Unassigned.
- **Integration:** `tests/integration/p0-007b.test.ts` AT2b (move shifts anchor, delete restores predecessor, DST/travel TZ, restart, reset phase, group arbitration), AT10b (both race orders + injectable plan/group rollback), AT13 (History headings/Unassigned + clear retains anchors), AT14 (preview-draft grant, foreign household, plan-reference cleanup).
- **Domain:** DST/travel weekday cases in `responsibility-assignment.test.ts`.
- **Cleanup:** `has_responsibility_plan_reference` blocker in `cleanup-fixtures.ts`.
- **E2e:** `z-p0-007b-group-eligibility.spec.ts` (AT7), `z-p0-007b-lifecycle.spec.ts` (AT9), `z-p0-007b-offline-live.spec.ts` (AT11/AT12), `z-p0-007b-geometry.spec.ts` (AT15 360/1280/200%); Kitchen WebKit-eligible journey + B screenshots.
- **Screenshots (new only under `reports/p0-007b-r1-screenshots/`):** `06-weekly-preview`, `06-unassigned-activity`, `07-addition-editor`, `07-addition-removed`, `08-kitchen-composed-today`, `09-history-detail` (+ prior `01`–`05`). Prior `p0-005` / `p0-006b` / `p0-006c` / `p0-007a` dirs unchanged.

## Verification performed

| Check | Result |
| --- | --- |
| `npm test` / vitest | **PASS** — **189** tests / **30** files |
| `npm run validate:pr` | **PASS** — see `reports/p0-007b-r1-validate-pr.log` (189 unit + Chromium e2e + Vite) |
| `npm run validate:rc` | **PASS** — see `reports/p0-007b-r1-validate-rc.log` (189 unit + full e2e incl. WebKit + Vite) |
| Prior `p0-005` / `p0-006b` / `p0-006c` / `p0-007a` screenshot dirs | Unchanged in git working tree |
| Current-brief screenshots | `reports/p0-007b-r1-screenshots/` (`01`–`09`, including B-only `06`–`09`) |
| Deployment | **NOT RUN** |

## Acceptance tests (AT1–16)

| AT | Result | Evidence class | Evidence |
| --- | --- | --- | --- |
| 1 - Populated upgrade | **PASS** | Automated | `p0-007b.test.ts` AT1; `p013-fixture.ts` |
| 2 - Assignment/date oracle | **PASS** | Automated | AT2 + **AT2b**: upcoming move shifts `assignment.anchorDate` with boundary; delete restores predecessor owners/indexes; household midnight DST + travel TZ weekday; reopen DB preserves anchors; clear rematerializes same phase; group next-day arbitration with started-today protected. Unit DST/travel cases. |
| 3 - Preview read isolation | **PASS** | Automated | Integration AT3 |
| 4 - Kitchen normal UI | **PASS** | Automated | `z-p0-007b-kitchen-bathroom.spec.ts` Chromium + WebKit |
| 5 - Bathroom normal UI | **PASS** | Automated | Same e2e |
| 6 - Cats and Trash normal UI | **PASS** | Automated | `z-p0-007b-cats-trash.spec.ts` |
| 7 - Eligibility / Unassigned | **PASS** | Automated | Integration AT7 + **e2e** `z-p0-007b-group-eligibility.spec.ts`: linked group + exclusions + pending-access eligibility; membership remove (next-day) + returnee; Unassigned warning → Fixed repair preserves occurrence id; family rename updates preview; referenced-group delete blocked (tombstone/reference) |
| 8 - Composition / overlap | **PASS** | Automated | Integration AT8 + composition unit |
| 9 - Lifecycle / range UI | **PASS** | Automated | **e2e** `z-p0-007b-lifecycle.spec.ts`: remove used Deep Clean prospectively; started history step count retained; Schedule for later edit; occupied-date collision keeps draft; Delete upcoming restores predecessor owners |
| 10 - Lock / race / rollback | **PASS** | Automated | AT10 + **AT10b**: first-action vs revise / group / End in both orders; injectable plan + group failure hooks roll back plan/group, occurrences, receipts together |
| 11 - Offline / replay | **PASS** | Automated | **e2e** AT11: composed Kitchen offline first action → reload → Unassigned replacement owner → reconnect rejects/clears intent without starting Unassigned work; delayed taps + digest/target mismatch |
| 12 - Live convergence | **PASS** | Automated | **e2e** AT12: dual-manager Plan/detail/preview + old/new owner Today converge on Who save; WS suppress/stale + visibility recovery; held stale preview cannot win; dirty draft keeps Who and surfaces conflict |
| 13 - History / reset | **PASS** | Automated | **AT13**: composed headings/Unassigned History after rule change; clear retains plan anchors and rematerialized phase |
| 14 - Authority / reference | **PASS** | Automated | **AT14**: structure vs `responsibility.manage` for create/preview-draft; executor denied; foreign household isolation; `has_responsibility_plan_reference` cleanup blocker |
| 15 - Focused UX / evidence | **PASS** | Automated | Kitchen WebKit-eligible; B screenshots 06–09; `z-p0-007b-geometry.spec.ts` Edit/Upcoming/Add scheduled work at 360, 1280, and 200% text |
| 16 - Regression gates / report | **PASS** | Automated | This report; exact PR/RC logs; prior screenshot dirs unchanged |

## Evidence classes

- **Automated:** Vitest unit/integration; Playwright Chromium (+ WebKit under RC); B screenshots under `p0-007b-r1-screenshots/` only.
- **Manual:** Product clarity of Upcoming / Confirm-and-save (Project Lead evaluation after technical acceptance).
- **Not run:** Hosted/physical-device; production deploy.

## Local evaluation recipe (Kitchen / Cats / Bathroom / Trash)

1. Fresh disposable DB; `npm run db:migrate`; bootstrap manager; enroll Avery/Casey/Jordan.
2. Plan → Kitchen every day, weekly Avery/Casey/…, base three steps, Saturday Deep Clean turns; Confirm preview → create.
3. Expand Upcoming; Saturday 8 items; weekday 3.
4. Bathroom fixed Jordan + Sunday inherit; Cats take turns; Trash fixed Tuesday.
5. Group-backed turn + Unassigned repair via Plan/People; clear activity on disposable data only.

## Suggested commit message (do not commit)

```
P0-007B: close r1 FIX REQUIRED B-specific acceptance evidence

Add AT2b/7/9–15 integration and e2e coverage, schedule-move anchor shift,
plan/group rollback hooks, Unassigned History, and plan-reference cleanup;
keep prior screenshots frozen.
```

## Coordinator / Project Lead next

- Commit on `brief/p0-007b-assignment-patterns-scheduled-work` when ready.
- Architecture re-reviews this corrected Build Report against the same r1 contract.
- Do not merge/deploy until Architecture accepts and Project Lead authorizes.
