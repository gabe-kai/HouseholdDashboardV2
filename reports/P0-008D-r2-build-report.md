# Build Report - BRIEF P0-008D r2 (FIX REQUIRED correction)

**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED — awaiting Architecture re-review  
**Branch:** `brief/p0-008d-guided-first-household-day`  
**Baseline implementation reviewed:** `b90cd7f` (Architecture FIX REQUIRED in `reports/P0-008D-r2-architecture-review.md`)  
**Disposition commit:** `68f7578` (docs FIX REQUIRED)  
**Correction tip:** uncommitted working tree on this branch (suggest commit; do not auto-commit)  
**Authorization:** same r2; no contract revision / readiness cycle  
**Pull request:** not opened by this Build Report  

## What changed (R1–R7)

| Finding | Correction |
| --- | --- |
| **R1** | GuidedSetup revisit-able rail; full work authoring (kind/daypart/recurrence/ordered steps/audience/assignment); review both kinds; Save and finish later exits without forcing finished/recap; People/sign-in links; Settings household name correction; recap lists saved work |
| **R2** | Load/preserve all calendar years + exceptions; pin `expectedVersion` at edit start; empty year dates (no invented Sep/Jun); Not now advances progress only |
| **R3** | Migration `021_guide_mutation_receipts.sql`; bound receipts (actor/household/epoch/digest/kind); distinct action kinds; authority re-check before replay; client retains mutation IDs until resolved |
| **R4** | `previewDraftRoutine` uses dated group union + eligibility + per-step applicability; client invalidates review on edit; Save checks `previewBasis` (date/calendar/participants/owner) |
| **R5** | Dirty baselines; clean-only refresh on `guideRefreshToken`; App reconnect/visibility bumps guide token; finish navigates only after success; Save and finish later refuses dirty exit |
| **R6** | `setupRequired` distinguishes mid-wizard vs adopted null timestamps; AT1 populated through-017 adopt; AT7 person+work delete + retired replay; AT11 claim scrub retained |
| **R7** | Expanded AT2/AT3 e2e; desktop rail revisit; Vite guide deeplink; Actions desktop includes `chromium-008a-desktop`; PB-61–64 + sync matrix; honest commit metadata |

## Acceptance / finding evidence

| AT / Finding | Evidence | Result |
| --- | --- | --- |
| AT1 / R6 | `tests/integration/p0-008d.test.ts` AT1 (020/021 + populated adopt without fabricated basics) | PASS |
| AT2 / R1 / R7 | `z-p0-008d-guided-setup.spec.ts` AT2 (2 adults/4 children, calendar, both work, review correction, recap→Today) | PASS (focused chromium-008a) |
| AT3 / R1 / R5 | AT3 Account Back review; Settings Finish setup; Save and finish later | PASS (focused) |
| AT4 / R3 | Integration AT4 rollback + R3 changed-payload rejection / same-command recover | PASS |
| AT5 / R4 | Integration AT5/R4 group-only preview participants; zero definitions | PASS |
| AT6 / R2 | Integration R2 Not now preserves multi-year/exceptions; school pin path | PASS (focused); lock-race PARTIAL |
| AT7 / R6 | Integration AT7 unused person + routine delete; retired retries denied | PASS |
| AT8 | Integration AT8 unauthenticated 401 | PASS; customized lifecycle-only PARTIAL |
| AT9 / R5 | Guide refresh on reconnect/visibility + dirty retain | PARTIAL (wired; no multi-manager WS e2e in tip) |
| AT10 | Ordinary full invite→backup→restore UI | NOT RUN (reuse A–C lower matrix; D path wired) |
| AT11 / R6 | Integration AT11 scrub all three claim purposes | PASS; staged restore redemption PARTIAL |
| AT12 / R7 | AT12 reload `/household/setup`; desktop rail revisit | PASS (focused) |
| AT13 | `docs/p0-008-release-evaluation.md` local paths | PASS (local); hosted NOT RUN |
| AT14 | Exact `validate:pr` / `validate:rc` on corrected tree | PASS |

## Verification performed

- `npx tsc --noEmit -p tsconfig.json` — PASS  
- `npx vitest run tests/integration/p0-008d.test.ts` — **8 passed**  
- `npx playwright test --project=chromium-008a --grep "P0-008D"` (after rebuild) — focused PASS for AT2/AT3/AT12  
- Exact `npm run validate:pr` — **PASS** (EXIT 0, ~11.7m; 324 vitest; Chromium e2e 109 passed; Vite 6 passed). Log: `reports/_local-validate-pr-008d-fix.log`  
- Exact `npm run validate:rc` — **PASS** (EXIT 0, ~19.0m; 324 vitest; Playwright 172 passed; Vite 6 passed). Log: `reports/_local-validate-rc-008d-fix.log`  
- Hosted Railway / live DB — **NOT RUN** (out of scope)

## Suggested commit message (do not commit unless authorized)

```
fix(P0-008D): close r2 Architecture R1–R7 guide/calendar/receipt/preview evidence
```

## Notes for Architecture

- Foundations retained: migration 020 columns, nested guide transactions, optional ≠ `setupRequired`, claim scrub, route/CI phone job.
- New binding table `guide_mutation_receipts` (021) rather than loosening structure receipts.
- Correction tip is uncommitted relative to `b90cd7f` / `68f7578`; pin this Build Report to the forthcoming correction commit SHA after Project Lead commit.
