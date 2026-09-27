# Architecture Re-review - P0-007C-3A r1

**Disposition:** FIX REQUIRED (one remaining AT11 evidence gap; same revision)  
**Brief:** `briefs/p0-007c-3a-shared-display-execution.md`  
**Reviewed correction:** `55afa52eb60bb95703b6b0656835940aa0de7484` on `brief/p0-007c-3a-shared-display-execution`  
**Prior review:** `reports/P0-007C-3A-r1-architecture-review.md`  
**Build Report:** `reports/P0-007C-3A-r1-build-report.md`  
**Next owner:** Engineering  
**Card:** **Act at the shared display without losing trust** remains **In Progress**.

## Corrections verified by inspection

- Date/generation-mismatched outbox items now become rejected with a reason instead of being discarded. Overview notices survive date rollover, and named unit/browser coverage exercises retirement and explanation.
- AT5 now names and exercises the denial matrix, including prior/future dates, school-filtered work, ended/canceled work, removed steps, foreign work, and an actionable started survivor.
- AT8 closes the active Fastify app, builds a fresh app and database connection against the preserved SQLite file, then rebinds the listener and reuses the same display session. This is accepted as the local server-application restart seam; the report discloses that the Playwright-managed Node process remains alive.
- AT10 now covers a queued prior-day action, authoritative date advance, no replay, and visible retirement notice.
- The Build Report records a successful exact `npm run validate:rc`, including Chromium/WebKit and Vite. Architecture did not independently rerun the suite.

## Remaining required correction

**AT11 — demonstrate real socket loss and recovery of a missed update.** In `tests/e2e/z-p0-007c-3a-live.spec.ts`, the current sequence dispatches a synthetic `offline` DOM event and calls `page.route()` after the display WebSocket has already been created. That does not demonstrate that the open WebSocket closed: the client reconnect path is driven by the WebSocket's `onclose` event. The test also performs no new action on another context while wall B is disconnected, so it cannot prove that visibility/reconnect refresh recovers a missed invalidation.

Add a deterministic test seam or use Playwright's WebSocket controls/server-side connection close to prove the actual socket closes and the client reconnects. While wall B is disconnected, commit a checklist update from the phone, manager, or other display. Restore connectivity/visibility and prove wall B converges to authoritative state without a page reload. Retain the existing delayed/out-of-order read assertion and verify it cannot overwrite that recovered state or erase pending feedback.

## Build Report correction

The current checkout is clean at `55afa52`, but the Build Report still says the correction is uncommitted and awaiting Coordinator/user commit. Pin the actual correction SHA (`55afa52eb60bb95703b6b0656835940aa0de7484`) and remove the stale pending-commit wording before final acceptance.

## Disposition

No new readiness review, brief revision, Product decision, deployment, or C-3B work is needed. Return the focused AT11 evidence and corrected Build Report against P0-007C-3A r1. After that, Architecture can accept the slice and the card can move to **Ready to Evaluate**; the broader C outcome remains unevaluated until C-3B and Project Lead evidence are complete.
