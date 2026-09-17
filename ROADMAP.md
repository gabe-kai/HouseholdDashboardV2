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

### CURRENT

- [ ] **Outcome: Let one routine adapt to school days and breaks.** Steps use simple applicability choices and a household school calendar, including School nights. Parents change calendar exceptions without cloning routines or changing a person's work already begun.
  - **Brief:** `P0-006B r1 - Contextual Routine Applicability` (`briefs/p0-006b-contextual-routine-applicability.md`).
  - **Status:** FIX REQUIRED; implementation is broadly aligned, but AT9 rollback injection and AT10/AT11 browser multi-context evidence remain required on the existing branch.
  - **Evidence target:** Local calendar/step/preview journey, current/future unstarted reconciliation across plan boundaries, preserved locks/history, personal/proposal composition, migration/replay, and live context changes. Product evaluates usefulness after technical acceptance.

### LIKELY NEXT

- [ ] **P0-006C - Household Profiles and Useful History.** Deliver the third slice of the existing P0-006 proposal: friendly/full names, birthday, optional email with token access preserved, family display order, day/person history summaries with evidence drill-down, and manager-authorized evaluation-history clearing while preserving configuration. Architecture will define the clearing/reference contract from the then-current repository. No replacement Product proposal is needed unless new evidence changes the intended outcome.

### LATER

- **Multi-Responsibility Today:** completed/current/later/anytime hierarchy and ordinary household responsibilities such as Kitchen, Cats, and Bathroom after the P0-006 foundation is stable.
- Richer scheduling, assignment, shared execution, and personal work, driven by household evidence and using the common application design; no empty future destinations are prebuilt in P0-006A.
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
