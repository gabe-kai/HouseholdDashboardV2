# Engineering Readiness Review - BRIEF P0-007C-3A r1

**Brief revision reviewed:** 1  
**Review round:** Initial consolidated pass  
**Readiness:** READY  
**Repository/Git state checked:** YES  
**Current branch:** `brief/p0-007c-3a-shared-display-execution` @ `db37119`  
**Integrated baseline inspected:** C-2 merge **`739f7e3`** (PR #21); documentation parent **`340f955`**; brief tip adds planning/docs only  
**Working tree at review:** Clean; no C-3A implementation sources under `src/`, `db/`, `tests/`, or `.github/` beyond C-2

> READY is the default when implementation can reasonably proceed. QUESTION/BLOCKER findings must be material, evidenced, and consolidated; ordinary implementation choices are not readiness gates.

## Verdict

**READY.** D-046 and D-047 agree with P0-007C-3A r1 and are Active as planned (not implemented). The brief’s **Current system** table matches the integrated C-2 foundation: enrolled display principal with GET/WS-only routes, member-only checklist POST, `acting_member_id NOT NULL` reports, member-keyed outbox with occurrence snapshots, and read-only wall UI. Required deltas are a narrow display status command, typed display actor/receipt provenance after migration 015, display-session CSRF, a minimal display-only outbox, focused checklist controls inside the existing `/display` shell, and explicit C-3A CI selection—not a rewrite of C-2 identity/privacy/stale bounds, human grants, or C-3B personal-task promotion.

**No BLOCKER. No QUESTION.** This review does not authorize coding; await Architecture **ACCEPT / PROCEED**. P0-007C-3B remains outside this brief.

## Decision alignment

| Decision | Brief use | Repo / conflict |
| --- | --- | --- |
| **D-046** | Dedicated display status command; shared checklist core; device actor ≠ accountable member; display Origin/CSRF; current-day assigned work only | Active planned; `setStepStatus` is member `AuthContext` + `execute.own` + `acting_member_id = membershipId`; display routes are GET/WS only |
| **D-047** | Display-only minimal durable outbox; queue only inside C-2 stale lease; no household payload cache; revoke/reset/day fences | Active planned; `outbox.ts` is membership-keyed and may retain `occurrenceSnapshot`; DisplayApp has 60s stale blanking and no write path |
| **D-043–D-045** | Preserve enrollment, privacy-filtered reads, revocation, 60s stale, human/display isolation | Implemented at `739f7e3`; brief Do-not-change matches |
| **D-004 / D-023 / D-034 / D-036** | Shared locks, generation, intentional structure, reset cleanup | Present in `setStepStatus` / activity clear; display path must reuse, not fork |
| **D-010** | Private tasks never on wall; household-visible inspectable only | Display person detail already lists household-visible tasks with no completion controls |

## Current-system claim check

| Claim | Evidence | Verdict |
| --- | --- | --- |
| Baseline C-2 @ `739f7e3`; docs parent `340f955` | `git log` / merge-base; `db37119` is brief-only after docs | Match |
| Display identity/sessions through 015; no execution CSRF | `015_household_displays.sql` sessions lack `csrf_secret`; `DisplayContext` has no CSRF field | Match |
| Display routes GET/WS + anonymous claim only | `route-policy.ts`, `app.ts` `/api/v1/display/*` | Match |
| Only checklist POST is member + member CSRF | `POST /api/v1/occurrences/.../status` + global unsafe `preHandler` → `requireSession` | Match |
| `setStepStatus` member-bound; grant + owner equality | `store.ts` requires `execute.own` and `accountable_member_id === ctx.membershipId` | Match |
| Reports require human `acting_member_id`; receipts bind `actor_membership_id` | `001_initial.sql`, `012_responsibility_integrity.sql` | Match |
| Display occurrence detail lacks structural intent | `DisplayOccurrenceDetail`: no `revisionId` / `logicalItemId` / fingerprint | Match |
| Member outbox unsuitable for display | `outboxStorageKey(membershipId)` + optional occurrence snapshot | Match |
| Wall is read-only explanation + status text | `DisplayApp.tsx` “Read-only wall view…”; steps render status, no Mark controls | Match |
| PB-49–51 only; no display-execution PBs | `docs/protected-behaviors.md` | Match |
| CI has C-2 thematic job; no C-3A selection | `validate-pr.yml` `e2e-phone-007c2`; `package.json` `…007c2`; no `007c3` | Match |
| No through-015 upgrade fixture yet | Helpers stop at prior populated fixtures; AT1 requires new through-015 fixture | Match (planned work) |

No Current-system factual contradiction requiring Architecture revision.

## Focused attention areas

### Principal-aware checklist write seam

**Repo today:** `setStepStatus(ctx: AuthContext, …)` authorizes via human grants and owner equality, writes `acting_member_id` / `actor_membership_id` as the member, and requires `intendedStructure` only for responsibilities. Unsafe HTTP `preHandler` always authenticates a **member** session for CSRF.

**Brief / D-046:** One display-principal route; derive owner/kind from stored occurrence; no fake member context; share obligation/lock/generation/date/replay rules; verify structural intent for **both** kinds on display writes; current household date only; pending assignees allowed without human app grants.

**Disposition:** Clear contract. Extract a principal-aware service boundary over the existing transaction rather than duplicating checklist rules. Member route and grants stay intact. **IMPORTANT** delivery care: extend the unsafe Origin/CSRF hook so display POSTs validate display cookie + display-session CSRF (and never member CSRF), without weakening the member path (AT2). Ordinary choices: whether display CSRF is a new `display_sessions.csrf_secret` column issued at claim/session-info, column/table names for actor class, and exact shared-function signature.

### Truthful display actor provenance

**Repo today:** `step_reports.acting_member_id TEXT NOT NULL`; History joins membership for `actingMemberName`; `performer_member_id` may be null (“performer unknown”). Checklist receipts bind replay to `actor_membership_id`.

**Brief / D-046 / AT1 / AT3:** Forward migration after 015; display identity/session as action principal; retain accountable member; physical performer unknown; preserve populated human rows; scoped activity clear removes display reports/receipts without dropping enrollment.

**Disposition:** Feasible forward migration + History/API presentation of display submitter (e.g. display label) without inventing a human actor or performer. Ordinary schema shape (nullable acting member + actor class vs parallel columns) is Engineering discretion within the typed-actor requirement.

### Display detail intent and focused UI

**Repo today:** Display detail returns ordered steps/status/obligation/source only. UI is explicitly read-only. 90s idle return already exists; no pending-command retention across idle.

**Brief:** Supply minimal structural intent from authorized detail; large Done / Not needed / Open controls from By person and By work; pending/saved/error feedback; idle return must not hide unresolved commands; household-visible tasks remain non-executable.

**Disposition:** Extend the allowlisted detail carefully (revision / logical step IDs / fingerprint as needed) without widening C-2 privacy fields. Reuse C-2 refresh/invalidation/stale handling. Ordinary UX copy and control layout within Calm Household / display CSS.

### Display-only bounded outbox

**Repo today:** Member IndexedDB outbox keyed by membership; may persist full occurrence snapshots for omitted Today cards.

**Brief / D-047:** Separate display queue; minimal command + session binding only; no credentials, names, step text, snapshots, or household read payloads; queue only while authorized in-memory view is within 60s; cold offline and blanked state offer no new actions; revoke/replace/reset/day rollover retire or reject safely.

**Disposition:** New storage key/module beside `outbox.ts` (do not reuse member helpers as-is). Covered by AT7–AT10. Ordinary table/queue layout is Engineering discretion already acknowledged in the brief.

### Explicit CI and upgrade evidence

**Repo today:** Required thematic phone job stops at P0-007C-2; no `P0-007C-3A` grep/script/job; no through-015 populated fixture helper.

**Brief AT1 / AT13:** Through-015 upgrade fixture; local PR/RC + Vite; explicit C-3A CI selection without weakening the aggregate gate; 4K/phone geometry checks; screenshots under existing ignored local area.

**Disposition:** **IMPORTANT** delivery item (same class as C-2 readiness): wire `e2e-phone-007c3a` (or equivalent explicit grep), package script(s), desktop/display allowlists as needed, Vite `/display` smoke retention, and aggregate `needs`. Prefer titles that do not collide with a bare `P0-007C` umbrella. Build a through-015 fixture rather than claiming an older fixture alone.

## Acceptance-test feasibility (AT1–13)

| AT | Feasible on baseline? | Notes |
| --- | --- | --- |
| 1 Populated upgrade | Yes | New migration 016+; new through-015 fixture; clear must preserve enrollment |
| 2 Authorization matrix | Yes | Extend route-policy; dual-cookie contexts; Origin/CSRF seams |
| 3 Routine journey | Yes | Display UI + human Today/Household + report actor assertions |
| 4 Responsibility journey | Yes | By work + Unassigned denial; History owner/cardinality |
| 5 Current-day denial | Yes | Existing date/applicability/cancel/obligation seams |
| 6 Edit/action race | Yes | `setStepStatusFailureHook` + manager revision races already used in 007A/B |
| 7 Replay/race | Yes | Mutation-ID receipt patterns from checklist/display management |
| 8 Offline/reload/restart | Yes | Playwright offline + multi-context; mirror AT11 patterns without caching dashboard |
| 9 Revoke/replace | Yes | C-2 revoke/replace + delayed write ordering |
| 10 Reset / day rollover | Yes | Activity clear + generation fence; household-date seams |
| 11 Live recovery | Yes | Display + human contexts; existing sync/visibility holds |
| 12 Privacy / usability | Yes | Privacy asserts + chromium-display geometry; physical AT remains Product |
| 13 Gates | Yes | Requires explicit C-3A CI wiring (IMPORTANT above) |

## Scope confirmation

- **In:** Migration after 015 for display actor/receipts; display status route + Origin/CSRF + route-policy; principal-aware reuse of checklist transaction; structural intent on display detail; display-only outbox; focused `/display` checklist UI; PB/sync-matrix updates; C-3A CI selection; local screenshots under `reports/_local-screenshots/p0-007c-3a-r1/` (or equivalent ignored path).
- **Out:** C-3B personal-task promotion/completion; changing C-2 enrollment/privacy/stale/human isolation; Cover/Claim/helper; plan edits from the wall; hosted deploy; treating C-3A as full C outcome acceptance.

## Status for Architecture

**Readiness: READY** for P0-007C-3A revision 1 against integrated C-2 @ `739f7e3` (branch tip `db37119`).

Await **ACCEPT / PROCEED** before implementation. After that response, Engineering expects to build without another ordinary QUESTION/BLOCKER cycle unless a genuinely new repository fact appears.

## Suggested commit message (readiness writeback only; not committed by this review)

```
docs(P0-007C-3A): record Engineering readiness READY for r1
```
