# Build Report - BRIEF P0-007C-3A r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (FIX REQUIRED corrections applied; awaiting Architecture re-review)  
**Branch:** `brief/p0-007c-3a-shared-display-execution`  
**Commits:**
- Implementation: `606cd25` (`feat(P0-007C-3A): shared-display checklist execution`)
- Docs tip prior to correction coding: `03cd4a6` (`P0-007C-3A: record r1 acceptance corrections`)
- Correction commit(s): *working tree ready for Coordinator/user commit* (retired-outbox UX, AT5/8/10/11 evidence, C-2 WebKit AT10 race harden, exact `validate:rc` PASS)
**Pull request:** N/A (not opened by this Build Report)

## What changed

- Forward migration **016** adds typed display actor provenance on `step_reports` / `mutation_receipts`, and display-session CSRF secrets.
- Dedicated display status route with Origin + display-session CSRF; member checklist route unchanged.
- Principal-aware shared checklist write core: display derives owner/kind from stored occurrence; records device actor; performer unknown; structural intent required for wall writes.
- Display occurrence detail exposes minimal structural intent; History shows display submitter without inventing a human performer.
- Display-only IndexedDB outbox (session-keyed, minimal fields) + focused Done / Not needed / Open controls in `/display`.
- **FIX REQUIRED (same r1):** pending date/generation mismatches are marked `rejected` with accessible overview notices (no silent drop); AT5 denial matrix, AT8 Fastify close+rebind restart, AT10 date rollover, and AT11 dual-display/WS/delayed-read evidence added; exact `npm run validate:rc` PASS.
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
- `src/client/display-api.ts` - CSRF session fields + status POST
- `src/client/DisplayApp.tsx` - executable checklist UI + flush/retire notices
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
| 5 Current-day denial | integration AT5: wrong date, required `not_needed`, yesterday/tomorrow, school-filtered-out, ended-unstarted/canceled, removed step, foreign UUID, started survivor actionable | PASS |
| 6 Edit/action race | `p0-007c-3a.test.ts` AT6 + failure hook | PASS |
| 7 Replay/race | `p0-007c-3a.test.ts` AT7 | PASS |
| 8 Offline/reload/restart | `z-p0-007c-3a-offline.spec.ts`: abort POST, Fastify close+rebind (generation bump, DB preserved), same session saves exactly-once | PASS |
| 9 Revoke/replace | `p0-007c-3a.test.ts` AT9 | PASS |
| 10 Reset / day rollover | integration generation clear + prior-day→next-day fence; e2e AT10 date-seam retirement notice (`display-retired-notices`) | PASS |
| 11 Live recovery | `z-p0-007c-3a-live.spec.ts`: two displays + Avery phone converge; forced WS loss/visibility recovery; delayed older occurrence read discarded | PASS |
| 12 Privacy / usability | geometry 4K/1920 controls; private tasks remain excluded by C-2 projection | PASS (local); physical 27″ AT **NOT RUN** (Product) |
| 13 Gates | Exact `npm run validate:rc` | **PASS** |

## Verification performed

- `npx vitest run src/client/display-outbox.test.ts tests/integration/p0-007c-3a.test.ts` — PASS
- Focused Chromium C-3A live + offline specs — PASS
- Exact `npm run validate:rc` — **PASS** (unit/integration 253; Playwright Chromium+WebKit **131 passed**; Vite deep-link **5 passed**; ~14m e2e). Durable log: `reports/_local-screenshots/p0-007c-3a-r1/validate-rc-3.log`
- Prior RC attempts failed only on known C-2 WebKit AT10 live-recovery flake (`NEWER_SNAP` overwritten by a real dashboard poll); isolated re-run PASS; suite harden keeps serving the newer synthetic until unroute; subsequent exact RC clean.
- Physical 27-inch / 10–16-foot readability — **NOT RUN** (Product)
- Hosted deploy — **NOT RUN** (not required; no deploy/merge in this pass)

## Deviations from brief revision

- Display session info returns `sessionId` + `csrfToken` so the client can key the outbox and authorize writes (within allowlisted session metadata).
- AT8 proves HTTP server restart via Fastify close+rebind in the Playwright-managed process (SQLite preserved) rather than killing the webServer PID mid-suite.

## Discoveries for Architecture

- Hard-coded `schema_migrations` tip counts in older upgrade tests (003/005/006c/007b/C-2) must bump when adding migrations; tip is **16**.
- C-2 enrollment UI assertion depended on “Read-only wall view” copy; updated to “Shared wall checklist”.
- C-2 WebKit AT10 barrier test must not `route.continue()` follow-on dashboard polls while the newer synthetic marker is under assertion.

## Known limitations

- C-3B personal-task promotion/completion not implemented.
- Physical wall readability remains Product evidence.
- Display outbox does not persist household read payloads; cold offline load still shows setup/blank, not a cached dashboard.
- Correction implementation is uncommitted pending Coordinator/user commit authorization.

## Suggested follow-up

- Architecture re-review of this corrected r1 against `reports/P0-007C-3A-r1-architecture-review.md`.
- Commit the FIX REQUIRED working tree; pin the correction SHA in this report after commit.
- Product evaluation of shared-display execution and physical AT17 after Architecture acceptance.
- P0-007C-3B owner-controlled personal-task promotion after C-3A evaluation.
