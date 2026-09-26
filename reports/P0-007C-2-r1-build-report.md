# Build Report - BRIEF P0-007C-2 r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (third-review FIX REQUIRED evidence closed; correction pending commit)  
**Branch:** `brief/p0-007c-2-household-display-read-only-dashboard`  
**Commits:**
- `a2b9e422efaf824b1414f74086885bba0a689486` — feat(P0-007C-2): household display principal and read-only wall  
- `90aaa74b3e9b9804fd4a819b997140664ee75062` — fix(P0-007C-2): close FIX REQUIRED evidence and display bootstrap  
- `ba5541cbc86199749e5783025ae452fdb2794ac4` — fix(P0-007C-2): close second-review AT3–AT15 evidence  
- Third-review correction: **N/A** (uncommitted at report time)  
**Pull request:** N/A  

## What changed (third-review evidence)

1. **AT6:** School-filtered-empty case — school-only routine omitted on a no-school (exception) day while neighboring every-time routine and existing responsibilities remain on the display dashboard.
2. **AT9:** Manager school-calendar exception journey (school-only appears, then omits; neighbors stay); mandatory unstarted-responsibility reassignment to Casey with wall By-work assertion; mandatory unconditional C-1 owner/status parity for that row.
3. **AT16:** Full `npm run validate:pr` and `npm run validate:rc` re-run after corrections (RC includes WebKit).

C-3 remains out of scope. AT17 remains Product. `reports/p0-007b-r1-screenshots` unchanged.

## Files changed (this correction)

- `tests/integration/p0-007c-2-evidence.test.ts` — AT6 school-filtered empty omit + neighbor retention
- `tests/e2e/z-p0-007c-2-live.spec.ts` — AT9 calendar exception; mandatory reassign + C-1 parity
- `reports/P0-007C-2-r1-build-report.md`
- `PROJECT_STATE.md`

## Verification performed

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` (inside validate) | PASS | **239** tests |
| `npm run lint` / `typecheck` | PASS | Via `validate` |
| `npm run build` | PASS | Via `validate:pr` / `validate:rc` |
| `npm run validate:pr` | PASS | Unit 239; Chromium(+desktop/display) e2e **77** passed; Vite **5** passed (~8.5m) |
| `npm run validate:rc` | PASS | Full e2e **124** passed, **22** skipped (includes WebKit); Vite **5** passed (~13.6m). WebKit P0-007C-2 enrollment/inspect/isolation/live AT9–14 passed |
| 007B screenshot archive | UNCHANGED | Not touched |
| AT17 physical wall | NOT RUN | Project Lead / Product |

## Acceptance mapping (AT1–17)

| AT | Evidence | Result |
| --- | --- | --- |
| 1 Populated upgrade + activity-clear preservation | through-014→015 + evidence activity-clear | PASS |
| 2 Manager-to-wall journey | enrollment e2e (Chromium + WebKit in RC) | PASS |
| 3 Claim/command correctness | evidence AT3 concurrent/rollback/absent-Origin/cross-display/revoke-replay | PASS |
| 4 Principal denial matrix | `p0-007c-2-denial-matrix.test.ts` | PASS |
| 5 Response/privacy allowlists | recursive private walk + inspect household-visible owner detail | PASS |
| 6 Shared current-day truth | aggregates/Unassigned/pending/optional-Not needed/survivor/no-lock **+ school-filtered empty omit with neighbor retained** | PASS |
| 7 Inspect the wall | inspect switch/detail/idle + household-visible task (Chromium + WebKit) | PASS |
| 8 4K / phone geometry | geometry e2e (Chromium; WebKit geometry skipped by project policy) | PASS |
| 9 Live convergence | routine/responsibility/order/task/open-detail **+ calendar exception + mandatory reassign/Casey wall + mandatory C-1 parity** | PASS |
| 10 Missed/delayed updates | barrier both-started + newer wins + offline recovery | PASS |
| 11 Revocation races | in-flight barrier + replacement + old-token denial | PASS |
| 12 Disconnected exposure | real offline + stale→blank + late/Back | PASS |
| 13 Persistence / expiry | hosted/local cookies + 89/91 idle + absolute Max-Age + renew | PASS |
| 14 Date/time boundaries | server fake-timer + browser LA TZ/skewed Date.now + midnight detail close | PASS |
| 15 Bootstrap / nav isolation | zero attempted member data requests (built + Vite) | PASS |
| 16 Regression / CI | `validate:pr` PASS; `validate:rc` PASS (WebKit included) | PASS |
| 17 Product at-distance | — | NOT RUN (Project Lead) |

## Deviations from brief revision

- AT12 uses `__HD_DISPLAY_STALE_MS = 6000` for a deterministic stale→blank window under real `setOffline`.
- AT14 browser midnight uses a fulfilled next-day dashboard snapshot (no public test clock API); server DST/midnight remain integration fake timers.
- AT9 reassignment uses a dedicated unstarted responsibility (started survivor would keep the original owner).

## Discoveries for Architecture

- None new beyond prior correction discoveries.

## Known limitations

- AT17 physical readability remains Product/Project Lead evidence.
- Third-review correction commit SHA pending authorized commit.
- Backup restore can revive revoked display sessions (existing operational limitation).

## Suggested follow-up

- Project Lead: commit correction (message below), push, confirm Actions thematic **E2E · Phone P0-007C-2**.
- Architecture re-acceptance vs brief r1 third-review findings.
- Product AT17 when hardware is available.

## Suggested commit message

```
fix(P0-007C-2): close AT6 school-empty and AT9 calendar evidence

Prove school-filtered omit with neighbors, mandatory reassign/C-1
parity plus calendar exception live, and record validate:pr/rc PASS.
```
