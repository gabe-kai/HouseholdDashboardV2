# Engineering Readiness Review - BRIEF P0-007A r1

**Brief revision reviewed:** 1  
**Review round:** Initial consolidated pass  
**Readiness:** READY  
**Repository/Git state checked:** YES  
**Current branch:** `brief/p0-007a-household-responsibility-foundation` @ `679aca5` (planning tip)  
**Integrated baseline inspected:** `main` / merge-base parent **`409d147`** (PR #14; P0-006C tip including `5605ab8` / `e8a93d5`)  
**Working tree at review:** clean vs branch HEAD (planning docs only beyond `409d147`)

> READY is the default when implementation can reasonably proceed. QUESTION/BLOCKER findings must be material, evidenced, and consolidated; ordinary implementation choices are not readiness gates.

## Verdict

**READY.** D-035, D-036, and D-037 agree with P0-007A r1 and with the approved P0-007 proposal in `PRODUCT.md`. The brief’s **Current system** table matches the integrated repository at `409d147`. Required deltas (kind + responsibility uniqueness, fixed ownership lock, grants, mixed Plan/Today/History/reset, structural checklist binding, through-010 fixture) are intentional contract work, not contradictions or missing high-authority decisions.

**No BLOCKER. No QUESTION.** Implementation waits for Architecture **ACCEPT / PROCEED** per brief Dependencies (this review does not authorize coding).

## Decision alignment

| Decision | Brief use | Repo / conflict |
| --- | --- | --- |
| **D-035** | Shared foundations; responsibility uniqueness per definition/date; routine-only personal/group paths | Matches; current SQLite unique key is `(definition_id, household_date, accountable_member_id)` and cannot alone enforce responsibility cardinality |
| **D-036** | Fixed owner, weekday/daypart, first-action locks structure **and** accountable membership, grants, performer facts | Matches planned Active decision; today only structure is frozen via `started_at` (undo does not clear it); owner is de facto sticky for started survivors but identity still includes member id |
| **D-037** | Mixed Plan/Today/Household/History; Clear activity history with explicit dual-kind confirmation | Matches; current Settings copy and clear path are routine-labeled (`Clear routine activity history`) and delete the shared occurrence graph under one generation/floor |

Prior D-023–D-034 behaviors the brief preserves (locks, lifecycle, side-effect-free History, generation fence) are present on the baseline.

## Current-system claim check (selected)

| Claim | Evidence | Verdict |
| --- | --- | --- |
| Migrations through 010; tip `409d147` | `db/migrations/010_…sql`; git `main` | Match |
| Occurrence uniqueness includes member | `001_initial.sql` / `005_…sql` `UNIQUE (definition_id, household_date, accountable_member_id)` | Match |
| `materializeForDate` fans out per participant | `store.ts` → `resolveParticipants` → `ensureOccurrence(..., membershipId)` | Match |
| Nonempty checklist + ≥1 Required | `recurrence.ts` `validateRoutineSteps`; Zod `steps.min(1)` | Match |
| No responsibility kind/grants | `grants.ts`, schemas, no `/responsibilities` routes | Match |
| Plan = Routines; URLs `/plan`, `/plan/routines/:id` | `nav.ts`, `App.tsx` `RoutinesView`, `showPlanTab = routine.shared.manage` | Match |
| History side-effect-free | `historyForDate` / summaries / detail load stored rows only | Match |
| Clear is routine-labeled; grant + env gate | `HouseholdSettings.tsx`; `household.activity.clear` + `ALLOW_EVALUATION_HISTORY_CLEAR` | Match |
| Populated **010** upgrade fixture still needed | `p009-fixture.ts` is through-009; `p0-006c` upgrades 009→010 in-test | Match (implementation deliverable) |
| Delete unused vs End retained | `deleteRoutine` / `endRoutine` exist; Delete already blocks started/reports/personal/proposals | Match; responsibility prior-date history checks are additive |

No Current-system factual contradiction requiring Architecture revision.

## Findings

### 1. NOTE — Responsibility uniqueness and in-place owner change are a deliberate schema/resolver delta

**Brief / D-035:** One occurrence per definition/household date independent of owner; unstarted owner change updates the same occurrence identity.

**Repo:** Uniqueness includes `accountable_member_id`. Routine owner change today is cancel/create another row, not an in-place accountable update.

**Disposition:** Expected implementation work. Exact SQLite representation (partial unique index by kind, companion uniqueness table, etc.) is Engineering discretion within D-035. Do not clone a second execution stack.

### 2. NOTE — Checklist structural binding and performer facts are additive wire/storage work

**Brief §§4–5 / D-036:** Responsibility checklist commands carry intended structural identity; new reports store performer separately; outbox kind normalizes missing → routine.

**Repo:** `SetStepStatusSchema` / outbox items carry mutationId, status, performedAt, optional `activityGeneration` and client snapshot retention — no kind, no structural digest, no performer column.

**Disposition:** Clear contract; implement within existing mutation/receipt/outbox channel. No product ambiguity.

### 3. NOTE — Plan and History reachability must widen to either management grant without leaking the other kind

**Brief §5 / D-037:** Plan/History reflect `responsibility.manage` **or** `routine.shared.manage`; filters/counts/detail enforce per-kind authority.

**Repo:** Plan tab and History are gated solely on `routine.shared.manage` today.

**Disposition:** Intentional shell/grant wiring. Ordinary Engineering work; not a readiness question.

### 4. NOTE — Household activity and clear confirmation copy are routine-shaped today

**Brief §§6–7:** Compact responsibility rows + dual-kind Clear activity history confirmation; legacy routine-only clear must not erase responsibility data when that kind exists.

**Repo:** Household activity expands routine checklists; Settings strings say “routine activity”; clear deletes all household occurrences (would already wipe future responsibility rows once they share the graph — confirmation/scope binding must catch up before that is safe).

**Disposition:** Explicitly specified. Implement confirmation/scope binding before shipping mixed-kind data; covered by AT11–12.

### 5. NOTE — Acceptance surface is large but locally testable

AT1–16 demand UI creation for Cats/Trash, structural races, durable outbox, mixed History, reset/offline recovery, touch reorder, Vite deep links, and PR/RC with prior screenshot dirs preserved. Local seams (controlled household dates, injectable rollback, existing e2e helpers) already support this class of evidence from P0-005–006.

**Disposition:** Scope risk for schedule/evidence, not a contract blocker. Map each AT in the Build Report; do not wait for a real Tuesday.

## What is not a readiness issue

- Exact column/module names and whether `routine_*` SQL names remain.
- How to represent weekday presets in the focused When editor.
- CSS layout details within existing primitives.
- B pattern/collision policy and C Today hierarchy (explicitly out of A).

## Implementation posture (after ACCEPT / PROCEED only)

1. Forward migration(s) after 010: kind backfill, responsibility uniqueness, fixed owner persistence, performer, grant backfill, receipt/constraint updates; populated through-010 fixture.
2. Kind-aware materialize/resolve; `/api/v1/responsibilities` family; reject cross-kind targeting; shared checklist path with structural binding + generation fence.
3. Plan dual list + `/plan/responsibilities/:id`; focused Name/When/Who/Work; mixed Today; compact Household activity; History work filter + per-kind auth; Clear activity history confirmation/scope.
4. Extend protected behaviors, sync matrix, route policy, fixture cleanup references; `validate:pr` / `validate:rc` with prior screenshot dirs unchanged.

## Architecture response requested

**ACCEPT / PROCEED** for P0-007A revision 1, or revise the brief if Architecture disagrees with any finding above.

Engineering will not implement until that disposition.
