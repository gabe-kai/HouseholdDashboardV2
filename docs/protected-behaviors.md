# Protected behaviors, synchronization matrix, and validation tiers (P0-003)

This document is the durable contract catalog for accepted P0-001/P0-002 behavior.
Machine-checkable route policy lives in `src/server/route-policy.ts`.

**Escaped-defect rule:** Every future escaped defect that violates a protected behavior
must add or strengthen a regression test before or alongside its fix. The P0-002 open-view
proposal-status defect remains permanently covered by
`tests/e2e/morning-routine.spec.ts` → `manager approval updates open personalize proposal status without reload`.

**Supported migration baseline:** the representative populated pre-P0-002 fixture built by
`tests/helpers/p001-fixture.ts` (`applyPopulatedP001Fixture`), plus idempotent re-application
of current migrations. Changing that baseline later requires an Architecture decision.

## Validation tiers

| Tier | Command | Contents |
| --- | --- | --- |
| Developer | `npm run validate` | lint + typecheck + Vitest |
| Pull request | `npm run validate:pr` | validate + build + Chromium Playwright |
| Release candidate | `npm run validate:rc` | validate + build + Chromium + WebKit Playwright |

GitHub Actions runs `validate:pr` on pull requests and pushes to `main`. It uses no
repository secrets and does not deploy. Making the check **required** for merge is a
Project Lead repository setting (not asserted by Engineering alone).

Hosted/physical-phone evidence applies only when a candidate is actually released or
deployed. It is never required during the normal development loop. See `docs/ops-deploy.md`.

When adding a mutation-producing API operation: extend the synchronization matrix below,
extend `ROUTE_POLICY_INVENTORY` if a new route appears, and add automated evidence for
invalidation/reconciliation semantics.

## Protected-behavior catalog

| ID | Contract | Automated evidence | Tier |
| --- | --- | --- | --- |
| PB-01 | Historical immutability of occurrence snapshots | `tests/integration/p0-001.test.ts` (future revision leaves past occurrence) | Developer |
| PB-02 | Assignment vs execution separation | `tests/integration/p0-001.test.ts` | Developer |
| PB-03 | Household-local dates (not device TZ) | `src/domain/time.test.ts`; `tests/integration/p0-001.test.ts` | Developer |
| PB-04 | Stable item identity and composition | `src/domain/compose.test.ts`; `tests/integration/p0-002-http.test.ts` (logical-item migration) | Developer |
| PB-05 | Optimistic checklist interaction | e2e `child rapid checklist stays optimistic under delayed mutations` | PR / RC |
| PB-06 | Authoritative reconciliation after sync | e2e reconnect + Today refresh; e2e `visibilitychange re-reads authoritative state after missed sync`; `src/domain/reconcile.test.ts` | Developer + PR |
| PB-07 | Outbox membership identity safety | `src/client/outbox.test.ts`; e2e outbox reload + logout/identity | Developer + PR |
| PB-08 | Authentication, origin, CSRF | `tests/integration/p0-002-http.test.ts` (origin); `tests/integration/p0-003-contracts.test.ts` (CSRF) | Developer |
| PB-09 | Authorization / grant isolation | `tests/integration/p0-002-http.test.ts` capability matrix | Developer |
| PB-10 | Household isolation (HTTP + WS) | `tests/integration/p0-002-http.test.ts`; `src/server/sync-hub.test.ts` | Developer |
| PB-11 | Personal-task visibility | `tests/integration/p0-003-contracts.test.ts`; e2e `personal-task UI projects private vs household visibility`; store cases in `p0-002.test.ts` | Developer + PR |
| PB-12 | Migration preservation + idempotent reapply | `tests/integration/p0-003-migration.test.ts`; prior `p0-002.test.ts` migrate case | Developer |
| PB-13 | Stable API / error / idempotency semantics | step mutationId in `p0-001.test.ts`; task mutationId in `p0-003-contracts.test.ts`; route inventory completeness | Developer |
| PB-14 | Realtime invalidation model (duplicate/missed safe) | `src/server/sync-hub.test.ts`; e2e reconnect; e2e visibilitychange recovery; proposal-status e2e | Developer + PR |
| PB-15 | Open-view proposal-status sync (escaped defect) | e2e `manager approval updates open personalize proposal status without reload` | PR / RC |
| PB-16 | People directory independent of access | `tests/integration/p0-004a.test.ts`; e2e People & Groups focused states | Developer + PR |
| PB-17 | Access-state lifecycle + one-time setup secret | `tests/integration/p0-004a.test.ts` (ready/expired/cancel/replace/replay) | Developer |
| PB-18 | Structure manage vs enroll authority | `tests/integration/p0-004a.test.ts` HTTP matrix | Developer |
| PB-19 | Groups are structural only (no grants/assignments) | `tests/integration/p0-004a.test.ts`; e2e group edit | Developer + PR |
| PB-20 | Fixture-free normal bootstrap; opt-in seed; provenance-safe cleanup | `tests/integration/p0-004a.test.ts` (r3) | Developer + PR |
| PB-21 | Group-backed Morning Routine audience (direct + group sources; dated membership resolution) | `tests/integration/p0-004b.test.ts`; e2e `z-group-backed-routine.spec.ts`; `src/domain/participation.test.ts` | Developer + PR |
| PB-22 | Future checklist status guard (reject future household dates; no report/receipt) | `tests/integration/p0-004b.test.ts` | Developer |
| PB-23 | Referenced group delete blocked while operative/scheduled Routine selects the group | `tests/integration/p0-004b.test.ts` | Developer + PR |
| PB-24 | Routine create/revision mutationId replay (same household+kind+digest returns original; mismatch conflicts without disclosure) | `tests/integration/p0-004b.test.ts` | Developer |
| PB-25 | Multiple independent household routines (definitions, dayparts, scoped personal/proposals, independent Today) | `tests/integration/p0-005.test.ts`; e2e `z-multiple-routines.spec.ts`; `src/domain/daypart.test.ts` | Developer + PR |
| PB-26 | Prospective routine archive / End with retained history and cutoff (legacy tomorrow cutoff retained; new End immediate for unstarted) | `tests/integration/p0-005.test.ts`; e2e archive/end journey | Developer + PR |
| PB-27 | Populated P0-004B → P0-005 migration (stable IDs, Morning daypart, unresolved orphan proposals; schedule-entry backfill) | `tests/helpers/p004b-fixture.ts`; `tests/integration/p0-005.test.ts`; `tests/integration/p0-003-migration.test.ts` | Developer + PR |
| PB-28 | First-execution structural lock; current-plan range refine for unstarted; per-person divergence; pending first-action protection | `tests/integration/p0-005.test.ts` (AT19 + r3 lifecycle); `src/domain/occurrence-lock.test.ts`; `src/domain/reconcile.test.ts`; `src/domain/plan.test.ts` | Developer + PR |
| PB-29 | Intentional schedule-entry lifecycle (create/edit/move/delete upcoming; one entry per start date) | `tests/integration/p0-005.test.ts` (r3 schedule lifecycle) | Developer |
| PB-30 | Safe Delete unused routine; End preserves started visibility/authority | `tests/integration/p0-005.test.ts` (r3 schedule lifecycle) | Developer |
| PB-31 | Plan-labeled shell + addressable Today/Plan/Household URLs; SPA fallback whenever clientDist exists; signed-out resume; generic unavailable | e2e `z-p0-006a-calm-experience.spec.ts`; `src/client/nav.ts`; `src/server/app.ts` | PR / RC |
| PB-32 | Focused routine draft sections + outer dirty Keep/Discard; success toast vs durable errors/pending/enrollment | e2e `z-p0-006a-calm-experience.spec.ts`; lifecycle/AT6 e2e adapted to Plan/focused UI | PR / RC |
| PB-33 | Draft step reorder via drag handle and keyboard Move menu; Personalize additions-only; stable logical IDs | e2e `z-p0-006a-calm-experience.spec.ts`; `OrderedList` + DirectPersonalization | PR / RC |
| PB-34 | Closed step applicability + household school calendar editions; School nights via D+1 | unit `applicability.test.ts`; integration `p0-006b.test.ts` | PR / RC |
| PB-35 | Calendar edits reconcile unstarted work; past/started snapshots frozen; filtered-empty omitted from Today | integration `p0-006b.test.ts` History + materialize cases | PR / RC |
| PB-36 | `household.schedule.manage` write grant; readers without write; migration Every-time default + grant backfill | integration `p0-006b.test.ts` AT1/AT4 | PR / RC |
| PB-37 | Membership profiles + saved family order; claim preserves profile/order; structure.manage writes | integration `p0-006c.test.ts`; e2e `z-p0-006c-profiles-history-clear.spec.ts` | PR / RC |
| PB-38 | History reads are side-effect-free over stored evidence; summaries + step_reports detail | integration `p0-006c.test.ts` AT6/AT7; e2e History journey | PR / RC |
| PB-39 | Evaluation clear deletes household checklist activity/receipts only; generation + floor fence outbox | integration `p0-006c.test.ts` AT9–12; e2e `z-p0-006c-reset-outbox.spec.ts` | PR / RC |
| PB-40 | Responsibility kind + one occurrence per definition/date; fixed owner; routine APIs reject responsibility IDs | integration `p0-007a.test.ts` AT1/AT2/AT9; route-policy | Developer |
| PB-41 | Responsibility first-action locks structure and accountable membership; intendedStructure on checklist commands | integration `p0-007a.test.ts` AT5/AT6; outbox unit | Developer + PR |
| PB-42 | Mixed Plan/Today/Household/History with per-kind grants; Clear activity acknowledges routines and responsibilities | e2e `z-p0-007a-cats-trash.spec.ts`; `z-p0-007a-reset-outbox.spec.ts`; integration clear AT11 | PR / RC |
| PB-43 | Closed assignment forms (fixed / take turns / weekly); deterministic opportunity-count anchors; dated group eligibility | unit `responsibility-assignment.test.ts`; integration `p0-007b.test.ts` AT2 | Developer |
| PB-44 | Base work plus scheduled additions; owner-setting addition owns the composed occurrence; overlap rejection | unit `responsibility-composition.test.ts`; integration `p0-007b.test.ts` AT8; e2e Kitchen/Bathroom | Developer + PR |
| PB-45 | Shared side-effect-free preview (saved + draft) agrees with materialization; Unassigned nullable only for unstarted responsibilities | integration `p0-007b.test.ts` AT3/AT7/AT10; e2e Cats/Trash + Kitchen | Developer + PR |
| PB-46 | Populated through-013 upgrade through 014 maps fixed plans losslessly; new screenshots only under `reports/p0-007b-r1-screenshots/` | integration `p0-007b.test.ts` AT1; fixture `tests/helpers/p013-fixture.ts` | Developer |

### Environment-specific (not counted as automated acceptance)

| ID | Evidence | Notes |
| --- | --- | --- |
| ENV-01 | Hosted HTTPS / physical phones / restart / backup | Release-candidate hosted checklist in `docs/ops-deploy.md` |
| ENV-02 | GitHub required-check branch protection | Project Lead repository setting |

## Synchronization matrix

Events are household-scoped **invalidation** signals. Clients re-read authoritative resources.
Duplicate, late, and missed events must be safe.

| API mutation | Resource changed | Emitted invalidation | Client reads that go stale | Optimistic state | Duplicate semantics | Missed-event recovery |
| --- | --- | --- | --- | --- | --- | --- |
| POST `/auth/login` | session | *(none)* | — | — | new session | n/a |
| POST `/auth/claim` | user/membership/session | `membership` | memberships, session | — | claim single-use | reconnect + session |
| POST `/auth/logout` | session revoked | *(none)* | — | outbox cleared for membership | — | re-login |
| POST `/enrollment/claims` | claim row | `membership` | people, memberships | — | same `mutationId` replay (no plaintext); replacement revokes prior | fetch people |
| DELETE `/people/:id/setup` | claim revoked | `membership` | people | — | revoke actionable | fetch people |
| POST `/people` | pending membership | `membership` | people | — | same `mutationId` replay | fetch people |
| PATCH `/people/:id` | membership fields | `membership` | people | — | version conflict | fetch people |
| POST `/groups` | group + members + baseline membership version | `group` | groups, people detail, routines, previews | — | same `mutationId` replay | fetch groups + routines |
| PATCH `/groups/:id` | group + members; dated membership version when set changes | `group` | groups, people detail, routines, previews | — | expectedVersion conflict | fetch groups + routines |
| DELETE `/groups/:id` | group tombstoned (or CONFLICT if referenced) | `group` | groups, people detail, routines, previews | — | delete once; referenced → CONFLICT | fetch groups + routines |
| POST `/routines` | definition+revision (+ group sources) | `routine` (definitionId) | routines list/detail, today, preview, people/group refs | — | same `mutationId` replay (household+kind+definition+digest) | fetch routines/today |
| POST `/routines/:id/revisions` | immutable revision content + schedule entry retarget; governed-range unstarted reconcile; refineOutcome | `routine` (definitionId) | routines list/detail, today, preview, people/group refs | — | same `mutationId` replay; current vs schedule mode; one active entry per start date | fetch routines/today; pending locking first-action outbox keeps local structure |
| POST `/routines/:id/archive` | legacy archive cutoff (tomorrow; end_mode=legacy_archive) | `routine` (definitionId) | routines list/detail/archived, today, preview, people/group refs | — | same `mutationId` replay (household+archive+definition+digest) | fetch routines/today |
| POST `/routines/:id/end` | immediate End; cancel today+ unstarted + upcoming entries; keep started | `routine` (definitionId) | routines list/detail/ended, today, history | — | same `mutationId` replay | fetch routines/today |
| POST `/routines/:id/delete` | hard-delete unused graph; retain deletion receipt | `routine` (definitionId) | routines list | — | same `mutationId` replay; CONFLICT if started/reports/personal/proposals | fetch routines |
| POST `/routines/:id/schedule-entries/:entryId/move` | move upcoming start_date; re-reconcile ranges | `routine` (definitionId) | routines, today | — | same `mutationId` replay; CONFLICT on occupied date | fetch routines/today |
| POST `/routines/:id/schedule-entries/:entryId/delete` | cancel upcoming entry; recompose vacated interval | `routine` (definitionId) | routines, today | — | same `mutationId` replay | fetch routines/today |
| POST `/responsibilities` | responsibility definition+revision (assignment plan + optional scheduled additions) | `responsibility` (definitionId) | Plan responsibilities, today, activity, History | — | same `mutationId` replay | fetch responsibilities/today |
| POST `/responsibilities/:id/revisions` | current/schedule revise; unstarted owner/structure reconcile in place | `responsibility` (definitionId) | Plan detail, today (former/new owner), activity | dirty draft retained | same `mutationId` replay; expectedVersion | fetch responsibilities/today |
| POST `/responsibilities/:id/end` | End; cancel unstarted; keep started/history | `responsibility` (definitionId) | Plan ended, today, History | — | same `mutationId` replay | fetch responsibilities/today |
| POST `/responsibilities/:id/delete` | hard-delete unused; block started/reports/prior-date history | `responsibility` (definitionId) | Plan list | — | same `mutationId` replay; CONFLICT if retained | fetch responsibilities |
| POST `/responsibilities/:id/schedule-entries/:entryId/move` | move upcoming | `responsibility` (definitionId) | Plan, today | — | same `mutationId` replay; CONFLICT occupied date | fetch responsibilities/today |
| POST `/responsibilities/:id/schedule-entries/:entryId/delete` | cancel upcoming | `responsibility` (definitionId) | Plan, today | — | same `mutationId` replay | fetch responsibilities/today |
| GET `/responsibilities/:id/preview` | saved seven-day resolution (read-only) | *(none)* | — | — | never materializes | n/a |
| POST `/responsibilities/preview-draft` | draft/saved-plan preview (read-only; manager) | *(none)* | — | — | never materializes; no rotation advance | n/a |
| POST `/occurrences/.../status` | occurrence step + report; locking statuses set `started_at` once; responsibility sets performer; intendedStructure bind | `occurrence` (+version) | today, history, activity | membership outbox overlay; pending locking action protects structure | same `mutationId` idempotent; started survivors allowed after audience/end; canceled unstarted rejected; undo never clears `started_at`; cross-kind receipt conflict | refresh today; flush outbox; merge keeps local structure while locking action pending |
| PUT `/personal-layer` | personal layer revision (definition-scoped) | `routine` (definitionId) | preview, future today, Personalize | — | new layer revision for that definition | preview/today for definition |
| POST `/proposals` | proposal pending (definition-scoped) | `proposal` | proposals | — | new proposal bound to definitionId | fetch proposals |
| POST `/proposals/:id/decide` | proposal (+ optional layer for stored definition) | `proposal`; `routine` if approved | proposals, preview | — | same decision idempotent; opposite conflicts; archived target rejectable | fetch proposals + preview |
| GET `/school-calendar` | calendar projection | *(none)* | — | — | read | n/a |
| PUT `/school-calendar` | calendar edition + unstarted reconcile | `school_calendar` (householdId, version) | today, history previews, open calendar, dated routine previews | draft retained on conflict | same `mutationId` replay; expectedVersion conflict | fetch school-calendar + today |
| PATCH `/people/:id` | membership profile (+ compatibility name) | `membership` | people, account label, audiences, History names | dirty profile draft retained | expectedVersion conflict | fetch people/session |
| PUT `/people/order` | household family order + order version | `family_order` | people directory, group/audience peer lists, History person groups | dirty reorder draft retained | same `mutationId` replay; expectedVersion conflict | fetch people |
| GET `/history` | stored occurrence summaries (read-only) | *(none)* | — | — | never materializes | n/a |
| GET `/history/occurrences/:id` | stored detail + step_reports | *(none)* | — | — | foreign → NOT_FOUND | n/a |
| POST `/household/activity/clear` | erase checklist graph + scoped receipts; bump generation/floor; acknowledged `routines_and_responsibilities` (legacy rejected when responsibility data exists) | `activity_reset` | today, History, settings | retire older outbox for this membership | same `mutationId` replay; expectedGeneration conflict; config∧grant gate | refresh today/history; clear old outbox |
| POST `/personal-tasks` | task | `personal_task` | personal-tasks | — | new task | fetch personal-tasks |
| POST `/personal-tasks/:id/status` | task status | `personal_task` | personal-tasks | — | same `mutationId` idempotent | fetch personal-tasks |
| POST `/test/bootstrap-claim` | claim | *(none)* | — | — | test-only | n/a |

WebSocket `GET /api/v1/sync` delivers invalidations only. Connect also sends a synthetic
`routine`/`connected` notice. Recovery: reconnect, `visibilitychange`, and online handlers
re-read `/today` and supporting data; pending outbox flushes under the active membership only.
Activity generation must be established before replaying outbox after `activity_reset`.
