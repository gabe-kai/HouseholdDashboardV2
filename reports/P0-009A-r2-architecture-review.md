# Architecture review — P0-009A r2

**Disposition:** FIX REQUIRED  
**Reviewed:** 2026-10-28  
**Brief:** `briefs/P0-009A-selected-display-preview-and-family-wall-proof.md`, revision 2  
**Integrated baseline:** `main` at `1acc4a1`  
**Implementation reviewed:** branch `brief/p0-009a-selected-display-preview-and-family-wall-proof`, current checkout `d4f313d`  
**Build Report:** `reports/P0-009A-r2-build-report.md`

The selected-display preview authority, route isolation, current-day restriction, deep-link behavior, and proof/build isolation have substantial evidence. The reported local `validate:pr` and `validate:rc` gates pass. The implementation is not technically accepted yet because the Build Report itself marks multiple required r2 assertions PARTIAL or NOT RUN, and inspection of the cited tests confirms those gaps. The brief's acceptance matrix is the evidence contract; a green suite does not close assertions the suite does not exercise.

## Required closure

The items below are grouped by behavior so Engineering can close them in one evidence pass. Existing fixtures and tests may be extended; one test per matrix row is not required. Preserve r2 and the production-wall boundary.

### 1. Preview isolation and lifecycle recovery — AT3b, AT5a–AT5f

- **AT3b:** With a separate wall context holding a pending intent, browse and navigate the member preview. Prove preview does not change the wall's selected route/person, scroll position, or pending queue, while the wall's own pending action can still settle.
- **AT5a:** Use a second authorized context to change current work while detail is open. Prove the preview converges without reload, retains a valid manual selection, and handles disappeared detail as specified.
- **AT5b:** Hold an old preview payload while promoted work becomes Private. Prove sanitized invalidation is handled, the held payload cannot restore the withdrawn task, and private identifiers/content do not reach the renderer.
- **AT5c:** Cover grant removal, display revocation, and member-session expiry. Prove observed denial clears content immediately; without an event, visible revalidation occurs within 30 seconds; unavailable refresh reaches the 60-second blanking bound; a held pre-denial reply cannot repopulate content.
- **AT5d:** Hold dashboard/person/occurrence replies across selection change, household-date rollover, and activity-generation clear. Prove only the current context can render and stale positions/content cannot return.
- **AT5e:** Keep the existing reset evidence and add the separate restore lifecycle variant: a held old-epoch response cannot render after restore, and fresh authorization reads from the restored runtime.
- **AT5f:** Advance a controllable clock past the 60-second request-start deadline through failed refresh, pause/resume, delayed response, and cold offline load. Prove stale then blank behavior, no deadline renewal from old replies, and recovery through a fresh authorized read.

### 2. Target-viewport parity and comparison evidence — AT7a, AT8a

- **AT7a:** Compare the native current renderer with the fitted preview at both 3840×2160 and 1920×1080. Assert relevant media-query outcomes, normalized geometry, and computed typography match; resize the outer window from 1280 to 1600 and prove target rendering is unchanged while only fit scale changes. The current test proves iframe dimensions persist, but does not establish native-render parity or typography.
- **AT8a:** Save a paired Current layout / Family board concept capture from the same canonical fixture, state, target viewport, and comparison scenario. Include the required scenario/viewport/browser/DPR/scale metadata. The current test toggles both modes but only writes a concept capture, so it does not yet provide the required comparable pair.

### 3. Crowded layout, truth states, and future-day content — AT9a, AT9b, AT13

- **AT9a:** At both target presets, assert all six identities and concrete next actions, the two-of-five/step-three-next case, reachable earlier unfinished work and all five named upcoming headings, full long instruction text, no board/page scroll, and one scroll surface per pane. Record the rendered type sizes. Retain evidence for the initial 3×2 hypothesis if an alternative is needed.
- **AT9b:** Assert distinct empty and complete-with-optional states, unresolved As needed, Anytime, Unassigned outside person panes without Claim, promoted personal work as view-only and excluded from recurring counts, and unavailable detail as retryable rather than empty.
- **AT13:** Assert the fictional future day contains useful child-specific School work, one shared Meals item, and a dated early-release/no-school Calendar notice with affected people and Today/Later distinction, while six next actions remain identifiable and homework completion does not complete School work. The cited test currently asserts School and Meals labels but not the Calendar notice or the complete composition.

### 4. Independent navigation and enlargement — AT10, AT11

- **AT10:** Put two panes at different sections and scroll offsets. Navigate earlier/upcoming/More in one, then prove the sibling pane's section and offset are unchanged; verify full timeline reachability and Back to next.
- **AT11:** From scrolled panes, enlarge and return. Prove section and reading positions restore, identity/Back remain visible, and focus returns to the trigger. Include touch drag/release boundaries proving background or drag release neither enlarges nor checks off a task.

### 5. Simulated actions and input/accessibility — AT12a, AT14a

- **AT12a:** In the fictional checklist, exercise Done, Reopen, and Not needed. Hold the final action pending, then prove success and rejection paths keep the action reachable, show discoverable feedback after compaction, preserve focus/target position, and issue no real write.
- **AT14a:** At target coordinates, cover keyboard focus/navigation, descriptive labels, non-color status, reduced-motion preference, touch scrolling without accidental checkoff, and all relevant ≥48×48 hit areas with no overlap. The current single enlarge-button geometry assertion is insufficient for this matrix.

## Already acceptable / not a gate

- AT1a–AT4a, AT6a, and AT7b evidence is sufficient as mapped in the Build Report.
- AT8b production absence and no-API proof evidence is sufficient.
- AT12b per-pane idle evidence is sufficient for the specified 90-second candidate behavior.
- AT14b local test-selection and exact `validate:pr` / `validate:rc` passes are sufficient for local technical acceptance. A GitHub Actions URL remains NOT RUN until the Project Lead authorizes a push.
- The Project Lead same-viewport checkpoint is intentionally a post-acceptance human evaluation, not an Architecture gate. Do not mark the working layout accepted or advance the actionable-person-pane brief until that checkpoint occurs.
- Hosted deployment and production-wall replacement remain unauthorized and are not requested for closure.

## Repository and coordination state

At review, the working tree was clean at `d4f313d` on the P0-009A brief branch. The Build Report accurately describes the Engineering handoff snapshot (`779152b` plus its then-uncommitted delta); the current checkout now contains the implementation commit. No remote push, PR, merge, or deployment is asserted by this review.

No brief contract change is needed; this is same-revision acceptance evidence closure. Once the named rows are demonstrated and the Build Report maps each required assertion accurately, Architecture can re-review the corrected tree.

**Project card:** **Preview a display and judge the family board** remains **In Progress**. No board movement to Ready to Evaluate is warranted yet.
