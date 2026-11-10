# Architecture acceptance — P0-009B r2

**Disposition:** ACCEPTED (technical), 2026-11-09.

**Reviewed implementation:** `436d852ed292d0e167ca56db4b2f556cfaa7c716` on `wall-refinements`. Integrated `main` remains `14af09e` until the Project Lead integrates this branch.

**Authoritative brief:** `briefs/P0-009B-actionable-family-wall.md`, revision 2. The contract and revision are unchanged.

**Card:** “Find and finish the next task on the family wall” → **Ready to Evaluate**. Technical acceptance does not claim Product approval, physical multi-touch/readability, a hosted retest or a deployment.

## D3 is closed

The retained occurrence **and step** must now exist in the current authorized pane before they can pin its recommendation. When that identity becomes obsolete, the pin is excluded immediately and the stored focus/pointer flags are retired. The existing pending/focus/pointer protection still applies to a valid action.

The new tracked regression, `AT14b/AT15b: activity clear retires a focused action and restores a usable next action`, establishes the requested transition:

- Focus the old action; keep a sibling on Coming up.
- Perform real activity clear through the authorized manager context.
- Wait for a person-day response with a strictly newer activity generation and a ready pane; assert the old control is gone.
- Identify the actual current recommendation from the fresh authorized day. Assert its occurrence differs from the retired one, complete its exact step through the wall, and verify the authoritative status is completed.
- Verify the sibling's section remains unchanged.

The test correctly permits previously completed routines to become eligible again after clear. It selects the actual current recommendation rather than assuming the originally created routine must rank first.

Architecture also reran its original isolated failing D3 reproduction without weakening its assertions. It now reports `{"phase":"ready","nextCount":1,"currentServerOccurrences":1,"focus":null}` and, after Back to next task, `{"nextCount":1,"actionCount":1}`. The replacement action is visible with a different step ID. **PASS**.

## Evidence and verification

| Owner | Check | Result |
| --- | --- | --- |
| Architecture | `npm run build` at reviewed implementation | PASS, exit 0 |
| Architecture | Focused Chromium: existing pending-final-action test; D1 held keyboard/pointer settlement test; new D3 clear/recovery test | **3 passed**, exit 0 |
| Architecture | Original D3 reproduction on a separate disposable local household | **1 passed**, exit 0 |
| Engineering | Exact final-tree `npm run validate:pr` | Recorded exit **0**: **399 unit/integration; 188 browser passes / 1 skip; 12 Vite passes** |
| Engineering | Exact final-tree `npm run validate:rc` | Recorded exit **0**: **399 unit/integration; 291 browser passes / 49 skips; 12 Vite passes** |

Architecture inspected the code/test delta, current Build Report, and completed `third-fix-validate-pr.log` / `third-fix-validate-rc.log`. Their counts and selected D1/D3 results agree with the handoff. The additional RC skip is the deliberately Chromium-only generation interaction test, consistent with r2's existing held-race browser boundary. Existing required WebKit composed journeys remain selected.

Independent logs are ignored local artifacts under `reports/_local-screenshots/p0-009b-r2/`: `architecture-d3-build.log`, `architecture-d3-focused.log`, and `architecture-d3-original-reproduction.log`. Original diagnostic source: `runtime/review-probes/return-fence.spec.ts`. All independent tests used disposable local database/control/backup paths. Architecture did not independently repeat the full exact PR/RC gates; Engineering's final recorded results plus the focused checks are sufficient for this correction.

D1, D2, E1 and C1–C5 remain closed by the preceding reviews and their named evidence. The earlier AT1b reporting limitation was independently closed with a distinguishable stale-response probe. All **47** required brief subrows now have sufficient reviewed evidence. No remaining material violation of P0-009B r2 was identified. This acceptance supersedes the earlier FIX REQUIRED dispositions; those reports remain historical evidence.

The implementation is already committed as `436d852`. Earlier handoff notes about uncommitted work describe their earlier point in time; no metadata-only Engineering handoff is needed. Architecture changed only its documentation and preserved the separate uncommitted `PRODUCT.md` edit.

## Next owner

**Project Lead:** publish/open or update the PR, wait for the required **Pull-request validation** check to pass, then merge. Handle the separate Product edit deliberately. Architecture's technical acceptance clears the brief for integration; it does not perform or authorize an unattended live-data operation.

Evaluate the deployed wall with the existing household and enrolled screen. This brief calls for no reset, restore or re-enrollment. Confirm ordinary sign-in/display continuity, then use a real family session to judge six-person next-task discovery/completion, sibling reading positions, Earlier/Coming up, deliberate enlargement/return and pending/retry clarity. Record actual CSS viewport/zoom when known and physical readability/touch observations before Product acceptance.

Use that evaluation to select the next bounded presentation/refinement slice from Product's preserved direction. The People family-order-after-departure defect, local real-data testing tooling, root-route investigation, assignment coverage, and live School/Meals/Calendar remain separate work.
