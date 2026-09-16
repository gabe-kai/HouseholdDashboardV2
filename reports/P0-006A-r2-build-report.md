# Build Report - BRIEF P0-006A r2

**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED  
**Branch:** `brief/p0-006a-calm-household-experience-foundation`  
**Base:** integrated `main` @ `31aad37` (P0-005 r3); planning/readiness accept at `67346d3`  
**Implementation commits:** **uncommitted** (Project Lead manages Git; do not deploy)  
**Pull request:** N/A  

## Readiness

**READY** against r2; Architecture **ACCEPT / PROCEED**. No blockers. Ordinary risks (dirty History loops, Personalize anchors, touch evidence) handled within the contract.

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

### Tests / docs
- E2E adapted to Plan / focused editor / More / toast / Account; `tests/e2e/z-p0-006a-calm-experience.spec.ts`; helper `tests/helpers/e2e-shell.ts`.
- Playwright `chromium-desktop` (1280×800) scoped to `z-p0-006a*.spec.ts`.
- PB-31–33 in `docs/protected-behaviors.md`; ARCHITECTURE factual Plan URL / SPA notes.
- Screenshots only under `reports/p0-006a-r2-screenshots/` (prior `p0-005-r3-screenshots` **unchanged**).

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate` (via PR/RC) | **PASS** — lint + typecheck + Vitest **102** tests / **22** files |
| `npm run validate:pr` | **PASS** — Chromium phone + desktop-scoped e2e **23/23** |
| `npm run validate:rc` | **PASS** — Chromium + desktop-scoped + WebKit e2e **45/45** |
| Prior `reports/p0-005-r3-screenshots/` | **PASS** — zero working-tree diff |
| Hosted / physical phone / full SR certification | **NOT RUN** — not required for implementation |
| Vite deep-link smoke (dev server) | **NOT RUN** — built SPA deep links covered by e2e reload on `/plan/routines/:id` |
| Full pointer drag + edge autoscroll matrix | **PARTIAL** — keyboard Move covered in e2e; touch tap attempted when `hasTouch`; full touch-drag persistence **NOT RUN** as a dedicated assertion |
| 200% text / 360×800 / 768×1024 geometry sweep | **NOT RUN** — phone 390×844 + desktop 1280×800 covered |
| Local validate logs | `reports/p0-006a-r2-validate-pr.log` / `...-rc.log` (typically gitignored `*.log`) |

## Acceptance mapping (AT → evidence)

| AT | Evidence |
| --- | --- |
| 1 Shell/access | e2e Plan/Household/Today; calm-experience Plan→Routines; grants retained in morning-routine / people-groups |
| 2 Quiet status | morning-routine reconnect (Reconnecting then quiet); no healthy Online assertion |
| 3 Addressable views | calm-experience URL reload of `/plan/routines/:id`; SPA fallback in app.ts |
| 4 Density | screenshots `chromium-detail.png`, `chromium-desktop-detail.png`; compact step list in UI |
| 5 Focused draft | fillFocusedRoutineCreate + section Done/Cancel paths in lifecycle/multiple/AT6/calm |
| 6 Shared step order | OrderedList; keyboard Move in calm-experience; save persists |
| 7 Non-drag/personal | Move menu; Personalize OrderedList additions-only |
| 8 Dirty recovery | calm-experience Keep/Discard on primary nav; section Cancel preserved |
| 9 Feedback | toast after save/schedule/delete; enrollment remains inline (people-groups) |
| 10 Lifecycle | `z-routine-lifecycle.spec.ts`, `z-routine-schedule-at6.spec.ts` |
| 11 A11y/journey | Chromium+WebKit; desktop project for 006A; touch geometry people-groups |
| 12 Regression/artifacts | validate:pr/rc; prior screenshots untouched; this report |

## UI evidence

- `reports/p0-006a-r2-screenshots/chromium-detail.png` (phone / Pixel 7 project)
- `reports/p0-006a-r2-screenshots/chromium-desktop-detail.png` (1280×800)

## Dependency choices

- No new npm packages. Hand-rolled Pointer Events reorder (`OrderedList.tsx`).
- No schema/API/migration changes.

## Suggested commit message (do not commit)

```
feat(P0-006A): calm Plan shell, focused routine editing, and draft reorder

Add History API destinations, quiet chrome/toast, More-menu lifecycle actions,
and accessible step reordering while preserving P0-005 schedule authority.
```

## Coordinator / Project Lead next steps

1. Review this Build Report and UI screenshots.
2. Commit on `brief/p0-006a-calm-household-experience-foundation` when authorized (implementation currently uncommitted).
3. Architecture technical acceptance remains separate from Product acceptance.
4. Do not deploy from this Engineering pass.
