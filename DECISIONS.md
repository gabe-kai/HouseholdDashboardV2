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

P0-002 is the approved replacement described by D-006 and D-007. D-005 remains descriptive of the merged P0-001 runtime until that replacement is implemented and accepted.

**Alternatives considered:**

- Trusting an actor ID on every client mutation was rejected because it would contaminate the server authorization boundary.
- Implementing custom production credentials in P0-001 was deferred pending Product direction on adult/child login and recovery experience.
- Selecting an external identity service now was deferred because it requires account, deployment, privacy, and operating decisions not needed for the first evidence.

**Related briefs:**

- P0-001

---

## D-006 - Users authenticate; memberships carry household authority

**Status:** Active

**Decision:** A `User` is a sign-in identity independent of any household. A `HouseholdMembership` links a user to a household and owns the household display name, active/pending status, assignment identity, and normalized capability grants. P0-002 resolves the user's sole active membership automatically; it does not implement multi-household switching. Pending enrollment may reserve a membership before a user claims it.

**Reason:** Product requires real identities now and anticipates temporary absence, children leaving home, and possible multi-household membership later. Embedding household and authority directly in a credential record would make those directions unnecessarily destructive. The current P0-001 `members.capabilities_json` representation is sufficient evidence but not a durable authorization model.

**Implications:** Sessions identify users; application commands execute under a currently resolved membership. Household display name, routine assignment, personal routine ownership, and personal-task ownership use membership IDs. Capability grants use the closed P0-002 set and are evaluated server-side on every protected resource. Functional enrollment presets may grant bundles for the evaluation, but age is not an authorization input and no universal permissions editor is introduced. Existing member IDs are preserved as membership IDs during migration so occurrence history and assignments remain connected.

**Alternatives considered:**

- Keeping credentials and `household_id` on `members` was rejected because it couples authentication, household participation, and authority.
- Hard-coded parent/older-child/younger-child authorization was rejected because Product explicitly requires capability-based progressive authority.
- Implementing multi-household selection now was deferred because the next evidence needs one household only.

**Related briefs:**

- P0-002

---

## D-007 - Local passphrases and digest-backed persistent sessions for family evaluation

**Status:** Active

**Decision:** P0-002 uses globally unique login names and passphrases without requiring email. Login names are trimmed, lowercased ASCII identifiers of 3–64 characters matching `[a-z0-9][a-z0-9._-]{2,63}`; household display names remain separate and Unicode-capable. Passphrases are 15–128 Unicode characters, normalized with NFC, screened against a local common-password blocklist, accepted without composition rules, and stored as Argon2id PHC hashes using at least 19 MiB memory, two iterations, and parallelism one. Authentication errors are generic and failed attempts are throttled.

An authenticated browser receives a cryptographically random 256-bit opaque session token. Only its SHA-256 digest is stored server-side. Hosted cookies are host-only, `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`; mutations also require an allowed origin and per-session CSRF header. Sessions expire after seven idle days or 30 absolute days, rotate after authentication or privilege change, and are revoked on logout. A distinctly named non-secure cookie is permitted only in explicit local development/test profiles.

The first manager uses a single-use, short-lived operator bootstrap claim. Managers can create single-use, expiring household enrollment claims for remaining members. Tokens are displayed only when issued and persisted only as digests. Open registration, email delivery, social login, MFA policy, and self-service recovery are deferred.

**Reason:** Six family members, including children, need practical individual identity without assuming email accounts or purchasing an identity service. Persistent sessions reduce repeated passphrase entry on personal phones. The selected controls follow current OWASP and NIST guidance while keeping the boundary understandable inside the existing application.

**Implications:** `@node-rs/argon2` or a readiness-proven equivalent becomes a runtime dependency. Production configuration is fail-closed without a canonical HTTPS origin. CORS remains same-origin; WebSocket handshakes validate origin and session. Raw credentials, enrollment tokens, session tokens, and private task content are excluded from logs. Operator-assisted reset may be documented for evaluation, but no UI may imply unavailable self-service recovery.

**Alternatives considered:**

- An external identity provider was deferred because no account/provider is authorized and child login without email is a primary constraint.
- Email magic links were rejected for P0-002 because they require every member to have accessible email and introduce a delivery service.
- JSON Web Tokens in browser storage were rejected because server-side revocation, current grant evaluation, and `HttpOnly` cookie protection are simpler with opaque sessions.
- Short PIN-only authentication was rejected for an internet-reachable deployment because it does not provide an adequate standalone secret.

**Related briefs:**

- P0-002

---

## D-008 - Personal routine changes are effective-dated overlays on stable shared items

**Status:** Active

**Decision:** Shared Morning Routine items receive stable logical identities across definition revisions. Each membership may have a separately append-only, household-date-effective personal layer containing only personal additions and their order/anchor metadata. Occurrence materialization composes the effective shared revision with the effective personal layer and snapshots the resulting order, text, obligation, assignment, and `shared|personal` provenance. It never clones a full shared definition into a detached member routine or recomposes an existing occurrence.

P0-002 direct personalizers may add and reorder only their own personal additions around inherited shared items. Proposal personalizers may propose one addition; approval creates a future-effective personal-layer revision and retains proposer, decider, proposal time, decision time, and decision. Inherited shared items cannot be edited, reordered, or removed through either child path in P0-002.

**Reason:** Personal control must not isolate a child from future shared-base changes or weaken historical trust. Stable item identity and independent effective dates allow shared and personal evolution to combine without copying content or rewriting the past.

**Implications:** The P0-002 migration adds logical item IDs without altering existing occurrence snapshots. Personal preview and materialization use one deterministic composition function in the framework-independent domain layer. A missing personal anchor falls back to the end of the inherited list in stable personal order. A future removable-item policy can refer to the same stable shared IDs but is intentionally not implemented now.

**Alternatives considered:**

- Cloning the complete base routine per member was rejected because shared changes would stop flowing or require fragile merge logic.
- Mutating the shared routine for one member was rejected because it would affect siblings and corrupt product meaning.
- Applying approved changes immediately to already materialized occurrences was rejected because it violates historical and prospective-change invariants.

**Related briefs:**

- P0-002

---

## D-009 - Secure family evaluation uses one provider-neutral persistent HTTPS host

**Status:** Active

**Decision:** P0-002 retains one Node.js application process and one SQLite database, packaged for a single Linux host/container behind a same-origin HTTPS reverse proxy. The host must forward WebSocket upgrades, mount restricted persistent application/backup storage, restart the process after failure, and provide recoverable off-host or provider snapshots. Local development remains loopback by default. Hosted mode refuses to start when its public origin, secure-session, trusted-proxy, or storage configuration is incomplete.

**Reason:** One household does not justify distributed services or a database migration. Secure real-phone reachability does require TLS, durable storage, and recovery beyond the current trusted-LAN evaluation mode. A provider-neutral package keeps the technical contract stable while leaving account and spending authority with the Project Lead.

**Implications:** The repository gains deployment documentation/artifacts and consistent SQLite backup/restore commands. A pre-migration backup and one restore rehearsal are required before Architecture accepts a deployment containing real household data. The provider, public origin, account, cost, snapshot retention, and credential custody remain TBD until explicitly authorized; this decision does not authorize an external service or purchase.

**Alternatives considered:**

- Continuing trusted-LAN exposure was rejected because it does not satisfy real household identity or secure multi-phone access.
- Splitting the API, realtime service, and database into managed services was rejected as unnecessary complexity for one household.
- Choosing a specific paid provider without Project Lead approval was rejected because technical ownership does not confer spending or account authority.

**Related briefs:**

- P0-002

---

## D-010 - Personal task ownership and visibility are separate facts

**Status:** Active

**Decision:** A P0-002 personal task is a one-off record owned by one household membership and independently marked `private` or `household`. Private tasks are readable only by the active owner membership. Household-visible tasks are readable by active memberships in the same household. Creation and completion authority remain owner-scoped in this slice.

**Reason:** Product requires children to originate work rather than remain only assignees, and future sharing scopes must not be made impossible by treating ownership as visibility.

**Implications:** Personal tasks are not routine occurrences and do not acquire recurrence, due dates, reminders, reassignment, or project structure. Completion records a state/time rather than deleting the task. Cross-household and public visibility are unsupported.

**Alternatives considered:**

- Making every personal task private was rejected because Product explicitly requires household-visible personal work.
- Treating household-visible as household-owned was rejected because visibility should not erase the creator/owner.
- Reusing Morning Routine occurrence rows was rejected because one-off self-created work has different lifecycle and assignment semantics.

**Related briefs:**

- P0-002

---

## D-011 - Local-first validation with release-candidate hosted evidence

**Status:** Active

**Decision:** Normal development and pull-request validation runs locally and through CI against deterministic fixtures. Railway or another provider is reserved for committed release candidates and explicit hosted/physical-device evidence. Hosted success does not replace local regression coverage, and local success does not silently count as hosted evidence.

**Reason:** Hosted infrastructure is needed for HTTPS, persistent storage, proxy/WebSocket, Linux runtime, and physical-device evidence, but requiring it for every iteration creates slow feedback and encourages testing unverified changes in the evaluation deployment.

**Implications:** Briefs define fast pull-request and stronger release-candidate tiers separately. New realtime mutations must document and test invalidation/reconciliation semantics. Hosted checks are release gates, not the normal development loop.

**Related briefs:**

- P0-003
