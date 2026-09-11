# Build Report - BRIEF P0-003 r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (FIX REQUIRED corrections applied)  
**Integration branch:** `brief/p0-003-regression-safety-contract-hardening`  
**Evidence date:** 2026-09-10  
**Host class:** Local Windows Node.js 24 (no hosted deploy in this slice)  
**Private origin, identities, secrets:** omitted

## Summary

P0-003 r1 adds durable contract cataloging, a machine-checked `/api/v1` route-policy inventory, focused regression evidence (including visibilitychange recovery and personal-task UI projection), `validate:pr` / `validate:rc` scripts, and a least-privilege GitHub Actions workflow that invokes `npm run validate:pr` directly. Accepted P0-001/P0-002 product behavior is preserved; visibility recovery now re-reads Today immediately (not deferred behind `startTransition`).

## FIX REQUIRED corrections (this writeback)

1. **AT11 workflow:** `.github/workflows/validate-pr.yml` now runs `npm run validate:pr` (not an inlined equivalent).  
2. **AT7 visibility path:** e2e `visibilitychange re-reads authoritative state after missed sync` mutes WS invalidations, changes authoritative state, dispatches `visibilitychange`, asserts `/api/v1/today` re-read and UI convergence. Client `onVisible` refreshes Today urgently.  
3. **AT9 UI projection:** e2e `personal-task UI projects private vs household visibility` covers child Today private/household labels and manager Household vs Today projection.

## What changed (full r1 surface)

1. **`docs/protected-behaviors.md`** — catalog PB-01…PB-15, sync matrix, tiers, escaped-defect rule, migration baseline.  
2. **`src/server/route-policy.ts`** + completeness test.  
3. **Focused tests** — reconcile, SyncHub, outbox keys, CSRF, personal-task API, migration semantics, visibilitychange e2e, personal-task UI e2e.  
4. **`validate:pr` / `validate:rc`** + Actions workflow calling `validate:pr`.  
5. **Docs** — ARCHITECTURE, CONTRIBUTING, ops-deploy.  
6. **Test hooks** — `__hdSync.ignoreMessagesForTest` / suspend helpers for deterministic sync isolation.  
7. **Visibility Today urgency** — `onVisible` calls `refreshToday` outside `startTransition`.

## Acceptance tests (mapped)

| AT | Result | Evidence class |
| --- | --- | --- |
| 1 Catalog + mapping | **PASS** | `docs/protected-behaviors.md` |
| 2 Sync matrix | **PASS** | Same doc |
| 3 Route-policy + auth boundaries | **PASS** | route-policy test (**new**); origin/grants (**reused**); CSRF (**new**) |
| 4 Migration semantics | **PASS** | `p0-003-migration.test.ts` (**new**) + prior migrate (**reused**) |
| 5 Optimistic + stale/duplicate | **PASS** | reconcile (**new**); step idempotency (**reused**); delayed checklist e2e (**reused**); task mutationId (**new**) |
| 6 Outbox identity / reload / logout | **PASS** | outbox keys (**new**); e2e reload/logout (**reused**) |
| 7 Duplicate/missed WS + visibility recovery | **PASS** | sync-hub (**new**); reconnect e2e (**reused**); **visibilitychange e2e (new, required)** |
| 8 Escaped proposal-status defect | **PASS** | Existing e2e retained |
| 9 Personal-task visibility API + UI | **PASS** | API contracts (**new**/**reused**); **personal-task UI e2e (new, required)** |
| 10 validate / validate:pr / validate:rc | **PASS** | Exact commands run locally (see below) |
| 11 GitHub Actions runs validate:pr | **SUPPLIED / CI RUN NOT YET OBSERVED** | Workflow invokes `npm run validate:pr`; **Actions URL pending push/PR**; required-check remains Project Lead external setting |
| 12 Documentation | **PASS** | protected-behaviors, ARCHITECTURE, CONTRIBUTING, ops-deploy |

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate:pr` | **PASS** (exact script) — lint/typecheck/Vitest 43, build, Chromium e2e **12/12** |
| `npm run validate:rc` | **PASS** (exact script) — validate + build + Chromium+WebKit e2e **24/24** |
| GitHub Actions run URL/result | **NOT RUN** — record after first push/PR |
| Required branch protection | **EXTERNAL / UNKNOWN** — Project Lead setting |

## Reused vs new evidence

**Reused:** P0-001/P0-002 domain/integration suites; prior Playwright scenarios (proposal-status, outbox, reconnect, optimistic delay, grants, WS isolation, origin).

**New (including FIX REQUIRED):** catalog/matrix; route inventory; reconcile/sync-hub/outbox/CSRF/migration/personal-task API tests; visibilitychange e2e; personal-task UI e2e; validate:pr/rc; Actions workflow; visibility Today urgency.

## Deviations from brief

- None. AT7/AT9 are implemented as required acceptance evidence (not optional).

## Remaining gaps

1. **First GitHub Actions run URL/result** — needed for final AT11 acceptance after push/PR.  
2. **Required-check branch protection** — Project Lead repository setting (not claimed by Engineering).

## Suggested follow-up

Architecture re-review of this updated Build Report. After commit/push, attach the Actions run URL for AT11 closeout.
