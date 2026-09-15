# Engineering readiness — P0-005 r3

**Brief:** `briefs/p0-005-multiple-household-routines.md` revision **3**  
**Compared against:** clean planning branch `brief/p0-005-r3-cohesive-routine-management` @ `b0b966e`; implementation foundation = integrated `main` @ `5376b51` (r2 implementation `297b2fd`)  
**Disposition:** **READY**  
**Date:** 2026-09-14  
**Scope note:** Fresh review for r3 only. r1/r2 readiness and Build Reports do **not** certify r3.

## Verdict

**READY.** D-024 / D-025 / D-026 and the r3 brief agree on current-plan interval reconciliation, intentional upcoming-change lifecycle, Delete versus End, started-row visibility, and the Calm Household shell. The committed r2 foundation on `main` supplies multi-routine identity, first-execution locks, same-date upsert, pending-first-action protection, and PR/RC evidence seams. Remaining work is a large but bounded lifecycle + presentation delta on that foundation, with explicit AT1–18 browser requirements and clear Active decisions. No material product ambiguity that would force Architecture to choose between competing interpretations of End vs archive, upcoming identity, or navigation.

Implementation must wait for Architecture’s disposition of this review (requested review-only).

## Repository baseline (evidence)

### Already present (r2 on `main` @ `5376b51`)
- Migrations `001`–`006`, including `005_multiple_household_routines.sql` and `006_occurrence_structural_lock.sql` (`occurrences.started_at` + backfill).
- Domain: daypart, participation, compose, occurrence-lock, reconcile (`mergeAuthoritativeOccurrence` / pending first-action protection).
- Store/API: multi-definition collection, `createRevision` defaulting to today with same-date upsert, exact-date unstarted reconcile, monotonic `started_at` in `setStepStatus`, archive with tomorrow exclusive cutoff, definition-scoped personal/proposals.
- Client: `Routines.tsx` list/detail/create/edit, App session/outbox/sync ownership, Today dayparts, People & Groups focused states.
- Evidence: `tests/integration/p0-005.test.ts` (incl. AT19 lock/race), `z-multiple-routines` / `z-group-backed-routine` e2e, PB-25–28, `validate:pr` / `validate:rc`, protected prior screenshot directories.

### Active decisions (r3-aligned)
- **D-023** Active — first-execution structural lock (preserved).
- **D-024** Active — current-plan intervals and intentional schedule-entry lifecycle.
- **D-025** Active — safe Delete and End; supersedes D-022 tomorrow cutoff for **new** End operations; legacy archived cutoffs retained.
- **D-026** Active — Calm Household tokens, shell, navigation.
- **D-018** next-day group member-set policy and personal tomorrow-floor remain unchanged.

### Brief “Current system” table
Accurate against the inspected r2 foundation: exact-date reconcile, `latestRevision` editor open, archive-only lifecycle, no upcoming move/delete, flat NavButton row, development palette override. Treat as the pre-r3 truth; r3 replaces those behaviors deliberately.

### Working-tree note
At review time the planning branch tip is `b0b966e` with small uncommitted baseline text updates in `ARCHITECTURE.md` / `PROJECT_STATE.md` / the brief (main merge SHA alignment). No implementation code changes are present. Do not absorb unrelated dirty work into an r3 implementation commit.

## Focused r3 gap analysis (intentional contract deltas)

| Area | Current behavior (r2 @ `5376b51`) | r3 required | Severity |
| --- | --- | --- | --- |
| Current-plan interval reconcile | `reconcileUnstartedOccurrencesForDate` only for the save’s exact `effective_date`; other dates refresh opportunistically on later reads | Save applies from displayed edit date through next intentional boundary; reconcile all applicable unstarted rows in that range in-txn (incl. pre-materialized tomorrow+) | IMPORTANT |
| Immutable plan versions | In-place `upsertRevision` under `UNIQUE(definition_id, effective_date)` can rewrite content also used to interpret prior/started work | Immutable stored versions + active schedule-entry selection (or equivalent); history/authorization must not silently change | IMPORTANT |
| Edit opens current | `openEdit` loads `latestRevision` (can be a future B) | Edit current opens greatest active start ≤ today | IMPORTANT |
| Intentional upcoming changes | Future revisions are read-only detail blocks; no schedule-for-later / Starting editor; no move/delete upcoming via UI | Distinct schedule-entry identity; create/edit/move/delete through normal UI; collisions preserve draft | IMPORTANT |
| Started visibility / History | `materializeForDate` / `historyForDate` iterate **live** participants only; started rows for excluded people can disappear from Today/History | Started/completed remain visible and actionable under original authority; History retains them | IMPORTANT |
| Execution auth after plan rewrite | `setStepStatus` re-checks participation from occurrence’s revision; in-place audience rewrite can FORBIDDEN a started person | Original assignment authority survives schedule/audience/end | IMPORTANT |
| Delete unused routine | No permanent delete API/UI | Eligibility-gated Delete; unstarted setup removable; history/personal/proposal blocks with End offer | IMPORTANT |
| End vs archive | `archiveRoutine` = hide now + tomorrow cutoff; today’s unstarted remains | End cancels unstarted **today and later** + upcoming entries immediately (D-025); migrate legacy archives without retroactive cancel | IMPORTANT |
| Atomic plan + receipt | Revision txn commits; administrative receipt written afterward | Plan/reconcile/lifecycle + receipt atomic; invalidate after commit | IMPORTANT |
| Pending outbox vs structural replace | Merge protects structure under pending locking action; brief still requires evidence for removed occurrence / replaced step identity | Extend recovery tests (AT12); keep D-023 merge behavior | IMPORTANT |
| Save feedback | Local Routines status + App `ChangeNotice` can duplicate | One compact local notice; server-supplied updated/protected/excluded outcomes | IMPORTANT |
| Shell / navigation | Flat NavButton row (Today, People & Groups, Approvals, Routines, History, Personalize) | Today / Routines / Household destinations; phone bottom nav; capability-gated Household secondaries | IMPORTANT |
| Theme / tokens | `:root` colors + `--touch: 44px`; gradients; `html[data-app-env="development"]` cool palette override | Calm warm light token layer; Local development indicator without alternate palette; shared primitives | IMPORTANT |
| Local browser evidence | r2 screenshots/AT19; prior dirs protected | New ATs 1–18 with UI-required schedule/Delete/End/shell journeys; screenshots only under `reports/p0-005-r3-screenshots/` | IMPORTANT |

## Ordinary implementation choices (Engineering will make if authorized)

1. **Schedule representation:** Immutable revision/content versions plus active schedule-entry rows (or equivalent) that preserve historical references while allowing move/delete of upcoming boundaries.
2. **End vs archive storage:** Explicit lifecycle fields that interpret legacy `archive_cutoff_date` unchanged while new End cancels today’s unstarted work.
3. **Range reconcile algorithm:** Shared plan/interval resolver used by save, materialize, history, preview, participation, and reference checks without generating an unbounded calendar.
4. **Shell extraction:** CSS tokens + small local primitives (nav, heading/back, list row, buttons, notice, confirm) without a design-system package or router.
5. **Step editor pattern:** Compact inline editor or accessible focused sheet; keyboard + touch reorder without drag-only.
6. **Mutation result shape:** Return applied date/range and updated/protected/excluded membership outcomes for truthful save copy.

## Acceptance-test / regression notes

- r3 AT1–18 are all required; API-only checks do not replace UI-required rows (AT5–7, 9–10, 14–17).
- Preserve P0-001–P0-005 r2 regression coverage, especially first-execution lock / AT19 evidence as PB-28 under new AT3/AT12.
- Update `docs/protected-behaviors.md` and the sync matrix for schedule/End/Delete/reconcile routes rather than disabling tests.
- Prior screenshot directories must remain zero-diff after validation; write new PNGs only to `reports/p0-005-r3-screenshots/`.
- Named populated **r2** upgrade fixture with A/B/C future plans, started/unstarted peers, and legacy archive is a prerequisite evidence seam (AT1)—extend fixtures, do not invent live-DB tests.

## Consolidated findings

| Severity | Item |
| --- | --- |
| BLOCKER | None |
| IMPORTANT | Implement D-024 current-plan interval reconcile + immutable versions / schedule-entry lifecycle (create/edit/move/delete upcoming through UI). |
| IMPORTANT | Protect started/history visibility and execution authority when schedule/audience/End exclude the live participant set. |
| IMPORTANT | Implement D-025 Delete (unused) and End (immediate cancel of today’s unstarted + later + upcoming); preserve migrated D-022 cutoffs. |
| IMPORTANT | Atomic plan/lifecycle + receipt; structure-aware races with first action; extend pending/offline recovery for replaced/removed occurrences. |
| IMPORTANT | Read-first Routines UX, single local save notice, Calm Household shell/tokens/nav (D-026), and full AT1–18 local browser evidence. |
| NOTE | Brief implementation-boundary still mentions continuing `brief/p0-005-multiple-household-routines`; Project Lead already integrated r2 and opened `brief/p0-005-r3-cohesive-routine-management`—use the inspected r3 planning branch / integrated main as authorized. |
| NOTE | `route-policy` / some ARCHITECTURE archive wording still narrate tomorrow-cutoff archive and “append prospective” revision language; refresh during factual writeback. |
| NOTE | Hosted/physical evidence not required for readiness or implementation. |

## Disposition

**READY** for Architecture ACCEPT / PROCEED against P0-005 **r3**. Do not implement until disposition; do not treat r2 acceptance as r3 completion.

### Suggested commit message (Project Lead / when authorized)

```
P0-005: record r3 Engineering readiness as READY
```
