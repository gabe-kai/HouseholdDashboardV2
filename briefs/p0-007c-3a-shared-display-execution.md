# BRIEF P0-007C-3A - Complete Assigned Work at the Shared Display

**Revision:** 1
**Status:** ACCEPTED

This is the authoritative contract for P0-007C-3A. Engineering reviews this revision against the repository before implementation. Technical acceptance and Product acceptance are separate.

## Why

The enrolled Household Display shows the real household day, but a person who walks up to it cannot yet check off assigned work. This slice closes that daily loop for existing routine and responsibility checklists while keeping the accountable person, the acting device, and any unknown physical performer distinct. It is the execution half of the approved P0-007C-3 outcome; the owner-controlled personal-task promotion half remains P0-007C-3B.

## Learning question

Can family members use one shared screen for ordinary assigned checklists, including a short connection loss, without confusing ownership, losing a tap, or widening the display's access?

## Player experience

From By person or By work, someone opens today's assigned routine or responsibility, taps a large checklist control, and sees immediate pending or saved feedback. For example, a Cats step assigned to Eli remains Eli's work after a wall tap. The display does not ask the tapper to sign in as Eli or claim to know who physically did the work. The same progress appears on Eli's phone and the manager's Household view. If connectivity drops after the display has loaded, a tap remains visibly pending and is retried safely when the same enrolled session reconnects. Invalid or superseded work explains why a pending tap could not be saved.

## Project card

**Card title:** Act at the shared display without losing trust

**Suggested column:** Up Next

**Player-facing goal:** Let family members check off assigned household work at the wall while phones and Household show the same result.

**Done when:** A person can complete today's assigned routine and responsibility steps on the enrolled display; the assigned owner remains clear, progress reaches other devices, and interrupted taps are either saved once or explained.

**Tracking relationship:** First implementation brief under the existing P0-007C-3 outcome card. P0-007C-3B will complete that card's personal-task prominence outcome. Move the card to In Progress when Engineering starts, and to Ready to Evaluate after C-3A technical acceptance for execution evaluation; do not mark the full C-3 outcome Accepted on C-3A alone. No external board is configured.

## Current system

Inspected clean `brief/p0-007c-3a-shared-display-execution` at documentation commit **340f955** before drafting. Its `src/` and migrations inherit the integrated C-2 foundation (`main` merge **739f7e3**, PR **#21**). Planning inspection did not run validation commands.

| Repository evidence | Current fact relevant to this slice |
| --- | --- |
| `src/server/display.ts`, `db/migrations/015_household_displays.sql` | Display identities and digest-backed sessions have household, display and session IDs. The server validates expiry/revocation and supports manager replacement. There is no display execution authority or display CSRF proof yet. |
| `src/server/app.ts`, `src/server/route-policy.ts` | Display routes are GET/WS plus anonymous claim. The only checklist status POST requires a human member session and the member CSRF path. Route policy distinguishes public, member and display principals. |
| `src/server/store.ts`, `src/shared/schemas.ts` | `setStepStatus` checks household, kind, assigned member, grant, generation, date, cancellation, obligation and responsibility structural intent inside a transaction; it writes status, first-action lock, `step_reports` and a mutation receipt. It takes a member `AuthContext`. |
| `db/migrations/001_initial.sql`, `011_household_responsibilities.sql`, `012_responsibility_integrity.sql` | Historical reports require `acting_member_id`; responsibility reports added nullable performer ID. Checklist receipts bind replay to a member actor. A forward schema change is needed for a truthful display actor while preserving existing reports and receipt ownership. |
| `src/server/display.ts`, `src/client/display-api.ts`, `src/client/DisplayApp.tsx` | Allowlisted current-day occurrence detail carries ordered steps/status but not an executable structural intent. The wall has restricted read-only detail, sanitized WS invalidation, refresh/reconnect, a 60-second stale-data bound and no household-payload cache. |
| `src/client/outbox.ts` | The durable checklist outbox is keyed by human membership and can retain an occurrence snapshot. It must not be reused as-is for a shared display or persist wall household content. |
| `docs/protected-behaviors.md`, CI scripts/workflow | PB-49–51 protect display identity/privacy/revocation. Local PR/RC, Vite and thematic Playwright gates exist; C-3A execution needs its own selected evidence. |

## Behavioral contract

1. **Narrow display execution authority.** Add one dedicated display-principal status command for a step on an occurrence returned by the current-day display projection (suggested route: `POST /api/v1/display/occurrences/:occurrenceId/steps/:stepId/status`). An active display session may set an allowed desired status on existing assigned routine or responsibility work for its own household's *current household date*. It may not create assignments, choose an actor/member, complete personal tasks, access member status routes, edit plans, use management APIs, or operate on historical/future/foreign/filtered-out/canceled work. Unassigned responsibilities require manager assignment first. A currently assigned membership need not have enrolled app access; the wall's explicit scope is independent of that person's human grants. The server derives the owner and work kind from stored occurrence state, not request claims or a fake member context.
2. **Use the existing checklist rules atomically.** Share the current obligation/status, first-action lock, generation, date, ended/started-survivor, assignment, and structural race rules between member and display writes. A display read supplies only the structural intent needed for a safe first action; the server verifies it against current stored work in the write transaction for both routines and responsibilities. If a plan edit wins first, a stale wall tap is rejected with refresh guidance. If the tap wins first, the person's started structure and owner remain fixed. Undo/open never unlocks a started occurrence. Preserve distinct per-person routine occurrences and one-owner responsibility cardinality.
3. **Record truthful execution facts.** A committed wall action retains the stored `accountable_member_id`; its action principal is the display identity/session, not an `acting_member_id`. Physical performer is unknown and must not be inferred from the accountable person or device. Record the desired state, receipt identity, submitted time if used, and authoritative server recording time so existing History and reset semantics remain interpretable. Existing human reports and responses keep their meaning. A display response may acknowledge the resulting current-day state but must not expose the raw report/audit row or broaden the C-2 field allowlist.
4. **Separate write protection and replay identity.** Display writes require the active display cookie, a permitted same-origin `Origin` and a display-session-bound CSRF proof obtained after session validation and kept only in memory; no human CSRF token or member cookie can authorize them. Strictly validate the command, including mutation ID, intended occurrence/step/kind/date, activity generation, desired status and structural intent. One mutation ID applies at most once. A retry from the *same active display session* with the same command returns the prior result; reusing it with another payload, session, principal or household conflicts without changing work. Recheck active session and generation *inside the write transaction* before applying or replaying a receipt. Server-side revoke/replace and an in-flight write serialize: a write committed before revoke remains a fact, while a write that reaches transaction authorization after revoke cannot commit.
5. **Durable, bounded pending intent.** On a loaded authorized display, a tap gives immediate feedback and enters a display-specific IndexedDB outbox before transmission. Store only the minimum command data and session binding needed to replay it; do not persist names, step text, full occurrence snapshots, display credentials or household read payloads. The outbox is isolated from all member outboxes and from other display sessions/households. Rapid taps and retry preserve desired-state ordering for a step and cannot turn one tap into multiple reports. Pending/retrying/rejected states are visible and recover from ordinary page reload, server restart and transient disconnect after load. A cold offline load does not reveal a cached dashboard or offer new work.
6. **Freshness and recovery govern actions.** Keep C-2's no-store reads, authorization-first mount, 60-second stale-data blanking, date/generation arbitration, idle return and sanitized display sync. While a previously authorized view is visible but disconnected, actions can queue only within that authorized stale window; after blanking, no new checklist actions are offered. Before replay, revalidate the same display session and authoritative current day/generation/structure. A revoked, expired or replaced session retires its pending queue without replay under a new credential; access-loss clears displayed household state. Activity clear retires prior-generation commands; a household-date rollover cannot newly apply yesterday's pending tap to today's work. Explain rejected/retired pending work without silently claiming it was saved. A previously committed command whose response was lost may resolve by its bound receipt after reauthorization of the same session.
7. **Convergent, focused UI.** Replace the C-2 read-only explanation with large touch and keyboard-operable status controls in focused occurrence detail reached from both By person and By work, with the accountable person's friendly name visible. Use the existing meanings of Done, Not needed and Open; Not needed remains subject to obligation rules. Pending/saved/error feedback is concise, text as well as color, and does not obscure the household date/time. The 90-second detail idle return cannot conceal unresolved commands; show their state and a way back to them from overview. Keep private tasks out of all display responses and keep household-visible personal tasks inspectable but non-executable in person detail. A committed wall action invalidates human Today/Household and other display views; reconnect, visibility and polling recover missed notifications without a page reload.

## Implementation boundary

- Forward migration after 015 for typed display actor provenance and replay-safe checklist receipts; preserve populated reports and scoped activity-clear cleanup. Do not rewrite historical human actions into display actions. Reuse the existing occurrence/status transaction and current-day display resolver through a principal-aware service boundary, rather than duplicating checklist rules.
- Add the dedicated display status route, display-specific Origin/CSRF guard and route-policy entry. Keep the member status route and member grant semantics intact. Update `docs/protected-behaviors.md` and the sync matrix for execution, replay, reset and revocation.
- Add a display-only minimal intent queue and focused checklist controls to the existing `/display` shell. Reuse current display refresh/invalidation/freshness handling, extending it for pending and committed actions without a durable household-payload cache.
- Add integration and multi-context browser evidence, including a populated through-015 migration fixture, local PR/RC and Vite gates, explicit C-3A CI selection, and representative 4K/phone geometry checks. Keep generated screenshots in the existing ignored local evidence area. No hosted deploy is required for implementation acceptance.

## Do not change

- The C-2 device identity, enrollment/revoke lifecycle, privacy-filtered read projection, 60-second stale bound and human/display route isolation; member sessions must not become display sessions.
- Existing routine/responsibility assignment, contextual applicability, structural lock, owner/performer separation, History snapshot and activity-clear contracts. No retrospective completion or transfer of accountability.
- Human checklist outbox behavior, personal-task ownership/status, Only me/Household visibility, and C-1 Today/Household navigation. Personal-task promotion and any wall personal-task completion belong to later reviewed work.
- Display administration, approvals, plan edits, helper/Cover/Claim, swaps, project/homework features or a general kiosk platform. No actual household identities/secrets in fixtures, reports or screenshots.

## Acceptance tests

1. **Populated upgrade:** A disposable database through 015 with human routine/responsibility reports, receipts, display enrollment and pending task visibility migrates forward. Old actor/owner facts and sessions remain valid; migration is repeatable and `npm run db:migrate` preserves data. New display report/receipt rows have unambiguous actor class and household linkage.
2. **Authorization matrix:** A display-only cookie can write only through the dedicated display status route; a human-only cookie cannot use that route. With both cookies, display mode cannot inherit human authority. Missing/foreign Origin, missing/wrong display CSRF proof, revoked/expired/replaced display session, foreign household IDs, arbitrary dates and member-only/admin/personal-task write routes fail without changing state or leaking private task information.
3. **Routine journey:** In a normal display UI, open one person's applicable routine, complete one step and mark an eligible item Not needed. The correct person's occurrence updates, a peer's occurrence does not, the wall and human Today/Household converge, and the stored report identifies the display as submitter with no invented human performer. Undo remains possible without unlocking the person's structure.
4. **Responsibility journey:** Open an assigned Cats/Kitchen responsibility from By work, act on a step and verify the original owner, one-occurrence cardinality, composed work and owner/status in wall, manager and History. An Unassigned responsibility clearly requires assignment and has no quick-completion path.
5. **Current-day denial:** Attempts to act on a tomorrow/yesterday, school-filtered-out, ended-unstarted, canceled, removed-step, foreign, or otherwise unavailable occurrence/step fail. A started survivor that is still legitimately today's work remains actionable under existing rules. Invalid Not needed on a required step is denied.
6. **Edit/action race:** For a routine and a responsibility, force both transaction orders between a manager's same-day edit and a wall's first action. Edit-first rejects stale structural intent; action-first locks that person's stored structure/owner while other unstarted people may reconcile normally. Inject a failure after status mutation to prove no partial step/report/receipt state remains.
7. **Replay/race:** Retry an acknowledged or response-lost mutation from the same active display session. One report and one resulting transition exist. Different desired state, target, principal, household or display session under the same mutation ID conflicts. Two rapid desired-state taps on one step settle deterministically without duplicate effects.
8. **Offline/reload/restart:** After authorized load, disconnect, tap, reload the page, restart the local server and reconnect the same valid session. The minimal pending command survives and is either committed once or shown rejected with a reason; no stored household payload is used to render the cold offline wall. Pending state and authoritative result stay distinguishable in the UI.
9. **Revoke and replacement:** Queue a wall tap while disconnected, then revoke or replace that display from a manager context. Old-session work does not replay after access loss or new enrollment; delayed replies cannot restore the prior wall or report a save. Exercise both commit-before-revoke and revoke-before-commit orderings.
10. **Reset and day rollover:** Queue a wall tap, clear household activity in an isolated evaluation household, then reconnect: the old generation cannot write into rematerialized work, and scoped clear removes display checklist reports/receipts while preserving display enrollment/configuration. Separately, a pending tap from the previous household date cannot newly commit after midnight; the next day renders from authoritative state.
11. **Live recovery:** Two display contexts and human phone/manager contexts show an assigned routine and responsibility. Wall action updates other contexts without reload; a phone action updates the wall. Forced socket loss, visibility recovery and delayed/out-of-order reads still converge without restoring a stale step or hiding pending feedback.
12. **Privacy and usability:** Private personal tasks never appear in display HTTP/WS or client state; household-visible tasks stay detail-only and cannot be completed from the wall. At native and scaled 4K, checklist controls meet the existing touch/focus/overflow conventions; current C-2 overview readability and phone member flows remain usable. Physical 27-inch/10–16-foot readability remains separate Project Lead/Product evidence, not a local automation PASS.
13. **Gates:** Exact `npm run validate:pr` and `npm run validate:rc` pass, including Chromium/WebKit execution journeys where supported; built/Vite `/display` deep-link smoke still passes. C-3A tests are explicitly selected in CI without weakening the aggregate required check. Build Report maps each acceptance test to named evidence and records any physical/hosted work as NOT RUN.

## Dependencies

- Technically accepted, merged P0-007C-1 r1 and P0-007C-2 r1 at the inspected baseline. Existing display enrollment is sufficient; no new provider, account, secret or hosted environment is required.
- A disposable local household with an enrolled display and fictional assigned routine/responsibility work for automated/manual evidence. Manager-controlled activity clear is used only on disposable test data.
- P0-007C-3B is not a dependency for this slice. Full C outcome evaluation still needs its personal-task-promotion behavior and the Project Lead's physical wall check.

## Relevant decisions

- D-004, D-023, D-034, D-035–D-042: durable checklist intent, locks, reset generation, ownership and shared projections.
- D-043–D-045: display principal, privacy-filtered read model and authorization-aware recovery.
- D-046, D-047: shared-display execution authority/provenance and bounded pending-command recovery.

## Known risks / assumptions

- The display is a shared household device; this slice intentionally does not identify the physical tapper. The accountable person is the assigned owner, and the performer remains unknown for a wall action. Product approved that assumption in the P0-007C proposal.
- C-2 allows assigned people with pending app access in the wall projection. This brief treats their current assigned work as executable at the wall; it does not grant them human app access or change assignment.
- Persistent minimal intent in IndexedDB is necessary for reload recovery. It must not undermine C-2's prohibition on a durable cache of household read content. Exact table/queue layout is Engineering discretion.
- A disconnected device cannot learn of remote revocation instantly. It may queue within the existing authorized stale window, but the server rejects replay after revocation and the visible household data blanks on the C-2 deadline.

## Engineering readiness

**Reviewed revision:** 1  
**Readiness:** READY (Architecture ACCEPT / PROCEED received)  
**Implementation status:** ACCEPTED by Architecture against r1 at `9369d4a`
**Build Report:** `reports/P0-007C-3A-r1-build-report.md`

Architecture accepted r1 after the AT11 socket-loss/missed-update recovery evidence closed the final finding. See `reports/P0-007C-3A-r1-architecture-reacceptance.md`. Product acceptance remains separate; C-3B remains out of scope.

C-3B remains out of scope.

## Revision history

- **r1:** Initial C-3A execution contract from the approved P0-007C proposal and integrated C-2 display foundation.
