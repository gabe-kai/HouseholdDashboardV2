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
| PB-16 | People directory independent of access | `tests/integration/p0-004a.test.ts`; e2e People & Groups | Developer + PR |
| PB-17 | Access-state lifecycle + one-time setup secret | `tests/integration/p0-004a.test.ts` (ready/expired/cancel/replace/replay) | Developer |
| PB-18 | Structure manage vs enroll authority | `tests/integration/p0-004a.test.ts` HTTP matrix | Developer |
| PB-19 | Groups are structural only (no grants/assignments) | `tests/integration/p0-004a.test.ts`; e2e group edit | Developer + PR |

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
| POST `/groups` | group + members | `group` | groups, people detail | — | same `mutationId` replay | fetch groups |
| PATCH `/groups/:id` | group + members | `group` | groups, people detail | — | expectedVersion conflict | fetch groups |
| DELETE `/groups/:id` | group removed | `group` | groups, people detail | — | delete once | fetch groups |
| POST `/routines` | definition+revision | `routine` | routines, today, preview | — | create once | fetch routines/today |
| POST `/routines/:id/revisions` | revision | `routine` | routines, today, preview | — | append revision | fetch routines/today |
| POST `/occurrences/.../status` | occurrence step + report | `occurrence` (+version) | today, history | membership outbox overlay | same `mutationId` idempotent | refresh today; flush outbox |
| PUT `/personal-layer` | personal layer revision | `routine` | preview, future today | — | new layer revision | preview/today |
| POST `/proposals` | proposal pending | `proposal` | proposals | — | new proposal | fetch proposals |
| POST `/proposals/:id/decide` | proposal (+ optional layer) | `proposal`; `routine` if approved | proposals, preview | — | same decision idempotent; opposite conflicts | fetch proposals + preview |
| POST `/personal-tasks` | task | `personal_task` | personal-tasks | — | new task | fetch personal-tasks |
| POST `/personal-tasks/:id/status` | task status | `personal_task` | personal-tasks | — | same `mutationId` idempotent | fetch personal-tasks |
| POST `/test/bootstrap-claim` | claim | *(none)* | — | — | test-only | n/a |

WebSocket `GET /api/v1/sync` delivers invalidations only. Connect also sends a synthetic
`routine`/`connected` notice. Recovery: reconnect, `visibilitychange`, and online handlers
re-read `/today` and supporting data; pending outbox flushes under the active membership only.
