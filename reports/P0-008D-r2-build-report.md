# Build Report - BRIEF P0-008D r2 (follow-up on `6d427ff`)

**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED — awaiting Architecture re-review  
**Branch:** `brief/p0-008d-guided-first-household-day`  
**Prior correction reviewed:** `6d427ff` (Architecture FIX REQUIRED follow-up in `reports/P0-008D-r2-architecture-second-reassessment.md`)  
**Docs tip at follow-up:** `f4d68da`  
**This correction tip:** uncommitted working tree on this branch (suggest commit; do not auto-commit)  
**Authorization:** same r2; no contract revision / readiness cycle  
**Pull request:** not opened by this Build Report  

## Retained from `6d427ff`

- Saved-edit hydration (`selectCurrentRevision`), domain ID/null-owner/assignment preservation, `guideSaveWork`/`reviseTarget`
- Filtered routine `stepTexts` preview; dirty soft-load baseline retain; definitive-error pending clear
- AT11 actual B restore of D household (source bytes, scrub, fresh invite)
- AT10 ordinary UI invite/redeem/revoke/backup/reset/Welcome restore sequence

## What this correction adds

| Checklist | Correction |
| --- | --- |
| **1 AT10** | Permissions edit; restore-sign-in redeem; enrolled work before Depart; guide work before backup; catalog label + no hidden reset backup; stale invitation; restored guide work assertion |
| **2 R3/R5** | Nested hydrate/save fences (generation/epoch/dirty); version-causal soft load (replaces one-shot suppress); pending retained across preview invalidation |
| **3 R4** | Responsibility preview returns composed `stepTexts`; client review uses them; `guideSaveWork` compares stepTexts when present |
| **4 PARTIALs** | Named tests for AT1 no-A, AT5 composed consent, AT6 first-action+calendar, AT7 responsibility+depart, AT8 member without lifecycle.manage, AT9 two-manager socket, AT11 through-017 on D, AT12 phone/keyboard |

## Acceptance / finding evidence (honest mappings)

| AT / Finding | Named evidence | Result |
| --- | --- | --- |
| AT1 / R6 | `AT1: migration 020/021…through-019…`; `AT1: no-A-progress adoption creates guide row…` | **PASS** for with-A adopt + no-A null timestamps. Custom-grant/history/calendar/control-catalog matrix beyond grants-in-AT1: **PARTIAL** (REUSE B `AT6: control catalog…` for catalog-only) |
| AT2 | e2e `P0-008D AT2: phone journey…` | **PASS** |
| AT3 | e2e `P0-008D AT3: account Back…` | **PASS** |
| AT4 / R3 | integration AT4 + R3 digest tests | **PASS** |
| AT5 / R4 | `AT5/R4: draft routine preview…`; `AT5/R4: responsibility draft preview returns composed stepTexts…`; `R4: …without previewBasis…` | **PASS** for group-union, no-basis, composed stepTexts consent. Broader controlled-date/phase/Unassigned matrix: **PARTIAL** |
| AT6 / R2 | `AT6: competing guide school…`; `AT6: guide calendar change after first action preserves…`; `R2: guide school Not now…` | **PASS** (version race + first-action history after calendar change) |
| AT7 / R6 | prior unused person+routine; `AT7: unused responsibility deletes; used enrolled person departs…` | **PASS** for both kinds unused delete + used depart. Ended-definition return matrix: **PARTIAL** (REUSE P0-005 end/delete) |
| AT8 | lifecycle.manage; foreign/display; `AT8: enrolled member without lifecycle.manage…` | **PASS** for unauth/fake/display/member-without-lifecycle. Held-epoch after reset: **PARTIAL** |
| AT9 / R5 | soft visibility retain; `P0-008D AT9: two managers converge after actual socket loss on guide` | **PASS** (dual-manager + `__hdSync.closeForTest` + visibility recover) |
| AT10 | `P0-008D AT10: invite/access/removal/backup/reset/Welcome restore UI journey` | **PASS** (expanded assertions; Chromium focused + exact PR/RC Chromium+WebKit) |
| AT11 / R6 | D B restore AT11; `AT11: through-017 aged snapshot B restore…`; scrub helper | **PASS** for D restore + through-017 aged image. Separate through-018/019 labeled images: **PARTIAL** (REUSE B through-017; D through-019 adopt is AT1) |
| AT12 / R7 | reload AT12; desktop rail; `P0-008D AT12: guide controls remain usable at phone width…` | **PASS** for reload/desktop/phone+keyboard focus. Full 768/200%/touch suite: **PARTIAL** |
| AT13 | local release paths | **PASS** (local). Hosted: **NOT RUN** |
| AT14 | Exact `validate:pr` / `validate:rc` | See Verification |

## Verification performed

- `npx tsc --noEmit -p tsconfig.json` — PASS  
- `npm run lint` — PASS  
- `npx vitest run tests/integration/p0-008d.test.ts` — **19 passed**  
- Focused Chromium AT10 / AT9 dual / AT12 phone — PASS  
- Focused WebKit AT10 — PASS  
- Exact `npm run validate:pr` — **PASS** — `reports/_local-validate-pr-008d-r2d.log`  
  - Unit/integration: **335** passed (46 files)  
  - Chromium Playwright: **113** passed  
  - Vite deep-link: **6** passed  
- Exact `npm run validate:rc` — **PASS** — `reports/_local-validate-rc-008d-r2d.log`  
  - Unit/integration: **335** passed (46 files)  
  - Chromium+WebKit Playwright: **180** passed (AT10 on `chromium-008a` + `webkit-008a`)  
  - Vite deep-link: **6** passed  
- Hosted Railway / live DB — **NOT RUN**

## Suggested commit message (do not commit unless authorized)

```
fix(P0-008D): close 6d427ff follow-up AT10 assertions, fences, preview, and PARTIALs
```

## Notes for Architecture

- Shared card **Set up and manage my household without operator help** remains **In Progress**.
- Pin this Build Report to the forthcoming correction commit SHA after Project Lead commit.
