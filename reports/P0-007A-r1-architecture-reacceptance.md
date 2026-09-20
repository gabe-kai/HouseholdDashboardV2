# Architecture re-acceptance review - P0-007A r1

**Disposition:** FIX REQUIRED  
**Reviewed implementation:** `fd91c8a`, Project Lead commit on `brief/p0-007a-household-responsibility-foundation`  
**Prior review:** `reports/P0-007A-r1-architecture-review.md` / `b60f97b`  
**Contract:** `briefs/p0-007a-household-responsibility-foundation.md`, revision **1**, unchanged  
**Next owner:** Engineering, same revision and branch; no new readiness round  
**Card:** **Give Cats and Trash one owner and a place in Today** remains **In Progress**.

The new migration 013 and the reported AT4/AT7/AT12/AT15 evidence address the previously identified Architecture gaps. However, the repository gate is not currently green in this environment: an independent `npm test` run on 2026-09-20 produced **167 passed / 1 failed**. The failure is `tests/integration/p0-006b.test.ts` AT9, where the test assumes the real current date is a school day and therefore cannot find its `Pack Lunchbox` step on Sunday. This appears date-sensitive and not caused by migration 013, but P0-003's regression gate still requires a deterministic green suite before technical acceptance.

## Remaining required correction

Stabilize or explicitly control the P0-006B AT9 date seam so the normal repository test suite passes on the supported calendar, then rerun the exact local PR/RC/Vite gates. Do not make the test depend on whether the host happens to be a weekday. The fix may be a test-only controlled household date or an equivalent existing seam; preserve the behavior being tested.

Architecture is not reopening the closed R1–R5/AT4/AT7/AT12/AT15 findings unless the rerun exposes a new failure. The migration 013 integrity tests are accepted as evidence for those two storage corrections.

R1–R5 are substantially addressed. The reported gates now pass at 165 unit/integration tests, 42 Chromium + 2 Vite PR checks, and 68 Chromium/WebKit + 2 Vite RC checks. The new receipt, migration, draft, recovery, and evidence work is materially better and the previously reproduced replay, kind-integrity and draft-version failures are addressed in the named tests.

Technical acceptance remains withheld for the following required contract edges.

## Required remaining corrections

### 1. Close the four declared partial acceptance tests

These are not optional polish. The brief marks the acceptance tests required unless explicitly marked otherwise, and the Build Report declares them PARTIAL:

- **AT4:** execute Trash on a controlled Tuesday and verify the resulting occurrence/history and mixed daypart behavior. DST/travel evidence may use the existing deterministic seams, but the current creation/preview journey does not prove execution.
- **AT7:** add the responsibility-specific rapid-tap, delayed-write/out-of-order response and pending-first-action versus reassignment/edit evidence. The current report says the UI matrix is not fully enumerated.
- **AT12:** actually hold a stale History response body across reset and release it afterward, then prove the old body cannot restore cleared work. Code fencing is useful but does not substitute for the required event-order evidence.
- **AT15:** prove built-production shell reload, signed-out resume, and denied/unavailable responsibility identity handling. The current Vite/detail smoke and shared auth gates are only partial coverage of the stated destination contract.

Keep the declared PARTIAL mapping until these exact edges have evidence; do not relabel them PASS by wiring inspection or inherited routine coverage.

### 2. Protect immutable definition kind at the storage boundary

The r1 contract says the definition kind is immutable after creation. Migration 012 adds occurrence triggers, but no trigger or equivalent database constraint prevents a direct update of `routine_definitions.kind`. The API does not expose such an update, but the contract explicitly requires storage integrity, and occurrence consistency can be invalidated by changing a definition kind after its occurrences exist.

Add a forward migration correction that rejects changes to `routine_definitions.kind`, while preserving valid legacy routine rows and the responsibility migration path. Add a regression that attempts both routine→responsibility and responsibility→routine updates and proves they fail without changing dependent data. Engineering may choose the SQLite mechanism.

### 3. Close accountable-member household integrity explicitly

The new occurrence triggers bind occurrence household to definition household and revision to definition, but they do not establish that `accountable_member_id` belongs to the same household. API validation covers normal requests; the r1 contract also requires fixed responsibility ownership to be a same-household membership and calls for storage/reference integrity. Add a database-enforced check or an equivalent serialized write-boundary invariant for responsibility occurrences, with a regression for a foreign-household accountable member. Do not weaken existing routine behavior.

## Evidence hygiene

The prior screenshot directories are reported clean through the gates, and current-brief captures are now redirected appropriately. Keep that behavior. The Build Report’s current partial list is accurate and should remain so until the four edges above are closed.

## Return handoff

Correct the remaining items against **P0-007A r1** on the existing branch. Add failing-before/fixed-after regressions, rerun `npm run validate:pr` and `npm run validate:rc` including Vite, and return an updated Build Report with the exact AT4/7/12/15 evidence. No Product decision, B/C work, deployment, or new readiness review is requested. Suggest a commit message but do not commit.
