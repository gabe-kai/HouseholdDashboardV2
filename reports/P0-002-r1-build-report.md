# Build Report - BRIEF P0-002 r1 (proposal-status sync fix)

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED — proposal-status live reconciliation fixed; awaiting Architecture reassessment / hosted redeploy confirmation  
**Integration branch:** `main` (working tree; uncommitted until authorized)  
**Prior deployed sync-fix commit:** `4b0d95f600640c6457f70d0bdebfaa1e18060669`  
**Evidence date:** 2026-09-09  
**Host class:** Railway HTTPS (prior AT20 host evidence retained)  
**Private origin, identities, secrets, and routine/task content:** omitted

## Defect investigated

Architecture confirmed: after the manager approved Eli’s proposal, Eli’s open session kept showing **Pending**. Navigating between pages did not update it; a full browser refresh showed **Approved**. Approval persistence and Preview composition were already correct.

## Root cause

Household WebSocket notifications already broadcast `proposal` (and `routine` on approval). The client called `refreshSupportingData` → `fetchProposals()` on those events, but that refresh was wrapped in `startTransition` together with Today refresh. Proposal status updates on the open Personalize view could remain deferred / non-urgent, so the member kept seeing Pending until a full remount. Tab navigation also did not re-fetch proposals.

Future-effective behavior was not at fault: approved additions correctly belong in Preview immediately and on Today only when the effective household date applies.

## What changed

1. **Urgent supporting-data refresh** on `proposal` / `routine` sync notifications (and on connect / visibility): proposals/memberships/tasks refresh outside `startTransition`; Today remains transition-friendly.  
2. **Supporting-data generation guard** so stale proposal fetches cannot overwrite newer decisions.  
3. **Tab re-fetch:** opening Personalize or Approvals refreshes supporting data.  
4. **Proposal status labels** render Pending / Approved / Rejected for clearer UI.  
5. **E2e:** manager approval → child’s open Personalize list shows Approved without reload; Preview includes the item; Today does not yet expose an executable checklist action for it.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate` | PASS |
| `npm run test:e2e` | PASS — **20/20** (10 Chromium + 10 WebKit) |
| Focused e2e: manager approve → open Personalize shows Approved (no reload) | PASS |
| Future-effective: Preview shows addition; Today has no Mark action yet | PASS (same e2e) |
| Hosted Railway retest of this proposal-status fix | **NOT RUN** this writeback (redeploy required) |

## Prior hosted AT20 evidence (retained)

Restart persistence, backup/restore rehearsal, Linux Argon2id on Railway Node 24.20, HTTP→HTTPS, checklist live sync, and reconnect drill remain **PASS** as recorded in the previous r1 hosted-evidence writeback (deploy tip `546b5e0` / fix `4b0d95f`). Those results are not re-executed here.

## Acceptance test results (r1 delta)

18. **Cross-device synchronization** — PASS (prior) + proposal-status live reconciliation now covered by automated dual-context e2e.  
20. **Hosted family-evaluation evidence** — PASS for prior hosted checks; **proposal-status live update on Railway** needs a redeploy of this fix and a short Architecture/PL confirm (manager approve → Eli Personalize shows Approved without reload).  
21. **Project verification** — PASS locally (`validate` + Playwright 20/20).

## Deviations from brief revision

- None. Still r1; Preview-now / Today-when-effective unchanged.

## Remaining gaps

- Redeploy this commit to Railway and confirm the hosted proposal-status path once (same scenario Architecture already reproduced).

## Suggested follow-up

Architecture reassessment of P0-002 r1 after redeploy confirmation of proposal-status sync (or accept on automated evidence + prior hosted AT20 package if Policy allows).
