# BRIEF P0-008D - Guided Setup to the First Useful Household Day

**Revision:** 1
**Status:** DRAFT — evidence-gated successor; not released for implementation

Architecture releases this brief for readiness only after accepting A–C and refreshing the repository baseline. This is the completion of the approved P0-008 journey, not a new Product proposal.

## Why

Secure account creation and powerful management controls are not yet approachable onboarding. The parent should move through named, resumable steps using the same real people, calendar and work records that the app manages afterward, then understand who sees what and when.

## Learning question

Can a new parent set up the family and its first useful work, invite another person and recover from skipped/interrupted steps without coaching, duplicate data or a misleading empty Today?

## Player experience

Welcome leads through Your account → Your household → Your people → School days → First work with honest progress. Only account and household basics are required. Add another person stays in the compact family list; calendar and work have complete skip choices. Review real names and next dates before saving. Finish gives a recap, Go to Today and View household. A dismissible Finish setup checklist returns to unfinished optional choices and wall enrollment without nagging at every sign-in.

## Project card

**Card title:** Set up and manage my household without operator help
**Suggested column:** In Progress; Ready to Evaluate after A–D technical acceptance
**Player-facing goal:** Reach the first useful day and manage/reset/restore the household in one understandable app journey.
**Done when:** Without operator commands, a parent sets up the family, creates work, invites someone, changes permissions, removes a person, saves a backup, resets without another backup and restores; they can explain the result and the current signed-in identity.
**Tracking relationship:** Final P0-008 integration/evaluation slice. Automated technical acceptance precedes hands-on Product acceptance of the shared card.

## Current system

Inspected planning source is `4f07593`, with code at `415d930`; A–C are dependency contracts, not implemented facts at drafting time. Architecture must record the accepted A–C baseline before readiness.

- Existing `src/client/PeopleGroups.tsx`, `SchoolCalendar.tsx`, `Routines.tsx` and `Responsibilities.tsx` already author domain records. They are normal management views, not a persisted onboarding sequence.
- `App.tsx`, route helpers and `main.tsx` keep authentication, sync and outboxes above destinations. Preserve that ownership and display-principal precedence.
- The responsibility resolver supports fixed/cyclic/weekly patterns and side-effect-free previews. Routine and responsibility cardinality, current-plan editing, first-action locks and school-calendar semantics are already authoritative.
- A will supply protected Welcome, required account/household records and saved basics; B restore preserves saved progress; C supplies person defaults, invitation links/QR, account help, permissions and removal.

## Behavioral contract

1. **Five named steps.** Extend A's required Account and Household steps into the five Product steps without recreating their records. Use a quiet desktop progress rail and comfortable form width; at phone width show one focused screen with compact progress. Back, one clear primary action and an optional exit stay visible. No decorative screen displaces the form or stacked modal flow. Use consistent Username, Password, Invitation and Sign-in language.
2. **Saved progress, not a second domain.** Persist household-scoped step completion/skip/dismissal, stable record links and versioned progress. Actual people/calendar/plans remain the domain source of truth; no cloned setup-only families or alternative schedule resolver. Load existing saved entries and edit those records on return. Store no password/token draft. Save and finish later becomes available after required basics. Cross-device resume, Back, retry and response loss cannot duplicate people/plans or overwrite a competing completed step. Preserve dirty ordinary fields on error with clear conflict/retry. Public or nonmanager requests cannot inspect protected progress.
3. **People.** Show the first manager once and existing family order. Add another person remains in the compact entry list, asking only friendly name and Adult/Child with C's Member + Approval required default. Roles, profiles, groups and invitations can wait. Review/edit/remove mistaken entries through C's safe semantics; do not invent a second deletion path. Make later Set up sign-in discoverable; an unenrolled child is valid, not an incomplete-account error.
4. **School.** Reuse the existing calendar's year range and usual school weekdays, with Not now as a saved complete choice. Explain that no calendar is configured when skipped; do not invent dates or translate an absent calendar into known school/no-school facts. Existing exceptions and calendar editions survive editing. Setup save uses the same cross-routine reconcile/history/first-action protections and conflict baselines as ordinary calendar management.
5. **First work.** Explain Routine (each selected person gets their own checklist) and Responsibility (one accountable owner per applicable day) with short examples. Create either or both using the people just saved; examples remain text or explicitly selected drafts until Save. Keep advanced assignment/scheduled work secondary; preserve existing patterns without special chore types. Capture name, people/owner, actual recurrence/daypart and ordered steps with compact, directly editable controls appropriate to phone and desktop.
6. **Authoritative review.** Before Save show real names, concrete next applicable dates and resulting checklist/work. For repeating assignments include the next seven household dates with scheduled-work/final-owner meaning and the next applicable occurrence beyond that window if none occurs within it. Preview neither materializes work nor consumes a turn. Each choice has an edit return that preserves the rest of the draft. Save rechecks pinned source versions/date; conflict refreshes review without silently shifting an intended date. Do not promise a child's work exists today when recurrence or applicability first permits it later.
7. **Finish and empty Today.** Recap persisted work, actual owners/participants and next dates with Go to Today and secondary View household. Finish setup for now is valid with no work. A manager assigned only children has a friendly no-own-work Today and direct Household link; do not display children's lists as the manager's assignments. Future-only and school-filtered empty days are honest and understandable. Normal member sign-in still goes to that member's Today.
8. **Return without nagging.** Small dismissible Finish setup checklist links only relevant unfinished optional choices plus optional wall enrollment, and is reachable from Household Settings. Explicitly skipped choices do not produce a permanent warning/count or force the wizard each login. Existing upgraded households are not forced through account recreation; they may opt into incomplete choices. Deleting a later domain record does not silently recreate it because a setup flag says completed. Permission loss, removal, reset and restore clear/fence inappropriate drafts and delayed responses; restored progress matches restored records.
9. **Connected lifecycle.** Settings groups Household details, Finish setup and Backups, with reset secondary and activity clear distinct. Use C's normal invitation/access controls and B's backup/restore results; preserve A's protected entry. One end-to-end Product session can exercise all P0-008 outcomes without a terminal or another Design handoff.
10. **Interaction evidence.** Inline validation/help retains ordinary entries, success feedback is compact, focus follows steps, keyboard/password managers/zoom/reduced motion are supported, and primary actions remain reachable above the phone keyboard. Use real saved family entries in previews; deterministic fictional data only in automated tests/screenshots.

## Implementation boundary

- Add saved setup progress schema/service and focused setup components/routes over A basics and existing domain commands, with narrow reusable editor/preview extraction as needed.
- People/calendar/work guide, recap, optional checklist and Settings navigation; invitation and lifecycle integration uses A–C authority rather than new endpoints with weaker policy. Lifecycle authority admits the manager guide; each command still checks its underlying people/calendar/routine/responsibility capability. Customized access must not gain missing grants simply by entering setup.
- Tests for full UI journey, cross-device resume/idempotency and empty/future cases; explicit D CI selection and complete P0-008 release-evaluation checklist. New visuals under ignored `reports/_local-screenshots/p0-008d-r1/`.

## Do not change

- No example records created automatically; no new recurrence/assignment/privacy semantics, role system, email service, work template marketplace or application-wide redesign.
- Preserve all A–C lifecycle/authority/removal behavior and prior routine/responsibility locks, preview/materialization separation, school contexts, saved navigation, outboxes and display identity.
- Full P0-008 acceptance cannot be inferred from screenshots or isolated setup success.

## Acceptance tests

1. **Complete phone journey:** Empty hosted-profile fixture → protected invitation → first Account/Household → family with two adults/four children → school setup → routine and responsibility → actual review/correction → recap/Today/Household → invite another person and redeem on their device. Chromium and WebKit use ordinary UI for saving; API setup is only for fixture/security scaffolding.
2. **Skip paths:** Skip school, skip first work, finish after required basics, dismiss optional checklist and sign in again. No demo records, permanent warning or forced repeat walkthrough. Return from Settings edits existing records; manager appears once.
3. **Resume/retry:** Reload and server restart at saved boundaries; sign in on another device; drop successful person/work responses, retry/Back, and race saves. Same records survive with no duplicate family or plans; ordinary drafts/conflicts are recoverable. Required credentials are never stored as drafts.
4. **Preview/date truth:** Only-children assignments leave manager Today empty with Household link. Future-only weekday, school-only step omission, timezone confirmation, weekly/cyclic responsibility and scheduled-addition cases show accurate next dates/owners. Edit from review preserves other choices; source change/date rollover forces honest refresh. No preview creates/locks occurrences.
5. **School and existing work:** Configure/skip/edit the existing calendar through setup while another session acts on work. Started snapshots/history are stable and eligible unstarted work reconciles exactly as the normal calendar editor.
6. **New vs existing household:** A newly reset household has no old setup progress. An existing populated upgrade does not force account/household recreation or timezone change. Restore returns saved progress plus sanitized signin; deletion/removal never resurrects saved setup people/work.
7. **Security and stale views:** Nonmanager/display/public setup calls denied; lost permissions/departure and lifecycle epoch changes invalidate editing authority and delayed saved-progress/work replies. Normal within-scope reconnect/saved destinations and pending checklist behavior remain.
8. **Presentation:** Phone 360×800 with keyboard, tablet, comfortable desktop width, 200% text/zoom and keyboard/reduced-motion paths. Real names/dates and clear current identity; no stacked modal or hidden primary action. Local screenshots support, but do not replace, journey assertions.
9. **Whole P0-008 regression journey:** Through ordinary UI set up → invite → change permissions → revoke/restore sign-in → remove unused and used person → create backup → reset with backup off → restore from Welcome → securely sign in. Check old human/display/claim/queue denial and retained history/privacy after every relevant boundary. Reuse named A–C lower-level evidence; do not substitute API-only saves for this user journey.
10. **Gates and release:** Exact local `validate:pr`/`validate:rc` with D/whole-journey tests selected, built/Vite routes and Actions aggregate. Then record an authorized hosted release SHA, persistence/reset/restore checks and one uninterrupted phone/desktop Project Lead evaluation. Missing hosted/manual observations are explicit pending release/Product evidence, never fabricated PASS.

## Dependencies

- Accepted A–C plus Architecture baseline refresh/readiness release. Product requirements are already approved; only new material questions return to Product.
- Project Lead evaluates an authorized hosted candidate after local/CI evidence. Do not destroy the existing Railway household merely to obtain a test fixture.

## Relevant decisions

- D-050–D-056; reuses D-023/D-024/D-027–D-034/D-038–D-049 rather than replacing domain meaning.

## Known risks / assumptions

- Reusing an existing editor means reusing its domain behavior; the guide still needs the approachable steps/preview Product requested. Wiring a link to a complex editor is insufficient if it breaks the documented journey.
- Optional progress and independently edited records can diverge. Stable IDs, explicit skipped state and versioned saves must preserve the user's actual choices without forced repair.

## Engineering readiness

**Reviewed revision:** NOT REVIEWED
**Readiness:** NOT REVIEWED — gated on accepted A–C and Architecture release

## Revision history

- **r1:** Initial completion draft for the full guided first-day and P0-008 lifecycle evaluation journey.
