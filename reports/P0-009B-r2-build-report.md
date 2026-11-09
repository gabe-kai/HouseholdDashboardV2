# Build Report - BRIEF P0-009B r2 (actionable family wall)

## 2026-11-09 Engineering correction after second reassessment

**Status:** returned for Architecture re-review; technical acceptance remains Architecture's decision. The implementation and evidence delta is uncommitted on `wall-refinements` at `a58fae2`. The unrelated `PRODUCT.md` edit remains untouched. No deployment, Railway, live-data, or Git operation was performed for this correction.

- **D1 / AT6a / AT15b:** retain the acted recommendation while its pinned action has keyboard focus or an active pointer, including after settlement; the displayed step uses the authoritative settled status and permits reopening. Release/cancel and deliberate navigation permit advancement. `z-p0-009b-recovery.spec.ts` exercises a held final action, repeated Enter, held pointer, release and deliberate return; the following step remains open. Existing AT6a retains sibling and one-expanded-body checks. Chromium covers the held race; the composed WebKit interaction journey passed in RC.
- **D2 / AT1b:** returning to By person or from detail forces fresh person-day authorization, including blank/unavailable panes, without changing the expiry lease or background retry policy. The new controlled-clock browser journey observes requests, ready panes and retained section on both return paths in Chromium and WebKit. It releases an older held body after recovery, but that fixture uses the same response content as the fresh read; this alone does not distinguish stale content visually. Existing R AT10a/11c separately verifies old-body fencing with a changed step. **AT1b is PARTIAL** for the exact combined stale-content assertion pending Architecture assessment.
- **E1 / AT9a / AT10a:** the existing recovery journeys assert the specific remote or newer step's pressed state in its Earlier entry, and the latter waits for a newer read and delivery of the held old body. The sibling selection assertion remains in AT9a.

**Checks:** build, lint and typecheck passed. Focused Chromium and WebKit checks passed, including three repeated expiry-return runs per browser. The first broader focused run had two return-fixture timing failures; the fixture was corrected and rerun. The first exact PR attempt exited 1 on the same expiry-fixture race; after correction, the final `npm run validate:pr` exited **0** (399 unit/integration, 187 browser passes / one skip, 12 Vite passes). The exact final `npm run validate:rc` exited **0** (399 unit/integration, 290 browser passes / 48 skips, 12 Vite passes). Logs are ignored local artifacts under `reports/_local-screenshots/p0-009b-r2/second-fix-*`. Only this report was updated after the gates.

**Evidence reconciliation:** Architecture's second reassessment closes all rows outside AT1b, AT6a, AT9a, AT10a, AT15b and AT18b. In particular, reuse the `today-projection.test.ts` stable-tie test for AT3a; AT7a receipt/report and offline queue evidence for AT8a; the controlled rollover seam for AT14a; P0-008A lifecycle/reconnect coverage for AT14c/AT17c; and built preview plus Vite deep-link coverage for AT18c. The RC log records the required composed WebKit journeys; intentional Chromium-only held races and native geometry remain skipped in WebKit. AT6a, AT9a, AT10a, AT15b and AT18b have passing named evidence and gates; AT1b retains the limitation stated above. The People family-order issue after departure remains a separate follow-up.

Suggested commit message: `fix(P0-009B): protect settled actions and refresh returning panes`.

## Previous correction handoff (historical)

> **2026-11-08 Engineering continuation — return for Architecture re-review, with evidence limitations below.**
> The historical correction snapshot below does not certify the current tree. The current matrix supersedes it. No commit, PR, deployment, or live-data operation was performed; the unrelated `PRODUCT.md` edit was preserved.
>
> Current uncommitted correction is based on `wall-refinements` at `bcbf4ff`. It includes pane leases based on the successful snapshot's request start; pending recommendation/timeline pinning and one expanded body; authoritative snapshots separated from optimistic overlays; same-step retry and discoverable rejection; preview selected-display revalidation; wall and preview withdrawal/re-promotion fences; scroll/focus restoration; reconnect retry; and scheduled-addition source cues. Pane header spacing and clipping assertions were tightened. Started-work priority remains intact.
>
> Focused evidence: `npm run lint`, `npm run typecheck`, `npm run build`, and `npx vitest run src/domain/family-wall-projection.test.ts tests/integration/p0-009b-family-wall.test.ts` passed (23 tests). `focused-pre-final.log` records 9 browser passes and one non-target viewport skip, including deterministic six/seven-person geometry, real touch hits, pending/rejection, departure, leases, and wheel/focus restoration. The earlier broader family-wall run had 30 passes, one skip, and one stale-clock test failure; that test was subsequently corrected and passed in `focused-final-cases.log`. These are focused checks, not the final PR/RC gates. Playwright's Windows server cleanup required running browser commands outside the sandbox because `taskkill` was denied there.
>
> **Final gate record:** on `bcbf4ff` plus the current uncommitted implementation and test delta, `npm run validate:pr` exited 0: 399 unit/integration tests, 185 browser tests (one skip), and 12 Vite checks passed (`final-validate-pr-after-rc-fix.log`). The exact `npm run validate:rc` was run on the same tree; its completed log records 399 unit/integration tests, 287 browser tests (47 skips), and 12 Vite checks passed (`final-validate-rc-rerun.log`). The session was interrupted before its process exit code was captured, so RC exit 0 is **not independently confirmed**. Logs are under `reports/_local-screenshots/p0-009b-r2/` and are ignored local artifacts. Earlier PR and RC attempts failed; their fixture, restart and cross-browser test issues were corrected and focused reruns passed before these final runs. Report-only writeback followed the runs.
>
> **Evidence disposition:** the current matrix below supersedes the earlier table. Explicit PARTIAL rows remain for assertions not established exactly; do not infer a row passed from a green suite alone.

### Current r2 evidence matrix

`U` = `src/domain/family-wall-projection.test.ts`; `I` = `tests/integration/p0-009b-family-wall.test.ts`; `B` = `tests/e2e/z-p0-009b-family-wall.spec.ts`; `R` = `tests/e2e/z-p0-009b-recovery.spec.ts`; `P` = `tests/e2e/z-p0-009b-preview.spec.ts`. PASS refers to the named assertion, not technical acceptance. References below to WebKit pending RC are conservative historical labels: the completed RC log records the selected WebKit journeys passing, but the command exit code was not captured.

| Row | Current evidence and required variants | Result |
| --- | --- | --- |
| AT1a | B default board; Chromium native six-person 1920 and 3840 targets. Required WebKit composed journey pending RC. | PARTIAL |
| AT1b | B default organization switch; B wheel-browsed position survives By work/By person. | PASS |
| AT2a | I pending-sign-in roster; B saved six-person order and completion. | PASS |
| AT2b | B deterministic six and seven people, overflow reachable at both targets. | PASS |
| AT3a | U started/reopened ordering; I scheduled-addition order/source on both routes; B started priority and composed heading. Stable-tie inherited evidence still needs explicit mapping. | PARTIAL |
| AT3b | U no-work/filtered omission/Anytime/later; B rendered filtered omission, no-work and loading/error. | PASS |
| AT3c | U optional and As needed projection; B As needed action and optional work reachable after required completion. | PASS |
| AT4a | B named sections, More, one expanded body, Back. | PASS |
| AT4b | B wheel-browsed two panes and independent scroll; WebKit composed journey pending RC. | PARTIAL |
| AT5a | I routine/responsibility Done/reopen and existing provenance; B action. WebKit pending RC. | PARTIAL |
| AT5b | I Not needed; B action. WebKit pending RC. | PARTIAL |
| AT6a | R held final action with another checklist, sibling activity, deliberate selection, one expanded body, settlement and reopen. | PASS |
| AT6b | R rejected cue in By work, return, retry and server settlement. | PASS |
| AT7a | R lost response/same mutation ID plus sibling flush; I one matching receipt/report on replay. | PASS |
| AT7b | R held old Done, newer reopen, UI/pending/server open and matching outbox item absent after settlement. | PASS |
| AT8a | R offline queue, cold reload, same mutation ID and committed status; exact persisted queue minimization/one receipt is inherited rather than observed in the browser journey. | PARTIAL |
| AT8b | I queued old command before structural revision and departure/reassignment, no old report; R pending departing owner and new owner open. | PASS |
| AT9a | R second display changes work and original converges. WebKit pending RC. | PARTIAL |
| AT9b | R observed socket close, offline remote update, reconnect and sibling section. | PASS |
| AT10a | R held old snapshot and newer read; wall and preview repeated hung refreshes use successful snapshot's lease. | PASS |
| AT10b | R held person detail cannot replace a newer selection. | PASS |
| AT11a | B 5xx, settled sibling action/server status and retained section; retry. WebKit pending RC. | PARTIAL |
| AT11b | R wall and P preview expire original successful snapshot despite repeated newer hung reads; sibling remains fresh. | PASS |
| AT11c | R/P release old bodies after expiry and permit fresh recovery. | PASS |
| AT12 | I and B unassigned persists without execution controls. | PASS |
| AT13a | I automatic wall/preview private and unpromoted IDs/titles excluded and promoted list exact; P member-owned fixture. | PASS |
| AT13b | B and P enlargement has no detail request; explicit personal detail reveals unpromoted household-visible work without private work or execution controls. | PASS |
| AT13c | R held wall person-day withdrawal and re-promotion; P held preview withdrawal/re-promotion; inherited `tests/integration/p0-007c-3b.test.ts` private-ID sync assertion. | PASS |
| AT14a | R pending old action and held body with synthetic next-day dashboard; I prior-day command rejected. A real household-clock rollover is not asserted. | PARTIAL |
| AT14b | R pending command and held body across activity clear; I stale generation rejected. | PASS |
| AT14c | I deterministic entered held read and queued real status for both reset and restore, 401 and no new-epoch report/receipt; inherited lifecycle recovery applies. Browser re-enrollment after each case not newly asserted. | PARTIAL |
| AT14d | R pending wall action and held dashboard body across revocation; P local 404 versus selected-display revoke with held body; I actual revoked routes. | PASS |
| AT14e | I queued old-owner command across departure and R pending wall action, removed pane and open reassigned work. | PASS |
| AT15a | B independent idle/interaction clocks. | PASS |
| AT15b | B pending, pointer release, touch cancellation and keyboard focus guards. | PASS |
| AT15c | B wheel position, manual/enlarged idle return and focus; WebKit pending RC. | PARTIAL |
| AT16a | B isolated six and seven-person cases at both targets; full clipping intersection, 48px next targets, real touch delivery, resting captures and composed source heading. | PASS |
| AT16b | B Chromium touch/keyboard, visible hit intersections and reduced motion; broader accessibility and physical hardware are not claimed. | PASS |
| AT17a | I anonymous/member/display, malformed/date override, actual foreign/departed person and revoked selected display. | PASS |
| AT17b | I repeated wall and preview reads, same envelope, history, rotation plan/owner, reports/receipts/started markers unchanged. | PASS |
| AT17c | I deterministic entered held read for reset and restore; inherited lifecycle operations retain installation/catalog. | PASS |
| AT18a | `package.json`, `playwright.config.ts`, CI workflow select 009B and preserve split. | PASS |
| AT18b | Exact PR exited 0; RC log records all stages passing but the interrupted session did not capture its exit code. See gate record above. | PARTIAL |
| AT18c | Built preview/proof boundary and Vite smoke have prior evidence; current final build/gates pending. | PARTIAL |
| AT19a | P native wall/fitted preview geometry at 1920 and 3840 and after host resize; WebKit pending RC. | PARTIAL |
| AT19b | P request/IndexedDB instrumentation; I and inherited P0-009A contact checks. WebKit pending RC. | PARTIAL |
| AT19c | P mandatory pending wall action before preview browsing, independent position, one status request and committed result. | PASS |

**Separate discovery for Architecture:** after a person departs, `GET /api/v1/people` excludes that person while the existing family-order write requires all membership IDs, including departed records. The disposable departure browser fixture is reset after its assertions to avoid contaminating later tests. This correction does not change the People contract.

## Previous correction handoff (historical snapshot)

**Acting as:** Engineering  
**Brief revision implemented:** 2 (FIX REQUIRED correction against the same r2 contract)  
**Engineering status:** IMPLEMENTED — returning for Architecture re-review  
**Branch:** `wall-refinements`  
**Baseline:** `main` at `14af09e` (PR #30, P0-009A r2)  
**Planning commits:** `79fbb57` (r2 brief); `db37869` (assignment/PROCEED)  
**Implementation commit:** `655970d`  
**Review that required this correction:** `8727cc0` / `reports/P0-009B-r2-architecture-review.md`  
**This handoff:** uncommitted working-tree delta on `8727cc0` (Project Lead owns Git)  
**Pull request:** not opened  
**Authorization:** Architecture ACCEPT / PROCEED for r2 (2026-10-28), then FIX REQUIRED (2026-10-29). No hosted deployment, Railway mutation, merge, or production-wall replacement.

Readiness: `reports/P0-009B-r2-engineering-readiness.md` (READY).  
Superseded r1 assignment record: `reports/P0-009B-r1-engineering-readiness.md` (preserved).  
Unrelated dirty `PRODUCT.md` was left untouched.

## What this correction changes

R1–R6 from the r2 Architecture review, in one pass.

1. **R1 layout.** Pane chrome is header + pinned current (title, `progress · next instruction`, Done plus Back / Earlier / Coming up / More on one toolbar) + scroll body. Pane touch floor is 48×48. The first six people fill a 3×2 whose rows are `1fr 1fr` of leftover board height; extra people and leftover unassigned live in capped overflow strips so they cannot crush that 3×2. AT16a waits for all six seed panes, asserts clipping/non-overlap/overflow at native 3840 then 1920, then taps the long-step Done. Settled captures: `reports/_local-screenshots/p0-009b-r2/3840x2160.png` and `1920x1080.png`.
2. **R2 timeline.** One expanded checklist per pane. Coming up / More / Earlier headings are selectable. Coming up does not auto-expand the first item. More and Back to next task remain. AT2b/AT4a/AT15c interleave Avery/Jordan and restore upcoming after enlarge/back.
3. **R3 started/in-progress.** `toFamilyPaneOccurrence` / `paneOccurrenceStartedAt` carry server `startedAt` and `state === "In progress"` through wall and preview, including after every step is reopened. Unit adapter + integration DTO + e2e AT3a (earlier unstarted vs later started-then-reopened).
4. **R4 hung expiry and preview fences.** Ready in-flight panes expire from **this request's start**, not the previous success timestamp, so a clock jump does not blank healthy siblings. Unavailable panes still expire from `failed ?? started ?? success`. Preview `/day` keeps generation/date/epoch/displayId fences; `clearContent` bumps epoch instead of resetting gens to `{}`; withdrawal filters `personDays`; preview 401/403 are global authority loss, person 404 stays local.
5. **R5 By work cues.** Independent per-person pending/rejection cues render on the overview (`family-overview-error-*` / Return). AT6b stays on By work and returns through that control.
6. **R6 evidence.** Strengthened existing B/R/P/I assertions rather than adding one file per row. Playwright family-wall clicks use real locators (no DOM `node.click()` / `{ force: true }` in 009B specs). Chromium/WebKit split unchanged.

## Files changed in this correction

- `src/client/family-board.tsx`, `src/client/styles.css` — pinned current toolbar (Done / Coming up / More), 3×2 for the first six, capped overflow/unassigned strips, 48px pane hits
- `src/client/DisplayApp.tsx` — in-flight lease uses request start; overlay keeps started/in-progress
- `src/client/DisplayPreviewHost.tsx` — epoch fence, hung expiry, withdrawal, 401/403 vs 404
- `src/client/display-presentation.tsx` — overview pane cues
- `src/client/display-api.ts`, `src/server/display.ts` — `startedAt` on day DTOs
- `src/domain/family-wall-projection.ts` (+ test) — board adapter
- `tests/helpers/p0-009b.ts`, `tests/e2e/z-p0-009b-*.spec.ts`, `tests/integration/p0-009b-family-wall.test.ts`

Unchanged on purpose: enrollment/CSRF/outbox owners, person-detail route, By work structure, proof rebuild, School/Meals/Calendar, migrations, Railway, live household data.

## Verification performed (pre-gate)

| Check | Result | Notes |
| --- | --- | --- |
| `npx vitest run src/domain/family-wall-projection.test.ts tests/integration/p0-009b-family-wall.test.ts` | **PASS** | 18 tests |
| Chromium-009b AT1a/AT2a/AT3a/AT2b/AT4a/AT5a/b/AT6a/b/AT8a/AT9a/b/AT10a/b/AT11a/b/c/AT12/AT13b/c/AT14a/b/d/AT15a/b/c/AT16b/AT19a/b/c | **PASS** | Focused reruns after the hung-lease and current-region fixes |
| Chromium-009b-display AT16a | **PASS** | Native 3840 then 1920; settled ignored screenshots rewritten |
| WebKit named subset | **NOT RUN in this pass** | r2 split still applies; recorded by `validate:rc` below |
| `npm run validate:pr` | **PASS** | Exact command on this tree |
| `npm run validate:rc` | **PASS** | Exact command on this tree; first RC attempt had one unrelated P0-007B checkbox flake, rerun exit 0 |

## Acceptance evidence matrix

| ID | Exact evidence | Result |
| --- | --- | --- |
| AT1a Default | B `AT1a/AT2a/AT4b/AT5a`: six ready panes, saved order, current next instruction + real `.click()` Done | **PASS** |
| AT1b Organizations | Same test: By work then By person restores Jordan upcoming | **PASS** |
| AT2a Identity/order | I pending Casey + B names including pending sign-in | **PASS** |
| AT2b Larger roster | B Quinn `scrollIntoViewIfNeeded`; no membership cap | **PASS** |
| AT3a Recommendation | U adapter + I DTO `startedAt` after reopen + B later-started stays next | **PASS** |
| AT3b State truth | U empty kinds + B Riley empty / upcoming labels | **PASS** |
| AT3c Optional/As needed | U + B Jordan Not needed via named heading | **PASS** |
| AT4a Full timeline | B named heading, one `family-work`, More, Back to next | **PASS** |
| AT4b Sibling isolation | B Jordan upcoming unchanged while Avery Done | **PASS** |
| AT5a Done/reopen | I routine **and** responsibility Done/reopen on existing status command + B AT1a | **PASS** |
| AT5b Not needed | I as-needed + B Jordan Not needed | **PASS** |
| AT6a Held final success | R AT6a Chromium (WebKit skipped as held-write race) | **PASS** |
| AT6b Rejection discoverability | R AT6b: cue stays while By work is open; Return control | **PASS** |
| AT7a Two panes/replay | I same-mutation replay 200 | **PASS** |
| AT7b Newer intent | R Done then reopen; old response cannot restore Done | **PASS** |
| AT8a Offline/reload | R queue Jordan Done while status aborted, cold reload has no household payload, reconnect settles once | **PASS** |
| AT8b Changed structure | I stale intendedStructure 409 after real revision | **PASS** |
| AT9a Ordinary live change | R remote completeDisplayStep converges; Jordan upcoming kept | **PASS** |
| AT9b Missed sync | R `__HD_DISPLAY_CLOSE_SYNC__`, remote create during outage, reconnect without reload | **PASS** |
| AT10a Out-of-order / hung | R hung `/day` blanks only Avery; Jordan stays ready and can Done; old snapshot cannot paint | **PASS** |
| AT10b Lost selection | R held person-detail cannot replace Jordan | **PASS** |
| AT11a Partial failure | B sibling Done with captured testid during Avery 5xx | **PASS** |
| AT11b Independent stale lease | R Avery blanks; Jordan stays ready | **PASS** |
| AT11c Late stale reply | R late 200 after NOW_MS stays blank | **PASS** |
| AT12 Unassigned | I + B Needs an owner remains after assigned work is completed; no checkbox/Claim | **PASS** |
| AT13a Automatic privacy | I private/unpromoted titles absent; promoted present; P preview payload | **PASS** |
| AT13b Deliberate detail | B enlarge does not fetch person-detail; explicit personal does | **PASS** |
| AT13c Withdrawal | I + R promoted title disappears and does not resurrect | **PASS** |
| AT14a Day boundary | I prior-day householdDate 400; R Chromium held body cannot return (WebKit skipped) | **PASS** |
| AT14b Activity generation | I rematerialize + stale gen 400; R poisoned old-gen body cannot paint | **PASS** |
| AT14c Installation replacement | I reset **and** restore: held `/day` has begun (80ms), reset/restore < 10s, held 401, delayed write 401 | **PASS** |
| AT14d Authority loss | I revoke 401 + R board clears | **PASS** |
| AT14e Departure | I created Pat, removed, wall+preview `/day` 404 | **PASS** |
| AT15a Local idle | B Avery returns; Jordan stays | **PASS** |
| AT15b Movement guards | B pending defers idle | **PASS** |
| AT15c Enlarge/return | B upcoming preserved on enlarge/back; keyboard Done on current via `press("Enter")` | **PASS** |
| AT16a Crowded target | B chromium-009b-display 3840 then 1920; six ready panes; 2/5; long step visible in clipping ancestors; More; overflow < 8; real click after screenshots | **PASS** |
| AT16b Input/a11y | B CDP touch does not complete; keyboard act; ≥48px non-overlapping hits; reduced motion | **PASS** |
| AT17a New route authority | I 401/403/400/foreign 404; preview `?date=` 400; **real departed Pat** 404 wall+preview | **PASS** |
| AT17b Projection/side effects | I two `/day` reads; step_reports, display_command_receipts, and started_at locks unchanged (today may materialize) | **PASS** |
| AT17c Replacement barrier | I held `/day` 401 after reset; delayed write 401; lock released | **PASS** |
| AT18a Selection | `test:e2e:family-wall`; isolated 009B DBs; phone-core grep-invert; Actions `e2e-family-wall-009b` | **PASS** |
| AT18b Final gates | Exact `validate:pr` / `validate:rc` on this tree | **PASS** |
| AT18c Shipped boundary | dist has no proof HTML; P reloads preview; Vite deeplink inherited | **PASS** (Vite deeplink on the gate run) |
| AT19a Preview parity | P wall names vs fitted 1920/3840 and outer resize | **PASS** |
| AT19b Preview authority isolation | I last_seen unchanged; P no status/claim posts | **PASS** |
| AT19c Preview does not steer wall | P wall upcoming stays while preview enlarges; wall pending independent | **PASS** |

## Deviations from brief revision

- AT14a Playwright date-mutate still uses a synthetic next-day dashboard plus a held person-day body (same seam as P0-007C-3A). Integration fences prior-day `householdDate` on the existing status command.
- WebKit skips AT6a, AT6b/AT7b, and AT14a (held-write/held-read races) and AT16a (native 3840/1920). Required WebKit composed journeys are AT1a, AT4b, AT5a/b, AT9a, AT11a, AT15c, AT19a/b.
- Local `chromium-009b` is 1280 by default; family-wall `beforeEach` uses 1920×1080 except AT16a, which keeps the native 3840 project viewport.
- `activity_reset` display invalidation remains `work` rather than `reset`.
- Automatic `/day` loads stay serialized at concurrency 2.
- AT16a tap-proof completes the long step after screenshots so the ignored images stay settled.

## Discoveries for Architecture

- D-061 implications still say P0-009B r2 is awaiting readiness / not implemented.
- Expiring a ready in-flight pane from the **previous success** timestamp blanks healthy siblings when tests jump `NOW_MS`. Request-start of the current in-flight read is the lease that matches D-045 and AT10a.

## Known limitations

- 3×2 and 90s idle remain provisional pending the Product before-school checkpoint.
- Physical multi-touch and 10/16-foot readability are not claimed.
- Leftover extras on the isolated 009B e2e DBs render in a capped overflow strip under the first 3×2 rather than shrinking Avery’s pane. AT16a stamps titles and completes non-kept occurrences for the six seed people so the resting next action is 2/5 of the long step-three morning.
- Engineering did not commit, open a PR, deploy, or touch live data / Railway.

## Final-tree gates

Exact commands on this working tree (after the correction). Logs are gitignored.

| Check | Result | Notes |
| --- | --- | --- |
| `npm run validate:pr` | **PASS** (exit 0) | lint + typecheck; Vitest **393 passed / 53 files**; Chromium Playwright **170 passed**; Vite **12 passed** (~14.2m + 24.5s). Log: `reports/_local-screenshots/validate-pr.log` |
| `npm run validate:rc` | **PASS** (exit 0) | Vitest **393**; Playwright **263 passed / 46 skipped** (r2 Chromium/WebKit split); Vite **12 passed** (~23.0m + 24.7s). One earlier RC attempt failed on unrelated P0-007B `locator.check` flake; isolated rerun and this exact `validate:rc` passed. Log: `reports/_local-screenshots/validate-rc.log` |

## Suggested follow-up

- Architecture re-review / technical acceptance of this correction.
- Project Lead commit using the suggested message below. Do not include `PRODUCT.md`.
- Product before-school checkpoint after an authorized deploy.

## Suggested commit message

```
fix(P0-009B): show next actions and close r2 review gaps

Pin the current instruction, Done, and section controls in pane chrome,
keep leftover people out of the first 3×2, expire hung ready panes from
the in-flight request start, and assert the r2 transitions Architecture
flagged instead of relying on suite labels.
```
