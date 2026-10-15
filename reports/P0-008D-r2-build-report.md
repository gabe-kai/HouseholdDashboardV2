# Build Report - BRIEF P0-008D r2 (third reassessment C1–C7)

**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED — awaiting Architecture re-review  
**Branch:** `brief/p0-008d-guided-first-household-day`  
**Reviewed baseline:** `9c86257` (Architecture third reassessment FIX REQUIRED)  
**This correction tip:** uncommitted working tree on this branch (suggest commit; do not auto-commit)  
**Authorization:** same r2; no contract revision / readiness cycle  
**Pull request:** not opened by this Build Report  

## Retained from `9c86257`

AT10 full lifecycle UI; saved-edit/`reviseTarget`; composed routine+responsibility previews; async fences and causal soft load; AT6 first-action+calendar; AT7 unused both-kinds + used depart; AT8 display/member denial; AT9 dual-manager socket; AT11 D restore + through-017.

## Evidence map (C1–C7)

| Item | File | Exact test name | Asserted behavior | Project | Result |
| --- | --- | --- | --- | --- | --- |
| C1 with-A value equality | `tests/integration/p0-008d.test.ts` | `C1/AT1: populated through-019 upgrade preserves actual grants, history, calendar, and departures` | Custom grant, calendar year/exception, started occurrence steps+reports, membership IDs, departures equal after double migrate; FK empty; A timestamps kept; guide GET; `setupRequired:false`; catalog+epoch stable | integration | **PASS** |
| C1 no-A | same | `C1/AT1: through-019 without A progress does not invent completion timestamps` | No row before ensure; null account/household after guide open; no wizard | integration | **PASS** |
| C1 baseline adopt | same | `AT1: migration 020/021 idempotent; populated through-019 adopts…` | Tip + A progress + departure/grant presence | integration | **PASS** |
| C2 matrix | same | `C2/AT5: controlled-date preview agrees with saved work and stale consent conflicts` | Non-applicable weekday; school absent/later; children-only; fixed+addition owner; weekly; unassigned; stale date/source conflict; zero materialization; future schedule edit | integration | **PASS** |
| C2 composed/no-basis | same | `AT5/R4: responsibility draft preview returns composed stepTexts…`; `AT5/R4: draft routine preview unions…`; `R4: …without previewBasis…` | Composed steps; group union; no-basis reject | integration | **PASS** |
| C3 held reset | `tests/e2e/z-p0-008d-guided-setup.spec.ts` | `P0-008D AT8: held guide progress does not repopulate Welcome after reset` | Hold after fetch; other context reset; release → Welcome; old names gone; no POST writes | chromium-008a (+ RC webkit) | **PASS** |
| C3 held restore | same | `P0-008D AT8: held guide progress does not overwrite restored people` | Hold one-shot pre-restore GET; other context restore; release cannot overwrite restored people or keep “After Child” on held tab (loadedEpoch fence) | chromium-008a + webkit-008a | **PASS** |
| C3 held detail | same | `P0-008D AT8: held nested work detail does not hydrate after reset` | Hold GET `/routines/*`; reset; release → Welcome; title not hydrated | chromium-008a | **PASS** |
| C3 epoch write | integration | `C3/AT8: a guide command from the previous epoch cannot write` | Stale epoch POST denied | integration | **PASS** |
| C4 018/019 | integration | `C4/AT11: through-018 and through-019 snapshots restore through B and keep source bytes` | Genuine tip files via `createThroughTipBackupFile`; register/restore; immutable bytes; tip→D | integration | **PASS** |
| C4 017 / D | integration | `AT11: through-017…`; `AT11: B restore of D household…` | Aged 017 + D claim scrub | integration | **PASS** |
| C4 reset/clear | integration | `C4/AT11: reset during incomplete…`; `C4/AT11: reset and clear activity leave the expected guide progress` | Incomplete reset fresh; clear preserves statuses/links/dismissal; finish-reset fresh | integration | **PASS** |
| C5 ended/missing | integration | `C5/AT7: ended linked work stays truthful and a same-title definition is not adopted` | Ended link retained; same-title not adopted; delete omits link; replay cannot recreate | integration | **PASS** |
| C5 recap UI | e2e | `P0-008D AT7: ended linked work shows truthful recap and ignores same-title twin` | Recap shows `ended` | chromium-008a | **PASS** |
| C6 tablet/desktop/200% | `tests/e2e/z-p0-008d-desktop-setup.spec.ts` | `P0-008D AT12: guide form readable at tablet, desktop, and 200% text` | Longer work form; 768×1024, 1280×800; simulated 200% zoom; focus; screenshots under `reports/_local-screenshots/p0-008d-r2/` | chromium-008a-desktop | **PASS** |
| C6 touch/reorder | e2e | `P0-008D AT12: touch reorder persists through save and reload` | `touchscreen.tap` on Move; reduced motion; persist after reload | chromium-008a | **PASS** |
| C6 phone/reload | e2e | `P0-008D AT12: guide controls…phone…`; `…reload stays on guide`; desktop rail | Shell/focus/reload/rail | chromium-008a / desktop | **PASS** |
| C7 gates | this report | Exact `validate:pr` / `validate:rc` | Final tree | — | See Verification |

**Honest remaining PARTIAL (if any):** none of the third-reassessment required subcases above are left PARTIAL after this pass. Broader optional matrices beyond C1–C6 (e.g. physical keyboard observation vs simulated zoom) are labeled simulated in C6.

## Verification performed

- `npx tsc --noEmit -p tsconfig.json` — PASS  
- `npx vitest run tests/integration/p0-008d.test.ts` — **27 passed**  
- Focused Chromium+WebKit AT8 held reset/restore — PASS  
- Exact `npm run validate:pr` — **PASS** (`reports/_local-validate-pr-008d-r2e.log`): **343** unit/integration; **119** Chromium Playwright; **6** Vite  
- Exact `npm run validate:rc` — **PASS** (`reports/_local-validate-rc-008d-r2e.log`): **343** unit/integration; **191** Playwright passed (**31** skipped by project filters, including D phone Chromium/WebKit + desktop selections); **6** Vite  
- Hosted / physical — **NOT RUN** (separate Product checkpoints)

### Uncommitted correction tip (vs `9c86257`)

Engineering-owned tree for this pass: `GuidedSetup.tsx` (loadedEpoch / held-response fence), guide `installationEpoch` plumbing (`api.ts` / `schemas.ts` / `lifecycle-routes.ts`), C1–C5 integration in `p0-008d.test.ts`, AT7/AT8/AT12 e2e, `through-017-backup-fixture.ts` tip builder, this Build Report. Unrelated dirty docs (`PROJECT_STATE.md`, `ROADMAP.md`, brief/second-reassessment edits) and Architecture’s untracked third reassessment were left untouched for the Coordinator.

## Suggested commit message (do not commit unless authorized)

```
fix(P0-008D): close remaining r2 acceptance evidence

Prove populated upgrade preservation, guide review truth, held-epoch
recovery, supported restore generations, and guide geometry; pin the
Build Report to the committed correction.
```
