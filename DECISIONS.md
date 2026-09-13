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

---

## D-012 - Household people are distinct from app access

**Status:** Active

**Decision:** A household person is represented by a household membership independently of whether a user account, credentials, or active session exists. Person creation must not require enrollment. Access status is derived from the membership/user/enrollment facts and must be presented in person-centered language.

**Reason:** A parent needs to organize the household before every person is ready to sign in, especially for younger children. Conflating membership with access makes the household invisible and encourages unsafe enrollment workarounds.

**Implications:** Pending memberships remain first-class directory records. Adult/Child is descriptive classification only; capabilities remain explicit grants. Permanent member removal and account recovery remain separate future workflows.

**Related briefs:**

- P0-004A

---

## D-013 - Groups are named household sets, not authority or assignment engines

**Status:** Active

**Decision:** A group is a named set of current household memberships. Group membership does not grant capabilities, widen personal-task visibility, imply rotation, create assignment rules, or nest/query dynamically. Features consuming groups define their own semantics.

**Reason:** Product needs reusable family structure without prematurely creating a rule engine or permission hierarchy.

**Implications:** Group identity and membership are household-scoped. Removing a person from a group does not remove the person or rewrite history. Group-backed routine audience behavior is a separate contract in P0-004B.

**Related briefs:**

- P0-004A
- P0-004B (planned)

---

## D-014 - Household structure management has its own capability

**Status:** Active

**Decision:** Adding/editing household people and creating/editing/deleting groups requires `household.structure.manage`. Enrollment setup remains governed by `household.member.enroll`. Adult/Child classification does not grant either capability. The existing manager preset receives both; migration backfills the new structure grant only to memberships already holding the enrollment grant.

**Reason:** Reusing an enrollment-named grant for all household structure would couple unrelated authority and make future access delegation unsafe. Deriving authority from Adult/Child would contradict the established capability model.

**Implications:** Structure and access controls can be presented together in a parent workflow while remaining independently enforced by the server. No granular grant editor is introduced in P0-004A.

**Related briefs:**

- P0-004A

---

## D-015 - Enrollment setup has one actionable, one-time-secret lifecycle

**Status:** Active

**Decision:** An unenrolled membership may have at most one actionable enrollment claim. Issuing a replacement revokes the prior actionable claim; cancellation revokes without deleting the person; successful consumption invalidates any remaining actionable claim. Plaintext setup material is returned once at issuance and is never recoverable from status/detail reads.

**Reason:** Person-centered access status must remain understandable after reload without retaining or repeatedly exposing reusable secrets or creating multiple mysterious setup credentials.

**Implications:** Enrollment claims need revocation/status support and transactional replacement. The UI may show safe timestamps and human states, then offer replacement when plaintext is no longer available. This is an operational lifecycle, not a permanent token-history dashboard.

**Related briefs:**

- P0-004A

---

## D-016 - People & Groups uses exclusive progressive-disclosure states

**Status:** Active

**Decision:** At phone width, People & Groups renders one primary in-app state at a time: overview, focused person/group detail, focused add/edit/access form, or household activity. Detail is read-first; editing is explicit. Each nested state supplies an accessible in-app Back action and moves focus/scroll to its heading. P0-004A does not add a routing dependency or promise URL/deep-link state.

**Reason:** The r2 composite page made successful row selections appear ineffective and forced users to search below the viewport for forms. The smallest correction is clearer state and hierarchy, not a broad navigation or design-system rewrite.

**Implications:** Household Morning Routine progress and household-visible personal tasks move into a focused Household activity state reachable from the directory but retain their existing authorization, privacy, and synchronization. Wider-screen master/detail remains optional later.

**Related briefs:**

- P0-004A r3

---

## D-017 - Demo fixtures are opt-in and cleanup is provenance-safe

**Status:** Active

**Decision:** Normal development and bootstrap do not create fictional household members. Demo/test seeding is explicit and uses one canonical manifest of stable fixture IDs. Existing contamination is remediated only by an operator-invoked, backup-first command that matches manifest identity and removes a membership only after exhaustive durable-reference checks; names never establish provenance.

**Reason:** Default auto-seeding made fictional people appear to be real household members. Generic deletion or name-based cleanup would threaten authentication and historical responsibility records.

**Implications:** Development defaults `AUTO_SEED` off; tests/demo commands opt in. Empty bootstrap creates the minimum household/claim needed for one manager. Cleanup defaults to dry run, is transactionally rechecked on apply, reports blocked relationship categories without private content, and is not a general member-departure feature.

**Related briefs:**

- P0-004A r3

---

## D-018 - Routine revisions preserve source intent and resolve dated group membership

**Status:** Active

**Decision:** A Morning Routine revision stores directly selected household memberships and selected stable group identities as separate source sets. For a target household date, the responsibility resolver unions direct memberships with each selected group's dated member set and deduplicates by stable membership ID. Group member-set changes are versioned and become effective on the next household day; group creation establishes an initial set usable on its creation date, and rename is immediate presentation behavior.

A deliberate Routine save removes a direct source that is redundant through a selected group on that Routine revision's effective date. A later group edit does not mutate an immutable Routine revision or silently erase prior direct intent; derived resolution still gives the person only one occurrence. Groups remain structural and confer no capability or assignment strategy beyond the consuming Routine's every-member behavior.

**Reason:** Flattening a group into copied people would make the parent maintain participation in two places and would lose the explanation for future changes. Mutating Routine sources as a side effect of later group edits would be equally surprising, particularly if a directly selected person later leaves the group. Dated source resolution preserves both understandable configuration and prospective responsibility.

**Implications:** Existing `revision_assignees` migrate as direct sources with no selected groups. A selected empty group is valid. Dated membership history and group tombstones must survive long enough to interpret immutable revisions. A group cannot be deleted while an operative-today or scheduled-future Routine interval selects it; after references become historical, it disappears from current structure while retained identity prevents historical damage. Current group names remain unique independently of tombstoned historical identities.

**Alternatives considered:**

- Flattening selected groups into individual revision assignees was rejected because later group membership would not flow and the parent's chosen structure would be lost.
- Treating groups as dynamic queries, roles, permissions, rotations, or eligibility engines was rejected as outside the proven need and contrary to D-013.
- Silently removing an old direct source whenever a later group edit creates overlap was rejected because an unrelated structure edit should not erase explicit Routine intent.

**Related briefs:**

- P0-004B

---

## D-019 - Future occurrence participation is provisional but snapshots are durable

**Status:** Active

**Decision:** The occurrence date is the commitment boundary for group-backed participation. Current-day and past occurrence participation and every materialized checklist/report fact remain fixed. Before a future household date begins, dated group membership may change whether an already-materialized occurrence is returned and actionable. Reconciliation may create a missing future occurrence or exclude a stale one, but it never rewrites or deletes an existing occurrence, step snapshot, execution report, or receipt, and it never recomposes the content of a surviving occurrence.

Checklist execution is rejected for a future household date and for a cached occurrence whose accountable member no longer resolves through that occurrence's stored Routine revision and dated sources. Delayed or offline reports for valid current/past occurrences remain supported.

**Reason:** Product requires group edits to affect the next household day even when implementation has materialized that date early, while the existing architecture treats occurrence snapshots and execution evidence as durable facts. Making future participation provisional but snapshot content durable satisfies both requirements without allowing an internal cache timing detail to change user behavior.

**Implications:** Authoritative reads cannot equate every persisted future occurrence row with active work. Status authorization must revalidate date and participation rather than trusting possession of an occurrence ID. Retained excluded rows are internal evidence and do not appear as actionable work. The exception is narrowly about group-derived future participation; shared/personal checklist revision semantics remain governed by D-003 and D-008.

**Alternatives considered:**

- Freezing every future assignment at first materialization was rejected because it would make group behavior depend on an invisible read/cache event.
- Deleting and rebuilding future occurrence graphs was rejected because existing deployments may contain durable rows or reports and because deletion weakens the historical model.
- Rewriting surviving future occurrence steps from the latest Routine revision was rejected because P0-004B changes participation, not the established snapshot-content boundary.

**Related briefs:**

- P0-004B

---

## D-020 - Routine identity scopes configuration, personal layers, and commands

**Status:** Active

**Decision:** P0-005 generalizes the existing definition model to multiple routines per household. A stable definition ID, independent of title or daypart, scopes shared revisions, participant resolution, personal layers, proposals, previews, mutation targets, and history. Keep the existing occurrence uniqueness by definition/date/accountable membership; scope personal revision uniqueness and selection by membership/definition/date. Proposals acquire their definition identity when created, and approval uses that stored identity. Administrative replay binds the target definition as well as household, command kind, and payload; state and receipt commit atomically.

**Reason:** The existing database already represents routine identity in revisions and occurrences, but singleton lookups, personal date uniqueness, implicit proposal association, and target-free receipt digests would make multiple routines interfere. Three special routine types or independent copies of the application would preserve the underlying problem.

**Implications:** Forward migrations preserve the existing Morning definition and all valid IDs/relationships, snapshots, personal content, execution facts, and receipts. Deterministically associate legacy proposals with the sole pre-upgrade definition and cross-check decided layers; retain unresolved legacy records read-only rather than guessing or deleting. Extend the named supported migration baseline with populated authenticated P0-004B data while retaining P0-001 migration coverage. Normal API/client flows carry explicit routine IDs. Existing authority, personal-overlay restrictions, and D-018 group-source semantics apply per routine. Shared/personal edits remain append-only and future-effective; date selection and conflicts are scoped to the affected definition or personal membership/definition pair and shown to the user.

**Alternatives considered:**

- Three hard-coded Morning/After School/Bedtime types would not support household-defined names without repeated special cases.
- Cloning a singleton service or personal layer for each routine would encourage content, history, and permission divergence.
- A backend-only enabling brief would not prove that the household can create and execute multiple routines; one vertical brief uses internal implementation checkpoints instead.

**Related briefs:**

- P0-005 r1 (planned implementation)

---

## D-021 - Routines use weekday recurrence and snapshotted dayparts

**Status:** Active

**Decision:** Each P0-005 shared routine revision contains a nonempty ISO-weekday set and a separate daypart. The initial ordered daypart vocabulary is Morning, After school, Evening, Bedtime, Anytime. Schedule presets are conveniences over weekdays, not different recurrence models. Materialization snapshots the selected daypart on each occurrence; Today orders those snapshots deterministically. Routine names/types are not derived from dayparts. Dayparts neither require exact times nor prevent execution of applicable work earlier in the day.

**Reason:** Families need meaningful day structure without fake clock times or an early calendar/rule engine. A generic Routine supports any household-defined name while a small daypart vocabulary provides sufficient ordering for the interim Today experience.

**Implications:** Existing Morning revisions/occurrences retain Morning. New routines may visibly default to Every day / Anytime. Later edits do not relabel old snapshots. A current/upcoming summary resolves both the definition revision and group membership for the displayed household date. Exact times, contextual calendars, and the full next/later hierarchy remain deferred in `PRODUCT.md`.

**Alternatives considered:**

- Exact-time scheduling would require product decisions that these routines do not need.
- A special routine kind per daypart would couple identity to schedule and make ordinary new routine names unnecessarily difficult.
- Deriving historical daypart from current configuration would rewrite history when the parent changes a schedule.

**Related briefs:**

- P0-005 r1 (planned implementation)

---

## D-022 - Routine archival stops participation prospectively and retains history

**Status:** Active

**Decision:** Archiving a routine removes it from the active configuration list immediately and records an exclusive participation cutoff at the next household date. Today remains available; on/after the cutoff no occurrence is assigned or executable, including retained rows materialized before archival. Before-cutoff history and valid delayed reports remain supported. Archive requires the existing shared-management capability, conflict protection, explicit user confirmation, and replay-safe state change. The definition remains inspectable in a secondary archived view; physical deletion and restoration are outside P0-005 r1.

**Reason:** Product needs to stop using a routine without destroying household history. A household-date cutoff preserves the prospective convention and avoids a current-day checklist disappearing partway through use. Filtering only at creation would leave pre-materialized future work active and would not satisfy archive behavior.

**Implications:** Lifecycle applies to date reads, materialization, preview applicability, cached-ID status authorization, and group reference intervals. An archived routine's current-day group reference survives until cutoff; another active routine's reference still blocks deletion. Archived future configuration and new personal changes/proposals cannot be written, and pending proposals cannot be approved into the archived routine. Preserve their audit and allow rejection; already committed decision replays remain idempotent. Restore is deferred because group tombstones and skipped dates require an additional lifecycle contract, not merely clearing an archive flag. This is an explicit extension of D-019's future-participation exclusion, not permission to rewrite snapshots.

**Alternatives considered:**

- Destructive deletion would lose responsibility history.
- Immediate removal from today's execution would violate the prospective day boundary.
- A current archive flag checked only during creation would fail for retained future occurrences and delayed commands.

**Related briefs:**

- P0-005 r1 (planned implementation)
