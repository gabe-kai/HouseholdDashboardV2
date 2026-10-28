# Architecture review — P0-009A r2

**Disposition:** FIX REQUIRED
**Review date:** 2026-10-28
**Brief:** `briefs/P0-009A-selected-display-preview-and-family-wall-proof.md`, revision 2
**Integrated baseline:** `main` at `1acc4a1`
**Implementation branch:** `brief/p0-009a-selected-display-preview-and-family-wall-proof`
**Reviewed implementation commit:** `d4f313d`
**Evidence-pass base:** `8511efb` plus the current uncommitted Engineering delta
**Build Report:** `reports/P0-009A-r2-build-report.md`

Engineering closed most findings from the initial Architecture review with substantive named assertions. The member-authorized preview, target-frame implementation, comparison capture generation, state/future-day scenarios, pane navigation, and simulated action behavior now have evidence mapped to the brief. The focused closure runs passed. The exact PR/RC gates were not rerun on this evidence-pass tree, however, and a few required assertions remain unproven in the cited test code. This review keeps the same r2 contract; it does not add product scope.

## Remaining required closure

Related assertions may share parameterized tests. Report the exact outcomes for each row and rerun the exact local gates on the final corrected tree.

### AT3b — pending wall action settles

The test proves the pending wall intent, route, and scroll remain unchanged while the member browses preview. After unroute/reconnect it only asserts the step text remains visible; it does not assert the wall intent settles or that the step reaches its authoritative completed state. Assert queue/pending clearance and authoritative completion through the wall's existing adapter, while retaining the preview isolation assertions.

### AT5d and AT5f — held-response races and stale recovery

- **AT5d:** The current test poisons immediately returned dashboard payloads with an old date/generation. AT5a selection retention and `detailRef` abort are useful, but do not demonstrate a delayed dashboard/person/occurrence response being held, overtaken by a selection/date/generation change, and released without replacing current content. Add the held-response variants required by AT5d and assert the newer context remains rendered after release.
- **AT5f:** The current test aborts refreshes and forces the stale state, then reconnects for a fresh read. It does not release a successful response whose request began before the 60-second deadline, or prove that such a late response cannot renew freshness; it also does not show a cold offline load contains no household content. Add those assertions using the existing controllable clock/response hooks.

### AT7a — 1920×1080 native geometry comparison

The native/iframe comparison checks font, media queries, and columns at 3840×2160. At 1920×1080 it checks dimensions, font, and media-query values, but does not compare native and preview columns/normalized geometry. Add the same relevant geometry comparison at 1920×1080; keep the existing outer-window resize assertions.

### AT9a and AT13 — next-action visibility at both target presets

At 1920×1080, the proof test checks that all six pane elements exist, but the concrete next instructions and crowded reachability assertions are exercised at 3840×2160. Assert the six identifiable next actions and the required two-of-five/step-three-next case at both target presets. In the Future Family day scenario, also assert six next actions remain identifiable alongside School, Meals, and Calendar; the current family-day checks prove the named School/Meals/Calendar content and homework separation but do not assert that six-action composition.

### AT11 and AT14a — actual touch-event behavior

The Vite test runs in a `hasTouch` project but performs the drag with `page.mouse`. That does not demonstrate the brief's touch-event boundary. Add a genuine touch gesture on the touch-capable project to prove scrolling/release neither checks off a task nor triggers enlargement. Keep the existing keyboard focus, reduced-motion, text-status, hit-area, and overlap assertions.

### AT14b — final-tree gates

The reported exact `validate:pr` and `validate:rc` passes are from the prior handoff tree. Since this evidence pass changes client code and tests, rerun both exact commands on the final corrected tree and update the Build Report with those results. Remote Actions remains NOT RUN until the Project Lead authorizes a push.

## Accepted / not a gate

- The other named evidence for AT1a–AT4a, AT5a–c/e, AT6a, AT7b, AT8a/b, AT9b, AT10, AT12a/b, and the non-touch parts of AT11/AT14a is sufficient as described in the Build Report.
- The Project Lead same-viewport checkpoint is intentionally post-acceptance; it is not an Architecture gate. The next actionable-person-pane brief still waits for that checkpoint.
- Remote GitHub Actions, hosted deployment, and production-wall replacement are not required here and remain unauthorized.

## Repository state and next action

The checkout is on the P0-009A brief branch at `8511efb`, with Engineering's evidence-pass changes uncommitted. Architecture made no code changes and did not run tests. The Build Report correctly labels the exact PR/RC gates as prior-tree results, but AT14b must be updated after a final-tree run.

After the listed assertions and final-tree gates are closed, return the same r2 Build Report for one consolidated Architecture re-review. No brief revision change is required.

**Project card:** **Preview a display and judge the family board** remains **In Progress**. Do not move it to Ready to Evaluate before technical acceptance.
