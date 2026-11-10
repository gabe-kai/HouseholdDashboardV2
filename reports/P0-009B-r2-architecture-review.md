# Architecture review — P0-009B r2

**Disposition:** FIX REQUIRED against the same r2 contract.

**Reviewed:** 2026-10-29; `wall-refinements` at `655970d` (planning/authorization `79fbb57` / `db37869`, code baseline `14af09e`).

**Engineering handoff:** `reports/P0-009B-r2-build-report.md` describes the earlier uncommitted tree. The Project Lead subsequently committed it as `655970d`; the report's earlier chronology is not itself a defect.

**Card:** “Find and finish the next task on the family wall” stays **In Progress**. Technical acceptance, merge, deployment, and Product acceptance have not been granted by this review.

## Evidence reviewed

- Reviewed the r2 behavioral contract and acceptance matrix against `family-board.tsx`, `DisplayApp.tsx`, `DisplayPreviewHost.tsx`, display DTO/projection, and the P0-009B unit, integration, browser, and preview tests. Inspected Engineering's 1920×1080 and 3840×2160 local screenshots.
- Independently ran `npx vitest run src/domain/family-wall-projection.test.ts tests/integration/p0-009b-family-wall.test.ts`: **16 passed**. This confirms those assertions run, not that the full r2 matrix passes.
- Engineering reports exact `validate:pr` and `validate:rc` exit 0 on its handoff tree; Architecture did not rerun those long gates. WebKit held-race and target-geometry skips are permitted by r2's explicitly bounded browser split, provided the named required WebKit journeys are actually demonstrated.
- The assertions below expose contract defects or missing evidence within r2. They are not a new brief revision. The initial Engineering report's PASS labels must not be treated as Architecture acceptance.

## Findings requiring correction

### R1 — Next actions are not shown or proven reachable on the resting board

The submitted `reports/_local-screenshots/p0-009b-r2/1920x1080.png` shows clipped pane contents: the next instructions and action controls are not visible, and multiple panes remain Loading. The 3840 screenshot similarly captures loading panes. The screenshot also shows Avery at 88/91, indicating the crowded evidence fixture has accumulated previous work instead of the specified controlled two-of-five scenario.

`tests/e2e/z-p0-009b-family-wall.spec.ts` AT16a checks pane boxes and DOM text, not whether each next instruction/control is visible within its clipped pane; it allows up to 79 px page overflow. `tests/helpers/p0-009b.ts:219` calls DOM `node.click()`, and other tests use forced clicks. These bypass pointer hit testing, so the green tests do not establish that a family member can tap the controls. The hit-size assertion does not check overlap; the keyboard case only presses Tab.

Fix the actual layout and use a deterministic, isolated F-crowded fixture. At both target CSS viewports, wait for all six panes to be ready; prove each actual next instruction and action is visible within every clipping ancestor, not obstructed, reachable without page scrolling, and tappable by real browser input. Verify the long step-three instruction, 2/5 progress, named coming-up context or More, non-overlap and 48×48 targets. Exercise normal pointer/touch and keyboard activation rather than DOM/forced clicks. Capture the settled target images. The 3×2 composition may change if necessary. Covers AT1a, AT2b, AT4a/b, AT5a/b, AT16a/b and their preview counterpart.

### R2 — Timeline navigation expands several checklists and lacks selectable named sections

`src/client/family-board.tsx:279-287` selects every occurrence in a section; `:453` renders each with its full steps. The coming-up title list at `:475` consists of noninteractive list items. The default view shows generic Earlier/Coming up/More buttons rather than the named coming-up context. This does not implement r2's one expanded checklist per person, selectable named sections, and full daily timeline with independent saved positions.

Implement selectable earlier/upcoming section headings within one pane timeline, one expanded checklist at a time, reachable More and Back to next task, and preserved section/scroll on enlargement and ordinary refresh. Keep pending work discoverable without expanding multiple unrelated checklists. Prove it with multiple earlier/upcoming checklists and interleaved real interactions in two panes, including More and returning from enlargement. Covers AT4a/b and AT15c.

### R3 — A started checklist loses recommendation priority after all steps are reopened

`src/client/family-board.tsx:273` synthesizes `startedAt` only from non-open step statuses. After a started checklist's steps are reopened, all statuses can be open while its server-side started marker remains set. The day DTO's server-derived `state` already reflects the true started status (`src/server/display.ts:1331`); the board ignores it. Consequently an earlier unstarted checklist can become Next instead of the started later checklist, contrary to r2 §3 and AT3a.

Carry or adapt the authoritative in-progress/started meaning through both wall and preview, including after status undo and reload. Add an end-to-end projection-to-board assertion with an earlier unstarted and a later started-then-reopened occurrence. The unit test that supplies `startedAt` directly to `projectFamilyPane` does not exercise the board's adapter.

### R4 — In-flight reads can leave one pane stale; preview day reads lack complete fences

The wall leaves a previously ready pane in `ready` while a new person-day request is in flight (`src/client/DisplayApp.tsx:520`). Its expiry timer skips every phase except `unavailable` (`:909`). If that request hangs rather than failing and the dashboard/sibling requests remain healthy, the pane's old content and action controls can remain beyond its own 60-second content lease. This conflicts with r2 §10–11 and D-045/D-061.

In the preview, `loadPreviewPersonDay` (`src/client/DisplayPreviewHost.tsx:216`) does not compare the response's activity generation with `lastSuccessGenerationRef`, and `clearContent` resets `paneGenRef` to an empty object (`:137`), allowing generation-number reuse by an old and new in-flight request. Withdrawal filtering applies to the dashboard (`:143`), while `personDays` are applied separately. The pane-read catch also treats authorization failures as a local unavailable pane rather than immediately clearing the preview when session/grant/display authority is lost. A held old pane response therefore lacks the required generation/withdrawal fence; this is a code-path finding, not a claim that a live production leak was observed.

Enforce independent request-start content expiry even for hung requests while global auth stays fresh; blank/disable only the expired pane and permit a fresh retry. For both wall and preview, use monotonic session/selection/invalidation and day/activity-generation/installation-epoch fences, clear or filter affected person-day content on observed withdrawal, and reject held old bodies after a fresh update or authority loss. Handle preview session/grant/selected-display denial as global authority loss, while a missing person remains local. Prove hanging-request expiry with healthy siblings/dashboard, and held preview person-day responses across generation change, promoted-task withdrawal, selected-display/authority loss, and stale expiry. Covers AT10a, AT11b/c, AT13c, AT14b, and AT19 isolation.

### R5 — Rejected actions disappear while By work is open

A new 409 rejection is stored in the display outbox (`src/client/DisplayApp.tsx:474-483`), and its person cue is rendered only in `FamilyBoard` (`src/client/family-board.tsx:343-359`). `display-presentation.tsx:298-304` hides that board in By work. New rejection does not add a visible global notice at that point. The AT6b test switches to By work and immediately back, then checks the cue; it does not check discoverability while By work is open.

Keep independent pending/rejection feedback visible and actionable from By work and from other sections without exposing expired/private content; do not collapse multiple people's errors into one overwritten cue. Demonstrate two pane actions including a rejected one, switch views while the rejection is present, and use the real UI to return/retry. Covers AT6b and the pending part of AT7a.

### R6 — Complete the existing r2 evidence matrix rather than relying on labels

Several Build Report PASS mappings do not assert the required transition/result. Consolidate the remaining evidence audit in the same correction; a single deterministic journey may prove several subrows, and exact inherited tests may be reused where they truly cover the unchanged part. At minimum:

- **AT5a/b, AT6a, AT7a/b, AT8a/b:** prove routine and responsibility Done/reopen and As needed Not needed/reopen, final-action settlement and return, two-pane queue/replay with one effect, server/outbox final state after a held old result, offline queue + reload/replay, and stale structural intent after a real edit/reassignment. Current integration replays one command sequentially; the newer-intent browser test only checks a UI attribute; the cold-offline case does not queue an action before reload.
- **AT9a/b, AT11a, AT10a/b:** use the required separate member/display context, observe an actual sync socket close and a change committed during the outage, then verify catch-up and unchanged sibling position. Demonstrate a fresh sibling can actually act during a 5xx and that old/new held responses cannot replace the current state/selection. Current test uses the wall's API request context for one update, does not observe socket close, and only checks that the sibling is visible.
- **AT12, AT13a/b/c, AT14a/b/d/e:** prove Unassigned remains after all assigned work completes; verify private/unpromoted IDs and counts as well as titles in automatic wall/preview payloads and exercise deliberate personal detail in both. Exercise held withdrawal, queued actions at day/generation/auth transitions, and real departure/reassignment. The current departure integration test conditionally skips the assertions when preview/removal does not succeed and allows 409 as success; it does not demonstrate owner transfer fencing.
- **AT14c / AT17c:** for both reset and restore, establish that the held new-route read has actually begun before replacement; include an old queued/delayed action and assert old reads/writes are rejected or client-fenced with no new-epoch effects. Current tests accept either 200 or 401 for the held read and do not prove the client fence or queued-action outcome. Reuse exact inherited lifecycle assertions when they cover the unchanged part.
- **AT15a/b/c / AT16b:** verify independently timed pane idle, active pointer/scroll and focused-keyboard guards, pointer cancel/release recovery, enlarged idle return, focus/scroll restoration, non-overlapping hit targets and real keyboard action. A `Tab` press or DOM click alone is insufficient.
- **AT17a/b:** cover the actual departed/revoked and foreign cases and exact date/UUID denials for both new routes. Demonstrate both reads do not execute/lock work, create action receipts, advance turns, or rewrite history. The current AT17b assertion counts only `step_reports`; its `departed` case uses a random unknown UUID.
- **AT19a/b/c:** compare the native wall and fitted preview at both target sizes and after outer resize; prove no execution/display-auth/outbox attempts during the entire preview flow, no contact renewal, and no execution metadata. Hold a real wall pending intent while navigating preview, then release/reconnect and assert one settled effect and cleared cue. The current preview test checks that a board exists and a section stays selected; it has no viewport comparison or pending intent.

Report each required matrix subrow and each named browser/viewport/reset/restore variant honestly as PASS, PARTIAL, or NOT RUN. Confirm the revised evidence assertions, not just a passing suite. After fixes, run the exact final-tree `npm run validate:pr` and `npm run validate:rc`; retain r2's explicit Chromium/WebKit split and report skips. Keep all fixtures disposable, prior screenshot archives untouched, and local screenshots under the ignored 009B directory.

## Next handoff

Engineering: correct **P0-009B r2** on the existing work, update the Build Report with named evidence and honest subrow status, and return for Architecture re-review. Suggest a commit message; the Project Lead manages commits. No Railway, live-data, or production-wall changes are authorized by this review. Product's physical evaluation remains separate.
