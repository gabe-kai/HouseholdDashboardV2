# Build Report - BRIEF P0-009A r2 (selected-display preview and family-wall proof)

**Acting as:** Engineering  
**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED — awaiting Architecture technical acceptance  
**Branch:** `brief/p0-009a-selected-display-preview-and-family-wall-proof`  
**Baseline:** `main` at `1acc4a1`  
**Tested source state at handoff:** `779152b` plus uncommitted working-tree delta on that branch (no Engineering commit)  
**Pull request:** not opened  
**Authorization:** Architecture ACCEPT / PROCEED, same revision. No hosted deployment, Railway mutation, merge, or production wall replacement.

Readiness: `reports/P0-009A-r2-engineering-readiness.md`.

## What changed

Member-authorized, read-only selected-display preview in the built app, plus a Vite/dev-only fictional family-board proof. Production wall layout, idle behavior, credentials, and execution adapters are unchanged.

1. **Preview reads.** Three member GET routes reuse current-day wall projection through a `{ householdId, timezone }` read scope. Authorization is member session + `household.display.manage` + same-household non-revoked display. No `DisplayContext`, display cookie, or `getDisplaySessionByTokenDigest`. Preview DTOs omit `intendedStructure`, step `logicalItemId`, and CSRF/session fields.
2. **Lifecycle.** Preview materializes only today (D-044). `?date=` is 400. Held local/test replies finish the read, `releaseSharedNow()`, delay, then revalidate session/epoch/display so reset/restore are not blocked.
3. **Preview UI.** Wall presentation is extracted and mounted read-only inside `preview-frame.html`. The iframe layout viewport is the labeled target; the host applies uniform `transform: scale`. Chrome (Preview only, geometry, Back) stays outside the frame.
4. **Proof.** `family-board-proof.html` is a Vite `command === "serve"` input only. In-memory crowded / state-check / fictional family-day fixtures; current layout via the shared presenter; 3×2 concept with simulated Done/Reopen/Not needed and a 90s per-pane idle candidate.
5. **Routing cautions.** Built preview/geometry stay off phone-core. Proof runs on explicit `vite-desktop` / `vite-touch`. Phone-core grep-invert includes `P0-009A`.

## Readiness cautions addressed

| Caution | Implementation |
| --- | --- |
| Built preview/geometry off phone-core; proof on explicit Vite desktop/touch | `chromium` / `webkit` `testIgnore **/z-p0-009a-*.spec.ts`; phone-core `--grep-invert "P0-007\|P0-009A"`; geometry on `chromium-desktop` + `chromium-display`; preview on `chromium-preview` + `webkit-preview`; proof only in `playwright.vite.config.ts` `vite-desktop` / `vite-touch` |
| Preview DTOs omit `intendedStructure` and display CSRF/session fields | `stripPreviewOccurrence` drops `intendedStructure` and step `logicalItemId`; AT1a/AT2a assert the JSON has no `csrf` / `intendedStructure` / `sessionId` |
| Held-response + reset/restore must not keep `acquireShared()` across exclusive lifecycle | `deliverPreviewAfterHold` reads first, `releaseSharedNow()`, then delays; AT5e reset returns 200 while the held preview completes 401 |

## Files changed

- `src/server/display.ts` — `DisplayReadScope`, preview getters, DTO strip
- `src/server/app.ts` — three GET routes, `releaseSharedNow`, `deliverPreviewAfterHold`
- `src/server/route-policy.ts` — member GET rows, grant `household.display.manage`
- `src/client/display-presentation.tsx` — extracted wall presentation
- `src/client/DisplayApp.tsx` — uses extracted presentation (behavior unchanged)
- `src/client/display-preview.ts` — viewport parse/presets, fit scale, frame message types
- `src/client/DisplayPreviewHost.tsx` — member host, poll/stale/fences, scaled iframe
- `src/client/preview-frame.html`, `src/client/preview-frame.tsx` — isolated read-only frame
- `src/client/family-board-proof.html`, `src/client/family-board-proof.tsx` — DEV-only proof
- `src/client/nav.ts`, `src/client/App.tsx`, `src/client/HouseholdDisplays.tsx`, `src/client/api.ts`, `src/client/styles.css`
- `vite.config.ts` — production inputs `index.html` + `preview-frame.html`; proof only when `command === "serve"`
- `playwright.config.ts`, `playwright.vite.config.ts`, `package.json`, `.github/workflows/validate-pr.yml`
- `ARCHITECTURE.md` — test-command note for preview/proof
- `tests/integration/p0-009a-display-preview.test.ts`
- `tests/e2e/z-p0-009a-preview.spec.ts`, `z-p0-009a-geometry.spec.ts`, `z-p0-009a-proof-vite.spec.ts`, `z-p0-009a-vite-deeplink.spec.ts`
- `tests/e2e/z-p0-007c-2-enrollment.spec.ts` — Preview display visible on the displays list

## Behavior delivered

- Manager **Preview display** opens `/household/displays/:displayId/preview` with real current-day wall-permitted data, read-only, at an isolated target viewport (default 3840×2160 assumed).
- Deep link restore works signed-in and after sign-in; Back returns to `/household/displays`.
- Production builds do not emit `family-board-proof.html`.
- Local proof: `http://127.0.0.1:5173/family-board-proof.html` during `npm run dev` only.

## Acceptance evidence matrix

| ID / assertion | Exact evidence | Result |
| --- | --- | --- |
| AT1a Authorized claimed/unclaimed preview | `tests/integration/p0-009a-display-preview.test.ts` → `AT1a` | **PASS** |
| AT1b Anonymous, display-only, owner-only, no-grant | Same file → `AT1b` (401 / 401 / 401 / 403; no dashboard payload) | **PASS** |
| AT1c Malformed/missing/revoked/foreign + nested isolation | Same file → `AT1c` | **PASS** |
| AT2a Current-day parity; DTO allowlist | Same file → `AT2a/AT2b` (wall vs preview step text; no `intendedStructure` / `logicalItemId`) | **PASS** |
| AT2b Privacy/placement in JSON | Same file → `AT2a/AT2b` (private omitted; unpromoted off dashboard; visible on person detail) | **PASS** |
| AT3a No display last_seen / receipts | Same file → `AT3a` | **PASS** |
| AT3b Preview does not steer or execute the wall | `z-p0-009a-preview.spec.ts` → no `display-step-done-*` in the frame. No dual-context pending-intent wall run. | **PARTIAL** |
| AT4a Current-day only; `?date=` rejected | Integration → `AT4a` | **PASS** |
| AT5a Live work update / detail recovery | Host polls 30s and refreshes on member sync `previewRefreshToken`. No second-context Playwright. | **PARTIAL** |
| AT5b Held personal-work withdrawal | Not exercised as a dedicated held-payload UI test. Privacy at rest is AT2b. | **NOT RUN** |
| AT5c Authority-loss variants | Integration → `AT5c` (revoke 404, grant loss 403). No 30s/60s visible-revalidation UI; no expire-session browser variant. | **PARTIAL** |
| AT5d Selection/date/generation fences | Host drops stale seq/date/generation in `DisplayPreviewHost`. No dedicated held-reply Playwright. | **PARTIAL** |
| AT5e Held preview + reset/restore | Integration → `AT5e` reset 200 while held preview 401; shared lease released. Restore variant not written. | **PARTIAL** |
| AT5f Stale deadline and recovery | Host implements 60s stale and `__HD_PREVIEW_*` overrides. No dedicated clock-advance Playwright. | **PARTIAL** |
| AT6a Built + Vite + signed-out restore | `z-p0-009a-preview.spec.ts` (reload, Back, signed-out); `z-p0-009a-vite-deeplink.spec.ts` | **PASS** |
| AT7a Native-versus-fitted viewport parity | `z-p0-009a-geometry.spec.ts`: iframe `contentWindow` stays 3840×2160 across outer resize. No separate native-wall typography capture. | **PARTIAL** |
| AT7b Preview controls and scaled input | Same geometry spec (presets, invalid 100×100); preview spec browses by-work inside the scaled frame | **PASS** |
| AT8a Comparison parity + local capture | `z-p0-009a-proof-vite.spec.ts` current/concept toggle; screenshot under `reports/_local-screenshots/p0-009a-r2/` | **PASS** |
| AT8b Proof stays local; built absence | Proof spec: no `/api/v1/` requests. Preview spec: built `/family-board-proof.html` has no fixture text; `dist/client/family-board-proof.html` absent. Production build inputs omit the proof. | **PASS** |
| AT9a Crowded reachability | Proof spec: six panes, long step-3 text, five upcoming headings after Coming up. Type sizes not recorded. | **PARTIAL** |
| AT9b State-check variants | Proof spec opens State checks (optional / as-needed / anytime titles). Empty-vs-complete and Unassigned-outside-panes not fully asserted. | **PARTIAL** |
| AT10 Independent pane navigation | Coming up / Back to next on Morgan. Two-pane independent scroll/offset not asserted. | **PARTIAL** |
| AT11 Enlarge / touch boundaries | Enlarge/Back on Morgan. Scroll-position restore and background-drag not asserted. | **PARTIAL** |
| AT12a Simulated actions | Done on morning step 3. Hold/reject and Not needed not asserted. | **PARTIAL** |
| AT12b Per-pane idle | Proof spec: Avery returns after 90s; Morgan (later activity) stays on Coming up | **PASS** |
| AT13 Fictional family day | Proof spec: School/Meals labeled fictional | **PASS** |
| AT14a Input/accessibility | Enlarge hit area ≥48×48 in iframe target coordinates. Keyboard/reduced-motion matrix not run. | **PARTIAL** |
| AT14b Listing + exact gates | `--list` evidence below. Exact `validate:pr` and `validate:rc` **PASS**. CI job exists; authorized push **NOT RUN**. | **PASS** (local gates); CI **NOT RUN** |
| Project Lead same-viewport checkpoint | Human. Not authorized here. | **NOT RUN** |

## AT14b listing (local)

`npx playwright test --list --project=chromium --project=chromium-preview --project=chromium-desktop --project=webkit --project=webkit-preview`:

- Phone `chromium` / `webkit`: no `z-p0-009a-*` tests
- `chromium-preview` / `webkit-preview`: `z-p0-009a-preview.spec.ts` only
- `chromium-desktop`: `z-p0-009a-geometry.spec.ts`

`npx playwright test --list -c playwright.vite.config.ts`:

- `vite-phone`: 009A deeplink plus existing deeplinks
- `vite-desktop` / `vite-touch`: `z-p0-009a-proof-vite.spec.ts` only

## Verification performed

- `npx vitest run tests/integration/p0-009a-display-preview.test.ts` — **8 passed**
- `npm run test:e2e:preview` — **5 passed** (chromium-desktop geometry + chromium-preview ×3)
- `npx playwright test -c playwright.vite.config.ts --project=vite-desktop --project=vite-touch tests/e2e/z-p0-009a-proof-vite.spec.ts` — **4 passed**
- `npx playwright test -c playwright.vite.config.ts --project=vite-phone tests/e2e/z-p0-009a-vite-deeplink.spec.ts` — **PASS**
- Exact `npm run validate:pr` — **PASS** (exit 0, ~692s): lint + typecheck; Vitest **373 passed / 51 files**; Playwright `test-results/.last-run.json` `status: passed`. Two earlier full-suite attempts failed on flaky P0-008A AT10 (`/owner` 503 during preserve-restart); that test passed in isolation and on this exact-command retry. Console Playwright totals were truncated by webserver logs.
- Exact `npm run validate:rc` — **PASS** (exit 0, ~1124s): lint + typecheck; Vitest **373 passed / 51 files**; Playwright last-run `passed`.
- Hosted / production wall replacement — **NOT RUN** (not authorized)

## Deviations from brief revision

- None material. Restore is not a second AT5e variant. Several Playwright-heavy rows are PARTIAL as listed; the required HTTP, geometry, routing, and proof isolation contracts are automated.
- AT8b accepts SPA fallback 200 for `/family-board-proof.html` and asserts fixture absence plus missing `dist/client` file, because the production server serves `index.html` for unknown GET paths.

## Discoveries for Architecture

- Preview occurrence steps omit `logicalItemId` as command metadata (same family as `intendedStructure`).
- Proof chrome and the isolated board iframe are separate trees. Hold/reset/fail are passed on the iframe URL; idle clock must be set on the iframe `window` (`__HD_PROOF_CLOCK_MS`).
- Hit-area checks must use iframe target coordinates. Playwright `boundingBox()` is the scaled outer size (~32% at 3840 fitted into 1280).
- P0-008A AT10 can 503 `/owner` if navigation races a preserve-restart. Isolated re-run passed; not treated as a 009A contract break.

## Known limitations

- 3×2 layout and 90s per-pane idle remain hypotheses for the Project Lead checkpoint. The production wall is unchanged.
- AT5b, AT5f, AT5e restore, and dual-wall AT3b are not fully automated.
- AT14b CI listing/run is **NOT RUN** until an authorized push.
- No new runtime dependency.

## Suggested follow-up

Not approved scope. After Architecture technical acceptance, the Project Lead decides any commit and the same-viewport checkpoint. No deploy or wall replacement.

Suggested commit (not created):

```text
feat(P0-009A): add selected-display preview and Vite family-board proof
```
