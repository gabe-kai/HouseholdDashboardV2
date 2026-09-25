# Engineering Readiness Review - BRIEF P0-007C-1 r1

**Brief revision reviewed:** 1  
**Review round:** Initial consolidated pass  
**Readiness:** READY  
**Repository/Git state checked:** YES  
**Current branch:** `brief/p0-007c-1-actionable-today-household-overview` @ `572eae4` (planning tip)  
**Integrated baseline inspected:** `origin/main` @ **`e8f59b4`** (matches brief Current system SHA; includes PR #19 Today-pin fix and screenshot/history cleanup)  
**Working tree at review:** planning docs only beyond `e8f59b4`; no C-1 implementation sources

> READY is the default when implementation can reasonably proceed. QUESTION/BLOCKER findings must be material, evidenced, and consolidated; ordinary implementation choices are not readiness gates.

## Verdict

**READY.** D-041 and D-042 agree with P0-007C-1 r1. The brief’s **Current system** table matches integrated `main` at `e8f59b4`. Required deltas are presentation/projection and Household landing changes over accepted A/B data and sync ownership—not schema, grant-model, or transport rewrites. C-2/C-3 remain out of scope.

**No BLOCKER. No QUESTION.** Implementation waits for Architecture **ACCEPT / PROCEED** (this review does not authorize coding).

## Decision alignment

| Decision | Brief use | Repo / conflict |
| --- | --- | --- |
| **D-041** | Completed / Next / Later / Anytime; one focus; pure projection; no clock windows; preserve outbox/reset fences | Active for C-1 planning, not implemented; Today expands every incomplete occurrence (`OccurrenceList` default `!completed`) |
| **D-042** | Summary-first `/household` for existing activity audience; responsibility rows; routine aggregates by definition ID + date; snapshot identity; no display principal | Active for C-1 planning; `/household` is a management menu; activity is a local leaf with compact responsibility rows and per-person routine cards |
| **D-021 / D-027 / D-032–D-040** | Preserve dayparts, shell/URLs, profiles/order, History, reset, responsibility identity/authority/assignment | Present on baseline; brief does not reopen them |

## Current-system claim check

| Claim | Evidence | Verdict |
| --- | --- | --- |
| Baseline `e8f59b4` | `origin/main` tip; merge-base ancestor of planning tip | Match |
| `projectedOwn` = signed-in accountable only; personal tasks filtered to owner | `App.tsx` filter on `accountableMemberId === session.member.id`; Today tasks filter `ownerMembershipId` | Match |
| Incomplete occurrences expand by default | `OccurrenceList` `expanded[id] ?? !occurrence.completed` | Match |
| Dayparts + order without clock windows; domain completion | `src/domain/daypart.ts`, `completion.ts` (+ tests) | Match |
| `/household` root is management menu; activity is local leaf | `nav.ts` `/household`; `HOUSEHOLD_MENU_ITEMS`; `householdLeaf === "activity"` | Match |
| Activity already has compact responsibility rows; routines are per-person expandable cards | `PeopleGroups.tsx` Household activity | Match |
| `materializeForDate` filters by manage/execute-own per kind | `store.ts` grant gates + result filter | Match |
| Personal tasks: owner/title/visibility/status; no daypart/due; list = own private + household-visible; status not on checklist outbox | `listTasks` / `setTaskStatus`; `PersonalTasksSection` direct API | Match |
| History/settings/people URLs and dirty-leave survive as destinations | `nav.ts`, `gateLocation`, editor dirty confirm paths | Match |
| Thematic CI selects pre-007 / 007A / 007B only; desktop allowlist; aggregate `Pull-request validation` | `.github/workflows/validate-pr.yml`; `playwright.config.ts` `chromium-desktop` `testMatch`; no `P0-007C` grep/job | Match |
| Screenshots local-only under `reports/_local-screenshots/` | `reports/README.md`; `.gitignore`; no tracked `reports/p0-007*` PNGs on `origin/main` | Match |

No Current-system factual contradiction requiring Architecture revision. Inspected tree advanced only by already-integrated A/B + e2e pin/CI/screenshot cleanup; nothing material changes C-1 contract assumptions.

## Focused attention areas

### Personal-day projection and one-focus expansion

**Repo today:** Reconciled occurrences drive a flat list; all incomplete cards expand. Ordering is daypart then definition ID (`compareOccurrenceOrder`); no occurrence-ID tie-break and no Next/Later/Anytime sections. Personal tasks sit below in `PersonalTasksSection` (open vs completed collapse).

**Brief / D-041:** Pure client projection with deterministic Next (in-progress preference, then daypart/definition/occurrence-ID), Later, Anytime (occurrences + open tasks), quiet Completed; normally one expanded recurring checklist; respect manual expand/collapse across sync; pending final taps stay actionable.

**Disposition:** Intentional presentation work. Prefer small pure helpers + unit AT1 beside existing `daypart`/`completion`/`reconcile` tests. IMPORTANT only as implementation care: keep session/outbox/sync ownership above any extracted Today view; do not remount App sync when swapping focus.

### Household summary-first landing and routine aggregates

**Repo today:** Menu-first `/household`. Activity leaf lists one row per responsibility occurrence (good) and one expandable checklist per routine occurrence (not aggregated). `progressCounts` is `completed/total` step statuses only (does not surface Not needed separately). Audience gate uses client `manager` (shared manage **or** enroll/decide/structure); server still returns only grant-authorized occurrences.

**Brief / D-042:** Landing is summary-first for that audience; routine groups keyed by **definition ID + household date** with completed/applicable-person counts; drill-down people then checklist; return restores origin focus/scroll; management links secondary.

**Disposition:** Clear contract. Ordinary choices: extract overview component vs evolve activity leaf; mixed-title aggregate label text; scroll/focus restoration mechanics. NOTE: enroll-only “manager” may open an empty/partial overview when lacking work grants—empty/loading honesty already required by AT11; do not widen API reads via the client flag.

### Progress / completion truth in compact copy

**Repo today:** Domain `isOccurrenceComplete` treats optional-open as non-blocking; activity UI counts only `status === "completed"` toward `n/total`.

**Brief §3 / AT4:** Distinguish Done vs Not needed; do not imply optional-open was performed; keep person counts distinct from step counts.

**Disposition:** Presentation/count helpers must consume domain semantics explicitly. Ordinary Engineering work; covered by AT4.

### CI selection for C-1 evidence

**Repo today:** Phone jobs `grep "P0-007A"` / `"P0-007B"` / invert `P0-007`. Desktop `testMatch` allowlist ends at `z-p0-007b-geometry.spec.ts`. `package.json` has matching phone scripts. A suite titled `P0-007C` would miss every thematic phone job and desktop allowlist.

**Brief AT13 / implementation boundary:** Explicitly select C-1 phone + desktop evidence; retain prior suites and aggregate gate name `Pull-request validation`.

**Disposition:** **IMPORTANT** delivery item (not a blocker): add workflow job and/or grep (e.g. `P0-007C-1`), desktop `testMatch` entry, and package script(s) in the same implementation. Prefer titles that do not collide with a future bare `P0-007C` umbrella.

### Regression surface and local screenshots

Existing e2e asserts flat `.occurrence` expansion, Household activity navigation via menu → activity leaf, and compact-activity selectors. Updating those selectors is in-boundary. New captures go to ignored `reports/_local-screenshots/p0-007c-1-r1/`; do not reintroduce tracked PNGs. Legacy tests that still write old tracked paths should be narrowly redirected/disabled for capture only.

## Acceptance-test feasibility (AT1–13)

| AT | Feasible on baseline? | Notes |
| --- | --- | --- |
| 1 Projection unit | Yes | New pure helpers; vary TZ/order without fake clocks |
| 2 Personal-day journey | Yes | Chromium + WebKit; seed via API, act via UI |
| 3 Focus / rapid / keyboard | Yes | Reuse outbox/sync seams |
| 4 Completion truth | Yes | Domain + browser counts |
| 5 Personal-task parity/privacy | Yes | Existing API privacy + UI; no new task history |
| 6 Household oversight | Yes | Chromium + WebKit multi-person fixtures |
| 7 Snapshot/identity edges | Yes | Projection + browser; Unassigned already supported |
| 8 Authority matrix | Yes | Map to existing integration/security; add gaps only where presentation could leak |
| 9 Live convergence | Yes | Multi-context pattern from 007A/B |
| 10 Offline/reset | Yes | Existing abort/clear seams |
| 11 Loading/navigation | Yes | Vite deeplink pattern exists; extend for `/today`/`/household` |
| 12 Readable evidence | Yes | Local-only dir; Product speed judgment separate |
| 13 Regression/CI | Yes | Requires explicit C-1 CI wiring (IMPORTANT above) |

## Scope confirmation

- **In:** Today/Household presentation, pure projection helpers/tests, checklist/personal-task chrome reuse, styles/nav as needed, protected-behavior catalog updates, CI selection for C-1.
- **Out:** C-2 display principal; C-3 shared execution/promotion; migrations; new grants; exact-time urgency; Plan authoring; tracked screenshot commits.

## Status for Architecture

**Readiness: READY** for P0-007C-1 revision 1 against integrated `main` @ `e8f59b4`.

Await **ACCEPT / PROCEED** before implementation. After that response, Engineering expects to build without another ordinary QUESTION/BLOCKER cycle unless a genuinely new repository fact appears.

## Suggested commit message (planning writeback only; not committed by this review)

```
docs(P0-007C-1): record Engineering readiness READY for r1
```
