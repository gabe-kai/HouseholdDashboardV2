# Roadmap

> Keep this outcome-oriented and lightweight. Architecture owns sequencing; Product owns whether the outcomes are still wanted.

## Planning horizons

Use these horizons instead of fully specifying everything in advance:

- **CURRENT** - the next evidence-producing outcome. This may have a detailed implementation brief.
- **LIKELY NEXT** - a plausible next outcome whose exact contract may depend on what CURRENT teaches.
- **LATER** - preserved direction or ideas that do not need technical detail yet.

A roadmap item is not an implementation contract. Normally only CURRENT should receive a fully detailed brief. Let working evidence refine later outcomes before Architecture over-specifies them.

## Milestone 0 - First Useful Release

Goal: prove that a real recurring household routine can be used quickly by six distinct people on phones while authority, shared state, and history remain trustworthy.

### RECENTLY DELIVERED

- [x] **P0-001 — Shared Morning Routine:** A parent can define one Morning Routine; selected children receive dated snapshotted occurrences, can act on checklists immediately, and another household view receives committed progress without future edits rewriting history.
  - **Brief:** `P0-001 r1 - Shared Morning Routine` (`briefs/P0-001-shared-morning-routine.md`)
  - **Result:** Technically accepted and merged to `main`; Project Lead product evaluation remains separate.

### CURRENT

- [ ] **Outcome:** Six real household members can authenticate as themselves and use the shared Morning Routine according to capability-based authority: selected members customize their future routine directly, restricted members propose additions for approval, every member can create thin personal work, and history/responsiveness/shared state remain trustworthy.
  - **Learning question:** Can one shared routine support distinct identities and progressively granted personal control without becoming confusing, slow, or historically unreliable?
  - **Brief:** `P0-002 r1 - Authenticated Household Authority` (`briefs/P0-002-authenticated-household-authority.md`)
  - **Implementation status:** Provider-neutral implementation and automated evidence complete; full r1 technical acceptance is BLOCKED pending hosted/physical-device evidence and Linux Argon2 verification. Secure hosted acceptance depends on a Project Lead-authorized HTTPS host with persistent storage and backups.

### LIKELY NEXT

- [ ] **Outcome:** Today can coordinate several real household responsibilities—initially examples such as Kitchen, Cats, and Bathroom—with a clear completed/current/later hierarchy and a mix of timed and untimed work.
  - **Why likely:** Once identity and authority are credible, multiple responsibilities are the next product pressure needed to determine whether the Morning Routine model generalizes.
  - **Do not over-specify yet:** Exact schedules, assignment patterns, contextual deep-clean additions, and rotation should respond to P0-002 family evaluation.

### LATER

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
