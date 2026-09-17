# BRIEF P0-006B - Contextual Routine Applicability

**Revision:** 1
**Status:** ACCEPTED

One authoritative contract for this ID. Material changes increment the revision and require Engineering readiness for that revision. Architecture technical acceptance and Project Lead/Product acceptance remain separate.

## Why

A family should be able to keep one Morning Routine with everyday steps and school-specific steps. Routine recurrence answers when the routine runs; step applicability answers which items belong on that day's checklist. This second P0-006 slice delivers that behavior using the accepted P0-006A interaction foundation and a household school calendar.

Source: Planning & Design's supplied **P0-006 - Household Experience Consolidation & Contextual Routines** proposal, preserved in `PRODUCT.md`, and Architecture's three-brief decomposition. The same proposal authorizes this slice; a new Product proposal is not a prerequisite. Profiles, family ordering, History redesign, and activity clearing remain P0-006C.

## Learning question

Can a parent maintain one routine through school days, weekends, and school breaks, understand why a step appears, and correct the calendar without disrupting a child's work already begun?

## Player experience

In Household -> School calendar, a parent sets school-year dates, usual school weekdays, and no-school dates or breaks. In Plan -> Routines, most steps remain Every time. The parent makes Pack Lunchbox apply on School days and Pack school bag apply on School nights. A dated preview explains the result. Updating a break immediately updates applicable unstarted checklists, including today; each person who has already started keeps their original list.

## Project card

**Card title:** Let one routine adapt to school days and breaks

**Suggested column:** Up Next

**Player-facing goal:** Configure the school calendar once and stop duplicating routines to handle different days.

**Done when:** A parent can use one Morning Routine across school days, weekends, and breaks, use a school-night step in Bedtime, and change an exception while seeing unstarted lists update and started work stay intact.

**Tracking relationship:** Second of three slices contributing to P0-006. Implementation -> In Progress; technical acceptance -> Ready to Evaluate; only Project Lead acceptance -> Accepted. P0-006A has now received Project Lead acceptance; P0-006C remains the third planned slice.

## Current system

Implementation baseline: integrated `main` at `7cba3a6` (P0-006A r2 merged via PR #12, including B planning and the A toast/CI correction). P0-006A is technically accepted and the Project Lead reported reviewing screenshots, testing, and being satisfied. Architecture verified the existing `brief/p0-006b-contextual-routine-applicability` branch at readiness commit `25c3c48`, with a clean worktree and no source/schema/test differences from that main baseline. The original planning inspection was A at `183bc41`; its integration prerequisite is now satisfied. Repository facts below remain applicable.

| Surface | Verified repository fact and intended delta |
| --- | --- |
| Calendar/applicability | Migrations end at `008`; no school-calendar persistence exists. `ChecklistStepInputSchema`, `RoutineRevisionPublic`, personal additions/proposals, and the focused step draft contain text/obligation/identity but no applicability. |
| Recurrence/time | `src/domain/recurrence.ts` uses a nonempty ISO-weekday set. `time.ts` resolves household-local dates and calendar-day arithmetic. `validateRoutineSteps` requires at least one Required configured shared step. No context engine exists. |
| Plans/locks | `plan.ts`, `server/routine-plan.ts`, and `store.ts` resolve active schedule entries and reconcile governed dates. Occurrence uniqueness is definition/date/member; `started_at` is monotonic. Context changes must integrate with these mechanisms. |
| Composition | `composeMorningRoutine` composes shared IDs plus personal before/after/end anchors. Store materialization and preview each call it. Filtering must not lose anchored personal content or diverge across these paths. |
| Reconciliation | `ensureOccurrence`, `rewriteUnstartedOccurrence`, and `occurrenceSharedStepsMatchRevision` currently compare against the full shared list. Empty-step repair reinserts steps. These assumptions require deliberate changes for conditional or empty results. |
| History | `historyForDate` calls `materializeForDate`; it is not an isolated historical projection. Calendar edits must not cause a later History read to reinterpret existing past snapshots, even unstarted ones. |
| Client | `RoutineFocusedEditor.tsx` supplies focused step editing; `Routines.tsx` handles current/upcoming drafts. `App.tsx` owns sync/outbox, Personalize/Approvals/Preview, and Household navigation. `nav.ts` has saved destinations but no calendar route. |
| Recovery/security | `mergeAuthoritativeOccurrence` protects pending first actions. `/api/v1` routes have an explicit policy inventory; the sync resource union has no calendar resource. Current grants include structure and shared-routine management but no calendar-management grant. |
| Evidence | Local PR/RC scripts include built-app browser suites and Vite smoke. Existing helpers cover populated P0-001 and P0-004B migrations; this slice needs a populated through-008 baseline as well. Existing A screenshots are accepted evidence and must stay unchanged. |

## Behavioral contract

### 1. A small applicability vocabulary

Each shared step, personal addition, and proposed addition carries one applicability rule. New and migrated items default to **Every time this routine runs**. Persist a closed discriminated value, not UI labels or executable expressions; exact field/storage names are Engineering discretion.

| Choice | Meaning for occurrence household date D |
| --- | --- |
| Every time | Include whenever the routine itself runs and this person participates. |
| School days | Include when the configured calendar says D is a school day. |
| No-school days | Include when the configured calendar says D is not a school day, including weekends and dates outside school-year ranges. |
| School nights | Include when D + 1 calendar day is a school day. Evaluate tomorrow with the calendar edition selected for this occurrence; do not hard-code Sunday/Friday or require a particular daypart. |
| Weekdays | ISO Monday-Friday, independent of school context. |
| Weekends | ISO Saturday-Sunday, independent of school context. |
| Selected days | A nonempty, deduplicated ISO-weekday set. |

No AND/OR builder, nested rules, time-of-day conditions, negative custom expressions, or per-person calendars. A School days step never creates a routine on a weekday excluded by the routine's recurrence. Obligation remains independent: an included Required/As needed/Optional step retains its existing meaning; excluded steps neither block completion nor create Not needed reports.

### 2. One household school calendar

- Add **Household -> School calendar**, a focused read-first destination at `/household/school-calendar` using the A shell, integrated Back, and explicit Edit. All active household members may read it. A dedicated `household.schedule.manage` grant authorizes writes, independently of age/classification. Add it to the manager preset; migration grants it only to existing memberships holding `routine.shared.manage`. Structure-only, enrollment-only, and personalizer grants do not imply calendar authority. No permissions editor is added.
- One calendar holds school-year ranges with inclusive start/end dates and a nonempty usual-school-weekday set per year (Monday-Friday as the editable default). Permit successive, nonoverlapping years in the same calendar so preparing next year does not replace the current year. Each year may have named, inclusive no-school date/range exceptions; a single date is a one-day range. Exceptions override usual weekdays, must lie within their year, and may overlap with union semantics. Retain stable year/exception IDs through edits. Validate real dates, including leap years, ordered bounds, and nonoverlapping years at the server; malformed input cannot be silently normalized by JavaScript date rollover.
- School day is true exactly when D is inside a configured year, matches its usual weekday set, and is outside its no-school exceptions. Once configured, dates outside all years are No-school days; show the configured coverage so next-year maintenance is discoverable. No forced school-day exception, external import, academic-calendar service, or holiday lookup is included.
- Before the first calendar save, school context is **not configured**, not Monday-Friday and not No-school. A draft may select a school-dependent choice, but saving a shared/personal rule or submitting/approving such a proposal requires a configured calendar, checked server-side. Retain the draft and explain that a calendar manager must set up School calendar first. Other choices work without a calendar. A preview lacking a calendar edition reports unresolved context, never a guessed result or successful completion. A configured calendar requires at least one year; deleting/resetting the entire calendar is deferred. Removing/revising an exception is ordinary configuration editing.
- Calendar editing uses a single local draft with Save/Cancel, field errors, and the A dirty-leave behavior. No save per keystroke, checklist-outbox queueing, or automatic draft overwrite on sync. An ordinary Save needs no extra confirmation; acknowledged success uses the existing toast. Conflicts/failures retain the draft with an explicit reload/review path.

### 3. Date semantics and retained calendar editions

- Household-local date is authoritative for applicability, calendar-save effective date, School nights, and protected history. Use calendar-day addition, not 24-hour duration arithmetic or the device timezone.
- Save appends an immutable calendar edition with a server version and effective-from household date of today. Repeated saves today refine the same intended date; they never drift to tomorrow. The latest committed edition effective on or before an occurrence date supplies its calendar. Use that same edition to evaluate both D and D+1. If no edition existed by D, school context for a newly computed past preview is unconfigured.
- Configuration can describe future years/exceptions immediately; no separate future calendar activation workflow is needed. Retain prior editions referenced by evidence. Snapshot the edition identity (or explicit legacy/unconfigured provenance) and sufficient applicability/context facts with evaluated occurrences so started work and history are explainable without consulting today's calendar. No per-day precomputation table or unbounded calendar generation is required.
- Existing prior-date snapshots are authoritative, whether started or unstarted. Calendar/configuration edits do not rewrite them. A read that computes a date with no stored occurrence uses the edition effective for that date and must not invent execution evidence. This does not redesign History or permit retrospective execution beyond existing policy.

### 4. One composition result for execution and preview

- Resolve the governing routine plan, recurrence, dated direct/group audience, personal layer, and calendar for the requested date. Compose the complete shared/personal order using stable IDs **before filtering** each item's applicability. A personal addition anchored to a conditionally hidden shared item keeps its place relative to surviving neighbors; it is not hidden merely because its anchor is hidden. A truly retired anchor retains the existing missing-anchor fallback. Reordering carries the rule with its item.
- Personal additions use the same choices under existing direct/proposal authority. Direct edits keep the existing tomorrow-or-later effective-date policy; proposals store their rule at submission, display it to the approver, and approval uses that stored rule. Children cannot change inherited shared rules or the calendar through personal/proposal payloads. No new same-day personal-write behavior is authorized.
- Routine read/detail and current/upcoming editors show **all configured** steps, with concise nondefault applicability labels. Execution surfaces show the evaluated applicable subset. A read-only, date-selectable routine preview reachable from detail explains included/excluded steps and reasons; it neither materializes work nor writes reports. The existing Personalize/approval preview uses the same evaluator, own-member/manager visibility policy, and date semantics. Distinguish plan preview from an already-started person's frozen checklist.
- If recurrence/participation excludes the routine, preview says it does not run for that date/person. If recurrence applies but no composed steps apply, show **No steps apply on this date** in preview and omit it from actionable Today/Household progress and completion totals. Preserve the routine in Plan. Do not create a completed empty checklist or reinsert filtered steps as an empty-list repair. Retained unstarted rows may become eligible again when configuration changes; preserve their occurrence identity and do not reactivate ended/canceled work contrary to lifecycle rules.
- A definition still requires at least one configured Required shared step, as today; applicability does not require an Every-time Required step or a blocking step on every possible date. Optional-only evaluated lists retain existing obligation semantics. Reading/automatic completion calculation never sets the execution lock.

### 5. Reconcile editable work without changing protected evidence

- Shared rule edits follow D-024: current plan from household today to the next intentional schedule boundary; upcoming edits use that entry's governed range. Calendar edits affect every consuming routine/date in the household, **including beyond the next routine boundary**, evaluating each date's own current/upcoming plan. Do not rewrite routine revisions or insert schedule entries to represent a school break.
- On save, reconcile existing eligible unstarted occurrences for today and affected future dates. Ensure today's newly applicable work is available through the normal read path; future dates not yet materialized resolve lazily. School-night dependencies include the preceding date of a changed school day, clipped at today. End/archive cutoffs, recurrence, dated groups, personal effective dates, and future-execution denial still apply.
- Preserve started/completed structure per definition/member/date, including text, order, obligation, applicability provenance, accountable person, and step IDs. Undo never unlocks. A started child stays visible and actionable under the original snapshot even if context now filters all those steps; an unstarted sibling updates independently. Preserve all existing past-date snapshots and execution/receipt facts.
- Calendar save, version check, affected persisted-row reconciliation, and replay receipt commit atomically; publish invalidations after commit. A failure leaves the prior calendar and occurrence graph intact. Repeated reads or an edit with no evaluated structural effect must not churn step IDs, emit execution reports, or produce repeated version inflation. Reappearance of a filtered item may allocate a new occurrence-step ID; never retarget an old command to a new step by position/text.
- First action versus a calendar/rule edit has a deterministic serial outcome. If action commits first, preserve that started snapshot. If edit commits first, an action against obsolete structure must fail visibly without a report/lock/receipt claiming success. Recheck date, identity, applicability, participation, step, and obligation in the mutation transaction; an offline `performedAt` cannot resurrect a filtered item. Already-committed retries remain idempotent.
- Pending local first-action intent continues to protect the displayed structure until acknowledged or explicitly resolved. This includes the server omitting a now-empty occurrence from a refreshed list: do not silently drop the card or queued intent. Reconnect/reload must expose any rejection and recovery path, without auto-discard, falsely completed work, or replay under another membership.

### 6. API, replay, synchronization, and migration

- Calendar reads/writes derive household and actor from the session. Writes require the new grant, existing Origin/CSRF policy, expected calendar version, and mutation ID. Concurrent initial setup is also version guarded. Identical replay returns the original result; reuse with a different household/kind/payload conflicts without disclosure. Revalidate current authority on retries. Exact route names and envelope fields are Engineering choices recorded in the report and route inventory.
- Extend routine mutation digests to bind applicability as well as existing IDs/order/fields. A duplicate mutation ID with a different rule cannot be accepted as the old write. Preserve successful legacy Every-time receipt replay through explicit compatibility handling; migration must not invalidate prior receipt evidence. New calendar receipts/state are transactional.
- New clients round-trip explicit rules. Legacy payload omission may default to Every time for new or legacy Every-time content, but must not silently clear a stored nondefault rule on an existing shared/personal item. Reject such a stale payload with a recoverable reload message; explicit Every time remains a normal authorized edit. Apply this at the intended routine/personal revision, not by matching labels.
- Add a calendar invalidation resource or a clearly equivalent documented extension to the existing sync channel. Refresh affected Today/Household progress, open calendar reads, and open dated routine/personal previews after save, reconnect, or visibility recovery. Calendar changes need not bump routine definition versions; clients cannot rely solely on routine version to refresh a context-derived view. Duplicate/late notifications and older responses must not overwrite newer state, navigate the user, or replace dirty drafts. Sync emits no ordinary success toast on another device.
- Add forward migrations after `008`; never edit applied migrations. Default existing shared steps, personal additions, and proposals to Every time. Preserve IDs, schedule entries, locks, statuses, audit, receipts, users, memberships, grants other than the stated backfill, and stored historical structure. No school years or holidays are guessed or auto-seeded in normal use. New snapshot provenance may be explicitly legacy/unconfigured.
- Add a disposable populated through-008 migration fixture containing current/upcoming/ended plans, dated groups, started and unstarted current/future/past occurrences, personal layers, pending/decided proposals, and administrative/step receipts. Retain P0-001/P0-004B coverage. Prove migration idempotency, foreign-key integrity, post-upgrade writes, and backup/isolated restore. Do not migrate or use `runtime/dev.sqlite` as test evidence.

### 7. UI continuity

Reuse A's compact rows, focused step editor, drag/non-drag ordering, summary draft, More lifecycle menu, tokens, toast, and dirty navigation protections. Applicability belongs in a selected step's editor, not as a recurrence form on every row. Selected days reveals its weekday choices only when selected. Calendar year/exception editing is focused and readable on a phone; its content is not stacked into Household's directory or each routine.

New calendar URLs reload in both Vite and the built SPA, resume under sign-in authority, and use logical-parent Back. Keep Today/Plan/Household and session/sync/outbox owners intact. Preserve keyboard/focus/44px targets, readable wrapping at enlarged text, and phone/wide layouts. No new general-purpose component framework or calendar-grid library is required.

## Implementation boundary

- `src/domain`: a small pure applicability/calendar evaluator using `time.ts`, existing plan/recurrence/composition/lock helpers; no generic rules engine.
- `src/shared/schemas.ts`, `grants.ts`: closed rules, calendar contracts/versions, snapshot/preview views, new grant and notification type.
- `db/migrations` after 008; `src/server/store.ts` and cohesive calendar helpers; existing migration runner, authenticated API routes, mutation receipts, sync, and route policy. Extract locally where needed, without refactoring unrelated services.
- `RoutineFocusedEditor.tsx`, `Routines.tsx`, `App.tsx` personal/proposal/preview flows, `api.ts`, `nav.ts`, a focused calendar view, and small style extensions using A patterns.
- Extend `docs/protected-behaviors.md` and its sync matrix, route-policy completeness tests, fixtures, unit/integration/e2e evidence, and factual `ARCHITECTURE.md` discoveries. Keep existing validation tiers.
- Suggested implementation checkpoints within this one brief: (1) migration/evaluator/compatibility; (2) server reconcile/authority/replay; (3) calendar/step/preview UI and sync; (4) required evidence. These are not separate deliverables or permission to stop at an API-only result.
- Readiness: `reports/P0-006B-r1-engineering-readiness.md`. Build Report: `reports/P0-006B-r1-build-report.md`. New fictional visual evidence only: `reports/p0-006b-r1-screenshots/`.
- Planned branch: `brief/p0-006b-contextual-routine-applicability`. Project Lead manages Git. Suggest commit messages but do not commit, publish, merge, or deploy.

## Do not change

- No P0-006C profiles, family ordering, History summary redesign, or activity/history clearing. Preserve that third brief's approved intent.
- No new responsibilities, rotations, helpers, swaps, chore debt, Skip Day, homework, meals, notifications, calendar import, per-person school schedules, or multi-household UI. Household isolation remains mandatory.
- No change to routine recurrence/daypart vocabulary, group next-day policy, personal tomorrow-floor, first-action lock, current/upcoming lifecycle, or Delete/End eligibility except the specified applicability evaluation.
- No auth/session changes, relaxed origin/CSRF/WS policy, email requirement, real household test data, destructive fixture cleanup, live database mutation, or hosted iteration.
- Preserve optimistic checklist response, durable outbox identity protection, personal-task privacy, and accepted A navigation/accessibility/reorder behavior. Do not rewrite prior screenshots to make existing tests pass.

## Acceptance tests

Every row is required. Reuse existing regression evidence where it actually proves the behavior; name the test and new assertions. A type/schema or code path alone is not behavioral evidence. No hosted environment or physical device is required.

| AT | Required result and evidence |
| --- | --- |
| 1. Upgrade continuity | Populated through-008 migration plus existing supported baselines preserve IDs, snapshots/locks, schedules, personal/proposal/receipt records and authority. Every-time default and exact grant backfill are verified; no calendar inferred. Reapply is semantically unchanged; FK check and backup/isolated restore pass; legacy replay still works. |
| 2. Calendar truth | Unit/integration cases cover inclusive year bounds, custom usual weekdays, single-date/range/overlapping exceptions, multiple nonoverlapping years, outside-year summer/weekends, unconfigured context, invalid/leap dates, household midnight/DST, and a device in another timezone. |
| 3. School nights | Sunday before school Monday includes the item; Sunday before Monday holiday omits it; the evening before the first school day includes it. An unusual configured Saturday school day makes Friday a school night. Adding/removing tomorrow's exception updates today's unstarted bedtime list, never yesterday's snapshot. |
| 4. Calendar workflow/authority | Normal UI setup -> save -> read -> edit/remove exception -> save -> reload works. HTTP tests cover unauthenticated/foreign household, allowed reader without write grant, denied structure-only/enroll-only/personalizer writes, allowed schedule-manager write, Origin/CSRF, current-grant checks, and route-policy completeness. |
| 5. Applicability authoring | Normal UI creates and edits rules on current/upcoming shared steps and direct/proposed personal additions; default, all seven choices, Selected days validation, section Done/Cancel, outer discard and failed-save recovery work. Preview/read rows disclose the rule; drag and Move preserve rule/ID/order; approved proposals use the stored rule without gaining shared/calendar authority. |
| 6. Composition/empty results | Evaluator tests cover recurrence/participation exclusion, filtering before execution, applicable obligation totals, all-filtered and unresolved cases, optional-only lists, hidden anchor with surviving personal addition, retired-anchor fallback, cross-routine isolation, and idempotent no-op reads. No false empty completion, synthetic Not needed reports, or empty-list repair loop. |
| 7. Governed ranges | Prematerialize today and multiple future dates on both sides of a scheduled boundary. Shared rule edits affect only their interval. Calendar exceptions affect all relevant dates using each date's own plan/group/personal layer, without changing routine versions/boundaries. Removing an exception restores eligible work without duplicating occurrences; End/legacy archive remains respected. |
| 8. Protected history/locks | Two members share a routine: one starts (including Not needed and Optional first-action cases), one does not. Rule/calendar edit updates only the unstarted member. Undo stays locked. Existing yesterday snapshots, including unstarted ones, remain identical on History reads. New past preview uses the historical calendar edition; repeated current-day saves retain original started provenance. |
| 9. Races/replay/rollback | Execute both serialized edit-vs-first-action orderings; obsolete step submission cannot mutate the new list. Concurrent calendar writers conflict, same-ID/same-payload retries return the original result, changed applicability/payload conflicts, and cross-household replay discloses nothing. Legacy omitted rules cannot erase existing nondefault rules. Inject a reconciliation failure and prove calendar/occurrences/receipt roll back together with no invalidation. |
| 10. Pending intent | Browser queues a first action during a disconnect while another manager changes context, including filtering the entire occurrence. The pending card/intent survives refresh and reload; reconnect either acknowledges the committed snapshot or shows recoverable rejection. No silent drop, retarget, false completion, or identity crossover. |
| 11. Live context | Two authenticated contexts: manager changes/removes a no-school exception while the other holds Today or dated preview open. Included steps and explanation update without reload; started work stays intact. A second calendar reader refreshes, a dirty calendar/routine draft survives with conflict handling, and missed/duplicate/late notifications recover through reconnect/visibility reads. |
| 12. Connected Product journey | Chromium and WebKit at phone width drive Household calendar setup -> Plan single everyday Morning Routine -> School days lunchbox step -> school/non-school previews -> exception edit -> unstarted update -> start one child -> calendar edit -> locked child retained. Include the School-night bedtime path. Date fixtures/clocks are isolated and deterministic; no overnight waits or hosted testing. Writes being demonstrated must go through normal UI. |
| 13. Presentation/navigation | Representative phone (390x844) and desktop (1280x800) evidence shows calendar summary/editor, compact rule editing, dated preview/reasons, and started/unstarted divergence. New surfaces remain usable at 360px and enlarged text with no masked overflow, usable focus/labels/targets and reachable actions. Calendar copied URL/reload/sign-in and dirty Back/primary navigation work in built SPA and Vite. |
| 14. Regression/report | Exact `npm run validate:pr` and `npm run validate:rc` pass, including existing Vite smoke and A regressions. Extend the protected catalog/sync matrix. Report each AT with evidence, commands, any skips/limitations, migration/replay choices, and actual commit state. Keep all earlier screenshots unchanged; capture only fictional B evidence. |

Browser evidence supplements pure-domain and transactional tests; do not substitute mouse-only phone tests for the accepted A touch path. Full screen-reader certification, live host checks, and real-phone evidence are not claimed. Product evaluates whether the calendar and explanations are understandable after technical acceptance.

## Dependencies

- Accepted P0-006A r2, its closed evidence gaps, Project Lead acceptance, and the B planning baseline are integrated at `main` @ `7cba3a6`. The existing B branch contains committed readiness at `25c3c48`. The integration/branch prerequisite is satisfied; continue that branch and record the actual implementation base in the Build Report.
- Existing P0-005 r3 plans/locks/lifecycle and local validation tiers. No new Product proposal, paid service, secret, calendar feed, or deployment is needed.

## Relevant decisions

- D-004/D-011: authoritative shared state, durable checklist intent, local-first evidence.
- D-006/D-008/D-018/D-020: capability/membership identity, personal anchors, dated groups, per-routine scope.
- D-021/D-023-D-025: recurrence/dayparts, first-action locks, governed intervals, Delete/End.
- D-027/D-028: responsive saved destinations, focused drafts/feedback, accessible ordering.
- D-029: closed step applicability and a household school calendar.
- D-030: retained context editions and reconciliation with protected execution.
- D-031: calendar authority and compatibility-preserving migration/replay.

## Known risks / assumptions

- One school calendar is the approved initial household context. Different schools, forced school-day overrides, work calendars, and external feeds remain later; their absence must not become extra conditions in this rule vocabulary.
- The legacy store has full-list comparison/empty repair and History/materialization coupling. Testing only newly created routines is insufficient; calendar edits on previously materialized and historical data are required evidence.
- Calendar changes span definitions and scheduled intervals. A definition-version-only refresh guard is insufficient, and broad step regeneration can invalidate unrelated pending actions. Prove semantic no-op behavior and transactional ordering.
- Existing personal composition order is retained except for the specified applicability filter. Do not turn this into a general personal-order redesign.
- Actual SQL/table names, route spellings, module splits, payload field names and test organization are Engineering choices. Resolve concrete repository contradictions in the consolidated readiness review; minor choices are not gates.

## Engineering readiness

**Reviewed revision:** 1

**Readiness:** READY

**Report:** `reports/P0-006B-r1-engineering-readiness.md` (committed in `25c3c48`).

**Architecture disposition:** ACCEPTED. Engineering closed the required AT9–AT11 evidence gaps with injectable transaction-failure rollback coverage and multi-context Chromium/WebKit browser journeys for pending first-action retention, live calendar invalidation, dirty-draft conflict, reconnect, and visibility recovery. `validate:pr` and `validate:rc` pass, prior screenshots remain clean, and no deployment was required. This is Architecture technical acceptance; Project Lead/Product acceptance remains separate.

## Revision history

- **r1:** Second slice of the approved P0-006 proposal: step applicability including School nights, household school calendar, dated previews, context reconciliation, protected execution/history, and local evidence. Includes personal/proposal rule propagation under existing authority; leaves profile/history redesign and clearing to C.
- **r1 readiness:** READY against integrated `main` @ `7cba3a6`; Architecture accepted the Build Report after the AT9–AT11 evidence correction committed at `8421b31`. Contract and acceptance tests are unchanged.
