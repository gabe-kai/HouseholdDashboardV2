# BRIEF P0-006A - Calm Household Experience Foundation

**Revision:** 2
**Status:** READY

A material contract change increments the revision and requires Engineering readiness for that revision. This file is the authoritative contract; r2 supersedes r1. Technical acceptance and Project Lead/Product acceptance remain separate.

## Why

The existing household workflows work, but too much phone space goes to page chrome, repeated metadata, success banners, and exposed editing controls. This first P0-006 slice makes everyday navigation and routine management compact and consistent. Contextual steps, profiles, and History changes will follow using the same interaction patterns.

## Learning question

Can a parent understand a routine and make ordinary corrections on phone or desktop without searching through a long form, while a child can still execute and personalize permitted work reliably?

## Player experience

Today, Plan, and Household feel like parts of one application. A parent opens a routine, understands who does it and when, selects Edit, and adjusts one section at a time. Steps can be dragged or moved with accessible controls. Save makes the result visible on other devices; ordinary feedback disappears after acknowledgment. Errors, pending work, and important access information remain available when needed.

## Project card

**Card title:** Make Household Dashboard compact and natural

**Suggested column:** Up Next

**Player-facing goal:** Understand and edit routines comfortably on phone or desktop within one calm household application.

**Done when:** Routine summaries and ordinary editing fit comfortably on a phone, steps are easy to reorder by touch and keyboard, and household navigation and feedback feel consistent. Technical completion moves this card to Ready to Evaluate; Product evaluates the experience separately.

**Tracking relationship:** First of the three planned slices contributing to P0-006 Household Experience Consolidation.

## Current system

Inspected baseline: integrated `main` at `31aad37` (P0-005 r3 merge). These are implementation facts, not proof that the requested UX already exists.

- `src/client/App.tsx` owns session, synchronization, checklist outbox integration, and local primary/nested destination state. Plan currently appears as **Routines** and is gated by `routine.shared.manage`. Household offers People & Groups, activity, Approvals, and History under existing grants; Personalize and Preview are reached from Today.
- `Routines.tsx` owns list/detail/ended/create/edit/picker states. Drafts carry routine steps and logical IDs, and upcoming editing additionally carries a schedule-entry ID/date. Separate request generations and version-aware detail application protect against stale reads after the P0-005 upcoming-delete defect.
- Shared-step order is already an ordered payload. Direct Personalize in `App.tsx` separately orders personal additions with before/after/end anchor metadata. It does not let a child reorder inherited shared steps. Both currently expose Move up / Move down buttons.
- `PeopleGroups.tsx` has focused person/group/access states. One-time enrollment material is displayed inline in the access workflow; it is not an ordinary success message.
- `styles.css` already has Calm Household tokens and phone/wide navigation treatments. Consolidation is incremental: the global header remains prominent, routine status messages persist, and repeated view markup remains in the three large client files. Inspect computed styles when normalizing tokens: `--line` currently serves conflicting line-height and border aliases, and body-level overflow hiding can conceal layout failures.
- Saved data is server-authoritative. Existing API/WS invalidation, household dates, locks, migrations through `008`, and ordered IDs supply the domain behavior. `src/server/app.ts` already serves the built SPA for non-API GET fallbacks; destination URLs themselves are not implemented.
- `playwright.config.ts` currently uses phone device presets for both Chromium and WebKit. Desktop and touch-drag evidence need deliberate coverage; a narrow viewport with mouse events is not touch evidence.

## Behavioral contract

### 1. Bounded shared presentation

- Use Today / Plan / Household as the primary destinations. Plan opens the Routines list directly, headed **Routines**; no extra one-item landing page. Preserve current grants: shared managers see Plan, and other members retain Today, permitted Household areas, personal tasks, Personalize/Preview, and account access. Do not add empty Schedule or Settings destinations ahead of P0-006B/C.
- Apply shared shell, heading/Back, action, row, status, and focus conventions to existing surfaces. The deeper redesign is limited to shared routine reading/authoring and existing reorder controls. People & Groups, Approvals, History, personal tasks, and authentication retain their current domain workflows and information.
- Reuse the existing warm restrained theme and normalize actual conflicting styles. Share behavior where duplication warrants it; the brief does not require one component per visual element or a new confirmation framework. No standalone design-system package, schema migration, or API mutation change is expected.

### 2. Responsive layout and quiet chrome

- Layout follows the viewport automatically. Phones have compact labeled bottom navigation; wider screens use a restrained top or side treatment with readable content width. Only the visible navigation participates in focus/accessibility. Resize preserves the selected resource and any draft; it does not remount the application or discard work. No layout-mode preference is introduced.
- The normal header identifies the view and provides a concise signed-in account affordance. Full identity, household date/timezone, and environment details are available from Account. Retain a truthful compact Local development indication in local use; do not display it on a release profile. Remove persistent healthy Online text/rows and duplicate headings.
- Offline, reconnecting, pending, and rejected intent stay visible and actionable. Copy distinguishes queued checklist actions from administrative drafts: a failed routine save must never promise that it will automatically sync later. Existing pending-work sign-out protection remains.
- Back is integrated with the page heading. Returning from an editor/overlay restores focus to a useful trigger or row; ordinary live refresh does not repeatedly steal focus. Today execution controls and status cues remain usable.

### 3. Saved destinations and navigation safety

- Required addressable views are Today, Plan/Routines list, routine detail (including retained Ended detail), Household directory, People & Groups overview, person detail, and group detail. Use stable definition/membership/group IDs, never names or list positions. Other existing secondary views remain reachable through normal navigation; adding detail routes for new History/Approval concepts is outside scope.
- Engineering chooses and documents the URL syntax and route adapter. Links must reload in both local Vite development and the locally served built app. Browser Back/Forward follows actual navigation history; in-app Back goes to the logical parent even after direct entry. An entry URL must not create redirect/back loops.
- A copied local destination opened while signed out resumes after ordinary sign-in, subject to the new session's grants. Never render cached data from another identity. Unknown/deleted/foreign/unauthorized targets give a generic unavailable view with a permitted return path; ended routines remain readable under existing authorization. URLs contain only route identifiers, not names, credentials, tokens, or drafts.
- Leaving the whole dirty editor through primary navigation, parent Back, or browser navigation offers Keep editing / Discard, counting outstanding subsection edits as dirty too. Keep editing retains the resource, mode, URL, and draft; Discard leaves without writing. Back within a focused section follows section 5 instead. For document reload/close, use the browser's supported unload warning rather than promising draft recovery. No draft persistence or cross-device draft synchronization is required.
- Session/outbox/sync owners stay above destinations. Resource loads and mutation completions remain keyed to session and target; delayed responses cannot navigate the user back, overwrite another resource, or show an unrelated success toast.

### 4. Routine reading and compactness

- List/detail show the applicable current title, concise recurrence/daypart, selected audience sources with resolved people, and step count/order. Keep today's audience distinguishable from dated pending group membership; use existing display names. Do not flatten groups, use the latest future revision as today's title, or equate an empty group with missing source intent.
- Detail is read-only, with Edit as its primary action and Schedule for later / End / eligible Delete under More. The upcoming section exists only for actual future entries. It remains date-ordered and exposes each entry's saved title, steps/obligations (directly or through a focused read view), Edit, and Delete; creation stays available under More even when there are no upcoming entries.
- Steps use compact ordered rows with obligation information as needed. No per-step large card, repeated blank labels, or permanently exposed text/select/delete controls. Long lists may collapse with an accurate count and Show all; all steps remain inspectable. Preserve read-only ended/unavailable states.
- **Reference density check:** use a fictional routine with a title up to 40 characters, one group resolving two people, eight one-line steps up to 40 characters each, and no upcoming change. At 390 x 844 CSS pixels/default text, the initial detail viewport shows title, When, Who, step count, at least five steps, and a reachable Edit action without scrolling or overlay obstruction. The create/edit summary shows Name, When, Who, Steps and its Save/Create action in that viewport. This is a reference check, not a fixed-height layout: at larger text or with long real content, allow scrolling and wrapping instead of clipping, shrinking text, or reducing hit areas.

### 5. Focused editing and draft ownership

- One draft spans the Name / When / Who / Steps summary and focused sections for create, current edit, and upcoming create/edit. The UI always identifies current editing versus a change starting on a household date. Date controls appear only for intentional scheduling/moving; preserve r3 collision alternatives, rollover recovery, and repeated same-date editing.
- Focused sections use a working copy: Done applies that section to the parent draft; Cancel/section Back discards only that section's unapplied changes and preserves all other sections. Browser Back that returns within this editor follows the same section behavior. Neither writes to the server. Steps opens a compact list; selecting a row opens text/obligation editing with the same Done/Cancel semantics, and adding/removing a row changes only the local working copy. Done on Steps returns to the summary; final Create/Save persists the whole routine through its existing commands. Outer Cancel/navigation protects the whole dirty draft. Do not confirm ordinary field/step edits or reordering.
- Validation points to the relevant section/field, preserves the draft, and provides useful focus. Preserve surviving logical step IDs and give unsaved rows stable local identity; duplicate labels and reordering must not confuse row state or mint replacement IDs for existing steps.
- Sync refreshes read views without replacing a dirty draft or silently advancing its saved base version. An external edit/end/delete or save failure retains local content and explains the conflict/unavailability with an explicit recovery path. Failed saves produce no success toast; acknowledged saves remain acknowledged if a later read fails. P0-005 current ranges, locks, and scheduled-change command behavior remain authoritative.

### 6. Reordering

- Support pointer and touch drag from a dedicated handle in shared routine draft step lists, including upcoming drafts. Show lift/drop feedback, autoscroll near the visible container edges, and deterministic final order. Scrolling from outside the handle remains normal. Canceling a drag (Escape or pointer cancellation) restores the pre-drag order and focus without losing field edits; no mutation is sent for a drag.
- Provide a non-drag alternative usable with keyboard and touch, such as a per-row menu with Move up/down. This alternative must not permanently occupy every row with large buttons. Announce item/position and keep focus with the item; handle first/last boundaries safely.
- Reuse the interaction on the existing direct-personalizer additions list. Moving an addition changes its existing order field only; its shared-anchor relationship, obligation, identity, effective-date policy, and authority remain intact. Different anchors can still determine composed placement. No dragging of inherited shared steps, new proposal reorder power, or personal-editor redesign is authorized.
- Draft movement is immediate; only the owning surface's explicit save persists order. Cancelling the draft leaves server state unchanged. Repeated or duplicate labels, a long list, and switching routine targets cannot corrupt identity or order.

### 7. Feedback with durable meaning

- Ordinary successful mutations emit one accessible, non-blocking acknowledgment after server success, including after the action's own editor-to-detail transition. Use one documented short default lifetime (about five seconds); dismiss on unrelated navigation, identity change, or superseding feedback. Do not replay toasts from WS invalidations or create one for every checklist tap. Toasts do not steal focus or hide actions.
- Errors, pending/rejected commands, date/version conflicts, and information needed to understand protected/started work are not disposable success. Keep an appropriate inline state or an ordinary route to that information. Preserve effective-date/Preview discoverability for personal changes after removing the global success banner.
- Enrollment tokens and one-time setup instructions remain in the existing access view long enough to copy; never put the only copy in an expiring toast or a URL. Keep real secrets/identities out of committed screenshots and reports.
- Retain one clear confirmation for Delete upcoming, Delete routine, End routine, and leaving a dirty outer draft. Cancellation causes no mutation. Confirmed lifecycle success must reflect authoritative state; a toast cannot substitute for removal of the deleted entry or a reported server error.

### 8. Accessibility and saved continuity

- All actionable controls/row hit areas meet the existing 44 x 44 CSS pixel minimum. Keep readable contrast, labels, semantic headings, visible focus, non-color state cues, reduced-motion handling, menu/dialog focus return, and accessible reorder announcements. Visual density comes from less chrome and duplication.
- A committed edit/order updates another authenticated browser context through existing synchronization without reload. Preserve per-person started snapshots, current/unstarted reconciliation, pending first-action intent, and private-task isolation through navigation, resize, reconnect, and identity changes.

## Implementation boundary

- Client: `App.tsx`, `Routines.tsx`, `PeopleGroups.tsx`, `styles.css`, and a small local UI/navigation area as justified. Keep domain/date/permission logic outside presentation primitives. Reuse current APIs and stable IDs.
- Routing and drag implementation are Engineering choices. A suitable dependency may be justified by accessibility/reliability and maintenance cost; record bundle/runtime/license consequences. No service, paid account, new backend architecture, or mandatory UI package is needed.
- Adapt tests to new labels/interaction paths while retaining the behavior they assert. Extend `docs/protected-behaviors.md` for changed navigation, drafts, feedback, and ordering; keep existing escaped-defect coverage, especially upcoming deletion and populated receipt migration. No live household database is a test fixture.
- Internal sequence: establish shell plus one list/detail/summary/step flow; apply the same conventions to remaining existing views; prove state preservation and local browser evidence. These are implementation checkpoints within this brief, not extra approval stages or speculative briefs.
- Write factual implementation discoveries to `ARCHITECTURE.md`. Readiness report: `reports/P0-006A-r2-engineering-readiness.md`; Build Report: `reports/P0-006A-r2-build-report.md`; new fictional screenshots: `reports/p0-006a-r2-screenshots/`. Prior evidence directories stay untouched.
- Planned branch remains `brief/p0-006a-calm-household-experience-foundation`, based on the integrated P0-005 r3 baseline plus committed planning. Suggest a commit message but do not commit. The Project Lead manages branch, push, merge, and deployment operations.

## Do not change

- Auth/enrollment, capability separation, household/private-data isolation, Origin/CSRF/session protections, fixture-free bootstrap, cleanup safety, receipt/replay semantics, and server-owned persistence.
- Routine identity; current-plan intervals and upcoming create/edit/move/delete; first-action/undo locks; safe Delete vs End; historical evidence; dated group sources; personal/proposal scope, anchors, and tomorrow-floor. UI consolidation does not authorize repairs by rewriting the database or discarding stored future entries.
- P0-006B/C own applicability/calendar rules, profile fields/email/birthday, family display order, new History retrieval/grouping, and activity-history clearing. No placeholder controls for these appear in A.
- No full Multi-Responsibility Today, new responsibility domains, assignment engine, notifications, meals/homework, multi-household behavior, branding exercise, generic design system, synchronized drafts, QR handoff, native/PWA app, or hosted test iteration.

## Acceptance tests

Each row is required and maps to named evidence in the r2 Build Report. Existing regression evidence can be reused for unchanged behavior; tests for new UI behavior must use that UI. API setup and assertions may support a journey, but cannot replace its user actions.

**Bounded evidence matrix:** Run the connected routine journey in Chromium and WebKit at 390 x 844 (touch-enabled) and 1280 x 800 (desktop input). Check responsive layout/resize at 360 x 800 and 768 x 1024, plus 200% text on representative detail/editor/Today screens; these supplemental geometry checks need not duplicate every journey in both engines. Exercise actual touch-event drag separately from mouse drag; record browser/input coverage. A phone viewport alone or calling the reorder handler is insufficient. Physical-phone/assistive-device evaluation is useful Product evidence but is not a deployment or implementation prerequisite.

| AT | Required evidence |
| --- | --- |
| 1. Shell and access | Navigate Today -> Plan/Routines -> Household and existing permitted children; verify Plan goes directly to Routines. Shared manager, direct personalizer, proposal-only member, and a structure/enrollment role without shared-manage retain correct reachability. Resize an open draft and navigate with pending checklist work: identity, draft, and pending intent survive; hidden duplicate nav is not focusable. |
| 2. Quiet and truthful status | Healthy chrome is compact with no Online/date/timezone rows. Account exposes these details; local/release indication is truthful. Offline/reconnect/pending/rejected states remain visible, sign-out protection works, and an offline routine save keeps the draft without claiming a queued save. |
| 3. Addressable views | Reload/copy every required view in contract section 3, including one ended routine; test ordinary sign-in return and browser Back/Forward versus parent Back. Exercise locally served build and Vite smoke. Deleted/foreign/unauthorized IDs disclose no target content and offer a permitted return; changing account never flashes the previous member's private data. |
| 4. Density and consistency | Use the reference fixture to assert the section 4 first-viewport criteria at 390 x 844. Capture phone/desktop detail, summary, and Steps states. Inspect Today, Household directory, People/group/access, Approvals, History, Personalize/Preview and sign-in for consistent headings/actions/statuses; retain their existing information. Test long wrapped content without body overflow masking. |
| 5. Focused draft | Through UI create and edit Name, When, Who and Steps. Done/Cancel for a subsection behave as specified and send no save; final Save persists. Test duplicate step labels, local new-row identities, obligation edit, row removal, section validation, dirty outer cancel, and changing target. No confirmations for ordinary field/step work. |
| 6. Shared step order | Reorder a long list with pointer and touch, including edge autoscroll; cancel one drag and one entire draft, then save a reorder. Verify exact persisted logical-item order and no dropped/duplicated text or obligations. Cover current and upcoming drafts and an unstarted versus started child; saved order reaches a second open browser without reload. |
| 7. Non-drag/personal order | Keyboard and touch-accessible non-drag controls move the same item with position announcements, focus retention, safe boundaries, and matching order. Direct Personalize reorders additions without changing their IDs/anchors/authority; shared items cannot be moved. Preserve preview and future-effective meaning. |
| 8. Draft recovery and stale data | Leaving the whole dirty editor via primary nav, parent Back and browser Back offers Keep/Discard, including changes only in a subsection; Keep preserves URL/mode/text. Section Back preserves other sections. With two contexts, an external edit/end/delete or delayed response cannot erase/rebase the draft or affect the wrong target. Failed save preserves input/error; unrelated navigation suppresses late toasts. Preserve pending first action through navigation/reconnect. |
| 9. Feedback and access | A server-acknowledged save emits one toast across its own transition, expires, and clears on unrelated navigation/sign-out; WS replay adds none. Errors/conflicts and protected-work explanations remain recoverable. Personal effective date/Preview stays reachable. A fictional issued setup token remains copyable past the toast lifetime; omit it from artifacts. |
| 10. Routine lifecycle in new UI | Through More and the new editor, create/re-edit/move/delete an upcoming entry; collision keeps draft and explicit choices. Check current-versus-future title/steps, date rollover recovery, confirmation cancel, successful section removal, and a simulated failure with no false success. Exercise Delete unused and End used with retained started/history behavior. Keep prior populated migration/receipt regression tests. |
| 11. Accessibility and connected journey | Both engines/input layouts cover sign-in -> Today -> Plan -> detail -> focused steps -> reorder -> save -> Household -> People & Groups/History -> Account. Check target geometry, contrast, names/headings, visible focus and return, reduced motion, wrapped/200% text, and safe-area/bottom-nav clearance. Record which accessibility aspects were automated or manually inspected; do not claim full screen-reader certification from DOM assertions. |
| 12. Regression and artifacts | Exact `npm run validate:pr` and `npm run validate:rc` pass with protected P0-001–P0-005 evidence retained. Tests may update selectors and new presentation expectations but must preserve authority, outbox, lock, lifecycle, migration and historical assertions. Prior screenshots have zero diff; map ATs to test names/artifacts, record dependency choices and NOT RUN checks, and include the Project Lead's commit state accurately. |

The Build Report includes concise phone-density measurements and representative screenshots, not just a count of passing tests. Product evaluates whether the connected experience is comfortable and coherent; Architecture acceptance is against the observable contract above.

## Dependencies

- Accepted P0-005 r3 integrated at `31aad37`, existing Node 24 toolchain and local database/PR/RC commands, and the supplied Planning & Design P0-006 proposal.
- The P0-006A planning files must be committed before Engineering implementation to keep the planning baseline identifiable. No external account, new design service, physical phone, or deployment is required.

## Relevant decisions

- D-004/D-011: server/outbox truth and local-first validation.
- D-006/D-008/D-016: membership authority, personal composition, and focused views.
- D-020/D-023–D-025: routine identity, locks, current-plan intervals, Delete/End.
- D-026, refined by D-027: Calm Household presentation and responsive saved-view navigation.
- D-028: draft ordering with pointer/touch and equivalent accessible controls.

## Known risks / assumptions

- This is an incremental refactor of stateful UI. The brief specifies user-visible state preservation; Engineering may reorganize components without preserving their present file shape.
- Compactness targets use a bounded fixture, not a promise that every long routine fits one screen. Larger text and real content must scroll naturally.
- The new shared row controls must not generalize direct-personalizer authority or silently change anchor composition. The same interaction pattern can serve different domain order policies.
- School context vocabulary, profile fields, and history-clear semantics remain deliberately unresolved until their own brief; none blocks A.
- Visual taste, physical touch comfort, and actual assistive-device behavior need Product evaluation in addition to automated evidence. No claims of those results are made here.

## Engineering readiness

**Reviewed revision:** 2

**Readiness:** READY

**Report:** `reports/P0-006A-r2-engineering-readiness.md`

**Architecture disposition:** ACCEPT / PROCEED. Engineering may implement revision 2 on the planned branch. The readiness review found no blockers or questions; its risks and ordinary implementation choices remain governed by the r2 contract. Router, drag dependency, URL syntax, and test-organization choices remain Engineering discretion within D-027/D-028. Technical acceptance of the Build Report and Project Lead/Product acceptance remain separate.

## Revision history

- **r1:** Initial responsive shell, routine management, transient feedback, saved-view identity, and accessible ordering brief.
- **r2:** Bounded shared-screen scope and required routes; measurable phone density; focused step/subsection draft semantics; dirty navigation and stale-response recovery; personal-order authority limits; success versus durable/error/access feedback; explicit pointer/touch/keyboard and phone/desktop evidence. Replaces r1 for readiness and implementation.
