# Architecture acceptance — P0-009A r2

**Disposition:** ACCEPTED (technical)
**Review date:** 2026-10-28
**Brief:** `briefs/P0-009A-selected-display-preview-and-family-wall-proof.md`, revision 2
**Integrated baseline:** `main` at `1acc4a1`
**Implementation branch:** `brief/p0-009a-selected-display-preview-and-family-wall-proof`
**Implementation commit:** `d4f313d`
**Evidence-pass commit:** `3b494d8` plus the uncommitted Engineering delta
**Build Report:** `reports/P0-009A-r2-build-report.md`

Architecture reviewed the assertion-level r2 matrix against the named tests and the updated Build Report. The previously open evidence is now demonstrated, and the exact local PR/RC gates pass on the corrected tested tree. No further technical acceptance work remains for this revision.

## Final closure evidence

- **AT3b:** preview browsing leaves the separate wall route, scroll, and queued intent unchanged; after reconnect the wall's own intent reaches Done, pending/Saving and pending-cue indicators clear, and preview remains read-only.
- **AT5d/AT5f:** held person, occurrence, and dashboard responses cannot restore a previous selection/date/generation; a late successful payload cannot restore stale content; cold offline load is blank and a fresh authorized read recovers. AT5e reset and restore are separately covered.
- **AT7a:** native wall and fitted preview viewport, font, media-query, and column measurements match at 3840×2160 and 1920×1080; outer resizing changes fit without changing target metrics.
- **AT9a/AT13:** six panes, the two-of-five/step-three-next case, and next instructions are asserted at both target presets and alongside fictional future School, Meals, and Calendar content.
- **AT11/AT14a:** enlargement restores focus/scroll, and the touch project uses CDP touch input to verify gesture release does not enlarge or check off work; keyboard, reduced-motion, labels/status, hit-size, and overlap evidence is recorded.
- **AT14b:** exact `npm run validate:pr` and `npm run validate:rc` pass on the tested final tree (375 Vitest; 147 Chromium and 11 Vite for PR; 227 Chromium+WebKit and 11 Vite for RC). Test selection is recorded in the Build Report.

The Build Report's AT1–AT14b mappings are consistent with the evidence reviewed. No brief revision change is needed.

## Separate checkpoints

- GitHub Actions remains **NOT RUN** until the Project Lead authorizes a push.
- The Project Lead's same-viewport evaluation remains **NOT RUN** and is now the next step. Technical acceptance does not accept the proposed layout; the 3×2 arrangement and 90-second per-pane idle behavior remain hypotheses.
- Hosted deployment and production-wall replacement remain unauthorized.

## Repository and coordination state

The checkout is on the brief branch at `3b494d8`, with the Engineering evidence-pass delta and updated Build Report still uncommitted. Architecture made documentation writebacks only and did not rerun tests; acceptance relies on the named assertions inspected and Engineering's exact final-tree gate results.

**Project card:** **Preview a display and judge the family board** moves to **Ready to Evaluate**. The actionable-person-pane brief remains gated on the Project Lead checkpoint.
