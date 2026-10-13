# Build Report - BRIEF P0-008D r2 (FIX REQUIRED reassessment correction)

**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED — awaiting Architecture re-review  
**Branch:** `brief/p0-008d-guided-first-household-day`  
**Prior correction reviewed:** `efc1f22` (Architecture FIX REQUIRED in `reports/P0-008D-r2-architecture-reassessment.md`)  
**Reassessment docs tip:** `abed0e2`  
**This correction tip:** uncommitted working tree on this branch (suggest commit; do not auto-commit)  
**Authorization:** same r2; no contract revision / readiness cycle  
**Pull request:** not opened by this Build Report  

## What changed (remaining R1–R7)

| Finding | Correction |
| --- | --- |
| **R1** | Hydrate saved work via `fetchRoutine` / `fetchResponsibility`; edit same definition with `createRevision` / `createResponsibilityRevision`; “Create different work” stays separate; weekly map, take-turns cycle picker, audience groups, step obligation/reorder/remove/applicability, scheduled additions; recap resolves real titles/people/next-date after reload |
| **R2** | Retained calendar preservation; competing school save / stale-version rejection evidence (AT6) |
| **R3** | Digest includes `responsibility.scheduledAdditions`; client retains immutable pending person/work commands until resolved; changed-addition replay rejected (integration R3) |
| **R4** | Schema + store require `previewBasis` for creation; bind full reviewed 7-day routine/responsibility windows + group versions; preview generation fence; no-basis creation rejected (integration R4) |
| **R5** | Soft `loadGuide` on refresh token (force only mount/discard); suppress one soft reload after local saves; dirty draft conflict + Keep/Discard; rail step change blocked while dirty; preview/session generation fences |
| **R6** | AT1 real through-019 populate → migrate 020/021 preserves A timestamps + C departures; AT7 delete + retired replay with basis; AT11 staged 019→D progress immutability + claim preview/redeem denial |
| **R7** | AT9 dirty soft-refresh e2e; AT10 ordinary UI setup→weekly assignment→edit saved→Settings; AT12 retained; report pins `efc1f22` + this correction tip |

## Acceptance / finding evidence

| AT / Finding | Evidence | Result |
| --- | --- | --- |
| AT1 / R6 | `tests/integration/p0-008d.test.ts` AT1 + `tests/helpers/p019-fixture.ts` through-019 adopt | PASS |
| AT2 / R1 / R7 | `z-p0-008d-guided-setup.spec.ts` AT2 | PASS (exact PR/RC) |
| AT3 / R1 / R5 | AT3 Account Back / Settings / finish later | PASS (exact PR/RC) |
| AT4 / R3 | Integration AT4 rollback + R3 person/work digest recover | PASS |
| AT5 / R4 | Integration AT5/R4 group preview + R4 no-basis rejection | PASS |
| AT6 / R2 | Integration AT6 competing school save / lock | PASS |
| AT7 / R6 | Integration AT7 unused person + routine delete; retired retries denied | PASS |
| AT8 | Integration AT8 unauth + foreign cookie denial | PASS |
| AT9 / R5 | Soft load + dirty retain e2e AT9 | PASS (exact PR/RC) |
| AT10 | Ordinary UI journey AT10 (setup→weekly map→edit saved→Settings) | PASS (exact PR/RC) |
| AT11 / R6 | Integration AT11 scrub + staged 019→D progress/claim preview+redeem denial | PASS |
| AT12 / R7 | AT12 reload `/household/setup` | PASS (exact PR/RC) |
| AT13 | `docs/p0-008-release-evaluation.md` local paths | PASS (local); hosted NOT RUN |
| AT14 | Exact `validate:pr` / `validate:rc` on corrected tree | PASS |

## Verification performed

- `npx tsc --noEmit -p tsconfig.json` — PASS  
- `npx vitest run tests/integration/p0-008d.test.ts` — **13 passed**  
- Exact `npm run validate:pr` — **PASS** (EXIT 0; 329 Vitest; Chromium e2e **111** passed; Vite **6** passed). Log: `reports/_local-validate-pr-008d-r2b.log`  
- Exact `npm run validate:rc` — **PASS** (EXIT 0; 329 Vitest; Playwright **176** passed; Vite **6** passed). Log: `reports/_local-validate-rc-008d-r2b.log`  
- Hosted Railway / live DB — **NOT RUN** (out of scope; disposable local only)

## Suggested commit message (do not commit unless authorized)

```
fix(P0-008D): close remaining r2 R1–R7 saved-work, digest, preview, dirty, and evidence gaps
```

## Notes for Architecture

- Foundations retained: migration 020/021 receipts, group-union preview, calendar pin/Not now, soft-finish, PB/CI wiring.
- Correction is relative to reviewed tip `efc1f22` / reassessment `abed0e2`; pin this Build Report to the forthcoming correction commit SHA after Project Lead commit.
- Shared card **Set up and manage my household without operator help** remains **In Progress**.
