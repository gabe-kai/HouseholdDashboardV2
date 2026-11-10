# Engineering readiness — P0-009C r1

**Date:** 2026-11-10  
**Role:** Engineering  
**Disposition:** BLOCKER — Product direction has not yet been integrated into the planning baseline.  
**Reviewed:** `briefs/P0-009C-person-day-lists-recovery.md`, revision 1; branch `brief/p0-009c-person-day-lists-recovery`, HEAD `d827efa` on integrated P0-009B baseline `a155169`. Review only; no implementation or tests were run.

## Consolidated finding

**BLOCKER — required Product input is still uncommitted.** P0-009C r1 explicitly requires the exact reviewed Product direction to be committed/integrated before Engineering begins (Product input and Dependencies). `git status` shows `PRODUCT.md` modified, and `git diff -- PRODUCT.md` contains the immediate 2026-11-10 wall follow-up along with other Product-owned additions. `PROJECT_STATE.md` confirms this prerequisite. The requested experience is sufficiently described for review, but the required durable input is not in the committed planning baseline. Product / Coordinator should integrate the intended Product direction without losing the other working-tree edits, then Architecture can confirm the same r1 is ready to build. Engineering did not stage, commit, or overwrite that edit.

## Repository assessment

- The brief's integrated P0-009B baseline is present. `src/server/display.ts` `getDisplayPersonDetail` materializes the current household day, filters assigned occurrences by membership, includes completed work and separately selects household-visible personal tasks. Preview uses the selected-display/member-authorized adapter; occurrence preview strips execution structure. These are plausible reuse points, not proof that AT1–AT9 already pass.
- `FamilyPane` currently places **Shared personal work** inside the scroll body, so it neither names the recurring-list route nor guarantees an unscrolled entry. Enlargement presently reuses the pane controls. Both are the intended presentation changes in r1, not contradictions with the existing implementation.
- `DisplayAuthenticatedSurface` currently replaces the overview subtree when detail opens, while `FamilyBoard` owns browsing state locally. `DisplayApp` opens an occurrence as a separate detail and `closeDetail` returns to the overview. The existing bridge therefore does not by itself establish the required list-to-occurrence-to-list navigation or safe origin/sibling scroll preservation; implementation must explicitly maintain the needed in-memory state and Back/focus behavior for wall and preview. This is a bounded implementation task, not a new persistent preference or reason to change the contract.
- Clause 3's allowed expanded alternative is an immediately visible all-lists entry in a substantially useful expanded pane. Clause 4 forbids automatically fetching the deliberate personal-detail route on enlargement. Those clauses can be met together using that alternative (or a focused view based on already-authorized day data); Engineering must not assume enlargement itself authorizes personal-detail fetches.
- Preview runs through `DisplayPreviewHost` and the preview frame, with a distinct member principal and read-only adapter. Existing detail and authority fences must be exercised after navigation changes. The current detail panel's unavailable-state button invokes Back despite being labeled Retry; truthful loading/error/retry behavior is implementation work within r1.
- Existing `package.json`, Playwright projects and CI select P0-009B/preview suites explicitly. Any new P0-009C spec must be deliberately included in the required Chromium/WebKit and PR/RC/CI selections; a green gate without selection is not AT10 evidence. Reuse exact inherited security/lifecycle checks and add the targeted changed-route test required by AT9.

## Intended evidence and risks once unblocked

Use disposable fictional fixtures with three distinct routines, rotating chores, completed/current/later work, a pending-sign-in person and a separately browsed sibling. Map AT1–AT10 individually in the Build Report. Verify wall execution and read-only preview separately, deliberate personal-task visibility/network isolation, both target viewport geometries/screenshots, pending and remote-change convergence, lifecycle/authority fences, and Back/focus/scroll behavior. Run focused checks first, then exact `npm run validate:pr` and `npm run validate:rc` and capture exits. Physical readability, finger interaction and Product acceptance remain Project Lead evaluation, not conclusions from automated screenshots.

No other material contract conflict or unavailable technical dependency was found in the inspected paths. The timeline redesign, People family-order defect, Railway and live household data remain outside this review and brief.

## Handoff

Product / Coordinator: integrate the exact reviewed Product direction while preserving the existing working-tree additions. Architecture: confirm the dependency is met and disposition r1; if its behavioral contract changes materially, issue the appropriate revision. Suggested card **Find all my lists on the family wall** remains **Up Next**; implementation has not started.
