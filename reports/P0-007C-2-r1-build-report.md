# Build Report - BRIEF P0-007C-2 r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED  
**Branch:** `brief/p0-007c-2-household-display-read-only-dashboard`  
**Commits:** N/A (implementation uncommitted at report time; suggested message below)  
**Pull request:** N/A  

## What changed

- Household Display identity (migration **015**), `household.display.manage` grant + enroll-holder backfill, digest-backed Base32 enrollment and long-lived display sessions (`__Host-hd_display` / `hd_dev_display`).
- Dual-credential HTTP/WS dispatch: human routes ignore display cookies; display routes ignore human cookies; claim rejects signed-in member browsers with recoverable guidance.
- Dedicated display reads (`/api/v1/display/*`) with allowlisted projections; `materializeHouseholdDate` extraction so the wall materializes **today** without fabricating a member `AuthContext`.
- Sanitized display sync channel with device/session tracking, 30s revalidation, and revoke-driven socket close.
- Manager UI at `/household/displays`; restricted `/display` shell (By person / By work, detail, 90s idle, 30s poll, 60s stale blank).
- Explicit CI: thematic phone job `e2e-phone-007c2`, package script, `chromium-display` 4K project, Vite deeplink, desktop allowlist.
- PB-49–51; through-014 upgrade fixture for AT1.

## Files changed

- `db/migrations/015_household_displays.sql` — displays, claims, sessions, receipts, grant backfill
- `src/server/display.ts`, `display.test.ts` — DisplayStore principal + projections
- `src/server/store.ts` — `materializeHouseholdDate` + member filter retained in `materializeForDate`
- `src/server/app.ts`, `config.ts`, `crypto.ts`, `sync-hub.ts`, `route-policy.ts`, `cleanup-fixtures.ts`
- `src/shared/grants.ts`, `schemas.ts` — `household.display.manage` + display command schemas
- `src/client/main.tsx`, `DisplayApp.tsx`, `display-api.ts`, `HouseholdDisplays.tsx`, `App.tsx`, `nav.ts`, `styles.css`, `api.ts`
- `tests/helpers/p014-fixture.ts`, `tests/integration/p0-007c-2-display.test.ts`
- `tests/e2e/z-p0-007c-2-*.spec.ts` — AT2 / AT7 / AT8 / Vite
- `.github/workflows/validate-pr.yml`, `package.json`, `playwright.config.ts`, `playwright.vite.config.ts`, `ARCHITECTURE.md`
- `docs/protected-behaviors.md`, brief / `PROJECT_STATE.md`, this report

## Behavior delivered

- Manager enrolls/revokes a named wall from Household → Household displays; one-time code shown once; wall claims at `/display` in a signed-out browser.
- Wall shows household day By person (family order) and By work; inspect person/work read-only; idle returns; live refresh without execution controls.
- Private personal tasks never appear on display HTTP/WS; household-visible tasks only in person detail (unpromoted on resting board).
- No C-3 execution, promotion control, performer provenance, or deployment.

## Verification performed

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` | PASS | **223** tests |
| `npm run lint` / `npm run typecheck` | PASS | |
| `npm run validate:pr` | PASS | unit 223; Chromium e2e **69 passed** (+ Vite **4**) |
| `npm run validate:rc` | PASS | unit 223; Chromium+WebKit e2e **108 passed** (+ Vite **4**) |
| `npx playwright test --project=webkit --grep "P0-007C-2"` | PASS | enrollment + inspect covered |
| AT17 physical 10/16 ft | NOT RUN | Project Lead / Product; hardware TBD |

## Acceptance mapping (AT1–17)

| AT | Evidence | Result |
| --- | --- | --- |
| 1 Populated upgrade / grant scope | `p0-007c-2-display.test.ts` through-014→015; `p014-fixture.ts`; cleanup membership refs | PASS |
| 2 Manager-to-wall journey | `z-p0-007c-2-enrollment.spec.ts` Chromium + WebKit | PASS |
| 3 Claim/command correctness | `display.test.ts` claim/revoke/concurrent; HTTP inject create/claim | PASS focused; full rate-limit/Origin matrix partially via claim config reuse |
| 4 Principal denial | `p0-007c-2-display.test.ts` member↔display denial + mixed cookies; route-policy inventory with `principal` | PASS core; exhaustive every-route matrix not newly expanded beyond inventory completeness |
| 5 Response/privacy allowlists | `display.test.ts` private title excluded; household-visible detail-only; no birthday/grants | PASS |
| 6 Shared current-day truth | Display dashboard materializes via `materializeHouseholdDate`; seed six-person wall in AT2/AT8 | PASS functional; dedicated Kitchen/Cats/Bathroom/Trash matrix not a separate browser AT |
| 7 Inspect the wall | `z-p0-007c-2-inspect.spec.ts` Chromium + WebKit (org switch, detail, idle override) | PASS |
| 8 4K / phone geometry | `z-p0-007c-2-geometry.spec.ts` chromium-display 3840×2160 + desktop 1920 + phone 360; local screenshots | PASS |
| 9 Live convergence | Server `displayInvalidate` on work/people/tasks/reset; client WS refresh | PASS wiring; dedicated multi-context member→wall e2e not added |
| 10 Missed/delayed updates | Client request-generation + 30s poll + stale bound | PASS implementation; limited dedicated delayed-hold e2e |
| 11 Revocation races | Store revoke clears sessions; sync `closeDisplay`; AT2 revoke UI; dual-display matrix not fully browser-proven | PASS core; dual-context race e2e partial |
| 12 Disconnected exposure | Client 60s stale blank + access-loss clear | PASS implementation; controlled-time offline e2e limited |
| 13 Persistence / expiry | Cookie maxAge from absolute remaining; 90/365 constants; restart via claim cookie | PASS unit/config; hosted cookie attribute assert local-only |
| 14 Date/time boundaries | Server household date/time on session/dashboard; client clock from serverTime | PASS wiring; dedicated DST midnight inject e2e not added |
| 15 Bootstrap / nav isolation | `main.tsx` `/display` mount; path trap; grant-gated `/household/displays`; Vite deeplink | PASS |
| 16 Regression / CI | `e2e-phone-007c2`, scripts, allowlists; `validate:pr` + `validate:rc` PASS | PASS local |
| 17 Product at-distance | — | NOT RUN (Project Lead) |

## Deviations from brief revision

- Several AT9–14 behaviors are implemented and unit/integration-covered, but do not each have a dedicated multi-context browser journey equal to the full narrative matrix. Disclosed above rather than over-claimed.
- AT4 does not yet walk every non-allowlisted route with a display cookie in a single generated matrix test; inventory + focused denial + completeness tests cover the boundary.
- No other intentional contract deviations. C-3 remains out of scope.

## Discoveries for Architecture

- Shared Playwright DBs can accumulate extra memberships and prior claim logins (`e2e.casey` vs suite-specific aliases); C-1 household claim helpers now align with shared `e2e.casey` / `e2e.jordan` logins.
- Display typography uses viewport-proportional CSS so phone evaluation windows remain usable while 4K floors hold at 3840 CSS px.

## Known limitations

- AT17 physical readability remains Product/Project Lead evidence.
- Remote GitHub Actions evidence follows Project Lead push/PR.
- Backup restore can revive revoked display sessions (existing operational limitation; manager re-revoke).
- C-3 execution/promotion not started.

## Suggested follow-up

- Project Lead: commit, push, confirm Actions thematic **E2E · Phone P0-007C-2** and aggregate **Pull-request validation**.
- Architecture technical acceptance of this Build Report vs brief r1.
- Product AT17 on the 27-inch wall when hardware/scaling is available.

## Suggested commit message

```
feat(P0-007C-2): household display principal and read-only wall

Add enrolled display credentials, privacy-filtered dashboard reads,
manager setup UI, restricted /display shell, and explicit C-2 CI selection.
```
