# Build Report - BRIEF P0-007C-3B r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (FIX REQUIRED correction); awaiting Architecture re-review  
**Branch:** `brief/p0-007c-3b-personal-work-wall-promotion`  
**Commits:** none yet (Coordinator/user owns Git; implementation is working-tree only at report time)  
**Pull request:** N/A (not opened by this Build Report)

## What changed

- Forward migration **017** adds `show_on_shared_dashboard`, durable `completed_at`, `sharing_version`, and `personal_task_sharing_mutations` receipts. Existing tasks remain unpromoted; completed tasks backfill `completed_at` from prior `updated_at` projection.
- Owner-only `POST /api/v1/personal-tasks/:id/sharing` with mutation-id replay, payload-digest conflict, and `expectedSharingVersion` stale-edit conflict. Private always clears promotion; contradictory private+promoted payloads fail validation atomically.
- Create/status paths preserve `completedAt` across sharing edits; create may set promotion only when visibility is household.
- Display resting By person / By work summaries list open, household-visible, explicitly promoted personal tasks under owners, separate from recurring progress. Unpromoted household tasks remain person-detail only; private IDs/titles never enter display payloads.
- Member sync: `SyncHub.add` is membership-aware; `broadcastPersonalTask` sends private task IDs only to the owner; household→private also pings nonowners with empty `resourceId` so they refetch without receiving the private ID. Display invalidates on was-or-is household-visible task changes (`reason: tasks`).
- Today UI: visibility + “Shared dashboard” controls on create and existing tasks.
- **FIX REQUIRED (same r1):** Today `setStatus` no longer replaces the whole task from a delayed status response. It merges only `status` / `completedAt` / `updatedAt` into the latest task by id via `applyPersonalTaskStatusResult`, using functional `onTasksChanged` updates so a held status body cannot restore pre-downgrade Household visibility or promotion after a Private save.
- PB-54/55, route-policy sharing row, sync-matrix updates, CI job `e2e-phone-007c3b`, package script, geometry allowlists, through-016 upgrade fixture, tip migration counts → 17.

## Files changed

- `db/migrations/017_personal_task_wall_promotion.sql` — promotion + completed_at + sharing receipts
- `src/shared/schemas.ts` — create promote field; `UpdatePersonalTaskSharingSchema`
- `src/server/store.ts` — create/status/sharing/`getTaskDisplayRelevance`; completed_at projection
- `src/server/sync-hub.ts` — membership-scoped add; `broadcastPersonalTask` privacy rules
- `src/server/app.ts` — sharing route; `notifyPersonalTaskChange`; sync.add membershipId
- `src/server/display.ts` — promoted resting summaries + person-detail `showOnSharedDashboard`
- `src/server/route-policy.ts` — sharing inventory
- `src/client/api.ts` / `display-api.ts` / `TodayView.tsx` / `DisplayApp.tsx` / `App.tsx` / `styles.css` — owner controls, wall summaries, urgent personal_task refresh; status-field merge + functional task updates
- `src/client/TodayView.personal-task.test.ts` — unit coverage that a stale status payload cannot restore sharing/promotion
- `docs/protected-behaviors.md` — PB-54/55 + sync matrix
- `ARCHITECTURE.md` — PR validation job list includes C-3B
- `package.json`, `.github/workflows/validate-pr.yml`, `playwright.config.ts` — C-3B CI selection
- `tests/helpers/p016-fixture.ts` — through-016 populated upgrade DB
- `tests/integration/p0-007c-3b.test.ts` — AT1/2–7/6 server evidence
- `tests/e2e/z-p0-007c-3b-promotion.spec.ts` / `z-p0-007c-3b-geometry.spec.ts` — AT2/6/8 browser evidence + held-status / Private-save race regression
- `src/server/sync-hub.test.ts` — membership add + private fan-out unit coverage
- Tip-count bumps: `p0-003-migration`, `p0-005`, `p0-006c`, `p0-007b`, `p0-007c-2-display`

## Behavior delivered

Owners can keep a household-visible personal task off the wall or explicitly promote it to compact resting summaries. Private work never appears on the wall; making a promoted task private clears promotion and withdraws summaries via sanitized member/display sync. Completing a promoted task quiets resting summaries without inventing wall task execution. Completion time survives sharing edits. A delayed owner-client status response after Household→Private cannot restore Household visibility or promotion. C-3A assigned checklist actions remain the only display writes.

## Acceptance test mapping (AT1–8)

| AT | Evidence | Result |
| --- | --- | --- |
| 1 Populated upgrade | `p0-007c-3b.test.ts` AT1 + `p016-fixture.ts` | PASS |
| 2 Owner journey | `z-p0-007c-3b-promotion.spec.ts` AT2/AT8 light + integration promote/unpromote | PASS |
| 3 Authority matrix | integration AT2/AT3/AT4 (peer/manager 403, display 401/403, replay/conflict/version) | PASS |
| 4 Visibility reversal | integration AT4 (private clears promote; re-share does not restore; contradictory 400; completedAt preserved) + held-status e2e | PASS |
| 5 Read matrix | integration AT5/AT7 (dashboard/person detail; private omitted; unpromoted detail-only; completed quiet in summary) | PASS |
| 6 Cross-context recovery | integration AT6 WS privacy + e2e dual-wall withdraw + delayed older dashboard discard + held status after Private | PASS |
| 7 Display boundaries | integration AT5/AT7 (no display personal status/sharing) | PASS |
| 8 Presentation and gates | geometry e2e (phone + desktop/display allowlist); exact `validate:pr` + `validate:rc` after FIX REQUIRED | PASS (local automated); physical 27″ **NOT RUN** |

## Verification performed

### Original r1 implementation
- Focused `vitest` `tests/integration/p0-007c-3b.test.ts` — PASS (4)
- Focused Chromium `P0-007C-3B` e2e — PASS (3); log `validate-3b-e2e4.log`
- Prior failing regressions after aria-label/CSS fix (morning-routine personal tasks, C-1 today/household, 006A geometry, C-3B) — PASS (10); log `validate-3b-regress.log`
- Exact `npm run validate:pr` — **PASS** (258 unit/integration; 89 Chromium Playwright; 5 Vite; log `validate-pr-3b-4.log`; exit 0). One earlier full-suite attempt failed on flaky `z-p0-006c-reset-outbox` which PASSes in isolation (`validate-6c-flake.log`) and on the clean PR re-run.
- Exact `npm run validate:rc` — **PASS** (258 unit/integration; 136 Chromium+WebKit Playwright; 5 Vite; log `validate-rc-3b.log`; exit 0)

### FIX REQUIRED correction (same r1)
- `vitest` `src/client/TodayView.personal-task.test.ts` — PASS (stale status cannot restore sharing/promotion)
- Chromium held-status / Private-save e2e — PASS; log `validate-3b-fix-held6.log`
- Chromium C-3B promotion + geometry suite — PASS (5); log `validate-3b-fix-suite.log`
- Exact `npm run validate:pr` — **PASS** (259 unit/integration; 90 Chromium Playwright; 5 Vite; log `validate-pr-3b-fix2.log`; exit 0). An earlier attempt (`validate-pr-3b-fix.log`) failed once on unrelated flaky `z-p0-007a-reacceptance` AT12 held History body; that case PASSes in isolation (`validate-007a-flake.log`) and on the clean PR re-run.
- Exact `npm run validate:rc` — **PASS** (259 unit/integration; 137 Chromium+WebKit Playwright; 5 Vite; log `validate-rc-3b-fix.log`; exit 0)
- Physical 27-inch readability — **NOT RUN** (Product / Project Lead)
- Hosted deploy — **NOT RUN** (not required)

## Deviations from brief revision

- None material. Engineering chose dedicated `completed_at` + `sharing_version` columns and a sharing-mutation receipt table under D-048.
- Household→private member fan-out uses empty `resourceId` for nonowners (sanitized ping) rather than omitting the event entirely, so Household overview can drop withdrawn tasks without learning the private ID.
- FIX REQUIRED disposition addressed without changing the brief contract: status responses merge completion fields only; sharing remains the authority for visibility/promotion in owner client state.

## Discoveries for Architecture

- Hard-coded `schema_migrations` tip counts must bump to **17** with migration 017.
- Member personal-task WS must be membership-filtered; tests that call `SyncHub.add` need the new `membershipId` argument.
- Playwright `check()` on controlled async checkboxes races the save round-trip; prefer `click()` + assert resulting label text.
- Display enrollment helpers must not call `ensureManagerSession` on the owner’s `page.request` (it replaces Avery’s cookies with Morgan).
- Asserting task visibility via `getByText(/Household/)` matches the Visibility `<option>` label; prefer `.meta` text for Private/Household assertions.
- Holding personal-task list GETs while a status body is parked is needed so a sync refresh cannot mask the delayed status-body race under test.

## Known limitations

- Physical wall density/readability with promoted content remains Product evidence.
- Offline displays retain only the D-045 stale/blanking bound; no stronger remote-erasure claim while disconnected.
- D-048/D-049 status lines still say “Active for planned …; not implemented at …6510fb4” — Architecture should mark them implemented on acceptance.

## Suggested follow-up

- Architecture technical re-review / acceptance of this FIX REQUIRED correction against the same r1.
- Product / Project Lead physical evaluation of the changed C-3B wall.
- Coordinator: commit on `brief/p0-007c-3b-personal-work-wall-promotion` using the suggested message below (user manages Git).

## Suggested commit message

```
fix(P0-007C-3B): prevent stale status from restoring task sharing

Merge only status/completion fields from delayed Today status responses so a
held body cannot undo Household→Private, and cover with a held-response e2e.
```
