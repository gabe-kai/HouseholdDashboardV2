# Architecture second reassessment — P0-009B r2

**Reviewed:** 2026-11-08, `wall-refinements` at `a0106e5` (Engineering's correction is now committed).

**Disposition:** FIX REQUIRED against the existing revision 2. Keep the card **“Find and finish the next task on the family wall”** **In Progress**.

The earlier C1–C5 implementation corrections are substantially complete. This review narrows the remaining work to **two reproduced interaction/recovery defects and two imprecise assertions in an existing test**. Do not restart the previous review checklist or change the brief revision. Product appearance/usefulness and physical-family evaluation remain separate.

## Evidence examined

- Inspected the brief, current and historical Build Report matrices, the committed production/test delta, and the 1920×1080 and 3840×2160 six-person captures. Preserved the unrelated 37-line `PRODUCT.md` edit.
- Independently ran `npx vitest run src/domain/family-wall-projection.test.ts tests/integration/p0-009b-family-wall.test.ts`: **24 passed** (8 projection, 16 integration).
- Ran isolated Chromium probes against a separate test server on port 8806 with its own database/control store/backups under ignored `runtime/`. The two defects below reproduced. Removing an enlarged person also received a separate probe; surviving panes remained visible, so this review raises no removal/enlargement defect.
- Engineering's completed RC log records **399 unit/integration, 287 browser passes / 47 skips, and 12 Vite passes**, including the required WebKit composed journeys. Its process exit code was not captured. The current Build Report correctly distinguishes that limitation from an observed exit 0. Engineering's exact PR record reports exit 0 with **399 / 185 browser passes / one skip / 12 Vite**.
- Architecture began an independent exact `npm run validate:rc`: lint, typecheck, build and **399 tests passed**; the browser stage reached 32 passes. Architecture **stopped it after reproducing the contract defects**, because a full final gate is needed on the corrected tree. This interrupted run is neither a full PASS nor a product-test failure. An earlier sandbox attempt was stopped at browser installation; the usable run was outside the sandbox. No PR/RC gate was completed independently in this review.
- Local probe sources: `runtime/review-probes/focus.spec.ts` and `runtime/review-probes/playwright.config.ts`. Logs: `reports/_local-screenshots/p0-009b-r2/architecture-2026-11-08-{focus,return}-probe.log` and `architecture-2026-11-08-validate-rc.log`. These ignored artifacts support this review and are not part of the shipped source/archive. The reproductions below are the durable description.

## Closed work — retain these corrections

| Previous concern | Reviewed closure |
| --- | --- |
| C1: clipped next action / weak geometry | Full clipping-ancestor intersection and visible target dimensions replaced the 8-pixel allowance. AT16a resets its fixture, measures all six next instructions/targets, delivers real CDP touches, and separately exercises seven-person overflow at both targets. The submitted six-person captures now show the complete next instruction and action. |
| C2: two expanded checklists / premature pending advance | One expanded body remains; the pending recommendation is pinned through the held response. AT6a now includes following work, sibling browsing, deliberate selection, settlement and reopen. The **post-settlement interaction guard** below remains open. |
| C3: old content renewed by a pending request | Wall and preview timers now use `paneSuccessStartedRef` for displayed content. The T0 success / later hung refresh / original lease expiry tests include a fresh sibling, repeated attempts, late bodies and valid recovery. Keep that lease rule. |
| C4: preview selected-display 404 / permanent promotion withdrawal | A person 404 revalidates the selected display; selected authorization loss clears preview. Authoritative re-promotion removes withdrawal tombstones and invalidates earlier reads. Named wall/preview withdrawal and re-promotion tests exercise the transitions. |
| C5: command, privacy and lifecycle evidence | Lost-response retry uses one mutation ID plus a sibling command; replay integration counts one matching receipt/report. Offline reload checks persisted intent, no cold household payload, eventual authoritative status and queue removal. Privacy assertions inspect private/unpromoted IDs as well as titles and the exact promoted list. Reset/restore use entered hooks with an actual old authorized command and verify no new-epoch effects. Departure, source order, history/rotation preservation, touch/idle/scroll and preview non-steering evidence are materially strengthened. Only the exact-status assertions below remain from the named evidence concerns. |

## D1 — Do not retarget a focused action when pending work settles

**Contract:** behavioral clauses 7 and 9; AT6a / AT15b.

**Location:** `src/client/family-board.tsx:347–379` and the pinned `PaneStepActions` at line 480. The recommendation is retained only while an outbox item is pending. Once settlement removes the item, the same rendered button can immediately acquire a different checklist/step identity. Pointer/focus checks in `tickIdle` protect idle returns, not this recommendation change; pointer handlers are on the scroll body rather than the pinned action chrome.

**Reproduction, confirmed on the built local app:**

1. Give Jordan a one-step Morning routine and a one-step After school routine; complete unrelated work.
2. Focus Morning's Done button and press Enter, holding its status response. The pending recommendation correctly remains on Morning.
3. Release the response without moving keyboard focus. After settlement, `document.activeElement` is still the action button, but its label/step ID now identify After school.
4. Press Enter again without navigating. The After school task is committed Done. The probe printed `ARCHITECTURE_SECOND_ENTER_COMPLETED_NEW_CHECKLIST=true`.

**Required correction:** preserve the acted task's truthful settled context while moving the recommendation would repurpose a focused control or move a different action under an active pointer/gesture. Advance when that interaction is safe or through a deliberate navigation action. Keep settled Done/Reopen semantics accurate; do not fake an unfinished server state or disable intentional undo. Apply the guard to the pinned action region as well as the scroll body. Ordinary sibling updates must stay usable.

**Named regression:** strengthen existing AT6a/AT15b with a held final action and following checklist. Retain keyboard focus through settlement and assert its action identity remains the acted step; another Enter must not complete the next checklist. Exercise a held pointer on the pinned action through settlement, then release/cancel and deliberately return/advance. Assert no unintended next-step report and retain the existing sibling/one-expanded-body checks. Chromium is sufficient for the new held race under r2's browser split.

## D2 — Returning to a healthy board must reauthorize expired panes

**Contract:** behavioral clauses 1 and 10; AT1b and the independent pane recovery boundary.

**Location:** `src/client/DisplayApp.tsx:633–641` skips `blank`/`unavailable` panes unless `force` is true. The organization/detail-return effect at lines 910–913, ordinary dashboard refresh and polling all use the non-forced path.

**Reproduction, confirmed on a fresh disposable household:**

1. Load authorized ready panes with a healthy server, then switch to By work.
2. Let their content leases expire while those reads are intentionally paused. The probe used the existing pane-only controlled clock/short lease; the global session/dashboard stayed healthy.
3. Switch back to By person. The panes remain blank with Retry. Even with 500 ms healthy polling, the probe recorded **zero person-day requests after the switch**, and Jordan remained `data-phase="blank"`.

**Required correction:** a deliberate return to By person, including return from permitted detail, must initiate fresh authorization reads for the visible roster even if their prior content expired while hidden. Keep expired content blank/non-executable until a valid fresh response arrives. Preserve safe section/scroll state and sibling independence. Keep recoverable-error Retry stable; do not solve this by renewing the old lease, showing cached content, or introducing an automatic retry loop.

**Named regression:** extend AT1b with By work → lease expiry → By person on a healthy server. Observe fresh `/day` requests and ready authoritative panes without per-person Retry. Include return from deliberate detail through the same entry path. Assert saved safe browsing position is retained and an old held body cannot restore stale content. Use the existing controlled clock; a real one-minute sleep is unnecessary.

## E1 — Two exact-status assertions still need strengthening

This is the remaining narrow portion of prior C5, not a request for another broad evidence pass.

- **AT9a:** `tests/e2e/z-p0-009b-recovery.spec.ts:444–447` now correctly performs the update through a second display. However, `toContainText(/Done|completed/i)` can already match a previously completed marker. Assert the **specific remotely changed step** or an unambiguous resulting recommendation/progress transition in the original wall, with the sibling position unchanged and without a mutation from that original page.
- **AT10a:** the same file at lines 693–706 uses the same broad expression before and after releasing the old snapshot. Wait until a known newer `/day` response is applied and assert the **specific changed step's state** survives delivery of the captured old body. If it is completed, inspect its named Earlier entry if needed; an unrelated Done label is insufficient.

Use the existing tests and holds. Their fixtures and command helpers can remain. No new file, browser matrix, feature, or lifecycle redesign is required.

## Evidence reconciliation and final gate

The brief's matrix is updated from this review. Rows outside **AT1b, AT6a, AT9a, AT10a, AT15b and AT18b** have sufficient named implementation/test evidence for this review and are not reopened. PASS there does not imply the brief or Product experience is accepted.

Use the following existing evidence to replace conservative reporting gaps without inventing new acceptance conditions:

- AT3a stable ties: `src/domain/today-projection.test.ts` → `breaks ties by definitionId then occurrence id; kind never wins`, reused through `projectFamilyPane`'s direct `projectPersonalDay` call; source/order is separately asserted on both new routes.
- AT8a: combine the browser's minimal persisted queue / same-ID / cold-load / authoritative status assertions, the unchanged minimal display-outbox serializer, and AT7a's integration receipt/report count. All checks need not be duplicated in one browser journey.
- AT14a: the controlled next-day dashboard plus pending retirement and prior-date server denial are the approved seam; a real overnight test was not required.
- AT14c/AT17c: new-route deterministic reset/restore race tests establish their delta. Reuse the existing P0-008A AT10 reconnect/setup and lifecycle recovery matrix; another full browser re-enrollment matrix is unnecessary here.
- Required WebKit variants: name the actual passing composed journeys in the completed RC record instead of retaining `pending RC` labels. Retain r2's intentional skipped races/geometry split.
- AT18c: build inspection, built preview reload and `z-p0-009b-vite-deeplink.spec.ts` establish the production/proof boundary; no additional live module proof is required.

After D1/D2 and E1, run focused regressions, then the exact final-tree `npm run validate:pr` and `npm run validate:rc`, capturing **both process exit codes**. Update the current Build Report matrix and keep historical handoffs explicitly historical. A subsequent Project Lead commit is a later event, not a reason for another metadata-only review loop.

## Separate follow-up

Engineering's discovered People family-order write rejection after a departure is retained as a **separate defect**, outside B's wall-only scope. Architecture also encountered it when reusing a departed fixture; a fresh isolated fixture avoids that contamination. Do not bundle a People API redesign into this correction. The root-route investigation, live School/Meals/Calendar, and local real-data evaluation tooling remain separate.

## Engineering handoff

**FIX REQUIRED — P0-009B r2, same contract.** Retain the accepted C1–C5 corrections. Address D1 (safe post-settlement action identity), D2 (fresh reads on return to an expired board), and E1 (exact remote-status / out-of-order assertions) from this report. Reuse the reviewed inherited evidence above; do not restart the full historical review checklist. Preserve unrelated `PRODUCT.md`. Suggest a commit message without committing. No Railway, live-data, merge, or deployment operation is part of this correction. Return the corrected Build Report and focused/exact-gate results for Architecture re-review; physical/Product evaluation follows technical acceptance.
