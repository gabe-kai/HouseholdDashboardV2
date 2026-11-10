# Architecture focused re-review — P0-009B r2

**Reviewed:** 2026-11-09, `wall-refinements` at `48be12631cd72d57869012e77828c4c82b9b6928`.

**Disposition:** FIX REQUIRED, limited to the new D3 regression below. **D1, D2 and E1 are closed.** Earlier C1–C5 closures remain valid; do not restart those checklists. Brief revision 2 and its behavioral contract are unchanged.

**Card:** “Find and finish the next task on the family wall” stays **In Progress**. Product/physical acceptance and integration remain separate.

## Completed corrections

| Item | Reviewed evidence and conclusion |
| --- | --- |
| D1 / AT6a | Focused action identity now remains on the acted step through settlement, with truthful Done/Reopen state. The held-write test verifies repeated Enter does not complete the following task, pointer protection, release and deliberate return. This closes the original accidental-next-task defect; the obsolete-identity cleanup introduced by this guard is D3. |
| D2 / AT1b | The organization/detail-return effect forces the existing person-day loader to reauthorize expired/unavailable panes. Chromium and WebKit demonstrate requests, readiness and retained section after returning from By work and from detail. The successful-snapshot lease is unchanged. |
| AT1b combined stale-body limitation | Architecture independently held a response with a unique stale instruction marker, expired the pane while By work was open, returned, accepted a fresh read, then delivered the distinguishable old body. The stale marker never painted; the pane remained ready with the current instruction. **PASS**. No duplicate Engineering fixture is required. |
| E1 / AT9a | The second display changes a known step; the original wall inspects the matching Earlier occurrence and asserts that specific step's pressed state. Sibling section remains unchanged. |
| E1 / AT10a | The test waits for a newer person-day response, verifies the specific changed step, releases/observes the old body and verifies the same step remains Done. |
| AT18b | Engineering records both exact final PR/RC process exits as 0. Completed logs contain the named corrected journeys and reported counts. An aggregate green suite does not detect D3 because the existing clear test does not assert fresh next-action recovery. |

## D3 — Clear a pin whose occurrence/step is no longer in the authorized pane

**Existing contract:** behavioral clauses 9 and 11 (lifecycle/withdrawal takes precedence over retained reading state; current authorized context must recover), AT14b and the interaction-state boundary in AT15b. This is a regression introduced by the D1 correction, not a new Product requirement or a new lifecycle feature.

**Location:** `src/client/family-board.tsx:347–388`. `actionFocused` / `actionPointerHeld` and `lastNextRef` can outlive the action element or occurrence they describe. The pin is selected from those flags without confirming its occurrence and step still belong to the current authorized snapshot. Removing a focused React subtree need not emit the blur event that clears the stored flag.

**Deterministic reproduction on the built app, using disposable data:**

1. Create a one-step assigned routine for Jordan; load a ready wall pane and focus its Done button. Record its step/control ID.
2. From the separate authorized manager request context, call the existing activity-clear endpoint with the current activity generation. No reset/restore or live household is used.
3. Wait for the wall's `/day` response with a **strictly newer activity generation**, removal of the old action ID, and `data-phase="ready"`.
4. The server has one current occurrence, but `family-next-Jordan` and the next action are absent. The probe logged `{"phase":"ready","nextCount":0,"currentServerOccurrences":1,"focus":null}`. The pane is still pinned to an occurrence that no longer exists, even though no DOM control has focus. Clicking **Back to next task** also leaves both next-instruction and action counts at zero.

The first diagnostic attempt inspected the UI before the newer response; that timing attempt is not evidence. The reproduction above uses an explicit generation-response barrier and is the confirmed result.

**Required correction:** scope retained interaction state to an action identity that still exists in the current authorized context. When the focused/pointer action is unmounted, withdrawn, or replaced by a lifecycle/generation/structure boundary, retire its obsolete pin and interaction flags before selecting the fresh recommendation. Retain D1's protection when the same valid action still has actual focus or an active gesture. Do not retarget old commands, carry old content through the clear, fake an unfinished status, or reset unaffected siblings' browsing.

**One named regression is sufficient:** extend the existing AT14b/D1 evidence with focus on the old pinned action, a real activity clear, an explicit newer-generation response, and the new ready next instruction/action. Assert the old action is gone, the replacement is for the current occurrence, and it can perform an authorized new command. Exercise cancellation/release through the same identity-retirement path if needed; keep the already passing same-step keyboard/pointer settlement checks. Do not add another reset/restore or browser matrix. Chromium establishes this new deterministic interaction case under r2's existing split.

Local diagnostic: `runtime/review-probes/return-fence.spec.ts` → `Architecture acceptance: activity clear releases a removed focused action`. Log: `reports/_local-screenshots/p0-009b-r2/architecture-2026-11-09-focus-generation.log`. These ignored review artifacts are available locally; the procedure above is the durable reproduction. No production code was changed by Architecture.

## Verification

| Owner | Check | Result |
| --- | --- | --- |
| Architecture | `npm run build` at `48be126` | PASS, exit 0 |
| Architecture | Focused Chromium/WebKit return, settled action identity, live/offline/reconnect and stale/out-of-order/lost-detail tests | **7 passed / 1 intentional WebKit held-write skip**, exit 0 |
| Architecture | Distinguishable old-body expiry-return probe | **1 passed**, exit 0; closes the report's remaining AT1b limitation |
| Architecture | Focused action across activity clear, with a newer-generation barrier | **FAIL**: ready server-backed pane has no next action |
| Engineering | Exact `npm run validate:pr`, corrected handoff tree | Recorded exit 0: **399 unit/integration; 187 browser passes / 1 skip; 12 Vite** |
| Engineering | Exact `npm run validate:rc`, same tree | Recorded exit 0: **399 unit/integration; 290 browser passes / 48 skips; 12 Vite** |

Architecture inspected `second-fix-validate-pr-rerun.log` and `second-fix-validate-rc.log` under ignored `reports/_local-screenshots/p0-009b-r2/`. Its independent logs are `architecture-2026-11-09-build.log`, `architecture-2026-11-09-focused.log` and `architecture-2026-11-09-return-fence.log`. Full PR/RC gates were not independently repeated. Required WebKit composed journeys remain covered; no new skip requirement is introduced.

Engineering's handoff accurately described an uncommitted correction on `a58fae2`; the Project Lead subsequently committed it as `48be126`. Do not request a metadata-only revision for that chronology or alter historical handoffs.

## Next owner

**Engineering: FIX REQUIRED — P0-009B r2, D3 only.** Retire obsolete focus/pointer/recommendation pins when the current authorized occurrence/action is replaced. Add the one named generation-clear recovery assertion, retain D1/D2/E1 and earlier accepted corrections, run focused checks then the exact final-tree PR/RC gates and record their exits. Preserve unrelated `PRODUCT.md`; suggest a commit message without committing. Return for Architecture re-review. No Railway, live-data, deployment, merge or Product redesign is part of this correction.

Once D3 is closed, the next step remains required CI/integration and Project Lead hands-on family-wall evaluation. Appearance/readability/physical multi-touch, the People family-order-after-departure defect, the root route, local real-data testing tooling and live School/Meals/Calendar remain separate.
