# Build Report - BRIEF P0-006A r2

**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED  
**Branch:** `brief/p0-006a-calm-household-experience-foundation`  
**Base:** integrated `main` @ `31aad37` (P0-005 r3); planning/readiness accept at `67346d3`  
**Implementation commits:** **uncommitted** (Project Lead manages Git; do not deploy)  
**Pull request:** N/A  

## Readiness

**READY** against r2; Architecture **ACCEPT / PROCEED**. No blockers. Ordinary risks (dirty History loops, Personalize anchors, touch evidence) handled within the contract. Evidence-gap closure did not change the contract — no new readiness review.

## What changed

### Shell / navigation (D-027)
- Path History API destinations in `src/client/nav.ts`: `/today`, `/plan`, `/plan/routines/:definitionId`, `/household`, `/household/people`, `/household/people/:membershipId`, `/household/groups/:groupId`.
- `App.tsx` owns session/outbox/sync above destinations; Plan nav label (gated by `routine.shared.manage`); quiet chrome (no healthy Online pill); Account menu holds identity/date/timezone/Local development; signed-out intended-path resume; generic unavailable view.
- Fastify SPA fallback serves `index.html` whenever `clientDist` exists (`src/server/app.ts`).

### Routines UX
- Read-only detail: **Edit** primary; Schedule / End / Delete under **More**.
- Compact steps with Show all when >5; focused Name/When/Who/Steps drafts with Done/Cancel section semantics; P0-005 schedule/collision/rollover/delete/end preserved.
- Fixed post-create race: unstable `route` object identity no longer resets detail back to list before URL catches up; dirty ref cleared synchronously before navigate.

### Reorder / feedback
- `OrderedList.tsx`: pointer/touch drag handle, Escape cancel, Move up/down menu, live region.
- Personalize additions use OrderedList (shared steps not draggable).
- `Toast.tsx`: ~5s success acknowledgments; errors/pending/enrollment remain durable.

### Layout at large text (AT6 evidence fix)
- Constrained `.inline-form` / `.grow` / personal-task inputs with `min-width: 0` and `max-width: 100%` so 200% root font-size does not force horizontal document overflow on Today.

### Tests / docs
- E2E adapted to Plan / focused editor / More / toast / Account; `tests/e2e/z-p0-006a-calm-experience.spec.ts`; helper `tests/helpers/e2e-shell.ts`.
- Evidence-gap specs: `z-p0-006a-vite-deeplink.spec.ts` (`playwright.vite.config.ts` + `tests/e2e/start-api-only.ts`), `z-p0-006a-touch-reorder.spec.ts` (CDP `Input.dispatchTouchEvent` via `tests/helpers/touch-drag.ts`), `z-p0-006a-geometry.spec.ts` (360×800, 768×1024, 200% text).
- Playwright `chromium-desktop` (1280×800) scoped to calm + geometry; Vite-only deep-link ignored by production SPA config (`testIgnore`).
- `npm run test:e2e:vite` wired into `test:e2e` / `test:e2e:chromium`; Vite proxy accepts `VITE_API_PROXY_TARGET`.
- PB-31–33 in `docs/protected-behaviors.md`; ARCHITECTURE factual Plan URL / SPA / Vite e2e notes.
- Screenshots only under `reports/p0-006a-r2-screenshots/` (prior `p0-005-r3-screenshots` **unchanged**).

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate` (via PR/RC) | **PASS** — lint + typecheck + Vitest **102** tests / **22** files |
| `npm run validate:pr` | **PASS** — Chromium phone + desktop-scoped e2e **26/26** + Vite deep-link **1/1** (logged `reports/p0-006a-r2-validate-pr.log`) |
| `npm run validate:rc` | **PASS** — Chromium + desktop-scoped + WebKit e2e **48 passed / 2 skipped** (WebKit skips CDP-touch + geometry matrix by design) + Vite deep-link **1/1** (logged `reports/p0-006a-r2-validate-rc.log`) |
| Prior `reports/p0-005-r3-screenshots/` | **PASS** — zero working-tree diff |
| Vite deep-link smoke (dev server) | **PASS** — `npm run test:e2e:vite` / `playwright.vite.config.ts` on ports **8792** (API) + **5174** (Vite); reload of `/plan/routines/:id` restores detail without 404 |
| Full touch drag + edge autoscroll | **PASS** — Chromium CDP touch: persist reorder → Save → reload; Escape cancel restores prior order; edge autoscroll while dragging (`z-p0-006a-touch-reorder.spec.ts`); distinct from mouse/pointer/keyboard Move coverage |
| 200% text / 360×800 / 768×1024 geometry | **PASS** — no horizontal document overflow; primary Edit/More reachable; detail/editor/Today usable on Chromium phone + desktop entry (`z-p0-006a-geometry.spec.ts`) |
| Hosted / physical phone / full SR certification | **NOT RUN** — out of scope for this Engineering pass |
| Local validate logs | `reports/p0-006a-r2-validate-pr.log` / `...-rc.log` (typically gitignored `*.log`) |

## Acceptance mapping (AT → evidence)

| AT | Evidence |
| --- | --- |
| 1 Shell/access | e2e Plan/Household/Today; calm-experience Plan→Routines; grants retained in morning-routine / people-groups |
| 2 Quiet status | morning-routine reconnect (Reconnecting then quiet); no healthy Online assertion |
| 3 Addressable views | calm-experience URL reload of `/plan/routines/:id` (built SPA); **Vite-dev** deep-link reload via `z-p0-006a-vite-deeplink.spec.ts`; SPA fallback in app.ts |
| 4 Density | screenshots detail + geometry; compact step list in UI |
| 5 Focused draft | fillFocusedRoutineCreate + section Done/Cancel paths in lifecycle/multiple/AT6/calm |
| 6 Shared step order | OrderedList; keyboard Move in calm-experience; **CDP touch** persist/cancel/autoscroll in touch-reorder; save persists |
| 7 Non-drag/personal | Move menu; Personalize OrderedList additions-only |
| 8 Dirty recovery | calm-experience Keep/Discard on primary nav; section Cancel preserved |
| 9 Feedback | toast after save/schedule/delete; enrollment remains inline (people-groups) |
| 10 Lifecycle | `z-routine-lifecycle.spec.ts`, `z-routine-schedule-at6.spec.ts` |
| 11 A11y/journey | Chromium+WebKit; desktop project for 006A; **360×800 / 768×1024 / 200% text** geometry; touch geometry people-groups |
| 12 Regression/artifacts | validate:pr/rc; prior screenshots untouched; this report |

## UI evidence

- `reports/p0-006a-r2-screenshots/chromium-detail.png` (phone / Pixel 7 project)
- `reports/p0-006a-r2-screenshots/chromium-desktop-detail.png` (1280×800)
- `reports/p0-006a-r2-screenshots/chromium-geometry-360x800.png`
- `reports/p0-006a-r2-screenshots/chromium-geometry-768x1024.png`
- `reports/p0-006a-r2-screenshots/chromium-text-200.png`
- `reports/p0-006a-r2-screenshots/chromium-touch-reorder.png`

## Dependency choices

- No new npm packages. Hand-rolled Pointer Events reorder (`OrderedList.tsx`); Chromium CDP touch helpers for e2e only.
- No schema/API/migration changes.

## Suggested commit message (do not commit)

```
feat(P0-006A): calm Plan shell, focused routine editing, and draft reorder

Add History API destinations, quiet chrome/toast, More-menu lifecycle actions,
and accessible step reordering while preserving P0-005 schedule authority.
```

## Coordinator / Project Lead next steps

1. Review this Build Report and UI screenshots (including geometry/touch/Vite evidence).
2. Commit on `brief/p0-006a-calm-household-experience-foundation` when authorized (implementation currently uncommitted).
3. Architecture technical acceptance remains separate from Product acceptance.
4. Do not deploy from this Engineering pass.
