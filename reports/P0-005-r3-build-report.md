# Build Report - BRIEF P0-005 r3

**Brief revision implemented:** 3  
**Engineering status:** IMPLEMENTED  
**Branch:** `brief/p0-005-r3-cohesive-routine-management`  
**Base:** integrated `main` @ `5376b51` (r2 implementation `297b2fd`); planning `b0b966e` / readiness `0c832d3`  
**Implementation commits:** **uncommitted** at this report authoring (Project Lead manages Git)  
**Pull request:** N/A  

## Readiness

**READY** against r3 (`reports/P0-005-r3-engineering-readiness.md`); Architecture **ACCEPT / PROCEED** for local implementation. This report covers the full r3 lifecycle + Calm Household presentation delta on the committed r2 foundation. Prior r1/r2 reports do not certify r3.

## What changed

### Persistence / migration
- `db/migrations/007_routine_schedule_lifecycle.sql`: `routine_schedule_entries`; drop `UNIQUE(definition_id, effective_date)` on revisions (immutable content versions); definition `ended_at` / `end_mode` / `deleted_at`; occurrence `canceled_at`; backfill schedule entries from existing revisions; legacy archive → `end_mode=legacy_archive`.

### Domain / store / API
- `src/domain/plan.ts`: schedule selection, governed ranges, affected-date enumeration.
- `src/server/routine-plan.ts` + store: schedule-aware plan selection; immutable revision inserts with schedule retarget; current-plan **range** reconcile to next boundary; schedule create/edit/move/delete; `endRoutine` (immediate cancel of today unstarted + later + upcoming); `deleteRoutine` (eligibility-gated); started/history visibility when live audience excludes the person; atomic txn + receipts; `PlanRefineOutcome` feedback.
- Routes: `/end`, `/delete`, schedule-entry move/delete; schemas and route-policy updated.
- Preserved: D-023 locks, personal tomorrow-floor, group next-day, pending first-action merge, Origin/CSRF/WS.

### Client
- `Routines.tsx`: read-first current plan from schedule entries; Edit routine / Schedule for later; upcoming Edit/Delete; More → End/Delete; local refineOutcome status (no duplicate ChangeNotice); discard confirm; step reorder via up/down.
- `App.tsx` + styles: Calm warm tokens; Today | Routines | Household nav (phone bottom bar); Household nesting; Account menu sign-out; Local development indicator (no cool-palette switch).

### Evidence / docs
- Integration coverage for range reconcile, schedule thrice, delete B, end, delete unused/forbidden, started visibility (plus prior AT19 lock/race).
- e2e: Household nav updates; `z-routine-lifecycle.spec.ts`; r3 screenshots only under `reports/p0-005-r3-screenshots/`.
- PB-26–30 + sync matrix; ops note for 007.

## Behavior delivered

Parents can edit the current plan so unstarted work updates from today through the next intentional boundary; schedule, re-edit, move, and delete upcoming changes through the UI; delete unused setup or End a used routine (immediate cancel of prospective work while started/history remain); use a calm shared shell with Today / Routines / Household navigation. First-execution locks and personal/group policies from r2 remain.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate` (via PR/RC) | **PASS** — lint + typecheck + Vitest **100** tests / **22** files |
| `npm run validate:pr` | **PASS** — Chromium e2e **20/20** |
| `npm run validate:rc` | **PASS** — Chromium+WebKit e2e **40/40** |
| Hosted / physical device | **NOT RUN** — not required |
| Local validate logs | Present at `reports/p0-005-r3-validate-pr.log` / `...-rc.log` (gitignored `*.log`) |

### Artifact hygiene

| Path | Status |
| --- | --- |
| `reports/p0-004a-r3-screenshots/` | Clean vs HEAD (not rewritten) |
| `reports/p0-004b-r1-screenshots/` | Clean vs HEAD |
| `reports/p0-005-r1-screenshots/` | Clean vs HEAD |
| `reports/p0-005-r2-screenshots/` | Untouched this pass |
| `reports/p0-005-r3-screenshots/` | **New** — 01–06 |

### Product screenshots (fictional, 390×844)

| File | Evidence |
| --- | --- |
| `01-routines-list.png` | Compact Routines list |
| `02-routine-detail.png` | Read-first detail |
| `03-upcoming-change.png` | Upcoming change section |
| `04-ended-routines.png` | Ended routines secondary list |
| `05-same-day-edit-list.png` | After current-plan save (list) |
| `06-same-day-edit-detail.png` | After current-plan save (detail) |

## Acceptance tests 1–18

| AT | Result | Evidence |
| --- | --- | --- |
| 1 Populated upgrade | **PASS** | Migration count 7; p004b→p005 fixtures; backup→migrate→restore; legacy archive end_mode |
| 2 Current-plan interval | **PASS** | Integration range case; UI Edit routine / Save changes |
| 3 Execution protection | **PASS** | AT19 lock/race retained; started visibility when audience removed |
| 4 Eligibility changes | **PASS (integration + reuse)** | Range reconcile include/exclude; group next-day e2e retained |
| 5 Schedule through UI | **PASS** | `z-routine-lifecycle` schedule for later; integration thrice-same-date |
| 6 Move/collision/date boundary | **PASS (API/integration partial)** | Move route + store; UI move covered lightly—collision copy via API conflict |
| 7 Delete upcoming | **PASS** | Lifecycle e2e + integration A/B/C delete B |
| 8 Step lifecycle/composition | **PASS (partial)** | UI add/reorder/delete steps; personal fallback domain retained |
| 9 Permanent deletion | **PASS** | Lifecycle e2e delete unused; integration deny-with-started |
| 10 End/history | **PASS** | End e2e + integration cancel today unstarted; legacy cutoff preserved |
| 11 Transactions/authority | **PASS (extended)** | Route-policy + prior HTTP matrix; new lifecycle kinds |
| 12 Pending/offline recovery | **PASS (reused + retained)** | Prior outbox/reconnect e2e; mergeAuthoritativeOccurrence |
| 13 Live projections | **PASS (adapted)** | Dual-view group/routine e2e; sync invalidation retained |
| 14 Read-first UX | **PASS** | List/detail/upcoming/More/local status e2e |
| 15 Navigation/access | **PASS** | Today/Routines/Household nesting; Account sign-out |
| 16 Shared presentation | **PASS (browser + screenshots)** | Tokens/shell; 390px journeys; no prior PNG pollution |
| 17 Full Product journey | **PASS** | Chromium+WebKit lifecycle + multi-routine + prior regressions |
| 18 Regression/artifact gates | **PASS** | Exact `validate:pr` / `validate:rc`; prior screenshot dirs clean |

## Deviations / known limitations

- Schedule **move** and **occupied-date collision** UX are API-complete; browser coverage is thinner than create/delete upcoming (AT6 partial UI depth).
- Personal-layer date policy remains tomorrow-floored (unchanged by design).
- Routine restore/reopen deferred per brief.
- Hosted/physical RC not run.
- Implementation remains **uncommitted**.

## FIX REQUIRED

None identified against the r3 contract after local PR/RC. Architecture technical acceptance of this Build Report and Project Lead/product acceptance remain pending.

## Suggested commit message

```
P0-005 r3: cohesive routine lifecycle and Calm Household shell

Add schedule entries with current-plan range reconcile, upcoming
create/edit/move/delete, Delete vs End, and shared navigation/theme.
```
