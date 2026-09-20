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

### CURRENT

- [ ] **P0-007A - Give Cats and Trash one owner and a place in Today.** Create fixed-owner daily/weekly household responsibilities and execute them alongside routines, with compact household oversight and retained History.
  - **Brief:** `P0-007A r1 - Household Responsibility Foundation` (`briefs/p0-007a-household-responsibility-foundation.md`).
  - **Status:** FIX REQUIRED after re-review of committed implementation `10a412d`; R1–R5, AT4/7/12/15 and storage integrity corrections are present, but the independent suite has a date-sensitive P0-006B AT9 failure on 2026-09-20. Details: `reports/P0-007A-r1-architecture-reacceptance.md`.
  - **Evidence target:** Stabilize the existing date seam and rerun green PR/RC/Vite gates, then complete technical acceptance. Card: **Give Cats and Trash one owner and a place in Today** remains **In Progress**.

### LIKELY NEXT

- [ ] **P0-007B - Understand whose turn it is, including deep-clean days.** Use a small understandable repeating assignment/pattern model and scheduled additional work to prove Kitchen/Bathroom and Cats rotation. Preserve one combined occurrence and Product's preferred deep-clean-owner precedence. Show actual upcoming names/dates; resolve group eligibility, empty sets and overlapping owner overrides before implementation. No generic rule language. Exact brief follows A evidence within the same approved proposal.
- [ ] **P0-007C - See the household's work as one useful day.** Extend A/B's connected views into Completed / Next / Later / Anytime Today and compact household oversight, without domain-type silos or fake times. Exact presentation/evidence follows A/B use. This remains part of the same P0-007 proposal, not a request for Product to resubmit it.

### LATER

- After evaluation of the completed P0-007 outcome, possible directions include helpers, Cover/Claim, household exceptions/Skip Day, or richer Today timing. None is pre-selected as the next implementation commitment.
- Additional ordinary responsibilities (Cars, lawn care, medication, seasonal maintenance), richer personal work, and assignment refinement remain Product pressure tests; no domain-specific implementation is authorized in A.
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
