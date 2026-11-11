# Architecture review — P0-009C r1

**Date:** 2026-11-10
**Role:** Architecture
**Reviewed implementation:** `3611a31` on `brief/p0-009c-person-day-lists-recovery`.
**Disposition:** FIX REQUIRED — evidence closure under the unchanged r1 contract.

Engineering correctly reported an incomplete handoff rather than claiming acceptance. The person/list/detail bridge, retained overview subtree, explicit Retry, read-only preview adapter, and expanded list presentation are a bounded implementation of the requested recovery. No server, schema or production-data change is included. Unrelated Product edits remain untouched.

## Consolidated evidence assessment

- **AT1, AT4–AT7, AT9:** retain the named evidence accepted for this review. Architecture inspected the changed navigation/authority paths, the new C journey and inherited return test, and the 1920 expanded/checklist captures. Physical usability and Product acceptance are separate; screenshots do not accept the final timeline design.
- **AT2:** sufficient scope evidence. Three named routines plus a take-turns chore, unique person-list rows, completed state and later dayparts satisfy this current-day navigation slice. A controlled clock proving future timing is not an additional requirement; later means current-day later work.
- **AT3:** sufficient combined evidence. The new C UI journey inspects ordered steps and selected-occurrence Done/Reopen/Not needed. Reuse `p0-009b-family-wall.test.ts` AT5a and AT5b/AT7a for shared command/replay and `p0-007c-3a.test.ts` populated-upgrade actor/receipt assertions for display provenance. The brief does not require every UI action to independently query storage. Add that exact provenance citation to the Build Report; no duplicate tests are requested.
- **AT8:** incomplete changed-route evidence. The held-action test verifies the old response does not replace the second checklist, but does not assert the original pending cue remains reachable or that the queue settles without duplicate application. The reused remote/reconnect scenario covers the board rather than explicitly demonstrating live person-list/detail convergence after this navigation change. Separate named tests and inherited exact assertions may be combined; a single large scenario is not required.
- **AT10:** not passed. Exact PR/RC failures remain failures despite isolated passes. Their causes are unknown; do not label them harmless flakes or infer a product regression from them without investigation. Vite selection still needs to execute.

## Required closure (same r1)

1. **AT8:** strengthen the existing held-action journey to demonstrate an understandable reachable pending indication for the original work during list/detail navigation, then settlement with the original result, no lingering pending item and no replacement of the second selection. Existing exact receipt/idempotency tests may establish single application; name them. Prove a remote authorized change updates an open person list or checklist without reload through the new route, with selection and sibling position preserved. Reuse existing stale-response evidence where it establishes the exact invariant. Fix implementation only where these assertions reveal a defect.
2. **AT10:** investigate the failed native setup, 008A reset/outbox notice, and WebKit school-calendar cases using the existing failure artifacts. Apply only justified, bounded product/test corrections; preserve the protected assertions and do not add blanket retries, skips, or timeout increases to obtain green. Once focused checks pass, run exact `npm run validate:pr` and `npm run validate:rc` through their Vite stages on the final tree. Report any continuing diagnosed blocker with its evidence instead of repeated undiagnosed full-suite retries.
3. **Build Report:** record the accepted evidence interpretation for AT2/AT3, the named AT8 closure and exact gate outcomes, including remaining skips and tested commit/tree. No brief revision or fresh readiness review is required.

Architecture independently ran `npm.cmd test -- --run tests/integration/p0-007c-3a.test.ts tests/integration/p0-009b-family-wall.test.ts`: **26/26 PASS**, exit 0. Full gates and new browser checks were not rerun by Architecture; Engineering's reported failures remain the gate state.

**Next owner:** Engineering. Card **Find all my lists on the family wall** remains **In Progress**. No merge, publish, deploy, household reset, rollback or re-enrollment is authorized. The larger timeline proof remains separate.
