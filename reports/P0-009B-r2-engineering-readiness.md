# Engineering Readiness Review - BRIEF P0-009B r2

**Brief revision reviewed:** 2  
**Review round:** Initial consolidated pass after Architecture assignment  
**Readiness:** READY  
**Repository/Git state checked:** YES  
**Current branch:** `wall-refinements` @ `79fbb57`  
**Integrated code baseline inspected:** `main` / `origin/main` at **`14af09e`** (PR **#30**)  
**Working tree at review:** Docs-only delta from `14af09e` plus `reports/P0-009B-r1-engineering-readiness.md` (assignment-mismatch record; preserved). No P0-009B implementation under `src/`, `db/`, `tests/`, or `.github/` at review start.

> READY is the default when implementation can reasonably proceed. QUESTION/BLOCKER findings must be material, evidenced, and consolidated; ordinary implementation choices are not readiness gates.

## Verdict

**READY.** P0-009B r2 agrees with Active D-061 and with the inspected display/preview/outbox surface at `14af09e`. The r2 current-system table matches the repository (verified in `reports/P0-009B-r1-engineering-readiness.md` and rechecked here). Separate automatic `/day` reads, per-pane freshness, shared read-only preview, and the evidence matrix are implementable with existing grants, projection helpers, Playwright project splits, and hold/fence seams.

The superseded r1 BLOCKER is an assignment record only. Architecture ACCEPT (2026-10-28) assigns r2 and authorizes PROCEED in this session.

**No BLOCKER. No QUESTION.** 3×2 and 90s idle remain provisional. Deployment, live-data work, production-wall replacement as a Project Lead operation, `/` investigation, and live School/Meals/Calendar stay out of scope.

## Decision alignment

| Decision | Brief use | Repo / conflict |
| --- | --- | --- |
| **D-061** | Automatic `GET …/people/:membershipId/day` and preview counterpart; per-pane state/freshness; pending-sign-in roster | Active r2 direction. Routes do not exist yet — that is the slice. |
| **D-049 / D-057** | Unpromoted household-visible tasks stay on deliberate person-detail only | Existing person-detail includes them; dashboard/promoted list does not. New `/day` must not copy person-detail. |
| **D-044** | Today-only materialize; date override 400 | `materializeCurrentDayScope`; preview already rejects `?date=` |
| **D-045 / D-047** | 60s content/action lease; one display outbox | Board-global today; per-pane lease is the client delta. Outbox stays above panes. |
| **D-043 / D-046** | Display principal; existing status command | Unchanged. Preview must not call `requireDisplay` / `setDisplayStepStatus`. |
| **D-051 / D-054** | Epoch and departure fences | Reuse existing reset/restore/departure proofs; add pane-read hold+revalidate. |
| **D-058 / D-059** | Proof stays Vite-only; 3×2 hypothesis; fixed target viewport | Implemented by P0-009A. B adapts shared presentation; does not rebuild Family day. |

## Remaining r2 items (ordinary choices, not gates)

- Register `/people/:membershipId/day` beside existing person-detail. Fastify treats them as distinct paths.
- New routes use preview-style `releaseSharedNow` + `x-read-delay-ms` (hosted ignores the hook).
- Family board is new shared presentation; By work and deliberate person/occurrence detail remain. One session/sync/outbox owner stays in `DisplayApp`.
- Phone-core and `chromium`/`webkit` `testIgnore` must exclude `z-p0-009b-*`. Touch uses `touchDragByCdp`.
- Component names, DTO property names, and test file grouping are Engineering’s.

## Current-system claims

Rechecked against `14af09e`. All r2 current-system rows match. See `reports/P0-009B-r1-engineering-readiness.md` claim table. No newly evidenced contradiction.

## Consolidation check

- I inspected the relevant repository surface before returning this review: YES
- These are all currently known material readiness concerns: YES
- Any BLOCKER above cites concrete evidence: N/A

## Recommendation

**READY — PROCEED** with P0-009B r2 implementation in this session. Preserve the r1 report. Suggest a commit message; do not commit. Do not deploy.

## Durable discoveries

None beyond D-061 already recorded. Implementation will add the two `/day` routes to `route-policy.ts`, `ARCHITECTURE.md`, and `docs/protected-behaviors.md`.
