# Architecture Review - P0-007C-3A r1

**Brief:** `briefs/p0-007c-3a-shared-display-execution.md`  
**Baseline:** integrated C-2 `main` at `739f7e3`  
**Implementation:** `606cd25ef11b88ecf9a158caa8942965a6a2d943` on `brief/p0-007c-3a-shared-display-execution`  
**Build Report:** `reports/P0-007C-3A-r1-build-report.md`  
**Disposition:** FIX REQUIRED (same revision; contract unchanged)  
**Next owner:** Engineering  
**Card:** **Act at the shared display without losing trust** remains **In Progress**.

## Decision

The implementation establishes the dedicated display write path, truthful actor provenance, focused checklist controls, and core replay/revoke protections. Architecture cannot accept r1 yet: one client behavior contradicts the pending-intent contract, several explicitly required acceptance edges are only partial or not run, and the exact RC gate did not complete.

No new readiness review or brief revision is required. Close these findings against **P0-007C-3A r1** and return the updated Build Report for re-review. Do not deploy or merge as part of this correction.

## Required corrections

1. **Retired pending commands must be explained.** `retireMismatchedDisplayOutbox` removes pending/retrying commands when household date or activity generation changes (`src/client/display-outbox.ts`); `DisplayApp` applies the shortened queue and clears `pendingCue` on date change (`src/client/DisplayApp.tsx`). No user-visible rejected/retired status remains. This violates brief § Behavioral contract 6: a prior-day or prior-generation tap must not replay, but its retirement must not be silent. Keep the no-replay fence and provide persistent, accessible feedback that the tap was not saved and why. Add regression coverage for both date and generation retirement, including reload/reconnect if that is how the production path is reached.

2. **AT5 — unavailable-work denial matrix.** Current named AT5 integration evidence proves wrong `householdDate` and rejects `not_needed` on a required step. Add evidence for the brief's other material cases: yesterday/tomorrow targeting, school-filtered-out work, ended-unstarted/canceled work, removed steps, foreign/unavailable work, and a legitimately started survivor remaining actionable. Keep each denial non-mutating and ensure the client explains rejection where a queued action is involved.

3. **AT8 — server restart recovery.** The browser test aborts the status POST, reloads, then allows the same running server to respond. Extend the local journey to actually restart the server between queueing and replay, reconnect the same still-valid display session, and prove exactly-once save or a visible reasoned rejection without rendering a cached household payload.

4. **AT10 — household-date rollover.** Generation-clear coverage does not prove the separate midnight/date fence. Use the existing deterministic date seam to queue a prior-day tap, advance the household date, and prove that it cannot newly commit against the next day's work; show its retired/rejected explanation and authoritative next-day state.

5. **AT11 — multi-display/live recovery.** The named browser journey exercises one display and a human context. Add two display contexts plus phone/manager context; prove a wall action reaches the other views without reload, then force display WebSocket loss and exercise reconnect/visibility recovery. Hold or delay an older display read so an out-of-order response cannot restore stale step state or erase pending feedback.

6. **AT13 — exact release-candidate gate.** The Build Report says `npm run validate:rc` did not complete because of a local port conflict. Resolve the leftover server/process conflict and run the exact script successfully. Equivalent manual Playwright/Vite commands are useful evidence but do not satisfy the brief's explicit exact-command gate.

## Build Report accuracy

On correction, pin the committed implementation SHA above and any correction commit(s) in the Build Report; it currently says the implementation is uncommitted. Consolidate the duplicated “Deviations from brief revision” paragraph and mark ATs partial/not run until the named evidence exists. Preserve the C-2 WebKit flake disclosure with its original and rerun outcomes; it is not independently a blocker if the exact RC gate passes cleanly.

## Evidence accepted so far

The report names passing evidence for populated migration, core authorization and routine/responsibility execution, edit/action transaction ordering, mutation replay, revoke/replace ordering, and activity-generation clear. `validate:pr` is reported PASS. These do not substitute for the remaining cases above. Physical 27-inch readability and hosted deployment are not required for C-3A technical acceptance; physical readability remains Project Lead/Product evidence.

## Return handoff

Return the corrected implementation and updated `reports/P0-007C-3A-r1-build-report.md` against the same r1 contract. Keep C-3B out of scope. After Architecture accepts, the card may move to **Ready to Evaluate**; do not mark the larger C outcome **Accepted** from C-3A alone.
