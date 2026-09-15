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

### CURRENT

- [ ] **Outcome: Cohesive Routine Management.** A parent understands and edits current routines, manages intentional upcoming changes, removes mistakes, and ends used routines within one coherent phone experience; started work and history remain trustworthy.
  - **Brief:** `P0-005 r3 - Cohesive Routine Management` (`briefs/p0-005-multiple-household-routines.md`).
  - **Status:** TECHNICALLY ACCEPTED; r1/r2 are the implemented foundation (r2 committed at `297b2fd` and technically accepted), and r3 now has complete local AT6/delete evidence. Product evaluation remains.
  - **Evidence target:** Local browser lifecycle proves current-plan reconciliation through the next scheduled boundary, upcoming create/edit/move/delete, safe Delete/End, locks/recovery/history, and consistent navigation/presentation across existing screens. Product then evaluates the connected experience. Keep P0-005 CURRENT until that evaluation.

### LIKELY NEXT

- [ ] **Outcome: Multi-Responsibility Today.** After cohesive P0-005 evaluation, build on several routines to distinguish completed, next/current, later, and anytime work. Reuse the shared shell and visual vocabulary. Ordinary responsibilities such as Kitchen, Cats, and Bathroom may enter here; exact scope and assignment behavior follow concrete household evidence.

### LATER

- Richer scheduling, assignment, shared execution, and personal work, driven by household evidence and using the common application design; no additional feature destinations are prebuilt in r3.
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
