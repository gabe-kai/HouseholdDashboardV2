# Engineering readiness — P0-004A r2

**Brief:** `briefs/p0-004a-people-groups-access.md` revision **2**  
**Branch:** `brief/p0-004a-people-groups-access`  
**Disposition:** **READY**  
**Date:** 2026-09-10

## Verdict

READY. Repository facts match the r2 contract well enough to implement without material product/architecture ambiguity. Pending memberships already model unenrolled people; gaps are intentional evolutionary work named by the brief (structure grant, classification, claim revocation, groups, mutation receipts, People & Groups UI).

## Material findings

### Pending memberships / unenrolled people — OK
- `household_memberships.user_id` is nullable; status `pending|active` (`db/migrations/002_authenticated_authority.sql`).
- Sessions join only `status = 'active'` with an attached enabled user (`AppStore.getSessionByTokenDigest` / `createSession`).
- `listMemberships` returns all household memberships including pending.
- Routine assignees accept any same-household membership ID (active or pending) (`validateRoutineInput`).
- Seed pending members still carry preset grants for bootstrap; that path is separate from new person creation, which must create pending rows with **no** user, claim, grants, group, or assignment.

### `household.structure.manage` + manager preset — implementable
- Grant enum and `GRANT_PRESETS.manager` currently include `household.member.enroll` only (`src/shared/grants.ts`, `schemas.ts`).
- D-014 and r2 specify: add structure grant to manager preset; backfill only memberships that already hold enroll. No Adult/Child inference. Ordinary Engineering migration + preset update.

### Classification not set — implementable
- No classification column or trustworthy age fact exists today. Nullable `adult|child` plus UI `Classification not set` is intentional; new creates require Adult|Child.

### Enrollment claim lifecycle — intentional change, not a blocker
- Claims have `consumed_at` but **no** `revoked_at`; multiple unconsumed claims per membership are possible; `issueEnrollmentClaim` may create a membership when `displayName` is supplied and **pre-applies** preset grants before claim (`store.ts`).
- Plaintext is already returned only from issuance (`insertClaim`).
- r2 requires: existing-membership-only setup, one actionable claim, transactional replacement/cancellation, grants applied on claim (not at issue), mutation-ID replay that never replays plaintext. These are in-scope contract changes; existing enroll helpers/tests that create-via-displayName must be updated accordingly.

### Replay-safe structure mutations — pattern exists
- Step and personal-task mutation receipts already model idempotent replay. Extend with structure/setup receipts that omit plaintext secrets.

### Groups / version / isolation — greenfield on known patterns
- No group tables yet. Household-scoped Fastify + SyncHub isolation and CONFLICT/NOT_FOUND indistinguishability patterns already exist in P0-002/P0-003 tests.

### Sync + route-policy — extension points ready
- `SyncNotification.resource` and `ROUTE_POLICY_INVENTORY` are the established extension surfaces (`schemas.ts`, `route-policy.ts`, `protected-behaviors.md`).

### P0-001 / P0-002 / P0-003 preservation — feasible
- Validation tiers (`validate` / `validate:pr` / `validate:rc`), route-policy completeness, migration baseline fixture, proposal sync, outbox, personal-task visibility, and historical occurrence evidence remain the regression gate. P0-004B group-backed Morning Routine is explicitly out of scope.

## Severity summary

| Severity | Item |
| --- | --- |
| BLOCKER | None |
| IMPORTANT | Enrollment issuance must stop creating people and stop pre-applying grants; update call sites/tests that rely on create-via-claim. |
| NOTE | People & Groups UI replaces Enroll as primary path; keep a thin access overview/redirect. Direct Morning Routine involvement is derived from the household-date-effective revision without materializing an occurrence. |

## Proceed

Implement exactly r2 on `brief/p0-004a-people-groups-access`. Do not implement P0-004B/P0-005.
