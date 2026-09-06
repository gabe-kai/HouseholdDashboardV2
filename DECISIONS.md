# Decisions

> Record decisions that future teams should not have to rediscover.

Use IDs like `D-001`, `D-002`, and so on.

For new decisions, copy `templates/DECISION_TEMPLATE.md` into this file and assign the next ID. This file is the durable decision log; the template file is the only template source.

---

## D-001 - Default target

**Status:** Active

**Decision:** The template assumes no particular platform, interface, framework, hosting model, or delivery channel. Architecture records those choices when product intent and repository evidence justify them.

**Reason:** The workflow must support applications, services, automations, data and AI systems, libraries, command-line tools, and games without importing one project type's architecture into every project.

**Implications:** Architecture and Engineering choose the simplest technical shape that satisfies the current outcome and record material conventions for later teams.

**Related briefs:**
- None

---

## D-002 - Single-process TypeScript web application for the first slice

**Status:** Active

**Decision:** P0-001 will establish a single-package TypeScript application with a React/Vite browser client, a Fastify server that serves the API, WebSocket endpoint, and production client assets, and a server-owned SQLite database. The initial supported runtime is the Node.js 24 LTS line. No external runtime service is required for the local evaluation slice.

**Reason:** The repository has no implementation constraints yet. One process and one durable local store provide the shortest understandable path to a phone-capable, multi-client, shared-state result while retaining explicit client/server and domain boundaries.

**Implications:** The first deployment is a single node with persistent local storage. Horizontal scaling, managed identity, and serverless hosting are not assumed. Storage and transport remain behind adapters so evidence can justify a later change without rewriting domain rules.

**Alternatives considered:**

- A client-only prototype was rejected because it cannot produce credible multi-device shared-state or server-recorded history evidence.
- A managed backend was deferred because it would require an external account and deployment decision before the first local evidence exists.
- Multiple deployable services were rejected as unnecessary for one household and one routine.

**Related briefs:**

- P0-001

---

## D-003 - Versioned definitions and snapshotted occurrences

**Status:** Active

**Decision:** A recurring responsibility has a stable definition identity and append-only, household-local effective-dated revisions. Occurrences are materialized idempotently per applicable household date and accountable member, reference the selected revision, and snapshot the expected title, schedule context, assignment, checklist order, and obligation meanings. Definition edits never mutate existing occurrence snapshots. Assignment, acting member, claimed performance time, server record time, and resulting execution state remain distinct facts.

**Reason:** Product requires prospective change without historical rewriting and requires accountability to remain knowable even when execution and credit later diverge.

**Implications:** Historical storage is intentionally denormalized. Schedule generation must select revisions by household-local date and preserve old revisions. Completion updates may change execution state, but structural history does not follow later definition edits. Future cover, helper, and retrospective behavior can extend the execution records without replacing original assignment.

**Alternatives considered:**

- Mutating one reusable routine row was rejected because it rewrites the meaning of history.
- Computing all historical occurrences from only the latest definition was rejected because past expectations would become untrustworthy.
- Treating assignee and completer as one field was rejected because it destroys the distinction Product explicitly requires.

**Related briefs:**

- P0-001

---

## D-004 - Server-authoritative state with optimistic durable client intent

**Status:** Active

**Decision:** Shared SQLite state is authoritative. The client applies checklist intent immediately, records pending desired-state commands in IndexedDB, and retries them with unique mutation IDs. The server applies each mutation ID at most once and broadcasts committed-change notifications over a household-scoped WebSocket. Clients reconcile from authoritative reads after events or reconnects; events are not durable truth.

**Reason:** Checklist execution must keep up with rapid taps and tolerate ordinary transient disconnections, while other household views must feel live and shared.

**Implications:** Commands set a desired state rather than toggle it. Retry and occurrence materialization are idempotent. Pending/offline/error state is visible but non-blocking. The first slice supports transient disconnects after load, not fully offline first load or background execution after the browser closes.

**Alternatives considered:**

- Blocking each tap on an HTTP response was rejected because it violates the responsiveness requirement.
- WebSocket-only state was rejected because missed messages and reconnects would be fragile.
- A CRDT was deferred because server-ordered checklist state with a durable outbox resolves the current concurrency needs more simply.

**Related briefs:**

- P0-001

---

## D-005 - Evaluation identity is a temporary local boundary

**Status:** Active

**Decision:** P0-001 uses a clearly labeled evaluation profile selector that creates an opaque server session; all requests derive actor and household from that session. It does not claim to authenticate the human. The server binds to loopback by default, and trusted-LAN exposure is deliberate and temporary. Individual authentication is required before internet exposure or a non-evaluation household release.

**Reason:** Identity-provider, child credential, invitation, and recovery choices would materially enlarge the first slice and involve Product decisions. A server session still exercises actor-aware domain and authorization boundaries without pretending the evaluation harness is secure authentication.

**Implications:** Profile impersonation is an accepted pilot limitation and must be visible. The API may not accept an arbitrary actor ID as authority. Replacing profile selection with approved login should not alter domain commands or historical records. This decision scopes sequence only; it does not remove Product's authenticated-identity requirement from the initial delivery.

**Alternatives considered:**

- Trusting an actor ID on every client mutation was rejected because it would contaminate the server authorization boundary.
- Implementing custom production credentials in P0-001 was deferred pending Product direction on adult/child login and recovery experience.
- Selecting an external identity service now was deferred because it requires account, deployment, privacy, and operating decisions not needed for the first evidence.

**Related briefs:**

- P0-001
