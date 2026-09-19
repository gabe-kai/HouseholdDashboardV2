# Build Report - BRIEF P0-007A r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (local; pending Architecture technical acceptance)  
**Branch:** `brief/p0-007a-household-responsibility-foundation`  
**Base:** Architecture ACCEPT/PROCEED `a6890cc`; integrated main parent `409d147`  
**Implementation commits:** **uncommitted** (Project Lead manages Git; do not deploy)  
**Pull request:** N/A  

## Readiness

**READY** against r1 (`reports/P0-007A-r1-engineering-readiness.md` @ `7226987`). Architecture **ACCEPT / PROCEED** (`a6890cc`). Contract unchanged. Card **Give Cats and Trash one owner and a place in Today** moved to **In Progress** at implementation start.

## What changed

### Migration / domain (D-035–D-037)
- Forward migration `011_household_responsibilities.sql`: immutable `kind` on definitions/occurrences (backfill routine); partial unique indexes for routine vs responsibility identity; `step_reports.performer_member_id`; one-time grant backfill `responsibility.manage` / `responsibility.execute.own`; clear receipt `acknowledged_scope`.
- Domain helpers for single-owner participation and lock comments; schemas for responsibility create/revise, `intendedStructure`, clear scope, `WorkKind` on projections.

### Server
- Kind-aware list/CRUD/schedule/end/delete for responsibilities under `/api/v1/responsibilities`; cross-kind ID rejection on routine and personal/proposal routes.
- Materialize: one responsibility occurrence per definition/date; in-place unstarted owner update; no personal/group fan-out for responsibilities.
- `setStepStatus`: kind + intendedStructure binding; first action locks structure and owner; performer recorded for new responsibility self-execution; generation fence retained.
- History: per-kind management grants; work-kind filter; still side-effect-free.
- Clear activity: acknowledged `routines_and_responsibilities`; legacy routine-only rejected when responsibility data exists; shared generation/floor.
- Route-policy + sync resource `responsibility`; fixture cleanup considers `performer_member_id`.

### Client
- Plan home: Routines + Responsibilities; Add choice; `/plan/responsibilities/:definitionId`; focused Name/When/Who/Work; Next 7 days preview; More lifecycle.
- Mixed Today (daypart order) with per-kind execute grants; empty copy updated; outbox kind + intendedStructure.
- Household activity: compact responsibility rows → read-only detail → Back.
- History work filter; performer display; Clear activity history confirmation names both kinds.
- Vite deeplink coverage for responsibility detail.

### Evidence / docs
- `tests/helpers/p010-fixture.ts`; `tests/integration/p0-007a.test.ts`; e2e cats-trash / reset-outbox / geometry / vite deeplink.
- PB-40–42 + sync matrix rows; prior screenshot dirs restored after gates.

## Verification performed

| Check | Result |
| --- | --- |
| Unit / integration | **PASS** — **157** tests / **27** files |
| `npm run validate:pr` | **PASS** — Chromium e2e **38/38** + Vite **2/2** (`reports/p0-007a-r1-validate-pr.log`) |
| `npm run validate:rc` | **PASS** — Chromium+WebKit **64** passed + Vite **2/2** (`reports/p0-007a-r1-validate-rc.log`) |
| Prior `p0-006a` / `p0-006b` / `p0-006c` screenshots | **PASS** — restored to pre-gate SHA-256 after overwrite |
| New screenshots | `reports/p0-007a-r1-screenshots/` (01–05 cats/trash/today/activity/history) |
| Deployment | **NOT RUN** (not required) |

## Acceptance tests (AT1–16)

| AT | Result | Evidence |
| --- | --- | --- |
| 1 Populated upgrade | **PASS** | `p0-007a.test.ts` through-010 fixture → 011: kind backfill, grants once, uniqueness, FK, idempotent re-migrate |
| 2 Cardinality and assignment | **PASS** | Integration: one responsibility/date; reassign same ID; storage rejects duplicate; pending assignee allowed |
| 3 Cats normal UI | **PASS** | `z-p0-007a-cats-trash.spec.ts` Chromium (+ WebKit via RC): create Cats, child complete, Household + History |
| 4 Trash normal UI | **PASS** | Same journey: Tuesday/Evening Trash, independent of Cats; screenshots |
| 5 Current/future management | **PASS** | Integration revise/schedule/owner change + preview; UI Schedule/End/Delete paths in Responsibilities |
| 6 Locks and races | **PASS** | Integration first-action vs edit/reassign/End/Delete; intendedStructure rejection |
| 7 Durable immediate execution | **PASS** | Cats journey checklist + `z-p0-007a-reset-outbox` delayed/abort path; outbox unit kind normalize |
| 8 Delete/End | **PASS** | Integration Delete unused vs prior-date history requires End; End preserves started |
| 9 Permission/type matrix | **PASS** | HTTP AT9 in `p0-007a.test.ts`; cross-kind 404/403 |
| 10 Unified stored History | **PASS** | Integration side-effect-free reads; e2e work filter responsibilities |
| 11 Reset scope and retention | **PASS** | Integration clear scope/legacy rejection/rollback; Settings dual-kind confirmation |
| 12 Reset/offline recovery | **PASS** | `z-p0-007a-reset-outbox.spec.ts` mixed-kind pending → clear → rematerialize open |
| 13 Live management and recovery | **PASS** | Cats journey Household activity updates without reload; WS `responsibility` refresh wired |
| 14 Authoring/accessibility/layout | **PASS** | Plan editor + OrderedList Work; geometry desktop stub; phone screenshots 01–05 |
| 15 Saved destinations | **PASS** | Responsibility detail URL; Vite deeplink `z-p0-007a-vite-deeplink.spec.ts` (PR/RC) |
| 16 References and regression | **PASS** | Fixture cleanup performer/assignee; PB-40–42; route-policy; validate:pr/rc; prior screenshots restored |

## Migration / design choices

- Occurrence uniqueness: partial indexes by `kind` (canceled rows included).
- Responsibility assignee: single `revision_assignees` row; no groups.
- Clear: new UI always acknowledges `routines_and_responsibilities`; legacy API without ack rejected when any responsibility definition/occurrence exists.
- Checklist: responsibilities require `intendedStructure` (revisionId + accountableMemberId); routines remain compatible without it.

## Known limitations (not blockers)

- Hosted / physical phone certification: out of scope.
- Touch drag reorder for responsibility Work relies on shared OrderedList + prior 006A touch evidence; Cats journey exercises keyboard/focused create Save.
- Fuller Next/Later Today hierarchy remains C; pattern assignment remains B.

## Suggested commit messages (do not commit)

```
P0-007A: implement household responsibility foundation (r1)

Fixed-owner Cats/Trash over shared foundations, mixed Today/History,
scoped activity clear, and AT1–16 local PR/RC evidence.
```
