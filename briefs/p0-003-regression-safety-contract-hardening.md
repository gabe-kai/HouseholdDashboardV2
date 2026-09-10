# BRIEF P0-003 - Regression Safety and Contract Hardening

**Revision:** 1
**Status:** IN REVIEW

Recommended lifecycle: DRAFT -> IN REVIEW -> READY -> IMPLEMENTING -> IMPLEMENTED -> ACCEPTED

A material contract change increments the revision and invalidates previous Engineering readiness. `ACCEPTED` means Architecture has accepted this technical contract; Project Lead/product acceptance is separate.

## Why

P0-001 and P0-002 established interacting contracts for identity, authority, persistence, history, optimistic client state, and realtime reconciliation. The escaped P0-002 defect—an approved proposal remained visibly Pending in an already-open client—showed that individually correct persistence, authorization, and event delivery do not guarantee correct end-to-end state convergence. Before adding multiple responsibilities, the repository needs durable, routinely enforced evidence for the behavior already trusted.

## Learning question

Can risk-focused contracts and validation gates make future changes safer without slowing the normal local development loop or creating a generalized test framework?

## Player experience

The existing application should behave the same. Household members continue to get immediate checklist feedback, trustworthy history, current shared state, and correctly scoped private information while contributors receive fast regression feedback before changes are merged.

## Project card

**Card title:** Keep trusted household behavior from regressing

**Suggested column:** Up Next

**Player-facing goal:** Preserve fast, private, historically trustworthy household behavior while the product grows.

**Done when:** Core P0-001/P0-002 behavior is explicitly mapped to automated evidence, the escaped proposal-sync defect is permanently protected, and proposed changes run the agreed local/CI gate before merge.

**Tracking relationship:** Standalone enabling outcome for P0-004 and later household features.

## Current system

- `main` contains technically accepted P0-002 r1.
- The application is a single-package TypeScript system: React/Vite client, Fastify HTTP/WebSocket server, and SQLite through `better-sqlite3`.
- Checklist intent is optimistic and persisted in a membership-namespaced IndexedDB outbox. SQLite is authoritative; WebSocket messages invalidate client projections and trigger authoritative reads.
- Existing coverage comprises Vitest domain/integration tests and ten Playwright scenarios run in Chromium and WebKit. It already covers substantial P0-001/P0-002 behavior, including the proposal-status defect; P0-003 must audit and extend this evidence rather than duplicate it indiscriminately.
- Local use is available through `npm run dev` and `npm run dev:lan`. Existing validation commands are `npm run validate`, `npm run build`, `npm run test:e2e:chromium`, and `npm run test:e2e`.
- There is currently no `.github` CI workflow or repository-owned contract inventory.

## Behavioral contract

1. Establish one authoritative protected-behavior catalog with stable IDs. At minimum it covers historical immutability; assignment/execution separation; household-local dates; stable item identity and composition; optimistic interaction; authoritative reconciliation; outbox identity safety; authentication/authorization/isolation; visibility; migration preservation; and stable API/error semantics.
2. Map each catalog entry to existing or new automated evidence and its validation tier. A genuinely environment-specific manual or hosted check may be named separately, but it may not be represented as automated evidence. An unresolved automatable contract gap prevents acceptance.
3. Preserve immediate optimistic checklist interaction while making duplicate submission, delayed/out-of-order responses, reload, interruption, reconnect, logout, and identity switching converge deterministically on authoritative state.
4. Preserve the realtime model: events are household-scoped invalidation signals, not authoritative state. Duplicate, late, and missed events are safe; reconnect and visibility recovery re-read authoritative data.
5. Define a synchronization matrix for each current mutation-producing API operation: authoritative resource changed, emitted invalidation, client reads that become stale, optimistic state involved, duplicate semantics, and missed-event recovery. Operations that intentionally emit no household event must say so. New mutation types must extend this matrix.
6. Define a complete route-policy inventory for every current `/api/v1` HTTP and WebSocket route, including explicitly public and test-only routes. Each route is classified by authentication, origin/CSRF, household scope, capability, self/other restriction, and visibility as applicable. Automated evidence must fail when a registered route is omitted from the inventory.
7. Preserve server-enforced household isolation and personal-task visibility. Hidden UI remains usability behavior, never authorization evidence.
8. Preserve migration meaning, not merely schema success. The supported migration baseline is the representative populated pre-P0-002 fixture plus current-schema idempotent startup. Changing that baseline later requires an explicit Architecture decision; P0-003 does not retain every historical release fixture indefinitely.
9. Preserve client-relied API response shapes, machine-readable error codes, authorization outcomes, mutation idempotency, occurrence identity/snapshots, proposal transitions, and visibility filtering through focused contract assertions. Do not introduce a new API version solely for this slice.
10. Every future escaped defect that violates a protected behavior must add or strengthen a regression test before or alongside its fix. The P0-002 open-view proposal-status defect remains permanently covered.
11. Validation has three distinct tiers:
    - **Developer:** `npm run validate` for routine local feedback.
    - **Pull request:** a repository script runs validation, build, and Chromium e2e in GitHub Actions on pull requests and pushes to `main`.
    - **Release candidate:** a repository script runs validation, build, and the full Chromium/WebKit suite; documented hosted/physical checks apply only when a candidate is actually being released or deployed.
12. CI and tests use fictional, isolated data; require no household secrets, Railway access, or production database; and do not deploy application code.

## Implementation boundary

- Audit existing tests against the protected-behavior catalog; retain useful coverage and add only missing evidence.
- Add a concise, durable contract artifact under `docs/` containing the protected-behavior and synchronization matrices. Keep machine-checkable route-policy data adjacent to the server/tests if that is clearer than duplicating it in prose.
- Add focused domain, integration/API, and browser tests for uncovered contracts, especially stale-response arbitration, missed/duplicate realtime events, outbox identity boundaries, route-policy completeness, and semantic migration preservation.
- Add stable npm scripts for pull-request and release-candidate validation, reusing current commands.
- Add a GitHub Actions workflow using Node.js 24 and the committed lockfile. It must run without repository secrets, use least-privilege permissions, and publish a clear pass/fail check without deploying.
- Update contributor/operator documentation with the escaped-defect rule, exact validation tiers, and the local-first/release-candidate boundary.
- Refactor production code only when a demonstrated testing or enforcement gap cannot be closed safely at the existing boundary; record any such refactor and why it was necessary in the Build Report.

## Do not change

- Do not implement P0-004 or add new responsibility, scheduling, assignment, workflow, notification, identity, or visibility behavior.
- Do not alter accepted P0-001/P0-002 behavior to simplify tests.
- Do not replace optimistic interaction, the durable outbox, authoritative reads, WebSocket invalidation, append-only history, stable IDs, or server authorization.
- Do not add a generalized authorization/rules/event framework, broad API-versioning scheme, hosted test environment, deployment automation, or paid/runtime service.
- Do not pursue coverage percentages, broad snapshot testing, browser duplication without a browser-specific risk, aesthetic refactoring, or unrelated cleanup as goals of this slice.
- Do not place real household data, credentials, tokens, private origins, or production database copies in fixtures, CI, logs, reports, or artifacts.

## Acceptance tests

1. A protected-behavior catalog assigns stable IDs to the required contracts, maps each to concrete automated test names/files and validation tiers, and records any genuinely environment-specific evidence separately. Every automatable P0-003 contract has passing evidence; an unresolved contract gap is not counted as acceptance.
2. A synchronization matrix covers every current mutation-producing API operation and is consistent with emitted resource invalidations, affected client reads, duplicate behavior, and reconnect/reload recovery.
3. An automated completeness check enumerates registered `/api/v1` HTTP/WebSocket routes and fails if any route is absent from the route-policy inventory. Public and test-only exceptions are explicit. Focused tests prove allowed and denied paths for current authentication, origin/CSRF, capability, ownership, visibility, and household-isolation boundaries.
4. Historical/migration tests start from the representative populated pre-P0-002 fixture and prove preservation of stable IDs, definition/occurrence snapshots, checklist status, assignment/execution actors and timestamps, users/memberships, grants, personal layers, proposals/decisions, and mutation receipts. Reapplying current migrations is idempotent.
5. Automated tests prove rapid checklist inputs remain immediately visible while delayed or out-of-order requests cannot overwrite newer intent or authoritative state; duplicate mutation IDs do not apply a logical action twice.
6. Automated tests prove pending outbox work survives reload/interruption and reconnect, resumes only under the originating membership, and cannot execute or leak after logout or identity/household change.
7. Automated tests prove duplicate or missed realtime invalidations are safe, reconnect/visibility recovery converges through authoritative reads, and another household neither receives nor applies the event.
8. The existing escaped-defect test remains green: manager approval changes an already-open proposer Personalize view from Pending to Approved without reload, while Preview/Today remain future-effective.
9. Private and household-visible personal-task tests prove owner, household, and mutation boundaries through direct API calls as well as relevant UI projection.
10. From a clean checkout with Node.js 24 and no application secrets: the developer command passes; the pull-request command passes with validation, build, and Chromium; and the release-candidate command passes with validation, build, Chromium, and WebKit. Test databases and browser artifacts remain isolated from `runtime/dev.sqlite` and source control.
11. GitHub Actions runs the pull-request command for pull requests and pushes to `main`, uses no deployment credentials, and produces an unambiguous check. The Build Report records the workflow run URL/result. Required-check branch protection is a Project Lead repository setting and must be confirmed before claiming that failed CI mechanically blocks merge.
12. Documentation names the escaped-defect rule, validation tiers, supported migration baseline, route/synchronization update obligations, and hosted release-candidate checklist. It does not require hosted testing during the development loop.

## Dependencies

- Technically accepted P0-002 r1 on `main`.
- Node.js 24, committed npm lockfile, and existing Vitest/Playwright/SQLite tooling.
- GitHub Actions is selected because GitHub `origin` and pull requests are the established repository workflow. Enabling the workflow and, if desired, configuring its check as required are Project Lead-controlled repository operations.

## Relevant decisions

- D-002 - Single-process TypeScript web application for the first slice
- D-003 - Versioned definitions and snapshotted occurrences
- D-004 - Server-authoritative state with optimistic durable client intent
- D-006 - Users authenticate; memberships carry household authority
- D-008 - Personal routine changes are effective-dated overlays on stable shared items
- D-011 - Local-first validation with release-candidate hosted evidence

## Known risks / assumptions

- Existing tests may already satisfy many catalog rows. Test count or line coverage is not a success metric; meaningful contract evidence is.
- Chromium is the routine PR browser and WebKit is the release-candidate browser unless measured CI cost/reliability supports running both routinely. Changing this tiering is Architecture discretion and does not change product behavior.
- GitHub branch protection is external configuration. Engineering supplies the workflow and evidence; the Project Lead controls whether its check is mechanically required for merge.
- P0-003 protects current contracts but does not establish product usefulness or approve P0-002 UX feedback.

## Engineering readiness

**Reviewed revision:** 1
**Readiness:** READY

Engineering returns one consolidated readiness review before implementation. A readiness result applies only to this revision.

See `reports/P0-003-r1-engineering-readiness.md` (2026-09-10): READY — no Questions or Blockers. Implementation waits for Architecture response.

## Revision history

- **r1:** Initial contract for protected-behavior traceability, synchronization and route-policy completeness, local-first CI tiers, and release-candidate hosted evidence.
