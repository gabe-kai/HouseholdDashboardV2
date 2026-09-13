# BRIEF P0-005 - Multiple Household Routines

**Revision:** 1
**Status:** IN REVIEW

Lifecycle: DRAFT -> IN REVIEW -> READY -> IMPLEMENTING -> IMPLEMENTED -> ACCEPTED.

One authoritative file for this ID. Material contract changes increment the revision and invalidate prior readiness. Technical acceptance is separate from Project Lead/product acceptance.

## Why

The household can organize people and groups but can configure only one special Morning Routine. Product now needs Morning, After School, and Bedtime to be ordinary, independent routines that children can use on the same day. This brief generalizes the existing working model; it does not introduce ordinary chores or the final daily dashboard.

## Learning question

Can a parent create, find, and maintain the family's real routines using name, who, when, and steps, and can a child distinguish and execute them independently throughout the day?

## Player experience

Open Routines to see a compact list. Morning Routine is still there after upgrading. Tap New routine, create After School Routine for Kids on weekdays in the After school daypart, and create Bedtime for every day. Each has its own checklist. Opening one shows a summary; Edit is explicit. Children see all applicable routines on Today and can complete each independently. A group edit flows prospectively to every routine using it. Personal additions and approvals clearly name the child and routine. Archive stops future use while keeping history inspectable.

## Project card

**Card title:** Create and use our family's routines

**Suggested column:** Up Next

**Player-facing goal:** Make Morning, After School, Bedtime, and other named routines without special setup for each kind.

**Done when:** A parent can find and create routines on a phone, the children can use all applicable routines independently, and changes or archival leave existing household history trustworthy.

**Tracking relationship:** Standalone P0-005 card. Technical acceptance moves it to Ready to Evaluate; only the Project Lead can accept the experience.

## Current system

Inspected on clean `main` at `93ef494` (P0-004B merged through PR #9). These are implementation facts, not proposed behavior:

| Surface | Evidence and implication |
| --- | --- |
| Storage | `001_initial.sql` makes `routine_definitions.household_id` unique and constrains `kind` to `morning`. `occurrences.schedule_anchor` is also constrained to `morning`. Ordered migrations currently end at `004_group_backed_morning_routine.sql`. |
| Existing useful keys | Shared revisions already have `definition_id` and uniqueness by `(definition_id, effective_date)`. Occurrence uniqueness already includes `(definition_id, household_date, accountable_member_id)`; preserve it. |
| Singleton services/API | `store.ts` uses `getRoutine(householdId)` for creation, revision responses, date materialization, preview, personalization, and approval. `GET /api/v1/routines` returns `{ routine }`; creation rejects a second definition. Revision routes already carry `:definitionId`. |
| Personalization | `personal_routine_revisions` has `definition_id`, but its unique key and `getPersonalLayer` queries use only membership/date. `routine_proposals` has no definition ID; approval looks up the household singleton. `personal_additions.id` is a row primary key; preserve existing identifiers and verify repeat edits of existing additions. |
| Identity/replay | Routine mutation receipts check household, command kind, and payload digest; revision digests omit the target definition ID. Existing step receipts store response/report identity. Multiple routines require checking replay targets, not just payload equality. |
| Groups and people | Dated membership, direct/group sources, tombstones, and prospective guards exist. `GroupPublic.usedByMorningRoutine` and `PersonDetail.morningRoutine` are singular projections; group reference queries already traverse revision definition IDs. |
| UI | `RoutineEditor.tsx` loads the singleton and latest revision. `App.tsx` has singular Routine/Personalize/preview state and Morning-specific labels. Today and Household activity already render occurrence arrays keyed by occurrence ID, but do not offer the new routine/daypart navigation. |
| Evidence/operations | Existing PR/RC scripts, route-policy inventory, sync matrix, and P0-001–004 regressions exist. The named migration fixture in `tests/helpers/p001-fixture.ts` predates authenticated personal content and groups; it alone cannot prove this upgrade. Local/LAN development is supported. No new host, external service, or runtime dependency is required. |

## Behavioral contract

### 1. Independent definitions and dated configuration

- Permit multiple definitions per household, each with a stable opaque ID independent of name, daypart, order, or selected people. Names are nonempty household-defined labels, not identity or a finite set of routine types. Equal names must not merge records or select a default target.
- Each shared revision owns name, nonempty ISO-weekday set, daypart, ordered nonempty checklist, and direct/group audience sources. Shared logical item IDs remain scoped to the owning definition; IDs or anchors from another routine cannot be adopted merely because labels match.
- Preserve the existing obligation meanings Required, As needed, and Optional. A renamed routine retains its definition ID. Existing occurrence titles, dayparts, step IDs/text/order/obligations, provenance, assignments, reports, and versions do not change when configuration changes.
- Initial creation is effective today in the household timezone and appears on Today immediately if its weekday and audience apply. Subsequent shared/personal revisions remain future-effective. Default saves append at the next available date starting tomorrow, after already scheduled revisions of that definition (or membership/definition pair for personal changes). Show the chosen date before saving and return the actual committed date for feedback/preview. Changes to another routine must not occupy this routine's date or delay its save. A concurrency conflict must not silently reschedule the user's change.
- Current and configured-future projections must select the appropriate revision as well as the dated group membership. Do not call `.at(-1)` configuration today's participation. A summary may show upcoming configuration, but must label its actual start date and distinguish today's applicable configuration. A group change effective tomorrow must not make a routine revision scheduled later appear operative tomorrow.

### 2. Recurrence and dayparts

- Every day, Weekdays, Weekends, and Custom days are controls over the existing per-revision weekday set. Monday–Friday, Saturday–Sunday, Sunday–Thursday, and Friday–Saturday must all work. Validate real household dates and at least one chosen day.
- The initial daypart vocabulary is Morning, After school, Evening, Bedtime, and Anytime. Use one shared ordered vocabulary, separate from routine identity/type. This is meaningful configuration snapshotted on occurrences and used for ordering, not an exact-time recurrence engine.
- New creation may default visibly to Every day / Anytime. Migrated Morning revisions and occurrences retain Morning. A later daypart change does not relabel old occurrences.
- Today orders Morning, After school, Evening, Bedtime, then Anytime. Use a deterministic tie-break within a daypart (definition identity is sufficient). All of today's applicable routines are executable regardless of device clock time; dayparts do not lock checklists until an invented time.

### 3. Focused routine authoring and discovery

- Replace the singular Routine destination with Routines. Its default is a compact active list showing name, people/group summary, weekdays, and daypart. Supply empty state, New routine, and a secondary Archived routines entry. Do not stack full editors.
- Selecting a routine opens a read-first summary with explicit Edit routine, Back to Routines, who/when, and an inspectable ordered checklist. Editing or creating is one focused state organized around name, who, when, and steps. Use existing accessible Back/focus conventions, touch sizing, and audience-picker behavior; no router or design-system replacement is required.
- Reuse the P0-004B group/person selection semantics and interaction. Selecting an audience within an unsaved creation only updates that draft; it must not create a partial routine. Preserve entered name/schedule/steps across picker transitions; Cancel discards uncommitted work. A successful save opens that exact routine's summary with date feedback and a usable preview/Today path.
- When a different routine is selected, loaded data, draft fields, preview, and pending responses must remain tied to their definition ID. Do not overwrite another routine's draft with a late request or silently discard a dirty form on sync. Surface a stale-edit conflict and allow refresh/reconciliation.

### 4. People/group participation and references

- Apply D-018/D-019 independently to every definition: retain direct and group sources, normalize redundant direct sources at deliberate save for its effective date, union/deduplicate by membership, permit selected empty groups and unenrolled people, and preserve later explicit direct intent. Groups confer no authority.
- One edit of Kids must affect every Kids-backed routine beginning the next household day without reopening or saving those routines. Today/history remain stable. Repeated same-day group edits retain the greatest-version rule and correct household-local baseline dates.
- Replace Morning-only group/person fields with routine-aware collections/projections. Group detail identifies all consuming routine names and relevant effective dates; person detail can explain that person's direct/group-backed routine participation. Current participation and upcoming configuration must be distinguishable.
- Group deletion checks all operative/scheduled routine intervals, intersected with each routine's archive cutoff. Archive does not release today's reference until that day ends. A group still used by another routine remains protected. Historical-only group references retain tombstone identity and dated membership under the existing deletion policy.

### 5. Routine-scoped personalization and approvals

- Every personal-layer read/write, composition, preview, and proposal has an explicit definition ID. Personal revision uniqueness/selection is by membership, definition, and effective date. A proposal stores its routine identity at creation; approval must use that stored identity and cannot redirect it using client state or an arbitrary first routine.
- Personalize offers an explicit active-routine choice and clearly names the routine being changed. Retain existing capability policy: direct personalizers manage their own additions; proposal personalizers submit additions; deciders approve/reject. List/approval cards and post-decision feedback name proposer, routine, and effective date. Retain proposal status sync while the child leaves Personalize open.
- A child's Bedtime addition affects only that child's future Bedtime composition. Same-day additions to that child's After School Routine are independent. Carry existing personal content forward when appending; repeat edit/approve flows must not erase additions, duplicate them, or collide on snapshot-row IDs. Existing shared-item restrictions and retired-anchor fallback remain; reject foreign-routine anchors rather than treating them as retired local items.
- Routine-scoped previews use the same revision/date/participation resolution as normal reads, identify the child and routine, distinguish non-applicable dates, and remain read-only without executable future occurrence creation. Personal data visibility remains as currently authorized; multiple routines do not expand another child's access.

### 6. Independent Today, activity, and history

- Date reads enumerate all applicable definitions. Each accountable member receives at most one occurrence per definition/date, including overlapping group/direct sources. Two children with three applicable routines receive six independent occurrences. Only the authorized member's own work is actionable.
- Today uses occurrence snapshots for labels, daypart ordering, obligation/completion state, expansion, pending commands, and errors. Completing or reopening one occurrence cannot change another routine, even with identical step labels or ordering. Preserve rapid optimistic actions, membership-isolated durable outbox, and authoritative version reconciliation.
- Generalize Household activity and History to identify routine and accountable member for each occurrence. Historical reads must still find archived routines and use snapshotted content, not current titles, assignments, or dayparts. Retain existing access restrictions.
- Preserve future materialization for deterministic evaluation. Future participation may include/exclude retained rows under the established group rule, but surviving occurrence content is not recomposed. Future status writes and excluded cached occurrence writes remain rejected without reports/receipts. A changed shared/personal definition does not rewrite a previously materialized snapshot; normal preview remains the way to inspect future composition without freezing a snapshot.

### 7. Safe archive lifecycle

- Archive requires `routine.shared.manage`, an explicit confirmation naming the routine, and a replay-safe desired-state command. Remove it from the normal active configuration list immediately; record a household-local cutoff of tomorrow, with feedback that today's routine remains available and no routines occur from that date onward. Preserve definition identity and all existing records. Restoration, cancellation of archive, and destructive routine deletion are outside r1.
- Apply the cutoff during every date read, preview applicability check, occurrence materialization, cached-ID execution authorization, and reference calculation. Existing rows on/after the cutoff are retained but not returned as assigned work or made executable, even after their dates pass. Existing valid current/past checklist reports and delayed outbox commands before the cutoff remain allowed by their original authority.
- Archived routines have a secondary read-only summary and access to their history. Do not edit their future configuration, save personal changes, submit new proposals, or approve still-pending proposals into them. Existing proposals/audit remain visible under normal policy; pending proposals explain that the routine is archived and may be rejected without creating a layer. Replaying an already committed decision is still idempotent.

### 8. API, authorization, replay, and synchronization

- `GET /api/v1/routines` becomes a collection; definition detail, revision, archive, personal-layer, and preview operations require an explicit routine ID. Creation returns the new definition ID. Proposals carry definition ID; approval derives it from the stored proposal. Engineering chooses cohesive route suffixes and shared wire types and documents them in the route-policy inventory. Singleton adapters, if retained, must target a proven legacy definition or reject ambiguity; they cannot choose the first/currently selected routine. Normal new clients always use explicit IDs.
- Continue session-derived household/membership/grants, Origin/CSRF protection, and existing read scopes. Validate routine, member, group, step/logical-item, layer, and proposal relationships server-side. Household A cannot reference or receive B's data; one routine cannot borrow another's personal content or mutation result. Routine archive uses the existing shared-management capability, not a parallel permission model.
- Routine create/revise/archive must commit state plus receipt atomically. Replay identity binds household, command, target definition where present, and normalized payload (including daypart and effective date). Same ID/same intent returns the original result; changed target/payload conflicts without disclosure or mutation. Old receipts stay recoverable and are safely interpreted against their original routine. Step-command replay must likewise verify the occurrence/step relationship before returning a receipt, preserving valid queued legacy commands.
- Guard shared edits/archive against stale routine state using an expected latest revision or equivalent version. Preserve form content on conflict. This is a local optimistic-concurrency guard, not a new collaboration engine.
- Create/edit/archive, personal changes/decisions, and group changes invalidate every affected open projection: list, selected detail/picker, Today, group/person references, Personalize/Approvals, and preview/history where relevant. Scope events to the household, identify routine resources consistently, and re-read authoritative data. Duplicate/missed/out-of-order events, reconnect, visibility return, and a routine-selection change must not restore an older or different routine's state. Preserve the current outbox during these refreshes.

### 9. Populated upgrade and compatibility

- Add ordered forward migration(s) after 004; do not modify accepted migrations to obtain a fresh-only pass. Lift singleton/kind/anchor constraints as needed while preserving definition/revision/occurrence/member IDs, foreign-key relationships, group sources/versions/tombstones, existing layer/addition IDs, proposal decisions, execution reports, receipt payloads, and authenticated identities. Existing Morning Routine is active and has Morning daypart after migration; retain its existing title.
- Backfill legacy proposals from the household's sole pre-upgrade routine, cross-checking a decided proposal's linked personal revision. The old API permits proposals even without a routine: if no unambiguous association exists, preserve and flag that legacy proposal as unresolved/read-only, rather than deleting it or assigning a later-created routine. New proposals always require a valid routine ID. Report unexpected conflicting associations safely.
- Extend the supported named migration baseline with a fictional populated P0-004B fixture created using pre-upgrade schema/data; retain P0-001 compatibility coverage. Include real relationship shapes, not private household data. Run foreign-key/integrity checks after any SQLite table rebuild, verify post-upgrade writes, and verify re-running migration is a semantic no-op.
- A migrate/backup/isolated-restore rehearsal uses disposable data. No live household reset, fixture cleanup, hosted deployment, account change, or production-data rewrite is part of this brief.

## Implementation boundary

- Expected changes: `db/migrations/`, `src/server/db.ts` and relevant migration helpers, `store.ts`, `app.ts`, `route-policy.ts`, `src/shared/`, recurrence/composition/participation adapters, client API, `RoutineEditor.tsx`, `App.tsx`, and affected People & Groups projections. Extract cohesive routine components/helpers as needed; do not broadly reorganize unrelated code.
- Update `docs/protected-behaviors.md` and its sync matrix, relevant operator migration instructions, and factual architecture notes. Add focused domain/integration/HTTP/browser evidence and fictional phone-width screenshots in `reports/p0-005-r1-screenshots/`; leave prior evidence artifacts untouched.
- Engineering sequencing within this one brief: (1) populated fixture + forward migration and ID-scoped services; (2) API/auth/replay/composition/date/lifecycle evidence; (3) Routines list/summary/authoring plus per-routine personalization and minimal Today; (4) full Product journey, regression gates, screenshots, Build Report. These are implementation checkpoints, not separate user-facing releases or speculative briefs.
- Suggested branch: `brief/p0-005-multiple-household-routines`. Engineering readiness/report paths: `reports/P0-005-r1-engineering-readiness.md` and `reports/P0-005-r1-build-report.md`. Suggest commit messages but do not commit; the Project Lead manages Git operations.

## Do not change

- Existing auth, enrollment, classification/grant separation, private-task visibility, people/group access lifecycle, fixture-free bootstrap, provenance-safe cleanup, and retained history.
- D-003/D-008 snapshot-content semantics and D-018/D-019 source, group-date, and future execution boundaries, except the explicit routine-scope and archive extensions above.
- No Kitchen/Cats/Bathroom model, rotation, choose-one, helpers, cover/swap, debt, Skip Day, retrospective claims, calendar ingestion, contextual additions, exact-time gates, notifications, multi-household flows, or full Today hierarchy.
- No routine duplication/restoration, generic authoring toolkit, new host/service dependency, broad framework rewrite, or ordinary development deployment. Deferred directions in `PRODUCT.md` are memory, not implementation scope.

## Acceptance tests

Engineering must map each numbered test to performed evidence, distinguishing automated checks, screenshots, and manual evaluation. Report gaps explicitly; equivalent old single-routine tests alone do not prove multiple-routine behavior.

| AT | Required evidence |
| --- | --- |
| 1. Populated migration | Upgrade a named pre-P0-005 fixture with authenticated members, existing Morning revisions, group sources and pending dated membership, shared/personal occurrence snapshots, reports/receipts, direct layers, and pending/approved/rejected proposals. Assert IDs and protected semantic records remain equal, layers/proposals target the old definition, Morning daypart is preserved, and the routine is usable. Include the reachable no-routine legacy proposal case; retain it safely without guessed association. |
| 2. Migration safety | Reapply migrations without semantic drift; foreign-key/integrity checks pass; current auth and post-upgrade create/revise/execute work. Retain P0-001 upgrade coverage and prove backup -> migrate -> isolated restore using disposable data. |
| 3. Real phone creation journey | Begin with migrated Morning in Routines. Through normal UI create After School for Kids, weekdays, After school, with several steps; then Bedtime for Kids, every day, Bedtime, with different steps. Find all three independently, open read-first detail, edit explicitly, and return to list. Audience-picker transitions preserve draft fields and do not prematurely create a definition; Cancel leaves no partial routine. |
| 4. Independent occurrences/completion | On a deterministic weekday, Daniel and Eli each receive exactly one of all three. Repeated/concurrent reads produce no duplicates. Complete Daniel's Morning through UI; his other two and Eli's three remain independent. Include identical step labels in different routines and direct plus overlapping-group sources. |
| 5. Independent revisions and dates | Rename/change After School audience/schedule/steps/daypart; assert Morning and Bedtime definitions and existing snapshots are unchanged. Edit two definitions on the same day without cross-definition date conflicts. Another future edit of the same definition shows its actual date. Test today-vs-future source/revision resolution, including a revision later than tomorrow, so a count or start label cannot describe the wrong day. |
| 6. Weekly/daypart rules | Verify all four schedule controls, including Sunday–Thursday and Friday–Saturday. Saturday yields daily Bedtime but not weekday After School. Daypart order is deterministic, legacy Morning is first, Anytime is last, and every applicable routine today is executable independent of wall-clock time. Preserve household timezone authority across device TZ, midnight, and DST cases. |
| 7. Group propagation | Add a child to Kids once without editing routines. Today/history stay stable and the child receives all applicable Kids-backed routines tomorrow; removal excludes the child prospectively. Test overlap, empty group, rename, repeated same-day edits, and effective/pending labels across definitions. |
| 8. Future rows and immutable history | Pre-materialize a future date, add/remove group participants, and verify authoritative results reconcile while surviving/retained rows, step snapshots, reports, and receipts are not rewritten. Reject future and excluded cached writes. Change Bedtime then compare yesterday's three routines, including IDs and snapshot fields, unchanged. |
| 9. Personal isolation | Exercise direct and proposed additions on specific routines for different children, including same membership/date across two routines and repeat edits/approvals that carry prior additions forward. Only the intended membership/definition's future composition changes. Existing IDs/provenance survive migration; foreign-routine anchors/layers and inherited-item edits are denied. |
| 10. Open proposal/preview journey | From the child's selected Bedtime submit an addition, approve from manager context, and observe Approved plus the correct routine/date/preview in the still-open child view without reload. Today remains unchanged until effective; another child's Bedtime and the proposer's other routines remain unchanged. |
| 11. Archive | Archive through UI, verify immediate list removal and inspectable archived summary/history; today's occurrence stays usable even if first read after archive. No occurrence is assigned from cutoff onward, including a pre-materialized retained row after advancing past its date. Valid pre-cutoff delayed writes/replays still work. Archived mutation/approval attempts fail safely; pending proposal remains auditable/rejectable. Other routines continue normally. |
| 12. Reference lifecycle | A group used by two routines cannot be deleted after removing/archiving just one reference. Today's reference remains until its cutoff; historical-only references permit the existing safe tombstone behavior. Retained archived/history records remain readable after group deletion/name reuse. |
| 13. HTTP authority and isolation | Test unauthenticated, missing-grant, cross-household, and same-household wrong-routine IDs across collection/detail/revision/archive, personal reads/writes, preview, proposals/decisions, and occurrence execution. Preserve owner/private-task boundaries and Origin/CSRF/WS scope. Do not count hidden buttons as authorization evidence. |
| 14. Replay and concurrent edits | Create/revise/archive replay once with same intent, including response loss and retry after day rollover; changed target/household/payload conflicts safely. Demonstrate atomic receipt/state behavior and legitimate legacy receipt replay. A step receipt cannot be replayed against another occurrence/step. Two managers editing the same definition receive a recoverable conflict instead of silently overwriting/rescheduling. |
| 15. Multi-context invalidation | Keep two authorized clients open while creating, editing, archiving, and changing a shared group used by several routines. Prove affected list/detail, group references, previews, and applicable Today views converge without reload. Cover open picker/draft and switching between routines with delayed responses; stale results cannot overwrite the selected routine. |
| 16. Recovery and execution regression | With several routines present, repeat rapid taps/delayed responses, membership outbox reload/logout isolation, disconnected checklist replay, missed/duplicate notifications, socket reconnect, and visibility recovery. Assert per-occurrence state and correct server household date after recovery. Reuse existing tests where their fixtures now exercise the multi-routine boundary. |
| 17. Phone/keyboard evidence | Chromium and WebKit automate the core create/find/edit/execute journey at the established phone width. Assert exclusive primary state, Back/heading focus, accessible names, aligned compact choices with adequate touch area, and absence of horizontal overflow. Retain fictional screenshots of list, detail, creation, audience picker, three-routine Today, and archived detail; no secrets or drift in older screenshot directories. |
| 18. Repository gates | Exact `npm run validate:pr` and `npm run validate:rc` pass with prior protected behaviors retained and route-policy completeness/sync matrix updated. Tests use disposable fixtures and controlled dates; do not wait overnight, alter the host clock, or deploy for acceptance. Build Report identifies commits and evidence per AT. |

Domain/HTTP tests supply edge matrices; browser evidence must actually create and use routines rather than replace the Product journey with API setup. Test-only date control may be added behind the existing test profile or injected clock; it must be unavailable in normal development/hosted behavior. A migrated fictional fixture may seed browser prerequisites; the UI performs the new-routine actions.

## Dependencies

- Integrated P0-004B r1 (`93ef494`) and current local Node 24 / SQLite / PR/RC tooling.
- Product's supplied P0-005 intent and deferred inventory are recorded in `PRODUCT.md`; no separate Product writeback remains required for that supplied material.
- Engineering readiness of this exact revision before implementation. No new account, hosted origin, physical phone, or external service is a prerequisite.

## Relevant decisions

- D-003/D-004: snapshot history, server truth, optimistic durable intent.
- D-006/D-008/D-010: membership authority, personal overlays, personal-task privacy.
- D-011, D-013–D-019: local validation, groups/access/UI/fixture conventions, dated source resolution and future participation.
- D-020: routine identity across configuration, personal work, and commands; populated upgrade baseline.
- D-021: weekday recurrence plus snapshotted dayparts.
- D-022: prospective routine archival with retained history.

## Known risks / assumptions

- This is broader than a UI-only change, but splitting persistence from executable multi-routine behavior would leave the central outcome unproven. One vertical brief with internal checkpoints is the selected decomposition.
- SQLite table rebuilds, legacy receipt interpretation, implicit proposal associations, retained future rows, and delayed client responses are the main compatibility risks; the ATs require direct evidence rather than relying on empty-schema success.
- Archive is deliberately one-way in r1. Restoring safely after group tombstones and skipped dates requires separate evidence; it is not needed to prove the requested lifecycle.
- P0-005 is a planning contract, not implemented behavior. Product acceptance of earlier technically accepted slices is not inferred from their merge.

## Engineering readiness

**Reviewed revision:** NOT REVIEWED
**Readiness:** NOT REVIEWED

Perform one consolidated repository-grounded review of P0-005 r1. Report concrete Questions/Blockers and ordinary implementation choices together. Await Architecture's response before implementation.

## Revision history

- **r1:** Initial multiple-routine outcome, routine-scoped personalization/commands, weekday/daypart configuration, prospective archive, populated upgrade, and local Product-journey evidence. Deferred product directions preserved without implementation commitments.
