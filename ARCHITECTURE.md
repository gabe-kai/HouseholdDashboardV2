# Architecture

> This document records the product's current technical shape and the deliberate conventions future briefs may rely on. Distinguish repository truth from proposed architecture.

If this document disagrees with the repository about what exists, the repository wins and this document should be corrected. A brief may still intentionally change current behavior.

`TBD` is allowed. Document what Engineering needs to work safely; do not design the entire future system in advance.

## Technical overview

- **Current repository truth:** The repository contains the AI Development Studio Template documents only. There is no application source, package manifest, installed project dependency, database, migration, test suite, or runnable product as of 2026-09-06.
- **Project type:** Proposed mobile-first, responsive household web application.
- **Languages/runtimes:** Proposed TypeScript throughout, running on the Node.js 24 LTS line; browser-delivered HTML and CSS. The local planning environment currently has Node.js 24.16.0 and npm 12.0.2, but the repository does not yet pin a toolchain.
- **Frameworks/toolchain:** Proposed React client built by Vite, Fastify HTTP/WebSocket server, SQLite persistence, npm, Vitest, and Playwright. Exact compatible package versions become repository truth only when Engineering records them in `package.json` and `package-lock.json`.
- **Delivery model:** One Node.js process serves the built client, versioned JSON API, and household synchronization channel. P0-001 is a local/trusted-network evaluation build, not an internet-ready deployment.
- **Primary interfaces:** Phone-first browser UI; JSON API; WebSocket change stream; local seed/setup command.
- **Persistence/data stores:** Proposed server-owned SQLite database plus browser IndexedDB for a durable pending-mutation outbox. The server database is authoritative.
- **External integrations:** None for P0-001.
- **Deployment/execution environments:** Local development and trusted-LAN evaluation for P0-001. Internet hosting, production identity, TLS termination, and managed persistence are TBD and are not implied by the pilot architecture.

## Working commands

No application commands exist yet. P0-001 establishes the following command contract from the repository root:

- **Install/setup:** `npm ci` after the initial lockfile exists.
- **Run/develop:** `npm run dev`.
- **Build/package:** `npm run build`.
- **Test:** `npm test` for unit/integration tests and `npm run test:e2e` for browser behavior.
- **Lint/typecheck/validate:** `npm run lint`, `npm run typecheck`, and an aggregate `npm run validate`.
- **Seed local evaluation data:** `npm run db:seed` using explicit non-secret evaluation configuration.
- **Preview or production-like run:** `npm run start` after `npm run build`.

Engineering may choose equivalent script internals, but these public repository commands are part of the P0-001 implementation contract. The validated Node version must be pinned in repository configuration and documented during implementation.

## Repository map

The current root contains only studio documentation. P0-001 should introduce a single-package application with these boundaries unless Engineering finds a concrete reason to propose a smaller equivalent structure during readiness review:

```text
src/
  client/       # React UI, optimistic view state, IndexedDB outbox, sync client
  server/       # Fastify composition, HTTP/WebSocket adapters, sessions
  domain/       # Framework-independent recurrence, occurrence, and completion rules
  shared/       # API schemas and cross-boundary value types
db/
  migrations/   # Ordered, tracked SQLite schema migrations
  seeds/        # Non-sensitive evaluation fixtures
tests/
  e2e/          # Multi-context mobile browser behavior
runtime/        # Ignored local database and ephemeral runtime files
briefs/         # One authoritative file per implementation brief
reports/        # Engineering, QA, and acceptance evidence
```

Do not introduce workspaces or independently deployable services for the first slice.

## System context and boundaries

Household members use one or more phone or desktop browsers. The browser communicates only with the household application server; the server owns persistence, validates mutations, resolves household-local dates, and publishes committed-change notifications. SQLite and runtime files are inside the server trust boundary.

The client is untrusted. Actor identity, household membership, authorization, timestamps of record, and completion rules must not be accepted merely because the browser supplied them.

P0-001 uses a conspicuously labeled evaluation identity selector backed by a server session. It is not individual authentication. The pilot must bind to loopback by default and may be exposed only deliberately on a trusted LAN for evaluation. Internet exposure and real family use beyond that context require a later authenticated deployment outcome.

Third-party calendars, notification providers, school systems, cross-household sharing, and external identity providers are outside the current system.

## Major components and data flow

1. **Today client:** Requests the current member's household-local day, presents the active Morning Routine, applies checklist intent immediately, and keeps pending mutations durable in an IndexedDB outbox.
2. **Routine editor and history client:** Lets an evaluation parent define one recurring Morning Routine, create a future-effective revision, and inspect occurrence history.
3. **Application API:** Establishes evaluation sessions, authorizes parent/member capabilities, validates typed payloads, and returns authoritative snapshots.
4. **Routine domain:** Selects the definition revision effective for a household-local date, materializes at most one occurrence per assigned member/date, snapshots expected work, and computes completion from checklist obligation semantics.
5. **Mutation processor:** Applies idempotent set-state commands transactionally, records actor/performed/recorded facts separately, and returns the committed occurrence version.
6. **Synchronization gateway:** Broadcasts small committed-change notifications to connected members of the same household. A notification prompts authoritative reconciliation; it is not itself the source of truth.
7. **Persistence adapter:** Runs tracked migrations and stores household, member, definition revision, occurrence snapshot, execution report, session, and mutation-deduplication records in SQLite.

Primary flow:

```text
Today read -> resolve household date -> materialize idempotently -> return snapshot
Checklist intent -> optimistic UI + durable outbox -> idempotent API command
API commit -> SQLite transaction -> response + household change notification
Other client/reconnect -> fetch authoritative occurrence -> reconcile pending local intent
Routine edit -> append future-effective definition revision -> existing occurrences unchanged
```

## Interfaces and contracts

- **User interfaces:** Phone-first Today, minimal parent routine editor, occurrence history, evaluation profile selector, and visible connection/pending state. Touch targets and status communication must remain usable without color as the sole cue.
- **APIs/events/files:** JSON endpoints live under `/api/v1`. The synchronization endpoint lives under `/api/v1/sync`. Request and response schemas are defined once in `src/shared` and validated at the server boundary.
- **Mutation semantics:** Checklist writes are idempotent `set status` commands, never retry-sensitive toggles. Every client mutation has a globally unique mutation ID. Replaying the same ID returns the original committed result without creating a second execution record.
- **Event semantics:** WebSocket events identify the changed household resource and committed version; clients fetch or accept an authoritative snapshot and reconcile. Reconnect always includes a normal read path, so missed events do not lose state.
- **Error semantics:** API errors use a stable machine-readable code, a safe human message, and a request ID. Validation, authorization, conflict, and unavailable states must be distinguishable without exposing stack traces.
- **CLI or automation interfaces:** Database migration/seed scripts operate only on an explicitly configured local database path. They must not embed personal household data.
- **Integration contracts:** None for P0-001.

## Data, state, and configuration

- **Sources of truth:** SQLite is authoritative for shared household state. Browser state is a projection plus pending user intent. WebSocket messages are notifications, not durable records.
- **Core records:** `Household`, `Member`, `RoutineDefinition`, immutable `RoutineRevision`, ordered revision checklist templates, `Occurrence`, occurrence assignment snapshot, ordered occurrence step snapshots, step execution/status reports, mutation receipts, and sessions.
- **Definition/occurrence boundary:** A definition has a stable identity and append-only revisions with household-local effective dates. An occurrence references the selected revision and snapshots its title, schedule context, accountable member, and checklist semantics. Editing a definition never rewrites an existing occurrence.
- **Checklist meanings:** Template and occurrence steps use the closed P0-001 set `required`, `as_needed`, and `optional`. `required` must be complete; `as_needed` must be complete or explicitly marked not needed; `optional` never blocks occurrence completion.
- **Assignment/execution facts:** The occurrence stores the originally accountable member. A step report stores the acting member, claimed performance instant, server record instant, and resulting state separately. P0-001 exposes only self-execution, but the representation must not collapse these facts.
- **Scheduling:** P0-001 supports selected ISO weekdays for one Morning time anchor. The rule is stored on each routine revision. A household date must never be inferred from the viewer device's timezone.
- **Time:** Every household has one explicit IANA timezone. Calendar dates use `YYYY-MM-DD`; instants cross boundaries as UTC ISO-8601 strings ending in `Z`. Time calculations live behind one domain module and are covered around midnight and daylight-saving transitions.
- **State ownership:** The server assigns occurrence versions and `recordedAt`. The client may supply `performedAt` for queued work, but the server validates shape and retains its independent record time.
- **Persistence/retention:** P0-001 retains all definition revisions, occurrences, and execution reports. Deletion/retention policy and household export are TBD. Chore debt is not generated.
- **Migration/compatibility:** Schema changes use ordered, committed, forward migrations. Seed data is disposable; user-created database migration/backup guarantees remain TBD until deployment is selected.
- **Environment/configuration:** Host, port, database path, evaluation mode, optional LAN access gate, and seed household timezone are environment configuration with documented placeholders. The server binds loopback by default.
- **Secrets/credentials:** Real secrets never enter source control or client bundles. P0-001 has no individual credentials. Any shared LAN evaluation access value remains local and is not represented as production authentication.

## Identity, permissions, privacy, and security

- **Authentication/identity:** P0-001 issues an opaque server session after explicit evaluation-profile selection. This establishes actor context for testing only; it does not authenticate the human. Production authentication remains required before non-local deployment.
- **Authorization/roles:** The pilot has two server-enforced capability sets: `manage_routine` for the evaluation parent and `execute_own_occurrence` for members. These are capabilities, not an age-derived permission matrix. All writes derive actor and household from the server session rather than request payload fields.
- **Sensitive data:** Household membership, children's names, routine content, and execution history are private family data. Committed seeds use fictional names and no real household details.
- **Threat or abuse considerations:** Profile impersonation is deliberately possible in evaluation mode and must be visibly disclosed. LAN exposure is opt-in. Cross-household access, session fixation, injection, XSS, CSRF, and accidental sensitive logging remain relevant even in a local build.
- **Required controls:** Parameterized SQL; schema validation; output escaping through normal React rendering; HttpOnly, SameSite session cookies; capability checks on every write/read scope; request size limits; no sensitive payload logging; and no stack traces in browser responses.

## Reliability and operations

- **Failure handling/recovery:** An already loaded client accepts checklist intent during a transient disconnect, keeps it in IndexedDB, shows pending/offline state without blocking further taps, and retries on reconnect. A failed validation remains visible and actionable rather than being silently discarded.
- **Idempotency/retries:** Client mutation IDs plus server receipts make retries safe. Materialization is protected by a unique occurrence key and transaction so refreshes or concurrent reads cannot duplicate occurrences.
- **Conflict policy:** For the same step, the last command committed by the server is authoritative. Responses/events include the resulting occurrence version. A client overlays its still-pending local commands after applying a server snapshot.
- **Observability:** Structured server logs include request/event IDs, route, result code, and latency without routine text, member names, access values, or session tokens. Client connection/pending state is visible in the UI. Metrics/hosted telemetry are TBD.
- **Backups/rollback:** Evaluation seeds may be recreated. Backup, restore, and production rollback guarantees are TBD and block production hosting, not P0-001 local evaluation.
- **Support/ownership:** Engineering owns implementation evidence; Architecture accepts against the brief; the Project Lead evaluates usefulness.

## Testing and verification strategy

- Unit-test completion semantics, definition-revision selection, household-local date resolution, DST/midnight boundaries, and optimistic reconciliation.
- Integration-test migrations against temporary SQLite databases, idempotent occurrence materialization, mutation replay, capability enforcement, and the invariant that future-effective edits leave current/historical snapshots unchanged.
- Browser-test phone-sized Chromium and WebKit flows with Playwright, including three rapid step actions, delayed responses, a transient disconnect/reconnect, and two independent browser contexts receiving shared updates.
- Validate keyboard operation, accessible names, focus visibility, status text, and non-color state cues for the primary checklist flow.
- Run `npm run validate`, `npm run build`, and `npm run test:e2e` before a Build Report claims completion.
- Perform a focused trusted-LAN manual check on at least one iOS or Android phone when available. If unavailable, report that exact gap; desktop emulation is not evidence of physical-device behavior.

## Performance, scale, and environment constraints

- Primary layouts target narrow phone viewports first and then expand responsively.
- A checklist tap must update the local visible state in the same interaction turn, without waiting for network completion, reload, dialog, spinner, or animation.
- Under ordinary local/trusted-LAN conditions, another connected client should display a committed checklist change within two seconds.
- P0-001 targets one household and ordinary family interaction volume. SQLite and a single Node process are intentional; no horizontal scaling is required.
- Transient offline execution is supported after the app has loaded. Fully offline first load, installability, push notifications, and background sync after the browser is closed are not P0-001 requirements.

## Dependencies, services, assets, and licensing

- **Runtime dependencies:** React, Fastify, SQLite through a current Node-24-compatible `better-sqlite3` release, a WebSocket adapter, runtime schema validation, and a small IndexedDB helper if Engineering determines the native API would add correctness risk.
- **Development dependencies:** Vite, TypeScript, ESLint, Vitest, Playwright, and type packages required by the selected runtime versions.
- **External services/accounts:** None for P0-001.
- **Paid or metered resources:** None.
- **Assets/models/datasets and provenance:** No external assets are required. Use system fonts and simple CSS/HTML UI assets.
- **Licensing/attribution:** Engineering records dependency licenses and must not add an incompatible or unclear license.

## Important conventions

- **Brief naming:** Use flat files under `briefs/` until volume justifies grouping: `P<roadmap milestone>-<three-digit sequence>-<descriptive-kebab-case-outcome>.md`. The stable ID and filename do not change across revisions. Example: `briefs/P0-001-shared-morning-routine.md` with branch `brief/p0-001-shared-morning-routine`.
- **Module boundaries:** Domain rules do not import React, Fastify, SQLite, or browser APIs. Adapters translate at the edges.
- **Identifiers:** Persist opaque UUID identifiers; do not use display names or array positions as identity.
- **Dates and times:** Use explicit household-local dates, IANA timezone IDs, and UTC instants as defined above. Do not use device-local `Date` defaults in domain rules.
- **Schema evolution:** Append definition revisions and migrate storage forward. Do not mutate historical structure in place.
- **Commands:** Prefer desired-state commands (`set completed`) over toggles so retries are idempotent.
- **Authority:** Model capabilities independently from age, household membership, and assignment, even while P0-001 exposes only two fixed capability sets.
- **Truth boundaries:** Shared server state is authoritative; client outbox entries are pending intent; sync events are invalidation/reconciliation hints.

## Known technical debt

- P0-001 evaluation identity does not authenticate a person and cannot be used for internet deployment.
- SQLite backup/restore and production migration guarantees are not yet defined.
- The initial weekly Morning schedule is deliberately narrower than the contextual schedule model Product anticipates.
- P0-001 supports transient disconnection after load, not a fully offline-installable application.

## Proposed future architecture

- Replace evaluation profile selection with authenticated household membership while preserving server-session-derived actor identity.
- Add capability policies and approval requests without encoding age as authority.
- Extend the schedule-rule union and resolver for contextual anchors, exceptions, and contextual additions; do not add global weekday/weekend flags.
- Add additional responsibility types and Today sections through the same versioned-definition and snapshotted-occurrence model.
- Revisit SQLite and single-process hosting only when deployment, backup, or measured concurrency evidence requires it.

## Architecture questions

- Which credential and account-recovery experience should Product approve for adults and children before authenticated household use?
- Which hosting and durable-backup model should support the first non-local deployment?
- Should personal tasks follow the household timezone, viewer timezone, or an item-specific timezone? Product has left this TBD.
- What exact product term should replace the technical `as_needed` state and any future critical/non-skippable classification?
