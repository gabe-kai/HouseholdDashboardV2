# Architecture Re-review - P0-007C-3B r1

**Disposition:** ACCEPTED  
**Brief:** `briefs/p0-007c-3b-owner-controlled-personal-task-display.md`  
**Reviewed implementation:** `57780ce8d42449ae21c6928180755f72405ef64d` on `brief/p0-007c-3b-personal-work-wall-promotion`  
**Baseline:** integrated `main` at `6510fb4`  
**Build Report:** `reports/P0-007C-3B-r1-build-report.md`  
**Next owner:** Project Lead / Product evaluation  
**Card:** **Act at the shared display without losing trust** may move to **Ready to Evaluate**.

## FIX REQUIRED correction verified

The prior review found that an older personal-task status response could replace the owner's latest task object and restore Household visibility/promotion after the owner saved the task as Private.

The correction changes the status-result merge to update only `status`, `completedAt`, and `updatedAt` on the latest task object, using a functional state update. The focused unit test confirms that a stale status payload cannot overwrite current visibility or promotion. The held-response browser test parks the status body after its server write, prevents list refresh from masking the race, performs Household-to-Private, confirms the owner and wall show the private/withdrawn state, and then releases the older response to prove the withdrawn content does not return.

## Evidence reviewed

- The r1 Build Report maps AT1–8 to PASS and reports exact `npm run validate:pr` and `npm run validate:rc` passes after this correction.
- The report discloses the initial unrelated P0-007A AT12 flake and its isolated and clean-rerun passes.
- Architecture inspected the changed merge path, unit regression, held-response browser scenario, and Build Report. Architecture did **not** independently rerun the validation gates.
- Physical readability/density evaluation of the changed 27-inch wall remains **NOT RUN** and belongs to the Project Lead. The previous C-3A view's readability observation does not establish acceptance of C-3B's changed content.
- No hosted deployment is required by the brief.

## Final disposition

Architecture accepts **P0-007C-3B r1** at `57780ce8d42449ae21c6928180755f72405ef64d`. The correction closes the only FIX REQUIRED finding without changing the brief contract. Owner-controlled promotion, private-task exclusion, withdrawal-safe sync, completion-time preservation, and the display's assigned-work-only write authority satisfy the reviewed technical contract.

No further Engineering work or new brief revision is required. Technical acceptance does not imply Product acceptance or authorize Architecture to perform Git integration. The Project Lead owns the next merge decision and evaluation of promoted work on the physical wall; the full P0-007C outcome remains pending that evaluation.
