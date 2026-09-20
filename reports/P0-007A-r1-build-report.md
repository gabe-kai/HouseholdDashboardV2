# Build Report - BRIEF P0-007A r1

**Brief revision implemented:** 1  
**Engineering status:** Re-acceptance FIX REQUIRED closed (local; pending Architecture re-acceptance)  
**Branch:** `brief/p0-007a-household-responsibility-foundation`  
**Base:** Architecture ACCEPT/PROCEED `a6890cc`; integrated main parent `409d147`  
**Prior implementation (Project Lead):** `fd91c8a` (R1–R5 close)  
**Re-acceptance review:** `reports/P0-007A-r1-architecture-reacceptance.md` @ `5bfbe56`  
**Corrections (this pass):** uncommitted on the same branch after `5bfbe56`  
**Pull request:** N/A  

## Readiness

Contract unchanged; **no new readiness round**. Architecture re-acceptance disposition **FIX REQUIRED** for AT4/7/12/15 evidence plus immutable definition kind and same-household ownership storage. Card **Give Cats and Trash one owner and a place in Today** remains **In Progress**.

## Architecture re-acceptance close

| Finding | Close |
| --- | --- |
| **AT4** Trash Tuesday execute + daypart + DST | Integration **AT4** backdates schedule/revision to a controlled Tuesday, executes Trash, asserts evening-before-anytime order and History. E2e `z-p0-007a-cats-trash.spec.ts` executes Trash (keeps Tuesday; widens weekdays only when today is not Tuesday), mixed Today order, History. Unit **AT4** DST/travel weekday seams in `src/domain/time.test.ts`. |
| **AT7** rapid/delayed/out-of-order + pending vs reassign | `z-p0-007a-reacceptance.spec.ts` **AT7**: `mutationDelayMs` rapid taps; abort/reload pending; manager reassign while pending; held older status released after newer open. |
| **AT12** hold/release stale History across clear | Same file **AT12**: capture pre-clear completed History body; clear; hold/release that body on post-clear reload; assert `· Complete ·` does not return (generation fence). |
| **AT15** built shell / signed-out resume / denied | Same file **AT15** on production Playwright server: detail hard reload; signed-out resume via intended path; missing id + child `/new` unavailable. Vite deeplink remains in `test:e2e:vite`. |
| **Immutable definition kind** | Forward migration `013_definition_kind_and_owner_integrity.sql` trigger rejects `UPDATE routine_definitions.kind`. Regression: routine↔responsibility flips abort; dependents unchanged. |
| **Same-household accountable owner** | Migration 013 occurrence insert/update triggers require `accountable_member_id` in the occurrence household. Regression: foreign-household insert/update abort. |

## What changed (this correction pass)

- `db/migrations/013_definition_kind_and_owner_integrity.sql`
- Migration inventory expectations → **13**
- `tests/integration/p0-007a.test.ts`: AT1 through 013; AT4 Tuesday execution; kind/owner storage regressions
- `src/domain/time.test.ts`: AT4 DST/travel weekday
- `tests/e2e/z-p0-007a-cats-trash.spec.ts`: Trash execute + daypart + History
- `tests/e2e/z-p0-007a-reacceptance.spec.ts`: AT7/AT12/AT15 (session display-name aware after 006C renames)

## Verification performed

| Check | Result |
| --- | --- |
| Unit / integration | **PASS** — **168** tests / **27** files |
| `npm run validate:pr` | **PASS** — Chromium e2e **45/45** + Vite **2/2** (`reports/p0-007a-r1-validate-pr.log`) |
| `npm run validate:rc` | **PASS** — Chromium+WebKit **71/71** + Vite **2/2** (`reports/p0-007a-r1-validate-rc.log`) |
| Prior `p0-005` / `p0-006a` / `p0-006b` / `p0-006c` screenshots | **PASS** — SHA-256 unchanged through gates |
| Current-brief screenshots | `reports/p0-007a-r1-screenshots/` refreshed by this gate run |
| Deployment | **NOT RUN** |

## Acceptance tests (AT1–16)

| AT | Result | Evidence |
| --- | --- | --- |
| 1 | **PASS** | Upgrade through **013**; grants; restart; create; backup/restore |
| 2 | **PASS** | Cardinality + AT2b + R2 + kind/owner storage |
| 3 | **PASS** | cats-trash live Household completion |
| 4 | **PASS** | Integration AT4 Tuesday execute; cats-trash execute + daypart + History; time.test DST/travel |
| 5 | **PASS** | fix-required AT5/8 UI (prior) |
| 6 | **PASS** | AT6 bidirectional matrix (prior) |
| 7 | **PASS** | Integration AT7 + reacceptance AT7 rapid/pending/out-of-order UI |
| 8 | **PASS** | AT8 + fix-required Delete/End (prior) |
| 9 | **PASS** | AT9 + AT9b (prior) |
| 10 | **PASS** | AT10 + AT10b (prior) |
| 11 | **PASS** | AT11 + AT11b (prior) |
| 12 | **PASS** | reset-outbox (prior) + reacceptance AT12 stale History hold/release |
| 13 | **PASS** | R3 draft pin + WS/visibility (prior) |
| 14 | **PASS** | AT14 Move-menu + geometry (prior) |
| 15 | **PASS** | Built-shell AT15 + Vite deeplink |
| 16 | **PASS** | Fixture/cleanup; validate gates; prior screenshot dirs unchanged |

## Suggested commit message (do not commit)

```
P0-007A: close r1 re-acceptance AT4/7/12/15 and storage integrity

Add migration 013 for immutable kind and same-household owners,
and prove Trash Tuesday, checklist out-of-order, History hold/release,
and built-shell destination edges.
```
