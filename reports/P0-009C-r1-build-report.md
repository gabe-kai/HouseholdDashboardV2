# Build Report — P0-009C r1

**Engineering implementation for Architecture review.** Branch `brief/p0-009c-person-day-lists-recovery`, based on `b9d1221` (including Product direction `82144ce`). The separate timeline redesign and Product acceptance remain outside this slice. The unrelated `PRODUCT.md` working-tree edit is preserved.

The wall and read-only preview now offer **All my lists** from each person pane, including empty and pending-sign-in panes. The deliberate person view separates recurring work from household-visible tasks. An expanded pane exposes named occurrences without automatically fetching person detail or repeating the pinned-action toolbar. Occurrence Back returns to the person list when entered there; the next Back restores the original pane and focus. List detail has explicit loading/error/retry states. A late action response is constrained to its own occurrence; preview selected-display loss clears content. Existing display execution, authority, sync and outbox paths are reused.

## Evidence matrix

`C` = `tests/e2e/z-p0-009c-lists.spec.ts`; `B` = `tests/e2e/z-p0-009b-family-wall.spec.ts`; `P` = `tests/e2e/z-p0-009b-preview.spec.ts`; `R` = `tests/e2e/z-p0-009b-recovery.spec.ts`; `I` = `tests/integration/p0-009b-family-wall.test.ts`. These results describe observed assertions, not Architecture or Product acceptance.

| Brief assertion | Evidence and limitations | Result |
| --- | --- | --- |
| AT1 | C named day lists, pending-sign-in empty person, and error/retry; Chromium and WebKit. | PASS |
| AT2 | C creates three routines and a rotating chore, checks each person-list row occurs once with rendered authorized state, and completes one; I AT17b checks take-turns materialization. The test uses named dayparts for later work rather than a controlled clock proving future timing. | PARTIAL |
| AT3 | C opens completed and later-daypart work, checks ordered steps, Reopen and Not needed on the selected occurrences; Done is exercised through the same display path. I AT5a and AT5b/AT7a cover existing command semantics and replay. The new UI journey does not independently inspect provenance and receipts for every action. | PARTIAL |
| AT4 | C captures fictional expanded list and opened checklist at 1920×1080 and 3840×2160, checks list width, checklist bounds and font size, and verifies no automatic person-detail fetch. Screenshots are ignored local artifacts `reports/_local-screenshots/p0-009c-{expanded,checklist}-{1920,3840}.png`. Automated geometry is not physical-screen or Product judgment. | PASS (automated) |
| AT5 | C opens a person and occurrence in member preview, checks read-only navigation and no display endpoint requests in Chromium/WebKit. P AT19a/b/c checks no display outbox; I AT5a/AT19b checks no last-seen renewal. | PASS |
| AT6 | C checks no automatic detail request on enlargement. B AT13b tests deliberate unpromoted task access; P AT13a tests private/unpromoted title and ID absence; I AT13a tests authorized projection and side-effect boundaries. | PASS for named inherited assertions |
| AT7 | B wheel-browsed pane test now navigates person list and occurrence and returns, asserting both scroll positions, sibling section and origin focus. B AT15c/AT16b separately tests touch drag without completion. | PASS (combined return; separate drag evidence) |
| AT8 | C holds an action while navigating to another checklist and checks settled state and no replacement of the selected checklist. R AT7a tests same-command retry and sibling flushing; R AT8a/AT9a/AT9b tests remote/reconnect convergence. These are separate scenarios, not one combined remote-change/held-action journey. | PARTIAL |
| AT9 | C holds a person response during wall revocation, verifies session 401 and no restored board/detail; separately tests selected-preview-display loss. R AT14a/AT14b and P AT14d cover inherited day/generation and authority fences. | PASS for named scenarios |
| AT10 | Both gates exited 1 as described below; isolated reruns of those failures passed. A full PR rerun failed a different case. | NOT PASSED |

## Validation

- Focused changed-route revocation: Chromium 1 passed; the revoked session returned 401 and a held successful body could not restore household content.
- Focused scroll return and expanded/checklist geometry: Chromium 2 passed (`p0-009c-return-geometry-focused.log`).
- Focused fictional-day journey: Chromium and WebKit 2 passed (`p0-009c-day-focused.log`).
- `npm run validate:pr` exited 1: 399 unit/integration tests passed; browser selection had 195 passes, one skip and one failure. The failure was the first `chromium-009b-display` default-board case timing out waiting for setup; the log shows the document and assets loaded but no display session request. The cause is not established. The exact case passed in an isolated native-viewport rerun (`p0-009c-native-setup-rerun.log`) and in the full RC run, neither of which turns the failed gate into a pass. The failed gate log is `p0-009c-final-pr-complete.log`.
- `npm run validate:rc` exited 1: 399 unit/integration tests passed; browser selection had 305 passes, 50 skips and one failure. The failure was the older WebKit P0-006B school-calendar journey waiting for a saved date; the P0-009C WebKit journeys passed. The exact failing journey passed in isolation (`p0-009c-rc-calendar-rerun.log`), which does not turn the failed gate into a pass. The RC log is `p0-009c-final-rc.log`. Vite browser checks did not run after either failure.
- A second full `npm run validate:pr` exited 1 with 195 browser passes and one skip: a different inherited P0-008A reset/outbox case did not show `display-retired-notices` after reset. That case passed in the first PR attempt; the previously failing native-display case passed on this rerun. The cause is not established. Log: `p0-009c-pr-rerun.log`. No further full gate was run without a diagnosed correction.
- An earlier PR run was deliberately stopped after the evidence audit identified missing checklist capture and list-return scroll assertions; it is not a final gate result. Previous attempts and fixture corrections are preserved in ignored local logs.

## Scope and handoff

No Railway, live household data, push, merge or deployment. Physical display and Project Lead experience review remain separate. **Not ready for acceptance:** the gates have not passed and AT2, AT3 and AT8 remain partial as specified above. Architecture should review the implementation and evidence limits; do not infer acceptance from isolated reruns.
