# BRIEF P0-005 - Cohesive Routine Management

**Revision:** 3
**Status:** IN REVIEW

Lifecycle: DRAFT -> IN REVIEW -> READY -> IMPLEMENTING -> IMPLEMENTED -> ACCEPTED.

One authoritative file for P0-005; the filename remains unchanged. This material revision requires fresh Engineering readiness. r1/r2 implementation and reports remain the foundation and prior evidence, not acceptance of r3. Technical acceptance and Product acceptance are separate.

## Why

Multiple routines and first-execution locks exist, but parents still encounter implementation details when editing, scheduling, or correcting mistakes. Product's r3 proposal calls for understandable routine management inside one coherent application. Complete the current routine lifecycle and apply a modest shared visual foundation across the existing experience.

This remains one vertical outcome with internal checkpoints. A schedule service without its ordinary phone workflow, or a theme without working routine management, would leave Product's central question unanswered.

## Learning question

Can a parent understand the current family plan, correct today's unstarted work, manage deliberate future changes, and remove mistakes through a calm application that needs no explanation of revisions?

## Player experience

Open Routines and find a compact list. Open Boys Weekday Morning to see its name, weekdays/daypart, people, and quiet ordered steps. Edit changes the current plan; Save changes updates applicable unstarted work from today forward. Daniel's already-started checklist stays as it was, while Eli's unstarted checklist updates.

Schedule for later reveals a Starting date. The resulting upcoming change can be edited, moved, or deleted. Three edits to Monday's change still leave one change starting Monday. More contains Delete routine for an unused test routine and End routine when history or personal records must be retained.

Today, Routines, and Household share navigation, typography, controls, spacing, and feedback. Today remains the place to do work; Routines manages plans; Household contains structure and oversight.

## Project card

**Card title:** Create and use our family's routines

**Suggested column:** Up Next

**Player-facing goal:** Understand and change our family's routines, correct mistakes, and keep work already begun trustworthy.

**Done when:** A parent can edit current work, schedule/edit/move/delete upcoming changes, delete an unused routine, and end a used routine on a phone; the whole app feels coherent, and started work/history remain intact.

**Tracking relationship:** Continue the existing P0-005 card. Implementation -> In Progress; technical acceptance -> Ready to Evaluate. Keep P0-005 CURRENT until Product evaluates the connected experience; only the Project Lead moves the card to Accepted.

## Current system

Inspected the clean r3 planning branch `brief/p0-005-r3-cohesive-routine-management` at `b0b966e`. Its implementation foundation is the committed r2 result merged to `main` at `5376b51` (implementation `297b2fd`); earlier r2 planning commits are `ea89035` / `7704785`, with r1 `cd887e9` / `2f37485`. The recorded pre-P0-005 integrated baseline is `93ef494`. This brief extends the integrated r2 implementation; it does not restart from the singleton baseline.

| Surface | Verified facts and r3 implication |
| --- | --- |
| Storage | Migrations 001–006 exist. 005 establishes multiple definitions, dayparts, definition-scoped personal layers/proposals, definition version, and archive cutoff. 006 adds/backfills occurrences.started_at from completed/not_needed reports. Occurrence uniqueness is definition/date/accountable membership; retain it. |
| Plan editing | store.createRevision defaults to today and upserts a revision under UNIQUE(definition_id, effective_date). The explicit save reconciliation visits only that exact date; ensureOccurrence may refresh other unstarted rows on subsequent reads. There is no separate identity/lifecycle for an intentional upcoming change. |
| Read/history boundary | materializeForDate selects the current revision's schedule and participants before retrieving occurrences; historyForDate delegates to it. Thus retained started rows require explicit protection from disappearance when the live schedule/audience changes, in addition to protection from field rewrites. |
| Execution/replay | setStepStatus sets started_at monotonically and writes its step report/receipt transactionally. It consults the occurrence's revision for participation. createRevision currently writes its administrative receipt after the revision transaction. r3 needs atomic plan/lifecycle/receipt handling and stable historical interpretation. |
| Client | Routines.tsx opens edit from latestRevision and saves effectiveDate=today. Detail renders current and future revision blocks; there is no future-date editor, move/delete upcoming action, or permanent routine delete. App.tsx also creates global ChangeNotice feedback. |
| Archive | archiveRoutine hides the definition immediately and sets tomorrow's exclusive cutoff. It retains rows and revisions. There is no End action canceling today's unstarted work. |
| Composition | Personal layers remain independently dated and tomorrow-floored. compose.ts uses stable shared logical IDs, per-member additions, and a retired-anchor fallback. r3 preserves personal authority and write-date policy while composing each affected date correctly. |
| Offline/sync | reconcile.ts has mergeAuthoritativeOccurrence to protect local structure with pending locking actions. App owns session/outbox/sync and tab state. A structural edit can replace occurrence step rows; stale queued actions and removed occurrences need direct evidence, not only the existing status-overlay tests. |
| UI foundation | styles.css already defines colors, focus, and 44px touch tokens, with gradients, many bordered blocks, and separate development palette overrides. App.tsx uses a row of NavButton controls; PeopleGroups.tsx and Routines.tsx use focused local states. There is no shared shell/component layer or router dependency. |
| Evidence | PR/RC scripts, route-policy inventory, protected-behavior/sync catalog, migration fixtures, and r2 tests exist. Prior Build Report records 90 Vitest and 38 Chromium/WebKit cases; those are reported r2 results, not verification of r3. Old screenshot directories are protected evidence. |

## Behavioral contract

### 1. Editable work and protected occurrences

- A plan is shared routine configuration: title, weekdays, daypart, direct/group sources, ordered steps and obligations. An occurrence is one definition/accountable membership/household date.
- Editable prospective work includes applicable unstarted occurrences on **today and later household dates**, whether or not rows have been generated. Today alone never locks structure. r3 does not introduce retrospective plan editing; existing prior-date snapshots and execution records remain preserved.
- Keep D-023: first committed Required/Optional/As-needed completion or As-needed Not needed permanently starts that occurrence. Undo never unlocks it. Invalid/rejected actions and merely viewing/materializing do not start it. Locking is per person, never per group or whole routine/date.
- Started/completed occurrences retain their ID, title, daypart, accountable identity, ordered step content/obligations/provenance, and execution evidence. They remain visible and executable under their original authority even if a later plan removes the person, weekday, group source, or step, or ends the routine. Updating status/undo is still allowed; changing structure is not.
- A completed projection alone is not evidence of execution: optional-only completion semantics must not manufacture a lock or prohibit deletion of unused setup.
- There must be no mixed old/new structure during an edit or first execution. Server commit order determines the result; an action cannot silently mark a different or altered step because its label or position matches.

### 2. Current plan and governed date ranges

- Resolve the current plan using the greatest active start date at or before the server's household today. Editing current opens that configuration, never the last future configuration.
- Default Save changes applies from the household date displayed for the edit through, but excluding, the next intentional scheduled boundary. It updates all applicable unstarted occurrences in that range, including already-materialized tomorrow/later rows. It also governs later materialization; do not generate an unbounded calendar just to save.
- Preserve earlier dates with immutable historical versions rather than overwriting a revision also used to interpret prior work. Repeated saves today refine the same current plan from the user's perspective. Internal content versions must not create extra future schedule entries.
- Reconcile schedule and audience as well as text: include missing eligible people/dates; exclude no-longer-applicable unstarted work from Today and cached-ID execution; preserve any started work. Retain survivor occurrence identity and advance authoritative versions for actual changes. Never delete reports/receipts as a reconciliation shortcut.
- Compose each affected date with that date's personal layer and dated group membership. Shared scheduled boundaries do not move personal-layer dates or group versions. Group member-set edits remain next-household-day under D-018; shared audience edits may affect today's unstarted work.
- Reconcile already-existing affected future rows as part of the committed plan operation. Date reads, preview, Today, execution authorization, History, and People/Groups references must agree with the same resolver. Repeated reads must be idempotent.
- When the displayed household date rolls over before save, preserve the draft and return a recoverable date/context conflict; do not silently reinterpret yesterday's edit. The UI refreshes the household date and lets the user save the retained draft against it.

Example: today Sep 14, current A, scheduled B Sep 16. Editing A updates unstarted Sep 14 and Sep 15; Sep 16 onward remains B. If Daniel already started Sep 14, his A snapshot survives and Eli's unstarted one updates. Already-materialized Sep 15 is no exception.

### 3. Intentional upcoming changes

- Support multiple intentional upcoming changes ordered by start date. Use a quiet Upcoming change section for one, Upcoming changes for several. Hide it when empty. Each entry has stable identity distinct from its internal content versions and shows its date, concise configuration summary, Edit, and Delete.
- Schedule for later is a secondary editor action that reveals Starting; ordinary current editing requires no date choice. New scheduled changes start after household today. Copy the editor's draft into an independent full configuration; scheduling it leaves the current plan unchanged.
- Editing an upcoming entry loads that entry and retains its identity/start date unless the user changes Starting. Three saves yield one entry on the same date. The entry governs from its start through the next remaining active entry; current edits do not silently rewrite its configuration.
- Moving an upcoming entry updates its start date atomically and re-resolves both vacated and newly governed ranges. A deliberate move to today applies it as current, subject to per-person locks. Once its start date arrives it becomes current and is no longer deletable through Delete upcoming change.
- Allow at most one active upcoming entry at a routine/date boundary. A create/move collision must preserve the draft and explain the occupied date. Offer Choose another date or access to Edit existing change; no silent replacement, merging, or date shift. Abandoning a dirty draft to edit the other entry uses the normal discard confirmation.
- Delete upcoming change asks one confirmation naming its date and explaining that the previous plan continues until the next remaining change. Cancel changes nothing. Delete cancels the schedule entry and recomposes eligible unstarted work in the vacated interval; internal versions/audit references may remain.
- For A now, B tomorrow, C the following day: deleting B leaves A governing today/tomorrow and C at its unchanged date. Deleting the only future entry lets the current plan continue indefinitely. Moving C earlier requires deliberate user intent.
- Preserve migrated future r1/r2 boundaries as distinct scheduled entries. Do not guess which B/C was an accidental date drift, auto-collapse entries, or shift dates on migration.
- Schedule/delete/move are required through the normal UI. API-only evidence cannot satisfy these outcomes.

### 4. Step editing and personal composition

- Current and upcoming editors allow adding, renaming, changing obligation, deleting, and reordering shared steps under routine.shared.manage. Keep a nonempty checklist and existing Required/As needed/Optional semantics. Reordering must work by keyboard and touch without drag-only interaction.
- Preserve a surviving logical item's identity when editing/reordering it. A newly created item receives a new identity even when a retired item's text matches. Do not reuse IDs across definitions.
- Deleting a shared step removes it from the selected plan and affected unstarted compositions; started/history copies stay intact. It is ordinary editing with no separate archive-item concept or per-step confirmation.
- Existing personal additions remain owned by their membership and definition. If their shared anchor disappears, apply the existing deterministic end-of-list fallback; keep personal order/provenance. Pending proposals retain their audit/anchor identity and follow the same fallback if subsequently approved. Do not broaden a child's authority over inherited shared content.
- Personal changes/approvals keep the current tomorrow-or-later write policy. When they become effective, unstarted composition must use the correct personal layer even if shared content did not change. Moving/deleting a shared upcoming change never deletes personal layers or decisions.

### 5. Delete unused routines and End routines

These are routine.shared.manage operations with server-enforced eligibility, current version checks, and one meaningful confirmation each. More holds infrequent destructive actions; they do not compete with Edit.

**Delete routine**

- Permit permanent removal only when the routine has no started occurrence, no step execution reports/receipts, and no personal-layer or proposal/decision records requiring retention. Generated unstarted rows, shared revisions, group selections, and ordinary administrative save receipts alone do not make unused setup undeletable.
- Recheck dependencies and execution state inside the deletion transaction. Remove the eligible routine configuration, its unstarted occurrence graph, and schedule entries without deleting household people/groups/accounts or touching another routine. Preserve only the minimal command/deletion evidence needed to reject stale commands and replay deletion; it is not a visible archived routine.
- Return a safe explanation and offer End routine when history/personal records block permanent deletion. Do not silently choose End on the user's behalf. An in-flight first action may win and make deletion ineligible; if deletion wins, the stale execution fails visibly without resurrecting the routine.
- A same-name routine created later has a new ID. Prior create/edit/delete retries must not resurrect deleted content or act on the replacement.

**End routine**

- In r3, End stops new use immediately: cancel **unstarted today and all later unstarted work**, plus active upcoming changes. This explicitly supersedes D-022's tomorrow cutoff for newly ended routines, because Product defines today's unstarted work as prospective.
- Started work remains available for completion/undo under existing authority; prior-date records and all execution/personal/proposal audit remain readable. Do not remove history from projections merely because the definition is ended.
- Ended routines leave the active list and have a secondary Ended routines view. No new occurrences, shared/personal edits, scheduling, or proposal approvals may start work there. Pending proposals remain readable/rejectable with an ended explanation; committed decisions/reports remain replayable.
- Existing r1/r2 archived records keep their recorded cutoff and historical meaning on upgrade; do not retroactively cancel previously promised current-day work. Both old and new lifecycle records must be interpreted explicitly.
- Routine restore/reopen is deferred. Canceling upcoming work is behavioral exclusion, not permission to destroy protected records.
- Recompute People/Groups used-by projections over operative plan intervals. Deleted/canceled future references do not permanently block group cleanup, but retained original group identities/versions must still support historical interpretation and started work.

### 6. Read-first routine experience

- Routines opens to a compact list with title, weekday/daypart, and audience summary. Equal titles remain separate records. Empty state has one short explanation and Create routine.
- Detail presents one primary current configuration: title; weekday/daypart; source groups and resolved people; ordered step rows with obligation text. Quiet separators/type/spacing replace a bordered card around every step. A short Show remaining steps expansion is permitted; the complete list remains accessible.
- Edit is explicit. Upcoming entries appear only when they exist and identify their own content/date. Current detail must not imply that a protected child's snapshot has already changed; compact save feedback or a link to Today explains exceptions.
- Editor is one focused page: Name, When, Who, Steps, Save changes. Preserve draft fields across audience picker or step subviews. A compact inline step editor or accessible focused sheet is Engineering discretion.
- Confirm only consequential destruction and abandoning unsaved edits. Back, global navigation, and canceling an editor must preserve the draft until the user chooses Keep editing or Discard. Do not confirm routine text/obligation/reorder saves.
- Feedback is one compact local status notice, announced politely: Saved; Updated today's unstarted routines; Daniel already started, so his routine stayed unchanged; Change scheduled for Monday. No duplicate global ChangeNotice and page banner after the same save.
- The server mutation result supplies the actual applied date/range and updated/protected/excluded outcome needed for feedback. Do not label every row returned by a best-effort Today read as updated. Explanations must remain truthful when no routine applies today.
- Errors/conflicts remain prominent, actionable, and preserve the draft. More and confirmation dialogs have accessible names, keyboard operation, sensible initial focus, Escape/Cancel, and focus return.

### 7. Calm Household shell and shared presentation

- Use a restrained warm light theme with clean surfaces, subtle separation, and one primary accent for selected navigation, primary action, and focus/active treatment. Prefer typography/spacing over boxes; reserve cards/shadows for meaningful grouping. Use system fonts and existing dependencies.
- Extend a modest CSS token layer for typography, spacing, radii, borders, surface/background, text hierarchy, accent, success/warning/error, focus, and touch sizes. Existing token names may remain aliases. Centralize values rather than introducing per-feature palettes.
- Extract only primitives used by this work, such as shell/navigation, page heading/back, section/list row, button variants, status/inline notice, empty state, and confirmation dialog. A CSS class/variant is sufficient where a React wrapper adds no useful behavior. No standalone component package or speculative catalogue.
- Apply the shell/theme across Today, Routines list/detail/edit/upcoming, Household, People & Groups/access, Approvals, History, Personalize/preview, and existing personal-task controls. Sign-in/enrollment use the same tokens without changing their workflow or authority.
- Replace the development-only palette switch with a compact, explicit Local development indicator so local evaluation uses the same visual language as a release. Preserve environment identification and hosted fail-closed configuration.
- Retain immediate checklist interaction, compact completed state, clear actionable state, and visible offline/pending/rejected semantics. These states require text/icons as well as color. Theme changes do not authorize the deferred Today hierarchy.
- Primary interactive targets remain at least 44 by 44 CSS pixels or a full equivalent row hit area. Compact native radio/checkbox controls align beside labels inside that area. Visible focus, accessible names, heading hierarchy, text contrast, and non-color state cues are required.
- At 360px and 390px widths, long names/steps and larger text wrap without horizontal overflow or clipped controls. Do not hide overflow to conceal layout failures. Fixed navigation or optional bottom action bars must account for safe areas and not cover content, keyboard focus, or Save.

### 8. Navigation and state ownership

- Use three conceptual destinations: **Today** for daily execution, **Routines** for shared plan management, **Household** for structure/oversight. On phones use a compact bottom navigation with persistent text labels and a distinct selected state; at wider widths the same hierarchy may use a top or side treatment.
- Preserve capability-based reachability: show Routines management only to routine.shared.manage; Today/Household retain existing permitted access. Household offers People & Groups, Household activity, Approvals (proposal.decide), and History (shared.manage) as secondary entries. Grouping a screen never grants its data.
- Personalize remains reachable from Today for direct/proposal personalizers, with an explicit routine choice and proper return path. Personal tasks stay on Today; household-visible tasks/progress remain available through Household activity. Keep sign-out in a small account menu; build no empty future destinations.
- Centralize destination metadata and typed primary/nested navigation state; keep content/permissions outside the shell's styling. Existing local state is sufficient: no new router or deep-link/browser-history contract is required.
- Keep session, outbox, and synchronization ownership above destination views. Navigation must not discard pending commands, recreate subscriptions, or reset live identity. In-app Back returns to the correct parent; entering a page focuses its heading, and closing a dialog returns focus to its trigger.
- An open dirty editor is not overwritten by sync. Show an external-change conflict when relevant, preserve its draft, and refresh read-only projections. An ended/deleted routine in another view gets a safe unavailable state, never an empty editor or stale actionable schedule.
- Future features may register destinations later; do not create placeholders or wire global navigation to an ever-growing row of feature buttons.

### 9. Commands, races, synchronization, and recovery

- Plan save, schedule create/edit/move/delete, End, and Delete use session-derived household/grants, explicit target IDs, expected current version, and client mutation ID. Validate all member/group/item/change relationships server-side. Keep Origin/CSRF and household WebSocket scope.
- State changes, reconciliation, lifecycle checks, and command receipts commit atomically. Publish invalidation only after commit. Same command/intent retries return their committed result; changed target/date/payload conflicts. Replay identity includes routine and scheduled-entry identity as relevant. Retain valid legacy receipts without cross-resource replay.
- Use immutable stored plan versions plus active schedule-entry selection, or an equivalent representation preserving historical references. r2's in-place revision upsert cannot silently alter the schedule/audience used to authorize started/history rows.
- A first action racing with a plan edit or lifecycle mutation either commits against the valid structure and locks it, or returns a recoverable stale-structure/unavailable result. If the action committed first, the plan operation respects that lock. Check structure identity/obligation/participation in the same transaction; do not translate a stale step by text or position.
- Preserve a pending first action and its visible local checklist through refresh, navigation, disconnect/reconnect, and reload until acknowledged or visibly rejected. Removing an occurrence from an authoritative response must not silently drop its queued intent. Retain enough queued structure identity to detect replacement; preserve surviving step identity where safe.
- Rejection must be visible with an explicit way to resolve/discard/retry on the current checklist; it cannot spin forever or be silently marked complete. Unsent local actions do not override an already committed server plan/end/delete. Do not reinterpret client performedAt as proof that it won server ordering.
- Prevent older responses from replacing newer structure, status, startedAt, or schedule state even after the outbox empties. Resource/occurrence versions and identity guards apply to ordinary refresh, mutation responses, reconnect, and visibility.
- Invalidate open routine list/detail/editor context, Today, Household activity, People/Groups references, previews, Personalize/Approvals, and History as affected. Keep existing server-authoritative reads/events; no second sync system.
- Administrative editing remains online and outside the checklist outbox; offline saves keep the draft and report failure without promising a saved schedule.

### 10. Migration, protected behavior, and local evidence

- Add ordered forward migrations after 006 as needed; preserve accepted migrations. Test a named populated r2 baseline with current and multiple future plans, per-person started/unstarted occurrences, undo reports, pre-materialized future rows, archived records, personal layers/proposals, group versions, and command receipts.
- Preserve existing IDs and historical meaning. Snapshot fields are authoritative where r2 revision content was already replaced; do not claim to reconstruct lost original metadata by guessing. Migration must not reinterpret unstarted materialization as execution or collapse the user's future dates.
- Maintain protected behavior from P0-001 through r2, except the explicit r3 current-plan range, upcoming lifecycle, safe deletion, new End, and shell changes. Update affected protected-behavior and sync entries to the new contract rather than disabling tests.
- Test migrations/FKs/integrity/idempotency and backup -> migrate -> isolated restore using disposable data. Never use the live household database as a destructive test fixture.
- Keep local developer/PR/RC commands. No deployment, paid service, new external account, host-clock change, or overnight wait is needed. Controlled test dates must remain unavailable in normal profiles.

## Implementation boundary

- Domain: extract cohesive plan selection/interval/reconciliation and lifecycle helpers beside existing recurrence, participation, composition, lock, and reconciliation modules. Preserve framework-independent domain boundaries.
- Server/shared: store.ts, app.ts, db.ts/migration helpers, route-policy.ts, schemas, and forward migrations; small modules may be extracted where they clarify transaction ownership. Inventory every routine reference, including JSON receipt targets, before deletion.
- Client: App.tsx, Routines.tsx, PeopleGroups.tsx, api/outbox/reconcile and styles.css; introduce a small local shared UI/token area if useful. Keep the identity/sync lifetime stable while extracting shell/navigation.
- Evidence/docs: tests and disposable fixtures, docs/protected-behaviors.md, operator migration notes, factual ARCHITECTURE.md implementation writeback, and reports/P0-005-r3-build-report.md. New fictional screenshots go only in reports/p0-005-r3-screenshots/. Leave all earlier report/artifact directories untouched during test runs.
- Internal checkpoints: (1) populated baseline + resolver/migration/transaction contract; (2) shell/tokens and one representative Routines list/detail/editor sequence to establish the shared pattern; (3) complete lifecycle UI plus consistency across existing surfaces; (4) complete browser journey, regression gates, screenshots, Build Report. All are part of r3 acceptance.
- Branch: continue `brief/p0-005-multiple-household-routines` from the inspected r2 foundation unless the Project Lead integrates it first; then use the integrated equivalent. Suggest commit messages but do not commit. No Git mutation or deployment is authorized by this brief.

## Do not change

- Auth/enrollment behavior, capability separation, private-task visibility, household isolation, fixture-free bootstrap, provenance-safe member cleanup, and valid historical/report evidence.
- Group member-set next-day policy, per-definition personal authority/date policy, independent routines/weekdays/dayparts, Required/As needed/Optional meanings, or first-action/undo locking.
- No full Multi-Responsibility Today, Kitchen/Cats/Bathroom, rotation/helpers/cover/debt, calendar ingestion, notifications, multi-household, meals, homework, generic approval/permission editor, routine restore/duplication, revision ledger UI, branding/logo project, gratuitous animation, or generic design-system package.
- Deferred PRODUCT.md inventory stays preserved and unscheduled. Theme/navigation choices support later growth without implementing those features.

## Acceptance tests

Every row is required. Map it to exact tests/artifacts and performed results in the r3 Build Report. Old passing tests may supply unchanged regression evidence; API-only checks do not replace explicitly required browser workflows. Technical acceptance does not certify subjective visual quality.

| AT | Required evidence |
| --- | --- |
| 1. Populated upgrade | Named r2 fixture upgrades through new migrations with stable IDs, locks/undo evidence, old archive semantics, personal/proposal/group/receipt relationships, and A/B/C dates. Migration rerun has no semantic drift; FKs/integrity and disposable backup/restore pass. Retain earlier P0-001/P0-004B upgrade coverage. |
| 2. Current-plan interval | With A now and B Sep 16, UI opens A despite B being newer. Edit title/step/obligation/daypart; today's unstarted and pre-materialized Sep 15 update, Sep 16 follows B. Compare materialized-first with edit-first results; repeated reads/saves do not duplicate or drift. |
| 3. Execution protection | Each locking action kind, undo, and group peer divergence: start Daniel, edit again, Eli updates, Daniel remains unchanged. Remove Daniel's audience/weekday and prove his started occurrence is still visible/actionable and History retains it; invalid/open-only actions do not falsely lock. |
| 4. Eligibility changes | Shared schedule/direct/group-source changes add/exclude unstarted participants across the governed interval, deduplicate overlaps, allow empty groups, reject excluded cached-ID execution, preserve started peers. Existing group member-set changes still begin next household day across multiple routines. |
| 5. Schedule through UI | Schedule for later reveals date only on intent; save B without changing A. Edit B's text/steps three times; exactly one upcoming entry stays at its chosen date. Create a later C and find both in date order without a revision ledger. |
| 6. Move/collision/date boundary | Through UI move a future entry earlier/later; both vacated/new ranges resolve correctly. Occupied date retains draft and offers explicit alternatives with no silent replacement. Deliberate move to today respects locks. Household rollover between load/save yields recoverable conflict, including device-TZ mismatch. |
| 7. Delete upcoming/fallback | UI Cancel and confirm Delete B in A/B/C; tomorrow follows A, C's date/content stay fixed. Delete last future entry and A fills all remaining eligible future rows. Locked/past snapshots and personal layers remain unchanged; retries and open second-client detail converge. |
| 8. Step lifecycle/composition | UI add/delete/reorder steps in current and upcoming plans; preserve surviving IDs and started snapshots. Verify personal-anchor fallback, proposal approval after anchor retirement, per-date personal composition, and sibling/other-routine isolation. Include a personal-only layer change with unchanged shared content. |
| 9. Permanent deletion | UI creates unused test routine, materializes unstarted work, cancels confirmation, then deletes. Config/eligible graph disappear, people/groups/other routines remain; generated rows/save receipts alone do not block. Started/reported/personal/proposal cases deny deletion with End alternative. Replay and same-name recreation cannot resurrect or target a different routine. |
| 10. End/history | UI End used routine: today's unstarted and future work/upcoming entries cancel; today's started remains completable/undoable, History and audit remain inspectable. Test no later resurrection, blocked edits/approvals, rejectable pending proposals, valid report/decision replay, and preserved legacy archive cutoff. |
| 11. Transactions/authority | HTTP matrix for all new mutations: unauthenticated, missing-grant, foreign household/routine/change/member/group, stale version, changed mutation payload. Fault injection shows rollback of plan + affected rows + receipt together. Test edit/action and delete/end/action in both server orderings and retry after lost response/day rollover. |
| 12. Pending/offline recovery | Two browser contexts: child queues first action while disconnected; manager changes/removes step or excludes/ends routine; reconnect and reload retain visible pending intent until valid ack or explicit rejection/resolution. No wrong-step completion, lost command, infinite retry, lock reset, or late-response rollback after queue drain. |
| 13. Live projections | Current edit, future create/move/delete, End/Delete, group and personal changes update affected open list/detail, Today, activity, references, preview and proposal views without reload. Cover dirty editor, routine switch with delayed response, missed/duplicate events, visibility, reconnect, and server household date. |
| 14. Read-first UX | Browser proves compact list, one current read-only detail, quiet step rows, optional upcoming section, explicit editor/picker, More actions, one local save notice, and meaningful empty/ended/unavailable states. No editable fields on ordinary detail; discard prompts only when dirty; no confirmation for normal step/text saves. |
| 15. Navigation/access | At phone width navigate Today -> Routines -> Household -> People & Groups / activity / Approvals / History with correct Back/focus. Capability variants and Personalize remain reachable, private tasks remain private, pending execution survives navigation, sign-out retains existing pending-work protection. |
| 16. Shared presentation | Inspect representative Today, list/detail/editor/upcoming, Household/directory/access, Approvals/History, Personalize, and sign-in states for shared tokens/controls. Browser assertions cover 360/390px no overflow (including long content/larger text), 44px targets, aligned controls, keyboard focus/dialog return, nav/bar occlusion, accessible names and non-color states. Retain representative fictional phone screenshots; no pixel-perfect global gate. |
| 17. Full Product journey | Chromium and WebKit drive normal UI creation/open/current edit, future-row verification, start one child/edit again, schedule/re-edit/move/delete change, create/delete test routine, End used routine, and delete/reorder steps with intact History. Fixtures/clock/API may establish prerequisites or inspect future state, but all management actions use the UI. |
| 18. Regression/artifact gates | Exact npm run validate:pr and npm run validate:rc pass; route-policy completeness and protected-behavior/sync matrix cover the changed routes. Prior artifact directories have zero diff after validation. Report exact evidence, commits/uncommitted state, deviations and NOT RUN checks honestly. |

Product evaluates the connected application after technical evidence: Today, Routines, upcoming management, People & Groups, Approvals, History, and navigation. Judge whether it feels coherent, whether current editing/scheduled mistakes are understandable, and whether destructive actions are discoverable but quiet. Screenshot presence or a green suite alone is not Product approval.

## Dependencies

- The committed r2 foundation merged to `main` at `5376b51` (implementation `297b2fd`), existing local Node 24 / SQLite toolchain, and fresh r3 Engineering readiness.
- Product's supplied P0-005 r3 proposal; its durable intent is recorded in PRODUCT.md. No new design service, external account, host, or physical phone is required to implement.
- Use reports/P0-005-r3-engineering-readiness.md and reports/P0-005-r3-build-report.md. Prior r2 acceptance remains historical evidence only.

## Relevant decisions

- D-002/D-004/D-006–D-011: runtime, server/outbox truth, identity, personal scope, local validation.
- D-016–D-021/D-023: focused states, fixture safety, dated groups, routine identity/dayparts, first-execution lock; refinements below take precedence where explicitly stated.
- D-024: current-plan intervals and intentional schedule-entry lifecycle.
- D-025: safe routine deletion and End preserving protected work; supersedes new-operation D-022 cutoff.
- D-026: shared Calm Household tokens, shell, and navigation.

## Known risks / assumptions

- This combines lifecycle and presentation work deliberately because Product must evaluate the connected routine experience. Internal checkpoints limit rework; deferred responsibility domains are excluded.
- r2 mutates revision content and can regenerate occurrence steps. Stored snapshot/audit references, pending step identities, and started rows filtered by live audience are risk areas requiring direct tests.
- For deletion, personal/proposal records count as retained household work even without checklist execution; generated unstarted rows and ordinary save receipts do not. This is the chosen conservative implementation of Product's safe-unused condition.
- Product's definition of prospective includes today's unstarted work; new End applies that definition immediately. Migrated archived records retain their prior cutoff. Past-date editing and restore are not introduced.
- Engineering chooses schema details, cohesive module boundaries, token values, and accessible step-editor pattern within this contract. No acceptance row or ordinary UI outcome becomes optional because an API exists.

## Engineering readiness

**Reviewed revision:** 3

**Readiness:** READY

**Compared against:** `brief/p0-005-r3-cohesive-routine-management` @ `b0b966e`; foundation `main` @ `5376b51` (`297b2fd`)

**Report:** `reports/P0-005-r3-engineering-readiness.md`

**Architecture disposition:** ACCEPT / PROCEED. Engineering may implement revision 3 locally against the committed r2 foundation. This authorizes implementation only; Architecture acceptance of the resulting Build Report and Project Lead/product acceptance remain separate.

## Revision history

- **r1:** Multiple independent household routines, weekdays/dayparts, scoped personal content, archive, populated upgrade, and phone evidence.
- **r2:** First-action per-person structural lock and same-date editing; implemented at 297b2fd and technically accepted after evidence hygiene correction. Product evaluation continued.
- **r3:** Current-plan interval reconciliation including today; explicit create/edit/move/delete upcoming changes; safe Delete and immediate End for unstarted work; read-first authoring; shared Calm Household tokens/shell/navigation and complete local lifecycle/presentation evidence. Supersedes r2's accepted UI/date limitations and requires new readiness.
