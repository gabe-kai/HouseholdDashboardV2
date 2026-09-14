# Engineering readiness — P0-005 r1

**Brief:** `briefs/p0-005-multiple-household-routines.md` revision **1**  
**Compared against:** `main` @ `93ef494` (P0-004B merged via PR #9)  
**Inspection note:** Branch `brief/p0-005-multiple-household-routines` @ `9cfb89e` adds planning/writeback only; `src/` and `db/migrations` match `main`.  
**Disposition:** **READY**  
**Date:** 2026-09-13  

## Verdict

READY. The repository matches the brief’s “current system” description. Gaps are concrete, intentional contract deltas covered by Active decisions D-020 / D-021 / D-022, with enough seams (per-definition occurrence uniqueness already present, revision routes already carry `:definitionId`, P0-004B participation/archive-adjacent patterns, PR/RC gates) to implement without material product ambiguity. No blockers.

Implementation must wait for Architecture’s response to this review.

## Repository evidence (focused inspection)

### Singleton storage and constraints
- `001_initial.sql`: `routine_definitions.household_id` UNIQUE; `kind CHECK (kind = 'morning')`; `occurrences.schedule_anchor CHECK (... = 'morning')`.
- Occurrence uniqueness already `UNIQUE (definition_id, household_date, accountable_member_id)` — preserve as required.
- Shared revisions already unique by `(definition_id, effective_date)`.
- Migrations end at `004_group_backed_morning_routine.sql`; no `005_*` yet.

### Singleton services / API
- `store.getRoutine(householdId)` selects one definition; `createRoutine` rejects a second with “Household already has a Morning Routine”.
- `materializeForDate`, personal layer, preview, and proposal approval all call that singleton.
- `GET /api/v1/routines` returns `{ routine }`; client `fetchRoutine()` matches.
- Revision HTTP path already includes `:definitionId` but responses still return the household singleton shape.

### Personalization and proposals (cross-routine leak risk today)
- `personal_routine_revisions` stores `definition_id` but `UNIQUE (membership_id, effective_date)` and `getPersonalLayer` select by membership/date only — second routine would collide or steal layers.
- `routine_proposals` has no `definition_id`; `decideProposal` layers onto `getRoutine(householdId)`.
- `personal_additions` has no definition column (correctly scoped via parent personal revision); preserve addition IDs on migration.

### Replay / receipts
- `routine_mutation_receipts` bind household + kind + payload digest; digest omits target definition ID and daypart (daypart does not exist yet).
- Step receipts exist separately; brief requires occurrence/step relationship checks under multi-routine — existing path is occurrence-scoped already and remains the right seam.

### Groups / People projections
- Dated membership, group sources, tombstones, and next-day effects exist (P0-004B).
- `GroupPublic.usedByMorningRoutine` / `PersonDetail.morningRoutine` are singular; `groupActivelyReferenced` already joins through `revision_group_sources` → `routine_revisions.definition_id` and can be generalized to multi-routine collections.

### Client
- `RoutineEditor` + App singular Routine tab, Morning titles/labels, `.at(-1)` latest-revision presentation patterns.
- Today already renders occurrence arrays by occurrence ID (good base for multi-routine checklists) but lacks daypart ordering / Routines destination.

### Fixtures / evidence
- Named migration baseline `tests/helpers/p001-fixture.ts` is pre-auth/pre-groups; insufficient alone for AT1.
- No dedicated populated pre-upgrade P0-004B fixture artifact yet (integration tests compose live or migrate from P0-001 only).
- `validate:pr` / `validate:rc`, route-policy inventory, and PB catalog exist and must be extended (not replaced).

### Decisions
- D-020 (identity/scoping/replay/populated upgrade), D-021 (weekdays + dayparts), D-022 (prospective archive) are Active and align with the brief.

## Consolidated findings

| Severity | Item |
| --- | --- |
| BLOCKER | None |
| IMPORTANT | Lift `household_id` UNIQUE and morning-only `kind` / `schedule_anchor` constraints via ordered forward migration(s) after 004; preserve all existing IDs and FKs. |
| IMPORTANT | Replace singleton `getRoutine` / `{ routine }` with collection + explicit definition ID on detail, revise, archive, personal layer, preview, and proposals; bind mutation receipts to target definition (+ daypart/effective date in digest). |
| IMPORTANT | Fix personal-layer uniqueness/selection to `(membership_id, definition_id, effective_date)`; store proposal `definition_id` at create; approval must use stored identity only. |
| IMPORTANT | Generalize People & Groups projections from Morning-only fields to routine-aware collections; archive cutoff intersects group delete protection. |
| IMPORTANT | Replace singular Routine UI with focused Routines list/detail/create/edit; Today orders by snapshotted daypart; keep P0-004B audience picker semantics. |
| IMPORTANT | Add populated pre-P0-005 / P0-004B migration fixture covering auth, groups (incl. pending dated membership), personal layers, proposals (incl. no-routine legacy case), and Morning daypart preservation. |
| NOTE | Occurrence uniqueness already scopes by definition/date/member — keep; materialize must enumerate definitions with archive cutoff applied. |
| NOTE | Wire names for daypart vs retained `schedule_anchor`, archive columns, and collection JSON shape are Engineering discretion within D-020–D-022. |
| NOTE | Internal sequencing checkpoints in the brief are implementation order, not separate releases. |
| NOTE | Hosted/physical evidence not required for readiness or normal implementation. |

## Ordinary implementation choices (Engineering will make)

1. **Daypart storage:** Expand occurrence/revision daypart field (likely evolve `schedule_anchor` or add `daypart` with backfill `morning` → Morning) using the fixed ordered vocabulary; keep migrated Morning as Morning.
2. **Definition “kind”:** Drop or neutralize morning-only `kind` in favor of household-defined titles + daypart (no special type enum beyond daypart vocabulary).
3. **Archive representation:** Store household-local exclusive cutoff date (tomorrow at archive) plus archived presentation flag/timestamp; apply cutoff in materialize/read/preview/status/reference helpers.
4. **API shape:** `GET /routines` → collection; detail/revise/archive/personal/preview under explicit `:definitionId`; document in route-policy; avoid ambiguous singleton adapters for new clients.
5. **Replay digest:** Include target `definitionId`, daypart, and effective date in normalized digest; extend receipt kinds for archive; preserve ability to replay legacy receipts against their original definition.
6. **Client structure:** Extract Routines list/summary/editor components from current `RoutineEditor` patterns; key drafts and sync refreshes by definition ID; pass `today` and free effective-date selection per definition (already started for Morning).
7. **Fixture:** New disposable populated P0-004B baseline helper used by AT1/AT2; retain P0-001 fixture coverage.

## Acceptance-test / migration risks

- SQLite table rebuilds when rewriting UNIQUE/CHECK constraints — must verify FK integrity and re-apply idempotency (AT2).
- Legacy proposals with no unambiguous routine association must remain readable/unresolved rather than guessed (AT1).
- Changing personal-layer unique key is safe for current singleton data but must not rewrite addition IDs (AT9).
- Extending mutation digests must not make old receipts unreadable or falsely conflict (AT14).
- Populated fixture must include pending next-day group membership so AT7/AT8 are not vacuously green.
- Multi-context sync (AT15) and outbox regression (AT16) need multi-routine fixtures; reusing only single-routine P0-002 tests is insufficient alone.
- Browser journey (AT3/AT17) must create After School and Bedtime through UI, not only API seed.

## Out of scope (confirmed)

No P0-006 / Kitchen-Cats-Bathroom, rotation, helpers, exact times, notifications, full Multi-Responsibility Today, restore/delete of archived routines, or hosted deployment for this brief.

## Suggested commit message (do not commit)

```
P0-005: record r1 Engineering readiness as READY

Confirm multi-routine gaps are intentional under D-020–D-022 and
implementation can proceed after Architecture responds.
```
