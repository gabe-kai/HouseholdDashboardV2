# Architecture

> This document records the product's current technical shape and the deliberate conventions future briefs may rely on. Distinguish repository truth from proposed architecture.

If this document disagrees with the repository about what exists, the repository wins and this document should be corrected. A brief may still intentionally change current behavior.

`TBD` is allowed. Document what Engineering needs to work safely; do not design the entire future system in advance.

## Technical overview

- **Current repository truth (2026-09-25):** Integrated `main` at **ef39a89** includes technically accepted **P0-007C-1 r1** via PR **#20**, accepted A/B, migrations through **014**, assignment patterns, scheduled work, Unassigned and draft preview. P0-007C-2 r1 is implemented on its brief branch at **a2b9e42**, but Architecture returned **FIX REQUIRED**; it is not technically accepted or integrated. Product evaluation remains separate. C-3 remains the final slice of the supplied revised C proposal.
- **Retained P0-005 foundation:** P0-005 r3 entered `main` at `31aad37`: `routine_schedule_entries`, immutable revision content versions, definition `ended_at` / `end_mode` / `deleted_at`, occurrence `canceled_at`, current-plan range reconciliation to the next schedule boundary, upcoming schedule create/edit/move/delete, Delete unused vs End, started/history visibility when live audience excludes a person, and atomic lifecycle receipts. Migrations `007_routine_schedule_lifecycle.sql` and `008_widen_routine_mutation_receipt_kinds.sql` cover lifecycle storage and long-lived-database receipt kinds. r2 locks, personal tomorrow-floor, group next-day, sync/outbox, and Origin/CSRF/WS protections remain preserved. Recorded pre-P0-005 integrated baseline: `93ef494`.
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
- P0-004A established People, Groups, and person-centered access status. Accepted P0-004B added group-backed Morning Routine audience resolution, overlap deduplication, prospective membership effects, and materialized-occurrence boundaries.
- Household structure mutation uses a distinct `household.structure.manage` grant; `household.member.enroll` remains the access-setup grant. The manager preset carries both, while Adult/Child remains descriptive only.
- Existing memberships migrate with classification unset because the repository has no trustworthy classification fact. New people require Adult/Child, and managers may correct the migrated `Classification not set` state without changing authority.
- Enrollment status is a safe projection over user and claim facts. One actionable claim per membership is permitted; replacement/cancellation revoke it, plaintext is shown once, and later reads never expose claim secrets.
- Administrative create operations are server-authoritative and replay-safe by client mutation ID. Group member-set updates are transactional and version-guarded; they are not placed in the checklist IndexedDB outbox.
- P0-004A r3 uses exclusive in-app overview/detail/edit/access/activity states with explicit Back and focus restoration on phone. It does not add a router or deep-link contract. Household progress and household-visible tasks live in the focused Household activity state rather than the directory overview.
- Normal development/bootstrap is fixture-free. Deterministic demo/test seeding is explicit and derives from one canonical stable-ID manifest. Existing demo contamination may be removed only by a dry-run-first, backup-first operator command that matches manifest IDs and proves the absence of every durable relationship; display names are never provenance.

### P0-004B implemented routine-audience contract

- A Morning Routine revision preserves two kinds of selected source: direct household-membership IDs and stable group IDs. Sources are not flattened into copied individual assignments. Resolution for a household date unions direct memberships with the effective member set of every selected group and deduplicates by membership ID. Pending/unenrolled household people remain valid responsibility participants; app access and execution authority stay separate.
- Group structure has two projections: the latest configured member set used by People & Groups, and immutable household-date-effective membership versions used by consuming responsibilities. Group creation establishes its initial dated set; a changed set becomes operational on the next household day. Repeated edits for the same effective date are append-only and the greatest group version wins. A rename is immediate presentation behavior, not a membership revision.
- Routine save normalizes direct sources that are already included through a selected group on the routine revision's effective date. A later group edit does not silently rewrite prior explicit Routine source intent; dated resolution deduplicates any overlap until the next deliberate Routine save.
- Today and prior dates remain immutable. Future participation is provisional until its household date starts: a group change may add or exclude members from authoritative future results even when future occurrence rows already exist. A surviving occurrence's title, steps, obligations, personal composition, and reports are never recomposed or deleted by this reconciliation.
- Checklist status writes are rejected for future household dates and for cached occurrences whose accountable member is no longer resolved for that occurrence revision/date. Delayed valid reports for current or past occurrences retain existing outbox/idempotency behavior.
- A group referenced by a Routine revision whose effective interval reaches today or the future cannot be deleted. Once references are historical only, deletion is a current-directory tombstone: stable identity and dated membership remain available to interpret immutable history, while the group disappears from current lists/new selection and its normalized display name may be reused.
- Routine create/revision writes become household-scoped and replay-safe by mutation ID. Group and Routine invalidations must refresh open People & Groups details, compact Routine summaries/pickers, and relevant previews through authoritative reads; events remain hints rather than state.
- P0-004B changes only Morning Routine participation. Groups remain named household sets and never confer authority, choose one member, rotate work, or become eligibility/schedule rules.
- P0-005 generalizes that participation model to every independent routine definition; group edits still flow prospectively to all consuming routines without reopening each editor.

### P0-005 multiple-routine foundation

P0-005 r1-r3 are integrated on `main`; revision 3 is the authoritative accepted contract in `briefs/p0-005-multiple-household-routines.md`. D-020/D-021 retain identity/daypart conventions; D-024–D-026 describe the r3 lifecycle and shell. Older milestone narratives below are historical context where a later decision explicitly refines them.

- Extend the existing routine definition instead of creating Morning/After School/Bedtime types. Remove singleton storage/service assumptions, retain IDs, and use definition identity throughout API, UI, personalization, proposals, and command replay. Occurrence uniqueness already includes definition/date/accountable membership and remains unchanged.
- Shared revisions own name, weekdays, daypart, checklist, and selected direct/group sources. Personal revisions are selected/unique by membership, definition, and date. A proposal owns a definition ID from submission through decision; approval cannot select the household's first routine. Shared item anchors and all cross-resource references remain scoped to the intended routine and household.
- Dayparts are Morning, After school, Evening, Bedtime, Anytime, independent of routine name/type. They order the interim Today view without clock-time locks. Snapshot daypart on occurrences; migration preserves Morning for existing rows. Schedule presets map to per-revision weekday sets.
- New routines begin today if their weekday applies. Shared current-plan saves reconcile unstarted work from today through the next schedule boundary; personal writes remain tomorrow-or-later. Intentional upcoming changes use schedule entries. Current/upcoming summaries resolve the applicable plan and dated group set together.
- Routines uses compact list -> read-first detail -> explicit creation/edit, following existing focused-state/Back/focus conventions. Reuse the people/group picker in the draft without prematurely creating a definition. Today and Household activity render independent occurrences; Personalize/Approvals/preview identify both membership and routine. Async data and drafts must be keyed to selected routine as well as signed-in identity.
- Every consuming routine follows the same group change next household day. Group/person reference projections become collections, and deletion protection considers all active/scheduled intervals. Do not flatten selected groups or widen capability/visibility.
- End (and legacy archive) remove a routine from the active list. New End cancels unstarted today and later plus upcoming schedule entries while retaining started work and history. Legacy archived records keep their recorded tomorrow cutoff (`end_mode=legacy_archive`). Retained canceled/future rows are not actionable. Intersect reference intervals with end/archive cutoff. Ended details/history remain inspectable; new edits/personal changes/approvals are blocked, pending proposals remain auditable/rejectable, and restore is deferred.
- Routine create/revise/archive commands bind replay to household, command, target and payload, with atomic receipt/state writes and stale-state guards. Preserve existing receipt evidence and valid checklist retries; never return a different occurrence/routine's receipt. Extend existing invalidation, reconnect, visibility, and authoritative refresh paths instead of adding a second synchronization system.
- Forward migration after 004 must cover SQLite constraint/table rebuilds and preserve all IDs, references, snapshots, group versions, personal content, reports, receipts, and identities. Add a populated pre-P0-005 fixture alongside the established P0-001 fixture. Unambiguously backfill legacy proposals; preserve unresolved records read-only. Validate foreign keys, post-upgrade writes, semantic idempotency, and backup/isolated restore using disposable data.
- Implement as one vertical brief with migration/service, API/contracts, UI/execution, and evidence checkpoints. No hosted iteration, new infrastructure, ordinary chore model, or full daily dashboard is needed. Detailed deferred Product direction lives in `PRODUCT.md`.

### P0-005 r2 execution-lock contract (implemented)

- An occurrence remains structurally editable until its first committed locking checklist action. Materialization/viewing does not lock it.
- Completing Required/Optional/As-needed or marking As-needed Not needed sets `started_at` monotonically; undo never clears it.
- Locking is per definition × membership × date. Unstarted peers may absorb whole-structure same-date edits; started peers stay frozen.
- Shared revision upserts at the intended household date (default today) without next-free drift. Client Today refresh preserves local structure while a locking first action is still pending in the outbox.
- UI copy describes started vs not-started people in household terms rather than exposing lock IDs.

### P0-005 r3 routine lifecycle and application design (implemented and accepted)

D-024–D-026 and brief revision 3 are integrated on `main` at `31aad37` and technically accepted. Product evaluation produced the P0-006 experience-consolidation direction.

- **Current-plan intervals:** Ordinary Save changes updates applicable unstarted work from household today until the next intentional scheduled boundary, including existing later rows. Shared content versions remain distinct from active schedule entries; preserve started/history references. Past-date structure is not retroactively edited.
- **Upcoming lifecycle:** Ordered future schedule entries with stable identity. Create/edit/move/delete through normal UI; editing retains the chosen date, moving re-resolves vacated/new ranges, deleting makes the predecessor continue until the next remaining boundary. A date collision is recoverable and never silently shifts or overwrites a change.
- **Shared resolver:** Plan selection, recurrence, dated groups, personal composition, preview, cached execution, History, and used-by references agree on schedule-aware selection. Started rows remain visible independently of newer plan eligibility. Compose applicable personal layers even when the shared plan did not change.
- **Storage/replay:** Migration `007_routine_schedule_lifecycle.sql` after 006. Immutable plan content versions behind active schedule selection. Mutation state, affected rows, and receipt commit together; invalidate only after commit.
- **First action and recovery:** Structure identity/obligation/participation validated inside the transaction. Edit/action races preserve committed locks or expose recoverable stale-structure results. Pending local intent and reconnect behavior from r2 are retained.
- **Delete/End:** Delete unused setup only after exhaustive reference checks; materialization/save receipts alone do not block. End cancels unstarted today and later plus upcoming changes, retaining started work and audit (`end_mode`). Legacy archived records keep recorded cutoff (`end_mode=legacy_archive`). No restore.
- **Shell/navigation:** Primary destinations are Today / Plan / Household. Plan is gated by `routine.shared.manage` and opens the Routines list headed **Routines**. Household holds People & Groups, activity, Approvals, and History under existing grants. Personalize remains reachable from Today. Session/outbox/WS owners stay above destinations.
- **Saved destinations (P0-006A):** Path History API routes — `/today`, `/plan`, `/plan/routines/:definitionId`, `/household`, `/household/people`, `/household/people/:membershipId`, `/household/groups/:groupId`. Fastify serves the built SPA `index.html` for non-API GET fallbacks whenever `clientDist` exists (local built serve and production/hosted). Browser Back follows history; in-app Back follows logical parents. Dirty outer drafts guard primary nav, popstate, and `beforeunload`.
- **Calm Household foundation:** Shared warm light tokens/primitives across execution, routine, household, personal, and auth surfaces. Quiet healthy chrome (no Online pill); Account exposes identity, household date/timezone, and Local development indicator when `html[data-app-env=development]`. Transient success toasts (~5s); durable errors/pending/enrollment remain inline.
- **Evidence:** Local `validate:pr` / `validate:rc` plus r3 screenshots under `reports/p0-005-r3-screenshots/`; see `reports/P0-005-r3-build-report.md`. P0-006A r2 screenshots under `reports/p0-006a-r2-screenshots/`.

### P0-006A experience foundation (implemented and accepted)

P0-006A revision 2 consolidates presentation and interaction over the accepted P0-005 domain model without schema/API mutation changes. Contextual routine rules, profile fields, History retention changes, and new responsibility types belong to later slices.

- **Information architecture:** Today / Plan / Household. Plan opens Routines directly under the existing shared-management grant. Responsive phone bottom / wide top nav without remounting session owners.
- **State ownership:** Keep session, identity, WebSocket, authoritative refresh, and checklist outbox lifetimes above the responsive shell.
- **Saved-view identity:** Required URL views reload in Vite and the locally served built SPA. Sign-in resumes intended path subject to grants. Unknown targets show a generic unavailable view.
- **Routine interaction:** Focused Name/When/Who/Steps summary editing; OrderedList drag handle + Move menu for draft steps and Personalize additions-only; Edit primary on detail with Schedule/End/Delete under More.
- **Feedback:** Healthy connectivity is quiet. Offline/pending/rejected stay visible. Acknowledged success uses one toast; enrollment tokens stay in access view.
- **Evidence:** Playwright phone + desktop Chromium (1280×800) + WebKit; see `reports/P0-006A-r2-build-report.md`.

### P0-006B contextual routine applicability

Authoritative contract: `briefs/p0-006b-contextual-routine-applicability.md` **revision 1**, with D-029–D-031.

- **Routes:** `GET`/`PUT /api/v1/school-calendar` (session-scoped). Writes need `household.schedule.manage`, Origin/CSRF, expected version, and mutation-ID replay.
- **Grant:** `household.schedule.manage` on the manager preset; migration `009` backfills it only where `routine.shared.manage` already exists. Active members may read.
- **Sync:** Invalidation resource `school_calendar` (does not bump routine definition versions).
- **Migration:** `009_contextual_routine_applicability.sql` — applicability JSON (Every-time default), calendar editions/years/exceptions, occurrence provenance.
- **Composition:** Compose-then-filter (shared + personal anchors, then applicability). Personal additions survive a filtered shared anchor when their own rule includes them.
- **History isolation:** Past `historyForDate` is snapshot-only; calendar edits do not rewrite prior-date rows. Unstarted Today/future reconcile on calendar save (including school-night predecessors).
- **UI:** Household → School calendar (`/household/school-calendar`); focused step Applicability; Plan dated preview with reasons.

### P0-007A household responsibility foundation (delivered; ACCEPTED)

Authoritative contract: `briefs/p0-007a-household-responsibility-foundation.md` **r1**, D-035–D-037. Base: integrated `main` **409d147**; READY review `7226987`, implementation authorization `a6890cc`, accepted implementation **bb21d74**, merged via PR #15 at **51322e0**. Migrations 011-013, responsibility APIs/client, mixed views and acknowledged activity clear are integrated. Final evidence is in `reports/P0-007A-r1-architecture-reacceptance.md`; acceptance independently verified `npm test` 168/168 and recorded Engineering PR/RC/Vite gates. First of three slices; the planned B delta follows below.

- **Vertical outcome:** Fixed-owner daily Cats and weekly Trash through Plan, mixed Today execution, compact Household activity and existing History. Pattern assignment and Kitchen/Bathroom scheduled additions follow in B; fuller daily prioritization follows in C. Minimum execution/History integration belongs to A so it can be evaluated independently.
- **Shared foundations, different cardinality:** Extend existing definition/revision/schedule and occurrence/step/report/receipt storage with immutable routine/responsibility kind. Legacy SQL names may remain. Routine uniqueness stays per definition/date/member; responsibility uniqueness is per definition/date independent of owner, enforced in SQLite. Reuse date/plan/lock/completion, outbox and WS machinery; keep kind-aware resolution and routine-only personal/group-audience paths explicit.
- **Assignment/lifecycle:** One fixed same-household membership, including pending-access people; weekdays plus existing dayparts; base checklist only. Unstarted owner changes update the same occurrence. First committed action locks both structure and owner. Reuse current-plan ranges and intentional upcoming lifecycle, with Delete unused versus End retained work. Seven-day preview is read-only and accounts for protected stored work.
- **Authority/execution facts:** Planned `responsibility.manage` / `responsibility.execute.own` grants backfill once from corresponding routine grants and are added to applicable presets. Management cannot execute another owner. Responsibility reports retain separate accountable, actor and performer identities; legacy performer is unknown. Responsibility commands include intended structure and bind replay to authenticated scope/target/generation.
- **Integration:** Plan groups routines/responsibilities with kind-specific management; `/plan/responsibilities/:definitionId` complements existing saved URLs. Today reuses daypart order/checklist, Household activity uses compact responsibility summaries/detail, and stored History authorizes per kind. Existing personal tasks remain separate. New mutations extend existing invalidation/reconnect/visibility paths and dirty-draft protection.
- **Reset compatibility:** Explicitly acknowledged **Clear activity history** covers routines and responsibilities under the shared generation/floor, retaining all setup. An old routine-only request cannot erase responsibility configuration/activity's execution evidence without updated confirmation. Keep existing grant/environment gates and replay compatibility; test reset on disposable data only.
- **Engineering evidence:** Forward migrations after 010, populated 010 upgrade alongside older baselines, reference/receipt audit including fixture cleanup, kind/authority/cardinality/race tests and real UI Cats/Trash journeys. Use exact local PR/RC/Vite gates and new `reports/p0-007a-r1-screenshots/` only. No new service or hosting dependency.

### P0-007B assignment patterns and scheduled work (implemented; ACCEPTED)

Authoritative contract: `briefs/p0-007b-assignment-patterns-scheduled-work.md` **r1**, D-038-D-040. Historical baseline: merged A at **51322e0**; implementation branch was `brief/p0-007b-assignment-patterns-scheduled-work`. B is now integrated in inspected `main` at **e8f59b4**. Migration **014**, shared assignment/composition resolver, draft preview, Unassigned storage, and Kitchen/Bathroom/Cats/Trash UI journeys are implemented; Build Report is `reports/P0-007B-r1-build-report.md`. Architecture re-accepted r1 after AT2, AT7, and AT9–15 B-specific evidence closed; details: `reports/P0-007B-r1-architecture-reacceptance.md`. Product acceptance remains separate; the revised C handoff uses A/B as its foundation.

- **Bounded outcome:** Kitchen weekly turns and Saturday Deep Clean, Cats rotation, Bathroom composition, and unchanged fixed Trash. Reuse shared plan/execution foundations. C owns the full Today/Household hierarchy.
- **Assignment:** Closed fixed/cyclic/seven-day-weekly forms, explicit people or one linked group minus exclusions. Cycles count applicable household dates from a saved anchor. Group changes remain next-day and reconcile unstarted responsibility rows.
- **Composition:** Versioned named additions with weekdays, steps and inherited/fixed/cyclic ownership. One owner-setting addition owns the whole day; overlapping owner-setting weekdays are rejected.
- **Read/lock boundary:** Shared dated resolver feeds saved/draft previews, materialization, reconciliation and first-action `structure_fingerprint` checks. Preview has no writes.
- **Unassigned:** Nullable accountability only for unstarted responsibilities; Plan/Household/History visibility; no personal executor until repaired.
- **Evidence:** Populated through-013 fixture upgrades through 014; new screenshots only under `reports/p0-007b-r1-screenshots/`. Exact local PR/RC/Vite gates required.

### P0-007C-1 actionable Today and Household overview (implemented; ACCEPTED)

Authoritative contract: `briefs/p0-007c-1-actionable-today-household-overview.md` **r1**, D-041-D-042. Architecture accepted r1 after the corrected AT6 four-owner Chromium/WebKit evidence; it is integrated via PR **#20** at **ef39a89**. Its pre-implementation baseline was **e8f59b4**. Product evaluation remains separate.

- **Bounded projection:** Today derives Completed / Next / Later / Anytime from authorized own reconciled occurrences and personal tasks. Prefer in-progress scheduled work for Next, then existing daypart order; no clock windows, synthetic task deadlines or new persisted work model. One expanded checklist, stable manual focus, pending-action retention and generation-aware reset recovery reuse existing state owners.
- **Snapshot-aware oversight:** Household landing summarizes responsibilities individually and routines per definition/date with represented-person completion counts. Drill-down preserves per-person stored variants; live groups/plans cannot rewrite counts or detail. Keep existing per-kind grants, private-task filtering, Unassigned restrictions and read-only oversight.
- **UI boundaries:** Today / Plan / Household, saved routes, secondary management navigation and dirty editors survive. Use existing Calm Household styles and friendly copy. No Plan rewrite, new router, grant, migration, display principal or shared-device execution is expected in C-1.
- **Evidence routing:** Local PR/RC/Vite gates remain required. Thematic Actions job `E2E · Phone P0-007C-1` greps `P0-007C-1` (alongside pre-007/A/B); desktop allowlist includes `z-p0-007c-1-geometry.spec.ts`. Preserve the `Pull-request validation` aggregate check. New screenshots are local-only under `reports/_local-screenshots/p0-007c-1-r1/`; reports/test assertions remain tracked. Historical screenshot references map through `reports/README.md`.
- **Remaining approved sequence:** C-2 defines manager-enrolled/revocable non-human display identity plus a restricted, privacy-filtered, read-only By person/By work dashboard with household date/time. C-3 adds shared-device execution with truthful actor/ownership, recoverable sync/outbox behavior and independent personal-task promotion. Six-person 4K layout and real 27-inch/10-16-foot Product evaluation belong to the display slices. No new Product resubmission is required; each receives a separate brief/readiness before implementation.

### P0-007C-2 Household Display and read-only dashboard (FIX REQUIRED)

Authoritative contract: `briefs/p0-007c-2-household-display-read-only-dashboard.md` **revision 1**, D-043-D-045. Baseline: integrated C-1 at **ef39a89**. Engineering readiness is **READY**. After reviewing implementation commit **a2b9e42** and its Build Report, Architecture returned **FIX REQUIRED** on 2026-09-25. The same-revision correction and acceptance are pending on `brief/p0-007c-2-household-display-read-only-dashboard`.

- **Separate device identity:** A Household Display belongs to a household, never to family order, assignment or a fabricated member. New `household.display.manage` authority is added to the manager preset and backfilled once from existing `household.member.enroll` holders. Manager setup/revoke lives at `/household/displays`; display enrollment and the restricted wall live at `/display`.
- **Enrollment/session boundary:** One-use 80-bit Base32 setup codes expire after ten minutes and are stored as digests. Claims and management commands are atomic, scoped, versioned and replay-safe without plaintext secret receipts. Separate opaque display sessions use hosted `__Host-hd_display` / local `hd_dev_display`, persistent HttpOnly cookies, 90-day inactivity and 365-day absolute expiry. Replacement access invalidates its predecessor on successful redemption; explicit revocation invalidates access and pending claims immediately. Human session/outbox behavior remains unchanged; no member impersonation or credential fallback.
- **Explicit read interfaces:** Dedicated display session/dashboard/person/occurrence/WS endpoints return allowlisted friendly identity, current-day work and progress only. Profile/access secrets, audit records and private personal work never enter display responses/events. Existing household-visible personal tasks appear in person detail only; all remain unpromoted until C-3. C-1 human task visibility is unchanged.
- **One source of current-day truth:** Extract the existing household-date materialization core narrowly behind separately authorized readers, without manufacturing a member AuthContext. An unattended display read can perform normal system-owned current-day snapshot creation/reconciliation; it cannot execute/lock work, consume turns, change configuration or generate arbitrary historical/future dates. Preserve assignment/addition composition, started survivors, applicability, Unassigned, stable identity and activity generation/floor. History stays stored-only.
- **Wall presentation:** Default By person in family order; alternate By work; focused read-only touch detail and a 90-second user-idle return. Household date/time derives from authoritative server time and household timezone. Six-person 27-inch/4K evidence includes native and scaled geometry; actual readability at ten and sixteen feet is separately evaluated by the Project Lead. No normal application navigation, administrative controls or checklist actions appear on the wall.
- **Authorization-aware recovery:** Separate sanitized invalidations with targeted session revocation; check display access on WS upgrade, before sending and at least every 30 seconds. Client refreshes on events/reconnect/visibility and at least every 30 seconds while visible. No durable household payload cache. Offline in-memory data is explicitly stale and blanks within 60 seconds of its last authorized refresh; late replies cannot extend the lease or restore revoked/reset data. Scope, request, date and activity-generation arbitration protect overview and detail.
- **Evidence routing:** Local script `npm run test:e2e:chromium:phone:007c2` greps `P0-007C-2`. Thematic Actions job `E2E · Phone P0-007C-2` is required by the `Pull-request validation` aggregate. Desktop allowlist includes `z-p0-007c-2-geometry.spec.ts`; `chromium-display` runs the same geometry at 3840×2160. Vite deep-link smoke includes `/display`. Screenshots remain ignored under `reports/_local-screenshots/p0-007c-2-r1/`; readiness/Build Reports and test assertions are tracked.
- **Remaining boundary:** Shared-display checklist execution, truthful device action provenance and owner-controlled personal-work promotion belong to C-3. Do not add their schema/UI or treat C-2 as completion of the full interactive Product outcome.
- **Acceptance gaps:** Preserve the earlier P0-007B screenshot archive; prevent `/display` sessions from mounting the member App at direct personal URLs; add the required route-denial matrix and close AT1-15's named evidence gaps described in the brief. AT17 at-distance readability remains Project Lead evaluation.

### P0-006C profiles and useful History (technically accepted)

Authoritative contract: `briefs/p0-006c-household-profiles-useful-history.md` **revision 1**, with D-032-D-034. Baseline was integrated `main` at `de552ab`; r1 implementation is technically accepted at `e8a93d5` after the AT4 UI-save evidence correction. Required local PR/RC/Vite gates pass. Project Lead acceptance of the connected experience remains separate; no hosted deployment is required for this slice.

- **Profile boundary:** Extend household membership with optional full name, birthday, and contact email; retain `display_name` as friendly name. Unknown facts stay unset on migration. Existing structure/access capabilities remain separate; no email authentication or age-derived authority. Read full profile facts in focused detail, not bulk lists/events.
- **Family order:** One versioned, server-backed order of all directory memberships. Preserve the prior alphabetical order initially, append new people, and do not reorder on rename/claim. Reuse focused draft drag/Move controls; save atomically with expected order version and replay receipt. Apply to peer person lists without replacing daypart/queue/checklist order.
- **History query boundary:** Summaries are day -> person -> routine, with stored occurrence/action detail on demand. All History reads become side-effect-free, including today; no missing-date materialization or current-calendar reinterpretation. Retain existing shared-manager History authority, obligation-aware completion, stable actor/accountable identity, and distinct performed/recorded facts. Add saved summary/detail URLs under `/household/history`.
- **Evaluation reset:** Secondary Household Settings/Data & testing action removes only the session household's generated routine occurrence/step/report graph and associated checklist receipt payloads. Keep all identity/access, profile/order, group/dated membership, routine/schedule/lifecycle, personal/proposal, calendar, personal-task, and configuration receipt data. One strong confirmation; no in-app Undo. Backups are not purged by this operation.
- **Authority/availability:** Implemented `household.activity.clear` is in the manager preset and backfilled only from existing `routine.shared.manage`. Enforce grant plus evaluation setting: on by default in development/test, off in hosted unless explicitly enabled with `ALLOW_EVALUATION_HISTORY_CLEAR=1`. Availability is not permission to deploy or clear live data.
- **Reset consistency:** Atomic deletion + activity-generation increment + household-date reset floor + minimal replay/audit record. Same-command retries never erase newer activity. Generation-aware snapshots/outbox/responses prevent old offline intent or late replies from restoring erased work; current/future work rematerializes with fresh IDs, and erased earlier dates cannot regenerate. Normal same-generation pending-card/lock protection stays unchanged.
- **Delivery/evidence:** Forward migrations after 009; populated 009 upgrade and reference inventory; injected rollback/replay/race checks; multi-context reset/reconnect tests; actual touch/keyboard order and phone/desktop History journeys; exact local PR/RC/Vite gates. Test clearing only on isolated fictional/disposable data. Prior screenshots stay unchanged. No hosting or new runtime service is required.

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
- **Local configuration:** copy `.env.example` values into the environment as needed (`DB_PATH`, `BACKUP_DIR`, `HOUSEHOLD_TIMEZONE`, `HOST`, `PORT`, `APP_PROFILE`, `PUBLIC_ORIGIN`, `AUTO_SEED`, `EVAL_LAN_ACCESS`). Development defaults to `AUTO_SEED=0`.
- **Migrate/seed:** `npm run db:migrate` then opt-in `npm run db:seed` (seed creates pending fictional memberships only; hosted profile forbids `AUTO_SEED`).
- **Bootstrap:** `npm run auth:bootstrap` issues one single-use manager claim token (shown once). On an empty database it creates only the minimum household plus that claim — no demo people.
- **Fixture cleanup:** `npm run db:cleanup-fixtures` (dry-run) / `… -- --apply` removes only proven-safe canonical fixture memberships by exact ID; backup-first; never automatic.
- **Backup/restore:** `npm run db:backup`; `npm run db:restore -- path/to/backup.sqlite`. Run backup before applying migrations on populated data.
- **Run/develop:** `npm run dev` (API on `127.0.0.1:8787`, Vite on `127.0.0.1:5173` with `/api/v1` proxy). Login/claim Origin must match the Vite URL (`http://127.0.0.1:5173` by default).
- **Phone on LAN:** `npm run dev:lan` (binds Vite/API for LAN; prints `http://<lan-ip>:5173`). With `EVAL_LAN_ACCESS=1`, claim/login also accept other private/loopback HTTP Origins so a mismatched NIC IP does not block the phone. Not for public internet exposure.
- **Build/package:** `npm run build`.
- **Test:** `npm test` for unit/integration tests. `npm run test:e2e` installs Playwright Chromium + WebKit for the locked `@playwright/test` version (browser binaries are not shipped by `npm ci`), runs the suite against isolated Chromium/WebKit production SPA servers, then runs `npm run test:e2e:vite` (Vite-dev deep-link smoke on free ports via `playwright.vite.config.ts`; optional `VITE_API_PROXY_TARGET` overrides the Vite `/api/v1` proxy target). Chromium-only: `npm run test:e2e:chromium` (includes the Vite smoke).
- **Lint/typecheck/validate:** `npm run lint`, `npm run typecheck`, and aggregate `npm run validate`.
- **Pull-request validation:** `npm run validate:pr` (validate + build + Chromium e2e + Vite deep-link smoke). GitHub Actions (`.github/workflows/validate-pr.yml`) runs the same gates as thematic jobs so the Actions UI shows separate sections: `Checks · Lint & typecheck`, `Checks · Unit & integration`, `Build · Production`, then parallel e2e jobs (`E2E · Phone core (pre-P0-007)`, `E2E · Phone P0-007A`, `E2E · Phone P0-007B`, `E2E · Phone P0-007C-1`, `E2E · Phone P0-007C-2`, `E2E · Desktop geometry`, `E2E · Vite deep-link`). Chromium shards download the production `dist/` artifact and set `E2E_SKIP_BUILD=1`. Desktop geometry also runs `chromium-display` (3840×2160) for C-2 wall evidence. A final `Pull-request validation` job aggregates all thematic results for a single merge gate. Failed e2e jobs upload per-shard `test-results/` / `playwright-report/` artifacts.
- **Release-candidate validation:** `npm run validate:rc` (validate + build + Chromium + WebKit e2e + Vite deep-link smoke).
- **Preview or production-like run:** `npm run start` after `npm run build` (serves `dist/client` from the Fastify process). Hosted packaging notes: `docs/ops-deploy.md`.
- **Protected contracts:** `docs/protected-behaviors.md` (catalog, sync matrix, escaped-defect rule). Route policy: `src/server/route-policy.ts`.

Playwright note: if browser launch fails instantly or the suite hangs after marking tests failed, run `npx playwright install chromium webkit` once (or use `npm run test:e2e`, which does this automatically) so binaries match the lockfile’s Playwright revision.

Local development uses `APP_PROFILE=development` with authentication enabled. Demo fixtures are opt-in (`AUTO_SEED=1` or `npm run db:seed`). Hosted mode (`APP_PROFILE=hosted`) requires `PUBLIC_ORIGIN=https://…`, persistent `DB_PATH`/`BACKUP_DIR`, and rejects evaluation bypass flags.

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

1. **Today client:** Requests the current member's household-local day, presents all applicable routines ordered by daypart, applies checklist intent immediately, and keeps pending mutations durable in an IndexedDB outbox.
2. **Routines and history client:** Lets an evaluation parent list, create, edit, and archive named household routines; inspect read-first detail; and review occurrence history keyed by routine and accountable member.
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
Group-backed materialization -> resolve dated direct/group sources -> one unique accountable membership each
```

## Interfaces and contracts

- **User interfaces:** The current app provides sign-in/sign-out, phone-first Today, household status, narrow enrollment, a shared routine editor, occurrence history, personal routine settings/preview, personal tasks, pending approvals, and visible connection/pending state. Touch targets and status communication must remain usable without color as the sole cue.
- **APIs/events/files:** JSON endpoints live under `/api/v1`. The synchronization endpoint lives under `/api/v1/sync`. Request and response schemas are defined once in `src/shared` and validated at the server boundary.
- **Mutation semantics:** Checklist writes are idempotent `set status` commands, never retry-sensitive toggles. Every client mutation has a globally unique mutation ID. Replaying the same ID returns the original committed result without creating a second execution record.
- **Routine source semantics (implemented P0-004B):** A routine revision retains direct-membership and group selections separately. At least one source is required, but an empty selected group is valid. Resolution is household/date scoped and produces each membership at most once.
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
- **Definition/occurrence boundary:** A definition has stable identity; occurrences snapshot title, daypart, accountable member and checklist semantics. r2 may upsert a same-date revision and refresh unstarted rows; started structure is protected. Planned D-024 requires immutable content references plus active schedule selection, governed-range reconciliation, and preserved past-date history.
- **Participation boundary:** D-018 group member-set changes remain next-household-day. D-023/D-024 refine P0-004B's original no-recomposition rule: shared plans may reconcile eligible current/future unstarted work, while started and historical evidence remains protected.
- **Shared/personal composition:** Each surviving shared item keeps its logical ID. Personal layers own only additions and anchor/order metadata. Compose the effective shared plan and member layer for the occurrence date with `shared|personal` provenance; a retired anchor falls back to the end in stable personal order. D-023/D-024 allow whole-structure recomposition of eligible unstarted work and preserve started/history copies.
- **Checklist meanings:** Template and occurrence steps use the closed P0-001 set `required`, `as_needed`, and `optional`. `required` must be complete; `as_needed` must be complete or explicitly marked not needed; `optional` never blocks occurrence completion.
- **Assignment/execution facts:** The occurrence stores the originally accountable member. A step report stores the acting member, claimed performance instant, server record instant, and resulting state separately. P0-001 exposes only self-execution, but the representation must not collapse these facts.
- **Scheduling:** P0-001 supports selected ISO weekdays for one Morning time anchor. The rule is stored on each routine revision. A household date must never be inferred from the viewer device's timezone.
- **Time:** Every household has one explicit IANA timezone. Calendar dates use `YYYY-MM-DD`; instants cross boundaries as UTC ISO-8601 strings ending in `Z`. Time calculations live behind one domain module and are covered around midnight and daylight-saving transitions.
- **State ownership:** The server assigns occurrence versions and `recordedAt`. The client may supply `performedAt` for queued work, but the server validates shape and retains its independent record time.
- **Persistence/retention:** Preserve protected occurrences, execution reports and personal/proposal audit. Implemented D-025 permits deletion of unused routine setup and End for retained work; broader household export/retention remains TBD. Chore debt is not generated.
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
- Integration-test migrations against temporary SQLite databases, idempotent materialization, replay, authority, and immutable started/history records. r3 must also prove governed-range reconciliation of unstarted work and the explicit upcoming/Delete/End lifecycle.
- Browser-test phone-sized Chromium and WebKit flows with Playwright, including three rapid step actions, delayed responses, a transient disconnect/reconnect, and two independent browser contexts receiving shared updates.
- P0-002 adds integration coverage for credential hashing/login throttling, bootstrap/enrollment single use, hashed session expiry/revocation/CSRF, household isolation, every capability path, personal-layer composition, proposal decision idempotency/audit, personal-task visibility, migration of a populated P0-001 fixture, and client-outbox identity isolation.
- P0-002 browser evidence uses six distinct accounts and at least two concurrent contexts; it covers direct personalization, restricted proposal/approval, prospective preview, parent navigation, private/household personal tasks, and direct-API authorization failures without relying on hidden controls.
- P0-004B supplies migration/domain/integration evidence for dated group membership, source-preserving unique audience resolution, future-row exclusion without snapshot destruction, future/status authorization, replay-safe Routine saves, referenced-group deletion, and realtime recovery. Its Product journey runs through the normal phone-width UI in Chromium and WebKit.
- P0-005 must extend that evidence across multiple definitions, personal layers/proposals, independent completion/schedules, replay target isolation, archive cutoffs/reference release, migrated populated P0-004B data, and late client responses across routine selection. The automated phone journey creates After School and Bedtime alongside migrated Morning and verifies independent execution. Controlled dates/disposable fixtures support weekday/weekend/prospective evidence locally; no waiting overnight or hosted test loop.
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
- **Schema evolution:** Migrate storage forward. r3 separates immutable plan content from active schedule entries; preserve historical structure while reconciling eligible unstarted work.
- **Commands:** Prefer desired-state commands (`set completed`) over toggles so retries are idempotent.
- **Authority:** Model capabilities as explicit grants on household membership, independently from age and assignment. P0-001's two embedded capability sets are a migration source, not the target representation.
- **Truth boundaries:** Shared server state is authoritative; client outbox entries are pending intent; sync events are invalidation/reconciliation hints.
- **Identity model:** A login user and a household membership are different IDs. Household display name, authority, assignment, and personal routine ownership refer to membership; credential/session lifecycle refers to user.
- **Personalization:** Shared item IDs are stable logical references; revision rows and occurrence-step rows are snapshots. Personal additions have their own stable IDs and must not duplicate shared item content into a detached full routine.
- **Routine audiences:** Preserve selected direct memberships and groups as stable revision sources; resolve dated membership by ID and deduplicate only in the derived participant set. Group membership affects responsibility prospectively and never grants authority.
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
