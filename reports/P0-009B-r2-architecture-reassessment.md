# Architecture reassessment — P0-009B r2

**Disposition:** FIX REQUIRED on the same r2 contract.

**Reviewed:** 2026-10-30, `wall-refinements` at `8727cc0` plus Engineering's uncommitted correction. The unrelated uncommitted `PRODUCT.md` is not part of this review or its writeback.

**Card:** “Find and finish the next task on the family wall” remains **In Progress**. Technical acceptance and Product evaluation remain separate.

## Evidence and progress

- Inspected the r2 brief, prior R1–R6 review, corrected production and test code, Build Report, and both submitted target-viewport screenshots. The screenshots have timestamps within Engineering's reported RC run.
- Independently ran `npx vitest run src/domain/family-wall-projection.test.ts tests/integration/p0-009b-family-wall.test.ts`: **18 passed**. Engineering reports exact PR and RC gates passed on its correction tree; Architecture did not rerun those lengthy gates.
- **R3 is closed:** the server supplies `startedAt`, the board adapter uses it, and the named integration/browser assertions exercise started-then-reopened work against an earlier unstarted routine.
- R2's ordinary named-section selection and R5's By work rejection cue are improved. R4 now checks activity generation/epoch and handles preview 401/403. The remaining cases below are still required by r2 and the prior review; no new brief revision is needed.

## Remaining corrections

### C1 — R1: the 1920-pixel next action is still clipped

The submitted `reports/_local-screenshots/p0-009b-r2/1920x1080.png` shows Avery's Done control cut off by the bottom edge of the pane. The browser helper `tests/helpers/p0-009b.ts:231` treats an intersection greater than **8 px** as visible; `assertNonOverlappingHits` tests the element's un-clipped dimensions, even if much of that element is outside a clipping ancestor. AT16a checks the long-step action for Avery but does not prove all six people's next actions are fully visible and hit-testable at both targets. The capture contains eight people from accumulated fixture state; the required six-person case and separate larger-roster case must each be deterministic.

Make the whole next instruction and usable action visible without board/pane scrolling at 1920×1080 and 3840×2160. If the proposed grid does not fit, use a reasoned alternative as r2 permits. Measure the **full visible intersection** of each first-six instruction and action against every clipping ancestor and viewport; prove at least 48×48 px of each actual target is available without programmatic scrolling and that real pointer/touch hits land on the intended control. Do not accept an 8-pixel sliver or unclipped element dimensions as proof. Exercise both clean F-crowded and >6 overflow independently, wait for all relevant panes to settle, and capture the real resting state before interaction. Covers AT1a/AT2b/AT16a/b.

### C2 — R2: a pending checklist can expand alongside another checklist

`src/client/family-board.tsx` renders `expanded` (or the recommended checklist) and separately renders `pendingExpanded` whenever a different occurrence has a pending intent. Thus a pending checklist and a selected/recommended checklist can both have full step bodies expanded. The optimistic overlay in `DisplayApp.tsx` also computes `completed` immediately; when a final step is pending and there is another checklist, the pinned recommendation can advance before authoritative settlement. The current AT6a test has no second actionable checklist and checks only the pending cue and eventual disappearance.

Keep a pending final action's original checklist/recommendation and its context until settlement without expanding a second full checklist; other pending work may use a compact actionable cue. After successful settlement and safe interaction, advance only that person's recommendation. Prove a held final action with another available checklist, interleaved sibling activity, a deliberate section change, rejection, and settlement. Assert both the one-expanded invariant and no premature change of the pinned next action. Covers AT4a/b and AT6a/b.

### C3 — R4: a new request can extend old content beyond its own lease

On the wall, `loadPersonDay` overwrites `paneStartedRef` at each request; the timer in `DisplayApp.tsx:930-943` expires an in-flight pane based on that newest request's start. Preview uses the same pattern in `DisplayPreviewHost.tsx:539-546`. For example: a pane snapshot was authorized at T=0; a refresh starts at T=30 and hangs; at T=60 the rendered content is 60 seconds old but the new request is only 30 seconds old, so it remains visible/actionable. Additional in-flight attempts can extend that further. A request that has not succeeded cannot authorize older content. This contradicts D-045/D-061 and r2 §10–11. The existing test jumps the clock after the hung request starts and therefore does not test the previous successful snapshot's age.

Base the displayed snapshot's deadline on the start of the request that **successfully produced that snapshot**; a new request, poll, healthy sibling, or heartbeat must not extend it. Blank/disable only that pane at the deadline, invalidate old in-flight responses, and accept a fresh authorized response under the existing fences. Apply the same rule to preview. Prove the T=0 success / T=30 hung-refresh / T=60 expiry scenario, including repeated refresh attempts, a fresh usable sibling, a held late body, and valid retry. Covers AT10a and AT11b/c.

### C4 — R4: preview needs selected-display 404 handling and reversible withdrawal

`loadPreviewPersonDay` in `DisplayPreviewHost.tsx:295` treats every 404 as a missing person. The same route also returns 404 for a revoked/foreign selected display; an observed selected-display loss should clear the entire preview immediately. Revalidate the selected display or otherwise distinguish the two cases without revealing inaccessible data.

The preview's `withdrawnPersonalRef` adds IDs when a promoted task disappears (`:348–350`) and never removes them when that same task is legitimately made household-visible and promoted again. New person-day responses are filtered through the same set, so a later authorized promotion can remain hidden. Fence old held responses while allowing a newer authoritative re-promotion to appear. Prove both: (1) selected display revoked while a person-day response is held versus an actually missing person, and (2) promoted → private/unpromoted → re-promoted with a held old response. Preserve the separate member/display authority and no private-ID sync. Covers AT13c, AT14d, and AT19b.

### C5 — R5/R6: named evidence still does not establish several required outcomes

The Build Report retains PASS for rows where its named assertions are still incomplete. Correct the specific cases below and audit the other r2 rows against their exact fixture, action, and expected result. One test may cover multiple rows, and exact inherited tests may be reused.

- **AT6b / AT7a/b / AT8a/b:** the By work test verifies Return but does not retry and settle the rejected item. AT7a's named integration test performs one request plus a replay; it does not assert two panes, one recorded effect/receipt, or no lost follow-up. AT7b asserts an immediate UI attribute but not final server/outbox state. AT8a conditionally checks a control after reconnect, without a mandatory committed-once assertion. AT8b lacks the pending pane/reassignment outcome.
- **AT9a/b / AT11a:** the named live test uses the wall's own API context for its initial completion and invokes socket-close/reconnect without observing the socket close or demonstrating the view stayed frozen during the outage. The 5xx sibling test should assert an actual settled sibling action and unchanged sibling position.
- **AT13a/b/c / AT14a/b/d/e:** verify private/unpromoted IDs and counts as well as titles, deliberate personal detail in wall and preview, held withdrawal, and pending old intent at the named day/generation/authority changes. The new real departure test proves `/day` returns 404 for a removed person, but not a pending assigned action or reassignment to the effective owner.
- **AT14c / AT17c:** reset and restore now return 401 for a held read, but the 80 ms sleep does not prove the read entered its hold before replacement. The so-called delayed write is sent only **after** replacement with random occurrence/step IDs; it is not a valid old action held across the transition. Use a deterministic hold/entered signal, a real authorized old action started or queued before each replacement, and assert no new-epoch side effects; reuse the exact inherited lifecycle coverage where applicable.
- **AT15a/b/c / AT16b:** show active pointer and scroll gestures, pointer cancel/release, keyboard focus guard, enlarged idle return, and restored scroll/focus; prove actual non-overlapping 48-pixel visible hit areas. Current tests mainly prove pending deferral and section/focus on manual Back.
- **AT17a/b:** prove the actual revoked selected-display and departed/foreign cases for both new reads, plus before/after history and rotation/turn invariants on both reads. Current side-effect check covers reports, receipts and started markers for the wall day read only.
- **AT19a/b/c:** current preview test compares names, not target hierarchy/geometry against the native wall. Its request listener starts after preview load, checks only status/claim POSTs, and does not establish absence of display-auth/outbox attempts throughout. The pending wall action is started **after** preview navigation and is guarded by `if` statements, so the pending case can be skipped entirely. Make the pending action mandatory before preview interactions, then verify independent wall position, one committed effect and cleared cue. Compare wall and preview at both targets and after outer resize.

Update `reports/P0-009B-r2-build-report.md` with exact per-row and per-required-variant PASS/PARTIAL/NOT RUN results. Run focused tests first, then run exact final-tree `npm run validate:pr` and `npm run validate:rc` once after the correction; r2's defined Chromium/WebKit split is unchanged. Preserve Product's unrelated working-tree edit and use only disposable data.

## Next handoff

Engineering: address **C1–C5** on P0-009B r2 and return the corrected code plus named evidence for Architecture re-review. Suggest a commit message without committing. Railway and live household data remain outside this correction; Project Lead physical/Product evaluation follows a technically accepted build.
