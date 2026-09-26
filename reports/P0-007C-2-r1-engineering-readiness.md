# Engineering Readiness Review - BRIEF P0-007C-2 r1

**Brief revision reviewed:** 1  
**Review round:** Initial consolidated pass  
**Readiness:** READY  
**Repository/Git state checked:** YES  
**Current branch:** `brief/p0-007c-2-household-display-read-only-dashboard` @ `a71b17d` (planning tip)  
**Integrated baseline inspected:** `main` / merge-base @ **`ef39a89`** (PR #20 C-1; matches brief Current system SHA)  
**Working tree at review:** planning docs only beyond `ef39a89` (ARCHITECTURE, DECISIONS, PROJECT_STATE, ROADMAP, brief); no C-2 implementation sources

> READY is the default when implementation can reasonably proceed. QUESTION/BLOCKER findings must be material, evidenced, and consolidated; ordinary implementation choices are not readiness gates.

## Verdict

**READY.** D-043, D-044, and D-045 agree with P0-007C-2 r1 and are Active as planned (not implemented). The brief’s **Current system** table matches integrated C-1 at `ef39a89`. Required deltas are a new display principal/credential class, dedicated privacy-filtered reads that reuse real current-day materialization without member impersonation, a restricted `/display` shell, sanitized live recovery with bounded stale exposure, and explicit CI selection—not a rewrite of human auth, C-1 Today/Household contracts, or A/B assignment truth.

**No BLOCKER. No QUESTION.** Implementation waits for Architecture **ACCEPT / PROCEED** (this review does not authorize coding). C-3 execution and personal-work promotion remain out of scope.

## Decision alignment

| Decision | Brief use | Repo / conflict |
| --- | --- | --- |
| **D-043** | Household Display identity; `household.display.manage` + enroll-holder backfill; Base32 claim; `__Host-hd_display` / `hd_dev_display`; never fake member `AuthContext` | Active planned; `AuthContext` is member-only (`store.ts`); cookies `__Host-hd_session` / `hd_dev_session` only (`config.ts`); Grant enum has no display grant |
| **D-044** | Dedicated allowlisted display reads; reuse materialization core; private tasks excluded; household-visible tasks detail-only / unpromoted on board | Active planned; `materializeForDate` writes then filters by member grants; `listTasks` includes owner private tasks—unsuitable as display DTO; C-1 overview helpers reusable |
| **D-045** | Restricted shell; sanitized WS; 30s revalidation; 60s stale bound; no durable household cache | Active planned; `SyncHub` tracks `{ socket, householdId }` only and broadcasts resource IDs including `personal_task`; no device-scoped close |
| **D-006 / D-007** | Preserve human identity/session policy; display is a distinct principal class | Human idle 7d / absolute 30d; session cookie has no Max-Age; display 90/365 + persistent cookie is additive, not a human-lifetime change |
| **D-010** | Private never on wall; household-visible in person detail only in C-2; no promotion field | Visibility model present; no dashboard-promotion field (correct for C-2) |
| **D-017 / D-023+ / D-032–D-042** | Fixture safety; locks/lifecycle; profiles/History/reset; C-1 truth | Present on baseline; brief preserves them |

## Current-system claim check

| Claim | Evidence | Verdict |
| --- | --- | --- |
| Baseline `ef39a89` | Branch tip `a71b17d` is ancestor-based on `ef39a89`; merge-base exact; only planning docs differ | Match |
| No non-human display principal | No display cookie/context/routes under `src/`; `AuthContext` = user/membership/grants | Match |
| Unsafe-method hook assumes member session | `app.ts` `preHandler`: Origin + CSRF vs `session.csrfSecret` after `requireSession`; login/claim Origin-required without session | Match |
| Closed grants; `household.member.enroll` exists; no `household.display.manage` | `grants.ts`, `schemas.ts` `GrantSchema` | Match |
| Grant backfill pattern exists | Migrations 003/009/010/011 `INSERT OR IGNORE … SELECT … FROM membership_grants` | Match |
| Migrations end at **014** | `db/migrations/014_assignment_patterns_scheduled_work.sql` | Match |
| `materializeForDate` writes unstarted snapshots then filters by kind authority | `store.ts` ensureOccurrence + manage/execute-own filter | Match |
| Sync broadcasts household resource IDs; no display projection / targeted revoke | `sync-hub.ts`; `SyncNotification` includes `resourceId`; clients keyed by `householdId` only | Match |
| Personal-task reads include owner's private tasks | `listTasks` owner OR `visibility='household'` | Match |
| Single App entry; no `/display` or `/household/displays` | `main.tsx`, `nav.ts`, `HOUSEHOLD_MENU_ITEMS` | Match |
| through-013 fixture exists; no through-014 named fixture | `tests/helpers/p013-fixture.ts`; no `p014-fixture` | Match |
| CI selects pre-007 / 007A / 007B / **007C-1**; no C-2 job/script/allowlist | `validate-pr.yml` `e2e-phone-007c1`; `package.json` `…007c1`; desktop allowlist ends at C-1 geometry; Vite smoke 006a/007a only | Match |
| Human claim rate limit 5/min non-test; digest-only enrollment tokens | `claimRateLimit`, `insertClaim` / `sha256Hex` | Match |
| Screenshots local-only under `reports/_local-screenshots/` | `.gitignore` / reports README pattern | Match |

No Current-system factual contradiction requiring Architecture revision.

## Focused attention areas

### Separate display credentials and dual-credential dispatch

**Repo today:** One session cookie class; `sessionFromRequest` digests that cookie into member `AuthContext`. Human session setter has no `maxAge`/`expires`. Unsafe mutations require member CSRF after Origin check.

**Brief / D-043:** Separate digest-backed display session (`__Host-hd_display` / `hd_dev_display`), 90-day idle / 365-day absolute with persistent cookie bounded by absolute remaining life; human routes never accept display cookies and display reads never fall back to human cookies; mixed cookies must not inherit human authority; `/display` never mounts the personal App.

**Disposition:** Clear contract. Implementation must introduce an explicit principal class and route-aware credential dispatch before the current member-only `preHandler` assumptions. Display claim is Origin-required like human claim; display-authenticated GETs refresh last-contact without CSRF. **IMPORTANT** delivery care (not a blocker): inventory every registered route in route-policy with member/display/public classes and method-aware denial before effects (AT4). Ordinary choices: cookie helper module vs extend `config.ts`; table names; Base32 generator beside existing `randomToken`/`sha256Hex`.

### HTTP/WS privacy and sanitized sync

**Repo today:** Member `/today`, people/profile, and task list DTOs carry fields and private titles unsuitable for a wall. Sync frames carry resource IDs including personal-task IDs to all household sockets.

**Brief / D-044 / D-045:** Allowlisted display projections only; private titles/IDs/counts/events never appear; distinct display WS channel with access revalidation ≥30s and device-scoped close on revoke/replace/expiry.

**Disposition:** Dedicated display routes + projection builders; do not CSS-hide member DTOs. Extend `SyncHub` (or sibling) to track display/session identity and emit sanitized invalidation only. **IMPORTANT** delivery care: private-only task mutations must not produce disclosive display frames (AT5). Ordinary choices: event shape, coalesce keys, shared vs forked hub module.

### Current-day materialization without impersonation

**Repo today:** `GET /api/v1/today` → `requireSession` → `materializeForDate(session, date)` which materializes household definitions then **filters** to the member’s manage/execute-own scope. Creating a fake manager `AuthContext` would widen human authority semantics and violate D-043/D-044.

**Brief / D-044:** Narrowly extract the household-date materialization/reconciliation core; display reader authorizes separately and returns household-wide current-day snapshots for **today only**; may write unstarted system-owned snapshots (same as personal Today); cannot execute/lock/edit/arbitrary dates.

**Disposition:** Intentional store refactor with two validated readers over one resolver. Preserve snapshot IDs, routine fan-out, responsibility composition, Unassigned, school filtering, started survivors, reset floor. Covered by AT6. Ordinary Engineering extraction boundaries.

### Revocation, delayed responses, and bounded stale exposure

**Repo today:** No display sessions; no 60s stale client policy; delayed-response arbitration exists in member outbox/sync tests but not for a display principal.

**Brief / D-045:** Durable revoke before socket close/access-loss; delayed pre-revoke responses cannot restore UI; client stale ≤60s from last authorized refresh (request-start anchored); cold offline reload has no household snapshot; activity clear preserves display enrollment.

**Disposition:** Feasible with existing Playwright multi-context, route-hold, and time-control patterns used in 006/007A/B. AT11–13 are explicit evidence, not unspecified product research. Ordinary choices: client timer utilities and access-loss fencing helpers.

### Explicit CI test selection

**Repo today:** Thematic phone jobs stop at `P0-007C-1`. Desktop allowlist ends at `z-p0-007c-1-geometry.spec.ts`. Vite smoke has no `/display` deeplink. A suite titled `P0-007C-2` would miss every required thematic job and the desktop allowlist; `grep-invert "P0-007"` would also miss it.

**Brief AT16 / implementation boundary:** Add C-2 to local scripts, required thematic CI jobs, display/desktop allowlists, and Vite smoke selection; keep aggregate `Pull-request validation` failure propagation; do not defer mandatory WebKit/RC evidence to remote Actions.

**Disposition:** **IMPORTANT** delivery item (same class as C-1 readiness): wire `e2e-phone-007c2` (or equivalent explicit grep), package script(s), desktop `testMatch` for 4K/geometry, Vite `/display` smoke, and aggregate `needs` in the same implementation. Prefer titles that do not collide with a bare `P0-007C` umbrella.

### Upgrade fixture and cleanup safety

**Repo today:** Populated through-013 helper; callers migrate 014+; cleanup blocks on enrollment claim authorship and sessions but has no display creator/issuer FKs.

**Brief AT1:** Named through-014 upgrade fixture; one-time grant backfill from `household.member.enroll` holders only; extend cleanup safety for new membership references; clear activity preserves display identity/credentials.

**Disposition:** Planned work matching prior grant-backfill migrations; no missing dependency. NOTE: build the through-014 fixture rather than claiming through-013 alone satisfies AT1.

## Acceptance-test feasibility (AT1–16 + AT17)

| AT | Feasible on baseline? | Notes |
| --- | --- | --- |
| 1 Populated upgrade / grant scope | Yes | New migration 015+; new through-014 fixture; backfill pattern exists |
| 2 Manager-to-wall journey | Yes | Chromium + WebKit; separate contexts; mirror human claim UI patterns |
| 3 Claim/command correctness | Yes | Integration + rate-limit/Origin seams from auth claim |
| 4 Principal denial matrix | Yes | Extend route-policy inventory; HTTP + WS |
| 5 Response/privacy allowlists | Yes | Recursive fixture assertions; WS frame capture |
| 6 Shared current-day truth | Yes | After materialize extraction; six-person seed |
| 7 Inspect the wall | Yes | Chromium + WebKit; idle timer controllable |
| 8 4K / phone geometry | Yes | Chromium native 3840×2160 + 1920×1080@2x; WebKit for enrollment/inspect if geometry Chromium-only |
| 9 Live convergence | Yes | Multi-context patterns from C-1/A/B |
| 10 Missed/delayed updates | Yes | Existing abort/hold/visibility seams |
| 11 Revocation races | Yes | Dual display contexts + delayed response holds |
| 12 Disconnected exposure | Yes | Controlled time + offline; AT12 bound is Architecture choice |
| 13 Persistence / expiry | Yes | Cookie attribute asserts; hosted profile testable locally |
| 14 Date/time boundaries | Yes | Existing household-date / DST test seams; no public clock override |
| 15 Bootstrap / nav isolation | Yes | Built SPA fallback + Vite deeplink extension |
| 16 Regression / CI | Yes | Requires explicit C-2 CI wiring (IMPORTANT above); local validate:pr/rc |
| 17 Product at-distance | External | NOT RUN if hardware unavailable; technical acceptance may proceed on AT1–16 |

## Scope confirmation

- **In:** Display identity/migration/grants; manager `/household/displays`; enrollment/claim/revoke; display cookies/principal; dedicated display HTTP/WS + allowlisted projections; shared materialization extraction; `/display` shell; protected-behaviors/route-policy; C-2 CI selection; local screenshots under `reports/_local-screenshots/p0-007c-2-r1/`.
- **Out:** C-3 checklist/personal-task execution, performer provenance, dashboard-promotion control; human session lifetime changes; manager impersonation; kiosk/OS lockdown; new hosted deployment; tracked screenshot commits.

## Status for Architecture

**Readiness: READY** for P0-007C-2 revision 1 against integrated C-1 @ `ef39a89`.

Await **ACCEPT / PROCEED** before implementation. After that response, Engineering expects to build without another ordinary QUESTION/BLOCKER cycle unless a genuinely new repository fact appears.

## Suggested commit message (readiness writeback only; not committed by this review)

```
docs(P0-007C-2): record Engineering readiness READY for r1
```
