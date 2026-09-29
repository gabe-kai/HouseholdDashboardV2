# BRIEF P0-007C-3B - Owner-Controlled Personal Work on the Wall

**Revision:** 1  
**Status:** IN REVIEW

`ACCEPTED` will mean Architecture has accepted this implementation against r1. Project Lead acceptance of the completed P0-007C experience remains separate.

## Why

The enrolled wall now shows and executes assigned routine and responsibility work, but personal tasks have only Private/Household visibility. Every household-visible task is confined to person detail; its owner cannot choose a few to show on the resting wall. The approved P0-007C outcome requires a separate, owner-controlled prominence choice. The Project Lead found the current wall visually busy even before promotion, so the added summary must stay selective and readable.

## Learning question

Can an owner deliberately surface useful personal work on the shared screen without exposing private work, implying it is due today, or making the resting wall harder to scan?

## Player experience

From their own personal tasks, a member can make a task household-visible and choose **Show on shared dashboard**. They can change either choice later. A private task cannot be promoted. An open promoted task appears with its owner in the wall's By person and By work summaries; an unpromoted household-visible task remains available in permitted person detail without taking space in the resting view. Completing a promoted task quiets it in the summaries; reopening it brings it back if the owner still chose promotion. The display does not claim to know who completed a personal task and does not offer a personal-task status action.

## Project card

**Card title:** Act at the shared display without losing trust  
**Suggested column:** Up Next for the remaining C-3B work; In Progress when Engineering starts  
**Player-facing goal:** Let each person choose which of their household-visible personal tasks appear on the shared wall.  
**Done when:** An owner can promote and unpromote a personal task, the wall shows only intended open items in its summaries, and making a task private removes it from every display read.  
**Tracking relationship:** Second and final brief under the existing P0-007C-3 card. C-3A's accepted execution slice remains ready for evaluation; completing this brief alone does not mark the full card Product-accepted. No external board is configured.

## Current system

Inspected clean `main` at **6510fb4** (PR **#22**) before drafting; migrations extend through `016_display_execution_provenance.sql`. Planning inspection did not rerun validation.

| Repository evidence | Current fact relevant to r1 |
| --- | --- |
| `db/migrations/002_authenticated_authority.sql`, `src/server/store.ts`, `src/shared/schemas.ts` | A personal task has household, owner membership, title, `private\|household` visibility and open/completed status. It has no promotion field or sharing version. Create selects visibility; status is owner-only. There is no visibility-edit endpoint. A completed task's `completedAt` is currently projected from `updated_at`, so an ordinary sharing update could falsely move its completion time. |
| `src/client/TodayView.tsx`, `src/client/api.ts` | The Today personal-task UI can create a task and change its status; it cannot edit visibility or promote an existing task. |
| `src/server/display.ts`, `src/client/DisplayApp.tsx` | The wall dashboard summarizes recurring assigned work. Person detail reads household-visible personal tasks. Private tasks are excluded; no personal task appears in the resting summaries and no display personal-task command exists. |
| `src/server/app.ts`, `src/server/sync-hub.ts` | Member task changes currently use household-wide `personal_task` invalidation carrying a resource ID. Display invalidation is sent only when the task is household-visible after the change. A household-to-private transition therefore needs an explicit safe removal signal; private task IDs must not be fanned out to unauthorized members or the display. |
| `docs/protected-behaviors.md`, `.github/workflows/validate-pr.yml` | PB-49–53 protect display identity, privacy and execution. PR/RC, display geometry and C-3A CI selection already exist; C-3B evidence must be selected without weakening the aggregate check. |

## Behavioral contract

1. **Separate choice and authority.** Store an owner-controlled `show on shared dashboard` choice independently of Private/Household visibility. Existing tasks migrate unpromoted; new tasks default unpromoted. An owner may choose promotion when creating a household-visible task and may edit sharing/prominence on an existing owned task. No manager, other member, display principal, age/classification or household grant can override that owner's choice. Creating a new task remains subject to the existing creation grant; editing the sharing of an owned task does not require management authority.
2. **Privacy transition.** A private task cannot be promoted. A successful change to Private clears promotion atomically; changing it back to Household leaves promotion off until the owner explicitly opts in again. Reject contradictory create/update payloads rather than storing a private promoted combination. Keep existing task identity, title, status and completion-time meaning: changing sharing on a completed task must not change its reported `completedAt`, despite today's `updated_at` coupling. Engineering may choose the forward-compatible timestamp representation. Sharing updates must be scoped, replay-safe and guarded against a stale competing sharing edit, following the project's mutation conventions. A denied, conflicted or replayed command must not alter another task or household.
3. **Display read model.** Only open tasks with effective Household visibility and deliberate promotion appear in compact resting By person and By work summaries, grouped under their owner and distinct from routine/responsibility progress. These undated tasks must not be counted as today's scheduled obligations or acquire an invented daypart, due date or accountable assignee. Household-visible tasks, promoted or not, remain in the existing permitted person detail; completed promoted tasks are quiet in the resting summaries. Existing authenticated Household oversight remains governed by Household visibility, independent of promotion.
4. **No authority gain at the wall.** Promotion is presentation, not a display write grant. Display clients cannot create, complete, edit, reprioritize or promote personal tasks. C-3A's routine/responsibility checklist route and actor/owner evidence remain unchanged.
5. **Live removal and privacy at every boundary.** The server filters display HTTP responses by current authoritative task state. Changes that add or remove a promoted item, including Household-to-Private and task completion/reopening, invalidate connected displays and authorized human views without sending private titles or IDs through a display event. A private task creation/status/sharing event must not expose its identifier to a different member through household sync. Connected views remove withdrawn content without page reload; delayed older reads and status responses cannot restore it. An offline display retains only D-045's bounded stale in-memory view, with no durable household-task cache or promise of instantaneous remote erasure during disconnection.
6. **Focused presentation.** Put the control where the task owner already creates/views personal tasks, using clear Private/Household and shared-dashboard language. Add promoted summaries within the existing By person/By work display shell and its touch/focus/idle behavior. Keep empty and populated resting views compact in response to the Project Lead's density finding; this is a focused placement change, not a general wall or Plan redesign.

## Implementation boundary

- Forward migration after 016; task schema and owner-scoped mutation/read path in `src/server/store.ts`, `src/shared/schemas.ts` and `src/server/app.ts`. The exact column and receipt layout are Engineering choices under D-048.
- Narrow task controls and API typing in `src/client/TodayView.tsx` / `src/client/api.ts`; authorized display projections and two summary views in `src/server/display.ts`, `src/client/display-api.ts` and `src/client/DisplayApp.tsx`.
- Scope/sanitize task invalidation across member and display sync, including withdrawal from former readers. Update route-policy inventory, protected-behavior catalog/sync matrix and explicit C-3B test selection in CI.
- Use existing app, SQLite, display session and local/LAN test paths. No new external service or deploy is required.

## Do not change

- Private personal-task isolation, owner-only status authority, existing member Today/Household visibility and task status semantics, or historical task identity. Do not infer owner authority from Adult/Child classification.
- C-2/C-3A display enrollment, revocation, field allowlist, 60-second stale bound, no durable payload cache, assigned-work execution/receipt/History semantics, or member/display principal separation.
- Responsibility cardinality, group/turn assignment, routine personalization, activity-clear scope, or the meaning of recurring-work progress. Personal-task promotion is not Cover/Claim, multi-owner Dinner Cleanup, twice-daily responsibility authoring, a parental override or personal-task completion from the wall.
- Broader visual overhaul, kiosk platform, project/due-date engine, notifications or hosted release work.

## Acceptance tests

1. **Populated upgrade:** On a disposable database through 016 with private and household-visible open/completed tasks, migrate forward and rerun migration. IDs, visibility, statuses and existing task-status receipts survive; every old task is unpromoted. Backup/isolated restore and foreign-key checks remain valid.
2. **Owner journey:** In the normal member UI, create a household-visible task without promotion, explicitly promote it, remove promotion, and promote an existing task. Refresh/reopen the owner's view and the wall to prove persistence and discoverability. Private creation cannot accidentally promote.
3. **Authority matrix:** A different member (including a manager), display-only session, missing session, foreign household and direct-API bypass cannot change another owner's sharing/prominence. Denied calls have no effect. Same-command replay is idempotent; reused mutation IDs with different task, owner or payload conflict; stale competing sharing edits cannot silently overwrite each other.
4. **Visibility reversal:** Promote Household task, change to Private, then change back to Household. Promotion clears with the first change, the wall drops the item, and re-sharing alone does not restore it. Explicit re-promotion does. Contradictory private+promoted payloads fail atomically. On an already completed task, the same sharing transitions preserve its original reported completion time.
5. **Read matrix:** Test private, household-unpromoted, household-promoted, open, completed and reopened tasks across display dashboard, person detail, both wall summary views and authenticated Household. Private IDs/titles/counts never enter display payloads; unpromoted tasks remain detail-only; promoted undated work never inflates routine/responsibility progress or today's scheduled obligations.
6. **Cross-context recovery:** Owner, another member, manager and two enrolled display contexts observe promotion, withdrawal, completion/reopen and visibility downgrade without reload. Hold an older display read or task mutation response while changing privacy; release it and prove it cannot resurrect withdrawn content. Force missed WS delivery and verify reconnect/visibility/poll recovery. Task events leak no private IDs to nonowners or displays.
7. **Display boundaries:** A promoted personal task offers no status command on the wall, and direct display API attempts to use member task routes fail. C-3A assigned checklist actions still work and retain truthful actor/accountable/performer evidence. Revocation/expiry and D-045 blanking still apply to promoted content.
8. **Presentation and gates:** At phone, 4K wall and scaled display geometry, owner controls and both compact wall summaries are keyboard/touch accessible, legible and overflow-free with zero/many promoted tasks. Run exact `npm run validate:pr` and `npm run validate:rc` including the C-3B selected browser tests, existing C-2/C-3A regressions and Vite `/display` smoke. Record real-wall Product evaluation separately from automated evidence; the Project Lead already reported the C-3A view readable at approximately 10 and 16 feet, which does not prove the changed C-3B view.

## Dependencies

- Technically accepted C-1/C-2/C-3A integrated on `main` at `6510fb4`; current task/status API, display enrollment and local evaluation fixtures.
- Approved P0-007C Product direction in `PRODUCT.md`; Project Lead C-3A feedback in `evaluations/p0-007c-3a-project-lead-evaluation-2026-09-29.md` informs selective placement. No new Design submission or hosted environment is required.

## Relevant decisions

- D-010, D-034, D-041–D-047: personal visibility, reset, Today/Household projections and restricted display authority/recovery.
- D-048–D-049: task promotion state/ownership and privacy-safe wall projection/invalidation (planned for this brief).

## Known risks / assumptions

- Existing personal tasks are undated. Open promoted tasks are intentionally presented as shared personal work, not as work due on the current household date.
- Owner promotion to a shared household screen is distinct from a parent's management authority. This brief does not let the device identify or credit a physical actor for personal-task completion.
- Offline screens cannot receive a visibility downgrade instantly; the accepted D-045 stale/blanking bound limits the remaining exposure. Product evaluation should judge whether this remains acceptable after seeing promoted content.
- The Project Lead found the C-3A wall physically readable at 10 and 16 feet but visually busy. C-3B does not assert that its changed content has passed the same physical review.

## Engineering readiness

**Reviewed revision:** NOT REVIEWED  
**Readiness:** NOT REVIEWED

Engineering should inspect this exact r1 against the merged repository and return one consolidated readiness disposition before implementation.

## Revision history

- **r1:** Initial authoritative contract for owner-controlled personal-task display promotion after C-3A evaluation.
