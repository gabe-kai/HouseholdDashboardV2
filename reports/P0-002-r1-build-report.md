# Build Report - BRIEF P0-002 r1 (hosted sync evidence response)

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (provider-neutral; hosted AT20 still incomplete)  
**Branch:** `brief/p0-002-authenticated-household-authority`  
**Commits:** prior `c96133a` / `361be83`; this pass is uncommitted until Coordinator/Project Lead authorizes  
**Pull request:** N/A (not opened)  
**Architecture disposition addressed:** hosted sync evidence follow-up (acceptance 18/20 path)

## Defect investigated

Hosted evaluation reported: manager created a Morning Routine for Eli; Eli’s phone showed the routine container via auto-refresh but checklist steps only after manual refresh; after Eli completed items, the manager browser stayed stale until manual refresh. Manual refresh is not accepted evidence for AT 18/20.

## Root causes (repository)

1. **Dead WebSocket, no reconnect:** `connectSync` opened one socket and never recovered from close/error. Online handling flushed the outbox but did not re-establish sync. After a drop, only a full remount refreshed.
2. **Stale `/today` races:** Concurrent refreshes could apply an older empty/incomplete snapshot after a newer one. Sync also sometimes re-fetched a closed-over client date.
3. **Household expand seed gap:** `HouseholdView` kept a local `expanded` map that was never seeded. Incomplete rows relied on `expanded[id] ?? !completed`, so when an occurrence became complete the checklist collapsed and live `Status:` lines disappeared even though sync had applied (“Complete” in the header).
4. **Empty-step vacuous complete:** `isOccurrenceComplete([])` was true, which could collapse a header-only occurrence before steps materialized. Defensive rematerialization repairs empty step rows when the revision has steps.

P0-001 optimistic outbox / desired-state mutation path was not changed in contract; flush still overlays pending commands after authoritative reads.

## What changed in this pass

1. **Client sync:** exponential-backoff WebSocket reconnect; reconnect + visibilityforce authoritative `/api/v1/today` (server today, no stale date); refresh generation guard; connection pill reflects reconnecting.
2. **Server sync:** periodic WebSocket ping frames; hub cleanup on process close.
3. **Household UI:** seed expand flags once while incomplete so live completion stays visible without manual refresh.
4. **Materialization:** treat empty step lists as incomplete; repair empty occurrence steps from the active revision when needed.
5. **Evidence:** e2e for create-while-watching dual context (checklist + manager status without reload); reconnect test forces socket close via `__hdSync.closeForTest` and asserts recovery without page reload; ops note on reconnect/single-process.

Contract/implementation boundary: unchanged (still WS invalidation + authoritative HTTP read). No Architecture return required for this defect fix.

## Verification performed

Environment: Windows, Node.js `v24.16.0`. Date: 2026-09-09.

| Command | Result |
| --- | --- |
| `npm run validate` | PASS (`lint` + `typecheck` + **26** Vitest tests) |
| `npm run build` | PASS (via e2e webServer) |
| `npm run test:e2e` | PASS — **18/18** (9 Chromium + 9 WebKit) |
| Dual-context create→checklist→manager status (no reload) | PASS (new e2e) |
| Forced WS drop → reconnect → status without reload | PASS (updated e2e) |
| Railway HTTPS / two physical phones | **NOT RUN** (no authorized origin credentials in this Engineering session) |
| Linux Argon2 live probe | NOT RUN |

## Acceptance test results (delta)

18. **Cross-device synchronization** — PASS with strengthened automated evidence (create/assign materialization both ways; reconnect + authoritative read; no manual refresh).  
20. **Hosted family-evaluation evidence** — still **NOT RUN** against the live Railway HTTPS origin / physical phones in this session. Deploy this build and re-run AT20; do not treat prior manual-refresh observations as pass.  
21. **Project verification** — PASS for validate/build/Playwright locally. Hosted-smoke on authorized origin — **NOT RUN**.

Unchanged prior PASS items 1–17 and 19 remain as in the previous Build Report unless Architecture reopens them.

## Deviations from brief revision

- None. Fix stays inside existing sync/reconcile contract.

## Known limitations / evidence gaps

- AT **20** and hosted portions of **21** remain **NOT RUN** until Project Lead re-evaluates on the authorized HTTPS host with this build.
- Linux Argon2 native verification remains deferred.
- Sync fan-out remains single-process (documented).

## Suggested follow-up

- Deploy this branch to the authorized Railway HTTPS origin (single replica).
- Re-run AT20 with two authenticated device contexts **without** manual refresh.
- Architecture reassessment of P0-002 r1 against this Build Report after hosted evidence.
