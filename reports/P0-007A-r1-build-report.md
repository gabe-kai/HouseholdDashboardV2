# Build Report - BRIEF P0-007A r1

**Brief revision implemented:** 1  
**Engineering status:** FIX REQUIRED closed (local; pending Architecture re-acceptance)  
**Branch:** `brief/p0-007a-household-responsibility-foundation`  
**Base:** Architecture ACCEPT/PROCEED `a6890cc`; integrated main parent `409d147`  
**Reviewed implementation (Architecture FIX REQUIRED):** `9827d28`  
**Corrections (this pass):** uncommitted on the same branch after Architecture review `b60f97b`  
**Pull request:** N/A  

## Readiness

**READY** against r1 (`reports/P0-007A-r1-engineering-readiness.md` @ `7226987`). Architecture **ACCEPT / PROCEED** (`a6890cc`). Contract unchanged; **no new readiness round**. Architecture acceptance review disposition **FIX REQUIRED** (`reports/P0-007A-r1-architecture-review.md` @ `b60f97b`). Card **Give Cats and Trash one owner and a place in Today** remains **In Progress**.

## Architecture FIX REQUIRED close (R1–R5)

| Finding | Close |
| --- | --- |
| **R1** receipt binding + in-tx validation | `mutation_receipts` columns + digest bind household/occurrence/step/actor/kind/status/generation; mismatch conflicts without foreign payload; validation inside `db.transaction` in `setStepStatus`. Regressions: `p0-007a.test.ts` **R1**. |
| **R2** kind/reference integrity + unsupported inputs | Forward migration `012_responsibility_integrity.sql` (triggers for kind/household/revision consistency + responsibility/date uniqueness despite spoofed kind). `CreateResponsibility*Schema` `.strict()` rejects `assigneeGroupIds` / unsupported fields. Regressions: **R2**, schema cases, upgrade through 012. |
| **R3** draft version pin | `Responsibilities.tsx` `draftBaselineVersion` set at `beginDraft`; Save uses pinned baseline, not live `detail.version`. Live refresh preserves dirty draft. UI: `z-p0-007a-fix-required.spec.ts` **R3**. |
| **R4** recovery + late-response arbitration | WS reconnect + `visibilitychange` bump `routineRefreshToken` and `historyRefreshToken`. History summary/detail fence on filter identity + activity generation. Detail/preview fetch generations retained; dirty draft not retargeted. UI: fix-required **AT12/13**. |
| **R5** honest AT evidence | Targeted regressions added; AT table below uses **PASS / PARTIAL / NOT RUN** with named tests. Prior brief screenshots redirected to `test-results/runtime-screenshots/` so gate runs do not overwrite `reports/p0-006*` / `reports/p0-005*`. |

## What changed (corrections on top of `9827d28`)

### Migration / schemas
- `db/migrations/012_responsibility_integrity.sql` (forward after 011).
- Responsibility create/revise schemas `.strict()`; group fields rejected rather than stripped.

### Server
- `setStepStatus`: bound receipt replay; serialized validation/write; injected rollback hook retained for AT6.

### Client
- Draft baseline pin; Plan/History refresh on reconnect/visibility; History response arbitration.

### Tests / evidence hygiene
- Expanded `tests/integration/p0-007a.test.ts` (R1/R2, AT1 upgrade through 012, AT2b, AT6 matrix, AT7, AT9b, AT10b, AT11b).
- New `tests/e2e/z-p0-007a-fix-required.spec.ts` (R3, AT5/8 UI, AT12/13, AT14).
- Strengthened cats-trash (live Household completion; Tuesday Trash preview).
- Authenticated geometry + extra screenshots `06`–`12`.
- Prior-brief e2e screenshot dirs → `test-results/runtime-screenshots/...`.
- Migration inventory counts expect **12** migrations where applicable.

## Verification performed

| Check | Result |
| --- | --- |
| Unit / integration | **PASS** — **165** tests / **27** files |
| `npm run validate:pr` | **PASS** — Chromium e2e **42/42** + Vite **2/2** (`reports/p0-007a-r1-validate-pr.log`) |
| `npm run validate:rc` | **PASS** — Chromium+WebKit **68/68** + Vite **2/2** (`reports/p0-007a-r1-validate-rc.log`) |
| Prior `p0-005` / `p0-006a` / `p0-006b` / `p0-006c` screenshots | **PASS** — SHA-256 unchanged through gates (25 files; runtime capture dirs for prior briefs) |
| Current-brief screenshots | `reports/p0-007a-r1-screenshots/` `01`–`12` (refreshed by this gate run) |
| Deployment | **NOT RUN** (not required) |

## Acceptance tests (AT1–16)

Honest mapping after R1–R5. **PARTIAL** means named contract edges remain outside the cited assertions.

| AT | Result | Evidence |
| --- | --- | --- |
| 1 Populated upgrade | **PASS** | `p0-007a.test.ts` **AT1**: populated 010 → 011+012; grants once; restart; post-upgrade create; backup/isolated restore; reset receipt + generation-floor retained; idempotent re-migrate. **AT1b** preset grants. |
| 2 Cardinality and assignment | **PASS** | **AT2** one-per-date + same-ID reassign; **AT2b** concurrent materialize, routine fan-out, pending assignee; **R2** spoofed kind/revision rejected; schemas reject groups. |
| 3 Cats normal UI | **PASS** | `z-p0-007a-cats-trash.spec.ts`: create Cats, child complete, manager already on Household activity sees live Complete, History kind filter. Screenshots `01`/`03`/`04`/`05`. |
| 4 Trash normal UI | **PARTIAL** | Same journey creates Tuesday/Evening Trash; Next 7 days preview asserts Avery + Tuesday date. Child does **not** execute Trash on a controlled Tuesday; DST/travel/household-boundary ordering not asserted. Screenshot `02`. |
| 5 Current/future management | **PASS** | `z-p0-007a-fix-required.spec.ts` **AT5/8**: Schedule later, Edit upcoming, collision retains draft; integration revise/preview paths remain. Screenshot `07`. |
| 6 Locks and races | **PASS** | **AT6** bidirectional Complete vs edit/reassign/End/Delete; Not needed; undo; injected rollback; **R1** mismatched replay. |
| 7 Durable immediate execution | **PARTIAL** | Cats checklist e2e + `z-p0-007a-reset-outbox`; **AT7** generation mismatch + pending first-action vs reassignment. Rapid multi-tap / delayed out-of-order UI response matrix not fully enumerated in UI. |
| 8 Delete/End | **PASS** | Integration **AT8** + fix-required UI Delete unused and End with started history. |
| 9 Permission/type matrix | **PASS** | **AT9** HTTP matrix; **AT9b** routine-only vs responsibility-only managers, Origin/CSRF, History isolation; cross-kind route rejection. |
| 10 Unified stored History | **PASS** | **AT10** side-effect-free + kind filter; **AT10b** counts unchanged, rename snapshot, future rejected; e2e responsibility filter. |
| 11 Reset scope and retention | **PASS** | **AT11** ack/legacy rejection; **AT11b** cancel semantics, dual-kind clear, rollback, disabled/no-grant/foreign gates; Settings confirmation screenshot `08`. |
| 12 Reset/offline recovery | **PARTIAL** | `z-p0-007a-reset-outbox` mixed pending → clear → rematerialize; fix-required miss-WS then visibility refreshes Plan detail + History empty after clear. Deliberate hold/release of a stale History HTTP body after clear is fenced in code; not separately browser-held. |
| 13 Live management and recovery | **PASS** | **R3** dirty draft conflict UI (`06`); cats-trash live reassign-style Household update; fix-required WS-down rename → visibility recovery without navigate-away. |
| 14 Authoring/accessibility/layout | **PASS** | Fix-required **AT14** Work Move-menu Save + reload; geometry 360/1280 authenticated (`09`/`10`); `z-p0-007a-geometry.spec.ts` Plan/History (`11`/`12`). 200% text relies on shared 006A geometry evidence, not a new responsibility-only assertion. |
| 15 Saved destinations | **PARTIAL** | Responsibility detail URL + Vite deeplink **PASS** (`z-p0-007a-vite-deeplink.spec.ts` in PR/RC). Built production shell, signed-out, and denied-identity responsibility routes not separately re-proven beyond shared auth gates. |
| 16 References and regression | **PASS** | Fixture/cleanup performer paths; PB-40–42; route-policy; validate:pr/rc; prior screenshot dirs unchanged (runtime redirect). |

## Migration / design choices

- Occurrence uniqueness: partial indexes by `kind` (011) plus **012** triggers closing spoofed-kind bypass and revision/definition consistency.
- Checklist receipts: bind columns + payload digest; exact replay once; mismatch conflicts.
- Clear: UI acknowledges `routines_and_responsibilities`; legacy API without ack rejected when responsibility data exists.
- Editor: Save expectedVersion is the draft baseline, never a live refresh retarget.

## Known limitations (not blockers for this correction pass)

- Hosted / physical phone certification: out of scope.
- AT4/7/12/15 edges called **PARTIAL** above; Architecture may still require further evidence on those named gaps.
- Fuller Next/Later Today hierarchy remains C; pattern assignment remains B.

## Suggested commit message (do not commit)

```
P0-007A: close r1 Architecture FIX REQUIRED (R1–R5)

Bind checklist receipts, add 012 integrity, pin draft versions,
recover Plan/History on reconnect/visibility, and record honest AT evidence.
```
