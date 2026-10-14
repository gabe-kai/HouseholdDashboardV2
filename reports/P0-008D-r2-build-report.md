# Build Report - BRIEF P0-008D r2 (second reassessment correction)

**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED — awaiting Architecture re-review  
**Branch:** `brief/p0-008d-guided-first-household-day`  
**Prior correction reviewed:** `3320033` (Architecture FIX REQUIRED in `reports/P0-008D-r2-architecture-second-reassessment.md`)  
**Second reassessment docs tip:** `101df9f`  
**This correction tip:** uncommitted working tree on this branch (suggest commit; do not auto-commit)  
**Authorization:** same r2; no contract revision / readiness cycle  
**Pull request:** not opened by this Build Report  

## What changed (second reassessment)

| Finding | Correction |
| --- | --- |
| **R1** | `selectCurrentRevision` hydrates current/upcoming schedule entry (not last revision); preserve logical step IDs, addition IDs/assignment, null owners, assignment anchor/exclusion/ring; multi-item selector; baselines from hydrated object; recap uses dated preview/next-known + deleted/ended truth |
| **R4** | Draft preview returns per-day filtered `stepTexts`; review lines use composed day steps/additions; edits go through `guideSaveWork` + `reviseTarget` with the same previewBasis enforcement |
| **R3/R5** | Dirty soft-load no longer overwrites progress baselines; definitive errors clear pending commands; form edits after pending retire the old command; hydrate/select fences retained |
| **AT10** | Ordinary UI: invite→redeem (fresh browser context)→revoke→restore-link→used/unused removal→backup→reset (backup off)→protected Welcome restore→fresh sign-in |
| **AT11** | Real `POST /household/backups` + owner `POST /household/restore`; source byte immutability; guide progress/dismissal preserved; all three claim purposes preview+redeem denied; fresh invitation recovery |

## Acceptance / finding evidence (honest mappings)

| AT / Finding | Named evidence | Result |
| --- | --- | --- |
| AT1 / R6 | `tests/integration/p0-008d.test.ts` — `AT1: migration 020/021…through-019 adopts…`; helper `tests/helpers/p019-fixture.ts` | **PASS** (through-019 adopt + A progress/C departures). Remaining no-A-progress / full catalog matrix: **PARTIAL** |
| AT2 / R1 / R7 | `tests/e2e/z-p0-008d-guided-setup.spec.ts` — `P0-008D AT2: phone journey…` | **PASS** (exact PR/RC) |
| AT3 / R1 / R5 | same file — `P0-008D AT3: account Back…` | **PASS** (exact PR/RC) |
| AT4 / R3 | integration — `AT4: guide person save rolls back…`; `R3: changed-payload…`; `R3: changed scheduledAdditions…` | **PASS** |
| AT5 / R4 | integration — `AT5/R4: draft routine preview unions…`; `R4: guide work creation without previewBasis…` (stepTexts compared when present on AT7 path) | **PASS** for group-union + no-basis + composed stepTexts. Full controlled-date / held-review matrix: **PARTIAL** |
| AT6 / R2 | integration — `AT6: competing guide school save…`; `R2: guide school Not now…` | **PASS** (guide-version race + calendar preserve). Occurrence first-action vs calendar: **PARTIAL** |
| AT7 / R6 | integration — `AT7: unused guide person and work can be deleted…` | **PASS** (unused person + routine delete + retired replay). Both-kinds / used / departed / ended: **PARTIAL** |
| AT8 | integration — `AT8: guide progress requires lifecycle.manage`; `AT8: foreign/display principals cannot read guide…` | **PASS** for unauth + foreign cookie + display principal. Lifecycle-only member / epoch-held: **PARTIAL** |
| AT9 / R5 | e2e — `P0-008D AT9: dirty draft retained across soft guide refresh conflict` | **PARTIAL** (single-context visibility soft-load). Two-manager / socket outage: **PARTIAL** |
| AT10 | e2e — `P0-008D AT10: invite/access/removal/backup/reset/Welcome restore UI journey` | **PASS** (Chromium + WebKit under exact RC; also focused Chromium) |
| AT11 / R6 | integration — `AT11: B restore of D household preserves guide progress, scrubs claims, keeps source bytes` (+ `AT11: scrubRestoredAccess…`) | **PASS** (staged B restore of D household + scrub + source bytes + three-purpose denial + fresh invite). Separate aged 017/018/019 snapshot matrix beyond D: **PARTIAL** |
| AT12 / R7 | e2e — `P0-008D AT12: direct /household/setup reload…`; desktop — `P0-008D AT12 desktop…` | **PASS** (reload + desktop rail). Broader keyboard/touch geometry: **PARTIAL** |
| AT13 | local release paths in ARCHITECTURE | **PASS** (local). Hosted: **NOT RUN** |
| AT14 | Exact `validate:pr` / `validate:rc` | **PASS** — see Verification |

## Verification performed

- `npx tsc --noEmit -p tsconfig.json` — PASS  
- `npx vitest run tests/integration/p0-008d.test.ts` — **13 passed**  
- Focused AT10: `npx playwright test tests/e2e/z-p0-008d-guided-setup.spec.ts -g "AT10" --project=chromium-008a` — **1 passed**  
- Exact `npm run validate:pr` — **PASS** — `reports/_local-validate-pr-008d-r2c.log`  
  - Unit/integration: **329** passed (46 files)  
  - Chromium Playwright: **111** passed  
  - Vite deep-link: **6** passed  
- Exact `npm run validate:rc` — **PASS** — `reports/_local-validate-rc-008d-r2c.log`  
  - Unit/integration: **329** passed (46 files)  
  - Chromium+WebKit Playwright: **176** passed (includes AT10 on `chromium-008a` and `webkit-008a`)  
  - Vite deep-link: **6** passed  
- Hosted Railway / live DB — **NOT RUN** (disposable local only)

## Suggested commit message (do not commit unless authorized)

```
fix(P0-008D): close second r2 reassessment with full AT10/AT11 restore journeys
```

## Notes for Architecture

- Foundations retained from `3320033`: digest/scheduledAdditions, require previewBasis, soft dirty load, weekly/cycle/group controls.
- Shared card **Set up and manage my household without operator help** remains **In Progress**.
- Pin this Build Report to the forthcoming correction commit SHA after Project Lead commit.
