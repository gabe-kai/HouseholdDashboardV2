# Engineering readiness — P0-004B r1

**Brief:** `briefs/p0-004b-group-backed-morning-routine.md` revision **1**  
**Compared against:** `main` @ `9feec29` (P0-004A r3 merged via PR #8)  
**Inspection note:** Branch `brief/p0-004b-group-backed-morning-routine` @ `1db93e3` adds the brief/decisions/writeback only; `src/` and `db/migrations` match `main`.  
**Disposition:** **READY**  
**Date:** 2026-09-12  

## Verdict

READY. The repository matches the brief’s “current system” description. Gaps are concrete, intentional contract changes with Active decisions D-018/D-019 and enough seams (household-date helpers, `?date=` materialization, P0-004A focused-state patterns, route-policy/PB gates) to implement without material product ambiguity. No blockers.

## Repository evidence (focused inspection)

### Dated-membership migration surface
- Groups today: `household_groups.version` is OCC only; `household_group_members` is a live replace-on-update set (`store.updateGroup`). No dated membership history.
- `deleteGroup` physically deletes members then group; unique name is `lower(name)` across all rows; no tombstone / reference check.
- Migration must add dated membership versions + history-safe tombstones while keeping P0-004A’s “latest configured set” projection. Baseline versioning for existing groups is required and feasible (Engineering discretion on baseline effective date as long as today’s configured members resolve correctly).

### Direct / group source model
- `revision_assignees` stores membership IDs only (`001_initial.sql`).
- Wire: `CreateRoutineSchema` / `CreateRevisionSchema` require `assigneeMemberIds.min(1)`; **no** group source field; **no** routine `mutationId`.
- Server validates household membership (any status, including pending); client Routine editor only offers `active` + `routine.execute.own` — narrower than server and narrower than brief §16.
- Person detail `currentlyAssigned` checks `revision_assignees` only (`currentDirectMorningRoutine`) — must resolve through the new dated source union after this slice.

### Future-occurrence and status boundary
- `GET /today` and `/history` accept `?date=` and call `materializeForDate` with no “≤ today” guard — matches brief’s retained future evaluability.
- Materialize loops current `assigneeMemberIds` / `ensureOccurrence`; uniqueness by `(definition_id, household_date, accountable_member_id)`. Does **not** delete extras; does **not** revalidate participation on status.
- `setStepStatus` checks grant + accountable member only — **no** future-date reject, **no** resolver participation check. Matches known gap D-019 must close.

### Active-reference deletion rule
- No “group used by operative/scheduled Routine” guard today. Brief §15 + D-018 require server-side conflict until references are historical-only, then user-visible delete with retained identity. Clear delta from physical delete; table mechanics remain Engineering discretion.

### Routine mutation replay scope
- Step / person / group-create / setup use mutation receipts; **POST `/routines` and `/revisions` do not**. Conflicts today are “definition exists” / UNIQUE effective date only.
- Brief §13 requires household-scoped mutation-ID replay with same-payload idempotency and safe conflict on kind/payload/household mismatch — additive, patterned after existing structure receipts.

### Route / synchronization inventory
- Route-policy already lists groups CRUD and routines create/revision; completeness gate remains the place to extend notes/resources.
- Sync matrix: group → `group`; routine → `routine`. Client refreshes today + supporting data on those events but **RoutineEditor fetches once on mount** and does not re-read routine on `group`/`routine` invalidation — must change for AT14 / §17.
- PB-19 (“structural only”) remains true for **authority**; P0-004B adds **source** consumption — catalog/matrix/docs must be updated in-scope, not treated as a contradiction with D-013/D-018.

### Deterministic phone-width journey
- D-016 patterns exist in People & Groups (exclusive states, Back, focus-heading).
- Date seams: `householdDateNow`, `addHouseholdDays`, `materializeForDate`, `GET …?date=` used in integration tests. No global clock freeze; brief allows existing seams. Next-day ATs are implementable without waiting for midnight; e2e AT3 is same-day UI configuration.
- Screenshots/evidence paths follow established `reports/` + Chromium phone viewport practice from P0-004A.

## Consolidated findings

| Severity | Item |
| --- | --- |
| BLOCKER | None |
| IMPORTANT | Greenfield dated group-membership versions + tombstones; replace physical delete with reference-guarded historical retention. |
| IMPORTANT | Add group source IDs + routine `mutationId` replay; relax “≥1 person” to “≥1 person or group (empty group OK)”; migrate existing assignees as direct-only. |
| IMPORTANT | Single participation resolver for materialize/read + `setStepStatus` future/participation guards (D-019); do not delete/rewrite retained future rows. |
| IMPORTANT | Routine UI: compact summary + focused picker (D-016); widen selectable people to all household memberships; refresh open Routine on `group`/`routine` sync. |
| IMPORTANT | Update person “currently assigned”, group “Used by Morning Routine” / delete conflict UX, protected-behaviors + sync matrix + route-policy notes. |
| NOTE | Baseline membership-version effective date and exact tombstone/index shape are Engineering discretion under the behavioral contract. |
| NOTE | Wire may keep `assigneeMemberIds` as **direct** sources after normalization; resolved unique count is derived — name additional group-source fields locally. |
| NOTE | Deterministic journey uses date query/helpers; no new hosted clock service required. |

## Conflicts with brief

None that prevent READY. Repository differences are the intentional deltas the brief authorizes. D-018/D-019 (on this Architecture writeback branch; not yet on `main` tip until merged) align with the contract.

## Ordinary implementation choices (not escalated)

- Schema for dated membership versions / tombstone flag vs separate archive table.
- Receipt table reuse vs new kind for routine create/revision mutation IDs.
- Whether Routine picker lives in `App.tsx` or a focused module mirroring People & Groups.
- Exact household-language copy within the brief’s examples.

## Disposition

**READY** — proceed after Architecture ACCEPT / PROCEED. Do not implement until that response.
