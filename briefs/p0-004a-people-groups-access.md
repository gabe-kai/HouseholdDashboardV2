# BRIEF P0-004A - People, Groups, and Access Status

**Revision:** 2
**Status:** IN REVIEW

Recommended lifecycle: DRAFT -> IN REVIEW -> READY -> IMPLEMENTING -> IMPLEMENTED -> ACCEPTED

A material contract change increments the revision and invalidates previous Engineering readiness. `ACCEPTED` means Architecture has accepted the implementation against this contract; Project Lead evaluation remains separate.

## Why

The application authenticates household memberships, but a parent still discovers people indirectly through Morning Routine and enrollment. Before more responsibility types depend on that model, the household's people, access state, and reusable named groups need one direct, understandable home.

P0-004A establishes that foundation without yet making groups a routine audience. Group-backed Morning Routine behavior has distinct prospective and historical semantics and remains the follow-up P0-004B slice.

## Learning question

Can a parent understand and maintain the household's people, app-access state, and named groups on a phone without learning the underlying identity, token, or capability model?

## Player experience

An authorized parent opens Household → People & Groups and recognizes everyone in the household, including people with no account or assigned work. They can add a person, correct that person's name or Adult/Child classification, understand whether access is set up, safely prepare or replace access setup, and create/edit a group such as Kids. The normal flow talks about people and access—not membership IDs, claims, or grants.

## Project card

**Card title:** See and organize the people in the household

**Suggested column:** Up Next

**Player-facing goal:** Give the household a clear people list, understandable access status, and simple reusable groups.

**Done when:** A parent can add an unenrolled child, return later and understand that child's access state, and create or edit Kids comfortably from a phone.

**Tracking relationship:** Standalone first half of Product's P0-004 outcome; enables P0-004B group-backed Morning Routine.

## Current system

- `household_memberships` is already the household-person record. Its `user_id` is nullable and its status is `pending|active`; P0-002 preserved legacy member IDs as pending memberships.
- `users`, `user_credentials`, and `auth_sessions` represent app access separately. Claiming a membership attaches a user, activates the membership, assigns the selected existing grant preset, and creates a session.
- `enrollment_claims` stores a token digest, membership/household, preset, creation/expiry/consumption timestamps, and creator. It has no revocation timestamp or read model for person-centered setup status. Plaintext is returned only when a claim is issued.
- `POST /api/v1/enrollment/claims` can currently create a membership and claim together when no membership ID is supplied. The P0-004A user flow must instead create the person first and issue setup for that existing person.
- `GET /api/v1/memberships` exposes the household directory. Routine revisions reference individual membership IDs through `revision_assignees`; occurrences snapshot accountable membership IDs and names.
- The current grants include `household.member.enroll` but no capability whose meaning is household-structure management. Existing manager presets receive `household.member.enroll`.
- There is no group persistence or API. `SyncHub`, the P0-003 route-policy inventory, protected-behavior catalog, and local/CI validation tiers are established extension points.

## Behavioral contract

1. **Directory and projections.** Every active or pending membership in the current household appears in People & Groups regardless of account, enrollment, routine assignment, personal work, login history, or today's activity. Any active household membership may read basic people/group structure. Enrollment-claim details and structure mutations remain capability-protected.
2. **Independent person creation.** A membership with `household.structure.manage` can add a person using a trimmed display name and required `Adult|Child` classification. The server creates a pending membership with no user, credentials, claim, grants, group, or routine assignment. The UI shows the person after authoritative success; this administrative mutation does not use the checklist outbox.
3. **Stable person identity and editing.** Membership ID—not display name—is identity, so duplicate display names are allowed. An authorized manager can edit display name and classification. Those edits do not alter users, credentials, sessions, grants, groups, existing occurrence snapshots, execution facts, or other historical records.
4. **Existing-member migration.** Add a nullable descriptive classification field constrained to `adult|child`. Existing memberships migrate with classification unset because the repository contains no trustworthy age/classification fact. The UI says `Classification not set`; an authorized manager can correct it. New people require Adult or Child. Classification never grants or revokes authority.
5. **Structure authority.** Introduce `household.structure.manage` for adding/editing people and creating/editing/deleting groups. Add it to the existing manager preset and backfill it only to memberships that currently hold `household.member.enroll`; this preserves current manager behavior without inferring Adult/Child. `household.member.enroll` continues to govern access setup. No granular permission editor is introduced.
6. **Person detail.** A person view answers: who the person is, their classification, access state, groups, and current direct Morning Routine involvement. “Current” means inclusion in the latest shared revision effective on the household's current date, computed without materializing an occurrence. P0-004A does not show `Via group`; that arrives when P0-004B adds a group consumer.
7. **Access-state read model.** For a membership without an attached active user: an unconsumed, unrevoked, unexpired enrollment claim is `Setup ready`; if none exists and the latest non-revoked setup claim expired, state is `Setup expired`; otherwise it is `Not set up`. A membership attached to an enabled user is `Access set up`. APIs return this state and safe timestamps, never token digests, plaintext tokens, passphrase data, or session data.
8. **Safe setup lifecycle.** Normal authenticated setup issuance must target an existing, same-household membership that does not already have a user. At most one actionable enrollment claim exists per membership. Issuing a replacement transactionally revokes the previous actionable claim; cancellation revokes it without removing the person. Claim consumption activates access and invalidates any other actionable claim. Plaintext setup material is returned once at issuance and cannot be retrieved later; a returning parent sees status and may create a replacement after an explicit explanation.
9. **Access-level choice remains explicit.** Adult/Child does not silently select grants. Setup presents the existing presets in household language: `Household manager` (manage people/access/groups, shared Morning Routine, and approvals), `Independent member` (change their own routine directly), and `Guided member` (suggest routine changes for approval). Supporting text may mention own checklist/personal-task abilities, but raw grant names remain hidden. The selected preset is stored on the claim and applied only when claimed. No individual-grant editor is added.
10. **Simple groups.** A `household.structure.manage` membership can create a group with a trimmed 1–80-character name and zero or more current same-household membership IDs. Names must be unique within a household after the same normalization/case-fold comparison; duplicates return the stable validation/conflict response used by the API. Display names remain non-unique.
11. **Group editing and deletion.** The same authority can rename a group, replace its member set, or delete it after a clear confirmation. Membership replacement is transactional, rejects foreign/nonexistent membership IDs without partial writes, and uses an expected version so concurrent edits conflict and re-read rather than silently overwrite. In P0-004A deletion removes only the group and its join rows because no feature may reference groups yet; it never removes people or history.
12. **Groups remain structural.** A group grants no capability, changes no access state, widens no personal-task visibility, creates no assignment or occurrence, and supports no nesting, rules, schedules, or dynamic queries. Removing a person from a group removes only that association.
13. **Mutation safety.** Create-person, create-group, and setup issuance/replacement accept client mutation IDs so ambiguous retries cannot create duplicate people, groups, or claims. Person/group replay returns the original safe result. Setup replay returns the same claim identity/status but never replays plaintext; it explicitly reports that setup material was already issued so the parent may intentionally replace it. Edit operations are desired-state updates guarded by current version where applicable. Errors retain P0-003 machine codes, safe messages, and request IDs.
14. **Authorization and isolation.** All reads/writes are server-scoped to the authenticated household. Mutations enforce session, origin/CSRF, and the exact capability. A foreign person/group/claim ID is indistinguishable from a missing one. Group membership cannot cross households.
15. **Realtime convergence.** Successful person, access-state, and group mutations emit household-scoped invalidations. Open authorized clients re-read authoritative supporting data urgently enough that People & Groups and an open person/group view converge without manual reload. Duplicate/missed events remain safe; reconnect and visibility recovery converge through reads. No P0-004A form is added to the durable checklist outbox.
16. **Mobile and accessible interaction.** Core flows use vertical, semantically labelled views with practical touch targets, keyboard operation, logical focus, textual access/selection/error states, field-associated errors, and no horizontal scrolling, hover dependency, drag-and-drop, or modal chain at the established phone viewport.

## Implementation boundary

- Add ordered forward migration(s) after the current schema for nullable person classification, `household.structure.manage`, enrollment-claim revocation/status support, groups, group memberships, group versioning, and minimal mutation-receipt persistence. Preserve all IDs and occurrence/history data.
- Extend the existing store/service boundary, shared Zod schemas, Fastify routes, route-policy inventory, and `SyncHub` resource union. Prefer cohesive person/access/group methods over a generalized administration framework.
- Evolve Household into the canonical People & Groups path. Reuse the existing application shell and person-centered enrollment endpoint behavior; the old Enroll destination may redirect into or become a thin access overview, but must no longer be the primary unexplained token form.
- Retain server-authoritative forms with explicit pending/success/error feedback. Do not add administrative mutations to IndexedDB unless Engineering demonstrates a concrete requirement and returns it to Architecture.
- Extend `docs/protected-behaviors.md` with people/group/access invariants and the sync matrix. Add direct API, migration, domain/store, and Chromium/WebKit phone-width evidence. Update `ARCHITECTURE.md` and the Build Report with facts actually verified.

## Do not change

- Do not implement group selection in Morning Routine, audience resolution, overlap deduplication, prospective assignment changes, or future-occurrence reconciliation; those belong to P0-004B.
- Do not implement P0-005 responsibility types, Today hierarchy changes, rotation, eligibility, helpers, coverage, schedule engines, or exception days.
- Do not implement member deletion/departure/inactivation, multi-household switching, nested/query groups, group permissions, age-derived authority, a granular grant editor, broad account recovery, MFA, or device management.
- Do not use display name as identity or infer classification from capabilities except for the one-time structure-grant backfill specified above.
- Do not expose claim plaintext after issuance, token digests, credentials, private task content, or capability internals in ordinary UI, URLs, logs, fixtures, or reports.
- Do not weaken historical snapshots, household-time authority, authorization/isolation, private-task visibility, optimistic checklist execution, outbox identity safety, API/error contracts, or P0-003 validation gates.

## Acceptance tests

1. **Migration preservation:** Fresh migration and populated P0-003-baseline migration both succeed and are idempotent. Existing membership/user/claim/group-independent IDs and all sampled occurrence, step, report, proposal, personal-layer, and personal-task facts compare equal. Existing classifications are unset; existing `household.member.enroll` holders alone receive `household.structure.manage`.
2. **Independent creation/edit:** Through direct API and phone UI, an authorized manager creates Elizabeth as Child without a user, claim, grants, assignment, or task; she appears after reload. The manager edits her name/classification without changing an existing historical occurrence snapshot. Replaying the create mutation returns the same membership. Duplicate display names create distinct stable IDs.
3. **Authority matrix:** Direct API tests prove basic same-household reads, `household.structure.manage` mutations, and `household.member.enroll` setup actions independently. Missing grants, missing/wrong CSRF, disallowed origin, and cross-household IDs are rejected with no partial write or existence leak. Hidden controls are separately verified but do not count as authorization evidence.
4. **Person detail and responsibilities:** Person detail shows classification (including migrated `Classification not set`), access state, groups, and current direct Morning Routine involvement derived from the household-date-effective revision without creating an occurrence.
5. **Setup lifecycle:** Automated time-controlled tests prove Not set up → Setup ready → Access set up, Setup ready → Setup expired, cancellation → Not set up, and replacement revocation. Only the newly issued plaintext is returned once; list/detail/reload/replay responses expose safe status/timestamps only and replay explains that the secret was already issued. Replays do not create extra claims, and an already-enrolled person or revoked/expired/consumed token cannot be claimed.
6. **Access preset independence:** Phone UI presents `Household manager`, `Independent member`, and `Guided member` with understandable consequences and submits the corresponding existing preset separately from Adult/Child. Changing classification does not change grants; claiming applies exactly the selected preset plus no structure authority unless that preset defines it.
7. **Group lifecycle:** A parent creates empty and populated groups, rejects a normalized duplicate name, renames Kids, transactionally replaces members, handles stale-version conflict by re-reading, and deletes an unreferenced group after confirmation. Person rows and historical data remain unchanged. Create replay returns the same group.
8. **Group isolation and privacy:** Foreign/nonexistent membership IDs cannot enter a group; another household cannot observe group records/events; group membership grants no capability and does not expose another member's private personal tasks.
9. **Realtime recovery:** In two same-household authenticated browser contexts, add/edit person, setup-state, and create/edit/delete group mutations update an already-open relevant view without manual reload. Another household receives no event. Duplicate notification plus forced missed-notification reconnect/visibility paths converge through authoritative reads.
10. **Mobile journey and accessibility:** Chromium and WebKit at the established phone viewport complete People & Groups list, add/edit person, person detail, prepare/cancel/replace setup, create/edit/delete group, validation/conflict recovery, and reload-return journeys. Selected members and access states are textual, controls have accessible names, focus/errors are usable, and no primary flow requires horizontal scrolling.
11. **Regression gates:** `npm run validate`, `npm run validate:pr`, and `npm run validate:rc` pass exactly. The P0-003 route-policy completeness test, protected-behavior catalog, sync matrix, migration baseline, authorization/isolation, proposal sync, outbox, personal-task visibility, and historical-integrity evidence remain green. The Build Report separates new from reused evidence and local from any hosted evidence.

## Dependencies

- P0-003 r1 technically accepted and its local/CI gates active on the integration baseline.
- Existing P0-002 membership, enrollment, capability, migration, and synchronization contracts.
- No new external service, paid account, email delivery, or secret-bearing dependency.

## Relevant decisions

- D-002 - Single-process TypeScript web application
- D-003 - Versioned definitions and snapshotted occurrences
- D-006 - Users authenticate; memberships carry household authority
- D-010 - Personal task ownership and visibility are separate facts
- D-011 - Local-first validation with release-candidate hosted evidence
- D-012 - Household people are distinct from app access
- D-013 - Groups are named household sets, not authority or assignment engines
- D-014 - Household structure management has its own capability
- D-015 - Enrollment setup has one actionable, one-time-secret lifecycle

## Known risks / assumptions

- The existing pending-membership shape appears sufficient for an unenrolled person, but Engineering must verify claim, session, and seed interactions during readiness.
- Existing data contains no reliable Adult/Child fact; `Classification not set` is an intentional migration state, not a guessed product fact.
- The current three grant presets remain the access-level choices in this slice. Their user-facing names/descriptions are presentation work; changing their grant contents beyond adding `household.structure.manage` to the manager preset requires Architecture review.
- Group-backed routine audience and already-materialized-future behavior remain deliberately unresolved until P0-004B. P0-004A must not introduce hidden group consumers.

## Engineering readiness

**Reviewed revision:** 2
**Readiness:** READY

Engineering returned READY against revision 2 (see `reports/P0-004A-r2-engineering-readiness.md`) and implemented r2.

## Revision history

- **r1:** Initial bounded People, Groups, and person-centered access-status slice derived from Product's P0-004 proposal.
- **r2:** Corrected lifecycle status; separated structure/enrollment authority; resolved migrated classification, enrollment replacement/cancellation, group validation/deletion/concurrency, mutation replay, and direct-responsibility-summary contracts; strengthened mobile, isolation, synchronization, migration, and regression evidence.
