# Engineering readiness — P0-004A r3

**Brief:** `briefs/p0-004a-people-groups-access.md` revision **3**  
**Branch:** `brief/p0-004a-people-groups-access` (ahead of origin by the r3 brief commit)  
**Disposition:** **READY**  
**Date:** 2026-09-11  

Revision 2 readiness does **not** apply. Accepted r2 through `740d141` is treated as the technical foundation to preserve.

## Verdict

READY. The repository matches the r3 problem statement: composite People & Groups UX and fixture-contaminated normal bootstrap are concrete, inspectable gaps. D-016/D-017 and the r2 API/security surface give a clear implementation path without material product ambiguity.

## Repository evidence (r3 focus)

### Focused-state UX — required change, implementable
- `PeopleGroupsView` still renders directory + add form + selected detail/edit/access + group editor + household-visible tasks in one scroll (`src/client/PeopleGroups.tsx`).
- `App.tsx` appends `HouseholdProgressView` under People & Groups for manager sessions — exactly the stacked activity the brief forbids on the overview.
- Navigation is React tab/local state only; no router dependency exists — matches r3 “in-app exclusive states + Back.”

### Fixture / bootstrap remediation — required change, implementable
- `loadConfig` sets `autoSeed: profile !== "hosted" && env.AUTO_SEED !== "0"` (`src/server/config.ts`), so development defaults **on** unless `AUTO_SEED=0`. `.env.example` currently has `AUTO_SEED=1`.
- `issueBootstrapClaim()` calls `this.seed("UTC")` when no household exists (`store.ts`), so empty-DB bootstrap creates the full demo fixture.
- Dual manifests confirmed: `src/server/seeds/evaluation.ts` lists three members (Alex/Jamie/Riley) while `store.ts` `FIXTURE_MEMBERS` seeds six Reed IDs `…201`–`…206`. Actual seeding uses the six-member list + `SEED.household.id`.
- Tests/e2e already opt in explicitly (`createHttpHarness` / `tests/e2e/start-server.ts` set `AUTO_SEED=1`) — compatible with flipping the development default off.
- `npm run db:backup` exists (`src/server/scripts/backup.ts`) for the remediation precondition. No cleanup command yet — in-scope r3 work.
- Brief’s local `runtime/dev.sqlite` notes (`201` blocked, `202`–`206` candidates) are treated as time-sensitive inspection guidance; apply must re-check predicates on a disposable copy (per brief/D-017).

### Preserve r2 contracts — OK
- Person/group/access APIs, `household.structure.manage` vs enroll, mutation receipts, claim revocation/one-time secret, SyncHub `membership`/`group`, route-policy inventory, and validate tiers remain the foundation. r3 does not require redesigning them.

### Decisions — aligned
- **D-016** exclusive progressive-disclosure states — Active; matches contract §1–9, 14–15.
- **D-017** opt-in fixtures + provenance-safe cleanup — Active; matches contract §10–13.

## Material findings

| Severity | Finding |
| --- | --- |
| BLOCKER | None |
| IMPORTANT | Flipping default `AUTO_SEED` off requires keeping test/e2e/demo paths explicitly opt-in (already largely true) and rewriting bootstrap empty-DB path so it never calls `seed()`. |
| IMPORTANT | Consolidate one canonical six-ID Reed/demo manifest; remove the conflicting three-member `SEED.members` list or replace it so store and docs cannot diverge again. |
| IMPORTANT | Existing e2e (`people-groups.spec.ts`, morning-routine Household/People assertions) encode the r2 composite page and must be rewritten for exclusive states + Household activity. |
| NOTE | After Add person success, landing on person detail vs overview is Engineering discretion if both are clear; prefer detail for continuity with access setup. |
| NOTE | Build Report must include fictional phone-width screenshots (AT13); visual product acceptance remains Project Lead after Architecture. |
| NOTE | Cleanup apply against real `runtime/dev.sqlite` requires explicit Project Lead instruction; Engineering rehearses on a disposable copy only. |

## Proceed

Implement exactly r3 on `brief/p0-004a-people-groups-access`. Do not implement P0-004B. Preserve r2 security, history, isolation, and synchronization contracts.
