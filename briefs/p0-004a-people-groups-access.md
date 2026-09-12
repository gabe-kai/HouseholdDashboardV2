# BRIEF P0-004A - People & Groups UX Completion

**Revision:** 3
**Status:** FIX REQUIRED

Recommended lifecycle: DRAFT -> IN REVIEW -> READY -> IMPLEMENTING -> IMPLEMENTED -> ACCEPTED

A material contract change increments the revision and invalidates previous Engineering readiness. `ACCEPTED` means Architecture has accepted the implementation against this contract; Project Lead evaluation remains separate.

## Why

P0-004A r2 established the people, access, and group model, but Product evaluation found the phone experience difficult to understand. The current People & Groups page simultaneously renders the directory, add-person form, selected-person editor, access setup, group management, household-visible personal tasks, and the full household Morning Routine. Selecting a row changes content below the viewport instead of establishing a clear context.

The same evaluation exposed a separate repository defect in the normal local bootstrap path: development auto-seeds six fictional Reed memberships by default, and bootstrap also invokes that seed for an empty database. P0-004A is not complete while demo records masquerade as a real household.

Revision 3 preserves the working r2 domain/API contracts while completing the product's progressive-disclosure experience and separating explicit demo fixtures from normal bootstrap.

## Learning question

Can a parent understand and maintain the household's people, app-access state, and named groups on a phone without learning the identity/token model or searching through one long administration page?

## Player experience

People & Groups opens as a compact directory. Tapping a person or group replaces that overview with a focused, primarily read-only view and an obvious path back. Add, edit, and access setup appear only when deliberately opened. Household activity remains available through a focused secondary view rather than being stacked beneath the directory. A newly bootstrapped household contains only people the parent intentionally establishes.

## Project card

**Card title:** Make People & Groups easy to use

**Suggested column:** Up Next

**Player-facing goal:** Turn the working household directory into a clear phone experience with focused people, access, and group flows.

**Done when:** A parent can recognize the household, open or edit one person, manage access, create or edit Kids, and return without exploratory scrolling—and a fresh household contains no fictional family.

**Tracking relationship:** Continues the existing P0-004A card; do not create a second product card.

## Current system

- P0-004A r2 is implemented on `brief/p0-004a-people-groups-access` through `740d141`; its corrected Build Report names commits `656db28` and `740d141`. Exact local RC validation passed with 48 Vitest tests and 28 Chromium/WebKit scenarios.
- `PeopleGroupsView` currently appends selected-person detail and edit/access controls below the directory, keeps Add person permanently open, embeds group editing, then renders household-visible personal tasks. `App.tsx` appends `HouseholdProgressView` beneath the component for manager-capable sessions.
- The app uses internal React tab state and has no routing dependency. P0-004A subviews can be exclusive in-app states with explicit Back actions; browser-history routing is not required for this slice.
- The r2 server contracts already separate membership from account access, provide versioned person/group edits, one-actionable-claim setup lifecycle, stable capabilities, household isolation, mutation replay, and invalidation/re-read synchronization.
- Normal development currently sets `autoSeed` true unless `AUTO_SEED=0`; `.env.example` sets `AUTO_SEED=1`. Hosted mode forbids auto-seeding.
- `issueBootstrapClaim()` calls `seed("UTC")` when no household exists. `AppStore.seed()` creates the fixed evaluation household plus six fixed Reed memberships. The imported canonical seed module describes only three differently named members while `store.ts` separately defines the six-member list.
- Local `runtime/dev.sqlite` inspection on 2026-09-11 found exact fixture IDs ending `202`–`206` with no attached user, session, claim, assignment, occurrence, execution, personal layer/proposal/task, group membership, or other meaningful relationship; fixture ID `201` has active/session/decision relationships and is not safely removable. This evidence describes the inspected local file only and must not be generalized by display name.

## Behavioral contract

1. **Compact overview.** The default People & Groups state shows a heading, people/group counts, concise person rows, Add person, concise group rows, Create group, and—when needed—a short empty-group explanation. It does not render an open person/group editor, access credential, household-visible task list, or full Morning Routine checklist.
2. **Useful rows.** A person row shows name, known Adult/Child role, useful access state, and an explicit affordance that it opens detail. An unset migrated role is omitted from the overview rather than repeated as a warning. Group rows show name, member count, and the same navigational affordance. Rows are coherent full-width tap targets.
3. **Focused state model.** People & Groups has mutually exclusive states for overview, person detail, add person, edit person, access management, group detail, create group, edit group, and household activity. Only one primary state renders at phone width. Each non-overview state has an accessible Back to People & Groups—or Back to the parent detail—action, a state-specific heading, and focus/scroll placement at that heading so a tap produces an unmistakable context change. No new routing dependency is required.
4. **Person detail is read-first.** Person detail shows name, Role, access summary, groups, and current direct Morning Routine involvement. Editing and access management are explicit secondary actions; neither form appears on initial detail. If the role is unset, detail says `Role not selected` and offers Edit person to authorized users.
5. **Focused person forms.** Add person and Edit person are separate short states using `Name` and `Role` copy. New people require Adult or Child and remain independent from access setup. Migrated people may retain Not selected until edited. Native radio semantics are preserved, but each option is one aligned label/control tap target with no oversized detached control.
6. **Focused access management.** Person detail presents only the human access state and relevant action. The Access state contains the existing r2 access-level choices, issue/cancel/replace controls, one-time setup material, and explanations. Raw claim/grant terminology remains hidden; Adult/Child never selects authority. The r2 one-actionable-claim, revocation, replay, and one-time-secret contracts remain unchanged.
7. **Group view before edit.** Group detail first shows name and member names. Create group and Edit group/Edit members are focused forms; the checkbox list appears only there. Delete remains a secondary, confirmed action within group editing. Existing normalized-name, version-conflict, transactional membership, replay, isolation, and structural-only contracts remain unchanged.
8. **Household activity placement.** The overview may contain one restrained `View household activity` action but no activity records. It opens a focused state containing the existing household Morning Routine progress and household-visible personal tasks. This preserves manager progress access and personal-task visibility without treating activity as household structure. Users retain only the data their existing capabilities/visibility permit; no private task becomes visible.
9. **Realtime focused-state convergence.** Existing person/access/group invalidations refresh overview counts/rows and any currently open affected detail. If a remotely deleted group is open, return safely to the overview with a human message. Duplicate/missed events, reconnect, and visibility recovery continue to converge through authoritative reads without forcing a manual reload or silently dropping the user's current context.
10. **Normal bootstrap is fixture-free.** Development defaults to no automatic seed. `.env.example` and operator documentation use `AUTO_SEED=0`; only explicit test/demo configuration or `npm run db:seed` creates fictional fixtures. On an empty database, `auth:bootstrap` creates only the minimum household in the configured household timezone and bootstrap claim needed for the first manager to establish access; it does not call the demo seed or create additional people. Hosted fail-closed behavior remains unchanged.
11. **One fixture manifest.** Consolidate the evaluation household and six fixed membership IDs/names/presets into one canonical explicit demo fixture manifest used by store seeding and tests. Remove the conflicting duplicated three-member/six-member definitions. Tests continue to use fictional deterministic data only.
12. **Safe existing-fixture remediation.** Provide a documented operator command with dry-run default and explicit apply mode. It considers only IDs from the canonical fixture manifest in that manifest's fixed household—not display names. Apply first creates a normal database backup, then transactionally removes only a fixture membership for which the server proves: pending status, no attached user, no session or enrollment relationship, no routine revision/occurrence/execution relationship, no personal layer/proposal/task, no group membership, and no other durable reference. Seed-only grants and the legacy compatibility `members` row may be removed with that proven-safe membership. Blocked candidates are reported without exposing private content and remain unchanged. This is not a generic member-deletion API or UI.
13. **Current local cleanup expectation.** Against the inspected `runtime/dev.sqlite`, the remediation dry run should identify fixture IDs `202`–`206` as candidates and block `201`; apply may remove only candidates that still satisfy all predicates at execution time. The operator—not application startup—chooses whether to apply it. The command must remain safe if local state changes after this brief was written.
14. **Visual/accessibility baseline.** Phone layout drives the implementation. Overview/detail distinction, typography, spacing, lighter row separation, restrained status treatment, and aligned choice controls should create a calm household-oriented hierarchy without a new design system. Primary workflows have practical touch targets, keyboard operation, logical focus, text/non-color state, field-associated errors, no horizontal scroll, and no hover or drag dependency.
15. **Administrative response behavior.** Person/group/access forms remain server-authoritative rather than using the checklist outbox. Submissions immediately show pending feedback, disable accidental duplicate submission, preserve entered values on recoverable error, surface safe household-language errors, and navigate/show success only after authoritative confirmation.

## Implementation boundary

- Refactor `PeopleGroupsView` into small focused view/form components or an equivalent cohesive client structure. Use component-local/in-app navigation state and explicit Back actions; do not introduce a router solely for r3.
- Move `HouseholdProgressView` and household-visible personal tasks into the focused Household activity state while preserving their existing data sources, authority, synchronization, and privacy.
- Adjust client styling for hierarchy, row affordances, compact overview, radio/checkbox alignment, focus, and phone behavior. This is not a general design-system rewrite.
- Change development configuration/bootstrap so normal empty startup is fixture-free. Consolidate the explicit demo fixture manifest and retain deterministic test setup.
- Add a narrowly scoped cleanup script and package command with dry-run/apply behavior, automatic pre-apply backup, exact-ID/provenance checks, exhaustive relationship checks, transactionality, and machine-testable results. Do not run apply automatically or as part of migration/startup.
- Update browser tests that assert the r2 composite page to assert behavior across focused states. Extend protected-behavior/sync documentation and operator docs where contracts change.

## Do not change

- Do not redesign or replace the r2 people, access, group, authority, isolation, idempotency, versioning, or historical-integrity model except for the explicit fixture/bootstrap changes above.
- Do not implement group-backed Morning Routine, audience resolution, rotation, P0-005 responsibilities, broad global navigation, a routing framework, or a new design system.
- Do not add generic person deletion, departure/inactivity, multiple households, device administration, granular permission editing, account recovery, MFA, nested/query groups, or group permissions.
- Do not identify fixture records by display name. Do not remove any fixture-ID record with a user, claim, session, assignment, occurrence, execution, proposal, task, personal layer, group membership, or unknown durable reference.
- Do not expose claim plaintext after issuance, token digests, credentials, private task content, or capability internals in UI, URLs, logs, fixtures, cleanup output, or reports.
- Do not weaken P0-001/P0-002 history and execution, P0-003 protected contracts and validation tiers, or P0-004A r2 synchronization/privacy behavior.

## Acceptance tests

1. **Overview purpose:** At phone width, opening People & Groups shows only compact people/groups structure, counts, concise navigable rows, Add person/Create group, and the empty-group explanation when applicable. No editor, access credential/form, household-visible task record, or Morning Routine checklist is rendered before its explicit action.
2. **Person navigation:** Tapping Eli replaces the overview with focused read-only detail whose heading receives focus/is visible. Role, access, groups, and direct responsibility summary are present; no edit controls appear until Edit person. Back returns to the overview without exploratory scrolling.
3. **Add/edit person:** Focused Add person creates Elizabeth without access setup and returns to Elizabeth detail or the overview with clear success. Focused Edit person uses `Name`/`Role`; aligned native radio rows work by label tap, keyboard, and screen reader. Migrated unset role is omitted from overview but clear/actionable on detail. Existing r2 API/history tests remain green.
4. **Access flow:** From Elizabeth detail, Set up access opens only the access workflow. Existing preset explanations, setup-ready/expired/access-set-up states, one-time material, cancellation/replacement, reload, and replay behavior remain correct. Back returns to Elizabeth detail, not an unrelated page position.
5. **Group navigation:** Overview empty state teaches groups briefly. Create Kids in a focused form, land on its read-only detail, then explicitly edit members/name and save. Checkboxes are coherent tap targets. Delete requires confirmation and returns to overview without deleting people/history. Version conflict re-reads and gives actionable feedback.
6. **Household activity:** People & Groups renders no inline activity. The explicit Household activity state shows the same authorized household Morning Routine progress and household-visible personal tasks previously available; manager live progress and private-task exclusion tests pass. Back returns to the directory.
7. **Focused realtime:** With two authorized contexts, remote person/access/group mutations update the open overview or affected focused detail without reload. Remote deletion of the open group exits safely with a message. Cross-household, duplicate-event, reconnect, and visibility-recovery protections remain green.
8. **Fresh normal bootstrap:** With an empty database and default development configuration, application startup creates no household/member fixture. Running `auth:bootstrap` and claiming it creates one household with exactly the claimed manager and no Reed/demo memberships. Restart/reload preserves that state. Hosted still rejects auto-seed.
9. **Explicit demo/test fixture:** Explicit `db:seed`, test profile, or explicitly enabled demo seeding creates the canonical deterministic fictional fixture. Store/tests import one manifest; no conflicting member list remains. Existing integration/e2e fixtures remain deterministic.
10. **Cleanup dry run:** Against fixtures containing safe, unsafe, renamed, and same-name non-fixture people, dry run selects only exact manifest IDs in the manifest household and changes nothing. Display names never select a candidate. Output reports candidate/blocked counts and blocking relationship categories without private content.
11. **Cleanup apply:** Apply creates a backup, rechecks predicates transactionally, removes only safe fixture memberships plus seed-only grants/compatibility rows, and leaves unsafe/non-fixture people and all durable facts byte/field-equivalent. Re-running is idempotent. A simulated backup failure or newly introduced reference aborts deletion.
12. **Current local remediation rehearsal:** Using a disposable copy of `runtime/dev.sqlite`, dry run identifies `202`–`206` as candidates and blocks `201`; apply removes only still-safe candidates. The real local database is not mutated by automated tests or Engineering without explicit Project Lead instruction.
13. **Phone/accessibility and visual evidence:** Chromium and WebKit at the established phone viewport complete overview, person detail/edit/add/access, group detail/edit/create, household activity, and Back journeys without long composite-page discovery, horizontal scrolling, detached choice controls, inaccessible names, broken focus, or color-only state. The Build Report includes fictional-data phone-width screenshots of at least the overview, person detail, person edit/access, and group detail/edit states for Product evaluation.
14. **Regression gates:** `npm run validate`, `npm run validate:pr`, and `npm run validate:rc` pass exactly. The Build Report distinguishes new/reused evidence, records fixture-remediation rehearsal without private content, and separately reports any optional hosted evidence.

## Dependencies

- P0-004A r2 implementation and corrected Build Report on the current branch.
- Existing P0-003 protected-behavior, route-policy, migration, PR, and RC validation gates.
- Existing backup command for the remediation precondition.
- No new runtime service, account, paid dependency, router, or secret-bearing integration.

## Relevant decisions

- D-003 - Versioned definitions and snapshotted occurrences
- D-006 - Users authenticate; memberships carry household authority
- D-010 - Personal task ownership and visibility are separate facts
- D-011 - Local-first validation with release-candidate hosted evidence
- D-012 - Household people are distinct from app access
- D-013 - Groups are named household sets, not authority or assignment engines
- D-014 - Household structure management has its own capability
- D-015 - Enrollment setup has one actionable, one-time-secret lifecycle
- D-016 - People & Groups uses exclusive progressive-disclosure states
- D-017 - Demo fixtures are opt-in and remediated only by stable provenance plus reference safety

## Known risks / assumptions

- The focused-state model deliberately uses explicit in-app Back actions rather than introducing URL/deep-link/browser-history semantics. Product may revisit routing after broader navigation evidence exists.
- The current local cleanup result is time-sensitive. Engineering must test on a disposable copy and the operator command must re-evaluate every predicate at apply time.
- Existing demo household name/provenance is currently implicit in fixed IDs. Consolidating one canonical manifest is required before the cleanup command can be authoritative.
- Visual acceptance cannot be reduced to automated assertions. Product Lead phone evaluation remains required after Architecture technical acceptance.

## Engineering readiness

**Reviewed revision:** 3  
**Readiness:** READY  

Engineering returned READY against revision 3 (see `reports/P0-004A-r3-engineering-readiness.md`). Revision 2 readiness does not apply.

**Architecture acceptance review:** FIX REQUIRED (2026-09-11). Commit `b4256ac` delivers the focused-state structure and fixture-free bootstrap, but the submitted evidence and cleanup implementation do not yet satisfy revision 3:

1. Phone screenshots show radio buttons and checkboxes as oversized controls detached vertically from their text. `.form-grid input` applies text-field sizing to every input type, and `.form-grid label` wins over `.choice-row` display/alignment. Correct the scoped CSS so each native radio/checkbox and its text form one aligned, full-row tap target. Apply the established minimum touch target to secondary actions in these flows, including detail, access, group, and Household activity actions. Add focused geometry/computed-style evidence so the regression suite can distinguish an operable control from a correctly composed control.
2. `reports/p0-004a-r3-screenshots/04-person-access.png` persists one-time setup material. Replace it with secret-safe access-state evidence captured before issuance or with the sensitive element excluded at capture. No report artifact may retain claim plaintext or another credential, including fictional/test credentials.
3. Fixture cleanup is not yet exhaustive. Its relationship inventory omits at least legacy `sessions.member_id` and enrollment audit authorship through `enrollment_claims.created_by_membership_id`; it must also account for durable identity-bearing replay/audit payloads such as structure mutation receipts. Inventory all current durable references, block deletion when any non-seed-only reference exists, and test safe, renamed, same-name non-fixture, target-claim, creator/audit, legacy-session, group/history/personal, backup-failure, post-dry-run changed-state, and idempotent cases. Preserve dry-run, backup-first, transactional recheck, and disposable-copy-only rehearsal.
4. Update the Build Report after correction with the actual implementation and correction commit SHAs, corrected acceptance evidence, and no retained secret. This is enforcement of the existing r3 contract and does not require revision 4 or a new readiness review.

## Revision history

- **r1:** Initial People, Groups, and person-centered access-status slice.
- **r2:** Separated structure/enrollment authority and defined classification, safe setup, group lifecycle/concurrency, replay, synchronization, and regression contracts.
- **r3:** Product-requested UX completion: exclusive mobile overview/detail/edit/access/activity states, fixture-free normal bootstrap, canonical opt-in demo fixtures, and dry-run-first provenance/reference-safe remediation of existing contamination.
