# BRIEF P0-009B — Actionable Person Panes on the Family Wall

**Revision:** 2  
**Status:** ACCEPTED (technical, 2026-11-09; implementation `436d852`)

**Product input:** PRODUCT.md → Family wall experience proposal, revised 2026-10-25  
**Inspected baseline:** integrated main at 14af09e (PR #30, P0-009A r2)  
**Project Lead direction (2026-10-28):** The dashboard preview is good as it is; further refinement can follow. Proceed with the working wall. This does not claim a specific viewport comparison or a new physical-family-use evaluation.

This is the authoritative implementation brief for P0-009B. Review and implement r2 only. r1 has not been reviewed or implemented; any earlier handoff naming r1 is superseded. Technical acceptance, deployment authorization, and Product acceptance remain distinct.

## Why

A person should find their name and next concrete instruction on the resting family board and complete it without an adult navigating into a separate checklist. Siblings should keep their own reading positions and actions.

This slice delivers that production display experience using existing household execution and recovery contracts. The approved preview/proof supplies the initial visual direction. The three-by-two arrangement and 90-second pane idle policy remain adjustable through hands-on use.

## Learning question

Can family members find and complete the next assigned task with less prompting and fewer interruptions, while six panes stay readable and trustworthy during sibling use, pending actions, and remote updates?

## Player experience

By person opens as the everyday family board. Each person's name stays visible above a window into today's assigned routines and responsibilities. The next instruction and its action have the strongest emphasis; earlier and coming-up sections remain reachable inside that person's timeline.

A tap completes or reopens a permitted step; As needed work also offers Not needed. Browsing, scrolling, retries, and progress stay local to each pane. Enlargement is deliberate and optional. By work remains available. The selected-display preview follows the same presentation with status changes unavailable.

## Project card

**Card title:** Find and finish the next task on the family wall  
**Suggested column:** Ready to Evaluate

**Player-facing goal:** Each person can see and complete their next assigned task while the family keeps its place.  
**Done when:** Six people can find their next concrete instruction and act directly from independent panes, with understandable pending/error feedback and recovery.  
**Tracking relationship:** Second usable outcome from the Family wall experience proposal, following the accepted preview foundation. Move to In Progress at implementation and Ready to Evaluate after technical acceptance; Product acceptance follows hands-on use.

## Current system

Facts inspected at main 14af09e:

| Surface | Existing behavior / relevance |
| --- | --- |
| Display ownership | `src/client/DisplayApp.tsx` owns display session/CSRF, one display sync connection, dashboard/detail recovery, and the display-session-keyed outbox above presentation. Its focused detail is currently global. |
| Shared presentation | `src/client/display-presentation.tsx` is shared by wall and preview. Preview uses `DisplayPreviewHost.tsx` and an isolated `preview-frame`, rather than mounting credential-owning DisplayApp. |
| Display reads | `GET /api/v1/display/dashboard` gives household summaries; `GET /api/v1/display/people/:membershipId` gives recurring summaries **and household-visible personal tasks including unpromoted tasks**; `GET /api/v1/display/occurrences/:occurrenceId` gives ordered steps and minimal structural intent. Automatically calling the existing person-detail read for every pane would preload deliberate-detail content. |
| Preview reads | Member-authorized `/api/v1/displays/:displayId/preview/{dashboard,people/:membershipId,occurrences/:occurrenceId}` verify member session, display.manage, same household, and non-revoked selected display. Execution intent is stripped. |
| Status command | `POST /api/v1/display/occurrences/:occurrenceId/steps/:stepId/status` retains display Origin/CSRF, desired-state mutation ID, current day/generation, kind, and intended structure. Accountability and first-action locks come from the shared write core. |
| Ordering / progress | `src/domain/today-projection.ts` recommends in-progress non-Anytime work, then stable daypart/definition/occurrence order, then unfinished Anytime. `progress.ts` separates Done from Not needed; `completion.ts` determines completion. Display details already carry completed/state/progress. |
| Privacy / membership | Non-departed memberships with pending sign-in can receive assigned wall work. Departed people leave current display projections. Only open promoted household-visible personal tasks appear in resting summaries; other household-visible tasks require deliberate person detail. Private work is excluded. |
| Recovery | D-045/D-047 bound disconnected content/actions to 60 seconds; the outbox stores minimal commands, not names/text/snapshots or credentials. Date, generation, installation epoch, revocation, and replacement fence old intent. P0-009A already uses request-start freshness and held-response fences in preview. |
| P0-009A result | Technical acceptance: `reports/P0-009A-r2-architecture-review.md`; integrated through PR #30. Project Lead now accepts the dashboard preview as good to proceed. No specific geometry measurement or physical multi-touch result is inferred. |

## Behavioral contract

### 1. Family board and truthful daily sequence

1. **Roster and default.** Load By person by default. Include every non-departed person in saved family order, whether sign-in is pending or active. People without assigned work retain a pane. Completion never reorders or removes a person. By work remains reachable, and returning restores safe in-memory pane positions. More than six people have a clear reachable overflow path; six is an evaluation target, not a membership limit.

2. **Composition.** Start from the P0-009A concept, using Calm Household colors, spacing, alignment, and type hierarchy. At 3840×2160 and 1920×1080 CSS-pixel target viewports, all six identities and their next instruction or accurate no-work state fit without page scrolling. Keep the person header anchored, current instruction prominent, progress secondary, and earlier/coming-up navigation visible; no competing large household total. A long checklist cannot push all section context out of sight. Use More sections for reachable overflow in the same timeline. Do not preserve 3×2 by shrinking meaningful text or clipping instructions; record a reasoned alternative if needed.

3. **Recommendation and order.** Use actual current-household-day occurrences and saved composed step order, preserving source cues for personal additions and scheduled work. Match `projectPersonalDay`'s ordering/selection semantics: unfinished in-progress non-Anytime work first; otherwise the first unfinished non-Anytime occurrence in daypart, definition ID, then occurrence ID order; unfinished Anytime is the fallback. Within the recommended checklist, emphasize its first open step in saved order; settled Done/Not needed steps stay inspectable. Optional steps may remain open without preventing domain-complete advancement. A status undo does not undo the started marker. Reuse domain helpers or an equivalent narrow adapter; do not create a second scheduling/completion rule. Next is a suggestion, not a due-time claim.

4. **Independent daily windows.** Each person has one expanded checklist and one timeline scroll surface. Earlier unfinished/completed and upcoming named sections select within that timeline, without nested scrolling boxes. The full sequence and all steps remain reachable; Back to next task restores the recommendation. Section, expansion, scroll, focus-return target, and inactivity are in-memory state keyed by membership/occurrence identity, never by roster index or display name. Opening another section compacts the previous one and preserves its place. Ordinary facts refreshes preserve deliberate navigation, including unaffected sibling panes.

5. **Empty/completion states.** Distinguish no assigned checklists, a completed current checklist, remaining later/Anytime work, and domain-complete work with optional items still available. Unresolved As needed steps remain actionable. Loading, filtered-out work, and unavailable detail never become a false zero or an entirely-finished-day claim. Completed steps remain inspectable and reopenable. Promoted personal work and Needs an owner do not become recurring completion counts.

### 2. Actions, browsing, and local recovery

6. **One-tap status.** From the resting board, a deliberate checkbox tap sets an open permitted step Done or reopens a completed step. As needed also has a separate Not needed action and clear Reopen; its appearance cannot imply performed work. Optional steps do not block domain completion. Task text/background do not change status or enlarge the pane. Preserve existing status command/receipt, display actor with unknown physical performer, accountable owner, lock, and history semantics.

7. **Pending intent.** Queue through the one existing display outbox owner above the panes. Immediately show optimistic status and pending feedback beside the step. Keep a pending final action/checklist reachable until settled. After success, advance only that pane when interaction is safe; retain a route to completed work. Rejection/retry remains discoverable in that person's compact cue even when another section or By work is open. Two panes' errors/pending actions cannot overwrite a single global cue. No action response may overwrite newer desired intent. Never move a new checkbox under a held finger or steal keyboard focus.

8. **Structure and concurrency.** Retain current minimal structural intent per command; never retarget a pending step to a new owner, revision, or similarly named item. Overlay safe pending status on authoritative snapshots while retaining necessary in-memory action context until settlement. Reassignment, omission, or structural conflict follows existing reject/retire rules before showing replacement work. Do not persist occurrence snapshots/text or copy the member outbox. Interleaved actions in two panes and response-loss retry must have independent results and idempotent effects. Serialized network flushing is acceptable; concurrent panes do not require simultaneous HTTP writes.

9. **Browsing and idle.** User scrolling/section selection pauses automatic repositioning in that pane; offer Back to next task. Begin with 90 seconds of pane-local inactivity. Polling, sync, or another person's activity does not reset this timer. An active pointer/scroll gesture, unsettled action, or a return that would displace keyboard focus defers automatic movement. Pointer cancel/release must not leave the pane permanently gesture-locked. A separate visible Enlarge/person-header action opens the same section/reading position full-screen; Back to family restores safe pane positions and origin focus. The existing 90-second enlarged idle return remains the starting policy. Lifecycle/withdrawal safety takes precedence over position restoration.

10. **Freshness and partial failure.** Refresh on sanitized display invalidation, reconnect, visibility return, and at least every 30 seconds while visible. Coalescing/reloading all pane facts is permitted because current display events carry no resource IDs; it must not reset browsing state or introduce private IDs into sync. Track freshness per person's content request, measured from request start. A fresh dashboard, sibling, or socket heartbeat cannot renew a failed pane's content lease. A recoverable error shows local Retry; an explicitly stale in-memory pane may remain within D-045's 60-second limit and existing offline action lease, then blanks/disables locally. Other fresh authorized panes remain usable. Cold offline load shows no household content and queues no new taps.

11. **Arbitration and global fences.** Bind reads/action results to the current authorized session, membership/occurrence, local request/invalidation generation, household date, activity generation, and installation epoch. Drop held responses after a newer result, selection change, withdrawal, or authority/lifecycle fence. Replies older than their freshness limit cannot paint or renew freshness on arrival. Global display revocation/session expiry/replacement clears all household content and uses existing re-enrollment/recovery; pane 404/departure removes only unavailable current work, and pane 5xx is recoverable locally. Date rollover/generation clear/reset/restore must retire unsafe queued intent and load the new authorized context, never carry a prior-day pane through retained scroll state.

### 3. Read boundary and preview parity

12. **Automatic pane read.** Add `GET /api/v1/display/people/:membershipId/day` under existing display authentication. It returns an allowlisted, internally consistent current-day person snapshot: permitted identity/order/status, authoritative household date/timezone/server time/activity generation/installation epoch, ordered assigned occurrence details (including completed work), progress/state, steps/source cues, and only the existing command's required structural intent. Open promoted personal tasks may be included separately. No private or unpromoted personal-task values, IDs, or counts enter this automatic response. Personal additions already composed into an assigned routine remain normal checklist steps; they are distinct from personal-task visibility records. Keep the existing person-detail route for the explicit shared-personal-work action; enlarging or loading a pane never invokes that route implicitly.

13. **Projection integrity.** Reuse household/date-scoped display projection and normal D-044 current-day materialization under the existing shared lifecycle barrier; capture one consistent day/context for a response. Validate membership UUID and current household eligibility; foreign/departed IDs return not found. A date override, including today's date, returns 400; no arbitrary-date API is added. Use no-store responses and explicit DTO allowlists. Reads may reconcile today's unstarted snapshots but cannot execute/lock work, write action receipts, advance turns, or rewrite history. Existing dashboard/occurrence/detail routes retain By work and deliberate-detail use.

14. **Unassigned and personal work.** Needs an owner remains outside person panes, survives completion of all assigned work, opens permitted read-only detail, and directs a manager to assign in the app. It has no checkbox, Claim, or assignment action. Open promoted household-visible personal work stays separately view-only; a deliberate shared-personal-detail action can expose other permitted household-visible tasks. Private work never enters display/preview reads or sync. Withdrawal removes affected content and fences held replies without leaking private identifiers.

15. **Preview follows the wall.** Extend the same shared presentational board and pane navigation into the selected-display preview, retaining the fixed target iframe/fit behavior and outer Preview only labeling. Add the read-only counterpart `GET /api/v1/displays/:displayId/preview/people/:membershipId/day` under D-057 member session + current display.manage + same-household non-revoked display checks. Use the common scoped projection, then strip intendedStructure, step logicalItemId, and all execution/session/CSRF fields. Preview has authoritative statuses but no execution handlers, display cookie/session acquisition, display outbox, optimistic commands, or device contact renewal. Its pane state belongs only to that preview. No layout clone that can drift, mounting DisplayApp, or fabricated DisplayContext. Keep existing preview detail reads deliberate and protected. Preview loss of authority uses its existing fences; wall execution authority is unchanged.

16. **Touch and accessibility.** Use the existing Calm visual direction, textual status/name cues, semantic controls, visible focus, reduced motion, and non-overlapping visible action targets of at least 48×48 CSS px at the target viewport. Preserve the full instruction through wrapping/reading, never tooltip-only. Touch drag/release on background/text cannot complete or enlarge; keyboard can select sections, act, enlarge, and return. Interleaved browser gestures demonstrate pane isolation; actual simultaneous multi-touch and distance readability require physical evidence before claiming them.

## Implementation boundary

- Limit implementation to the production wall/presentation, its restricted day projections and preview adapter, associated types, route policy, protected behaviors/sync documentation, tests, and explicit CI selection.
- Keep session/CSRF, one sync connection, epoch/date/generation fences, and one display outbox above organization/pane/enlargement components. Do not recreate these owners per person or in the preview iframe.
- Adapt shared domain ordering/progress to allowlisted data. Component names, state helpers, wire property names, and test-file grouping are Engineering choices within the named route and behavior contracts. No new runtime dependency or database migration is anticipated; demonstrate a material need to Architecture before expanding that scope.
- Introduce per-person request/error/freshness arbitration. Prevent refresh loops and unbounded request fan-out; coalesce ordinary invalidations, fetch one day snapshot per person rather than one request per rendered step, and clean up obsolete requests/timers on unmount or authority change.
- Keep shared display presentation usable with separate execution and read-only adapters. The current P0-009A fictional proof remains development-only; small adaptation to changed shared components is allowed, but rebuilding its future Family day design is outside B.
- Add a dedicated P0-009B script/CI selection using the existing built desktop/display/preview Chromium and WebKit conventions, plus the needed Vite preview deep-link smoke. Keep wall target tests out of phone-core. Real touch evidence uses a touch-enabled Chromium/CDP path; mouse input on a phone viewport is not touch evidence. Reuse existing controlled-date/fault/hold seams; new server test hooks, if needed, remain unavailable in hosted mode.
- Maintain `docs/protected-behaviors.md`, route-policy completeness, `ARCHITECTURE.md` implementation facts, and a Build Report at `reports/P0-009B-r2-build-report.md`. Screenshots/geometry metadata belong only in ignored `reports/_local-screenshots/p0-009b-r2/`.
- Build Report must map every required matrix subrow, identify baseline/tested tree and later commits truthfully, and include exact final-tree PR/RC exit results. A Project Lead commit after Engineering's handoff is a later event; no metadata-only retry cycle is required to restate that chronology.

## Do not change

- Assignment patterns, coverage, scheduling/applicability, obligation/completion rules, first-action locks, source identities, historical accountability, and action provenance.
- Display enrollment/credentials/lifetimes, member/owner authority, existing Origin/CSRF/replay or installation-continuity/reset/restore contracts. No member execution API or preview credential may execute wall work.
- Personal-task mutation authority or promotion/visibility semantics; Unassigned remains read-only.
- Live School/homework, Meals, calendar ingestion, future Family day production modules, exact-time scheduling, automatic scenes/carousels, board configuration tools, kiosk infrastructure, or the separate root-route investigation.
- Do not rewrite lifecycle/auth systems or re-prove unrelated old matrices merely because they are dependencies. Reuse exact named assertions where they establish the inherited boundary; prove the new pane/route/presentation delta.
- Engineering implementation does not authorize Railway deployment, live-data work, or a production replacement. The Project Lead manages Git and deployment. Suggest a commit message; do not commit.

## Acceptance tests

The following matrix is the required acceptance contract. Group IDs preserve r1's outcome families; subrows make evidence individually judgeable. All rows are required for technical acceptance, except the separately assigned Product checkpoint below. No row can be marked PASS solely because a suite or similarly named test passed.

Planned evidence locations (equivalent grouping/naming is allowed if the Build Report maps each subrow):
- **U:** narrow projection/state unit assertions, e.g. `src/domain/family-wall-projection.test.ts`, reusing existing domain helpers.
- **I:** `tests/integration/p0-009b-family-wall.test.ts` for new read allowlists/authority, materialization, and command integration.
- **B:** `tests/e2e/z-p0-009b-family-wall.spec.ts` for real rendered navigation/actions/geometry.
- **R:** `tests/e2e/z-p0-009b-recovery.spec.ts` for deterministic held reads/writes, multi-context, and recovery.
- **P:** `tests/e2e/z-p0-009b-preview.spec.ts` plus existing Vite preview deep-link coverage.
One test may establish multiple subrows; existing tests may supply explicit inherited evidence. Test-first the new behavior where practical. This is an evidence contract, not a demand for one test/file per row. When a row names multiple variants (such as reset and restore or two target sizes), record each variant's result; a single passing variant cannot close an unrun required one.

Browser selection is bounded: Chromium establishes all new B/R/P assertions. WebKit must establish AT1a, AT4b, AT5a/b, AT9a, AT11a, AT15c, and AT19a/b through composed journeys; the remaining deterministic race/geometry/input subcases need not be duplicated on WebKit. CDP touch is Chromium-only. Existing WebKit regression selections stay in the RC gate. This browser split is intentional coverage, not an undisclosed skip.

Fixtures:
- **F-crowded:** disposable six-person household in deliberately nonalphabetical saved order, including a person whose sign-in is pending. Use the P0-009A fictional identities/workload where practical. All six have real assigned work; Avery has two Done of five ordered steps, a long step-three instruction, and upcoming Homework time, House cleaning, Dinner cleanup, Bedtime, and pet-work headings. These are ordinary routines/responsibilities, not new modules. Include one composed addition/source cue.
- **F-states:** variations for no applicable work (including school-filtered omission), only Anytime, earlier unfinished plus later work, completed work with optional open, unresolved As needed, and Unassigned.
- **F-sharing:** private, promoted household-visible, and unpromoted household-visible personal tasks with distinct detectable IDs/titles.
- **F-races:** current authorized display plus second display/member; deterministic response holds/failures, controlled household date/generation, and disposable reset/restore setup. Use existing lifecycle/operator fixtures; never the live household.

### Acceptance evidence matrix

Architecture technically accepted committed correction `436d852` on 2026-11-09. All 47 required subrows have sufficient reviewed evidence. D3 is closed by the exact generation-clear/usable-action regression and Architecture's original reproduction; D1/D2/E1 and earlier closures remain valid. Exact final Engineering PR/RC exits are recorded as 0, and Architecture independently passed the build and focused checks. See `reports/P0-009B-r2-architecture-acceptance.md` for evidence and limits. Earlier FIX REQUIRED reports remain historical. The contract/revision is unchanged; Product and physical acceptance remain separate.

| ID / assertion | Initial state / fixture | Action / transition | Exact expected observable or invariant | Evidence type / planned named check | Result |
| --- | --- | --- | --- | --- | --- |
| AT1a — Default | F-crowded, enrolled wall | Load /display | By person board appears without opening person/checklist detail; next instruction has a usable action | B · AT1a | PASS |
| AT1b — Organizations | Two panes deliberately browsed | Switch By work, then By person | Existing work overview remains usable; safe pane section/scroll restored | B · AT1b | PASS |
| AT2a — Identity/order | F-crowded including pending sign-in | Complete work; refresh roster | Six names stay in saved order; pending-sign-in assignee remains; no reorder/removal on completion | I + B · AT2a | PASS |
| AT2b — Larger roster | More than six non-departed people | Reach overflow | Every person is reachable in saved order without a new membership cap | B · AT2b | PASS |
| AT3a — Recommendation | Started scheduled, earlier unstarted, Anytime; include undo-to-open started work | Project/load, then complete recommendation | Choice matches existing Today semantics and stable ties; saved step order/source cues retained | U + B · AT3a | PASS |
| AT3b — State truth | F-states: no work, filtered omission, only Anytime, later unfinished | Load each variation | Accurate no-work/next/later labels; loading/error is never zero or complete | U + B · AT3b | PASS |
| AT3c — Optional/As needed | Domain-complete checklist with optional open; separate unresolved As needed | Advance/inspect | Optional work remains reachable without blocking; unresolved As needed does not disappear into all-done | U + B · AT3c | PASS |
| AT4a — Full timeline | F-crowded Avery | Select earlier/upcoming/More, scroll full steps, Back to next | One expanded checklist/scroll surface; all sections reachable; long instruction and upcoming context usable | B · AT4a | PASS |
| AT4b — Sibling isolation | Two distinct pane positions | Interleave section selection and scrolling | Sibling selection, expansion, and scroll remain unchanged | B · AT4b | PASS |
| AT5a — Done/reopen | Assigned routine and responsibility | Tap Done and reopen from board | Authoritative status matches; existing endpoint used; accountable owner/device actor/unknown performer preserved | I + B · AT5a | PASS |
| AT5b — Not needed | As needed step | Not needed, then reopen | Distinct Not needed presentation and server status; no false Done/performed count | I + B · AT5b | PASS |
| AT6a — Held final success | Last blocking step; held write reply | Tap, hold, settle | Context/action stays visible pending; only that pane advances safely; completed work remains reopenable | R · AT6a | PASS |
| AT6b — Rejection discoverability | Two pane actions, one rejected | Browse away/switch organization | Each pending/error cue remains independently reachable; failure never appears saved or silently disappears | R · AT6b | PASS |
| AT7a — Two panes/replay | Two different occurrences | Queue both; lose/retry one same-ID response | Both desired states commit; one effect/receipt for retried command; no lost flush follow-up or cross-pane mutation | I + R · AT7a | PASS |
| AT7b — Newer intent | One step with held old response | Done, reopen, deliver older result last | Final desired open status and outbox/UI agree; old response cannot restore Done | R · AT7b | PASS |
| AT8a — Offline/reload | Loaded authorized snapshot within lease | Disconnect, queue, reload offline, reconnect | Queue durable/minimal; cold offline wall contains no household payload; same-session valid replay commits once after reauthorization | R · AT8a | PASS |
| AT8b — Changed structure | Pending first action; remote edit/reassign wins | Refresh and flush old intent | Old command not retargeted; conflict/retirement visible; fresh structure/owner shown only under current context | I + R · AT8b | PASS |
| AT9a — Ordinary live change | Second member/display context; browsed panes | Remote step action | Updated facts converge without reload; deliberate selection/scroll preserved | R · AT9a | PASS |
| AT9b — Missed sync | Real wall socket closed; pane B retains position | Remote change during outage; reconnect/visibility | New person-day facts converge; no page reload or sibling position reset; socket close/reconnect observed | R · AT9b | PASS |
| AT10a — Out-of-order pane | Capture old person-day response, accept newer one | Fulfill old snapshot afterward | New title/status/structure stays; old body cannot paint or renew freshness | R · AT10a | PASS |
| AT10b — Lost selection | Held detail/enlargement read | Back/change selected person; release old body | Old detail cannot reopen/enlarge wrong pane or replace newer selection | R · AT10b | PASS |
| AT11a — Partial failure | One day endpoint 5xx, sibling fresh | Load; act in sibling; Retry failed pane | Local unavailable/Retry, never empty-complete; sibling action works; retry preserves sibling state | R · AT11a | PASS |
| AT11b — Independent stale lease | One person fetch fails repeatedly; dashboard/siblings keep succeeding | Advance controlled request-start age beyond 60s | Only failed pane content blanks/disables; other successes do not renew it; fresh siblings remain usable | R · AT11b | PASS |
| AT11c — Late stale reply | Hold person read from fresh state | Expire lease, then fulfill old 200; fresh retry | Old data remains blank; only a new valid response restores pane | R · AT11c | PASS |
| AT12 — Unassigned | F-states with Unassigned; all assigned work complete | Open Needs an owner | Summary persists, owner explanation visible, no checkbox/Claim/status request | I + B · AT12 | PASS |
| AT13a — Automatic privacy | F-sharing | Fetch/load all automatic panes and preview | Private/unpromoted IDs/titles/counts absent from automatic payloads; promoted tasks view-only, outside recurring totals | I + P/B · AT13a | PASS |
| AT13b — Deliberate detail | Unpromoted household-visible task | Enlarge, then explicitly open shared personal detail | Enlargement alone neither fetches nor reveals it; explicit action uses permitted detail; no personal-task status control | B + P · AT13b | PASS |
| AT13c — Withdrawal | Held promoted/detail response | Owner makes task Private/unpromoted, invalidate, release old reply | Withdrawn values disappear from affected placement and do not resurrect; sync contains no private ID | I + R · AT13c | PASS |
| AT14a — Day boundary | Pending yesterday action and held person read | Controlled household-date rollover | Old body/command cannot reappear/execute; retirement feedback; today's panes reload without retained yesterday focus | I + R · AT14a | PASS |
| AT14b — Activity generation | Pending command/held pane | Clear activity, then deliver old data | Old generation retired/rejected; no snapshot resurrection; current panes recover | I + R · AT14b | PASS |
| AT14c — Installation replacement | F-races; parameterize reset and restore | Replace epoch while pane read/action pending | Exclusive operation completes; old auth/read/write fenced, no new-epoch effect; recovery uses existing setup/enrollment | I + R · AT14c; reuse lifecycle command matrix where exact | PASS |
| AT14d — Authority loss | Open multi-pane wall; pending command | Revoke/replace/expire display authorization | All household content clears, delayed success cannot restore it, unsafe intent rejected/retired with feedback | I inherited matrix + R one new-board denial journey · AT14d | PASS |
| AT14e — Departure/owner change | Pending/open person's work | Depart assignee or revise unstarted owner | Departed person/old-owner work is removed from current placement; fresh work appears only for effective owner; old intent not transferred | I + R · AT14e | PASS |
| AT15a — Local idle | Distinct browsing times in two panes | Controlled 90s inactivity; unrelated polling/user action | Only eligible idle pane returns; sibling interaction/poll does not reset its timer or move sibling | B · AT15a | PASS |
| AT15b — Movement guards | Pending action, held pointer/scroll, keyboard focus | Advance idle deadline, then safely end guard | No control/focus displacement while guarded; cancel/release recovers; safe return can resume | B · AT15b | PASS |
| AT15c — Enlarge/return | Two stored pane positions | Enlarge deliberately; Back, then controlled enlarged idle return | Same person/section/reading context; Back restores board positions/origin focus; idle return is safe | B · AT15c | PASS |
| AT16a — Crowded target | F-crowded at 3840×2160 and 1920×1080 | Inspect native board | Six anchored identities, step-three long instruction, truthful 2/5 context, upcoming headings/More; no page scroll/clipped essential content; stable type hierarchy recorded | B geometry + ignored paired captures · AT16a | PASS |
| AT16b — Input/a11y | Same board, touch and keyboard, reduced motion | Touch drag/release; keyboard act/navigate/enlarge | No accidental status/enlargement; visible focus/textual states; action hitboxes ≥48×48 without overlap; reduced motion honored | B touch/CDP + keyboard · AT16b | PASS |
| AT17a — New route authority | Anonymous/member/display/revoked/foreign/departed/malformed cases | Call each new route; send date override | Display route without valid display or preview without member: 401; preview grant missing: 403; foreign/departed/revoked selected record: 404; malformed UUID/date override: 400; authorized own-household read succeeds | I route-policy/denial table · AT17a | PASS |
| AT17b — Projection/side effects | Populated current day/history; missing today's rows | Read each new route twice | Correct today may materialize; no status reports/first-action locks/action receipts/turn advance/history rewrite; one consistent date/gen/epoch envelope | I · AT17b | PASS |
| AT17c — Replacement barrier | Held new route read, reset/restore | Apply existing read-delay/revalidation seam safely | No lifecycle deadlock; delayed old scope rejected or client-fenced; active installation/catalog preserved by inherited operations | I · AT17c; link AT14c | PASS |
| AT18a — Selection | New B specs + old display/preview/proof suites | Inspect scripts/Playwright list/Actions workflow | Explicit B PR/RC/CI selection follows the required browser split above; touch distinctly selected; no accidental phone-core run | Script/list/workflow inspection · AT18a | PASS |
| AT18b — Final gates | Final implementation/evidence tree | Run npm run validate:pr and npm run validate:rc | Both exit 0; record tested baseline/tree/logs, skips honestly; inherited display/history/lifecycle/preview regressions included | Exact local gates · AT18b | PASS |
| AT18c — Shipped boundary | Production build and Vite smoke | Inspect build; reload built and Vite preview deep links | Fictional proof entry/fixture absent from production; real preview reload works in both modes; no School/Meals/Calendar placeholders | Build + built-browser reload + existing Vite smoke · AT18c | PASS |
| AT19a — Preview parity | Same real disposable household/date and target | Compare native wall with fitted preview at both presets; resize outer host | Shared board hierarchy/sections/geometry agree; fit changes scale only; readonly statuses/navigation visible | P geometry/native comparison · AT19a | PASS |
| AT19b — Preview authority isolation | Selected manager preview; pause physical-wall HTTP for contact measurement | Browse/enlarge/retry preview and inspect new read payload | Zero execution/claim/display-auth/outbox attempts; no execution secrets in payload; display last_seen_at unchanged by preview requests | I + P request/side-effect assertions · AT19b | PASS |
| AT19c — Preview does not steer wall | Separate enrolled wall with held pending intent and known pane positions | Navigate/enlarge preview, then release/reconnect wall | Wall positions/intent stay independent; its command subsequently settles once with pending cue cleared | P; adapt exact P0-009A AT3b proof · AT19c | PASS |

### Product checkpoint after technical acceptance

Project Lead evaluates the deployed working wall in a normal before-school session: who participated, who needed prompting, how next-task discovery and sibling interruptions behaved, crowded/empty/By work usefulness, pending/retry clarity, deliberate enlargement, and legibility near 10 and 16 feet. Record actual browser CSS viewport/zoom when known. Physical multi-touch is optional evidence until tested; do not infer it from CDP or interleaved actions. This checkpoint decides usefulness and appearance and is not an Engineering readiness, local technical acceptance, or merge gate. Further visual refinement can follow without reopening satisfied authority/domain contracts.

## Dependencies

- Integrated P0-009A r2 at main 14af09e, existing display commands/outbox and P0-008C/D/F continuity/lifecycle protections.
- Project Lead accepts the dashboard preview as good to proceed. No further preview/physical checkpoint blocks implementation.
- Existing local disposable evaluation harness. Saved production credentials/local-real-data tooling and Railway availability are not dependencies for Engineering.

## Relevant decisions

- D-041–D-042 and D-043–D-049: recommendation/progress, display authority/projection/freshness, actor/outbox, personal promotion/privacy.
- D-051/D-054/D-060: epoch, departure, and hosted installation continuity.
- D-057–D-059: preview authorization, isolated fictional proof, actual fixed target viewport.
- D-061 (refined in r2): separate automatic person-day reads, independent pane state/freshness, shared readonly preview adapter.

## Known risks / assumptions

- Both 16:9 presets are CSS viewports, not a claim about the physical screen's OS scale/zoom. Six-person layout can be refined from Product evidence.
- Automatic pane reads must not preload the existing person-detail endpoint's unpromoted task list. This is the reason for separate day routes.
- A fresh dashboard must not mask an expired person snapshot; global auth and each pane's content lease are distinct checks.
- Current sanitized sync cannot identify individual affected records; coalesced all-pane refetch is allowed with browsing preservation.
- A larger brief is not permission to add domain features or rebuild lifecycle infrastructure. The outcome is one actionable board; reuse inherited proofs and report missing required subrows before claiming complete.

## Engineering readiness

**Reviewed revision:** 2  
**Readiness:** READY (review complete; implementation in `reports/P0-009B-r2-build-report.md`)

Consolidated Engineering review of **P0-009B r2** against integrated `main` `14af09e` is in `reports/P0-009B-r2-engineering-readiness.md`. No BLOCKER or QUESTION. The r1 report remains the assignment-mismatch record only. Architecture ACCEPT / PROCEED (2026-10-28) authorized implementation of r2 in the same session. Technical acceptance, deployment, and Product acceptance remain distinct.

## Revision history

- **r1:** Initial production family-board brief; pending P0-009A visual checkpoint explicitly did not block functionality.
- **r2:** Project Lead preview acceptance recorded. Separate automatic day reads from deliberate personal detail; require shared read-only preview parity; include pending-sign-in roster members; clarify recommendation/state/idle/pending and per-pane freshness/fences; replace compound evidence rows with judgeable subrows and inherited-proof reuse.
