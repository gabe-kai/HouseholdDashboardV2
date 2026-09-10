# Build Report - BRIEF P0-002 r1 (proposal-status sync fix)

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED — proposal-status live reconciliation fixed; **local multi-device confirmation PASS**; hosted proposal-status path still needs redeploy confirmation (prior Railway conflict treated as deployment/state evidence, not a current-source defect)  
**Integration branch:** `main`  
**Source tip for this writeback:** `024c494` (LAN/local hardening) atop `756b742` (proposal-status sync)  
**Prior deployed sync-fix commit:** `4b0d95f600640c6457f70d0bdebfaa1e18060669`  
**Evidence date:** 2026-09-09  
**Host class:** Local loopback + trusted LAN (`npm run dev` / `dev:lan`); Railway HTTPS retained for prior AT20 package only  
**Private origin, identities, secrets, and routine/task content:** omitted

## Defect investigated

Architecture confirmed (earlier): after the manager approved Eli’s proposal, Eli’s open session kept showing **Pending**. Navigating between pages did not update it; a full browser refresh showed **Approved**. Approval persistence and Preview composition were already correct.

## Root cause

Household WebSocket notifications already broadcast `proposal` (and `routine` on approval). The client called `refreshSupportingData` → `fetchProposals()` on those events, but that refresh was wrapped in `startTransition` together with Today refresh. Proposal status updates on the open Personalize view could remain deferred / non-urgent, so the member kept seeing Pending until a full remount. Tab navigation also did not re-fetch proposals.

Future-effective behavior was not at fault: approved additions correctly belong in Preview immediately and on Today only when the effective household date applies.

## What changed

1. **Urgent supporting-data refresh** on `proposal` / `routine` sync notifications (and on connect / visibility): proposals/memberships/tasks refresh outside `startTransition`; Today remains transition-friendly.  
2. **Supporting-data generation guard** so stale proposal fetches cannot overwrite newer decisions.  
3. **Tab re-fetch:** opening Personalize or Approvals refreshes supporting data.  
4. **Proposal status labels** render Pending / Approved / Rejected for clearer UI.  
5. **E2e:** manager approval → child’s open Personalize list shows Approved without reload; Preview includes the item; Today does not yet expose an executable checklist action for it.  
6. **Local/LAN evaluation hardening** (`024c494`): Vite Origin defaults, `dev:lan`, trusted-LAN Origin acceptance, client ids safe on non-secure HTTP, CSRF token survival across Vite HMR, distinct local theme.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate` | PASS (at proposal-status fix) |
| `npm run test:e2e` | PASS — **20/20** (10 Chromium + 10 WebKit) at proposal-status fix |
| Focused e2e: manager approve → open Personalize shows Approved (no reload) | PASS |
| Future-effective: Preview shows addition; Today has no Mark action yet | PASS (same e2e) |
| **Local multi-device confirmation (Architecture → Engineering, 2026-09-09)** | **PASS** — see below |
| Hosted Railway retest of this proposal-status fix | **NOT RUN** this writeback (redeploy of `756b742`+ still required) |

### Local multi-device confirmation (current source)

Architecture reported successful end-to-end use of the **current local build** (manager laptop + Eli phone on trusted LAN):

1. Account creation / claim  
2. Shared routine creation (visible immediately on Eli)  
3. Personalization proposal → **Pending**  
4. Manager approval on laptop  
5. Future Preview after approval  
6. Eli’s **open phone session** reflected **Approved immediately without a page refresh**

**Engineering interpretation:** This confirms current-source behavior and realtime proposal-status synchronization on the fixed client path. Any earlier Railway observation of stuck Pending should be treated as **hosted deployment/state evidence** (stale deploy tip and/or host runtime state), **not** as a confirmed defect in current `main` source after `756b742`.

## Prior hosted AT20 evidence (retained; separate from this local confirm)

The following remain **PASS** as recorded in the previous r1 hosted-evidence writeback (deploy tip `546b5e0` / sync-fix `4b0d95f`). They are **not** re-executed here and are **not** superseded by the local multi-device confirmation:

- Restart persistence  
- Backup → isolated restore rehearsal  
- Linux Argon2id on Railway Node 24.20  
- HTTP→HTTPS  
- Checklist live sync and reconnect drill  

**Explicit gap (hosted only):** proposal-status live update on Railway after deploying `756b742` (or later) has **not** been re-confirmed on the host. Local PASS does not close that hosted delta by itself.

## Acceptance test results (r1 delta)

18. **Cross-device synchronization** — PASS (prior hosted checklist path) + PASS automated dual-context e2e + **PASS local physical phone confirmation** of proposal-status live update.  
20. **Hosted family-evaluation evidence** — PASS for prior hosted checks listed above; **proposal-status live update on Railway** remains a short post-redeploy confirm (same scenario now also proven locally).  
21. **Project verification** — PASS locally (`validate` + Playwright 20/20 at fix); local Architecture walkthrough PASS for the proposal-status path.

## Deviations from brief revision

- None. Still r1; Preview-now / Today-when-effective unchanged.

## Remaining gaps

- Redeploy current tip (at least `756b742`, preferably including `024c494`) to Railway and confirm the hosted proposal-status path once if Architecture/PL still want host parity evidence.

## Suggested regression coverage

**Already in tree (retain as primary automated regression):**

- `tests/e2e/morning-routine.spec.ts` — `manager approval updates open personalize proposal status without reload`  
  (dual browser contexts: child Personalize stays open → manager Approves → child list shows Approved without reload; Preview has item; Today has no Mark action yet.)

**Recommended additional regression (optional, not blocking this writeback):**

1. **Keep the existing e2e green on every PR** — it already encodes the defect Architecture originally saw.  
2. **Manual smoke (when using `dev:lan`):** one manager desktop + one phone claim/propose/approve without reload — mirrors tonight’s confirm; document in AT18 notes when run.  
3. **If a second automated case is desired later:** same e2e with the child’s Personalize tab already showing Pending *before* the manager navigates to Approvals (stricter open-view timing). Current test is sufficient for the `startTransition`/WS refresh bug.  
4. **Do not** treat a failing Railway instance on an older deploy tip as a source regression without checking deploy SHA vs `756b742`+.

## Suggested follow-up

Architecture reassessment of P0-002 r1 may treat **local multi-device confirmation + automated e2e + prior hosted AT20 package** as sufficient for the proposal-status defect, with hosted Railway proposal-status retest optional/post-redeploy rather than a current-source blocker.
