# Build Report - BRIEF P0-007C-3A r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (AT11 WS re-review evidence + exact `validate:rc` PASS; awaiting Architecture re-review)  
**Branch:** `brief/p0-007c-3a-shared-display-execution`  
**Commits:**
- Implementation: `606cd25` (`feat(P0-007C-3A): shared-display checklist execution`)
- Docs tip prior to first corrections: `03cd4a6`
- First FIX REQUIRED correction: `55afa52eb60bb95703b6b0656835940aa0de7484` (`fix(P0-007C-3A): close r1 FIX REQUIRED evidence gaps`)
- Re-review tip: `f1d4896` (`P0-007C-3A: record r1 re-review and remaining AT11 gap`)
- AT11 WS re-review evidence (socket close + mid-outage write + reconnect converge + delayed read): tip after `f1d4896` — pin SHA when Project Lead commits
**Pull request:** N/A (not opened by this Build Report)

## What changed

- Forward migration **016** adds typed display actor provenance on `step_reports` / `mutation_receipts`, and display-session CSRF secrets.
- Dedicated display status route with Origin + display-session CSRF; member checklist route unchanged.
- Principal-aware shared checklist write core: display derives owner/kind from stored occurrence; records device actor; performer unknown; structural intent required for wall writes.
- Display occurrence detail exposes minimal structural intent; History shows display submitter without inventing a human performer.
- Display-only IndexedDB outbox (session-keyed, minimal fields) + focused Done / Not needed / Open controls in `/display`.
- **FIX REQUIRED batch (`55afa52`):** retired outbox explanations; AT5/8/10 evidence; AT11 dual-display skeleton; exact `validate:rc` PASS; C-2 WebKit AT10 harden.
- **AT11 re-review:** `__HD_DISPLAY_CLOSE_SYNC__` / `dropSocket` closes the observed live display sync WebSocket; Playwright awaits that socket’s `close`; wall A commits Wipe **Saved** (scoped — not Counters’ flash) while wall B sync/dashboard are held and the frozen pre-outage `1/2 done` snapshot is asserted unchanged; `__HD_DISPLAY_RECONNECT_SYNC__` clears abort backoff and restores the socket; visibility/pageshow HTTP refresh proves wall B converges without reload; delayed/out-of-order occurrence read retained. Initial converge requires real `1/2 done` (not a loose `/done/` match on stale `0/2 done`).
- PB-52/53, route-policy, CI job `e2e-phone-007c3a`, package script, geometry allowlist, through-015 upgrade fixture.

## Files changed

- `db/migrations/016_display_execution_provenance.sql` - actor class + CSRF columns
- `src/server/store.ts` - `applyChecklistStepStatus` / `setStepStatusForDisplay`; History report mapping
- `src/server/display.ts` - CSRF on sessions; structural intent on detail; `setDisplayStepStatus`
- `src/server/app.ts` - display CSRF preHandler branch; POST display status + invalidation
- `src/server/route-policy.ts` - display status inventory entry
- `src/shared/schemas.ts` - `SetDisplayStepStatusSchema`; `StepReportPublic` actor fields
- `src/client/display-outbox.ts` - display-only pending queue; retire → rejected with reason
- `src/client/display-outbox.test.ts` - date/generation retirement unit coverage
- `src/client/display-api.ts` - CSRF session fields + status POST; `DisplaySyncHandle.dropSocket` / `reconnectNow`
- `src/client/DisplayApp.tsx` - executable checklist UI + flush/retire notices; `__HD_DISPLAY_CLOSE_SYNC__` / `__HD_DISPLAY_RECONNECT_SYNC__`
- `src/client/History.tsx` - display actor cue
- `src/client/styles.css` - large step action targets
- `docs/protected-behaviors.md` - PB-52/53 + sync matrix row
- `tests/helpers/p015-fixture.ts` - through-015 populated upgrade DB
- `tests/helpers/e2e-restart-server.ts` - Fastify rebind signal for AT8
- `tests/e2e/start-server.ts` - restart-flag watcher; generation file; preserve-DB option
- `tests/integration/p0-007c-3a.test.ts` - AT1–7/9–10 server evidence including full AT5 matrix + date fence
- `tests/e2e/z-p0-007c-3a-*.spec.ts` - execution / offline restart / live dual-display / geometry
- `tests/e2e/z-p0-007c-2-live.spec.ts` - WebKit AT10 keep serving newer synthetic until unroute (RC flake harden)
- `tests/integration/p0-007c-2-denial-matrix.test.ts` + migration count bumps for tip=016
- `tests/e2e/z-p0-007c-2-enrollment.spec.ts` - banner copy after C-3A
- `package.json`, `.github/workflows/validate-pr.yml`, `playwright.config.ts` - C-3A CI selection

## Behavior delivered

An enrolled Household Display can complete today's assigned routine and responsibility steps from By person / By work. Accountable membership is unchanged; the wall is recorded as the action principal with unknown physical performer. Pending taps survive ordinary disconnect within the 60s lease via a minimal display outbox. Date/generation retirement keeps the no-replay fence and explains why a prior-day or prior-generation tap was not saved. Revoke, activity clear, generation, and day fences prevent unsafe replay. Personal-task promotion/completion remains out of scope (C-3B).

## Acceptance test mapping (AT1–13)

| AT | Evidence | Result |
| --- | --- | --- |
| 1 Populated upgrade | `p0-007c-3a.test.ts` AT1 + `p015-fixture.ts` | PASS |
| 2 Authorization matrix | `p0-007c-3a.test.ts` AT2; denial-matrix length 5 | PASS |
| 3 Routine journey | `z-p0-007c-3a-execution.spec.ts` + integration writes | PASS |
| 4 Responsibility journey | same execution spec + integration unassigned denial | PASS |
| 5 Current-day denial | integration AT5 full matrix | PASS |
| 6 Edit/action race | `p0-007c-3a.test.ts` AT6 + failure hook | PASS |
| 7 Replay/race | `p0-007c-3a.test.ts` AT7 | PASS |
| 8 Offline/reload/restart | `z-p0-007c-3a-offline.spec.ts` Fastify close+rebind | PASS |
| 9 Revoke/replace | `p0-007c-3a.test.ts` AT9 | PASS |
| 10 Reset / day rollover | integration + e2e date-seam retirement | PASS |
| 11 Live recovery | `z-p0-007c-3a-live.spec.ts`: two displays + phone; observe open sync WS; `__HD_DISPLAY_CLOSE_SYNC__` closes it; wall A Wipe **Saved** during held outage; wall B frozen `1/2 done` unchanged; `__HD_DISPLAY_RECONNECT_SYNC__` + visibility/pageshow converge without reload; delayed older occurrence read discarded | PASS |
| 12 Privacy / usability | geometry 4K/1920 | PASS (local); physical 27″ **NOT RUN** |
| 13 Gates | Exact `npm run validate:rc` | PASS |

## Verification performed

- Focused Chromium AT11 (`z-p0-007c-3a-live.spec.ts` AT11) after Wipe API commit + flush follow-up — PASS (3/3 loop; log `at11-focused-rerun3.log` / `at11-loop-*.log`)
- Exact `npm run validate:rc` after AT11 re-review — **PASS** (253 unit; 131 Playwright; 5 Vite; log `validate-rc-at11d.log`; `RC_EXIT=0`)
- Prior exact `validate:rc` at `55afa52` — PASS (253 unit; 131 Playwright; 5 Vite; log `validate-rc-3.log`)
- Interim RC logs `validate-rc-at11.log` / `at11b` / `at11c` — FAIL on AT11 evidence gaps (false converge / Saved flash / flush race); fixed in tip
- C-2 WebKit AT10: failed under full RC twice, PASS on isolated re-run, then suite harden + clean RC
- Physical 27-inch readability — **NOT RUN** (Product)
- Hosted deploy — **NOT RUN** (not required)

## Deviations from brief revision

- Display session info returns `sessionId` + `csrfToken` so the client can key the outbox and authorize writes (within allowlisted session metadata).
- AT8 proves HTTP server restart via Fastify close+rebind in the Playwright-managed process (SQLite preserved).
- AT11 uses display-only test seams `__HD_DISPLAY_CLOSE_SYNC__` (close live socket) and `__HD_DISPLAY_RECONNECT_SYNC__` (clear abort backoff + open); reconnect remains the production `onclose` / visibility refresh path.

## Discoveries for Architecture

- Hard-coded `schema_migrations` tip counts must bump when adding migrations; tip is **16**.
- C-2 WebKit AT10 barrier test must not `route.continue()` follow-on dashboard polls while the newer synthetic marker is under assertion.
- Playwright page WebSocket objects are observational only; closing the live display sync socket for AT11 requires an app test seam or server-side drop.
- AT11 initial converge must assert real `1/2 done`; a loose `/done|progress/` match false-passes on stale `0/2 done` under suite load.
- AT11 mid-outage commit must wait for authoritative Wipe `not_needed` (phone `/api/v1/today`), not any step’s lingering Saved flash.
- Display outbox flush must re-enter when a queue arrives during an in-flight flush (`flushAgainRef`).

## Known limitations

- C-3B personal-task promotion/completion not implemented.
- Physical wall readability remains Product evidence.
- Display outbox does not persist household read payloads; cold offline load still shows setup/blank, not a cached dashboard.

## Suggested follow-up

- Architecture re-review of AT11 WS evidence against `reports/P0-007C-3A-r1-architecture-reacceptance.md`.
- Project Lead: commit AT11 WS re-review tip and pin that SHA in Commits above.
- Product evaluation / physical AT17 after Architecture acceptance.
- P0-007C-3B after C-3A evaluation.
