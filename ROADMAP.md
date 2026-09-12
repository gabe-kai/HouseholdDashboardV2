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

### CURRENT

- [ ] **Outcome:** A parent can use People & Groups as a clear phone directory with focused person, access, group, and household-activity states, while normal bootstrap remains free of fictional family members.
  - **Brief:** `P0-004A r3 - People & Groups UX Completion` (`briefs/p0-004a-people-groups-access.md`)
  - **Status:** Implemented at `b4256ac`; same-revision Architecture acceptance corrections required before Product evaluation.

### LIKELY NEXT

- [ ] **Outcome:** Morning Routine can consume a named group as a clear audience, giving each current group member one future occurrence while preserving overlap, prospective-change, and historical invariants.
  - **Planned brief:** `P0-004B - Group-backed Morning Routine audience` (not yet detailed).
  - **Why likely:** People and groups only become a reusable household structure when one existing product workflow demonstrates their meaning.
  - **Do not over-specify yet:** Exact effective-date and already-materialized-future reconciliation should follow P0-004A repository evidence.

### LATER

- [ ] Multi-Responsibility Today for real household responsibilities such as Kitchen, Cats, and Bathroom.
- [ ] Add prospective assignment patterns and only the rotation/eligibility needed by proven household examples.
- [ ] Add retrospective completion, helper/cover/reassignment, and explicit credit while retaining the original assignment.
- [ ] Support household exception days and contextual schedule additions/previews without a global weekday/weekend classification.

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

Ideas we like but are not committed to yet:

- Alternating households, temporary absence, household departure, and personal-data portability.
- Calendar/school context ingestion.
- Sibling cover requests, swaps, reciprocal promises, and any household-economy behavior.
- Meal planning, pet inventory, renovation projects, and other adjacent household domains.
