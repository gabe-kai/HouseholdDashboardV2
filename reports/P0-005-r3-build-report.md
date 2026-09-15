# Build Report - BRIEF P0-005 r3

**Brief revision implemented:** 3  
**Engineering status:** IMPLEMENTED  
**Branch:** `brief/p0-005-r3-cohesive-routine-management`  
**Base:** integrated `main` @ `5376b51` (r2 implementation `297b2fd`); planning `b0b966e` / readiness `0c832d3`; prior r3 implementation commit `4184a21`  
**FIX REQUIRED close:** Architecture FIX REQUIRED (AT6 UI + Delete-upcoming sticky UI) addressed in this uncommitted delta  
**Implementation commits:** **uncommitted** at this report authoring (Project Lead manages Git)  
**Pull request:** N/A  

## Readiness

**READY** against r3 (`reports/P0-005-r3-engineering-readiness.md`); Architecture **ACCEPT / PROCEED**, then **FIX REQUIRED** for AT6 browser depth and Delete-upcoming client persistence. This report supersedes the prior r3 Build Report for those items. No new readiness review was required.

## What changed (FIX REQUIRED delta)

### Delete upcoming (mutation / client state)
- Root cause: shared list/detail generation plus refresh-driven `loadDetail` could re-apply a same-version GET that still listed the canceled entry after a successful delete, leaving Delete upcoming clickable again.
- Fix: separate list/detail generations; version-aware `applyDetailRoutine` (prefer local when same version has fewer active schedule entries); invalidate in-flight detail fetches on delete; defensively strip the deleted entry id from applied state; use freshest `detailRoutine.version` for `expectedVersion`.
- Regression: `z-routine-lifecycle.spec.ts` asserts the upcoming section and Delete upcoming control are gone, prior plan step remains, and the Starting date line cannot reappear.

### AT6 through normal UI
- Move upcoming earlier/later via Edit upcoming + Starting date (`z-routine-schedule-at6.spec.ts`).
- Occupied-date create collision preserves draft and offers **Choose another date** / **Edit existing change** (server no longer silently retargets schedule-new onto an occupied date).
- Move to today promotes upcoming content onto the current plan subject to locks (store + UI + integration).
- Household-date rollover between editor open and save: client re-reads session, keeps draft, recoverable alert.
- Screenshots `07`–`09` under `reports/p0-005-r3-screenshots/`.

## Behavior delivered

Parents can edit the current plan so unstarted work updates from today through the next intentional boundary; schedule, re-edit, move, and delete upcoming changes through the UI (including collision and date-boundary recovery); delete unused setup or End a used routine; use a calm shared shell with Today / Routines / Household navigation. First-execution locks and personal/group policies from r2 remain.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate` (via PR/RC) | **PASS** — lint + typecheck + Vitest **101** tests / **22** files |
| `npm run validate:pr` | **PASS** — Chromium e2e **21/21** |
| `npm run validate:rc` | **PASS** — Chromium+WebKit e2e **42/42** |
| Hosted / physical device | **NOT RUN** — not required |
| Local validate logs | Present at `reports/p0-005-r3-validate-pr.log` / `...-rc.log` (gitignored `*.log`) |

### Artifact hygiene

| Path | Status |
| --- | --- |
| `reports/p0-004a-r3-screenshots/` | Clean vs HEAD (not rewritten) |
| `reports/p0-004b-r1-screenshots/` | Clean vs HEAD |
| `reports/p0-005-r1-screenshots/` | Clean vs HEAD |
| `reports/p0-005-r2-screenshots/` | Untouched this pass |
| `reports/p0-005-r3-screenshots/` | 01–09 (07–09 added for AT6) |

### Product screenshots (fictional, 390×844)

| File | Evidence |
| --- | --- |
| `01-routines-list.png` | Compact Routines list |
| `02-routine-detail.png` | Read-first detail |
| `03-upcoming-change.png` | Upcoming change section |
| `04-ended-routines.png` | Ended routines secondary list |
| `05-same-day-edit-list.png` | After current-plan save (list) |
| `06-same-day-edit-detail.png` | After current-plan save (detail) |
| `07-upcoming-moved.png` | After moving an upcoming start date |
| `08-schedule-collision.png` | Occupied-date collision with alternatives |
| `09-date-boundary.png` | Household-date rollover conflict (draft kept) |

## Acceptance tests 1–18

| AT | Result | Evidence |
| --- | --- | --- |
| 1 Populated upgrade | **PASS** | Migration count 7; p004b→p005 fixtures; backup→migrate→restore; legacy archive end_mode |
| 2 Current-plan interval | **PASS** | Integration range case; UI Edit routine / Save changes |
| 3 Execution protection | **PASS** | AT19 lock/race retained; started visibility when audience removed; move-to-today preserves started peers |
| 4 Eligibility changes | **PASS (integration + reuse)** | Range reconcile include/exclude; group next-day e2e retained |
| 5 Schedule through UI | **PASS** | Lifecycle schedule for later; thrice-same-date via scheduleEntryId |
| 6 Move/collision/date boundary | **PASS** | `z-routine-schedule-at6.spec.ts` UI: move, collision+draft alternatives, move-to-today, session date rollover; screenshots 07–09 |
| 7 Delete upcoming/fallback | **PASS** | Lifecycle e2e: entry disappears, prior plan governs, Delete upcoming gone; integration A/B/C delete B |
| 8 Step lifecycle/composition | **PASS (partial)** | UI add/reorder/delete steps; personal fallback domain retained |
| 9 Permanent deletion | **PASS** | Lifecycle e2e delete unused; integration deny-with-started |
| 10 End/history | **PASS** | End e2e + integration cancel today unstarted; legacy cutoff preserved |
| 11 Transactions/authority | **PASS (extended)** | Route-policy + prior HTTP matrix; lifecycle kinds; occupied-date CONFLICT details |
| 12 Pending/offline recovery | **PASS (reused + retained)** | Prior outbox/reconnect e2e; mergeAuthoritativeOccurrence |
| 13 Live projections | **PASS (adapted)** | Dual-view group/routine e2e; sync invalidation retained; delete no longer restored by raced refresh |
| 14 Read-first UX | **PASS** | List/detail/upcoming/More/local status e2e |
| 15 Navigation/access | **PASS** | Today/Routines/Household nesting; Account sign-out |
| 16 Shared presentation | **PASS (browser + screenshots)** | Tokens/shell; 390px journeys; no prior PNG pollution |
| 17 Full Product journey | **PASS** | Chromium+WebKit lifecycle + AT6 + multi-routine + prior regressions |
| 18 Regression/artifact gates | **PASS** | Exact `validate:pr` / `validate:rc`; prior screenshot dirs clean |

## Deviations / known limitations

- Personal-layer date policy remains tomorrow-floored (unchanged by design).
- Routine restore/reopen deferred per brief.
- Hosted/physical RC not run.
- FIX REQUIRED close remains **uncommitted**.

## FIX REQUIRED

None remaining against the Architecture FIX REQUIRED items (AT6 UI + Delete upcoming sticky state). Architecture technical acceptance of this updated Build Report and Project Lead/product acceptance remain pending.

## Suggested commit message

```
P0-005 r3: fix upcoming delete sticky UI and AT6 schedule journeys

Prevent raced detail refresh from restoring deleted schedule entries;
add UI move/collision/today-promote/date-boundary evidence.
```
