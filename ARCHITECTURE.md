# Architecture

> This document records the product's current technical shape and the deliberate conventions future briefs may rely on. Distinguish repository truth from proposed architecture.

If this document disagrees with the repository about what exists, the repository wins and this document should be corrected. A brief may still intentionally change current behavior.

`TBD` is allowed. Document what Engineering needs to work safely; do not design the entire future system in advance.

## Technical overview

- **Current repository truth:** The application is a single-package TypeScript React/Vite + Fastify + SQLite system with authenticated memberships, capability grants (including `household.structure.manage`), People & Groups / access-status APIs, named structural groups, append-only shared/personal routine revisions, scoped personal tasks, ordered migrations through `003_people_groups_access.sql`, P0-003 validation tiers, and Playwright Chromium/WebKit coverage. The supported runtime is Node.js 24; exact package versions are locked in `package-lock.json`.
- **Project type:** Mobile-first, responsive household web application with local/LAN development and a provider-neutral secure single-host release target.
- **Languages/runtimes:** TypeScript throughout on the Node.js 24 LTS line (`engines.node`: `>=24 <25`, `.nvmrc` pins `24`); browser-delivered HTML and CSS.
- **Frameworks/toolchain:** React + Vite client; Fastify server with `@fastify/websocket`, `@fastify/cookie`, `@fastify/static`; Zod boundary validation; Vitest unit/integration; Playwright Chromium + WebKit e2e. Exact versions are in `package.json` / `package-lock.json`.
- **Delivery model:** One Node.js application process serves the built client, versioned JSON API, and household synchronization channel behind an HTTPS reverse proxy on a persistent host. There are no independently deployable application services.
- **Primary interfaces:** Phone-first browser UI; JSON API; WebSocket change stream; local seed/setup command.
- **Persistence/data stores:** Server-owned SQLite database plus browser IndexedDB (`idb-keyval`) for a durable pending-mutation outbox. The server database is authoritative.
- **External integrations:** None in the application runtime. Hosting supplies TLS termination, persistent disk, process restart, and backup/snapshot capability; the application contract remains provider-neutral.
- **Deployment/execution environments:** Local development is loopback by default, with an explicit trusted-LAN mode for physical-phone testing. The hosted shape is one Node.js 24 instance plus one SQLite volume behind a same-origin HTTPS endpoint with WebSocket forwarding; it was exercised on a Project Lead-authorized Railway deployment without making Railway an architectural dependency.

## Authenticated household architecture

### P0-004 people and groups direction

- The repository's existing `household_memberships` row is the durable household-person boundary: `user_id` may be null while a person is pending access. New person creation should extend this boundary rather than creating credentials as a prerequisite.
- Adult/Child is a descriptive household classification, not an authority source. Capabilities remain explicit membership grants and groups never grant authority.
- Groups are household-scoped named sets of membership IDs. They are structural data only; personal-task privacy, permissions, rotation, and assignment semantics remain independent.
- P0-004A is limited to People, Groups, and person-centered access status. P0-004B will separately define group-backed Morning Routine audience resolution, overlap deduplication, prospective membership effects, and materialized-occurrence boundaries.
- Household structure mutation uses a distinct `household.structure.manage` grant; `household.member.enroll` remains the access-setup grant. The manager preset carries both, while Adult/Child remains descriptive only.
- Existing memberships migrate with classification unset because the repository has no trustworthy classification fact. New people require Adult/Child, and managers may correct the migrated `Classification not set` state without changing authority.
- Enrollment status is a safe projection over user and claim facts. One actionable claim per membership is permitted; replacement/cancellation revoke it, plaintext is shown once, and later reads never expose claim secrets.
- Administrative create operations are server-authoritative and replay-safe by client mutation ID. Group member-set updates are transactional and version-guarded; they are not placed in the checklist IndexedDB outbox.
- P0-004A r3 uses exclusive in-app overview/detail/edit/access/activity states with explicit Back and focus restoration on phone. It does not add a router or deep-link contract. Household progress and household-visible tasks live in the focused Household activity state rather than the directory overview.
- Normal development/bootstrap is fixture-free. Deterministic demo/test seeding is explicit and derives from one canonical stable-ID manifest. Existing demo contamination may be removed only by a dry-run-first, backup-first operator command that matches manifest IDs and proves the absence of every durable relationship; display names are never provenance.

P0-002 deepened the Morning Routine without generalizing the product. One household can use distinct accounts across two personal-authority paths while P0-001 execution and history remain intact.

- **Identity boundary:** `User` represents a sign-in identity independently of a household. `HouseholdMembership` links a user to one household and owns the household display name, status, and normalized capability grants. Pending enrollment may exist before a user claims a membership. P0-002 signs a user directly into their sole active membership; multi-household switching remains unimplemented.
- **Credential boundary:** Use local login-name/passphrase credentials because children need accounts without email and no external identity account has been authorized. Store Argon2id PHC hashes using a maintained Node-24-compatible library; never store or log passphrases. A manager creates a one-time, expiring enrollment token whose digest—not plaintext—is stored. A one-time operator bootstrap claim establishes the first manager without enabling open registration.
- **Session boundary:** The browser receives a 256-bit opaque token in a host-only `Secure`, `HttpOnly`, `SameSite=Strict` cookie in the hosted environment. SQLite stores only a SHA-256 token digest, user reference, timestamps, and revocation state. Enforce a seven-day idle timeout and 30-day absolute timeout server-side, rotate on authentication/privilege change, revoke on logout, and require a per-session CSRF header plus allowed-origin validation for mutations. Local HTTP development uses a distinctly named non-secure cookie and startup warning; production must fail closed when its HTTPS/public-origin configuration is absent.
- **Authority boundary:** Capabilities are independent grants on membership: `household.member.enroll`, `household.structure.manage`, `routine.shared.manage`, `routine.personalize.direct`, `routine.personalize.propose`, `routine.proposal.decide`, `routine.execute.own`, and `personal_task.create`. The UI may offer functional grant presets (manager, direct personalizer, proposal personalizer), but age/classification is not stored as policy and no universal permission editor is introduced. Every active household membership may read household people/group structure, Morning Routine status, and household-visible personal tasks; private personal tasks remain owner-only. Structure mutations require `household.structure.manage`; access setup requires `household.member.enroll`.
- **Routine composition:** Shared routine revisions remain append-only. Shared checklist items gain stable logical IDs across revisions. A member's personal routine layer is separately append-only and household-date-effective; it references stable shared items and snapshots only personal additions/order metadata. Materialization composes the shared revision and that membership's effective personal layer, then snapshots the complete result and provenance into the occurrence. The layer does not clone shared item content.
- **Personal authority in this slice:** Direct personalizers may add and reorder their own personal additions around inherited shared items. Proposal personalizers may request one addition; a manager may approve or reject it. Approval transactionally creates the future-effective personal change and retains proposer, decider, proposal/decision times, and decision state. Inherited shared items cannot be edited, reordered, or removed by either child path in P0-002; a future removable-item policy remains compatible with stable item IDs but is not implemented.
- **Personal work:** A personal task is a separate, owner-scoped one-off record with title, `private|household` visibility, open/completed state, and creation/completion timestamps. It has no recurrence, due date, reminder, checklist, or project model in P0-002. Visibility and ownership are separate fields and are enforced on every server read.
- **Evaluation path:** Prospective edits report their household effective date and lead to a read-only preview of the next applicable composed Morning Routine. This supplies evidence without generalized date editing or materializing executable future occurrences.
- **Deployment boundary:** Package the existing application for a provider-neutral single Linux host/container with a mounted SQLite/backup directory. The host must supply HTTPS, WebSocket upgrade forwarding, restricted persistent storage, restart behavior, and recoverable off-host/provider snapshots. No paid service, account, domain, or provider is selected or authorized by this decision.

Security parameters follow current primary guidance: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), and [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html). P0-002 passphrases are 15–128 Unicode characters, normalized with NFC, checked against a locally available common-password blocklist, accepted without composition rules, and compatible with paste/autofill. Authentication errors are generic and failed login attempts are throttled without permanent lockout.

## Working commands

From the repository root, with Node.js 24:

- **Install/setup:** `npm ci` (requires the committed lockfile).
- **Local configuration:** copy `.env.example` values into the environment as needed (`DB_PATH`, `BACKUP_DIR`, `HOUSEHOLD_TIMEZONE`, `HOST`, `PORT`, `APP_PROFILE`, `PUBLIC_ORIGIN`, `AUTO_SEED`, `EVAL_LAN_ACCESS`).
- **Migrate/seed:** `npm run db:migrate` then `npm run db:seed` (seed creates pending fictional memberships only; hosted profile forbids `AUTO_SEED`).
- **Bootstrap:** `npm run auth:bootstrap` issues one single-use manager claim token (shown once).
- **Backup/restore:** `npm run db:backup`; `npm run db:restore -- path/to/backup.sqlite`. Run backup before applying migrations on populated data.
- **Run/develop:** `npm run dev` (API on `127.0.0.1:8787`, Vite on `127.0.0.1:5173` with `/api/v1` proxy). Login/claim Origin must match the Vite URL (`http://127.0.0.1:5173` by default).
- **Phone on LAN:** `npm run dev:lan` (binds Vite/API for LAN; prints `http://<lan-ip>:5173`). With `EVAL_LAN_ACCESS=1`, claim/login also accept other private/loopback HTTP Origins so a mismatched NIC IP does not block the phone. Not for public internet exposure.
- **Build/package:** `npm run build`.
- **Test:** `npm test` for unit/integration tests. `npm run test:e2e` installs Playwright Chromium + WebKit for the locked `@playwright/test` version (browser binaries are not shipped by `npm ci`) and then runs the suite against isolated Chromium/WebKit servers. Chromium-only: `npm run test:e2e:chromium`.
- **Lint/typecheck/validate:** `npm run lint`, `npm run typecheck`, and aggregate `npm run validate`.
- **Pull-request validation:** `npm run validate:pr` (validate + build + Chromium e2e).
- **Release-candidate validation:** `npm run validate:rc` (validate + build + Chromium + WebKit e2e).
- **Preview or production-like run:** `npm run start` after `npm run build` (serves `dist/client` from the Fastify process). Hosted packaging notes: `docs/ops-deploy.md`.
- **Protected contracts:** `docs/protected-behaviors.md` (catalog, sync matrix, escaped-defect rule). Route policy: `src/server/route-policy.ts`.

Playwright note: if browser launch fails instantly or the suite hangs after marking tests failed, run `npx playwright install chromium webkit` once (or use `npm run test:e2e`, which does this automatically) so binaries match the lockfile’s Playwright revision.

Local development uses `APP_PROFILE=development` with authentication enabled and pending seeded memberships that must still be claimed. Hosted mode (`APP_PROFILE=hosted`) requires `PUBLIC_ORIGIN=https://…`, persistent `DB_PATH`/`BACKUP_DIR`, and rejects evaluation bypass flags.

## Validation and release convention

- Normal development and pull-request validation is local-first and does not require Railway or another hosted environment.
- **Developer:** `npm run validate`.
- **Pull request:** `npm run validate:pr` (also the GitHub Actions workflow `.github/workflows/validate-pr.yml` on PRs and `main`). Chromium only.
- **Release candidate:** `npm run validate:rc` includes WebKit. Physical phones, hosted HTTPS, restart, backup/restore, and target-platform checks remain separate hosted evidence when a candidate is actually released or deployed.
- Hosted evidence applies to the exact committed release candidate and deployed artifact. It does not replace local regression coverage.
- Making the Actions check required for merge is a Project Lead repository setting.
- New synchronization-sensitive mutations must update `docs/protected-behaviors.md` and `src/server/route-policy.ts`, and must test invalidation/reconciliation semantics. Events remain invalidation signals; server reads remain authoritative.
- Escaped defects that violate a protected behavior must add or strengthen a regression test before or alongside the fix.

## Repository map

The merged repository uses this single-package layout:

```text
src/
  client/       # React UI, optimistic view state, IndexedDB outbox, sync client
  server/       # Fastify composition, HTTP/WebSocket adapters, sessions, migrations/seeds
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

P0-002 should add cohesive server modules for authentication/membership, authorization, personalization/proposals, and personal tasks within these boundaries. Do not introduce workspaces or independently deployable application services.

## System context and boundaries

Household members use one or more phone or desktop browsers. The browser communicates only with the household application server; the server owns persistence, validates mutations, resolves household-local dates, and publishes committed-change notifications. SQLite and runtime files are inside the server trust boundary.

The client is untrusted. Actor identity, household membership, authorization, timestamps of record, and completion rules must not be accepted merely because the browser supplied them.

P0-001’s evaluation identity selector is retired for normal use. P0-002 authenticates a `User`, resolves the active `HouseholdMembership` and grants server-side, and scopes all resource access from that context. Local development still binds to loopback by default; hosted mode requires an HTTPS public origin and forbids evaluation bypasses.

Third-party calendars, notification providers, school systems, cross-household sharing, and external identity providers are outside the current system.

## Major components and data flow

1. **Today client:** Requests the current member's household-local day, presents the active Morning Routine, applies checklist intent immediately, and keeps pending mutations durable in an IndexedDB outbox.
2. **Routine editor and history client:** Lets an evaluation parent define one recurring Morning Routine, create a future-effective revision, and inspect occurrence history.
3. **Application API:** Establishes evaluation sessions, authorizes parent/member capabilities, validates typed payloads, and returns authoritative snapshots.
4. **Routine domain:** Selects the definition revision effective for a household-local date, materializes at most one occurrence per assigned member/date, snapshots expected work, and computes completion from checklist obligation semantics.
5. **Mutation processor:** Applies idempotent set-state commands transactionally, records actor/performed/recorded facts separately, and returns the committed occurrence version.
6. **Synchronization gateway:** Broadcasts small committed-change notifications to connected members of the same household. A notification prompts authoritative reconciliation; it is not itself the source of truth.
7. **Persistence adapter:** Runs tracked migrations and stores household, member, definition revision, occurrence snapshot, execution report, session, and mutation-deduplication records in SQLite.
8. **Authentication and membership service:** Claims one-time bootstrap/enrollment tokens, verifies passphrases, creates/revokes hashed sessions, resolves the sole active membership, and evaluates current grants. It is the only normal entry to authenticated actor context.
9. **Personal routine service:** Appends effective-dated personal layers, validates direct authority, records proposals and decisions, and composes shared plus personal definitions for preview/materialization without mutating existing occurrences.
10. **Personal task service:** Owns one-off task lifecycle and filters reads by owner, household, and visibility.
11. **Hosted edge:** Terminates TLS, redirects HTTP to HTTPS, forwards same-origin HTTP/WebSocket traffic, and mounts durable application/backup storage. It does not make authorization decisions.

Primary flow:

```text
Today read -> resolve household date -> materialize idempotently -> return snapshot
Checklist intent -> optimistic UI + durable outbox -> idempotent API command
API commit -> SQLite transaction -> response + household change notification
Other client/reconnect -> fetch authoritative occurrence -> reconcile pending local intent
Routine edit -> append future-effective definition revision -> existing occurrences unchanged
Authenticated request -> verify hashed session -> resolve active membership/grants -> authorize resource scope
Personal change -> append future-effective member layer directly or after approval -> preview composition
Occurrence materialization -> select shared revision + member layer -> snapshot composed steps/provenance
```

## Interfaces and contracts

- **User interfaces:** The current app provides sign-in/sign-out, phone-first Today, household status, narrow enrollment, a shared routine editor, occurrence history, personal routine settings/preview, personal tasks, pending approvals, and visible connection/pending state. Touch targets and status communication must remain usable without color as the sole cue.
- **APIs/events/files:** JSON endpoints live under `/api/v1`. The synchronization endpoint lives under `/api/v1/sync`. Request and response schemas are defined once in `src/shared` and validated at the server boundary.
- **Mutation semantics:** Checklist writes are idempotent `set status` commands, never retry-sensitive toggles. Every client mutation has a globally unique mutation ID. Replaying the same ID returns the original committed result without creating a second execution record.
- **Event semantics:** WebSocket events identify the changed household resource and committed version; clients fetch or accept an authoritative snapshot and reconcile. Reconnect always includes a normal read path, so missed events do not lose state.
- **Error semantics:** API errors use a stable machine-readable code, a safe human message, and a request ID. Validation, authorization, conflict, and unavailable states must be distinguishable without exposing stack traces.
- **CLI or automation interfaces:** Database migration/seed scripts operate only on an explicitly configured local database path. They must not embed personal household data.
- **Authentication/CSRF contracts:** Normal API and WebSocket access use only the server session cookie. State-changing HTTP requests also require a per-session CSRF value in a custom header and an allowed `Origin`; WebSocket handshakes require an allowed origin. CORS is not opened to arbitrary origins. Login/claim endpoints validate their own origin and never accept a caller-selected actor or household as authority.
- **Authorization contracts:** Resource services receive an authenticated membership context and perform capability, ownership, household, proposal-state, and visibility checks before reading or mutating. UI visibility is only a usability projection of the same server policy.
- **Integration contracts:** No application-level third-party integration is required. The hosted runtime depends only on the documented TLS/persistence/backup host contract.

## Data, state, and configuration

- **Sources of truth:** SQLite is authoritative for shared household state. Browser state is a projection plus pending user intent. WebSocket messages are notifications, not durable records.
- **Current core records:** `Household`, `Member`, `RoutineDefinition`, immutable `RoutineRevision`, ordered revision checklist templates, `Occurrence`, occurrence assignment snapshot, ordered occurrence step snapshots, step execution/status reports, mutation receipts, and evaluation sessions.
- **Authenticated/personal records:** `User`, password credential, `HouseholdMembership`, membership capability grant, one-time bootstrap/enrollment claim, hashed authenticated session, stable shared routine item identity, immutable personal routine revision/addition/order records, routine change proposal/decision audit, composed occurrence-step provenance, and personal task.
- **Definition/occurrence boundary:** A definition has a stable identity and append-only revisions with household-local effective dates. An occurrence references the selected revision and snapshots its title, schedule context, accountable member, and checklist semantics. Editing a definition never rewrites an existing occurrence.
- **Shared/personal composition:** Each shared checklist item has a stable logical ID preserved when that item survives a revision. A personal layer contains only member-owned additions and their anchor/order metadata. For a household date, composition selects the effective shared revision and effective layer for the accountable membership, validates referenced items, inserts personal additions deterministically, and snapshots the full ordered result plus `shared|personal` provenance. A missing/retired anchor falls back to the end of the inherited list in stable personal order. Existing occurrences are never recomposed.
- **Checklist meanings:** Template and occurrence steps use the closed P0-001 set `required`, `as_needed`, and `optional`. `required` must be complete; `as_needed` must be complete or explicitly marked not needed; `optional` never blocks occurrence completion.
- **Assignment/execution facts:** The occurrence stores the originally accountable member. A step report stores the acting member, claimed performance instant, server record instant, and resulting state separately. P0-001 exposes only self-execution, but the representation must not collapse these facts.
- **Scheduling:** P0-001 supports selected ISO weekdays for one Morning time anchor. The rule is stored on each routine revision. A household date must never be inferred from the viewer device's timezone.
- **Time:** Every household has one explicit IANA timezone. Calendar dates use `YYYY-MM-DD`; instants cross boundaries as UTC ISO-8601 strings ending in `Z`. Time calculations live behind one domain module and are covered around midnight and daylight-saving transitions.
- **State ownership:** The server assigns occurrence versions and `recordedAt`. The client may supply `performedAt` for queued work, but the server validates shape and retains its independent record time.
- **Persistence/retention:** P0-001 retains all definition revisions, occurrences, and execution reports. Deletion/retention policy and household export are TBD. Chore debt is not generated.
- **Personal task retention:** Completing a personal task records state/timestamps rather than deleting it. Private tasks are queryable only by their owner; household-visible tasks are queryable only by active members of that household. Household departure/export/deletion behavior remains TBD.
- **Migration/compatibility:** Schema changes use ordered, committed, forward migrations. The P0-001-to-P0-002 migration preserves member IDs as membership IDs, routine revisions, occurrences, step reports, and mutation receipts; revokes evaluation sessions; and leaves unclaimed members pending without inferring authority from names or age. Production startup never inserts evaluation identities automatically.
- **Environment/configuration:** Host, port, database/backup paths, timezone, runtime profile, canonical public origin, LAN gate, seeding, and trusted-proxy configuration are documented in `.env.example` and operator documentation. The server binds loopback by default outside an explicitly configured LAN/container profile and fails closed on incomplete hosted security configuration.
- **Secrets/credentials:** Real secrets never enter source control, client bundles, URLs, logs, reports, or committed fixtures. One-time bootstrap/enrollment values are shown only at creation, stored only as digests, expire, and are single-use. Password hashes and hashed session tokens remain server-side. `.env.example` contains placeholders only.

## Identity, permissions, privacy, and security

- **Authentication/identity:** Normal use requires login-name/passphrase authentication, claimed household enrollment, and persistent revocable sessions. The former evaluation identity selector is unavailable in hosted mode. Open self-registration, email delivery, social identity, MFA policy, and self-service recovery are not included.
- **Authorization/roles:** Normal authority uses normalized membership grants named above. Functional enrollment presets are grant bundles, not persisted age-derived roles. Services derive current user, membership, household, and grants from the session on each request so revoked membership or changed authority takes effect without trusting stale client claims.
- **Sensitive data:** Household membership, children's names, routine content, and execution history are private family data. Committed seeds use fictional names and no real household details.
- **Threat or abuse considerations:** Current controls address credential guessing/enumeration, stolen or fixed sessions, CSRF, cross-household IDOR, stale grants, WebSocket origin/scope errors, shared-device data leakage, injection, XSS, and sensitive logging. They do not claim enterprise identity assurance or protection from a fully compromised family device.
- **Required controls:** Parameterized SQL; boundary schema validation; normal React output escaping; Argon2id credential hashing; generic and throttled login failures; cryptographically random one-time/session tokens stored only as digests; server-enforced idle/absolute expiry and revocation; production `Secure`/`HttpOnly`/`SameSite=Strict` host-only cookie; CSRF token and origin validation; WebSocket origin and household checks; capability/ownership/visibility checks on every resource; request size limits; security headers; no sensitive payload logging; and no stack traces in browser responses.
- **Shared-device client state:** Cached authenticated data and live subscriptions are cleared when identity changes. Pending outbox commands are namespaced by membership and are never replayed as another signed-in user. Explicit logout must warn about/discard that membership's still-pending commands; an expired session may retain them only for replay after the same user reauthenticates.

## Reliability and operations

- **Failure handling/recovery:** An already loaded client accepts checklist intent during a transient disconnect, keeps it in IndexedDB, shows pending/offline state without blocking further taps, and retries on reconnect. A failed validation remains visible and actionable rather than being silently discarded.
- **Idempotency/retries:** Client mutation IDs plus server receipts make retries safe. Materialization is protected by a unique occurrence key and transaction so refreshes or concurrent reads cannot duplicate occurrences.
- **Conflict policy:** For the same step, the last command committed by the server is authoritative. Responses/events include the resulting occurrence version. A client overlays its still-pending local commands after applying a server snapshot.
- **Observability:** Structured server logs include request/event IDs, route, result code, and latency without routine text, member names, access values, or session tokens. Client connection/pending state is visible in the UI. Metrics/hosted telemetry are TBD.
- **Backups/rollback:** Evaluation seeds may be recreated. Before P0-002 family deployment, the app must expose documented consistent SQLite backup/restore commands and take a pre-migration backup. The selected host must retain recoverable off-host or provider snapshots of the mounted data/backup volume, and one restore rehearsal is required as deployment evidence. Retention duration remains a Project Lead/host choice and must be recorded before real data is entered.
- **Support/ownership:** Engineering owns implementation evidence; Architecture accepts against the brief; the Project Lead evaluates usefulness.

## Testing and verification strategy

- Unit-test completion semantics, definition-revision selection, household-local date resolution, DST/midnight boundaries, and optimistic reconciliation.
- Integration-test migrations against temporary SQLite databases, idempotent occurrence materialization, mutation replay, capability enforcement, and the invariant that future-effective edits leave current/historical snapshots unchanged.
- Browser-test phone-sized Chromium and WebKit flows with Playwright, including three rapid step actions, delayed responses, a transient disconnect/reconnect, and two independent browser contexts receiving shared updates.
- P0-002 adds integration coverage for credential hashing/login throttling, bootstrap/enrollment single use, hashed session expiry/revocation/CSRF, household isolation, every capability path, personal-layer composition, proposal decision idempotency/audit, personal-task visibility, migration of a populated P0-001 fixture, and client-outbox identity isolation.
- P0-002 browser evidence uses six distinct accounts and at least two concurrent contexts; it covers direct personalization, restricted proposal/approval, prospective preview, parent navigation, private/household personal tasks, and direct-API authorization failures without relying on hidden controls.
- Validate keyboard operation, accessible names, focus visibility, status text, and non-color state cues for the primary checklist flow.
- Run `npm run validate`, `npm run build`, and `npm run test:e2e` before a Build Report claims completion.
- P0-002 hosted acceptance requires focused use on at least two physical phones against the same HTTPS origin, including separate sign-in, persistent reload, checklist propagation, and proposal approval. Desktop emulation remains useful automated evidence but is not a substitute for this deployment check.

## Performance, scale, and environment constraints

- Primary layouts target narrow phone viewports first and then expand responsively.
- A checklist tap must update the local visible state in the same interaction turn, without waiting for network completion, reload, dialog, spinner, or animation.
- Under ordinary local/trusted-LAN conditions, another connected client should display a committed checklist change within two seconds.
- P0-001 and P0-002 target one household and ordinary family interaction volume. SQLite and a single Node application process are intentional; no horizontal scaling is required. The hosted edge may be a separate reverse-proxy process supplied by the host.
- Transient offline execution is supported after the app has loaded. Fully offline first load, installability, push notifications, and background sync after the browser is closed are not P0-001 requirements.

## Dependencies, services, assets, and licensing

- **Runtime dependencies:** Current dependencies are React, Fastify, `better-sqlite3`, `@fastify/websocket`, `@fastify/cookie`, `@fastify/static`, `@fastify/helmet`, `@fastify/rate-limit`, `@node-rs/argon2@2.2.0`, Zod, and `idb-keyval`. Node 24 compatibility has been exercised on Windows and the authorized Linux evaluation host.
- **Development dependencies:** Vite, TypeScript, ESLint, Vitest, Playwright, and type packages required by the selected runtime versions.
- **External services/accounts:** None in application behavior. Hosted releases require a Project Lead-authorized public HTTPS origin, persistent storage, and recoverable snapshots; Railway was used for evaluation but is not required by the architecture.
- **Paid or metered resources:** No service is authorized by Architecture. Hosting/account/spend remains under Project Lead control.
- **Assets/models/datasets and provenance:** No external assets are required. Use system fonts and simple CSS/HTML UI assets.
- **Licensing/attribution:** Engineering records dependency licenses and must not add an incompatible or unclear license.

## Important conventions

- **Brief naming:** Use flat files under `briefs/` until volume justifies grouping: `P<roadmap milestone>-<three-digit sequence>-<descriptive-kebab-case-outcome>.md`. The stable ID and filename do not change across revisions. Example: `briefs/P0-001-shared-morning-routine.md` with branch `brief/p0-001-shared-morning-routine`.
- **Module boundaries:** Domain rules do not import React, Fastify, SQLite, or browser APIs. Adapters translate at the edges.
- **Identifiers:** Persist opaque UUID identifiers; do not use display names or array positions as identity.
- **Dates and times:** Use explicit household-local dates, IANA timezone IDs, and UTC instants as defined above. Do not use device-local `Date` defaults in domain rules.
- **Schema evolution:** Append definition revisions and migrate storage forward. Do not mutate historical structure in place.
- **Commands:** Prefer desired-state commands (`set completed`) over toggles so retries are idempotent.
- **Authority:** Model capabilities as explicit grants on household membership, independently from age and assignment. P0-001's two embedded capability sets are a migration source, not the target representation.
- **Truth boundaries:** Shared server state is authoritative; client outbox entries are pending intent; sync events are invalidation/reconciliation hints.
- **Identity model:** A login user and a household membership are different IDs. Household display name, authority, assignment, and personal routine ownership refer to membership; credential/session lifecycle refers to user.
- **Personalization:** Shared item IDs are stable logical references; revision rows and occurrence-step rows are snapshots. Personal additions have their own stable IDs and must not duplicate shared item content into a detached full routine.
- **Security configuration:** Hosted mode is fail-closed. Development/test authentication conveniences use explicit profiles and may not be enabled by production environment variables alone.

## Known technical debt

- CI pull-request validation is defined in `.github/workflows/validate-pr.yml`; required-check branch protection remains a Project Lead setting. Contract catalog: `docs/protected-behaviors.md`.
- Hosted backup/restore is operator-driven; automation and retention beyond the accepted family-evaluation evidence remain future operational work.
- The initial weekly Morning schedule is deliberately narrower than the contextual schedule model Product anticipates.
- P0-001 supports transient disconnection after load, not a fully offline-installable application.

## Proposed future architecture

- Extend the schedule-rule union and resolver for contextual anchors, exceptions, and contextual additions; do not add global weekday/weekend flags.
- Add additional responsibility types and Today sections through the same versioned-definition and snapshotted-occurrence model.
- Revisit SQLite and single-process hosting only when deployment, backup, or measured concurrency evidence requires it.
- Add self-service recovery, invitation delivery, multi-household selection, membership departure/export, and configurable removable-item policy only after P0-002 evaluation establishes their actual workflows.

## Architecture questions

- Which Project Lead-authorized provider/public origin and snapshot retention policy will satisfy the P0-002 single-host deployment contract?
- Which self-service account-recovery experience should follow the operator-assisted P0-002 evaluation path?
- If personal tasks later gain due dates or recurrence, should they follow household, viewer, or item-specific timezone?
- What exact product term should replace the technical `as_needed` state and any future critical/non-skippable classification?
