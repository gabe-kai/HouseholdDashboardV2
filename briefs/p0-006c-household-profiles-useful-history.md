# BRIEF P0-006C - Household Profiles and Useful History

**Revision:** 1
**Status:** ACCEPTED

Architecture technical acceptance and Project Lead acceptance of the experience are separate. This file is the one authoritative implementation contract for P0-006C; material contract changes increment its revision.

## Why

The household can now use contextual routines, but people still look like account records and History expands every checklist. Complete the third slice of the approved P0-006 proposal: recognize the family by their everyday names and order, understand a household day quickly, and clear evaluation routine activity without rebuilding household setup.

Source: Planning & Design's supplied **P0-006 - Household Experience Consolidation & Contextual Routines** proposal, preserved in `PRODUCT.md`, and Architecture's A/B/C decomposition. No new Product proposal is needed. This brief completes the profiles/history part; it does not start the later responsibility domains.

## Learning question

Can a parent recognize the family directory at a glance, understand yesterday's recorded work in seconds, and confidently restart routine evaluation while retaining the household they configured?

## Player experience

Open Household -> People & Groups, choose a person, and edit their friendly name, full name, birthday, and optional email. Everyday views use the friendly name. Reorder the family with a finger or keyboard and save once. Children still sign in through the existing enrollment and login flow without email.

Open Household -> History, choose a day, and scan people with compact routine summaries. Open one routine for its recorded checklist and action evidence; Back returns to the same day and filters. In the secondary Data & testing area, an authorized manager can confirm one clear action. Recorded routine activity disappears, current work can start fresh, and people, access, groups, routines, personalization, calendars, and other configuration remain.

## Project card

**Card title:** Recognize the family and understand its day

**Suggested column:** Up Next

**Player-facing goal:** Use familiar family names and order, read a day's work at a glance, and clear test routine activity without rebuilding the household.

**Done when:** A parent can edit and reorder household profiles, inspect a summarized day and its evidence, and clear routine evaluation activity while household setup remains usable on another signed-in device.

**Tracking relationship:** Third and final slice of the approved P0-006 proposal. Implementation -> In Progress; technical acceptance -> Ready to Evaluate; Project Lead acceptance -> Accepted. No external board is currently configured.

## Current system

Inspected baseline: integrated `main` at `de552ab`, the PR #13 merge of technically accepted P0-006B r1. A is integrated and Project Lead-accepted. The Project Lead exercised B calendar/year/exception setup and authorized proceeding; that observation does not claim exhaustive manual acceptance. Existing uncommitted changes in `ARCHITECTURE.md`, `PROJECT_STATE.md`, and `ROADMAP.md` were Architecture's merge-state writeback; this planning change incorporates them. No production source changes are part of this handoff.

- `household_memberships` is the household-person identity, with nullable `user_id`, `display_name`, classification, access state, and optimistic `version`. `users` owns login identity separately. `members` remains a compatibility table referenced by older schema. There are no full-name, birthday, email, or family-order fields. `Store.listMemberships` currently sorts by `display_name`.
- `PeopleGroups.tsx` has focused directory/detail/edit/access states. `household.structure.manage` controls person edits; `household.member.enroll` separately controls setup. Claiming an existing person updates their display name and access, so profile/order preservation must cover claim as well as ordinary edits. `OrderedList.tsx` already supports draft reorder through drag and a Move menu.
- `App.tsx` owns session, sync, supporting reads, and the IndexedDB checklist outbox above destinations. `nav.ts` supports saved person/group/routine/calendar URLs; History is still a local Household leaf. `HistoryView` fetches one date and expands every returned occurrence's steps.
- `GET /api/v1/history` and `Store.historyForDate` require `routine.shared.manage`. Past dates use stored snapshots; today/future still call `materializeForDate`. `getOccurrenceView` joins the current membership display name, while the occurrence retains accountable identity, title, daypart, steps, lock, and applicability provenance. A presentation rename is not a stored historical-name fact.
- `step_reports` stores occurrence/step, accountable and acting memberships, claimed `performed_at`, server `recorded_at`, and resulting state. `mutation_receipts` holds checklist response JSON without a household/occurrence foreign key. It is distinct from routine, structure, calendar, and personal-task receipts. There is no normal History action-evidence endpoint or activity-clear operation.
- Migration `009` is the latest. Routine schedule entries/content versions, dated groups, calendar editions, personal layers/proposals, started locks, and separate personal tasks already exist. `completion.ts` treats Required, As needed, and Optional differently; a raw completed-step fraction is not the definition of routine completion.
- Durable outbox items can contain an `occurrenceSnapshot`. `retainPendingOmittedOccurrences` intentionally keeps pending cards omitted by the server, even across reload. Existing identity/request-generation guards do not represent an explicit household history reset.
- Exact validation scripts include local built-browser and Vite evidence. `validate:pr` runs Chromium phone plus selected desktop specs; `validate:rc` adds WebKit. New C desktop specs must actually be included in the desktop project, not merely described as desktop coverage.

## Behavioral contract

### 1. Household profiles retain identity and authority

- Extend the existing membership, without creating a second person identity. Keep `displayName` as the friendly household name and label it **Friendly name**. It remains required under the current trimmed 1-80 character limit. Add optional full name, birthday, and email; unset values are honestly shown as not set. Migration preserves the existing display name and leaves the new facts unset rather than guessing a legal/full name or birthday. New people can still be created with friendly name and classification alone.
- Names accept ordinary Unicode and duplicate names. Blank optional values normalize consistently to unset. Birthday is a real calendar date, including leap-day validation, no later than household today; it is never shifted by device timezone. Validate bounded name/email inputs server-side; email is optional contact information, not unique identity, verified contact, login, invitation delivery, or account recovery. No email service or age-derived behavior is added.
- Active household members retain directory/detail reading within their household. Full name, birthday, and email belong in focused person detail, not every directory/sync payload. Profile writes require `household.structure.manage`; keep enrollment authority separate. Being the profile subject, Adult/Child, birthday, or group position grants no extra write or access authority.
- Person detail is read-first and compact, showing available profile information, access, groups, and routine references with explicit Edit/access actions. Use the existing focused draft, Save/Cancel, dirty-leave, toast, inline-error, and conflict patterns. Preserve unsaved fields when another client changes the person; reject stale `expectedVersion` rather than overwriting. Profile update and compatibility-name update commit together. Existing-person enrollment must preserve new profile facts and order; the existing claim's friendly-name choice remains allowed, with profile version/sync updated accordingly.
- Friendly names appear in account identity, Today/Household work, group people, routine audiences/pickers/previews, approvals, and History. Refresh the signed-in account label as well as directory caches. Use full name in detail or to disambiguate when needed, never as a replacement for stable IDs. Changing a name cannot move assignments, personal work, credentials, grants, or action evidence to another person. History resolves current friendly names while retaining original accountable/acting IDs; do not claim a historical name that was never recorded.

### 2. One saved family order

- Store one household-wide order of all directory memberships, including people whose access is not set up. Migration starts with the existing alphabetical order plus a stable ID tie-break; new people append. Editing a name, classification, or access must not move a person. This is household configuration, not browser preference, assignment priority, group membership, or age sorting.
- A secondary **Reorder people** action opens a focused order draft in People & Groups. Reuse the A drag handle/Move menu behavior, immediate draft feedback, cancellation, position announcements, and Save/Cancel. Save once; cancel or discard leaves server order intact. Ordinary save needs no extra confirmation.
- Require `household.structure.manage` and an expected household-order version. The command submits every current household membership ID exactly once, with mutation ID; reject missing, duplicate, unknown, and foreign IDs without partial writes. Version changes cover directory additions and order saves, so a concurrent new person cannot be lost. An identical authorized replay returns its original result; changed payload/household/actor reuse conflicts. Commit ordering/version/receipt atomically; conflicts preserve the draft and offer re-read/review.
- Use saved family order wherever people are peers: directory, group member displays/pickers, direct audience choices/resolved person lists, Household people, and History person groups. Preserve stronger ordering: Today and routines within a History person group retain daypart/routine order; approval queues retain their temporal priority; checklist/personal-addition order is unchanged. A person subset retains its relative family order, not the order IDs happen to arrive. Saved order survives reload, server restart, and another browser.

### 3. History is a summary of recorded routine work

- Household -> History opens a focused summary for household today, with simple previous-day/date navigation and a clear empty state. Support a progressively disclosed date range (inclusive, at most 31 days), person, routine, and Complete/Incomplete filters. Future dates are outside execution History; direct users to routine Preview for future expectations. Defaults require no filter form. Range results are date-descending, then saved family order, then existing daypart/routine ordering. Keep selected day/range/filters when entering detail and returning.
- Show a compact row per stored routine occurrence under day/person headings; do not download/render every step and action report merely to show summaries. Dates with no evidence are empty, not an automatically generated list of missed obligations. All summary/detail/count reads are read-only for past and present: they never materialize, reconcile, repair, or set a lock. Replace the current today/future History materialization behavior deliberately; tests needing generation must use execution/fixture paths. Preserve the existing `date` query as a supported one-day request or update all internal consumers with a documented compatibility mapping.
- Only stored, nonempty, historically visible occurrences contribute. Retain started survivors of End/audience/context changes; exclude canceled unstarted and all-filtered empty rows just as execution projections do. Never re-filter stored history from current recurrence, group membership, or school calendar, and never invent absent work. Ended routines with retained evidence remain filterable and inspectable.
- Compute Complete/Incomplete with the existing obligation rules. Explain progress with accurately labeled counts of completed, Not needed, and open steps; Optional openness must not make a satisfied routine incomplete, and Not needed must not be called completed. Any person/day totals use these same visible records and rules. This slice summarizes routine activity only; personal tasks do not acquire fabricated dated history or wider visibility.
- Detail shows the occurrence's stored title, household date, daypart, ordered steps, obligation/source/applicability evidence, current recorded statuses, and originally accountable person. Provide progressively disclosed action evidence from `step_reports`, including acting person, resulting state, claimed performance time, and server record time; include undo in the audit. Do not infer the performer from the accountable person or claim a completion time when reports are absent. Missing legacy evidence is labeled unavailable. Preserve IDs and stored facts despite later profile, plan, calendar, or group edits.
- Retain `routine.shared.manage` authorization for every History list, count, filter-option, and detail request; no new sibling/self-history permission is implied. Scope by session household before applying supplied IDs. Foreign/missing detail IDs yield generic unavailable behavior without leaking names or counts.
- Addressable History summary/detail lives under `/household/history` using stable occurrence IDs and non-secret filter parameters. Copied URLs, reload, sign-in resume, browser Back/Forward, and integrated in-app Back preserve a useful position in Vite and built local serving. An erased occurrence link becomes an understandable unavailable/cleared view with a path back to History; it must not locate a new occurrence by title/date instead.

### 4. Deliberate evaluation reset with exact retention

- Add a focused **Household -> Settings -> Data & testing** path within the A shell. It needs only real C settings, not placeholders. **Clear routine activity history** is secondary and requires one strong confirmation stating the household-wide scope, including today's progress and other devices' older unsynced routine changes, what remains, and that the app has no Undo. Cancel changes nothing. Disable duplicate submission while awaiting acknowledgement; failure remains actionable and is never announced as success.
- Require a dedicated `household.activity.clear` grant plus existing session/Origin/CSRF validation. Add it to the manager preset; forward migration backfills it only to existing `routine.shared.manage` holders, never from age, structure, enrollment, or calendar-only authority. No grant editor is added. Evaluation availability is a separate server setting: enabled by default in development/test, disabled by default in hosted, with explicit operator opt-in through `ALLOW_EVALUATION_HISTORY_CLEAR=1` for a hosted evaluation. Advertise availability only as harmless metadata; enforce both setting and grant on the server. A disabled setting must deny even a crafted direct request. This does not authorize changing a live hosted configuration.

| Data | Effect of a successful clear in the session household |
| --- | --- |
| All generated routine `occurrences`, including past/today/future, started/completed/canceled/empty rows | Remove with their `occurrence_steps`, `step_reports`, and checklist mutation receipts that contain their activity. |
| People/profile/order, users, credentials, sessions, grants, enrollment claims, compatibility memberships | Preserve. No forced logout, re-enrollment, or profile reset. |
| Groups, dated member sets, tombstones | Preserve. |
| Routine definitions, immutable content versions/steps/audiences, scheduled entries, End/archive/delete state | Preserve exactly; do not resurrect ended/deleted routines or discard an upcoming plan. |
| Personal layers/additions, pending/decided proposals and decision evidence | Preserve; approved personal configuration continues to compose. |
| Calendar editions/years/exceptions, timezone and other configuration | Preserve. |
| Personal tasks, their current status/visibility and receipts | Preserve, including private tasks. They are separate work, outside this routine reset. |
| Structure/routine/calendar/configuration receipts and reset audit/receipts | Preserve command idempotency; do not retain erased step content in a hidden activity copy. |
| Other households, operator backup files, external logs | Unchanged. This is not an account-deletion or backup-erasure feature. |

- Inventory SQL and JSON references before implementing deletion. In particular, `mutation_receipts.response_json` contains erased occurrence snapshots without foreign keys. Delete only the targeted household's checklist receipts, using verified linkage or a forward ownership backfill; do not globally empty receipt tables or guess ownership from display names. Verify foreign-key integrity. Keep a minimal reset record (household, actor, time, generation, counts, command identity), not copies of erased steps/actions. Configuration receipt replay must remain safe after reset and must not rebuild erased activity as a replay side effect.
- Clear the activity graph, advance the household activity generation, record its household-date reset boundary, and persist the reset receipt in one transaction. A failure anywhere leaves all four unchanged. The command carries mutation ID and expected activity generation; recheck current authority and serialize with execution/materialization. Bind replay to household, actor, kind, and payload. A lost response followed by the same command returns the original reset result without deleting activity recorded afterward; a changed or foreign replay conflicts without disclosure. A second intentional reset uses a new command and the current generation.
- After commit, normal Today reads rematerialize applicable work from the preserved plans, dated groups, personal layers, and calendar with fresh occurrence/step IDs and no actions or started locks. Future rows regenerate lazily. Current/future schedule boundaries and End/archive rules still apply. History itself stays read-only; newly generated unstarted work may appear as new records, so clearing does not promise History stays empty while devices are using Today.
- Retain a household-date floor at the latest reset date: no execution/materialization path, including old `?date=` seams, may recreate erased dates before that floor. Pure dated Preview may explain historical plans but must not persist execution evidence. Old IDs never redirect to rematerialized work. A reset racing a valid action has a serial outcome: an action committed before reset is erased; an old-generation action after reset is rejected; a valid action on newly generated work survives. No intermediate partial graph or successful stale receipt may escape.

### 5. Reset-aware outbox and live continuity

- Introduce an explicit monotonically increasing household **activity generation**, initially zero. Execution snapshots/responses and persisted pending commands carry it; authoritative session/Today/History/reset reads expose it, and reset emits a household-scoped invalidation after commit. Return generation and associated data from a consistent read. This is only an execution reset boundary, not a new generic version for all household configuration.
- Validate a step command's generation before any receipt replay or write, together with existing actor/household/occurrence checks. Old-generation requests fail with a distinct recoverable reset reason and create no report/lock/receipt. Do not map them by logical item, title, position, or date to new work. Migration initializes existing households and legacy outbox entries to generation zero; an omitted generation is only compatible with zero before the first reset. A legacy pending command must never silently inherit a newer generation.
- On learning of a newer generation, atomically retire this membership's older pending/retrying/rejected commands and persisted snapshots, clear their optimistic overlays, and re-read current work. Explain visibly that routine history was cleared and older unsynced changes were not applied; allow dismissal. A network omission/calendar filter alone is not evidence of reset: B's pending-omitted-card protection continues within a generation. Never clear another household/membership's outbox or new-generation commands enqueued during recovery.
- Handle an offline child device, reload with old IndexedDB data, missed/duplicate reset events, late pre-reset GET/status responses, and acknowledgement loss. Older results cannot reinstate erased cards, downgrade the known generation, overwrite newer work, or resume rejected retries. Reconnect, online, visibility, and restored-session paths establish current generation before replaying old intent. The initiating browser and another browser converge without a manual reload.
- Extend the existing invalidation/authoritative-refresh paths for profile/order changes, open History summaries/detail, Household activity, and reset settings. All date/person/filter/detail requests remain identity/target/generation guarded. Dirty profile/order drafts survive notifications and expose conflicts. Profile/order edits do not trigger routine structural reconciliation; ordinary saves elsewhere do not masquerade as local success toasts.

## Implementation boundary

- Add forward migration(s) after `009`, shared profile/order/history/reset contracts, minimal server query/command helpers, and a new capability/config flag. Likely touch `src/server/store.ts`, `app.ts`, `config.ts`, `db.ts` as needed, `src/shared/`, and `db/migrations/`. Keep single-process SQLite and existing transaction/replay conventions.
- Extend People & Groups using `OrderedList`, add cohesive History and Data & testing views, and extend `nav.ts`, API adapters, App refresh/outbox ownership, and existing CSS tokens. Module extraction is allowed when directly useful; no application-wide rewrite or new framework is needed.
- Update route-policy completeness, protected behaviors/sync matrix, `.env.example`, and operational documentation for the reset switch, irreversible app behavior, reset boundary, and preserved backups. Update `ARCHITECTURE.md` with verified implementation facts, keeping plans distinct from implemented behavior.
- Deliver as one brief, with internal checkpoints: profile/order migration + UI; read-only History + evidence UI; reset/epoch transaction + recovery; connected local evidence. Do not hand off a backend-only subset as complete.
- Engineering reports: `reports/P0-006C-r1-engineering-readiness.md` and `reports/P0-006C-r1-build-report.md`. New fictional visual evidence only: `reports/p0-006c-r1-screenshots/`. Keep every earlier evidence directory unchanged.

## Do not change

- Preserve P0-001 through P0-006B protected contracts except the explicit read-only History refinement and authorized evaluation reset. In normal operation, locks/undo, history snapshots, governed-range edits, upcoming lifecycle, contextual filtering/School nights, dated groups, personal authority, and first-action outbox protection remain intact.
- No new chores, rotations, helpers/cover, Skip Days, retrospective reporting UI, task/project expansion, external calendar/email service, notifications, age-based permissions, member deletion, departure, multi-household switching, or fully offline first-load/PWA support.
- No self-service credentials/recovery redesign, automatic email enrollment, personal-task history/reset, universal privacy/retention console, scheduled purge, arbitrary date-range deletion, or selective person deletion of activity. This clear is one explicit household-wide routine-evaluation operation.
- No production code from Architecture; Engineering implements only after readiness disposition. No hosted testing/deployment is required. Engineering may test destructive paths only on isolated fictional databases or an explicitly authorized disposable copy, never the Project Lead's live `runtime/dev.sqlite` or hosted household.
- Project Lead manages Git. Suggest a commit message but do not commit, push, merge, delete branches, or deploy.

## Acceptance tests

All rows are required. Integration evidence must exercise the real store/API and durable database, while the user journeys use ordinary UI for the actions under test. Disposable fixtures/clocks may prepare dated activity; no waiting overnight, real family identities, or hosted service is needed.

| AT | Required evidence |
| --- | --- |
| 1. Populated upgrade | A named populated through-009 fixture covers pending/active people, equal display names, claims/grants, dated groups, multiple plans/upcoming/ended routines, personal layers/proposals/tasks, calendar editions, past/started/unstarted/future/empty occurrences, reports, and all receipt families. Forward migrate and reapply: names/IDs/configuration/snapshots/receipts preserved, optional facts unset, deterministic initial order, generation zero, exact new-grant backfill, FK check clean. Keep prior migration suites. |
| 2. Profiles and access | UI edit full/friendly names and birthday, add/remove/omit email, then reload and inspect detail. Server rejects impossible/future birthdays, malformed/oversized fields, and empty friendly name without partial writes. Same-name people remain distinct. A pending person's profile/order survives token claim; existing login/session and email-free child enrollment still work. Birthday/classification never change grants. |
| 3. Profile authority/conflict | HTTP tests deny unauthenticated, foreign, personalizer, and enrollment-only profile writes; structure-only may edit but gains no access-setup authority. Active same-household detail reading works. Two editors prove stale-version rejection with retained UI draft; live friendly name reaches directory, account, audience/group, approval and History labels without a reload. |
| 4. Saved family order | Normal UI saves pointer reorder and keyboard Move-menu reorder; independent browser/restart sees order. Real touch-event evidence in Chromium proves drag persist and cancellation, distinct from mouse at phone width. Verify subset order and stronger daypart/queue order. Cancel leaves persistence untouched. |
| 5. Order command safety | Reject duplicate/missing/foreign IDs, denied grants, concurrent order saves, and concurrent new-person stale saves. New person appends; rename/claim do not reorder. Same-command replay is idempotent; changed target/payload conflicts. Inject failure before receipt commit to prove order/version/receipt rollback. |
| 6. Read-only History | At least two people, multiple routines and dates: day/person grouping, default today, date navigation/range and person/routine/status filters, bounded invalid ranges, and empty results. Snapshot database before/after reads, including absent past/current dates and a future request: no generation, repair, lock, report, or receipt writes. Missing dates never become presumed missed obligations. |
| 7. Honest summaries and evidence | Required complete/open, As needed Not needed, Optional open, mixed/all-optional evaluated steps, canceled/empty omission, undo, and ended/started survivors produce correct statuses/counts. Detail retains step/context facts and separates accountable actor, reported performance and record times. Missing legacy reports are not fabricated. Later name/order/plan/calendar/group edits do not rewrite original execution identity or snapshot. |
| 8. History navigation/isolation | Browser journey summary -> detail -> Back retains day/filters; copied summary/detail URLs reload/resume after sign-in in built SPA and Vite. Denied/foreign/erased occurrence IDs disclose no data. Summary and detail preserve existing History grant; private task data does not enter responses/counts. |
| 9. Clear UI and policy | Normal manager UI enters secondary settings, cancels once with zero effect, then confirms once. Test grant/Origin/CSRF denial, cross-household targeting/replay, and hosted-default-off versus explicit opt-in locally through configuration tests. No actual hosted deployment. No misleading toast on failure or accidental double-submit clear. |
| 10. Exact deletion/retention | Populated two-household DB: clear target household and compare every table/reference category in section 4. Remove execution graph and matching JSON checklist receipts; preserve other household, identities/access, profiles/order, groups/versions, all routine plans/lifecycle/personal/proposals/calendars/tasks and configuration receipts. Minimal reset audit remains without step content; foreign keys stay valid. |
| 11. Clear atomicity/replay/race | Inject failure after execution deletion but before reset receipt commits: graph/generation/floor/receipt all roll back. Lost-response replay does not clear newly recorded work. Mismatched replay and competing expected-generation clears are rejected. Deterministically prove action-before-clear, stale-action-after-clear, and new-action-after-clear outcomes, plus configuration save/materialization interleaving. |
| 12. Rematerialization boundary | Normal Today after clear creates fresh IDs/unstarted applicable work from retained shared/personal/context plans; future scheduled and group changes still apply, ended work stays ended. History does not regenerate it. Attempt all exposed generation paths for an erased date before the reset floor: no old rows/reports return. Old occurrence/step URLs and commands cannot target fresh work. |
| 13. Offline reset browser journey | Multi-context Chromium and WebKit: child queues first action offline with durable snapshot; manager clears through UI; child reconnects and reloads with that durable old outbox, covering interrupted replay. Old intent retires with explanation, ghost card disappears, new current work is actionable, and a new tap commits exactly once. Same-generation B filtered-omission retention still passes. No offline first-load capability is assumed. |
| 14. Late/missed reset recovery | Multi-context browser plus focused deterministic client tests cover a missed reset event followed by visibility/reconnect, delayed pre-reset Today/History/status responses, duplicate events, identity switch, legacy zero-generation outbox, and a new-generation command created during retirement. No downgrade, stale success/retry loop, cross-identity removal, or resurrection. |
| 15. Live connected views | Profile/order saves update another client's open directory/group/audience/History/account without manual reload; relevant checklist writes refresh open History. Reset updates open History detail/summary and Household work, including empty/cleared state; dirty profile/order drafts are retained. Older date/filter/person fetches cannot replace the currently selected result. |
| 16. Product journeys and layout | Phone Chromium/WebKit normal UI covers the proposal's people edit/enrollment/order journey and two-person multi-routine History -> drill-down -> clear -> retained setup -> fresh Today journey. Capture fictional directory, person detail/edit, History summary/detail, and clear confirmation at phone and 1280x800 desktop widths. Include actual desktop project execution, 360px and enlarged-text overflow checks, visible focus, integrated Back, usable targets, keyboard alternative, quiet chrome, and transient save feedback. |
| 17. Gates and handoff | Exact `npm run validate:pr` and `npm run validate:rc` pass including Vite smoke, existing touch/reorder/context/lock/outbox/migration regressions. Extend route inventory and protected/sync catalog for every new mutation/read policy. Map every AT to evidence in the r1 Build Report, distinguish automated/manual/not-run, record base and actual commit state, and show prior screenshot directories unchanged. |

Automated evidence and screenshots support Architecture acceptance. The Project Lead then evaluates familiar names, family ordering, the speed of reading a household day, reset clarity, and phone/desktop coherence. Passing tests do not assert that judgment or physical-device/hosted evidence.

## Dependencies

- Integrated P0-006A r2 and P0-006B r1 at `main` @ `de552ab`, existing Node 24 toolchain and local/LAN path, and the same approved P0-006 proposal. No external service, credentials, or replacement Product proposal is needed.
- Commit the C planning baseline before Engineering implementation. Intended branch: `brief/p0-006c-household-profiles-useful-history`; Project Lead creates/manages it and commits. Preserve existing Architecture integration writebacks in the planning change.
- Engineering first returns one consolidated readiness review of **P0-006C r1**, then waits for Architecture's ACCEPT/PROCEED. No implementation is authorized by this brief's creation alone.

## Relevant decisions

- D-003/D-004/D-006-D-008/D-010/D-011: snapshot/actor facts, durable intent, membership identity, email-free access, personal privacy, local-first evidence.
- D-012-D-016/D-018: person/access separation, explicit grants, focused views, dated groups.
- D-020-D-031: routine identity, completion/lifecycle/locks, responsive saved views, accessible ordering, contextual application and compatibility.
- D-032: membership profiles and household display order.
- D-033: read-only History summaries with recorded evidence.
- D-034: explicit evaluation reset, preserved configuration, and generation-fenced execution.

## Known risks / assumptions

- The reset is the narrowly authorized exception to normal history retention and pending-intent protection; tests must distinguish it from calendar omission, stale responses, and ordinary errors. Missing rows alone never prove reset.
- History can report only stored routine work; the application does not continuously generate every family's past expectations. This brief supplies no backfill of supposed obligations or performance and no personal-task event history.
- Existing JSON receipts, legacy compatibility members, zero-generation browser data, and response races make fresh-database happy-path tests insufficient. Report the actual ownership/reference inventory and reset compatibility strategy.
- Profile details remain household data under existing same-household reading. Email delivery, age display/automation, broader privacy/departure policies, and production retention policy remain future Product work.
- SQL field/table names, server route spellings apart from required user-facing URL families, helper/module organization, and precise concise copy are Engineering choices within this contract. New dependencies require a concrete benefit; existing patterns should suffice.

## Engineering readiness

**Reviewed revision:** 1

**Readiness:** READY

**Architecture disposition:** ACCEPTED. Engineering implemented r1 and closed the AT4 evidence correction. History reads are side-effect-free; clear is household-scoped, generation-fenced, atomic, and replay-safe; family-order Cancel, Move-menu Save, and CDP touch Save all persist correctly through reload. Required local gates pass: `validate:pr` 34/34 Chromium plus Vite, and `validate:rc` 59 Chromium/WebKit plus Vite. Build Report: `reports/P0-006C-r1-build-report.md`. Implementation commit: `e8a93d5`. Hosted deployment is not required for this slice; Project Lead acceptance of the experience remains separate.

## Revision history

- **r1:** Third slice of the approved P0-006 proposal. Extends household profiles and saved family order; makes History a compact read-only view of recorded routine evidence; defines one authorized evaluation reset with exact retention, replay, rematerialization, and pending-command semantics. Local evidence only.
