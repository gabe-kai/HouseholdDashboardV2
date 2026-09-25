# Build Report - BRIEF P0-007C-2 r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (FIX REQUIRED corrections closed)  
**Branch:** `brief/p0-007c-2-household-display-read-only-dashboard`  
**Commits:**
- `a2b9e422efaf824b1414f74086885bba0a689486` — feat(P0-007C-2): household display principal and read-only wall  
- Correction commit: **N/A** (uncommitted at report time; includes screenshot restore + AT evidence below)  
**Pull request:** N/A  

## What changed (FIX REQUIRED correction)

1. **P0-007B screenshot archive** restored byte-for-byte from `ef39a89` (blob `f9ce02bd…` matches baseline). 007B e2e writers now target `reports/_local-screenshots/p0-007b-r1/` so validation leaves the tracked archive unchanged (verified after `validate:pr`/`validate:rc`).
2. **AT15:** `main.tsx` probes `GET /api/v1/display/session` before mount; active display session always mounts `DisplayApp` (path-traps to `/display`). Built + Vite e2e prove `/today` and `/plan` do not mount member App or succeed on member `/api/v1/today` / `/api/v1/auth/session`.
3. **AT4:** Method-aware denial matrix over every inventory member route with display-only cookie (before side effects), every display HTTP route with member-only cookie, plus display WS accept/deny and mutation no-row proofs.
4. **AT1–14:** Dedicated integration/e2e evidence for activity-clear preservation; cancel/replace enrollment UI; claim edge cases + rate limit; privacy recursion; six-person current-day parity; geometry/zoom/focus; multi-context live/recovery/revoke/stale; cookie reopen + idle/absolute expiry; midnight/DST fake timers.
5. Wall person list uses multi-column layout at large viewports so six primary cards fit the 4K resting overview.

C-3 remains out of scope. AT17 remains Product.

## Files changed (correction)

- `reports/p0-007b-r1-screenshots/*` — restored from `ef39a89`
- `tests/e2e/z-p0-007b-*.spec.ts` — local screenshot dir
- `src/client/main.tsx` — auth-aware display bootstrap
- `src/client/DisplayApp.tsx` — stale/force-stale test hooks
- `src/client/styles.css` — 4K multi-column person grid
- `src/server/app.ts` — optional `claimRateLimit` for AT3
- `tests/helpers/auth-fixture.ts`
- `tests/integration/p0-007c-2-denial-matrix.test.ts` — AT4
- `tests/integration/p0-007c-2-evidence.test.ts` — AT1/3/5/6/13/14
- `tests/e2e/z-p0-007c-2-isolation.spec.ts` — AT15
- `tests/e2e/z-p0-007c-2-vite-deeplink.spec.ts` — AT15 Vite
- `tests/e2e/z-p0-007c-2-enrollment.spec.ts` — AT2 cancel/replace
- `tests/e2e/z-p0-007c-2-geometry.spec.ts` — AT8
- `tests/e2e/z-p0-007c-2-live.spec.ts` — AT9–12
- `reports/P0-007C-2-r1-build-report.md`, `PROJECT_STATE.md`

## Verification performed

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` | PASS | **233** tests |
| `npm run lint` / `typecheck` | PASS | via validate |
| `npm run validate:pr` | PASS | exit 0 (lint/typecheck/unit/build/Chromium e2e + Vite) |
| `npm run validate:rc` | PASS | exit 0 (includes WebKit) |
| 007B archive vs `ef39a89` after validation | MATCH | staged + working tree blob == baseline |
| AT17 physical wall | NOT RUN | Project Lead / Product |

## Acceptance mapping (AT1–17)

| AT | Evidence | Result |
| --- | --- | --- |
| 1 Populated upgrade + activity-clear preservation | `tests/integration/p0-007c-2-display.test.ts` through-014→015; `tests/integration/p0-007c-2-evidence.test.ts` “preserves display row, session, and outstanding claim across activity clear” | PASS |
| 2 Manager-to-wall journey | `tests/e2e/z-p0-007c-2-enrollment.spec.ts` AT2 + cancel + replace UI; Chromium + WebKit (in validate:rc) | PASS |
| 3 Claim/command correctness | `tests/integration/p0-007c-2-evidence.test.ts` AT3 expired/malformed/used/cancelled/replaced/demoted issuer/Origin/replay; `claimRateLimit: { max: 5 }` throttle | PASS |
| 4 Principal denial matrix | `tests/integration/p0-007c-2-denial-matrix.test.ts` full member-route matrix + display HTTP denial + WS + mutation no-row | PASS |
| 5 Response/privacy allowlists | `tests/integration/p0-007c-2-evidence.test.ts` AT5 recursive walk + private task does not emit disclosive `tasks` invalidate | PASS |
| 6 Shared current-day truth | `tests/integration/p0-007c-2-evidence.test.ts` AT6 Kitchen/Cats/Bathroom/Trash + routine; IDs/owners match manager today | PASS |
| 7 Inspect the wall | `tests/e2e/z-p0-007c-2-inspect.spec.ts` Chromium + WebKit | PASS |
| 8 4K / phone geometry | `tests/e2e/z-p0-007c-2-geometry.spec.ts` 3840/1920/360; six-card viewport fit; ≥48 touch; 200% zoom; keyboard focus | PASS |
| 9 Live convergence | `tests/e2e/z-p0-007c-2-live.spec.ts` AT9 member step → wall without reload | PASS |
| 10 Missed/delayed updates | `tests/e2e/z-p0-007c-2-live.spec.ts` AT10 held older response loses; poll after socket close | PASS |
| 11 Revocation races | `tests/e2e/z-p0-007c-2-live.spec.ts` AT11 two displays; revoke one; delayed response cannot restore | PASS |
| 12 Disconnected exposure | `tests/e2e/z-p0-007c-2-live.spec.ts` AT12 stale bound + late held response rejected | PASS |
| 13 Persistence / expiry | `tests/integration/p0-007c-2-evidence.test.ts` AT13 reopen same DB+cookie; idle; absolute; cookie maxAge | PASS |
| 14 Date/time boundaries | `tests/integration/p0-007c-2-evidence.test.ts` AT14 fake timers midnight + America/New_York spring/fall | PASS |
| 15 Bootstrap / nav isolation | `src/client/main.tsx`; `tests/e2e/z-p0-007c-2-isolation.spec.ts`; Vite AT15 in `z-p0-007c-2-vite-deeplink.spec.ts` | PASS |
| 16 Regression / CI | Job `e2e-phone-007c2` retained; local `validate:pr` + `validate:rc` exit 0 | PASS |
| 17 Product at-distance | — | NOT RUN (Project Lead) |

## Deviations from brief revision

- AT12 automation uses `__HD_DISPLAY_STALE_MS` and `__HD_DISPLAY_FORCE_STALE__` to deterministically exercise the disconnected stale path.
- No intentional product-contract deviations. Prior partial AT markings are closed by the named tests above.

## Discoveries for Architecture

- Display idle expiry is wall-clock against `last_seen_at`; DST/midnight fake-timer jumps that span >90 days must refresh `last_seen_at` in tests.
- Optional `buildApp({ claimRateLimit })` proves the 5/min display-claim limit under `APP_PROFILE=test`.

## Known limitations

- AT17 physical readability remains Product/Project Lead evidence.
- Correction commit SHA pending authorized commit.
- Backup restore can revive revoked display sessions (existing operational limitation).

## Suggested follow-up

- Project Lead: commit correction (message below), push, confirm Actions thematic **E2E · Phone P0-007C-2**.
- Architecture re-acceptance of this Build Report vs brief r1 FIX REQUIRED findings.
- Product AT17 when hardware is available.

## Suggested commit message

```
fix(P0-007C-2): close FIX REQUIRED evidence and display bootstrap

Restore the P0-007B screenshot archive, auth-aware display mount,
method-aware denial matrix, and AT1–15 multi-context/expiry evidence.
```
