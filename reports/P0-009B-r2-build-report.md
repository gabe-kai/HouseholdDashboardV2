# Build Report - BRIEF P0-009B r2 (actionable family wall)

**Acting as:** Engineering  
**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED — awaiting Architecture technical acceptance  
**Branch:** `wall-refinements`  
**Baseline:** `main` at `14af09e` (PR #30, P0-009A r2)  
**Planning commits:** `79fbb57` (r2 brief); `db37869` (assignment/PROCEED)  
**Implementation commit:** none (uncommitted working-tree delta; Project Lead owns Git)  
**Tested source state at this handoff:** `db37869` plus uncommitted P0-009B r2 implementation  
**Pull request:** not opened  
**Authorization:** Architecture ACCEPT / PROCEED for r2 (2026-10-28). No hosted deployment, Railway mutation, merge, or production-wall replacement.

Readiness: `reports/P0-009B-r2-engineering-readiness.md` (READY).  
Superseded r1 assignment record: `reports/P0-009B-r1-engineering-readiness.md` (preserved).

## What changed

Production By person board is now the enrolled wall. Each non-departed person has an independent pane over today's assigned work. Preview uses the same presentation without execution.

1. **Automatic day reads.** `GET /api/v1/display/people/:membershipId/day` (display) and `GET /api/v1/displays/:displayId/preview/people/:membershipId/day` (member + `household.display.manage`). Today-only; `?date=` is 400. DTOs allowlist identity, occurrences/steps, progress, date/generation/epoch. Private and unpromoted personal-task values stay off automatic payloads. Existing person-detail remains the deliberate shared-personal-work read.
2. **Shared board.** `src/client/family-board.tsx` is the wall/preview presenter. `projectFamilyPane` reuses `projectPersonalDay` ordering. One `DisplayApp` session/sync/outbox owner stays above panes. Preview mounts the board in `preview-frame`, not DisplayApp.
3. **Per-pane freshness.** Request-start leases, failed-pane `paneFailedAtRef` (retry does not renew), stale timer reads `panePhaseRef.current`. Date or activity-generation change resets pane snapshots and bumps `paneEpochRef` so held old bodies cannot paint. Global auth loss still clears everything.
4. **Activity clear vs installation reset.** `activity_reset` now invalidates displays as `work`, not `reset`. Generation bump refreshes assigned work; epoch replacement still uses hub `closeAll`.
5. **Geometry.** Family-board shell is viewport-locked (`100dvh`, overflow hidden). Org toggle is not stretched to 100% height. Six identities fit at 3840×2160 and 1920×1080 without page scroll; extra people scroll inside the grid. Pane pending/error cues sit in the header so they stay discoverable.
6. **Evidence / CI.** Unit, integration, Chromium B/R/P, named WebKit subset, Vite preview smoke, phone-core ignore, isolated `test:e2e:family-wall` (`chromium-009b` / `chromium-009b-display` / `webkit-009b`), Actions job `E2E · Family wall P0-009B`.

## Readiness cautions addressed

| Caution | Implementation |
| --- | --- |
| `/day` vs person-detail privacy split | New routes; enlargement does not fetch person-detail; AT13a/AT13b |
| Failed-pane 60s lease | `paneFailedAtRef` / `paneSuccessStartedRef`; AT11b/AT11c |
| Stale timer closed over React state | Timer reads `panePhaseRef.current` |
| Preview must not execute or renew contact | Shared board + stripped DTO; AT19b `last_seen_at` unchanged |
| Held lifecycle reads | `releaseSharedNow` + `x-read-delay-ms`; AT17c / AT14c |
| Phone-core must not run wall geometry | `chromium`/`webkit` `testIgnore **/z-p0-009b-*`; phone-core `--grep-invert P0-009B` |
| Touch is CDP, not phone-mouse | `touchDragByCdp(page, from, to)` on Chromium only |

## Files changed

- `src/server/display.ts`, `src/server/app.ts`, `src/server/route-policy.ts` — person-day getters/routes, preview counterpart, activity_reset → display `work`
- `src/domain/family-wall-projection.ts` (+ test), `src/domain/today-projection.ts` — pane projection; optional step `id`
- `src/client/family-board.tsx`, `src/client/DisplayApp.tsx`, `src/client/DisplayPreviewHost.tsx`, `src/client/preview-frame.tsx`, `src/client/display-api.ts`, `src/client/display-presentation.tsx`, `src/client/display-preview.ts`, `src/client/api.ts`, `src/client/styles.css`
- `tests/integration/p0-009b-family-wall.test.ts`, `tests/helpers/p0-009b.ts`
- `tests/e2e/z-p0-009b-family-wall.spec.ts`, `z-p0-009b-recovery.spec.ts`, `z-p0-009b-preview.spec.ts`, `z-p0-009b-vite-deeplink.spec.ts`
- `playwright.config.ts`, `playwright.vite.config.ts`, `package.json`, `.github/workflows/validate-pr.yml`
- `docs/protected-behaviors.md` PB-66 + sync matrix rows
- `ARCHITECTURE.md`, `PROJECT_STATE.md`, `ROADMAP.md`, this report, brief readiness/status
- Geometry captures (gitignored): `reports/_local-screenshots/p0-009b-r2/`

Unchanged on purpose: enrollment/CSRF/outbox owners, person-detail route, By work, proof rebuild, School/Meals/Calendar, migrations, new runtime deps.

## Behavior delivered

- Enrolled `/display` opens By person with independent panes, one-tap Done/reopen/Not needed, local pending/error, 90s pane idle, deliberate enlarge, Needs an owner (read-only).
- Selected-display preview shows the same board read-only at the fitted target viewport.
- Six-person crowded board fits 3840×2160 and 1920×1080 CSS px without page scrolling (3×2 kept).
- Production `dist/client` contains `index.html` + `preview-frame.html` only (no `family-board-proof.html`).

## Verification performed

| Check | Result | Notes |
| --- | --- | --- |
| `npx vitest run src/domain/family-wall-projection.test.ts tests/integration/p0-009b-family-wall.test.ts` | **PASS** | 16 tests |
| Chromium-preview 009B B/R/P | **PASS** | 14 passed, 1 skipped (AT16a native viewport) |
| Chromium-desktop family-wall | **PASS** | 5 passed, 1 skipped (AT16a) |
| Chromium-display AT16a | **PASS** | 3840 and 1920 in one test; ignored screenshots written |
| WebKit-preview 009B | **PASS** | 11 passed, 4 skipped: AT16a + Chromium-only held races AT6a, AT6b/AT7b, AT14a |
| Vite `z-p0-009b-vite-deeplink.spec.ts` | **PASS** | preview host reload |
| Production dist proof absent | **PASS** | `dist/client` has no `family-board-proof.html` |
| `npm run validate:pr` | **PASS** exit 0 | Vitest 53 files / 391 passed; Playwright Chromium 167 passed, 1 skipped (009B AT16a on `chromium-009b` 1280; native 3840 run on `chromium-009b-display`); Vite 12 passed. Logs: `reports/_local-screenshots/validate-pr.log` |
| `npm run validate:rc` | **PASS** exit 0 | Same vitest; Playwright 258 passed, 46 skipped (named WebKit held-write/held-read races, AT16a on non-3840 projects, phone WebKit geometry, 008a subset). Vite 12 passed. Logs: `reports/_local-screenshots/validate-rc.log` |

Browser split is intentional: Chromium establishes all new B/R/P rows; WebKit establishes AT1a, AT4b, AT5a/b, AT9a, AT11a, AT15c, AT19a/b through composed journeys.

## Acceptance evidence matrix

| ID | Exact evidence | Result |
| --- | --- | --- |
| AT1a Default | B `AT1a/AT2a/AT4b/AT5a` Chromium + WebKit | **PASS** |
| AT1b Organizations | Same test switches By work then By person; Jordan upcoming restored | **PASS** |
| AT2a Identity/order | I `AT2a/AT13a/AT17b` + B AT1a names in saved order including pending sign-in | **PASS** |
| AT2b Larger roster | B `AT2b/AT3b/AT4a/AT5b/AT12` Quinn overflow | **PASS** |
| AT3a Recommendation | U `projectFamilyPane` AT3a + B AT1a Brush teeth after Get dressed | **PASS** |
| AT3b State truth | U AT3b + B empty Riley / upcoming labels | **PASS** |
| AT3c Optional/As needed | U AT3c + B AT5b As needed Not needed | **PASS** |
| AT4a Full timeline | B upcoming/more/earlier/back-to-next | **PASS** |
| AT4b Sibling isolation | B Jordan upcoming unchanged while Avery Done | **PASS** |
| AT5a Done/reopen | I AT5a existing status command + B AT1a | **PASS** |
| AT5b Not needed | I AT5b + B Jordan Not needed | **PASS** |
| AT6a Held final success | R AT6a Chromium (WebKit skipped as held-write race) | **PASS** |
| AT6b Rejection discoverability | R AT6b/AT7b Chromium; header error cue (WebKit skipped) | **PASS** |
| AT7a Two panes/replay | I AT5b/AT7a/AT8b replay | **PASS** |
| AT7b Newer intent | R AT6b/AT7b Done then reopen; old response cannot restore Done | **PASS** |
| AT8a Offline/reload | R AT8a/AT9a/AT9b | **PASS** |
| AT8b Changed structure | I stale structure 409 | **PASS** |
| AT9a Ordinary live change | R AT8a/AT9a/AT9b Chromium + WebKit | **PASS** |
| AT9b Missed sync | Same test socket close/reconnect | **PASS** |
| AT10a Out-of-order pane | R AT10a/AT10b/AT11b/AT11c | **PASS** |
| AT10b Lost selection | Same; held person-detail cannot replace Jordan | **PASS** |
| AT11a Partial failure | B AT11a Chromium + WebKit | **PASS** |
| AT11b Independent stale lease | R AT10a/… Avery blanks; Jordan stays ready | **PASS** |
| AT11c Late stale reply | Same; late 200 after NOW_MS stays blank | **PASS** |
| AT12 Unassigned | I + B Needs an owner, no checkbox/Claim | **PASS** |
| AT13a Automatic privacy | I AT2a/AT13a/AT17b + P AT13a/AT19a | **PASS** |
| AT13b Deliberate detail | B AT13b enlarge does not fetch person-detail; explicit personal does | **PASS** |
| AT13c Withdrawal | I + R AT13c/AT14d | **PASS** |
| AT14a Day boundary | I prior-day householdDate 400; R AT14a Chromium (WebKit skipped) | **PASS** |
| AT14b Activity generation | I rematerialize + stale gen 400; R AT14b Chromium + WebKit | **PASS** |
| AT14c Installation replacement | I AT17c reset + AT14c restore held `/day` | **PASS** |
| AT14d Authority loss | I revoke 401 + R AT13c/AT14d board clears | **PASS** |
| AT14e Departure | I departed `/day` 404 | **PASS** |
| AT15a Local idle | B AT13b/AT15a/AT15b Avery returns; Jordan stays | **PASS** |
| AT15b Movement guards | Same; pending defers idle | **PASS** |
| AT15c Enlarge/return | B AT15c/AT16b Chromium + WebKit | **PASS** |
| AT16a Crowded target | B AT16a chromium-display 3840 then 1920; ignored paired captures | **PASS** |
| AT16b Input/a11y | B AT15c/AT16b CDP touch Chromium; keyboard; ≥48px hits; reduced motion | **PASS** |
| AT17a New route authority | I AT17a 401/403/404/400 table | **PASS** |
| AT17b Projection/side effects | I AT2a/AT13a/AT17b twice-read, no writes | **PASS** |
| AT17c Replacement barrier | I held `/day` + reset | **PASS** |
| AT18a Selection | `package.json` `test:e2e:family-wall` (`chromium-009b` + `chromium-009b-display`); isolated 009B e2e DBs; phone-core grep-invert `P0-009B`; Vite `z-p0-009b-vite-deeplink.spec.ts` on `vite-phone`; Actions `e2e-family-wall-009b` | **PASS** |
| AT18b Final gates | Exact `validate:pr` / `validate:rc` | **PASS** |
| AT18c Shipped boundary | dist has no proof HTML; built preview in P; Vite AT18c reload | **PASS** |
| AT19a Preview parity | P AT19a/AT19b/AT19c Chromium + WebKit | **PASS** |
| AT19b Preview authority isolation | I last_seen unchanged + P no execution | **PASS** |
| AT19c Preview does not steer wall | P wall pending independent of preview navigation | **PASS** |

## Deviations from brief revision

- AT14a Playwright date-mutate uses a synthetic next-day dashboard plus a held person-day body (same seam as P0-007C-3A). There is no global clock freeze. Integration still fences prior-day `householdDate` on the existing status command.
- WebKit skips AT6a, AT6b/AT7b, and AT14a (held-write/held-read races) and AT16a (native 3840/1920). Required WebKit composed journeys passed.
- Local preview/desktop projects are 1280 by default; family-wall `beforeEach` uses 1920×1080 except AT16a, which keeps the native project viewport. Pane clicks use DOM `evaluate` (and CDP touch on Chromium) because Playwright `.click()` misses stacked headers at crowded density. This does not change the 3840/1920 product targets.
- `activity_reset` display invalidation is `work` rather than `reset` so activity clear cannot be mistaken for installation replacement.
- Automatic `/day` loads are serialized at concurrency 2 and skipped while By work or person-detail is the visible surface (`while visible` in the freshness contract). Extra people overflow inside the 3×2 grid (`minmax(50%, 1fr)` rows) instead of crushing the first six panes.
- Family-wall Playwright projects use isolated `runtime/e2e-chromium-009b.sqlite` / `e2e-webkit-009b.sqlite` (ports 8794/8795), matching the 008a pattern, because automatic `/day` for every leftover membership serialized the shared Chromium DB.

## Discoveries for Architecture

- D-061 implications still say P0-009B r2 is awaiting readiness / not implemented. Engineering implemented r2; Architecture should update that sentence on acceptance.
- Mapping household `activity_reset` to display invalidate reason `reset` sent the wall through installation-reset recovery. Generation clear is not an epoch replacement.

## Known limitations

- 3×2 and 90s idle remain provisional pending the Product before-school checkpoint.
- Physical multi-touch and 10/16-foot readability are not claimed.
- Leftover work on the shared Chromium/WebKit e2e DBs can still crowd inherited C-2/C-3/009A journeys; 009B itself runs on isolated DBs. Tests stamp unique titles.
- Engineering did not commit, open a PR, deploy, or touch live data.

## Suggested follow-up

Optional. Not approved scope.

- Architecture technical review / acceptance.
- Project Lead commit using the suggested message below.
- Product before-school checkpoint after an authorized deploy.
- Update D-061 implications to “implemented, awaiting Architecture acceptance.”

## Suggested commit message

```
feat(P0-009B): add actionable per-person family wall and day reads

Deliver independent By-person panes on automatic /day snapshots, keep
deliberate person-detail private, and share the read-only preview board.
```
