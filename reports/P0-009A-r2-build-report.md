# Build Report - BRIEF P0-009A r2 (selected-display preview and family-wall proof)

**Acting as:** Engineering  
**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED — awaiting Architecture re-review after FIX REQUIRED evidence closure  
**Branch:** `brief/p0-009a-selected-display-preview-and-family-wall-proof`  
**Baseline:** `main` at `1acc4a1`  
**Implementation commit:** `d4f313d`  
**Tested source state at this closure:** `8511efb` plus uncommitted working-tree delta on that branch (no Engineering commit for this evidence pass)  
**Pull request:** not opened  
**Authorization:** Architecture FIX REQUIRED against the same r2 contract. No hosted deployment, Railway mutation, merge, or production wall replacement.

Readiness: `reports/P0-009A-r2-engineering-readiness.md`.  
Prior Architecture review: `reports/P0-009A-r2-architecture-review.md` (FIX REQUIRED, 2026-10-28).

## What changed

Member-authorized, read-only selected-display preview in the built app, plus a Vite/dev-only fictional family-board proof. Production wall layout, idle behavior, credentials, and execution adapters are unchanged.

1. **Preview reads.** Three member GET routes reuse current-day wall projection through a `{ householdId, timezone }` read scope. Authorization is member session + `household.display.manage` + same-household non-revoked display. No `DisplayContext`, display cookie, or `getDisplaySessionByTokenDigest`. Preview DTOs omit `intendedStructure`, step `logicalItemId`, and CSRF/session fields.
2. **Lifecycle.** Preview materializes only today (D-044). `?date=` is 400. Held local/test replies finish the read, `releaseSharedNow()`, delay, then revalidate session/epoch/display so reset/restore are not blocked.
3. **Preview UI.** Wall presentation is extracted and mounted read-only inside `preview-frame.html`. The iframe layout viewport is the labeled target; the host applies uniform `transform: scale`. Chrome (Preview only, geometry, Back) stays outside the frame.
4. **Proof.** `family-board-proof.html` is a Vite `command === "serve"` input only. In-memory crowded / state-check / fictional family-day fixtures; current layout via the shared presenter; 3×2 concept with simulated Done/Reopen/Not needed and a 90s per-pane idle candidate.
5. **Routing cautions.** Built preview/geometry stay off phone-core. Proof runs on explicit `vite-desktop` / `vite-touch`. Phone-core grep-invert includes `P0-009A`.

### Architecture FIX REQUIRED closure (same revision)

This pass adds named Playwright/Vitest evidence for the rows Architecture marked incomplete. The brief contract and production wall are unchanged. Related assertions are grouped in the tests below; one test per matrix row is not required.

- Preview host fences: denial sequence bump, withdrawn promoted-personal IDs, older `householdDate` reject, in-flight detail abort when `detailRef` no longer matches, and `blankedAt` recorded with wall-clock `Date.now()` so a fake `__HD_PREVIEW_NOW_MS` cannot permanently reject recovery.
- Member preview shell uses `app-shell-wide` so fitted scale can track the window instead of the 720px member column.
- Proof UI: empty / optional / as-needed / anytime / unassigned-without-claim / promoted view-only / retryable fail-detail; family-day school/meals/calendar; independent pane section + offset; enlarge/back focus restore; ≥48×48 hit areas; reduced-motion; settle/reject hooks.
- Tests named in the matrix below. Local `validate:pr` / `validate:rc` were already reported passing on the prior handoff and were not re-run as a gate for this evidence pass.

## Readiness cautions addressed

| Caution | Implementation |
| --- | --- |
| Built preview/geometry off phone-core; proof on explicit Vite desktop/touch | `chromium` / `webkit` `testIgnore **/z-p0-009a-*.spec.ts`; phone-core `--grep-invert "P0-007\|P0-009A"`; geometry on `chromium-desktop` + `chromium-display`; preview on `chromium-preview` + `webkit-preview`; proof only in `playwright.vite.config.ts` `vite-desktop` / `vite-touch` |
| Preview DTOs omit `intendedStructure` and display CSRF/session fields | `stripPreviewOccurrence` drops `intendedStructure` and step `logicalItemId`; AT1a/AT2a assert the JSON has no `csrf` / `intendedStructure` / `sessionId` |
| Held-response + reset/restore must not keep `acquireShared()` across exclusive lifecycle | `deliverPreviewAfterHold` reads first, `releaseSharedNow()`, then delays; AT5e reset and restore each return 200 while the held preview completes 401 |

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

Uncommitted on this closure (evidence pass): `DisplayPreviewHost.tsx`, `App.tsx`, `family-board-proof.tsx`, `styles.css`, and the four 009A test files listed above.

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
| AT3b Preview does not steer or execute the wall | `z-p0-009a-preview.spec.ts` → `AT3b: preview browse does not steer a wall with a pending intent`: enrolled wall holds Avery detail + aborted Done pending; member preview browses by-work/by-person with zero non-GET `/api/v1/display` requests and zero `display-step-done-*`; wall route, “Hold this step”, scrollTop, and pending status stay; unroute + `online`/`visibilitychange` leaves the step visible. | **PASS** |
| AT4a Current-day only; `?date=` rejected | Integration → `AT4a` | **PASS** |
| AT5a Live work update / detail recovery | Same preview spec → `AT5a: second context updates open preview detail; gone work becomes unavailable`: Avery context completes the open step (`performedAt` + `activityGeneration` + `kind`); preview converges to Done without reload while Avery detail stays open; Back `{ force: true }` to overview; unstarted routine is opened then ended; `display-detail-unavailable`. Poll hook `__HD_PREVIEW_POLL_MS = 800`. | **PASS** |
| AT5b Held personal-work withdrawal | Same preview spec → `AT5b/AT5c/AT5d/AT5f`: hold next dashboard GET; privatize promoted task; title leaves the frame before release; held body still contains the title; after release the title stays gone. | **PASS** |
| AT5c Authority-loss variants | Integration `AT5c` revoke 404 / grant-loss 403; integration `AT5c: expired member session` 401 no dashboard. Preview spec grouped test: revoke while preview open → `display-preview-error` and overview count 0. `AT5c session expiry clears preview without a display credential`: logout → Sign in or preview error; overview count 0. Visible revalidation uses production `PREVIEW_POLL_MS = 30_000` with test hook 600–700 ms. | **PASS** |
| AT5d Selection/date/generation fences | Grouped preview test: poisoned dashboard `householdDate` 2020-01-01 does not render January 1; subsequent `activityGeneration` 0 does not restore the withdrawn title. AT5a retains the Avery/work selection through a live complete. Host `loadDetail` aborts when `detailRef` no longer matches. | **PASS** |
| AT5e Held preview + reset/restore | Integration `AT5e` reset 200 while held preview 401, no dashboard. Integration `AT5e restore`: reauthenticate, backup, hold 400 ms, POST restore 200, held 401, subsequent read 401. Shared lease released in both variants. | **PASS** |
| AT5f Stale deadline and recovery | Grouped preview test: abort dashboard, `__HD_PREVIEW_NOW_MS = Date.now()+61_000` + `__HD_PREVIEW_FORCE_STALE__` → `display-preview-frame-empty` with expired/loading copy; unroute, delete fake clock, `visibilitychange` → overview recovers; withdrawn title stays gone. `blankedAt` uses wall-clock `Date.now()`. | **PASS** |
| AT6a Built + Vite + signed-out restore | `z-p0-009a-preview.spec.ts` (reload, Back, signed-out); `z-p0-009a-vite-deeplink.spec.ts` | **PASS** |
| AT7a Native-versus-fitted viewport parity | `z-p0-009a-geometry.spec.ts` → `AT7a: fitted preview typography matches a native wall at 3840 and 1920`: native claimed wall vs preview iframe `innerWidth/Height`, `.display-person-name`/`.display-time` `fontSize`, `display-by-person` columns, `min-width: 1920px` / `3000px`. Outer 1280×800 and 1600×1000 leave inner metrics equal; 720×800 changes only the host fit label. Companion `AT7a/AT7b` keeps iframe 3840×2160 across 1600×900. | **PASS** |
| AT7b Preview controls and scaled input | Same geometry spec (presets, invalid 100×100); preview spec browses by-work inside the scaled frame | **PASS** |
| AT8a Comparison parity + local capture | `z-p0-009a-proof-vite.spec.ts` → `AT8a/AT8b/AT9a/AT9b/AT13` on `vite-desktop` and `vite-touch`. Paired `reports/_local-screenshots/p0-009a-r2/{vite-desktop,vite-touch}-{current,concept}.png` plus `{project}-comparison.json` (`fixture`, `scenario`, `viewport`, `browser`, `dpr`, `scale`, `typeSizes`). | **PASS** |
| AT8b Proof stays local; built absence | Proof spec: no `/api/v1/` requests. Preview spec: built `/family-board-proof.html` has no fixture text; `dist/client/family-board-proof.html` absent. Production build inputs omit the proof. | **PASS** |
| AT9a Crowded reachability | Same proof spec: six panes (`family-pane-p-{morgan,avery,jordan,casey,taylor,rowan}`) at 3840 and again at 1920; step-3 long backpack text; Coming up five headings (Homework time, House cleaning, Dinner cleanup, Bedtime, Cat litter); Earlier + Back to next; concept stage `scrollWidth <= clientWidth + 1`. Recorded type sizes in comparison JSON (`personName` / `workTitle`, both `16px` on this run). | **PASS** |
| AT9b State-check variants | Same spec `proof-scenario-states`: `family-empty-p-morgan`; “Required done, optional left” / Optional; “Unresolved as needed” / As needed; Anytime drawer tidy; `family-unassigned` with zero Claim **buttons**; `family-promoted-view-only`. `proof-fail-detail` → `display-detail-unavailable` contains Retry. | **PASS** |
| AT10 Independent pane navigation | Same file → `AT10/AT11/AT12a/AT12b/AT14a`: Morgan `data-section=upcoming` scrollTop 120; Avery `earlier` scrollTop 80; Morgan More leaves Avery section/offset unchanged; Back to next on Morgan. One `family-scroll-p-*` surface per pane. | **PASS** |
| AT11 Enlarge / touch boundaries | Same grouped spec: scrolled Morgan enlarge via Enter; Back visible with identity; focus returns to `family-enlarge-p-morgan`; scrollTop 40 restored. Mouse drag on pane neither enlarges nor changes the Done control text. | **PASS** |
| AT12a Simulated actions | Same grouped spec: morning s3 Done then Reopen (Open); Rowan Coming up Not needed on `cats-2`; `proof-hold` + `__HD_PROOF_SETTLE__` settles s4 to Done; hold + `__HD_PROOF_REJECT__` shows `family-error-w-morning-morgan`. No `/api/v1/` on the companion proof spec. | **PASS** |
| AT12b Per-pane idle | Same grouped spec: clock 0 → 10000 → 90001; Morgan upcoming remains; Avery upcoming count 0 after 90s idle. | **PASS** |
| AT13 Fictional family day | Same `AT8a/…/AT13` spec `proof-scenario-family`: Avery “Science fair paragraph”; Jordan “Spelling list”; shared “pasta and salad”; calendar “Early release Friday 2026-10-30” / “Avery and Jordan” / “Today vs Later”; homework Done on `hw-m-1` leaves `family-school-p-avery` visible. | **PASS** |
| AT14a Input/accessibility | Same grouped spec: `emulateMedia({ reducedMotion: "reduce" })` and iframe `matchMedia` true; enlarge via Enter; visible `.family-board-hit` in target coordinates `w/h ≥ 48` and `overlap === 0`; drag does not check off. Status copy is textual (Done / Open / Not needed / Saving…). | **PASS** |
| AT14b Listing + exact gates | `--list` evidence below. Exact `validate:pr` and `validate:rc` **PASS** on the prior handoff (not re-run this closure). CI job exists; authorized push **NOT RUN**. | **PASS** (local gates); CI **NOT RUN** |
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

Evidence-closure runs (this pass):

- `npx vitest run tests/integration/p0-009a-display-preview.test.ts` — **10 passed** (adds AT5c session expiry and AT5e restore)
- `npm run test:e2e:preview` — **11 passed** (chromium-desktop/display geometry + chromium-preview AT3b/AT5a/AT5b–f/AT5c session/AT6a/AT8b)
- `npx playwright test -c playwright.vite.config.ts --project=vite-desktop --project=vite-touch tests/e2e/z-p0-009a-proof-vite.spec.ts` — **4 passed**
- `npx playwright test -c playwright.vite.config.ts --project=vite-phone tests/e2e/z-p0-009a-vite-deeplink.spec.ts` — **PASS** (prior evidence-pass combined Vite total **5 passed**)

Local PR/RC gates (prior handoff; not re-run this closure):

- Exact `npm run validate:pr` — **PASS** (exit 0, ~692s): lint + typecheck; Vitest **373 passed / 51 files**; Playwright `test-results/.last-run.json` `status: passed`.
- Exact `npm run validate:rc` — **PASS** (exit 0, ~1124s): lint + typecheck; Vitest **373 passed / 51 files**; Playwright last-run `passed`.

Not run:

- Hosted / production wall replacement — **NOT RUN** (not authorized)
- GitHub Actions on an authorized push — **NOT RUN**
- Project Lead same-viewport checkpoint — **NOT RUN**

## Deviations from brief revision

- None material. Restore is now a dedicated AT5e integration variant. AT5d person/occurrence *held-reply* intercepts after a selection change are not a separate Playwright case; the demonstrated fences are dashboard date/generation poison plus AT5a selection retention and host `detailRef` abort.
- AT8b accepts SPA fallback 200 for `/family-board-proof.html` and asserts fixture absence plus missing `dist/client` file, because the production server serves `index.html` for unknown GET paths.
- Fit percent is often height-limited at 16:9, so AT7a proves outer-resize scale change by narrowing to 720×800 rather than relying on 1280→1600 width alone.

## Discoveries for Architecture

- Preview occurrence steps omit `logicalItemId` as command metadata (same family as `intendedStructure`).
- Proof chrome and the isolated board iframe are separate trees. Hold/reset/fail are passed on the iframe URL; idle clock and settle/reject flags must be set on the iframe `window`.
- Hit-area checks must use iframe target coordinates. Playwright `boundingBox()` is the scaled outer size (~32% at 3840 fitted into 1280).
- `blankedAt` must use wall-clock `Date.now()`. Stamping it from `__HD_PREVIEW_NOW_MS` made every later real request look older than the blank and blocked AT5f recovery.
- Ending a *started* routine keeps the occurrence (immediate-end of in-progress work). AT5a disappeared-detail uses an *unstarted* routine end so the preview can 404.
- Preview iframe remounts on the 800 ms test poll, so Back inside the frame needs `{ force: true }`.
- P0-008A AT10 can 503 `/owner` if navigation races a preserve-restart. Isolated re-run passed on the prior handoff; not treated as a 009A contract break.

## Known limitations

- 3×2 layout and 90s per-pane idle remain hypotheses for the Project Lead checkpoint. The production wall is unchanged.
- AT14b CI listing/run is **NOT RUN** until an authorized push.
- No new runtime dependency.

## Suggested follow-up

Not approved scope. After Architecture technical acceptance, the Project Lead decides any commit and the same-viewport checkpoint. No deploy or wall replacement.

Suggested commit (not created):

```text
feat(P0-009A): add selected-display preview and Vite family-board proof
```
