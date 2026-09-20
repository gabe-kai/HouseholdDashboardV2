# Build Report - BRIEF P0-007A r1

**Brief revision implemented:** 1  
**Engineering status:** Final gate FIX REQUIRED closed (local; pending Architecture technical acceptance)  
**Branch:** `brief/p0-007a-household-responsibility-foundation`  
**Base:** Architecture ACCEPT/PROCEED `a6890cc`; integrated main parent `409d147`  
**Prior implementation:** `10a412d` (AT4/7/12/15 + migration 013)  
**Gate-correction review tip:** `27a3c26` (`reports/P0-007A-r1-architecture-reacceptance.md`)  
**Corrections (this pass):** uncommitted on the same branch after `27a3c26`  
**Pull request:** N/A  

## Readiness

Contract unchanged; **no new readiness round**. Architecture confirmed the responsibility corrections are addressed and withheld technical acceptance only for the independent red `npm test` suite (**167/168**) caused by P0-006B AT9’s real-date school-day assumption on Sunday. Card **Give Cats and Trash one owner and a place in Today** remains **In Progress**.

## Final gate correction

| Finding | Close |
| --- | --- |
| **P0-006B AT9** date-sensitive school-day assumption | `tests/integration/p0-006b.test.ts` AT9 now uses the existing controlled school-day seam already used by AT7/AT8/injectable AT9: usual weekdays `[1–7]` so `Pack Lunchbox` (`school_days`) materializes on any household date. Exception-off + obsolete-step rejection behavior preserved. |

Prior AT4/AT7/AT12/AT15 evidence and migration 013 kind/ownership integrity remain as closed at `10a412d`; Architecture did not reopen them.

## What changed (this correction pass)

- `tests/integration/p0-006b.test.ts` — stabilize AT9 calendar/obsolete-step path so it does not depend on the host weekday

## Verification performed

| Check | Result |
| --- | --- |
| `npm test` | **PASS** — **168** tests / **27** files (`reports/p0-007a-r1-npm-test.log`) |
| `npm run validate:pr` | **PASS** — Chromium e2e **45/45** + Vite **2/2** (`reports/p0-007a-r1-validate-pr.log`) |
| `npm run validate:rc` | **PASS** — Chromium+WebKit **71/71** + Vite **2/2** (`reports/p0-007a-r1-validate-rc.log`) |
| Prior `p0-005` / `p0-006b` / `p0-006c` screenshots | **PASS** — SHA-256 unchanged through gates (`p0-006a` screenshot dir not present in tree) |
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
P0-007A: stabilize P0-006B AT9 school-day date seam

Use the existing all-weekday school calendar control so AT9 no longer
depends on the host weekday, restoring a deterministic green npm test.
```
