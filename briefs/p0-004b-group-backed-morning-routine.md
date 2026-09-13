# BRIEF P0-004B - Group-backed Morning Routine

**Revision:** 1
**Status:** ACCEPTED

Recommended lifecycle: DRAFT -> IN REVIEW -> READY -> IMPLEMENTING -> IMPLEMENTED -> ACCEPTED

A material contract change increments the revision and invalidates previous Engineering readiness. `ACCEPTED` means Architecture has accepted the implementation against this contract; Project Lead evaluation remains separate.

## Why

P0-004A made named household groups usable, but Morning Routine still stores only individual membership assignments. A parent who creates `The Boys` must therefore maintain Daniel and Eli again inside Routine, and later group edits have no effect on responsibility.

P0-004B should make that relationship direct and understandable: Morning Routine may be for a named group, every member of that group receives one occurrence, and membership changes affect participation prospectively without rewriting today or history. This is the smallest evidence-producing use of groups and deliberately does not generalize assignment into rotation or rule machinery.

## Learning question

Can a parent configure and understand `Morning Routine is for The Boys` on a phone, then maintain participation by editing the group in one place, without duplicate work or loss of trust in today's and historical responsibility?

## Player experience

The normal Morning Routine view shows a compact `Who does this routine?` summary of selected groups, selected individuals, and the resulting unique number of people. An explicit Add/Edit action opens a focused, phone-friendly picker whose rows explain group membership and prevent redundant individual selection. Saving returns to the compact summary.

If a parent changes a group used by Morning Routine, People & Groups explains that participation changes on the next household day. Other open authorized clients converge without a manual reload. Today's work and past history do not change.

## Project card

**Card title:** Assign Morning Routine to a group

**Suggested column:** Up Next

**Player-facing goal:** Let a parent say `Morning Routine is for The Boys` and maintain those participants by editing the group once.

**Done when:** The parent can select The Boys, see who that includes, get one routine per person, and have next-day participation follow later group edits while today and history stay unchanged.

**Tracking relationship:** Standalone P0-004B card.

## Current system

- Current `main` at planning time is `9feec29`, which merged P0-004A r3 through PR #8. The working tree was clean before this Architecture writeback.
- The application remains one React/Vite client, one Fastify server, and one server-owned SQLite database. No external service or new deployment shape is needed for this slice.
- One `routine_definitions` row per household owns effective-dated immutable `routine_revisions`. A revision currently stores direct membership IDs only in `revision_assignees`; the shared request schema requires at least one `assigneeMemberIds` entry.
- `materializeForDate()` selects the effective routine revision and ensures one occurrence per direct assignee. SQLite already enforces uniqueness by definition, household date, and accountable membership. It does not currently resolve groups or actively reconcile previously materialized future participation.
- Occurrences snapshot their revision, title, accountable membership, schedule anchor, composed steps, and execution state. Existing definition/personalization contracts do not recompose an occurrence after materialization.
- `GET /api/v1/today` and `GET /api/v1/history` accept an explicit household date and can therefore materialize a future date. The step-status command currently does not reject a future-dated occurrence.
- P0-004A stores each group as a stable household-scoped ID plus one current member set. Group update replaces that set transactionally under `expectedVersion`; no dated group-membership history exists. Group deletion currently physically removes the group after an authority/household check.
- Group and routine mutations use household-scoped WebSocket invalidations followed by authoritative reads. People & Groups refreshes through current membership/group reads, while the current Routine editor fetches its routine on mount and renders all eligible individual checkboxes inline.
- `routine.shared.manage` governs Routine changes; `household.structure.manage` governs group changes. Group membership does not grant capabilities. Route-policy completeness, protected-behavior cataloging, local PR validation, and Chromium/WebKit RC validation are established by P0-003.

## Behavioral contract

1. **Compact participation summary.** Outside participation editing, Routine shows `Who does this routine?`, each selected group by name with a concise member description, each directly selected person, the unique resolved count, and one clear Add/Edit action. It does not keep the full household selector expanded. If a configured change is not yet operational, the summary distinguishes the applicable starting household date rather than calling it current today.
2. **Focused accessible picker.** Add/Edit opens one focused phone-width state with an in-app Back action and heading focus/scroll behavior consistent with D-016. Groups and People are distinct sections. A group row shows its current configured members (names for the household sizes in scope), the entire row is a practical keyboard/touch selection target, and selected-state meaning is available without color. Saving returns to the compact summary only after authoritative success; failure keeps the attempted values and gives a household-language error.
3. **Source-preserving routine revisions.** Each immutable routine revision preserves selected direct membership IDs and selected stable group IDs as separate source sets. Existing direct assignments migrate unchanged with no group sources. The wire/storage shape may retain `assigneeMemberIds` for compatibility, but must add group source IDs and a globally unique client mutation ID. At least one person or group source is required; a selected empty group is valid even when the resolved count is zero.
4. **Server-authoritative normalization.** At routine-save time, validate every selected source against the authenticated household, reject duplicate or foreign IDs, and remove a direct person source when that person is also included through a selected group for the new routine revision's effective date. The client reflects the normalized authoritative result. Overlapping groups remain selected because each is meaningful user intent.
5. **Later overlap preserves prior explicit intent.** A later group-membership edit may make a previously saved direct person source overlap a selected group. That edit must not silently rewrite the immutable routine revision or remove the explicit source. Resolution still produces one person; the summary may say that the person is also included through the group. The next deliberate Routine save normalizes any then-redundant direct source.
6. **Unique deterministic resolution.** For a target household date, resolve the effective routine revision's direct memberships plus the member sets effective for every selected group, then union by stable household-membership ID. Each membership receives at most one occurrence regardless of direct/group overlap or overlapping groups. Resolution and presentation ordering must be deterministic and independent of database row-return order or display-name identity.
7. **Dated group membership.** Preserve immutable group-membership versions separately from the latest configured group projection. Group creation establishes an initial version usable on its creation household date. A changed member set creates a version effective on the next household day; repeated same-day edits may append later versions for that same effective date, with the greatest group version deterministically winning. Rename-only edits are immediate presentation changes and do not alter dated membership. Migration establishes a baseline version for every existing group without changing its current configured members.
8. **Clear prospective feedback.** People & Groups continues to show the newly saved configured member set immediately. When a group is used by Morning Routine, group detail/edit says `Used by Morning Routine` and explains that member changes update Morning Routine beginning on the exact next household date. Success feedback identifies the group and effective date/count without technical audience terminology. Routine summary/preview exposes the corresponding upcoming result when it differs from today.
9. **Today and history remain fixed.** Editing a group's members never changes which people participate on the current household date or any earlier date. It never modifies an existing current/past occurrence, occurrence step, assignment snapshot, personal composition, report, mutation receipt, or historical group-membership version.
10. **Future participation is provisional.** For dates after the current household date, authoritative reads resolve participation from the routine revision and dated group membership even if occurrences were materialized earlier. Newly included people receive an occurrence when that date is materialized. Excluded people are not returned as participants and cannot act on a retained stale provisional row. A person who remains included keeps any already-materialized occurrence and its exact checklist snapshot; group reconciliation changes participation only and never recomposes surviving occurrence content.
11. **No destructive reconciliation.** Do not delete or rewrite an occurrence, occurrence step, execution report, or receipt merely because future group resolution excludes that member. Retained non-participating future rows are internal historical/provisional records and must not appear as actionable Routine work. If the member becomes included again before that date, the existing unique occurrence may become active again without duplication.
12. **Future execution guard.** The server rejects a checklist status command when the occurrence household date is later than the server-resolved current household date or when the accountable member is not resolved as a participant for that occurrence's stored routine revision and date. Delayed/offline reports for current or past valid occurrences remain supported. Rejection creates no execution report or successful receipt and gives the client an actionable safe error.
13. **Replay-safe Routine saves.** Creating the first routine and appending a routine revision are idempotent by mutation ID. Replaying the same authenticated-household mutation with the same payload returns the original committed result and creates no second definition/revision. Reusing the ID across another household, mutation kind, or materially different payload must not expose the original response and must safely conflict. A different mutation targeting an already occupied effective date retains the existing explicit conflict behavior.
14. **Rename and empty-group behavior.** Renaming a selected group preserves its stable routine reference and updates current presentation without changing effective participation. A selected group that becomes empty remains selected, resolves zero members through that source from its effective date, and can later be repopulated without editing Routine.
15. **Referenced deletion safety.** A group cannot be deleted while any routine revision that is operative today or scheduled for a future interval selects it. The server enforces this independently of UI and returns a safe conflict explaining that it must first be removed from Morning Routine. Once references are historical only, user-visible deletion is allowed, but group identity and dated membership needed to interpret immutable revisions/history are retained as a tombstone; deleted groups are excluded from current lists and new selection, and their normalized name no longer blocks a new current group.
16. **People remain independent of access and authority.** Any current household person, including a pending/unenrolled membership, may be a direct or group-resolved participant; lack of app access does not erase that responsibility record. Only `routine.shared.manage` may change Routine sources, only `household.structure.manage` may alter or delete groups, and `routine.execute.own` still governs acting on one's own occurrence after enrollment. Reading or selecting a group/person from another household is indistinguishable from not found or otherwise safely rejected. Membership in a selected group grants no execution, editing, approval, enrollment, structure, or personal-task authority.
17. **Realtime convergence.** A Routine source save invalidates open Routine summaries/pickers and relevant future previews. A group rename/member update invalidates People & Groups plus any Routine summary/picker/preview that consumes groups. A deletion or deletion conflict leaves other clients coherent. Duplicate, late, or missed events remain harmless; reconnect and visibility recovery re-read authoritative resources. Open authorized clients converge without a manual page reload, and an unsaved local picker is not falsely presented as saved.
18. **Household-language errors.** User-facing failures identify the attempted action (`Morning Routine couldn't be updated`, `The Boys couldn't be added`, or `Remove this group from Morning Routine before deleting it`) rather than exposing table, audience, receipt, token, or mutation terminology.

## Implementation boundary

- Add one ordered forward migration for source-preserving routine-group references, dated group-membership versions, Routine mutation replay, and history-safe group tombstones or an equivalent minimal representation. Preserve all existing IDs, revisions, occurrences, steps, reports, personal layers/proposals, tasks, and receipts.
- Keep the latest configured group set available to P0-004A People & Groups while adding a framework-independent resolver for a group's effective member set and a routine revision's unique membership set on a household date.
- Extend shared schemas/types, store/service logic, Fastify routes, route-policy inventory, and synchronization matrix only as required by this outcome. No new service, process, or runtime dependency is expected.
- Replace the Routine editor's always-expanded individual-assignee fieldset with a compact participation summary and focused picker, reusing D-016 interaction/focus conventions without adding a router or redesigning unrelated title/schedule/step editing.
- Add `Used by Morning Routine`, prospective group feedback, and referenced-delete conflict handling to focused group detail/edit states without turning People & Groups into a dependency-management screen.
- Make future-date materialization and status authorization use one deterministic participation resolver. Keep shared/personal step composition and occurrence snapshot creation in their existing domain/service boundaries.
- Update `docs/protected-behaviors.md` with the new audience, effective-date, future-reconciliation, deletion, and invalidation contracts. Extend existing unit/integration/e2e fixtures rather than relying on real household data.

## Do not change

- Do not implement P0-005, additional responsibility definitions, Kitchen/Cats/Bathroom, rotation, choose-one assignment, eligibility, weighting, fallback/helper pools, swaps, cover, chore debt, or retrospective reassignment.
- Do not add nested, dynamic, scheduled, cross-household, permission-bearing, or rule-engine groups. A group remains a named set of household memberships.
- Do not add generic person deletion/departure, account recovery, a granular permission editor, multi-household switching, or enrollment changes.
- Do not allow group edits to rewrite today's/past participation or any occurrence checklist snapshot, personal layer, proposal decision, execution report, or historical assignment fact.
- Do not flatten selected group sources permanently into copied individual assignments, and do not convert a group into individual sources when it is renamed, emptied, or deleted.
- Do not weaken optimistic checklist/outbox behavior, household/date authority, authentication/CSRF/origin protections, capability checks, personal-task privacy, P0-004A progressive disclosure/fixture safety, or P0-003 route/sync/validation gates.
- Do not require Railway or another hosted deployment for normal implementation or acceptance. Hosted/physical-device evidence remains a release-candidate concern under D-011.
- Do not add a router, generalized design system, external account, paid service, secret, or new runtime dependency without returning to Architecture.

## Acceptance tests

1. **Populated migration and compatibility:** Migrate the supported populated P0-001/P0-002/P0-004A fixture and a current-schema database. Existing direct-assignee revisions return the same people, every existing group receives the correct baseline membership version, historical bytes/fields and IDs remain unchanged, deleted-state defaults are safe, and migration re-application is idempotent.
2. **Source persistence and replay:** Save a Routine with one group and one outside direct person. The returned/reloaded revision preserves both source identities and the effective date. Replaying the same mutation returns the same definition/revision with no duplicate; same-ID/different-payload or cross-household replay safely conflicts without disclosure.
3. **Focused phone configuration journey:** Through normal UI at the established phone viewport, create Daniel and Eli if needed, create `The Boys`, open Routine, choose Add people or groups, select The Boys, observe both names and the one-per-member explanation, save, and return to a compact summary showing The Boys and `2 people` without the expanded picker.
4. **Occurrence result:** On the first applicable effective household date, Daniel receives exactly one occurrence and Eli receives exactly one occurrence. Repeated/concurrent materialization creates no duplicate. Their personal layers, if any, compose through the existing rules.
5. **Redundant and overlapping sources:** With The Boys selected, Eli is visibly `Included through The Boys` and cannot be added as a second direct source. Selecting Eli first and then The Boys normalizes to The Boys. Adding Sarah directly produces three unique people. Selecting an overlapping Kids group remains valid and still produces one occurrence per unique membership.
6. **Later-created overlap:** Save The Boys plus Sarah directly while Sarah is outside the group, then add Sarah to The Boys through People & Groups. The immutable Routine source selection still records Sarah directly, the summary explains/deduplicates the overlap, and Sarah receives one occurrence. A later deliberate Routine save removes the now-redundant direct source.
7. **Next-day add with future materialization:** Materialize an applicable future date before adding an existing child to The Boys. Save the group edit today. Today's participants/snapshots remain field-equivalent; re-reading the future date includes the child exactly once without editing Routine and without changing surviving occurrence content.
8. **Next-day removal with retained rows:** Materialize a future occurrence for Daniel, remove Daniel from The Boys today, and re-read. Today/history remain field-equivalent; beginning next household day Daniel is absent from actionable results while other members remain. Any retained Daniel future occurrence/steps/reports are not deleted or rewritten and cannot be mutated through a cached ID.
9. **Execution boundary:** A status command against a future-dated occurrence fails without a report/receipt. A delayed valid command for a current or past still-participating occurrence remains idempotent and succeeds under existing outbox rules. A stale cached occurrence excluded by effective group membership also fails safely when its date arrives.
10. **Multiple same-day group edits:** Perform two version-guarded member-set edits on the same household date. People & Groups shows the latest configured set immediately; today uses the prior effective set; the next day deterministically uses only the greatest-version member set. Stale `expectedVersion` still conflicts.
11. **Empty group and rename:** Select an empty group as the only source and save successfully with a zero-person explanation and no occurrences. Populate it and verify next-day participation without editing Routine. Rename it and verify stable references, counts, and occurrences remain intact while current UI uses the new name.
12. **Delete protection and history:** Deleting a group referenced by a currently operative or scheduled Routine interval fails through UI and direct API without partial change. After a future Routine revision removes it and its last operative date passes, deletion succeeds visibly; historical revisions and occurrence evidence remain interpretable, the group disappears from current pickers/lists, and a new group may use the old display name under a new ID.
13. **Authorization, access independence, and isolation:** Exercise Routine source and group mutation/read routes with manager, non-manager, pending/unenrolled, and foreign-household identities. A pending person can be selected and receives the dated responsibility without gaining login/execution authority; required grants are enforced server-side, foreign IDs do not leak, and adding a person to a selected group changes no grants or unrelated visibility.
14. **Realtime and missed-event recovery:** With two authorized contexts open—one on group detail and one on Routine summary/picker—rename/update the group and save Routine participation. Both views converge without reload. Duplicate notifications do not duplicate sources/people; a muted event recovers on reconnect or `visibilitychange`; recoverable save failure does not masquerade as success or discard picker input.
15. **Accessibility and Product evidence:** Chromium and WebKit complete the focused group-backed journey at phone width using keyboard and row-label activation with visible focus, associated names/errors, non-color selected state, practical touch geometry, no horizontal scroll, and correct Back/focus behavior. The Build Report includes fictional-data screenshots of the compact summary, focused picker, selected group explanation, used-group detail, and pending-next-day state for Product evaluation.
16. **Regression gates:** Existing protected tests remain green. `npm run validate`, `npm run validate:pr`, and `npm run validate:rc` pass exactly. The Build Report maps evidence to tests 1–15, distinguishes reused from new evidence, and reports hosted/physical checks as not required unless this exact commit is separately promoted as a release candidate.

## Dependencies

- Accepted and merged P0-004A r3 behavior on current `main`.
- D-003/D-004 historical snapshot and authoritative-reconciliation contracts.
- P0-003 protected-behavior catalog, route-policy completeness, and local PR/RC validation tiers.
- Existing household timezone/date resolver, group version guard, routine/personal composition, occurrence uniqueness, and backup/migration conventions.
- No new runtime service, external account, hosted deployment, paid dependency, router, or secret-bearing integration.

## Relevant decisions

- D-003 - Versioned definitions and snapshotted occurrences
- D-004 - Server-authoritative state with optimistic durable client intent
- D-006 - Users authenticate; memberships carry household authority
- D-008 - Personal routine changes are effective-dated overlays on stable shared items
- D-011 - Local-first validation with release-candidate hosted evidence
- D-012 - Household people are distinct from app access
- D-013 - Groups are named household sets, not authority or assignment engines
- D-014 - Household structure management has its own capability
- D-016 - People & Groups uses exclusive progressive-disclosure states
- D-018 - Routine revisions preserve source intent and resolve dated group membership
- D-019 - Future occurrence participation is provisional but snapshots are durable

## Known risks / assumptions

- The latest configured group set is visible immediately in People & Groups while its responsibility effect is dated. UI copy must not confuse `saved now` with `changes today's routine`.
- Direct selections are normalized only by a deliberate Routine save. A later group edit does not erase prior explicit direct intent; this is the least surprising behavior if the person later leaves the group.
- The repository currently permits future-date materialization. P0-004B retains that evaluability but explicitly prevents future execution and validates effective participation when acting from a cached occurrence.
- History-safe user-visible group deletion requires retained identity even though the current P0-004A implementation physically deletes groups. Exact table/index mechanics remain Engineering discretion as long as the behavioral and migration contracts hold.
- The deterministic browser journey should use fixed test household time/date controls or existing test seams; it must not wait for a real midnight or depend on the host timezone.

## Engineering readiness

**Reviewed revision:** 1  
**Readiness:** READY  

Engineering returned READY against revision 1 (see `reports/P0-004B-r1-engineering-readiness.md`). Inspection was against `main` @ `9feec29`. No blockers; material gaps are intentional contract deltas covered by D-018/D-019.

**Architecture disposition:** FIX REQUIRED. The contract is unchanged, but the current implementation does not yet satisfy the household-local baseline-date or current-versus-next-day summary contract. Engineering may correct the same r1 directly; no new readiness review is required.

**Architecture reassessment:** ACCEPTED (2026-09-13). Commit `ac41538` resolves the same-revision findings: migration/backfill derives baseline dates in the household timezone with near-UTC-midnight regression evidence; the routine API and editor distinguish effective participation from future configured membership and label the future start date; and focused dual-context e2e evidence proves open group-detail and Routine views converge without reload for source and membership changes. `validate:pr` and `validate:rc` pass. Hosted evidence is not required for this development slice. The Build Report still contains stale wording that the correction is uncommitted; the repository commit is the authoritative status.

## Revision history

- **r1:** Initial source-preserving group-backed Routine contract, including next-day group membership, unique resolution, future participation reconciliation, referenced deletion, realtime convergence, and automated Product journey.
