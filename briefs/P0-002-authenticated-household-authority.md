# BRIEF P0-002 - Authenticated Household Authority

**Revision:** 1
**Status:** BLOCKED

Recommended lifecycle: DRAFT -> IN REVIEW -> READY -> IMPLEMENTING -> IMPLEMENTED -> ACCEPTED

A material contract change increments the revision and invalidates previous Engineering readiness.

`ACCEPTED` means Architecture has accepted the implementation against this technical contract. Project Lead/user acceptance of the experience is separate.

Keep one authoritative brief file for this stable ID. Do not create addenda or sidecar clarifications; fold material changes into this file and revision history.

## Why

P0-001 proved that one Morning Routine can retain trustworthy dated history, respond optimistically, and reconcile shared state. It did not authenticate people: any local evaluator can select any seeded profile. The next product risk is whether six distinct family members can use the same routine with different degrees of personal control without making the checklist slow, the authority model confusing, or the history unreliable.

This slice establishes the smallest real household boundary around that proven routine. It adds individual sign-in, household membership grants, one direct-personalization path, one proposal/approval path, and one thin kind of self-created personal work. It does not generalize household responsibilities or scheduling.

## Learning question

Can one shared Morning Routine support six real identities and progressively granted personal control while remaining simple for routine execution, secure against cross-member actions, and trustworthy across future changes?

## Player experience

Each household member signs in as themselves and lands on their own Today view. A member can rapidly complete their own Morning Routine as before and create a basic personal task. A directly authorized child can add and position personal Morning Routine items, then see when and where they will appear without affecting siblings. A proposal-authorized child can ask to add `Pack soccer bag`; it remains pending until an authorized parent approves or rejects it. A parent can move among their own Today view, household progress, and pending approvals.

The shared routine remains the inherited base. Personal changes apply prospectively to one membership, and the application clearly reports the effective household date and previews the next applicable composed routine. Past occurrences remain unchanged. Private personal work stays private; household-visible work remains inside the household.

## Project card

**Card title:** Use Morning Routine as a real household

**Suggested column:** Up Next

**Player-facing goal:** Six family members sign in separately and use one shared Morning Routine with personal control appropriate to each person.

**Done when:** A family can use the same secure phone-accessible deployment, one child can personalize directly, another can request a parent-approved addition, everyone can create private or shared personal work, and shared progress/history still behave reliably.

**Tracking relationship:** Standalone card

## Current system

- P0-001 r1 is technically accepted and merged to `main` via PR #1. The repository is clean at Architecture preparation time and uses a single npm package on Node.js 24.
- `package.json` defines a TypeScript/React/Vite client, Fastify HTTP/WebSocket server, SQLite through `better-sqlite3`, Zod boundary schemas, an IndexedDB outbox, Vitest, and Playwright Chromium/WebKit tests. The known validation commands are maintained in `ARCHITECTURE.md`.
- `db/migrations/001_initial.sql` stores household identity and `capabilities_json` directly on `members`. `sessions` stores a caller-selected member/household context without expiry or credential verification. This schema is an evaluation model and must be migrated, not treated as real authentication.
- `/api/v1/session` currently accepts a seeded `memberId`, creates the evaluation cookie `hd_eval_session`, and powers a visible profile selector. Subsequent routine and checklist operations derive actor/household from that session, which is a useful boundary to preserve.
- Current capabilities are the closed set `manage_routine` and `execute_own_occurrence`. Shared routine writes and self-execution are checked server-side, but there is no user, credential, membership-grant, enrollment, proposal, or personal-task model.
- Shared `routine_revisions` are append-only and future-effective after initial creation. `revision_steps` have revision-local IDs only. `occurrences` and `occurrence_steps` snapshot expected work; `step_reports` preserve accountable member, acting member, performed time, server record time, and resulting state.
- Checklist status commands are desired-state, mutation-ID-deduplicated writes. The client applies them immediately, stores pending commands in IndexedDB, and reconciles through HTTP plus household-scoped WebSocket invalidation.
- Current P0-001 UI provides parent Today/Routine/History views and a child Today checklist. A routine save confirms in place; Product evaluation found that its effective date and useful next destination were not discoverable enough to exercise the child result immediately.
- No internet host, public origin, external account, paid service, or production backup facility is configured or authorized. Current non-loopback access is explicitly trusted-LAN evaluation only.

## Behavioral contract

1. **Forward migration preserves P0-001 evidence.** Add ordered migrations that convert current member identity into `User`/`HouseholdMembership`-compatible storage while preserving household IDs, member IDs as membership identities, routine definitions/revisions, occurrence snapshots, step reports, and mutation receipts. Existing evaluation sessions are revoked. Existing members without credentials become pending/claimable memberships; migration does not infer new authority from names or presumed ages. A migration test starts from a populated P0-001 fixture and proves historical structure and status remain unchanged.

2. **Production never creates fictional access automatically.** Development/test may explicitly load fictional fixtures. Hosted/production startup on an empty database does not auto-seed profiles, expose profile selection, accept a member ID as authentication, or enable a trusted-LAN/test bypass. Runtime profiles are explicit, and hosted mode fails to start if secure public-origin/session/storage configuration is incomplete.

3. **A narrow bootstrap and enrollment path creates six real accounts.** A local operator command issues one short-lived, single-use bootstrap claim and stores only its digest. It can bind the first manager user to an existing pending manager membership or create the first household/manager in an empty database. An authenticated membership with `household.member.enroll` can issue single-use, expiring claims for existing pending memberships or new memberships using one of three functional grant presets: manager, direct personalizer, or proposal personalizer. The claim value is shown once and pasted into a claim form, not placed in a URL. Claiming atomically creates/binds the user, establishes the selected display name/grants, consumes the claim, and signs the member in. No open registration or email delivery is added.

4. **Credentials follow the adopted passphrase contract.** Login names are globally unique, trimmed/lowercased ASCII identifiers of 3–64 characters matching `[a-z0-9][a-z0-9._-]{2,63}`; Unicode household display names are separate. Passphrases accept 15–128 Unicode characters, normalize with NFC, allow paste/autofill, impose no character-class composition rules, and reject values in a locally shipped/licensed common-password blocklist. Store Argon2id PHC hashes with at least 19 MiB memory, two iterations, and parallelism one. Raw passphrases never enter SQLite, logs, reports, URLs, or client persistence. Login and claim failures do not reveal whether a login name exists. Repeated failures are throttled with `Retry-After` behavior and no permanent account lockout.

5. **Persistent sessions are revocable and same-origin.** Successful authentication issues a new cryptographically random 256-bit opaque token and stores only its SHA-256 digest. Hosted mode uses a host-only `__Host-` cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`; local development/test uses a visibly distinct cookie configuration. The server enforces a seven-day idle and 30-day absolute expiry, revokes on logout, and rotates after authentication or a privilege-level change. State-changing requests require a session-bound CSRF header and allowed `Origin`; WebSocket handshakes require the same allowed origin and authenticated membership. CORS is not opened to arbitrary origins.

6. **User, household, membership, and authority remain distinct.** A session identifies a `User`; each request resolves that user's sole active `HouseholdMembership` and current grants. The P0-002 grant set is `household.member.enroll`, `routine.shared.manage`, `routine.personalize.direct`, `routine.personalize.propose`, `routine.proposal.decide`, `routine.execute.own`, and `personal_task.create`. Presets grant combinations of these capabilities but age is not an input or policy. Multi-household switching and a universal grant editor are not implemented.

7. **Every resource is scoped server-side.** The server derives actor, membership, and household from the authenticated session, then enforces capability, ownership, proposal state, and visibility for both reads and writes. Client-supplied IDs are only lookup references. An active membership may read its household Morning Routine status and household-visible personal tasks; private tasks are owner-only. IDs from another household return the same safe not-found/forbidden policy used consistently across the API. Hiding controls is required for clarity but is never the authorization mechanism.

8. **Shared routine management remains prospective and manager-only.** `routine.shared.manage` is required to create or revise the household Morning Routine. Shared steps gain stable logical item IDs: an unchanged item retains its ID across revisions; a new item receives a new ID. Existing P0-001 revision rows receive migration-safe identities without rewriting occurrence rows. Current scheduling, obligation semantics, assignee selection, household-timezone resolution, and future-effective revision behavior remain intact.

9. **Personal routine layers do not clone the base.** A membership's personal Morning Routine data is a separately append-only, household-date-effective layer containing personal additions and their ordering/anchor metadata, not copied shared item text. One deterministic domain function composes the effective shared revision and effective member layer for preview/materialization. It inserts personal additions relative to stable inherited/personal anchors; if an anchor no longer exists, the addition falls back to the end of inherited content in stable personal order. Materialized occurrence steps snapshot final order, text, obligation, and `shared|personal` source identity.

10. **Direct personalization is member-scoped and prospective.** A membership with `routine.personalize.direct` may add a personal item to its own Morning Routine and reorder its own personal additions around inherited items. It may not edit, reorder, or remove inherited shared items in P0-002 and may not change another membership's layer. Saving appends a layer revision effective no earlier than the next household date. It does not alter today's already materialized occurrence. The operation is retry-safe and does not create duplicate additions.

11. **Restricted personalization uses one narrow proposal lifecycle.** A membership with `routine.personalize.propose` may propose one addition to its own routine, including text, obligation, and intended anchor/order. The proposal records proposer and server proposal time and remains `pending`; it has no effect on composition. A membership with `routine.proposal.decide` may approve or reject once. The decision records decider and server decision time. Approval transactionally creates the corresponding personal addition/layer revision effective no earlier than the next household date; rejection creates no layer. Replaying the same decision is idempotent; an opposite or second decision returns a conflict. This is not a generic workflow engine.

12. **Inherited shared content remains protected.** No child personalization or proposal API in P0-002 can remove or alter a shared item, including one marked `required`. Direct requests that attempt it are rejected without creating a layer revision. A future independently modeled removable-item policy is allowed by stable shared IDs but is not part of this brief.

13. **Prospective changes have an evaluable destination.** After a shared revision, direct personalization, or approved proposal, the UI states the household effective date and provides a clear route to a read-only preview of the next applicable composed Morning Routine for the affected member. Preview does not materialize an executable occurrence or provide arbitrary date/time travel. An unauthorized viewer cannot preview private member customization outside household scope.

14. **Every active member can create thin personal work.** A membership with `personal_task.create` can create a one-off task for itself with a non-empty title and `private|household` visibility, view its open/completed tasks, and set its own task complete/open with desired-state, retry-safe commands. Ownership and visibility are distinct persisted facts. Private tasks are never returned to another membership, including a manager; household-visible tasks appear in household status but remain owned by their creator. No assignment, checklist, recurrence, due date, reminder, or project behavior is added.

15. **Today remains focused and authority-aware.** Sign-in lands on the authenticated member's Today view; the former profile selector/switcher is absent in normal use. Morning Routine execution remains the primary action. Personal tasks use a compact section without turning Today into a generalized dashboard. A manager can move among own Today, household Morning Routine status, and pending approvals. Direct/proposal settings appear only for the relevant capability. Completed work is quiet/collapsible, current work is actionable, and later/preview content is discoverable without a total navigation redesign.

16. **Optimistic execution and synchronization survive authentication.** Morning Routine step taps remain synchronous local updates backed by the existing durable desired-state outbox and idempotent server receipts. Authentication/capability checks happen on the server without adding a blocking round trip to the visible tap. Outbox records are namespaced by membership and never drain under a different signed-in identity on a shared browser. An expired session may retain pending intent for the same user after reauthentication; explicit logout warns about and discards that membership's pending local intent. HTTP reconciliation and household-scoped WebSocket invalidation remain authoritative/live-enough paths.

17. **The same application is deployable securely to one host.** Supply provider-neutral production artifacts/documentation for one Node.js 24 application process and mounted SQLite/backup directory behind HTTPS with WebSocket forwarding. Hosted mode uses the canonical origin and narrowly configured trusted proxy, emits no routine/member/private-task/credential/token content in structured logs, and survives process restart without losing committed state. Add consistent backup and restore commands, create a pre-migration backup, and document a restore rehearsal. A specific host/account/domain is not authorized by this brief; the Project Lead must provide or approve one before hosted acceptance.

18. **Errors remain safe and actionable.** API errors retain a stable machine code, safe human message, and request ID. Authentication responses are generic. Authorization, validation, conflict, throttle, expired-session, unavailable, and CSRF/origin failures are distinguishable to the client without stack traces, credential details, cross-household existence leaks, or silent loss of pending user intent.

## Implementation boundary

- Extend the existing single-package TypeScript application; do not introduce workspaces, a second application backend, or a managed runtime service.
- Add ordered migration(s) after `db/migrations/001_initial.sql`; preserve IDs and populated P0-001 data as specified rather than replacing the initial migration or rebuilding databases.
- Expect cohesive modules under `src/server/` for authentication/session/enrollment, membership/authorization policy, personal routine/proposal services, personal tasks, and backup/restore scripts. Domain composition rules remain under `src/domain/`; API schemas remain shared under `src/shared/`.
- Extend the current React client, API adapter, WebSocket client, and IndexedDB outbox. Reuse the established Today/Routine/History visual language and responsive CSS rather than replacing the application shell.
- Add `@node-rs/argon2` as the preferred Argon2id dependency after Engineering verifies Node 24 and target Linux/Windows support during readiness. A contract-equivalent maintained package requires Architecture approval if compatibility evidence rejects it. A small Fastify-compatible rate-limit/security-header package is within Engineering discretion when it reduces custom security code.
- Add a locally stored common-password blocklist with documented source/license or a maintained dependency that performs the same no-network check. Do not call a third-party password service at runtime.
- Add production packaging/configuration examples and operator docs for bootstrap, enrollment, migration, backup, restore, deploy, restart, and rollback. Keep provider credentials and real environment values out of the repository.
- Extend Vitest integration/domain tests and Playwright phone-viewport Chromium/WebKit tests. Use fictional accounts and a second-household fixture for isolation evidence.
- Update `ARCHITECTURE.md` only with implementation facts that Engineering actually verifies; record exact new commands, environment variables, dependency versions, and supported host assumptions in the Build Report.

## Do not change

- Do not weaken P0-001 immutable structural history, assignment/execution separation, obligation meanings, household-timezone authority, desired-state mutation idempotency, optimistic immediate checklist behavior, durable pending intent, or authoritative reconciliation.
- Do not add generalized chore rotation, multiple responsibility types, contextual calendars, Skip Days, helper/cover/swap/claim behavior, retrospective completion, chore debt, or complete notification behavior.
- Do not implement multi-household switching, household splitting/departure, public/cross-household visibility, a universal permission editor, or age-derived authority.
- Do not add enterprise/social SSO, email delivery, MFA policy management, security questions, open registration, or a broad self-service recovery system.
- Do not implement inherited shared-item removal/reordering by children, a generic approval engine, or personal edits that affect another membership.
- Do not add personal-task due dates, recurrence, reminders, assignees, checklists, projects, or approval requirements.
- Do not redesign all Today hierarchy or add unrelated responsibility creation/advanced schedule UI. The prospective preview is a focused response to evaluation evidence, not a general time-travel editor.
- Do not expose evaluation profile selection, trusted identity headers, real names, passphrases, session/enrollment/bootstrap tokens, private task titles, or household routine content in hosted logs, committed fixtures, client bundles, URLs, or reports.
- Do not select, purchase, create, or publish to an external hosting account without Project Lead authorization.

## Acceptance tests

1. **Populated migration:** Apply all migrations to a representative P0-001 database containing a shared revision, yesterday/today occurrences, mixed step states, and mutation receipts. Existing IDs, occurrence structure/order/text/obligation/status, accountable/acting facts, and timestamps compare equal before/after; old evaluation sessions no longer authorize requests.
2. **Fresh/production startup:** A fresh hosted-profile database has no fictional accounts and no member-ID session endpoint/UI. Hosted startup rejects missing/non-HTTPS canonical origin, insecure session configuration, missing persistent paths, or an unapproved test/evaluation bypass. Explicit development/test setup can still create fictional fixtures.
3. **Six identities:** Bootstrap one manager, enroll five additional fictional members across the three grant presets, and sign each account in separately. Each lands on their own named Today view; refresh within session lifetime remains signed in; logout revokes the server session. A manual family-evaluation checklist later records six real accounts without placing their identity values in the report.
4. **Credential controls:** Automated tests prove 14-character and locally blocklisted passphrases are rejected, 15–128-character Unicode/passphrase-manager input is accepted without composition rules, stored credentials are Argon2id PHC hashes with the adopted minimums, and no raw secret reaches captured logs/database/client persistence. Login failure responses are equivalent for unknown user, wrong passphrase, disabled membership, and throttled accounts except documented status/`Retry-After`; repeated guessing is throttled and later recovers.
5. **Claims and sessions:** Bootstrap/enrollment claims are stored only as digests, expire, and cannot be replayed. Hosted response tests verify the `__Host-` cookie attributes, token digest storage, idle/absolute expiry, logout revocation, and rotation after sign-in/grant change. Missing/wrong CSRF or disallowed HTTP/WebSocket origin is rejected.
6. **Household isolation:** With two household fixtures, enumerate each read/write route using a valid account plus another household's IDs. No routine, occurrence, member, proposal, claim, personal layer, task, or WebSocket event crosses the boundary, and responses do not disclose whether the foreign ID exists.
7. **Capability matrix by direct API:** For every P0-002 grant, test one permitted action and the same call from a membership without that grant. A proposal personalizer cannot revise shared routine, personalize directly, approve a proposal, enroll a member, execute another member's occurrence, or create a task for another owner. UI hiding is verified separately and is not counted as authorization evidence.
8. **Direct personalization:** A direct personalizer adds `Clean up breakfast` and then changes the order of their own personal additions. The next-applicable preview shows the item/order for that membership only. Sibling previews and the shared definition remain unchanged. Attempts to submit a foreign membership or alter inherited item content/order/removal are rejected and create no revision.
9. **Restricted proposal:** A proposal personalizer submits `Pack soccer bag`. Before decision it is pending and absent from current/future composition. An authorized manager approves it; proposer/decider/timestamps are retained and the next-applicable preview includes it only for the proposer. Repeating approval returns the same result; attempting rejection afterward conflicts. A separate rejected proposal never appears in composition.
10. **Prospective and historical integrity:** Materialize and complete yesterday's occurrence, then revise the shared base, add direct personalization, approve a proposal, alter grants, and claim/rename another membership. Yesterday's occurrence-step snapshot and execution facts remain unchanged. Today's already materialized occurrence remains unchanged. The first applicable future composition includes the correct effective shared and personal revisions with source provenance.
11. **Stable-base flow:** After a child has a personal addition, a manager adds a new shared item in a later shared revision. The child's next composition contains both the new inherited item and existing personal addition without duplicating or detaching the shared routine. If the personal item's previous anchor is absent, the documented stable fallback order is used.
12. **Required structure:** Through UI and direct API, a child without `routine.shared.manage` cannot remove or edit an inherited required shared item. No unauthorized layer/revision/audit record is written. An authorized shared-routine manager can change the base prospectively through the existing revision flow.
13. **Personal task visibility:** Each preset can create a private and household-visible personal task when it has `personal_task.create`. Only the owner can read/complete/reopen the private task. Other active household members can read the household-visible task but cannot mutate it. A manager receives no special private-task access. Another household receives neither task.
14. **Authority-aware navigation:** Phone-sized browser tests show each account's identity and own Today after sign-in. A manager can reach own Today, household status, enrollment, and approvals. A direct personalizer reaches direct settings but not approvals/shared editor; a proposal personalizer reaches proposal settings but not direct/shared/approval controls. Direct API denials still pass for every hidden action.
15. **Prospective feedback:** Saving a shared revision/direct personal change or approving a proposal reports the household effective date and offers the affected member's next-applicable read-only preview. The user does not need to wait for the next real date or guess where the change went, and preview does not create an occurrence or expose arbitrary date editing.
16. **Optimistic execution regression:** In Chromium and WebKit phone viewports, three rapid checklist status actions update visible state in the same interaction turns without reload/spinner/dialog, survive an induced disconnect in the IndexedDB outbox, and reconcile after reconnect without duplicate reports. Existing completion semantics and idempotent replay tests continue to pass.
17. **Shared-browser identity safety:** Queue an offline command for member A, expire or change identity, and sign in as member B in the same browser profile. B never sees A's cached private data and A's command is not sent under B. Reauthenticating as A can resume pending intent; explicit logout warns and clears A's pending commands according to the contract.
18. **Cross-device synchronization:** Two authenticated browser contexts in the same household receive committed occurrence changes within two seconds under ordinary conditions. A context in another household receives nothing. Reconnect followed by authoritative read recovers missed changes. Authentication and origin checks apply to the WebSocket path.
19. **Household time and accessibility:** An account whose browser/device timezone differs from the household still receives the household's date and correct applicable revisions. Primary sign-in, Today, personalization, proposal, approval, and task flows have accessible names, visible focus, keyboard operation, non-color status cues, and practical touch targets at narrow phone widths.
20. **Hosted family-evaluation evidence:** Against the Project Lead-authorized HTTPS origin, at least two physical phones sign in as different members, reload with persistent sessions, complete a checklist step, observe the cross-device household update, and approve one proposal. HTTP redirects to HTTPS; hosted cookies are secure; WebSocket synchronization works; committed state survives an application restart. A consistent backup is restored into an isolated instance and the household/routine/history counts plus sampled records match. The Build Report names the host class and evidence dates but omits the private origin, real identities, secrets, and routine/task content.
21. **Project verification:** `npm run validate`, `npm run build`, and the full locked Playwright Chromium/WebKit suite pass from a fresh `npm ci`. New bootstrap/migrate/backup/restore/hosted-smoke commands are exercised exactly as documented. Any physical-device or authorized-host check that cannot run is reported as a gap and prevents Architecture from marking the hosted P0-002 outcome technically `ACCEPTED`.

## Dependencies

- Merged P0-001 r1 on current `main`.
- Node.js 24 and the committed npm lockfile.
- One maintained Node-24-compatible Argon2id implementation; preferred dependency is `@node-rs/argon2`, subject to Engineering readiness verification on Windows development and target Linux deployment.
- A local no-network common-password blocklist with documented compatible licensing.
- Before acceptance test 20: a Project Lead-authorized internet-reachable HTTPS host/public origin supporting one long-running Node process or container, WebSocket upgrades, a restricted persistent volume, process restart, and recoverable off-host/provider snapshots. Provider/account/cost and snapshot retention are `TBD`; this brief does not authorize them.
- At least two physical phones and six real household accounts for final family-evaluation evidence. Automated tests must use fictional identities.

## Relevant decisions

- D-002 - Single-process TypeScript web application for the first slice
- D-003 - Versioned definitions and snapshotted occurrences
- D-004 - Server-authoritative state with optimistic durable client intent
- D-005 - Evaluation identity is a temporary local boundary
- D-006 - Users authenticate; memberships carry household authority
- D-007 - Local passphrases and digest-backed persistent sessions for family evaluation
- D-008 - Personal routine changes are effective-dated overlays on stable shared items
- D-009 - Secure family evaluation uses one provider-neutral persistent HTTPS host
- D-010 - Personal task ownership and visibility are separate facts

## Known risks / assumptions

- **Host authorization:** Application implementation/readiness can proceed against the provider-neutral contract, but hosted technical acceptance cannot. Project Lead selection/provisioning of the HTTPS host is a real external dependency, not an Engineering choice hidden in implementation.
- **Young-member sign-in:** Fifteen-character passphrases may be burdensome for the youngest member. P0-002 deliberately uses long-lived revocable device sessions and parent-assisted passphrase setup rather than weakening the internet-facing secret. Family evaluation should determine whether a later passkey, device claim, or managed recovery path is needed.
- **Native package compatibility:** The preferred Argon2id package ships platform binaries. Engineering must prove installation/hash/verify under Node 24 on this Windows host and the chosen Linux target during readiness/build evidence.
- **Migration variability:** A Project Lead's ignored local `runtime/` database may contain a longer real routine than committed fixtures. Migration tests use representative data, and a pre-migration backup is mandatory; reports must not copy private content.
- **Shared-device privacy:** Browser caches/outbox state can expose one member's data after identity changes unless the client explicitly namespaces and clears state as contracted.
- **Personal ordering boundary:** P0-002 reorders personal additions around inherited anchors; it does not let children reorder inherited shared items. Whether some inherited items become removable is an explicit future Product decision.
- **Recovery:** There is no email or self-service recovery. Operator-assisted replacement/re-enrollment must be documented for evaluation and must revoke prior sessions; the long-term recovery experience remains TBD.

## Engineering readiness

**Reviewed revision:** 1
**Readiness:** READY

**Review round:** Initial consolidated pass (2026-09-07). Full write-up: `reports/P0-002-r1-engineering-readiness.md`.

No material Questions or Blockers. Merged P0-001 on `main` (`8004959`) matches the brief’s Current system. `@node-rs/argon2@2.2.0` installed and verified Argon2id (19 MiB / 2 iterations / parallelism 1) under Node.js `v24.16.0` on this Windows host; Linux live probe deferred to Build Report when an authorized host exists. Hosted HTTPS provider remains an acceptance gap only. Implementation awaits Architecture’s response. Coordinator/Architecture should commit untracked/uncommitted P0-002 planning artifacts to `main` before Engineering opens `brief/p0-002-authenticated-household-authority`.

**Architecture disposition:** ACCEPT (2026-09-07). The readiness findings require no r1 contract change. Planning artifacts and the readiness report were committed to `main` in `eb8647e`; Engineering is authorized to create `brief/p0-002-authenticated-household-authority` from this planning baseline and implement P0-002 r1. Provider-neutral implementation may proceed before a host is selected, but acceptance tests 20 and the hosted portions of 21 remain required before Architecture can mark the full brief technically `ACCEPTED`.

**Architecture acceptance disposition:** FIX REQUIRED (2026-09-08). This is a same-revision fix loop; no contract change or readiness re-review is required after the fixes. The Build Report demonstrates substantial implementation progress, but r1 cannot be technically accepted yet for the following reasons:

- **Security contract defect:** `/api/v1/auth/login` and `/api/v1/auth/claim` are CSRF-exempt but do not independently enforce the required allowed-origin check. The brief requires login and claim endpoints to validate their own origin; add the check and direct HTTP tests for absent, foreign, and allowed origins. Keep the test-only bootstrap shortcut unavailable in hosted mode.
- **Migration contract defect:** `src/server/backfill.ts` carries logical IDs by a single `text + obligation` map. Duplicate checklist rows can therefore receive the same logical ID, contradicting stable unique item identity and making anchors ambiguous. Backfill must assign one unique ID per row, match prior identities one-to-one where evidence supports continuity, and test duplicate/reordered legacy steps.
- **Protected regression evidence was removed/reduced:** The implementation branch deletes the existing `tests/integration/p0-001.test.ts` and reduces the prior e2e coverage to three P0-002 tests. Restore or port equivalent regression coverage for P0-001 materialized-occurrence idempotency, assignment/execution separation, future-history integrity, household-timezone behavior, pending outbox through reload/interruption, dual-context synchronization/reconnect, and accessibility basics. Do not claim the protected P0-001 behavior is covered solely because the new suite passes.
- **Required evidence gaps:** Add focused automated evidence for the brief’s partial scenarios: full HTTP route and WebSocket cross-household isolation, exhaustive grant/API matrix, shared-base change after personalization, required-item UI/API denial, effective-date preview behavior, shared-browser identity switch/outbox safety, and two-context synchronization. These may be implemented as integration or e2e tests, but each must be traceable to the corresponding r1 acceptance test.

Acceptance tests 20 and the hosted portions of 21 remain **NOT RUN**, not Engineering defects: they require the Project Lead-authorized HTTPS host, persistent storage/snapshots, and physical phones. After the code/evidence fixes, return the same r1 with an updated Build Report. Architecture will then reassess the implementation; hosted evidence will still be required before full technical acceptance.

**Architecture reassessment:** BLOCKED (2026-09-08). Engineering’s updated Build Report addresses the prior same-revision fixes: the login/claim origin checks are present, duplicate legacy logical IDs are backfilled one-to-one, P0-001 regression coverage is restored, and the previously partial automated scenarios are now covered. Architecture independently reran `npm run validate` with 25 tests passing. The available Engineering e2e evidence is 16/16; a local rerun in this environment was stopped after the command produced no output during its browser-install/test phase, so no contrary result is asserted. No further code-level FIX REQUIRED finding is identified.

Full technical acceptance of P0-002 r1 remains blocked until acceptance test 20 and the hosted portions of 21 are performed against a Project Lead-authorized HTTPS host with persistent storage/snapshots and physical phones. The Linux Argon2 live probe is also still an evidence gap. The brief remains r1; once the external environment is available, Engineering should run the hosted smoke/family evidence and return the same r1 Build Report for final Architecture acceptance.

## Revision history

- **r1:** Initial contract for individual authentication, membership capability grants, shared-base personal overlays, narrow proposal approval, thin personal tasks, and secure single-host family evaluation while preserving P0-001 history and optimistic execution.
