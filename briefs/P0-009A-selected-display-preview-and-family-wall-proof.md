# BRIEF P0-009A - Preview a display and judge the family board

**Revision:** 2  
**Status:** FIX REQUIRED<br>
**Integrated code baseline:** `main` / `origin/main` at `1acc4a1` (P0-008F, PR #29; P0-008E remains merged through PR #28)  
**Product input:** `PRODUCT.md` → “Family wall experience proposal,” revised 2026-10-25; Design review confirmed the scope and sequence remain unchanged.

This is the authoritative brief for P0-009A. r2 supersedes r1 before implementation. The Design review of the Project Lead's recent setup evaluation did not change the wall plan; no contract revision is needed. Engineering readiness is READY against the integrated `main` baseline above, and Architecture accepted implementation to begin. The implementation is now awaiting technical acceptance; the same-revision evidence gaps are recorded in `reports/P0-009A-r2-architecture-review.md`. Technical acceptance makes the result ready for Project Lead evaluation; it does not accept the proposed design.

## Why

The Project Lead currently helps children navigate the wall to find concrete instructions, interrupting siblings. The next working board should let each person find and complete their own next task directly. First, the team needs a trustworthy way to inspect the wall from a PC and a realistic interaction proof that can expose layout mistakes before production execution is moved into person panes.

This slice produces two connected deliverables:

| Deliverable | Content and authority | Available where |
| --- | --- | --- |
| **Selected-display preview** | Real current-day, wall-permitted data, read through an authorized member session. Browsing is local; completion is unavailable. It previews the currently shipped presentation. | Normal member app, including built releases |
| **Family-board layout proof** | One fictional fixture rendered as the current layout and proposed concept, plus fictional future Family day content. Checklist interactions are simulated in memory. | Standalone local development/test entry only |

The live wall keeps its current layout and execution behavior during this slice. The proof establishes the evidence for the next actionable-person-pane brief.

## Learning question

Can six people identify a useful next instruction and browse the rest of their day without interrupting another pane? Does the proposed three-by-two arrangement, optional enlargement, and per-pane idle return support that use while leaving credible space for future School, Meals, and Calendar information?

The arrangement, type hierarchy, density, and idle policy are candidates to evaluate. Technical acceptance establishes a usable, honest comparison; the Project Lead chooses the working direction.

## Player experience

From Household displays, an authorized member chooses **Preview display**. The selected display's name, **Preview only — changes cannot be made here**, target CSS viewport, assumption, and fit scale remain outside the simulated screen. The manager can inspect By person, By work, and actual checklist details and reopen the selected preview by URL. This is a rendering of permitted current data, not a live camera/screenshot or evidence that the TV is connected.

In the local layout proof, the Project Lead switches between **Current layout** and **Family board concept** using the same fictional six-person day and target viewport. They can select earlier/upcoming sections, scroll sibling panes independently, deliberately enlarge one person, simulate a checkoff, and try the candidate idle return. A separate **Family day — fictional concept** shows substantial future School, Meals, and Calendar content.

## Project card

**Card title:** See and test the family board before it changes  
**Suggested column:** Up Next  
**Player-facing goal:** Inspect the real wall safely and try a realistic family-board concept before choosing the working layout.  
**Done when:** The selected-display preview is usable and the Project Lead has a reproducible same-viewport comparison with the named interactions below.  
**Tracking relationship:** First outcome from the Family wall proposal. Move to Ready to Evaluate after technical acceptance; only Project Lead judgment moves it to Accepted.

## Current system

Inspected source matches integrated `main` at `1acc4a1`. P0-008F (PR #29) adds durable hosted installation-control handling; the display routes and renderers described below remain the relevant current-system baseline.

| Repository evidence | Consequence for this brief |
| --- | --- |
| `HouseholdDisplays.tsx` and member `/api/v1/displays` routes create/enroll/cancel/revoke; permission is `household.display.manage`. | Add preview to this existing authority path. A role label is not authorization. |
| `display.ts` has `getDisplayDashboard`, `getDisplayPersonDetail`, and `getDisplayOccurrenceDetail`; summary has titles/counts, occurrence detail has ordered step text/status and execution `intendedStructure`. | Reuse actual wall filtering and projection, with an explicit read DTO for preview. Do not infer steps from titles or fetch broad member DTOs. |
| Those readers currently accept `DisplayContext`; display authentication refreshes `display_sessions.last_seen_at`. | Extract a narrow shared projection input after separately authorizing the caller; do not fabricate a display session or call its authentication to preview data. |
| `main.tsx` probes `/api/v1/display/session` before member mounting. `DisplayApp` owns display session, sync, outbox, status writes and presentation. | Retain credential-class precedence. Extract presentation where needed; mounting the whole `DisplayApp` inside the member preview is unsafe. |
| D-044 current-day reads materialize/reconcile today's work. HTTP requests use the lifecycle barrier and replaceable runtime store. | Preview reads are not SQL-write-free. Preserve normal current-day generation and current runtime references while prohibiting new scheduling or execution effects. |
| `DisplayApp` uses a 30-second visible poll, 60-second stale bound, 90-second detail idle return, and generation/request guards. Member sync does not receive the display-only revoke close event. | Reuse the recovery limits; a preview cannot depend solely on a display socket it does not own. |
| `styles.css` uses `vw`, `vh`/`dvh`, and viewport media queries. Display records store no target geometry. | A scaled div alone is insufficient to simulate a fixed viewport. Target geometry is preview-local, not device configuration. |
| `nav.ts` owns app URLs. Main Playwright serves built clients; `playwright.vite.config.ts` has a separate, explicit test allowlist. | Add the preview destination to existing navigation. Route the development-only proof through Vite tests, not built-client tests. |
| `today-projection.ts`, `progress.ts`, and `completion.ts` already encode recommendation/order and Done/Not needed/Optional semantics. Screenshots are ignored under `reports/_local-screenshots/`. | Reuse domain semantics in fictional interactions; retain screenshots locally and record reproducible evidence in the Build Report. |

## Behavioral contract

### 1. Member-authorized selected-display reads

- Provide `/household/displays/:displayId/preview`, reached from **Preview display** on a non-revoked display record. Include Back to displays and normal browser Back/reload. Reuse sign-in destination restoration. A record need not be claimed, connected, or hold an active device session; preview does not claim that it is online.
- On every preview data request, require an active member session and current `household.display.manage`, then verify the selected display belongs to that session's household and is not revoked. Display-only credentials and owner-only credentials do not substitute for a member session.
- Use these member-only read routes; no preview write route is introduced:

| Method / route | Allowed result |
| --- | --- |
| `GET /api/v1/displays/:displayId/preview/dashboard` | Existing wall By person / By work summaries, family order, Unassigned and promoted-task summaries |
| `GET /api/v1/displays/:displayId/preview/people/:membershipId` | Permitted person's current recurring-work index and deliberately opened household-visible personal work |
| `GET /api/v1/displays/:displayId/preview/occurrences/:occurrenceId` | Actual current-day occurrence title/kind/daypart/accountability, ordered steps, text, obligation, source label and status/progress |

- Validate resource IDs. Use ordinary 401 for missing/invalid member session, 403 for missing capability, 400 for malformed IDs, and 404 for missing/revoked/foreign selected displays or out-of-scope person/occurrence IDs. Denials contain no foreign names or data. Nested resources are checked against the selected household, not trusted because a display ID was authorized.
- Return an explicit allowlist, not a spread of a general member/store object. Permit stable IDs needed for rendering and navigation. Omit credentials, session IDs/CSRF proofs, profile/contact details, audit/plan payloads, `intendedStructure`, structural fingerprints and other command-only metadata. Omitting command metadata is data minimization; server principal checks remain the security boundary.
- Responses include enough context to validate selected display, household date/timezone, authoritative time, activity generation and installation epoch. Capture one household date/context for a projection; do not let independently sampled midnight reads produce a mixed-day envelope. JSON envelope names are Engineering's choice.
- Set `Cache-Control: no-store`. Authorize through current runtime references under the existing lifecycle barrier. Revalidate authority after any asynchronous wait before reading; do not retain an old store/context across reset/restore.
- Shared projection functions may accept a narrow household/date read scope after authorization. No casts or fabricated `DisplayContext`, device session, or manager impersonation are acceptable. Keep D-044's existing materialization core; no second resolver/scheduler.

### 2. Projection truth and read-only presentation

- Preview and wall share the current presentation components/styles and allowlisted projection logic. Extract narrowly from `DisplayApp` as necessary. The live wall retains its existing action adapter; preview supplies a read-only data/navigation adapter. Do not maintain a lookalike renderer that can silently drift from the wall.
- Actual steps must come from the occurrence detail read. Preserve distinct occurrence IDs and each person's stored variant even when titles match. Existing current-day started survivors, group/assignment results, composed additions, school filtering, saved order and Unassigned remain authoritative.
- Only open, explicitly promoted household-visible personal tasks appear at rest. Unpromoted household-visible personal tasks require the existing deliberate **person detail** action; opening/enlarging a checklist must not reveal them. Private tasks, their IDs and counts never enter preview payloads or the inner renderer, including the manager's own private tasks. Retain existing departed-person/task exclusions.
- Read-only status is explicit. Checkoff/Not needed/claim/configuration actions are unavailable and cannot invoke member or display writes. Preview creates no pending intent and never opens, flushes, retires, or namespaces a display outbox. Keep the parent member session/sync/outbox owners intact; their existing legitimate background behavior is not a preview action.
- Preview must not enroll a device, obtain a display token/CSRF proof, alter display presence/contact/configuration, or steer physical-wall view/selection/scroll. Preserve the existing main-entry credential probe: its normal unauthenticated `/display/session` check is allowed. An active display credential still mounts the restricted display shell; the new route is not an escape into the member app.
- Ordinary member session bookkeeping and D-044 current-day materialization/reconciliation are allowed. Preview itself cannot execute/lock work, advance turns, write reports/receipts, alter activity generation, generate historical/future dates, or accept a date override. Existing History and first-action behavior remains protected.

### 3. Freshness, withdrawal, and recovery

- Use the parent member connection's relevant invalidations, reconnect and visibility recovery, plus a visible preview refresh at least every 30 seconds. No new display credential or display sync connection is needed. Polling also rechecks selected-display revocation that currently has no member event.
- Refresh visible current projections after normal work/people/schedule/task changes. Preserve a still-valid manual reading position; close only a detail whose target is no longer available. A failed detail load shows unavailable/retry, never “no work”; unrelated fresh content remains usable.
- On an observed personal-work withdrawal invalidate its exposed summary/detail before accepting replacement data; held pre-withdrawal replies cannot restore it. A sanitized task invalidation without an ID must invalidate the relevant personal-work projections, not be ignored. Pass invalidation signals, not raw member events/private IDs, to the renderer. On observed authorization loss, selected-display revocation, session/household change, reset/restore or generation/date transition, clear affected old content immediately and invalidate pending reads. Security/lifecycle clearing takes priority over position retention.
- Guard every dashboard/person/occurrence response by member/session binding, selected display, request order and accepted epoch/generation/date. A new dashboard does not make an older detail current. A delayed old response may not undo a newer result or extend its freshness.
- Retain authorized data in memory only. Use the D-045 maximum of 60 seconds from the successful request's start for data that cannot be revalidated; show stale status, then blank it. Unrelated metadata/session success does not refresh an old content payload's deadline. On resume check expiration before displaying old content; cold offline load contains no household data. Recover through fresh member authorization and selected-display reads, never by acquiring wall credentials.

### 4. A real target viewport

- Default to **3840 × 2160 CSS px · 16:9 · assumed**. Include a 1920×1080 effective-viewport option and validated custom dimensions for a known browser viewport. Distinguish assumed from user-supplied dimensions; resolution/DPR/OS scaling are not auto-detected facts about the TV.
- Dimensions apply to the rendering viewport, including `vw/vh`, media queries and wrapping. Use an isolated rendering context or a demonstrably equivalent solution. Applying `transform: scale` to a div while its CSS still resolves against the PC window does not satisfy this contract.
- The rendering context contains presentation only; it must not load `/display` or the normal authentication/outbox bootstrap. Pass only allowlisted projection data and local navigation callbacks. If frame messaging is used, validate source/origin and never transmit session/CSRF/owner material or broad member state.
- Fit the whole target uniformly into the available outer area. Resizing the PC window changes fit scale, not the target layout. Label target dimensions, provenance/assumption, selected display and fit scale outside the screen. Target choice may be retained in a local URL preference; no device/configuration/database write is needed.
- Current-layout typography/layout must match a native render at the same CSS viewport. Pointer and keyboard navigation must still work after fitting. The real preview is not a screenshot of the physical device and does not include that device's unsent local pending actions.

### 5. Standalone fictional layout proof

- Provide a development-only entry reachable with documented local commands/URL and no sign-in, display enrollment or seeded household prerequisite. Use a standalone proof bootstrap; do not mount member/display authentication, sync or outbox owners.
- The proof fixture and code entry are excluded from production output and `public/`. Production requests cannot enable them with a query flag. Application API/WS/DB access is forbidden; ordinary asset loading and Vite development tooling are allowed. Tests use isolated fictional/disposable households for the real preview; the proof itself uses no household database.
- Both **Current layout** and **Family board concept** take the same canonical fixture. The current reference uses the shared current display presenter, not an invented approximation. Switching comparisons resets or consistently shares simulated state so neither side silently has a lighter workload. Record fixture/scenario ID, target dimensions, browser/DPR and display scale with captures.
- The concept is a disposable presentation, not a new work model, router, widget system or final production board. Use existing Calm colors, typography direction and domain helpers. Make the chosen type sizes visible in the evidence; do not shrink text or silently clip work merely to claim the grid fits.
- Supply the following fixture scenarios:

| Scenario | Required content |
| --- | --- |
| **Crowded day** | Six fictional people in saved order, all with identifiable concrete next actions; at least one long name/instruction; one routine with two of five steps done and step three next; earlier unfinished work plus upcoming Homework time, House cleaning, Dinner cleanup, Bedtime and assigned pet work. These are ordinary routine/responsibility examples. |
| **State checks** | Variants showing no assigned checklist, required work complete with Optional items left, unresolved As needed, Anytime work, Unassigned outside person panes, separately labeled promoted view-only personal work, and an unavailable detail with local retry. No false “whole household done” or empty-on-error state. |
| **Future Family day** | An after-school composition with substantial School work by child, one shared Meals card, and a clearly dated early-release/no-school Calendar notice with affected people and Today/Later distinction; retain six identifiable next actions. These are fictional examples, not live integrations. Completing a Homework time routine must not complete a school assignment. |

- Start the concept at three columns by two rows. All six identities and typical next instructions must be visible at the target with no board/page scrolling. Each person has **one expanded checklist and one scroll surface**, anchored identity, compact earlier/coming-up links, and an explicit More sections path into the same pane when needed. Preserve the five named upcoming headings/context without letting a long current checklist bury all of them. Long instructions may extend within that pane; their full useful text must be reachable, not tooltip-only.
- The three-by-two arrangement is a hypothesis. If it cannot meet those reachability/interaction constraints at readable sizes, retain the comparable initial capture and demonstrate one reasoned alternative. Record why; do not silently declare tiny text, lost context, or clipped work acceptable. The Project Lead chooses the future working arrangement. Six is the fixture target, not a limit on the live preview's roster.

### 6. Prototype interaction contract

- Initial checklist recommendation follows `projectPersonalDay`: in-progress scheduled work first, stable daypart order, then unfinished Anytime fallback. Preserve step order. “Next” is a suggestion, not an invented time deadline. A person's name/order remains stable after completion. Keep By work reachable through the existing reference presentation.
- Earlier/upcoming links change only their own pane, compact its prior checklist and preserve reading positions. Manual browsing pauses automatic repositioning there; **Back to next task** deliberately resumes the recommendation.
- Simulate one-tap Done and Reopen, and a distinct Not needed action for As needed steps, using existing completion/progress helpers. Use a small in-memory action adapter with a deterministic hold/settle/reject control for the evaluation; no persistent fake outbox or new service. Optional items do not falsely block domain completion; Not needed does not count as performed Done.
- A pending final action keeps its checklist reachable. After settlement and once interaction is idle, a suggestion may advance without moving another checkbox under the pointer or stealing keyboard focus. Rejected action feedback remains discoverable when its section is compacted. Simulated refreshes update facts without repositioning a manually browsed sibling pane.
- Only the visible person-header/**Enlarge** control takes over the screen. Keep the person's name and **Back to family** prominent. Enlarge at the same section/reading position, then restore every pane and return keyboard focus to the originating control. Body text/background/scroll release never checks a box or enlarges a pane.
- Start candidate per-pane idle return at 90 seconds with a controllable test clock. User activity resets only that pane; refreshes do not. Active gestures, keyboard interaction and an unsettled final action postpone return. After settlement and inactivity, only that pane returns to its recommendation. Enlargement pauses the hidden board's timers; its own 90-second idle Back to family preserves board positions. These are prototype candidates for evaluation, not changes to live wall idle behavior.
- Use visible focus, descriptive names, non-color status cues and reduced-motion behavior. In target coordinates, interactive targets are at least 48×48 CSS px with no overlap. Check both keyboard and touch-event scrolling/checkoff; a mouse on a phone preset is not touch evidence. No physical simultaneous-multi-touch or distance-readability claim is made by emulation.

## Implementation boundary

Narrow shared projection/presentation extraction, three member preview reads, preview navigation/viewport host, isolated fictional proof, focused evidence and validation selection. Likely files include `display.ts`, `app.ts`, `route-policy.ts`, `HouseholdDisplays.tsx`, `DisplayApp.tsx`, `nav.ts`, styles and Playwright/Vite configuration. Engineering chooses module names and data-envelope shape.

No migration, new grant, runtime package, external service, device setting or production family-board replacement is expected. Preserve session/outbox owners above destinations. Document any prerequisite conflict in the single readiness pass.

Build the interactive proof early enough to show the Project Lead concrete examples while independent preview work continues. Do not make Engineering wait for subjective design approval to complete this technical contract. The subsequent actionable-person-pane brief does require the Project Lead's checkpoint response.

## Do not change

- Existing display enrollment/principal separation, action authority and device/unknown-performer attribution; member authority elsewhere is unchanged.
- Assignment/resolution/coverage, first-action locks, immutable started/history evidence, pending-action replay and retirement, departure, task promotion/privacy, reset/restore, epoch/generation fencing or root-route behavior.
- The production wall layout or idle policy. Shared extraction is allowed only with existing behavior preserved.
- Live homework/projects, Meals/Calendar ingestion, coverage authoring, exact-time scheduling, automatic scene changes, dashboard builders or kiosk infrastructure.
- Production/live household data, deployment, Git publishing or merge. Suggest a commit message; the Project Lead commits.

## Acceptance tests

The rows below are the r2 evidence contract. Named fixture/transition variants are required; explicitly allowed alternative UI responses remain implementation choices. Combine variants in parameterized tests and reuse existing fixtures/helpers where useful. Test-file names below are planned locations, not mandatory file organization. Report PASS/PARTIAL/NOT RUN per subrow and identify any unproven variant; passing totals or test titles alone do not establish a row. This matrix does not require one browser test per variant or a new copy of every protected regression suite.

Evidence locations: **I** = `tests/integration/p0-009a-display-preview.test.ts`; **P** = `tests/e2e/z-p0-009a-preview.spec.ts` (built preview); **G** = `tests/e2e/z-p0-009a-geometry.spec.ts`; **L** = `tests/e2e/z-p0-009a-proof-vite.spec.ts` (development proof). Unit/domain reuse is named where appropriate.

| ID | Initial state → action | Required observable | Named evidence | Result |
| --- | --- | --- | --- | --- |
| AT1a | Member with display grant; own claimed and never-claimed records → read all three preview routes | Both own records preview without device session/contact; current member capability authorizes access | I: authorized claimed/unclaimed preview | NOT RUN |
| AT1b | Anonymous, display-only, owner-only, and member without grant → same routes | 401 for no valid member, 403 for no grant; no payload or side effect | I: preview principal/capability matrix | NOT RUN |
| AT1c | Authorized caller → malformed, missing, revoked and foreign display IDs; foreign person/occurrence, old-day occurrence IDs under own display | 400/404 as specified; no names/data escape; validate nested ownership on every route | I: selected-display and nested-resource isolation | NOT RUN |
| AT2a | Current-day routine with distinct per-person variants plus composed responsibility → summary/person/checklist reads | Actual ordered text/status/obligation/source and identity match existing wall reads; equal titles are not merged; preview DTO contains only allowed fields/context | I + P: actual detail parity | NOT RUN |
| AT2b | Private (including viewer's own), promoted, unpromoted and completed tasks; departed person; roster over six → read at rest and deliberate person detail | Privacy/placement/withdrawn-person rules hold in raw JSON and UI; no six-person truncation; checklist detail does not reveal unpromoted personal work | I + P: display privacy and placement | NOT RUN |
| AT3a | Quiescent household/empty queues; record credentials, contact/config, actions/receipts/history → preview and navigation | No display token/CSRF or display bookkeeping/action write; member session bookkeeping and ordinary current-day materialization only. Isolate these calls from the wall's own polling when comparing presence. | I + P: preview side-effect boundary | NOT RUN |
| AT3b | Member preview and separate wall with existing pending intent → browse preview and attempt its status controls | No preview mutation requests or queue entries; wall route/selection/scroll/queue unchanged by preview. Wall's own pending action can still settle through its existing adapter. | P: preview does not steer or execute | NOT RUN |
| AT4a | Controlled new household date before any Today read; prior/future evidence present → preview repeatedly and attempt date query override | Only actual today materializes idempotently; normal reconciliation allowed; no arbitrary-day generation, started lock, report/status/turn/history mutation or mixed-date context | I: D-044 current-day parity | NOT RUN |
| AT5a | Preview detail open; second authorized context changes a step and shared current-day work → invalidation/refresh | Actual preview status/text converges without reload; valid manual selection stays; disappeared detail becomes unavailable/retry or closes to its parent | P: real work update and detail recovery | NOT RUN |
| AT5b | Promoted task shown to a different member; hold old preview payload → owner makes it Private, sanitized invalidation/fresh result arrives, old reply releases | Withdrawn summary/detail and private IDs/content cannot reappear; sanitized notification is not ignored; ordinary private-only data is never passed into the renderer | P: held personal-work withdrawal | NOT RUN |
| AT5c | Loaded preview → remove grant, revoke selected display, expire member session (separate variants) | Observed denial clears immediately; absent event triggers revalidation within 30 seconds while visible, with the 60-second stale bound if the response is unavailable; held pre-denial reply cannot repopulate | I + P: authority-loss variants | NOT RUN |
| AT5d | Hold dashboard/person/occurrence replies → change selection, roll household date, or clear activity generation (separate variants) | New context wins; old detail cannot overwrite it or resurrect previous-day/erased content; no stale position restores old data | P: selection/date/generation fences | NOT RUN |
| AT5e | Hold old preview response → reset or restore disposable household; reauthenticate (separate lifecycle variants) | New epoch/session cannot accept old payload even if names repeat; old credentials fail new reads; new runtime/store is used | I + P: preview reset/restore epoch fence | NOT RUN |
| AT5f | Successful preview then failed refreshes/disconnection → advance clock beyond 60 seconds, resume, release delayed response, reconnect | Stale then blank; arrival cannot renew an old request's deadline; cold load has no cached content; fresh authorized reads recover without reload/device credentials | P: preview stale deadline and recovery | NOT RUN |
| AT6a | Member deep link in built and Vite apps; also signed out → refresh/sign in/Back | Selected preview restored; Back goes to displays; no root-route modification; active-display bootstrap precedence remains protected | P + Vite smoke: saved preview destination | NOT RUN |
| AT7a | Native current renderer and fitted preview at 3840×2160, then 1920×1080; resize outer window 1280→1600 wide | Target viewport/media-query results, normalized geometry and computed typography match native reference and do not change with outer resize; only uniform scale changes | G: native-versus-fitted viewport parity | NOT RUN |
| AT7b | Default/custom target and scaled frame → invalid input, pointer detail navigation, keyboard Back | Dimensions/assumption/scale/Preview-only visible outside frame; invalid dimensions rejected; interactions hit intended controls without changing wall settings | G: preview controls and scaled input | NOT RUN |
| AT8a | Canonical crowded fixture → current/concept toggle, reset simulation and capture | Identical people/work/status/viewport; reference uses shared current presenter. Produce matching captures and scenario/viewport metadata, not an unrelated attractive mockup | L: comparison parity; local screenshot pair | NOT RUN |
| AT8b | Standalone proof in development → exercise all controls; request it in built release | No application API/WS/storage/DB/credential use (assets/HMR allowed); production cannot display/enable fixture or proof entry; no fixture under shipped public assets | L network/storage assertions + built absence assertion | NOT RUN |
| AT9a | Crowded scenario at both target presets → inspect and scroll | Demonstrated concept has six identities and typical concrete next instructions visible, step 3/5 plus earlier unfinished and five upcoming headings reachable; long text reachable in-pane; no concept-board page scroll, hidden work or second nested pane scroller. Record type sizes. If initial 3×2 fails, preserve its evidence and meet these reachability constraints with the single justified alternative. | L/G: crowded board reachability; concept captures | NOT RUN |
| AT9b | State-check variants → inspect/retry | Empty vs complete-with-optional vs As needed/Anytime are distinct; Unassigned remains outside panes without Claim; promoted personal work is view-only and outside recurring counts; loading failure is not empty | L: truthful state variants; domain-helper reuse | NOT RUN |
| AT10 | Two panes at different sections/offsets → earlier/upcoming/More sections and sibling interaction | One open checklist and one scroll surface per pane; only target pane changes; full timeline reachable; Back to next works | L: independent pane navigation | NOT RUN |
| AT11 | Scrolled panes → deliberate Enlarge, Back and enlarged idle return; also touch drag/release | Same section/reading positions restored, identity/Back visible, focus returns to trigger; background/drag release neither enlarges nor checks off | L: enlargement and touch boundaries | NOT RUN |
| AT12a | Fictional checklist → Done, Reopen, Not needed; hold final action then settle/reject | Domain counts/optional behavior truthful; pending final remains reachable; no focus/target jump during interaction; error discoverable after compaction; zero real write | L: simulated action feedback; completion/progress helpers | NOT RUN |
| AT12b | Two panes, manual browsing/active gesture or pending final → clock advance and simulated refresh | Only eligible inactive pane returns after candidate 90 seconds; refresh does not count as activity; active/pending pane stays; sibling selections persist. Enlarge pauses hidden-board timers. | L: deterministic per-pane idle candidates | NOT RUN |
| AT13 | Future Family day → inspect/expand and simulate Homework time completion | School has useful child-specific work, one shared meal and dated affected-person calendar notice coexist with six next actions; all labeled fictional, school assignment remains separate | L: fictional future composition; local capture | NOT RUN |
| AT14a | Keyboard, touch events and reduced motion at target geometry → section/action/enlarge/return | Visible focus, descriptive labels and non-color states; ≥48×48 target-coordinate hit areas, no overlap; touch scroll cannot check off; motion respects preference | L/G: input/accessibility proof; record emulation limits | NOT RUN |
| AT14b | Final implementation → list and run selected new tests plus exact PR/RC scripts | Built preview tests run on Chromium and WebKit; proof runs on Chromium/Vite desktop with touch-event case; no production/dev test misrouting; protected suites and exact gates pass | Config/scripts, selection listing, logs and named existing regression assertions | NOT RUN |

### Validation routing and report

- Existing main Playwright projects serve production-built clients. Put real-preview journeys there, with appropriate desktop viewport selection, and retain a narrow phone display-management entry check. Explicitly select the geometry files in the relevant desktop/display projects. Run new live-preview recovery journeys in Chromium and WebKit.
- The proof runs only in development through `playwright.vite.config.ts` or a small equivalent dedicated Vite configuration, explicitly selected by PR and RC. Its desktop and touch-event cases must not silently execute only in the default phone preset. Keep the proof out of built-client test matching. A production proof-absence assertion belongs with the built tests.
- Supply a focused P0-009A built-preview command and `E2E · Display preview P0-009A` CI job; route the proof through the Vite job. Update the aggregate `Pull-request validation` needs **and** result list. Avoid accidentally running the new suite again in the legacy phone-core shard. Exact command names and project names are Engineering choices; record `--list` evidence for both paths.
- Run `npm run validate:pr` and `npm run validate:rc` on the final implementation. Existing C-2/C-3A/C-3B privacy, execution, pending-action, withdrawal and lifecycle suites remain regression evidence; cite the relevant assertions instead of rebuilding all those matrices. Add only focused evidence for changed shared adapters/projections. No live DB or hosted deployment is required.
- For held-response/lifecycle browser evidence, finish the server read before delaying its delivery to the browser. Do not deadlock reset/restore by indefinitely holding a request's shared lifecycle lease while waiting for replacement. Bound waits and release held responses in test cleanup; use controlled clocks for stale/idle cases.
- Local technical review does not require an Actions URL before the Project Lead publishes. Record CI as NOT RUN until authorized push; a configured job is not a passed remote run. Once published, existing merge rules apply.
- Build Report: `reports/P0-009A-r2-build-report.md`, with row-level mapping, exact final-tree gate results, local commands/URLs, known limits, and a concise recommendation for what the prototype evidence suggests. Use `reports/_local-screenshots/p0-009a-r2/`; do not commit screenshots/logs or rewrite prior evidence.

### Project Lead visual and interaction checkpoint

Provide reproducible current/concept crowded captures at **the same** 3840×2160 target and the 1920×1080 comparison, an enlarged-person capture and a future Family day capture. Browser controls/fit labels must identify which target is represented; screenshots alone do not establish physical readability.

The local proof must let the Project Lead perform this short walkthrough:

1. Find each person's next instruction without adult navigation; compare it to Current layout.
2. Put one pane at step three and another at an earlier section; navigate/scroll one and check the other stays put.
3. Simulate final-step pending/success/failure, reopen it, and try Not needed.
4. Enlarge deliberately and return; accelerate idle while another pane is active.
5. Inspect the future School/Meals/Calendar composition and decide whether it leaves adequate space for six next actions.

Record actual feedback, target viewport and who evaluated in an evaluation note after the checkpoint. Do not prefill success. Technical acceptance may precede this human judgment; **the next actionable-pane brief waits for it**. Physical 10/16-foot readability and actual simultaneous touchscreen use remain separately unproven.

## Dependencies

Integrated P0-008E and existing C-2/C-3A/C-3B foundations are present. No physical screen, hosted account, schema migration or new service blocks this slice. The actual TV's effective browser viewport is unknown; the preview labels assumptions rather than guessing.

## Relevant decisions

D-041–D-049, D-050–D-056, and D-057–D-059 as refined for r2.

## Known risks / assumptions

- “Manager” in this brief means an active member with the display-management capability; classification or Manager preset alone is not a grant check.
- A same-origin iframe is not an authority boundary. Server checks and minimal data adapters enforce scope; isolated viewport rendering addresses geometry.
- Existing `main.tsx` credential probing and parent member outbox work are legitimate and must not be broken to satisfy overbroad “zero requests/writes” assertions.
- The proof can establish interaction feasibility and expose density problems, but cannot prove child independence, final aesthetics, physical legibility or actual multi-touch from automated geometry.
- No broader layout alternatives or abstraction framework are required. Demonstrate one focused concept, and one reasoned alternative only if the starting arrangement cannot meet the stated constraints.

## Engineering readiness

**Reviewed revision:** 2<br>
**Readiness:** READY<br>
**Review:** `reports/P0-009A-r2-engineering-readiness.md` (initial consolidated pass against `main` at `1acc4a1`)

**Architecture disposition:** ACCEPT / PROCEED (2026-10-27). Engineering may implement P0-009A r2 locally on this brief branch. No hosted deployment or production-wall replacement is authorized by this disposition.

**Architecture acceptance review (2026-10-28):** FIX REQUIRED against the unchanged r2 contract. The evidence pass closes most previously open rows; remaining closure is limited to AT3b pending-intent settlement, AT5d/AT5f held-response races, AT7a FHD geometry parity, AT9a/AT13 six-action visibility, AT11/AT14a actual touch input, and AT14b final-tree gates. See `reports/P0-009A-r2-architecture-review.md`. No hosted deployment or production-wall replacement is authorized.

## Revision history

- **r1:** Initial selected-display preview and fictional family-board proof.
- **r2:** Architecture self-review: made live/prototype boundaries explicit; specified preview read authority/context and shared presentation; corrected viewport, bootstrap, contact and materialization assumptions; added a useful simulated-action/layout checkpoint; split evidence into judgeable subcases; corrected development/production/CI selection and kept human acceptance separate. Refreshed the repository baseline to `1acc4a1` after P0-008F merged; Design confirmed no change to scope or sequence. Engineering readiness READY and Architecture ACCEPT / PROCEED on 2026-10-27; no contract change.
