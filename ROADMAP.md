# Roadmap

> Keep this outcome-oriented and lightweight. Architecture owns sequencing; Product owns whether the outcomes are still wanted.

## Planning horizons

Use these horizons instead of fully specifying everything in advance:

- **CURRENT** - the next evidence-producing outcome. This may have a detailed implementation brief.
- **LIKELY NEXT** - a plausible next outcome whose exact contract may depend on CURRENT.
- **LATER** - preserved direction or ideas that do not need technical detail yet.

A roadmap item is not an implementation contract. Normally only CURRENT should receive a fully detailed brief. Let working evidence refine later outcomes before Architecture over-specifies them.

## Milestone 0 - First Useful Release

Goal: prove that a real recurring household routine can be used quickly by six distinct people on phones while authority, shared state, and history remain trustworthy.

### RECENTLY DELIVERED

- [x] **P0-001 — Shared Morning Routine:** A parent can define one Morning Routine; selected children receive dated snapshotted occurrences, can act on checklists immediately, and another household view receives committed progress without future edits rewriting history.
  - **Brief:** `P0-001 r1 - Shared Morning Routine` (`briefs/P0-001-shared-morning-routine.md`)
  - **Result:** Technically accepted and merged to `main`; Project Lead product evaluation remains separate.

- [x] **P0-002 — Authenticated Household Authority:** Household members can authenticate individually, act under membership capabilities, personalize future routine content directly or by proposal, and create scoped personal work without weakening P0-001 history or synchronization.
  - **Brief:** `P0-002 r1 - Authenticated Household Authority` (`briefs/P0-002-authenticated-household-authority.md`)
  - **Result:** Technically accepted and merged to `main`; Project Lead product evaluation remains separate. Future hosted release candidates retain the hosted smoke/evidence gate.

- [x] **P0-003 — Regression Safety and Contract Hardening:** Protected behavior is explicit, critical contracts have layered automated coverage, and local PR/RC validation is backed by a successful GitHub Actions pull-request gate.
  - **Brief:** `P0-003 r1 - Regression Safety and Contract Hardening` (`briefs/p0-003-regression-safety-contract-hardening.md`)
  - **Result:** Technically accepted and merged to `main` via PR #6 after exact local PR/RC scripts and GitHub Actions passed; required-check configuration remains an optional Project Lead operation.

- [x] **P0-004A — People & Groups UX Completion:** A parent can navigate focused people, access, group, and household-activity states while normal bootstrap remains fixture-free and demo cleanup remains provenance-safe.
  - **Brief:** `P0-004A r3 - People & Groups UX Completion` (`briefs/p0-004a-people-groups-access.md`)
  - **Result:** Technically accepted through `b4256ac` and correction `b20744e`; merged to `main` through PR #8. Product evaluation remains separate.

- [x] **P0-004B — Group-backed Morning Routine:** Named groups supply prospective participation without flattening selected sources, duplicating occurrences, or rewriting history.
  - **Brief:** `P0-004B r1 - Group-backed Morning Routine` (`briefs/p0-004b-group-backed-morning-routine.md`).
  - **Result:** Technically accepted through correction `ac41538`; merged to `main` at `93ef494` through PR #9. Product evaluation remains separate.

- [x] **P0-005 — Cohesive Routine Management:** A parent can edit current unstarted work, manage intentional upcoming changes, remove mistakes, and end used routines while started work and history remain trustworthy.
  - **Brief:** `P0-005 r3 - Cohesive Routine Management` (`briefs/p0-005-multiple-household-routines.md`).
  - **Result:** Technically accepted and merged to `main` at `31aad37` through PR #11 after AT6 and long-lived-database upcoming-delete corrections. Product evaluation produced the P0-006 experience-consolidation direction.

- [x] **P0-006A - Calm Household Experience Foundation:** Compact responsive shell, focused routine editing, quiet feedback, saved destinations, and accessible touch ordering.
  - **Brief:** `P0-006A r2` (`briefs/p0-006a-calm-household-experience-foundation.md`).
  - **Result:** Technically accepted and accepted by the Project Lead after screenshot review and testing. Integrated to `main` at `7cba3a6` via PR #12, including B planning and the A toast/CI correction.

- [x] **P0-006B - Contextual Routine Applicability:** One routine adapts to school days, breaks, and School nights using step applicability and a household school calendar, while preserving work already begun.
  - **Brief:** `P0-006B r1 - Contextual Routine Applicability` (`briefs/p0-006b-contextual-routine-applicability.md`).
  - **Result:** Technically accepted and merged via PR #13 at `de552ab`, including AT9 rollback and AT10/AT11 browser multi-context evidence. The Project Lead exercised calendar setup and authorized continuing to C; this does not claim exhaustive Product evaluation.

- [x] **P0-006C - Recognize the family and understand its day.** Friendly household profiles and saved family order, compact day/person routine History with action detail, and one deliberate evaluation reset that preserves household setup.
  - **Brief:** `P0-006C r1 - Household Profiles and Useful History` (`briefs/p0-006c-household-profiles-useful-history.md`).
  - **Result:** Technically accepted at `e8a93d5`, merged via PR #14 to `main` at `409d147`. Product acceptance remains separate. Completes the three technical slices of the P0-006 proposal.

- [x] **P0-007A - Give Cats and Trash one owner and a place in Today.** Create fixed-owner daily/weekly household responsibilities and execute them alongside routines, with compact household oversight and retained History.
  - **Brief:** `P0-007A r1 - Household Responsibility Foundation` (`briefs/p0-007a-household-responsibility-foundation.md`).
  - **Result:** Technically accepted at `bb21d74`, acceptance writeback `7539fd0`, merged via PR #15 at `51322e0`. The supplied Design handoff accepts A as the foundation slice and carries presentation findings to C. Card: **Accepted** as that foundation.

- [x] **P0-007B - Understand whose turn it is, including deep-clean days.** Kitchen weekly owners and alternating deep clean form one coherent responsibility; Cats rotates and Bathroom reuses the same base-plus-additions model while Trash remains fixed.
  - **Brief:** `P0-007B r1 - Assignment Patterns & Scheduled Work` (`briefs/p0-007b-assignment-patterns-scheduled-work.md`).
  - **Status:** ACCEPTED by Architecture after same-branch correction evidence closed AT2, AT7, and AT9–15; now integrated in inspected `main` at `e8f59b4`. Details: `reports/P0-007B-r1-architecture-review.md` and `reports/P0-007B-r1-architecture-reacceptance.md`. Product acceptance remains separate; Design's revised C proposal builds on this foundation.
  - **Evidence target:** Side-effect-free draft/saved previews match actual final owner/work; deterministic turns and dated eligibility; prospective edits preserve locks/history; Unassigned/overlap recovery; real Kitchen/Bathroom/Cats/Trash UI journeys, populated through-013 migration and local PR/RC/Vite gates. D-038-D-040 resolve the bounded technical shape. No final Today redesign or hosted iteration.

- [x] **P0-007C-1 - Know what to do next and what the household still needs.** Mixed personal Today with quiet Completed, one focused Next, compact Later and Anytime; summary-first Household with responsibility owners and routine/person completion drill-down.
  - **Brief:** `P0-007C-1 r1 - Actionable Today and Household Overview` (`briefs/p0-007c-1-actionable-today-household-overview.md`).
  - **Status:** ACCEPTED by Architecture after the AT6 four-owner Chromium/WebKit correction; merged via PR **#20** at **ef39a89**. Card: **Ready to Evaluate**; Product speed-of-understanding evaluation remains separate. D-041/D-042 define the bounded projection and scope.
  - **Evidence target:** Real phone/desktop Today and four-person Household journeys; honest obligation counts, privacy/per-kind scope, pending/offline/reset and live summary/detail recovery; local PR/RC/Vite plus CI-selection evidence. Visuals remain ignored local evidence. No display credentials, shared execution, hosting or production changes in this planning task.

### CURRENT

- [ ] **P0-007C-2 - See the family day from across the room.** Manager-enrolled/revocable household-owned display identity, persistent restricted read-only access and privacy-filtered By person/By work projections. Show household date/time, six-person readable 4K layout and touch drill-down without administrative navigation or a fake member. This is deliberately read-only until C-3; preserve the full interactive outcome.
  - **Brief:** `P0-007C-2 r1 - Household Display and Read-only Dashboard` (`briefs/p0-007c-2-household-display-read-only-dashboard.md`).
  - **Status:** Engineering readiness is **READY**. Architecture reviewed implementation **a2b9e42**, corrections **90aaa74** / **ba5541c**, and third-review evidence commit **a6d3899**. AT6/AT9 findings and local PR/RC gates are closed; final technical acceptance is **FIX REQUIRED** only until the Build Report pins `a6d389983b2f1629a202601910eb9cb42ae3c4e0` and removes stale uncommitted/pending-commit text. Engineering owns that metadata-only correction on the same branch/revision. Card: **In Progress**.
  - **Evidence target:** Normal manager-to-wall enrollment, persistent access/revocation, strict HTTP/WS privacy and principal boundaries, unattended current-day truth, live/reset/restart recovery, six-person native/scaled 4K inspection, and local PR/RC/Vite/CI selection. Physical ten/sixteen-foot readability is separately reported Product evidence, not inferred from screenshots. D-043-D-045 define this slice.

### LIKELY NEXT

This is the final slice of the **same revised P0-007C Design proposal**, not a request to return to Product for the same information. C-1 is integrated and C-2 is now briefed; refine C-3's implementation contract from their evidence.

- [ ] **P0-007C-3 - Act at the shared display without losing trust.** Normal assigned checklist execution with truthful display actor and unchanged accountable ownership, safe pending/reconnect/restart behavior, and owner-controlled personal-work promotion distinct from visibility. Private work never reaches the display; shared unpromoted work remains detail-only there. Complete cross-device evidence and real 27-inch evaluation at 10 and 16 feet before calling the full C outcome evaluated.

### LATER

- After real-family evaluation of the completed P0-007C outcome, choose the next pressure: helpers, Cover/Claim, household exceptions/Skip Day, exact-time behavior, richer personal/school projects or notifications. None is pre-selected as the next implementation commitment.
- Preserve owner-controlled visibility, separately authorized future parent overrides for minors, long-running projects/subtasks/milestones/due dates/daily targets and compact shared project summaries. Due dates or progress must never expose private work. Broader ambient display feeds follow a useful functional display, not before it.
- Additional ordinary responsibilities (Cars, lawn care, medication, seasonal maintenance), richer personal work, and assignment refinement remain Product pressure tests; no domain-specific implementation is authorized in B.
- Broader-release privacy, recovery, offline behavior, and operational confidence.
- Detailed unscheduled product memory: [`PRODUCT.md` — Deferred / Preserved Product Directions](PRODUCT.md#deferred--preserved-product-directions). This inventory is not a sequence of implementation commitments.

## Milestone 1 - Core Value

- [ ] Generalize routine evidence into household responsibilities and personal work without cloning near-identical definitions.
- [ ] Add practical assignment patterns, helpers, and prospective schedule changes as evidence requires.

## Milestone 2 - Product Fit

- [ ] Add household exception/skip behavior that preserves critical work.
- [ ] Add optional chore-debt behavior, off by default.
- [ ] Explore longer-running personal work and homework organization after the daily responsibility loop is useful.

## Milestone 3 - Reliability and Refinement

- [ ] Harden hosting, automated backup/restore, account recovery, privacy, accessibility, and operational evidence beyond the P0-002 family-evaluation deployment.
- [ ] Refine offline behavior and notifications based on observed connectivity and reminder needs.

## Later / Parking Lot

See [`PRODUCT.md` — Deferred / Preserved Product Directions](PRODUCT.md#deferred--preserved-product-directions) for the detailed unscheduled inventory. Preserve those ideas there; promote only evidence-justified outcomes into CURRENT or LIKELY NEXT.
