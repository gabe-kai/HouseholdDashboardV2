# Build Report - BRIEF P0-007C-2 r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (second-review FIX REQUIRED evidence closed; correction pending commit)  
**Branch:** `brief/p0-007c-2-household-display-read-only-dashboard`  
**Commits:**
- `a2b9e422efaf824b1414f74086885bba0a689486` — feat(P0-007C-2): household display principal and read-only wall  
- `90aaa74b3e9b9804fd4a819b997140664ee75062` — fix(P0-007C-2): close FIX REQUIRED evidence and display bootstrap  
- Second-review correction: **N/A** (uncommitted at report time)  
**Pull request:** N/A  

## What changed (second-review evidence)

1. **AT3:** Concurrent claim single winner; claim/session atomic rollback via `setClaimAfterConsumeFailureHook`; absent-Origin → 403 ORIGIN; active display cannot switch to another display’s code; revoke `mutationId` replay does not revoke a later replacement session.
2. **AT5/AT7:** E2E creates Avery household-visible (+ private) tasks; resting overview excludes them; Avery detail shows household-visible only; Casey detail excludes both. Recursive private exclusion retained.
3. **AT6:** Expanded fixtures for routine people aggregates, Unassigned, pending-access Avery, optional + Not needed progress labels, started survivor, repeated-read no-lock. **School-filtered empty omit:** not fixture-proven → matrix cell PARTIAL.
4. **AT9–12:** Multi-context live (routine/responsibility/reassign/family-order/task/open-detail + C-1 today compare). AT10 barriers prove both dashboard requests started; newer snapshot wins; offline socket loss then authoritative change recovers on reconnect/visibility. AT11 holds response in flight before revoke; replacement enrollment; old-token HTTP/reload denial. AT12 real `setOffline` + `__HD_DISPLAY_STALE_MS` stale→blank, late reject, resume/Back.
5. **AT13:** Hosted `__Host-hd_display` Secure/HttpOnly/SameSite/Path/no-Domain; local `hd_dev_display`; 89d/91d idle; absolute Max-Age cap; `last_seen` renewal.
6. **AT14:** Browser `America/Los_Angeles` + skewed `Date.now`; wall clock/date/time from household `serverTime`; midnight-style date change closes open detail and shows new work. Server fake-timer midnight/DST retained.
7. **AT15:** Zero **attempted** member API requests (`/today`, `/auth/session`, `/people`, `/personal-tasks`, `/sync`) on built + Vite deep links.

C-3 remains out of scope. AT17 remains Product. `reports/p0-007b-r1-screenshots` unchanged.

## Files changed (this correction)

- `src/server/display.ts` — claim after-consume failure hook for atomic rollback evidence
- `src/client/DisplayApp.tsx` — `offline`/`online` stale/reconnect; close open detail on household-date change
- `tests/integration/p0-007c-2-evidence.test.ts` — AT3/AT6/AT13 expansions
- `tests/e2e/z-p0-007c-2-live.spec.ts` — AT9–12 rewrite; AT14 browser TZ/clock + midnight detail close
- `tests/e2e/z-p0-007c-2-inspect.spec.ts` — AT5/AT7 household-visible task UI
- `tests/e2e/z-p0-007c-2-isolation.spec.ts` — AT15 zero attempts
- `tests/e2e/z-p0-007c-2-vite-deeplink.spec.ts` — AT15 Vite zero attempts
- `reports/P0-007C-2-r1-build-report.md`

## Verification performed

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` | PASS | **239** tests |
| `npm run lint` | PASS | After unused-var fix |
| `npm run build` | PASS | Client+server; required for DisplayApp date-change in Chromium e2e |
| `npm run test:e2e:chromium:phone:007c2` | PASS | **13** Chromium tests |
| Vite `P0-007C-2` deeplink | PASS | **3** tests |
| WebKit P0-007C-2 | NOT RUN | This pass; Chromium covers AT9–15 paths |
| `validate:pr` / `validate:rc` | NOT RUN | Lint+unit+Chromium 007c2+Vite run locally; full gate not re-executed |
| 007B screenshot archive | UNCHANGED | Not touched |
| AT17 physical wall | NOT RUN | Project Lead / Product |

## Acceptance mapping (AT1–17)

| AT | Evidence | Result |
| --- | --- | --- |
| 1 Populated upgrade + activity-clear preservation | through-014→015 + evidence activity-clear | PASS |
| 2 Manager-to-wall journey | `z-p0-007c-2-enrollment.spec.ts` | PASS (Chromium this run) |
| 3 Claim/command correctness | evidence AT3: prior matrix **+ concurrent/rollback/absent-Origin/cross-display/revoke-replay** | PASS |
| 4 Principal denial matrix | `p0-007c-2-denial-matrix.test.ts` | PASS |
| 5 Response/privacy allowlists | evidence recursive private walk **+ inspect e2e household-visible only in owner detail** | PASS |
| 6 Shared current-day truth | aggregates/Unassigned/pending/optional-Not needed/survivor/no-lock; school-empty **unset** | PASS (school-filtered empty cell PARTIAL) |
| 7 Inspect the wall | inspect switch/detail/idle **+ household-visible task journey** | PASS (Chromium) |
| 8 4K / phone geometry | `z-p0-007c-2-geometry.spec.ts` | PASS (prior Chromium; included in 007c2 grep runs) |
| 9 Live convergence | live AT9 routine/responsibility/reassign/order/task/open-detail + C-1 today compare | PASS (manager calendar exception dimension not separately fixture-driven) |
| 10 Missed/delayed updates | barrier both-started + newer wins + offline socket loss + recovery | PASS |
| 11 Revocation races | in-flight barrier before revoke + replacement + old-token denial/reload | PASS |
| 12 Disconnected exposure | real offline + stale timer + late reject + resume/Back | PASS |
| 13 Persistence / expiry | hosted/local cookie attrs + 89/91 idle + absolute Max-Age + last_seen renew | PASS |
| 14 Date/time boundaries | server fake-timer midnight/DST **+ browser LA TZ + skewed Date.now + midnight detail close** | PASS |
| 15 Bootstrap / nav isolation | isolation + Vite: **zero attempted** member data requests | PASS |
| 16 Regression / CI | Job `e2e-phone-007c2` retained; local npm test + Chromium 007c2 + Vite | PARTIAL (`validate:pr`/`validate:rc` not re-run this pass) |
| 17 Product at-distance | — | NOT RUN (Project Lead) |

## Deviations from brief revision

- AT12 uses `__HD_DISPLAY_STALE_MS = 6000` for a deterministic stale→blank window under real `setOffline`.
- AT6 school-filtered empty omit not fixture-proven (commented in test; matrix cell PARTIAL).
- AT9 does not drive a separate school-calendar exception mutation; family-order + responsibility reassign cover manager plan-side updates.
- AT14 browser midnight uses a fulfilled next-day dashboard snapshot (no public test clock API); server DST/midnight remain integration fake timers.
- WebKit and full `validate:pr`/`validate:rc` not re-executed in this second-review pass.

## Discoveries for Architecture

- Display claim atomicity is proven via a test-only after-consume hook that rolls back with the SQLite transaction.
- Browser `offline`/`online` events drive display stale/reconnect status in addition to WebSocket close.
- Household-date change on dashboard refresh now closes open detail so the new date is not shown above an old-day detail.

## Known limitations

- AT17 physical readability remains Product/Project Lead evidence.
- Second-review correction commit SHA pending authorized commit.
- Backup restore can revive revoked display sessions (existing operational limitation).

## Suggested follow-up

- Project Lead: commit correction (message below), push, confirm Actions thematic **E2E · Phone P0-007C-2**.
- Architecture re-acceptance vs brief r1 second-review findings.
- Optional: re-run WebKit enrollment/inspect + `validate:rc` before merge.
- Product AT17 when hardware is available.

## Suggested commit message

```
fix(P0-007C-2): close second-review AT3–AT15 evidence

Expand claim integrity, current-day truth, cookie/lifetime, live
barrier/recovery/offline, browser midnight detail close, and zero
member-request attempt proofs.
```
