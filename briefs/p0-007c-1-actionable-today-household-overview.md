# BRIEF P0-007C-1 - Actionable Today and Household Overview

**Revision:** 1
**Status:** IN REVIEW

One authoritative contract for P0-007C-1. Material changes increment the revision and invalidate prior readiness. Architecture technical acceptance and Project Lead acceptance of the experience are separate. Engineering reviews this revision before implementation and awaits Architecture's ACCEPT / PROCEED.

## Why

The accepted A/B foundations know whose work exists, what it contains, and how it is progressing. Today still opens many checklists, and Household initially offers a destination menu rather than a useful overview. Make those two existing, individually authenticated surfaces answer **What should I do next?** and **What still needs attention?**

This is the first of three slices of Design's revised **P0-007C - Daily Dashboard, Shared Display & Readability** proposal. C-2 introduces an enrolled, restricted, read-only Household Display; C-3 adds truthful shared-device execution and owner-controlled personal-work promotion. Neither display slice is implemented here, and finishing C-1 does not complete the overall Product outcome.

## Learning question

Can a child find useful next work without scrolling through the day's checklists, and can a parent identify remaining work and its owners within several seconds? Does existing daypart order plus a clear continuation preference suffice before introducing exact-time policy?

## Player experience

Completed Morning work is quiet. After School receives the main checklist space. Kitchen and Bedtime remain compact but open with a tap; untimed work stays under Anytime Today. All existing checklist actions remain immediate.

Opening Household shows responsibility ownership/state and routine completion across people, not everyone's steps. A parent opens one detail, then returns to the same overview. People, calendar, approvals, History and settings remain easy to reach without dominating daily oversight.

## Project card

**Card title:** Know what to do next and what the household still needs

**Suggested column:** Up Next

**Player-facing goal:** Make the personal day actionable and the household day understandable at a glance.

**Done when:** A child uses one focused checklist with later work still visible, and a parent identifies owners and progress from a compact overview and drills down without losing their place.

**Tracking relationship:** Standalone outcome card; first of three contributing to P0-007C. Move to In Progress at implementation, Ready to Evaluate only after technical acceptance, and Accepted only after Project Lead evaluation. No external board is currently configured.

## Current system

Inspected on clean local `main` at **e8f59b4** (2026-09-24), after integrated P0-007B and screenshot/history cleanup. Earlier reports retain their historical commit references; this SHA identifies the inspected tree, not a new implementation commit. No baseline validation run is claimed by this planning brief.

| Evidence | Relevant repository fact |
| --- | --- |
| `src/client/App.tsx` | Session, WebSocket, authoritative refresh arbitration and IndexedDB outbox live above destinations. `projectedOwn` restricts Today to the signed-in accountable member; own personal tasks are passed separately. `OccurrenceList` expands incomplete occurrences by default. |
| `src/domain/daypart.ts`, `completion.ts` | Dayparts are Morning, After school, Evening, Bedtime, Anytime; order uses daypart then definition ID. There are no clock windows. Required/As needed/Optional determine completion; optional-open steps do not block it. Empty steps do not imply complete. |
| `src/client/PeopleGroups.tsx` | Household activity has compact responsibility rows/detail, per-person expanded routine cards and household-visible personal tasks. The `/household` root in `App.tsx` is presently a management menu. |
| `src/server/store.ts` | `materializeForDate` filters each kind by its manage/execute-own grants. Management grants do not permit completing others' work. Started snapshots and Unassigned responsibility rows are already supported. History reads stored evidence only. |
| `src/client/api.ts`, `src/server/store.ts` | Personal tasks have owner, title, visibility and open/completed state, but no due date, daypart or checklist. Reads include the owner's private tasks plus household-visible tasks. Status saves do not use the durable checklist outbox. |
| `src/client/nav.ts`, `App.tsx` | Existing History API destinations, permission gates, dirty-leave handling and focused secondary views must survive. Household activity currently uses local secondary state, not a dedicated saved URL. |
| `.github/workflows/validate-pr.yml`, `playwright.config.ts` | Thematic phone jobs cover pre-P0-007, 007A and 007B. A test named P0-007C would currently miss those phone jobs. Desktop has an explicit file allowlist. Aggregate required-check name is `Pull-request validation`. |
| `reports/README.md`, `.gitignore` | Screenshots are local-only evidence under ignored `reports/_local-screenshots/`. Text reports/tests remain tracked; old screenshot paths are historical. |

## Behavioral contract

### 1. One personal day, with deterministic guidance

- Preserve `/today`, the signed-in identity and server-authorized inputs. Mix routines and responsibilities by actionability, not separate primary kind sections. Include the member's own personal tasks without copying them into recurring-work storage.
- Use **Completed**, **Next**, **Later**, **Anytime Today**. Completed is a quiet collapsed summary; empty Next/Later sections need not occupy space. Do not turn missing/loading/error data into a reassuring "all done" result.
- **Initial Next rule:** Among unfinished occurrences with a non-Anytime daypart, prefer work already in progress; otherwise choose the earliest daypart. Break ties by existing daypart/definition-ID order and stable occurrence ID. In progress means started or carrying a non-open projected step, not merely materialized. The remaining unfinished non-Anytime occurrences are Later in daypart order. Kind never wins a tie by itself.
- Unfinished Anytime occurrences and open personal tasks belong to Anytime Today. If no scheduled Next exists, the first Anytime checklist may be the initial expanded item within that section; do not manufacture a daypart/due time for a personal task. Keep personal-task ordering stable using existing creation order plus ID, not network arrival order.
- These are recommendations, not availability gates. Later work can be opened and executed now under existing rules. The initial rule is deliberately not clock-based: no invented school-dismissal time, overdue label, deadline or exact-time scheduler. Use the authoritative household date, never a traveling browser's date to classify recurring work. On an authoritative date change, recompute from that date's returned work; do not roll incomplete work forward.
- Completed recurring work belongs to the displayed household date. Personal tasks have no scheduled household date: preserve completed-task access/undo in a collapsed, clearly labeled personal-task group, without implying all were completed today or adding them to a dated completion total. No new personal-task history query is required.

### 2. One focused checklist without losing interaction

- Normally expand only Next; at most **one recurring-work checklist** is expanded across the personal page. Other work uses compact title/daypart/progress rows. Explicitly opening Later, Anytime or Completed closes the previous checklist and does not change assignment, schedule or eligibility.
- Respect a user's chosen expansion or deliberate collapse through ordinary sync refresh. Recommendation changes must not steal focus or reopen all cards. This transient choice is scoped to session/member/date; no server preference is required.
- Keep a just-tapped item in place while its pending operation settles, including a final optimistic completion. Automatic regrouping must not collapse/remove its controls under the tap or announce server confirmation prematurely; explicit user selection/collapse remains allowed. Show pending/rejected truth. Once settled, completed work can compact into Completed and the next recommendation can take prominence. Keep keyboard focus on a meaningful surviving control and retain a clear path to undo.
- Reuse existing optimistic checklist commands, structural-intent checks, generation fences and pending-omitted snapshots. A reset retires old activity; ordinary omission does not. A pending item cannot vanish because a presentation filter decides it is complete, absent or no longer assigned.
- Preserve Required/As needed/Optional actions, source headings for scheduled work, personal additions and existing execution authority. Expanding a different row is not a remount of session/outbox/sync ownership.
- Keep personal-task create, scope selection, completion and undo available through compact controls and a focused Add task form. Preserve `personal_task.create`, owner-only writes and the existing private default. Do not imply task saves are durably queued offline; failures retain an actionable retry/error state instead of silently losing a draft or claiming success.

### 3. Honest status and progress

- Completion uses existing domain semantics, not `completedCount === totalSteps`. Counts must distinguish actual Done from Not needed, and must not count optional-open work as performed. A Complete checklist can still contain optional-open steps; those remain inspectable/actionable.
- Use neutral Not started / In progress / Complete states. Unassigned is Needs assignment, not a person's task and not an execution action. Pending/error indicators qualify local optimistic status where relevant.
- Compact copy may show actual done/total plus Not needed/optional context or an equivalent unambiguous treatment. Do not introduce a single percentage that conflates completed people, completed checklists and performed steps. Empty/filtered-out work is not a completed occurrence.

### 4. Household opens to a summary

- For the existing Household-activity audience, make the `/household` landing surface summary-first. Responsibilities show one row per occurrence with title, friendly accountable name (or Unassigned), state and progress. Routine rows aggregate by **definition ID and household date**, with completed/applicable-person counts and an understandable overall state. Never group merely by title.
- Aggregate only authorized, returned occurrence snapshots. The denominator is the represented applicable people, not today's live group membership, all directory members, a preview or newly generated History. Started survivors remain represented after plan/audience changes. When per-person locked snapshots differ, drill-down shows each person's own title/work/status; never substitute today's latest definition for them. Use a deterministic snapshot label for a mixed-title group rather than splitting identity by title.
- Routine aggregate state is Complete only when every represented occurrence is complete; otherwise In progress if any has begun or completed, else Not started. No zero-person "0/0 complete" row. Pending/error qualifiers remain visible when contributing local data is pending.
- Show compact responsibility and routine groups, plus existing household-visible personal work with owner/state. Completed work is visually quiet but findable. This is authenticated Household oversight, not the future wall board: **do not introduce promotion flags or suppress existing household-visible tasks pending C-3**.
- Opening a routine row first reveals compact people/status rows in saved family order (stable ID fallback); opening a person reveals one read-only checklist. Responsibility detail opens its one composed checklist. Return restores the overview's origin row/focus and practical scroll position. Realtime changes update both overview and open detail without reload. If a selected item genuinely disappears after authoritative resolution/reset, return safely with an explanation rather than showing another item's detail.
- Management links remain secondary and capability-gated: People & Groups, school calendar, approvals, History and Data & testing stay reachable. An Unassigned repair link may open the correct Plan detail only for a responsibility manager. No manager completion bypass. Users outside the existing activity audience retain their permitted Household navigation; do not widen that audience as a presentation shortcut.

### 5. Preserve boundaries while simplifying presentation

- Keep server per-kind read restrictions. A routine-only manager cannot acquire household-wide responsibility data or totals, and vice versa. Counts, empty states and drill-down must describe only the authorized scope; enrollment/structure/approval capability alone does not imply all-work oversight.
- Household personal-task inputs must be filtered to household-visible even when the signed-in manager also owns private tasks returned by the task endpoint. Another person's private task must never arrive in that member's API response. No shared cache or aggregate can bypass these rules.
- Derive both surfaces from the existing authoritative/reconciled state, not separate copies with their own freshness rules. Preserve invalidation, reconnect and visibility recovery, late-response arbitration, logout isolation and reset fences. A partial fetch failure is not an empty household; stale retained data must not be presented as freshly verified.
- Apply existing Calm Household tokens, integrated heading/Back, friendly names/date labels, compact rows, quiet healthy connectivity and transient ordinary success. Errors remain visible until resolved/dismissed appropriately. Keep useful connection/pending warnings. Limit copy/density changes to these surfaces and their directly used components; no application-wide reskin.
- Phone, tablet and desktop layouts must be intentional. Use semantic buttons/headings, expanded-state announcements, visible focus, non-color status and practical touch targets. No wall-sized layout, kiosk mode, new theme or new router is needed.

## Implementation boundary

- Expected touchpoints: Today/Household wiring and focused components in `src/client/App.tsx` / `PeopleGroups.tsx`, small pure projection helpers/tests, existing checklist/personal-task components, shared styles and navigation where directly needed. Extracting these surfaces from large files is ordinary Engineering discretion; avoid an unrelated App/store rewrite.
- Preserve the existing transport and database contracts. No migration, runtime service or dependency is expected. Small client data-loading fixes and narrowly necessary response fields are permissible if they preserve authorization and are covered; a new stored aggregate, grant model, task engine or alternate sync owner requires Architecture review.
- Update affected regression selectors to the new navigation/expansion behavior without deleting protected assertions. Extend the protected-behavior catalog/sync matrix for the new projections and focus recovery. Make CI explicitly select C-1 phone and desktop evidence while retaining all prior suites and the aggregate required-check name.
- New visual evidence belongs in **`reports/_local-screenshots/p0-007c-1-r1/`**, not tracked PNGs. Preserve prior local archives. If legacy tests still capture to old tracked-tree paths, narrowly redirect/disable redundant captures without dropping behavioral assertions; do not commit regenerated historical screenshots.
- Deliver readiness and Build Report under `reports/P0-007C-1-r1-*.md`, with named acceptance evidence and exact command outcomes. No deploy, live-data clearing, new accounts/services or Git mutation is authorized. Suggest a commit message but do not commit.

## Do not change

- Accepted A/B assignment/composition semantics; routine fan-out versus single responsibility; fixed/cyclic/weekly ownership; Unassigned repair; school context; first-action locks, stable IDs, started survivors, schedule boundaries, provenance or stored-only History.
- Completion/undo semantics, pending-first-action protection, durable checklist intent, structural validation, reset scope/generation, personal-task privacy or per-kind grants.
- Plan authoring, family profiles/order, access enrollment, proposals, saved URLs, dirty editors, bootstrap/fixture cleanup, migration history or provider-neutral local evaluation.
- No Household Display principal/session/enrollment, display API, shared execution/performer attribution, personal promotion, projects, due dates, exact-time urgency, Cover/Claim/helpers, Skip Day, notifications or ambient feeds in C-1. These are not hidden prerequisites for this first usable slice.

## Acceptance tests

All are required unless an external-evidence boundary is explicitly stated. Unit tests alone do not replace the named browser journeys; API setup is allowed for fixtures, but actions under evaluation must use normal UI.

1. **Deterministic projection (unit):** Mixed kinds, multiple unfinished dayparts, continuation preference, stable ties, Anytime-only, all-complete and empty states follow section 1. Vary browser timezone and input response order without changing household-date classification. No fake times or kind-first sorting.
2. **Personal-day journey (Chromium and WebKit):** Fictional Morning completed, After School 2/5, Kitchen and Bedtime unfinished, and an untimed personal task. Completed starts quiet; After School alone expanded; Later compact; personal work in Anytime. Open Kitchen, act, return/undo through normal UI; never expose all checklists. Also cover no scheduled Next and all recurring work complete.
3. **Focus and rapid interaction (browser):** Open Later, receive unrelated sync, and keep selection. Rapid taps including final completion retain controls while pending; acknowledgement compacts safely and undo remains available. Keyboard expansion/return focus is correct. A user collapse is not undone by the next refresh.
4. **Completion truth (unit + browser):** Required complete, As needed marked Not needed, optional-open and all-optional checklists show domain-correct completion without pretending optional steps were performed. Empty filtered work does not yield false completion. Step counts and person counts are visibly distinct.
5. **Personal-task parity/privacy (browser + existing API boundary evidence):** Create private and household-visible tasks, complete/undo, and reload. Own tasks join Anytime; completed undated tasks do not claim today's completion. Another member sees only shared tasks; Household excludes even the viewer's own private task. Failed create/status requests show recoverable errors; absent create authority has no usable bypass.
6. **Household oversight (Chromium and WebKit):** At least four fictional people; Kitchen, Cats, Bathroom and Trash with different owners/states; multiple per-person routines. From Household root identify all four owners/states and aggregate routine counts without opening checklists. Drill routine -> person and responsibility -> composed work; return to the origin row. Management links remain reachable.
7. **Snapshot/identity edges (projection tests + browser inspection):** Two definitions share a title; one routine has divergent started per-person title/steps and later audience changes; one unstarted responsibility is Unassigned; one contextual occurrence is omitted. No duplicate/merged identities, live-group denominator, lost started survivor, phantom completion or Unassigned Today executor. Repair opens the right plan only with authority.
8. **Authority matrix (API/integration + browser):** Own executor, routine-only manager, responsibility-only manager, and activity-eligible non-work-manager retain their permitted scope. Forbidden kinds are not inferable from new totals/drill-down. Management is not another person's execute permission. Cross-household/private boundaries remain enforced. Reuse existing security tests where exact behavior is unchanged, with named mapping rather than claiming new tests were run.
9. **Live convergence (multi-context browser):** Member completes mixed routine/responsibility work while manager watches overview and then detail. Both summaries and open detail update without manual refresh; personal-task changes also refresh. Force missed events, reconnect and visibility recovery; delayed older responses must not restore stale status/focus. Preserve already-pinned selection.
10. **Offline/reset recovery (browser):** A first action pending offline survives a same-generation structural omit and reload, remains discoverable/actionable, and resolves with existing conflict semantics on reconnect. Separately clear activity on disposable data while a client has pending intent; a newer generation retires old cards/intent and delayed replies cannot restore them. Section/aggregate caches must not resurrect erased rows. Reuse existing test seams, not live data.
11. **Loading/navigation (browser):** Delayed/failed occurrence and task reads yield honest partial/loading/retry states, not "all done." Logout/account switch clears presentation state. Household-date change recomputes the current day from server results without rollover debt. Built and Vite `/today`/`/household` reloads, permission gates, secondary destinations and dirty-leave behavior remain intact.
12. **Readable representative evidence:** Capture fictional, stable friendly names at phone, tablet and desktop widths in the ignored C-1 directory. Include initial Today, expanded Later, Household overview and a focused detail. Verify 360px width, midsize layout, desktop, 200% text, keyboard/touch targets and no important horizontal overflow. Product evaluates speed of understanding; record that evaluation separately, never as an automated assertion or invented approval. Physical 4K/10-16-foot evidence belongs to C-2/C-3, not this gate.
13. **Regression/CI/evidence:** `npm run validate:pr` and `npm run validate:rc` pass, including Vite smoke. Show test discovery that C-1 phone tests are selected by a required thematic CI job and new desktop tests by the desktop project; preserve prior selection and aggregate failure propagation. Map AT1-13 to named tests/results and disclose skips. First remote Actions evidence follows Project Lead push/PR; do not publish to obtain it. No new tracked screenshots, secrets, runtime databases or generated logs.

## Dependencies

- Accepted, integrated P0-007A/B and P0-006 foundations; inspected baseline `e8f59b4`. Use the Project Lead's then-current integrated main if it advances, and report material differences during readiness.
- Existing Node 24/npm toolchain, local test databases, browser automation and local/LAN evaluation. No hosted deployment, physical wall hardware or C-2 principal is needed.
- Supplied revised C proposal is sufficient Product direction for this slice. C-2/C-3 need their own briefs/readiness, not a resubmission of the same proposal.

## Relevant decisions

- **D-041:** Personal-day hierarchy derives from reconciled work, with bounded daypart recommendations and one focus.
- **D-042:** Household summaries retain snapshot identity, scope and truthful completion; display authority is separately briefed.
- Preserve **D-021**, **D-023-D-024**, **D-027-D-028**, **D-030**, **D-032-D-040** (dayparts, lifecycle, navigation, contextual locks, profiles/History/reset, responsibility identity/authority and assignment/composition).

## Known risks / assumptions

- Dayparts alone cannot infer exact urgency. This explicit initial recommendation is a reversible presentation policy to evaluate, not an assertion that After School has a known start time. Exact-time behavior remains Product's later decision.
- Personal tasks have no scheduled date; the current API derives `completedAt` from `updated_at` while status is completed, not a separate execution history. This slice deliberately preserves their collapsed completed list rather than building dated personal history or hiding older completed tasks.
- App/PeopleGroups currently combine several surfaces; avoid duplicate subscriptions, hidden extra refresh races or a new global state architecture while extracting focused views.
- Large households and wall-distance readability are not proven by this slice. C-2/C-3 must use the supplied six-person/27-inch target and server-enforced display privacy.
- Styling may be implemented differently from Design's illustrative rows, but must preserve compactness, clear owners, one focus and truthful status. Product acceptance is a human judgment after technical evidence.

## Engineering readiness

**Reviewed revision:** NOT REVIEWED
**Readiness:** NOT REVIEWED

Return one consolidated repository-grounded review of **P0-007C-1 revision 1**, including any changed baseline facts, projection/authority risks and CI-selection implications. Ordinary component organization, layout, copy and test helpers remain Engineering choices. Await Architecture ACCEPT / PROCEED before implementation.

## Revision history

- **r1 (2026-09-24):** Initial brief from the revised P0-007C proposal. First slice proves actionable personal Today and summary-first Household on accepted A/B, leaving restricted display identity and shared execution/promotion to the next two briefs. Records local-only screenshot policy and explicit C coverage in thematic CI.
