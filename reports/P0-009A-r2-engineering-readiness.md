# Engineering Readiness Review - BRIEF P0-009A r2

**Brief revision reviewed:** 2  
**Review round:** Initial consolidated pass  
**Readiness:** READY  
**Repository/Git state checked:** YES  
**Current branch:** `brief/p0-009a-selected-display-preview-and-family-wall-proof` @ `34fc89f`  
**Integrated code baseline inspected:** `main` / `origin/main` at **`1acc4a1`** (PR **#29**, accepted P0-008F r1; P0-008E remains through PR #28)  
**Working tree at review:** Docs-only delta from `1acc4a1` (brief, D-057–D-059, PRODUCT/ROADMAP/PROJECT_STATE). No P0-009A implementation under `src/`, `db/`, `tests/`, or `.github/`.

> READY is the default when implementation can reasonably proceed. QUESTION/BLOCKER findings must be material, evidenced, and consolidated; ordinary implementation choices are not readiness gates.

## Verdict

**READY.** P0-009A r2 agrees with Active D-057–D-059 and with the inspected display/member/lifecycle surface at `1acc4a1`. The brief’s current-system claims match the repository. The requested split — member-authorized preview reads versus display execution authority; D-044 current-day materialization under the existing lifecycle barrier; isolated target-viewport rendering; a Vite-only fictional proof; and built-versus-Vite test routing — is implementable with existing grants, projection functions, navigation, Playwright project patterns, and domain helpers.

The 3×2 arrangement and per-pane idle return are evaluation hypotheses. The production wall stays unchanged. Root-route investigation, assignment coverage, and live School/Meals/Calendar remain out of scope.

**No BLOCKER. No QUESTION.** This review does not authorize implementation. Await Architecture **ACCEPT / PROCEED**. Technical acceptance then makes the result ready for the Project Lead’s same-viewport checkpoint; it does not accept the proposed board.

## Decision alignment

| Decision | Brief use | Repo / conflict |
| --- | --- | --- |
| **D-057** | Member session + `household.display.manage`; no fabricated `DisplayContext`; allowlisted current-day wall reads; separate wall execution and preview adapters | Active. Matches current principal split (`/api/v1/displays*` member vs `/api/v1/display/*` display). Grant already exists on the manager preset. |
| **D-058** | Standalone fictional proof; no API/WS/DB/auth/outbox; Vite-only; absent from production | Active. No proof entry exists yet; Vite already has an explicit allowlist separate from built e2e. |
| **D-059** | Labeled 3840×2160 / 1920×1080 target; isolated rendering viewport; uniform fit scale | Active. `styles.css` already uses `vw`/`vh`/`dvh` and viewport media queries; a scaled div against the PC window would be insufficient, as the brief states. |
| **D-044** | Preview uses ordinary current-household-day materialization; no second scheduler or date override | Implemented: `DisplayStore.materializeCurrentDayForHousehold` → `AppStore.materializeHouseholdDate` for today only. |
| **D-045** | 60-second stale bound from request start; memory-only content | Implemented on the live wall (`DisplayApp` `staleMaxMs`); preview must reuse the limit without a display credential. |
| **D-041–D-049, D-050–D-056** | Privacy, promotion, execution, pending replay, reset/restore, epoch/generation | Out of scope except preservation. Preview must not change those contracts. |

No Active-decision contradiction requiring an r3.

## Current-system claim check

Inspected at `1acc4a1` (same sources on this docs-only branch).

| Claim | Evidence | Verdict |
| --- | --- | --- |
| Household displays + `household.display.manage` | `HouseholdDisplays.tsx`; `route-policy.ts` member `/api/v1/displays*` rows; `grants.ts` manager preset | Match |
| Dashboard/person/occurrence readers exist and include ordered steps + `intendedStructure` | `display.ts` `getDisplayDashboard` / `getDisplayPersonDetail` / `getDisplayOccurrenceDetail` | Match |
| Those readers take `DisplayContext`; display auth refreshes `last_seen_at` | Functions require `DisplayContext`. `getDisplaySessionByTokenDigest` updates `display_sessions.last_seen_at`. Projection itself uses only `householdId` + timezone. | Match |
| `main.tsx` probes `/api/v1/display/session` before member mount; `DisplayApp` owns session/sync/outbox/writes | `main.tsx` 29–58; `DisplayApp.tsx` auth, poll, outbox, `setDisplayStepStatus` | Match |
| D-044 current-day reads materialize; HTTP uses lifecycle barrier | `materializeCurrentDayForHousehold`; `app.ts` `onRequest` `acquireShared()` for `/api/v1/*` except exclusive lifecycle | Match |
| DisplayApp 30s poll, 60s stale, 90s idle; member sync has no display-revoke close | `POLL_MS = 30_000`, `DEFAULT_IDLE_MS = 90_000`, `staleMaxMs`; member WS is household-scoped | Match |
| `styles.css` uses `vw`/`vh`/`dvh` and viewport media queries; display records store no geometry | `--display-primary` via `100vw`; `@media (min-width: 1920px)` / `3000px`; `DisplayListItem` has no target size | Match |
| `nav.ts` owns app URLs; built Playwright vs Vite allowlist | `/household/displays` only. Main config `testIgnore`s Vite deeplinks; `playwright.vite.config.ts` is an explicit `testMatch` list. Default Vite project is Pixel 7. | Match |
| `projectPersonalDay`, progress/completion helpers; screenshots ignored | `today-projection.ts`, `progress.ts`, `completion.ts`; `.gitignore` `reports/_local-screenshots/` | Match |

No current-system factual contradiction.

## Focused attention areas

### 1. Member-authorized preview vs display execution (contract §1–§2, AT1–AT3)

**Repo today:** Member display management is `/api/v1/displays` with `requireSession` + `household.display.manage`. Wall reads and writes are `/api/v1/display/*` via `requireDisplay` / `DisplayContext`. `getDisplaySessionByTokenDigest` is what renews presence. `requireSession` reads only the member cookie; owner and display cookies are separate apps/principals.

**Brief:** Three member-only GET preview routes; authorize member + grant, then verify the selected display is same-household and not revoked. No preview write route. Do not mint/borrow display credentials or fabricate `DisplayContext`. Strip `intendedStructure`, CSRF, session IDs, and other command metadata from the preview DTO. Keep `DisplayApp` unmounted in the member preview.

**Disposition:** Implementable. Extract a narrow `{ householdId, timezone }` (or equivalent) read scope after authorization and reuse the existing materialize/filter functions. Register the three routes as `principal: "member"` / `grant: "household.display.manage"` in `route-policy.ts`. Ordinary choices: envelope names; whether grant is checked via existing `hasGrant` helpers; 404 vs 403 for revoked (brief says 404). **IMPORTANT:** never call `getDisplaySessionByTokenDigest` or `setDisplayStepStatus` from preview. AT3a must isolate wall polling from preview when comparing `last_seen_at`.

### 2. Current-day materialization and lifecycle (contract §1–§3, AT4a, AT5d–AT5e)

**Repo today:** Display reads already materialize today only. All `/api/v1` reads take `acquireShared()`. Reset/restore take exclusive and are excluded from the shared hook to avoid deadlock. `x-read-delay-ms` already exists on the display dashboard for held-response tests.

**Brief:** Preview reads may materialize/reconcile today. No date override, historical/future generation, lock, turn, report, or activity-generation write. Capture one household date/context per projection. After any async wait, re-authorize against the current runtime. Held-response tests must finish the server read before delaying browser delivery and must not hold the shared lease across reset/restore.

**Disposition:** Implementable with the existing barrier and delay-header pattern. Preview routes inherit `acquireShared()`. **IMPORTANT:** for AT5e, release the shared hold before parking a response for the browser, matching the brief’s deadlock note. Reuse existing C-2/C-3 withdrawal and epoch suites as cited regressions rather than cloning them.

### 3. Actual target-viewport rendering (contract §4, AT7)

**Repo today:** Display typography and layout resolve against the real window (`100vw`, `100dvh`, width breakpoints). There is no isolated preview frame.

**Brief:** Target dimensions must be the rendering viewport. `transform: scale` on a PC-window div is insufficient. Isolated context contains presentation only; validate frame origin if messaging is used. Outer resize changes fit scale only.

**Disposition:** Engineering choice between a same-origin iframe (or equivalent) whose inner layout viewport is the target size, plus outer uniform scale. Not a product fork. Geometry tests belong in desktop/display Playwright projects (`chromium-display` already uses 3840×2160).

### 4. Fictional proof isolation (contract §5–§6, AT8–AT13)

**Repo today:** No proof bootstrap. Production `main.tsx` always probes display session and mounts `App` or `DisplayApp`. Vite deep-link tests already stay off the built client.

**Brief:** Development-only entry; no sign-in; no household DB; in-memory simulated actions using domain helpers; labeled fictional; 3×2 is a hypothesis with one justified alternative if reachability fails.

**Disposition:** Implementable with `import.meta.env.DEV` (or equivalent) and a standalone entry that is not imported from production `main.tsx`. Proof tests go only in the Vite allowlist. Built tests assert absence. Fixture/scenario IDs and local screenshots are Engineering-owned. If initial 3×2 cannot meet AT9a, keep that capture and show one alternative — do not silently shrink type.

### 5. Built-preview vs Vite-only test routing (AT6a, AT14b)

**Repo today:** Main Playwright `testMatch: **/*.spec.ts`. `chromium` / `webkit` ignore only `z-p0-008*`. CI `e2e-phone-core` is `--project=chromium --grep-invert "P0-007"`. Vite config is an explicit file list on Pixel 7. Desktop/display projects use explicit `testMatch`.

**Brief:** Built preview + geometry on Chromium/WebKit desktop/display projects; production absence assertion on built tests; proof only via Vite desktop/touch projects; new `E2E · Display preview P0-009A` job; update aggregate `needs` **and** result list; do not re-run the suite in phone-core.

**Disposition:** Implementable with the existing project-split pattern. **IMPORTANT:** a new `z-p0-009a-preview.spec.ts` will run on the phone `chromium`/`webkit` projects unless `testIgnore`/`testMatch` and the phone-core grep exclude it. Do not add the proof spec to `playwright.vite.config.ts`’s default Pixel 7 project alone; add an explicit desktop/touch Vite project (or a small dedicated Vite config) and keep the proof out of built `testMatch`. Exact script names are Engineering’s.

## Evidence-matrix implementability

Every AT1–AT14b row has an existing harness, grant, projection, or Playwright/Vite seam sufficient to add the named evidence. AT14b CI remains **NOT RUN** until an authorized push. The Project Lead checkpoint is human and is not a technical-acceptance substitute.

## Concerns

None at BLOCKER or QUESTION.

### IMPORTANT

- Restrict new built-preview/geometry specs to desktop/display projects and exclude them from phone-core; keep the proof on an explicit Vite desktop/touch project.
- Preview DTOs must omit `intendedStructure` and display CSRF/session fields even though current wall occurrence detail includes them.
- Held-response + reset/restore tests must not keep `acquireShared()` across exclusive lifecycle.

### NOTE

- Isolated viewport mechanism (iframe vs equivalent) is local Engineering choice; geometry parity is the contract.
- 3×2 and 90-second per-pane idle are prototype candidates for the Project Lead, not production wall changes.
- Envelope JSON names, module names, and exact npm/CI job identifiers are Engineering’s.

## Out of scope (confirmed)

Root-route `/` anomaly; assignment/coverage; live School/Meals/Calendar; production wall layout/idle; Railway/deployment/merge; replacing the live board.

## Next

Await Architecture ACCEPT / PROCEED for P0-009A r2. After that, implement on this brief branch from `1acc4a1`. Do not start coding on this readiness handoff.
