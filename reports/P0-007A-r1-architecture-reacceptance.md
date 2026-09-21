# Architecture re-acceptance review - P0-007A r1

**Disposition:** ACCEPTED
**Reviewed implementation:** `bb21d74`, Project Lead commit on `brief/p0-007a-household-responsibility-foundation`
**Prior review:** `reports/P0-007A-r1-architecture-review.md` / `b60f97b`  
**Contract:** `briefs/p0-007a-household-responsibility-foundation.md`, revision **1**, unchanged  
**Next owner:** Project Lead / Product evaluation
**Card:** **Give Cats and Trash one owner and a place in Today** is **Ready to Evaluate**.

The new migration 013 and the reported AT4/AT7/AT12/AT15 evidence address the previously identified Architecture gaps. The former date-sensitive P0-006B AT9 failure was corrected in `bb21d74` by using the existing all-weekday school-calendar seam.

## Prior remaining correction (closed in `bb21d74`)

The correction stabilized the P0-006B AT9 date seam without changing the behavior under test. The normal repository suite and the reported local PR/RC/Vite gates are now green.

Architecture is not reopening the closed R1–R5/AT4/AT7/AT12/AT15 findings unless the rerun exposes a new failure. The migration 013 integrity tests are accepted as evidence for those two storage corrections.

R1–R5 are substantially addressed. The reported gates now pass at 165 unit/integration tests, 42 Chromium + 2 Vite PR checks, and 68 Chromium/WebKit + 2 Vite RC checks. The new receipt, migration, draft, recovery, and evidence work is materially better and the previously reproduced replay, kind-integrity and draft-version failures are addressed in the named tests.

The following sections preserve the earlier review record; their listed gaps were closed before final acceptance.

## Historical required corrections (closed before final acceptance)

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

The prior screenshot directories are reported clean through the gates, and current-brief captures are now redirected appropriately. Keep that behavior. The four partial edges and both storage-integrity items listed above were subsequently closed and are reflected as PASS in the final Build Report.

## Return handoff

The correction was committed as `bb21d74`; no Product decision, B/C work, deployment, or new readiness review was required.

## Final Architecture disposition

**ACCEPTED** against **P0-007A r1** at `bb21d74`.

- Independent `npm test`: **PASS**, 168 tests in 27 files.
- Engineering Build Report gates: `validate:pr` **45/45** Chromium plus Vite **2/2**; `validate:rc` **71/71** Chromium/WebKit plus Vite **2/2**.
- AT1–16 are recorded PASS in `reports/P0-007A-r1-build-report.md`.
- No hosted deployment is required for this local contract slice.

Architecture has no remaining r1 implementation requirement. Project Lead/Product evaluation remains separate from technical acceptance. B and C remain later roadmap work.
