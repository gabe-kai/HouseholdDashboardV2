# BRIEF P0-007A - Household Responsibility Foundation

**Revision:** 1
**Status:** IN REVIEW

One authoritative contract for P0-007A. Material changes increment the revision and invalidate prior readiness. Architecture technical acceptance and Project Lead acceptance of the experience are separate.

## Why

The approved P0-007 proposal asks whether Kitchen, Cats, Bathroom, and Trash can be ordinary household responsibilities alongside routines. The foundational difference is accountability: a routine occurs independently for each participant; a responsibility occurs once for the household on an applicable date, with one accountable person.

This first vertical slice proves **daily Cats and weekly Trash with fixed accountability**, from Plan creation to Today execution, Household oversight, and recorded History. It reuses the accepted checklist, lifecycle, outbox, and synchronization foundations. Cats rotation is deferred to B, not represented as delivered by A.

Delivery sequence for the same approved proposal:

- **A (this contract):** usable responsibilities with fixed ownership and base work, including the minimum connected Today/Household/History integration.
- **B (likely next):** repeating accountability patterns, group eligibility, scheduled work, and Kitchen/Bathroom's combined base/deep-clean occurrence with concrete assignment previews. Deep-clean ownership should determine the whole occurrence's owner, per Product. Exact pattern/collision policy is not authorized by A.
- **C (later in this proposal):** the fuller Completed / Next / Later / Anytime Today hierarchy and coherent cross-household-work oversight. A's necessary integration is its starting point, not work to postpone until C.

Only A is an implementation brief now. B/C do not require a replacement Product proposal merely because they are separately briefed; return only material unresolved user-visible decisions to Product.

## Learning question

Can a parent create daily Cats and Tuesday-evening Trash once, recognize one owner for each occurrence, and see the child execute that work alongside routines without extra navigation or duplicate household work?

## Player experience

A parent opens Plan, adds a Household responsibility, and edits compact Name, When, Who, and Work summaries. Cats happens every day for a selected child; Trash & Recycling happens on Tuesday in the Evening for another. Each has one checklist. Both appear beside the owner's routines on Today, using the existing daypart order and immediate checklist interactions. Household activity shows compact owner/progress summaries; History retains what was expected and what was recorded.

Fixing an unstarted checklist or its owner today takes effect today. Once anyone has validly begun that occurrence, its checklist and accountable person stay fixed. Ordinary plan changes affect subsequent unstarted work. An unused mistake can be deleted; a used responsibility can be ended without losing history.

## Project card

**Card title:** Give Cats and Trash one owner and a place in Today

**Suggested column:** Up Next

**Player-facing goal:** Create shared household work once and make each person's daily responsibility clear.

**Done when:** A parent creates daily Cats and weekly Trash through Plan, the assigned child completes them alongside routines, and another authorized view shows progress and retained History without manual refresh.

**Tracking relationship:** First usable card within P0-007 - Household Responsibilities & Multi-Responsibility Today. No external board is configured. Implementation -> In Progress; technical acceptance -> Ready to Evaluate; Project Lead acceptance alone -> Accepted.

## Current system

Inspected on clean integrated `main` at **`409d147`**, merge PR #14. P0-006C implementation `5605ab8` and correction `e8a93d5` are integrated. Technical acceptance is recorded; exhaustive Product acceptance is not inferred from the merge.

| Repository evidence | Relevant fact / required delta |
| --- | --- |
| `package.json`, `src/server/db.ts` | One Node 24 / React / Fastify / SQLite application. Ordered forward migrations run through `010_household_profiles_useful_history.sql`; no external runtime service is needed. |
| Migrations `005`, `006`, `007`, `009`, `010`; `src/server/store.ts` | Stable routine definitions, immutable revision content, dated schedule entries, occurrence locks, cancellation, calendar provenance, household activity generation/reset floor. Occurrence uniqueness currently includes `(definition_id, household_date, accountable_member_id)`. That key alone cannot enforce one household responsibility per date. |
| `src/server/store.ts::materializeForDate` | Iterates routine definitions and resolves direct/group participants; started survivors remain. Responsibility resolution must select a single owner before shared snapshot/execution processing. |
| `src/domain/time.ts`, `recurrence.ts`, `plan.ts`, `daypart.ts`, `completion.ts`, `occurrence-lock.ts` | Existing reusable date, weekday, interval, daypart, completion, and first-action rules. Current creation validation requires a nonempty checklist with at least one Required item. |
| `src/shared/schemas.ts`, `src/shared/grants.ts` | No responsibility kind or grants yet. Routine-only personal layers/proposals, occurrence projections, and public History types need explicit domain separation. Step reports distinguish accountable and acting members and performed/recorded times; no separate actual-performer field exists. |
| `src/client/App.tsx`, `outbox.ts`, `src/domain/reconcile.ts` | A shared occurrence checklist, membership-namespaced IndexedDB outbox, pending snapshot retention, generation reset handling, and WS/reconnect/visibility recovery exist. Today currently renders routines in daypart order and personal tasks separately. |
| `src/client/nav.ts`, `Routines.tsx`, `RoutineFocusedEditor.tsx`, `OrderedList.tsx` | Plan currently opens Routines; focused editors, dirty-leave guard, lifecycle actions under More, drag/Move-menu ordering, and saved URL navigation are available. |
| `History.tsx`, `HouseholdSettings.tsx`, `store.ts::historySummaries/clearRoutineActivity` | History reads stored records without generating work; reads require `routine.shared.manage`. Clear currently says routine activity, deletes the shared occurrence graph/receipts, and advances one household generation/floor. Adding responsibility rows requires deliberate scope/confirmation compatibility. |
| `src/server/route-policy.ts`, `docs/protected-behaviors.md`, `tests/helpers/p009-fixture.ts` | Route-policy completeness, protected behavior/sync inventory, and populated migration fixtures exist. A populated **010** upgrade fixture is needed in addition to prior supported baselines. |

## Behavioral contract

### 1. Distinct accountability over shared foundations

- Add a closed definition kind, **routine** or **responsibility**, immutable after creation. Backfill all existing definitions/occurrences as routine. Do not infer kind from a title, audience size, or daypart.
- Extend the existing definition/revision/schedule and occurrence/step/report/receipt foundations with explicit kind-aware resolution. Existing `routine_*` SQL names may remain as legacy internal names; avoid a wholesale rename or duplicated execution/history stack. Engineering chooses exact columns/modules and may extract cohesive shared helpers.
- Routine cardinality stays one per definition/date/participating membership. Responsibility cardinality is **one per definition/household date**, independent of accountable membership, including retained canceled rows. Enforce at the database boundary as well as in the resolver; a per-member unique key is insufficient. An unstarted owner change updates the same occurrence identity, not a second person's copy. Definition/occurrence kinds and household references must agree.
- A responsibilities API family under `/api/v1/responsibilities` exposes responsibility management. Existing routine APIs, routine lists, group used-by projections, Personalize, proposals, and personal layers remain routine-only. Passing a responsibility ID to routine-only operations (and conversely) is rejected before mutation/disclosure, even if the caller holds both grants.
- Use one shared client occurrence projection with explicit kind and stable IDs for checklist execution, Today, and History. Legacy routine snapshots/outbox entries missing kind normalize to routine. This does not turn one-off personal tasks into recurring occurrences.

### 2. Small recurrence and assignment contract

- A responsibility revision contains title, a nonempty ISO-weekday set, the existing daypart vocabulary, exactly one fixed household-membership ID, and ordered base steps. Presets Every day / Weekdays / Weekends / selected days map to weekday sets. Tuesday + Evening represents Trash; no artificial clock time, date inferred from device timezone, or new weekly domain type.
- Who selects **one person**, in saved family order. All existing non-removed household people are selectable, including pending access; classification and login availability do not define eligibility. Show that a pending person needs access before they can execute. The assignee must belong to the session household. No group audience, empty assignment, array of assignees, auto-substitution, rotation, or helper field is accepted in A.
- Base Work uses stable logical item identity and existing Required / As needed / Optional rules. Snapshots retain the originating plan and base-item identity, so B can add scheduled-work provenance without relabeling old work. Preserve the current nonempty/at-least-one-Required authoring validation. Every base item applies whenever this responsibility occurs; scheduled work and non-default step applicability are deferred to B and must not be silently accepted/ignored by the A API.
- New definitions begin on household today; no occurrence before creation's effective date. Repeated reads/restarts cannot duplicate a date. Non-applicable days have no actionable responsibility. A stored incomplete Tuesday stays Tuesday's evidence; Wednesday receives only its own normally applicable work. No rollover/debt or invented missed-day history.
- Detail offers a read-only **Next 7 days** preview using household dates, names, recurrence and planned changes, explicitly indicating days with no work. This preview does not materialize occurrences or lock anything. Where a stored started occurrence differs from a new plan, preview must show that day's protected owner/work accurately. No assignment algorithm is exposed.

### 3. Current plans, deliberate future changes, Delete and End

- Reuse D-024's current-plan interval semantics. Ordinary Save updates unstarted today and already-materialized later work until the next intentional schedule boundary; future reads use the same plan. Repeat edits never drift to tomorrow/the next free day. Preserve stored prior dates and all started structures/accountability.
- Use the established **Schedule for later** flow under More for intentional future plan changes (title, recurrence, daypart, owner, work), with create/edit/move/delete upcoming, expected version, stable entry identity, and recoverable date collisions. Deleting an upcoming change restores the predecessor through the next remaining boundary. This is a future plan change, not B's additional weekly work.
- An unstarted owner change removes the card from the former owner's authoritative Today and places the same occurrence with the new owner. Once started, that date remains with its original owner; no second occurrence for the new owner. Recurrence exclusion, End, or later owner changes cannot hide a started survivor. Save feedback states whether today's work changed or is already in progress.
- Recurrence edits may omit and subsequently restore an unstarted occurrence within an editable date range. Reuse that date's retained occurrence identity with the newly governing structure/version; do not leave an accidental exclusion permanently canceled or create a duplicate. Ended/deleted plans do not revive this way, and old structural commands still fail.
- **Delete responsibility** removes unused configuration and unprotected generated rows only after transactional reference checks. Started work, reports/checklist receipts, or retained prior-date occurrence history require **End responsibility** instead. Administrative save receipts and mere current/future materialization do not make an unused mistake permanent. Minimal deletion/replay evidence prevents stale commands from recreating it.
- **End responsibility** cancels today's and future unstarted work and upcoming schedule entries, preserves prior-date/started evidence, and permits original-owner execution/undo of retained started work. Ended details remain reachable secondarily; no restore or new configuration changes on an ended/deleted definition.

### 4. First execution locks work and ownership together

- The first committed Complete or valid As-needed Not needed action locks the occurrence's entire expected structure **and accountable membership** monotonically. Undo does not unlock either. Viewing/materializing is not execution.
- Validate kind, household, current authority/owner, date, cancellation, intended structure, step membership/obligation, activity generation, and replay binding within the same serialized write boundary as execution. Edit/reassignment/End/Delete and first action must have one explainable winner.
- Responsibility checklist commands carry the structural identity the child acted on, distinct from the status version, from the enqueued snapshot through retries. If a structural edit/reassignment wins first, stale intent is rejected visibly without marking a replacement checklist or a new owner's work. If the action wins first, later plan changes preserve that day's snapshot/owner. Unrelated status changes do not make a burst of taps structurally stale.
- Continue shared desired-state commands, globally unique mutation IDs, durable optimistic intent, and version-aware response arbitration. Replay binds household, actor, occurrence, step, kind, generation, and intended command; mismatch conflicts without returning another resource's payload. Existing legitimate routine receipts/pending entries remain compatible. No new checklist outbox or WS channel.
- Keep accountable person, authenticated actor, and actual performer separate. For new responsibility execution records explicitly store the self-performing member separately from actor/accountable IDs; the A normal path sets all three to the authorized owner. Existing historical rows have unknown performer unless already evidenced; do not fabricate a backfill. Clients cannot nominate another performer. Completion/undo are action facts, not a credit/scoring system.
- Future-date execution is denied; existing durable delayed-command semantics remain, subject to generation and valid historical ownership/structure. No retrospective-completion UI is introduced. Error/pending controls permit retry/discard; never silently drop an ordinary rejected tap.

### 5. Explicit capability boundaries

- Add `responsibility.manage` and `responsibility.execute.own`. Upgrade existing `routine.shared.manage` holders with the former and existing `routine.execute.own` holders with the latter, once in a forward migration. Manager preset gets both; existing personalizer presets get execute-own only. Never infer grants from age, group, or assignment and never re-grant on every startup.
- Management, full-household responsibility execution projections/oversight, and responsibility History require `responsibility.manage`. An owner with `responsibility.execute.own` can read/act on their own execution view. Like routine definitions, same-household signed-in members may read responsibility configuration/preview; this does not grant execution or management.
- History and mixed execution reads enforce each work kind's authority independently: a routine-only manager sees authorized routine history; a responsibility-only manager sees authorized responsibility history; a holder of both sees both. Filter choices/counts/detail cannot leak the other kind. Management alone never authorizes checking off somebody else's work.
- Shared checklist endpoints derive kind and grants from the stored resource. New grants must not become a bypass through legacy routine/personal/proposal routes. Origin/CSRF, auth expiry, foreign-household IDs, and household WS scope remain enforced. Plan/History reachability reflects either relevant management grant, without widening the other kind's authority.

### 6. A connected, bounded experience

- Keep Today / Plan / Household. Plan lists Routines and Responsibilities with an Add choice; preserve `/plan` and routine URLs. Add `/plan/responsibilities/:definitionId` for read-first detail, including ended detail. Empty-state/create/save returns to a useful selected detail. Saved links reload in built local and Vite modes and resume after sign-in subject to authority.
- Creation/edit follows focused Name / When / Who / Work summary rows, one outer draft, Back/focus restoration and existing dirty Keep/Discard behavior. Use familiar names and a single-person picker. Reuse `OrderedList` drag handle + keyboard Move menu; preserve logical item IDs. Lifecycle actions remain under More. Ordinary success is a toast; conflict/error/durable pending stays visible. Refresh never overwrites a dirty draft or retargets its expected version.
- Today mixes owned routine and responsibility cards in the existing deterministic daypart order, with per-card execution permissions and one checklist interaction. Update routine-only empty/copy where now inaccurate. Keep untimed work Anytime with no fake due time; personal tasks retain their existing separate treatment in A. The fuller Next/Later prioritization is C.
- In existing **Household activity**, add compact responsibility rows with title, accountable name, progress, and neutral Not started / In progress / Complete state. Open one row for read-only checklist detail, then Back to the same list context. Do not expand every responsibility checklist in the overview. Existing routine oversight remains available. Existing occurrence IDs drive detail identity; a new global Chores destination is out of scope.
- Extend existing History to date -> person in family order -> mixed work summaries and drill-down. Offer a work filter encompassing responsibilities while retaining existing saved routine filters. Historical title/daypart/checklist/accountability come from snapshots; current friendly names may label stable IDs. Show accountable/actor/performer and performed/recorded facts truthfully. No second history subsystem, speculative backfill, or History materialization/reconciliation, including today.
- Extend existing invalidation and authoritative refresh paths for responsibility create/edit/schedule/delete/end and execution. Open Plan/detail/preview, former/new owner's Today, Household activity and History must converge without navigation/reload. New kind survives outbox serialization/reload. Reconnect/online/visibility recover missed events; delayed responses cannot restore an obsolete owner, deleted entry, or cleared activity. Active dirty drafts retain local edits with a conflict path.

### 7. Shared activity clearing with an explicit scope

- Extend the P0-006C evaluation action to **Clear activity history**. Its single confirmation explicitly names **routines and responsibilities**, says setup remains, and states no in-app Undo. Keep the existing environment gate and `household.activity.clear`; no routine/responsibility management grant substitutes for clear authority.
- New UI requests explicitly acknowledge the all-recurring-work scope; bind that scope into reset replay. An old routine-only request must not newly erase responsibility data: if responsibility definitions or activity exist, require the updated confirmation before any mutation. Routine-only households retain the legacy request behavior, and previously committed reset receipts replay without a second clear.
- Delete the target household's routine/responsibility occurrences, steps, reports and verified checklist receipt payloads atomically with the shared generation increment/reset floor and minimal reset receipt. Keep both kinds' plans/schedules/lifecycle/configuration receipts, identity/access/profiles/order, groups, school calendar, personal layers/proposals, and personal tasks. Do not retain erased step content in reset audit.
- Both kinds obey the same generation fence: offline commands/late replies from before reset cannot restore activity; current/future work rematerializes with new IDs, earlier dates do not. Retain P0-006B's same-generation pending-card protection during ordinary edits/omission. Reset tests use disposable fictional databases only.

## Implementation boundary

- Forward migration(s) after 010; shared definition/occurrence kind, responsibility uniqueness and fixed-owner persistence, performer facts, grant backfill, receipts/constraints, and upgrade compatibility. Keep legacy IDs and FK relationships. Exact schema representation is Engineering discretion within the shared-foundation decision; no new service or universal task framework.
- Domain helpers for kind-specific participation and common date/plan/completion/lock rules; `src/server/store.ts` and cohesive extracted services; schemas/grants; Fastify routes/policy; shared sync. Responsibility generation bypasses routine personal composition and group audience expansion.
- Shared shell/Plan, focused responsibility editing/detail/preview, mixed Today, compact Household activity, existing History/Settings, `nav.ts`, API/outbox/reconcile compatibility and existing CSS/control primitives.
- Extend protected behaviors, sync matrix, route-policy completeness, migration fixtures, and local tests. Extend fixture-cleanup reference inventory so a fixture membership used by a responsibility plan/history/receipt is never treated as unused.
- Readiness report: `reports/P0-007A-r1-engineering-readiness.md`. Build Report: `reports/P0-007A-r1-build-report.md`. New fictional screenshots only under `reports/p0-007a-r1-screenshots/`; earlier evidence directories must remain unchanged, including after running tests.

## Do not change

- Routine per-person cardinality, dated group rules, personal layers/proposals, contextual steps/school calendar, current/future editing, first-action locks, and prior lifecycle/history/receipt semantics except the explicit additive mixed-work/reset contracts above.
- Authentication, enrollment, private personal tasks, membership identities, friendly-name/profile/order conventions, durable outbox identity safety, or local-first validation/release policy.
- No rotation, group-backed responsibility eligibility, weekly owner grids, weights, scheduled additional work, Kitchen/Bathroom special cases, helpers, Cover/Claim, swaps, reassignment requests, debt, Skip Day, critical-work policy, retrospective UI, exact times, notifications, external calendars, or multi-household switching. Future plan owner editing is permitted; transferring a started occurrence is not.
- No placeholder controls for B/C, all-purpose assignment editor, disconnected responsibility execution app, automatic production fixture insertion, or live evaluation-data reset. No production deployment for development testing.

## Acceptance tests

Required unless explicitly marked otherwise. Use isolated fictional households, controlled household dates, and existing local test seams; do not wait for a real Tuesday or modify the operator's household to obtain evidence. API fixture setup supports tests but cannot replace the stated normal-UI creation/save/execution paths.

| AT | Required evidence |
| --- | --- |
| 1 - Populated upgrade | Fresh install and populated 010 -> current migration, repeat migrate, restart, `foreign_key_check`, and backup/isolated restore. Fixture includes routine current/upcoming plans, started/unstarted/history, personal/proposal/group/calendar/profile/order data, checklist/config/reset receipts and a nonzero generation/floor. Preserve IDs, snapshots, old valid routine receipt replay, scope and grants; new grants backfill only eligible holders once. New responsibility writes work afterward. Keep earlier migration baselines. |
| 2 - Cardinality and assignment | Create multiple responsibilities and a group-backed routine. Repeated/concurrent generation yields one responsibility/date and routine per participant. Reassign an unstarted responsibility after generation: same occurrence ID, one new owner, no duplicate or stale former-owner action. Storage rejects duplicate responsibility/date rows and kind/reference mismatch. Pending-access assignee is supported without conferring execution authority. |
| 3 - Cats normal UI | In Chromium and WebKit, parent creates daily Cats with pet-care steps and one fixed child through focused Plan UI; save/detail/7-day preview agree. Child sees one Cats alongside their routine, completes it; concurrently open authorized Household row/detail updates without reload. History summary/detail records the same occurrence/owner and separate execution facts. No helper or rotation is claimed. |
| 4 - Trash normal UI and recurrence | Create Trash & Recycling, Tuesday / Evening, fixed owner and ordered steps through UI; verify only applicable dates, no pre-creation occurrence, mixed daypart ordering, completion and History. Prove daily Cats still works independently; traveling-device timezone and household-midnight/DST cases do not move Trash day/owner. No automatic rollover or missed-date History fabrication. |
| 5 - Current/future management | Through normal UI repeatedly correct unstarted today, change owner, and inspect result. Create/edit/move/delete upcoming owner/work changes without date drift; occupied-date collision retains draft. Verify range reconciliation including previously generated future rows, recurrence exclude/re-include with one occurrence identity, predecessor restoration, late-GET protection, started/past preservation and read-only accurate preview. |
| 6 - Locks and races | Integration orders first Complete/Not needed against edit, owner change, End and Delete both ways. Winning action freezes work/owner, undo never unlocks, started survivor stays visible/executable under original owner. Winning plan mutation rejects stale structural intent. Reject future execution, wrong step/obligation, foreign IDs and forged performer. No partial plan/receipt/report after injected transaction failure. |
| 7 - Durable immediate execution | Responsibility phone e2e: rapid taps under delayed writes update immediately; offline/queued first action survives reload, then reconciles on reconnect. While pending, manager reassigns or changes work: retain snapshot until explicit rejection/acknowledgment, never apply to replacement/new-owner work. Prove same-command replay once, mismatched/cross-kind receipt rejection, out-of-order response safety and existing routine outbox compatibility. |
| 8 - Delete/End | UI Delete unused current/future setup disappears and replay cannot resurrect it. Stored prior-date history/started/reports require End; UI End cancels unstarted today/future while preserving started completion/undo, past incomplete records, ended detail and History. No other definition is altered. |
| 9 - Permission/type matrix | HTTP tests for responsibility-only manager, routine-only manager, own executor, no-grant member and foreign household. Test mixed Today/History summaries/counts/filters/detail, fixed-member validation, read-only configuration, lifecycle and legacy routine/personal/proposal endpoints. Management alone cannot execute another owner. Origin/CSRF and WS household isolation cover new mutations. |
| 10 - Unified stored History | Mixed routine/responsibility date/person summaries, work filters and existing saved routine filters; detail/Back retain context. Snapshot content/owner/execution facts survive rename/current owner/schedule edits and End. Compare DB state before/after all History reads, including today, missing and rejected future dates: no generation/reconcile/write. Legacy performer remains unknown. |
| 11 - Reset scope and retention | UI confirmation names both kinds; cancel changes nothing, enabled authorized confirm clears both graphs/owned receipts only. Legacy routine-only request cannot erase responsibility data; committed old/new receipt retry cannot erase later activity. Prove disabled/no-grant/foreign rejection, exact retained config/personal-task/other-household data and injected rollback of deletion/generation/floor/receipt. |
| 12 - Reset/offline recovery | Multi-context browser test with mixed-kind pending outbox: clear, miss reset notification, reconnect/reload/visibility, and deliver delayed pre-reset response. Old intent retires visibly for both kinds, no stale card/content resurrection, fresh current IDs and enforced past floor. Keep same-generation ordinary pending-omission protection. |
| 13 - Live management and recovery | Open manager Plan/detail plus two owners' Today/Household views. Create, reassign unstarted, schedule edit/delete and End propagate without reload; former-owner disappears unless pending rejection is being resolved, started owner stays. Drop WS/miss event then reconnect/visibility; authoritative refresh repairs views and preserves dirty drafts. |
| 14 - Authoring/accessibility/layout | Responsibility UI Save persists after pointer drag and keyboard Move-menu reorder, plus actual Chromium touch drag persistence/cancel. Preserve stable logical IDs and focused draft/back/Keep-Discard behavior. Check phone 360px, desktop 1280px and 200% text for overflow/obscured actions, readable summaries, 44px targets and focus. Capture fictional Plan, editor, mixed Today, Household summary/detail, History and reset confirmation. |
| 15 - Saved destinations | New responsibility detail, existing routine/Plan/History saved links reload in built local and Vite; signed-out resume and unavailable/unauthorized handling are safe. Switching identities cannot reuse prior household/kind data or pending commands. |
| 16 - References and regression | Responsibility fixed assignees/history/JSON receipts prevent unsafe fixture cleanup. New references do not contaminate routine group/personal projections. Add contract-catalog, sync-matrix and route-policy evidence. Run exact `npm run validate:pr` and `npm run validate:rc` including Vite with prior P0-003–006 coverage and prior screenshot directories unchanged. |

The Build Report maps each AT to named tests/artifacts, states actual base/commits, and distinguishes automated, manual and not-run evidence. Existing tests may satisfy unchanged subcontracts only with a concrete mapping. New responsibility UI paths require new evidence. Hosted/physical-phone evidence is **not required** for technical acceptance of A; Project Lead local/LAN evaluation remains separate.

## Dependencies

- Integrated P0-006 at `main` **409d147**, the approved P0-007 proposal recorded in `PRODUCT.md`, existing Node 24/local-LAN development and validation tools. No host, account, new runtime service, or external credential.
- Intended branch: `brief/p0-007a-household-responsibility-foundation`, from integrated main with the A planning baseline included. Project Lead manages Git. Suggest commit messages; do not commit, publish, merge, or deploy.
- Engineering first returns one consolidated readiness review for **P0-007A r1**, then waits for Architecture ACCEPT/PROCEED. This brief authorizes readiness review, not implementation before that response.

## Relevant decisions

- D-003/D-004/D-006/D-010/D-011: stored expectations/execution, durable intent, membership authority, personal-task privacy, local-first evidence.
- D-012/D-017–D-021/D-023–D-028: person/access separation, fixture provenance, routine audiences, stable identity/dayparts, locks/lifecycle, Calm shell and ordering.
- D-029–D-034: preserved contextual routines, profiles/order, side-effect-free History and generation-fenced evaluation reset.
- **D-035:** distinct responsibility cardinality over shared recurring-work foundations.
- **D-036:** fixed responsibility accountability, explicit authority and execution lock.
- **D-037:** mixed-work projections and explicitly scoped shared activity reset.

## Known risks / assumptions

- The existing store/UI/API names often assume routine; shared-table reuse requires an audit of every reader/mutator, not just new endpoints. Public routine behavior and old serialized outbox/receipts are compatibility surfaces.
- Owner changes make structural races more consequential. Freezing only steps, keying occurrence identity by the owner, or checking ownership outside the transaction would violate this contract.
- A uses fixed Cats deliberately as the first proving configuration. Cats rotation, Kitchen's unequal weekly pattern, and deep-clean owner precedence remain required P0-007 direction for B; no generic eligibility scaffold is needed in A. The eventual pattern length, empty eligible group behavior and overlapping owner overrides remain B decisions before its implementation.
- Responsibility schema fields and helper organization are Engineering choices within the explicit shared-foundation/cardinality boundaries. If inspection exposes a concrete conflict requiring a materially different storage design, consolidate it in readiness; do not silently clone the whole routine stack.
- There is no background daily obligation generator in this contract. History describes stored evidence; selection of an unvisited past date must not invent expected/unfinished work. Past outbox recovery and the reset floor remain authoritative.

## Engineering readiness

**Reviewed revision:** NOT REVIEWED
**Readiness:** NOT REVIEWED
**Architecture disposition:** Awaiting Engineering's consolidated r1 readiness review.

## Revision history

- **r1:** First P0-007 vertical slice: fixed-owner Cats/Trash, distinct responsibility cardinality over shared foundations, lifecycle/locking, connected execution/oversight/History, and explicit mixed-work reset compatibility. Pattern assignment and scheduled additional work remain B; richer daily prioritization remains C.
