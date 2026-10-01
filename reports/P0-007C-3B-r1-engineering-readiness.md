# Engineering Readiness Review - BRIEF P0-007C-3B r1

**Brief revision reviewed:** 1  
**Review round:** Initial consolidated pass  
**Readiness:** READY  
**Repository/Git state checked:** YES  
**Current branch:** `brief/p0-007c-3b-personal-work-wall-promotion` @ `949ed31`  
**Integrated baseline inspected:** Clean `main` / `origin/main` at **`6510fb4`** (PR **#22**, C-3A merge); branch tip is brief/docs only atop that baseline  
**Working tree at review:** Clean; no C-3B implementation under `src/`, `db/`, `tests/`, or `.github/`

> READY is the default when implementation can reasonably proceed. QUESTION/BLOCKER findings must be material, evidenced, and consolidated; ordinary implementation choices are not readiness gates.

## Verdict

**READY.** D-048 and D-049 are Active and agree with P0-007C-3B r1. The brief’s **Current system** table matches integrated C-3A at `6510fb4`: personal tasks have only `private|household` visibility and owner-only status; Today can create/status but not edit sharing; the wall shows household-visible tasks in person detail only; display status remains assigned recurring work; member `personal_task` broadcast always carries a task ID and display invalidation runs only when the **post-change** task is still household-visible. Required deltas are a forward migration after 016, owner-scoped sharing/promotion mutations with completion-time preservation, filtered resting summaries in both wall organizations, withdrawal-safe member/display sync, PB/route-policy/CI selection updates, and focused Today + compact wall UI—not a redesign of C-2/C-3A enrollment, execution, stale bounds, or responsibility authoring.

**No BLOCKER. No QUESTION.** This review does not authorize coding; await Architecture **ACCEPT / PROCEED**. Responsibility-authoring and claimable-work feedback remain Product scope outside this brief.

## Decision alignment

| Decision | Brief use | Repo / conflict |
| --- | --- | --- |
| **D-048** | Owner-controlled promotion distinct from visibility; private clears promotion; no manager/display override; no age-derived authority | Active planned; `personal_tasks` has visibility + status only (`002_authenticated_authority.sql`); create/status routes exist; no sharing edit |
| **D-049** | Filtered resting projection; detail retains household-visible tasks; sanitized invalidation; delayed-response / reconnect fences; no personal-task wall writes | Active planned; `getDisplayPersonDetail` lists household-visible tasks; dashboard by-person/by-work omit personal tasks; display status is checklist-only |
| **D-010 / D-043–D-047** | Preserve private isolation, display principal, C-3A execution, 60s stale, no durable display cache | Implemented through `6510fb4`; brief Do-not-change matches |
| **D-034** | Activity clear does not erase personal tasks | Reset scope already excludes personal tasks; promotion must not widen clear |

## Current-system claim check

| Claim | Evidence | Verdict |
| --- | --- | --- |
| Baseline `6510fb4` (PR #22); migrations through 016 | `git log` / `main` at `6510fb4`; tip migration `016_display_execution_provenance.sql` | Match |
| Task model: visibility + status; no promotion; create selects visibility; status owner-only; no visibility-edit endpoint | `personal_tasks` DDL; `CreatePersonalTaskSchema` / `SetPersonalTaskStatusSchema`; `POST /personal-tasks` and `…/status` only in `app.ts` / `route-policy.ts` | Match |
| `completedAt` projected from `updated_at` | `store.getTask`: `completedAt: status === "completed" ? updated_at : null` | Match |
| Today create + status; no share/promote UI | `TodayView.tsx` `PersonalTasksBlock` | Match |
| Wall: household-visible tasks in person detail; none in resting summaries; no display personal-task command | `display.ts` person detail query; `DisplayApp.tsx` detail list; C-3A status is occurrence steps | Match |
| Member broadcast always sends `personal_task` + ID; display invalidate only if still household-visible after change | `app.ts` `broadcast` → sync hub then `isHouseholdVisibleTask` gate | Match (gap is intentional brief work) |
| PB-49–53; CI has C-3A job; no C-3B selection | `protected-behaviors.md`; `validate-pr.yml` stops thematic phone jobs at `e2e-phone-007c3a` | Match |
| Through-015 fixture exists; no through-016 populated upgrade helper yet | `tests/helpers/p015-fixture.ts`; no `p016-fixture` | Match (planned AT1 work) |
| Project Lead density / 10–16 ft readability recorded | `evaluations/p0-007c-3a-project-lead-evaluation-2026-09-29.md` | Match |

No Current-system factual contradiction requiring Architecture revision.

## Focused attention areas

### Owner sharing/promotion mutation seam

**Repo today:** Create inserts visibility without `mutationId`. Status updates are owner-only, receipt-keyed by `mutationId`, and bump `updated_at` (which currently defines `completedAt`). There is no PATCH/share route.

**Brief / D-048 / AT2–AT4:** Independent promotion flag; create may opt in only when household-visible; edit visibility/promotion on owned tasks without management grant; reject private+promoted; Private clears promotion atomically; replay/conflict guards; sharing must not move reported completion time.

**Disposition:** Clear contract. Add forward migration + owner-scoped sharing command(s) with mutation receipts (extend `personal_task_mutations` or parallel receipt layout—Engineering choice under D-048). Preserve completion time via a dedicated `completed_at` (or equivalent) rather than `updated_at`. Ordinary choices: one combined sharing endpoint vs split visibility/promote, create-time promotion field shape, and concurrency token/`if-match` style for stale competing edits.

### Privacy-safe sync and withdrawal

**Repo today:** Every task create/status fans `resourceId` to all household member sockets. Display invalidation is skipped when the **resulting** row is private, so Household→Private or unpromote-after-household can leave a connected wall showing withdrawn content until poll/visibility. Private IDs therefore reach non-owner member WS clients even though HTTP list reads are filtered.

**Brief / D-049 / AT5–AT6:** Invalidate formerly authorized projections on withdrawal; never put private IDs/titles in display events; do not fan private IDs to nonowners; delayed older responses cannot resurrect withdrawn content.

**Disposition:** **IMPORTANT** delivery care (in-brief work, not a readiness gate): change broadcast so private/non-owner events omit or sanitize identifiers; always invalidate displays when a task **was** visible/promoted to them (pre-image or equivalent), not only when post-image is household-visible; keep display payloads allowlisted. Reuse existing delayed-read / reconnect patterns from C-2/C-3A tests.

### Resting wall summaries and focused Today controls

**Repo today:** By person / By work summarize recurring work only. Person detail already lists household-visible personal tasks without actions. Today shows visibility at create and status toggles only.

**Brief / AT2 / AT5 / AT7–AT8:** Compact owner-labeled undated promoted-open summaries in both organizations, distinct from routine/responsibility progress; unpromoted household tasks stay detail-only; no wall status command; Today gains clear Private/Household + shared-dashboard controls. Respond to Project Lead density feedback with selective placement, not a wall redesign.

**Disposition:** Feasible inside `display.ts` / `display-api.ts` / `DisplayApp.tsx` and `TodayView.tsx` / `api.ts`. Do not inflate daypart/progress counters. Ordinary UX copy/layout within Calm Household / display CSS. Physical re-check of the changed wall remains Product (AT8).

### Explicit CI and upgrade evidence

**Repo today:** Aggregate PR gate includes through `e2e-phone-007c3a`; package scripts mirror that; Vite `/display` smoke exists; tip migration count expectations are 16 across several integration tests.

**Brief AT1 / AT8:** Through-016 populated upgrade; exact `validate:pr` / `validate:rc`; explicit C-3B browser selection without weakening the aggregate job; geometry at phone/4K/scaled; C-2/C-3A regressions retained.

**Disposition:** **IMPORTANT** delivery item: add `e2e-phone-007c3b` (or equivalent explicit grep), package script(s), desktop/display allowlists as needed, bump hard-coded migration tip counts where migrations become 17, and build a through-016 fixture (do not claim p015 alone). Prefer titles that do not collide with a bare `P0-007C` umbrella.

## Acceptance-test feasibility (AT1–8)

| AT | Feasible on baseline? | Notes |
| --- | --- | --- |
| 1 Populated upgrade | Yes | Migration after 016; new through-016 fixture; tip-count bumps |
| 2 Owner journey | Yes | Today UI + wall refresh; create without promote then promote |
| 3 Authority matrix | Yes | Dual memberships, display cookie, mutation receipts, conflict payloads |
| 4 Visibility reversal + completedAt | Yes | Requires timestamp preservation in schema/projection |
| 5 Read matrix | Yes | Display dashboard/detail + Household + progress non-inflation asserts |
| 6 Cross-context recovery | Yes | Multi-context WS/hold patterns from C-2/C-3A; must cover private-ID non-leak |
| 7 Display boundaries | Yes | No wall personal status; C-3A checklist regression; revoke/stale |
| 8 Presentation and gates | Yes | Geometry + explicit C-3B CI; physical wall Product-only |

## Scope confirmation

- **In:** Migration after 016 for promotion (+ completion-time representation as needed); owner sharing/promotion API + receipts; Today sharing controls; display resting summaries; sync sanitization/withdrawal invalidate; route-policy + PB/sync-matrix; C-3B CI selection; local screenshots under an ignored `reports/_local-screenshots/p0-007c-3b-r1/` (or equivalent).
- **Out:** Manager/parental override; display personal-task completion; C-2/C-3A enrollment/execution/provenance changes; Cover/Claim / multi-owner Dinner Cleanup / twice-daily responsibility authoring; general wall redesign; hosted deploy; treating C-3B alone as full Product acceptance of the C card.

## Status for Architecture

**Readiness: READY** for P0-007C-3B revision 1 against integrated `main` @ `6510fb4` (branch tip `949ed31`).

Await **ACCEPT / PROCEED** before implementation. After that response, Engineering expects to build without another ordinary QUESTION/BLOCKER cycle unless a genuinely new repository fact appears.

## Suggested commit message (readiness writeback only; not committed by this review)

```
docs(P0-007C-3B): record Engineering readiness READY for r1
```
