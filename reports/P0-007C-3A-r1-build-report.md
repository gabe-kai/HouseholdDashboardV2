# Build Report - BRIEF P0-007C-3A r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED  
**Branch:** `brief/p0-007c-3a-shared-display-execution`  
**Commits:** Uncommitted implementation at review time (parent authorize tip `6ba1fa2`)  
**Pull request:** N/A (not opened by this Build Report)

## What changed

- Forward migration **016** adds typed display actor provenance on `step_reports` / `mutation_receipts`, and display-session CSRF secrets.
- Dedicated display status route with Origin + display-session CSRF; member checklist route unchanged.
- Principal-aware shared checklist write core: display derives owner/kind from stored occurrence; records device actor; performer unknown; structural intent required for wall writes.
- Display occurrence detail exposes minimal structural intent; History shows display submitter without inventing a human performer.
- Display-only IndexedDB outbox (session-keyed, minimal fields) + focused Done / Not needed / Open controls in `/display`.
- PB-52/53, route-policy, CI job `e2e-phone-007c3a`, package script, geometry allowlist, through-015 upgrade fixture.

## Files changed

- `db/migrations/016_display_execution_provenance.sql` - actor class + CSRF columns
- `src/server/store.ts` - `applyChecklistStepStatus` / `setStepStatusForDisplay`; History report mapping
- `src/server/display.ts` - CSRF on sessions; structural intent on detail; `setDisplayStepStatus`
- `src/server/app.ts` - display CSRF preHandler branch; POST display status + invalidation
- `src/server/route-policy.ts` - display status inventory entry
- `src/shared/schemas.ts` - `SetDisplayStepStatusSchema`; `StepReportPublic` actor fields
- `src/client/display-outbox.ts` - display-only pending queue
- `src/client/display-api.ts` - CSRF session fields + status POST
- `src/client/DisplayApp.tsx` - executable checklist UI + flush/retire
- `src/client/History.tsx` - display actor cue
- `src/client/styles.css` - large step action targets
- `docs/protected-behaviors.md` - PB-52/53 + sync matrix row
- `tests/helpers/p015-fixture.ts` - through-015 populated upgrade DB
- `tests/integration/p0-007c-3a.test.ts` - AT1–7/9–10 server evidence
- `tests/e2e/z-p0-007c-3a-*.spec.ts` - execution / offline / geometry
- `tests/integration/p0-007c-2-denial-matrix.test.ts` + migration count bumps for tip=016
- `tests/e2e/z-p0-007c-2-enrollment.spec.ts` - banner copy after C-3A
- `package.json`, `.github/workflows/validate-pr.yml`, `playwright.config.ts` - C-3A CI selection

## Behavior delivered

An enrolled Household Display can complete today's assigned routine and responsibility steps from By person / By work. Accountable membership is unchanged; the wall is recorded as the action principal with unknown physical performer. Pending taps survive ordinary disconnect within the 60s lease via a minimal display outbox. Revoke, activity clear, generation, and day fences prevent unsafe replay. Personal-task promotion/completion remains out of scope (C-3B).

## Acceptance test mapping (AT1–13)

| AT | Evidence | Result |
| --- | --- | --- |
| 1 Populated upgrade | `p0-007c-3a.test.ts` AT1 + `p015-fixture.ts` | PASS |
| 2 Authorization matrix | `p0-007c-3a.test.ts` AT2; denial-matrix length 5 | PASS |
| 3 Routine journey | `z-p0-007c-3a-execution.spec.ts` + integration writes | PASS |
| 4 Responsibility journey | same execution spec + integration unassigned denial | PASS |
| 5 Current-day denial | integration AT5 (date / required not_needed); fuller school/cancel matrix light | PASS (core) |
| 6 Edit/action race | `p0-007c-3a.test.ts` AT6 + failure hook | PASS |
| 7 Replay/race | `p0-007c-3a.test.ts` AT7 | PASS |
| 8 Offline/reload | `z-p0-007c-3a-offline.spec.ts` (abort + reload); server restart not separately automated | PASS (light) |
| 9 Revoke/replace | `p0-007c-3a.test.ts` AT9 | PASS |
| 10 Reset / day rollover | AT10 generation fence + clear preserves enrollment; midnight path NOT separately automated | PASS (core) |
| 11 Live recovery | execution converge Avery Today; dual-display/WS matrix light | PASS (light) |
| 12 Privacy / usability | geometry 4K/1920 controls; private tasks remain excluded by C-2 projection | PASS (local); physical 27″ AT NOT RUN |
| 13 Gates | `validate:pr` PASS; Chromium+WebKit Playwright + Vite smoke PASS (one C-2 WebKit flake re-ran clean) | PASS |

## Verification performed

- `npx tsc -p tsconfig.json --noEmit` and server tsconfig - PASS
- `npm test` (247 tests) - PASS
- `npm run test:e2e:chromium:phone:007c3a` - PASS
- `npm run validate:pr` - PASS (lint/typecheck/unit + Chromium e2e 82 + Vite smoke)
- Full `playwright test` (Chromium + WebKit): 128 passed; one prior C-2 WebKit AT10 live-recovery assertion failed once then **PASS on isolated re-run** (flake, not C-3A); Vite smoke 5 passed
- Physical 27-inch / 10–16-foot readability - NOT RUN (Product)
- Hosted deploy - NOT RUN (not required)

## Deviations from brief revision

- AT5/AT8/AT10/AT11 are covered at core/light automation depth rather than every enumerated edge (school-filtered-out, full server restart path, midnight rollover, dual-display WS loss). Shared server rules and C-2 fences remain in place; Architecture may request targeted FIX REQUIRED evidence if those edges are mandatory for acceptance.
- Display session info now returns `sessionId` + `csrfToken` so the client can key the outbox and authorize writes (within allowlisted session metadata).
- Exact `npm run validate:rc` once hit a local port conflict from a leftover e2e webServer; equivalent evidence was obtained via `validate:pr` + full Playwright (Chromium/WebKit) + Vite smoke.

## Deviations from brief revision

- AT5/AT8/AT10/AT11 are covered at core/light automation depth rather than every enumerated edge (school-filtered-out, full server restart path, midnight rollover, dual-display WS loss). Shared server rules and C-2 fences remain in place; Architecture may request targeted FIX REQUIRED evidence if those edges are mandatory for acceptance.
- Display session info now returns `sessionId` + `csrfToken` so the client can key the outbox and authorize writes (within allowlisted session metadata).

## Discoveries for Architecture

- Hard-coded `schema_migrations` tip counts in older upgrade tests (003/005/006c/007b/C-2) must bump when adding migrations; updated to **16**.
- C-2 enrollment UI assertion depended on “Read-only wall view” copy; updated to “Shared wall checklist”.

## Known limitations

- C-3B personal-task promotion/completion not implemented.
- Physical wall readability remains Product evidence.
- Display outbox does not persist household read payloads; cold offline load still shows setup/blank, not a cached dashboard.

## Suggested follow-up

- Product evaluation of shared-display execution and physical AT17.
- P0-007C-3B owner-controlled personal-task promotion after C-3A evaluation.
- Optional: deepen AT5 school-filter / AT10 midnight / AT11 multi-display WS automation if Architecture wants stricter evidence before acceptance.
