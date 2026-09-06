# Roadmap

> Keep this outcome-oriented and lightweight. Architecture owns sequencing; Product owns whether the outcomes are still wanted.

## Planning horizons

Use these horizons instead of fully specifying everything in advance:

- **CURRENT** - the next evidence-producing outcome. This may have a detailed implementation brief.
- **LIKELY NEXT** - a plausible next outcome whose exact contract may depend on what CURRENT teaches.
- **LATER** - preserved direction or ideas that do not need technical detail yet.

A roadmap item is not an implementation contract. Normally only CURRENT should receive a fully detailed brief. Let working evidence refine later outcomes before Architecture over-specifies them.

## Milestone 0 - First Useful Release

Goal: prove that a real recurring household routine can be used quickly on a phone while its shared state and history remain trustworthy.

### CURRENT

- [ ] **Outcome:** A parent can define one recurring Morning Routine in a local evaluation build; each selected child gets a dated occurrence, can act on its checklist immediately, and another household view receives committed progress without future edits rewriting history.
  - **Learning question:** Does the versioned-definition, snapshotted-occurrence, and optimistic synchronization model make one real Morning Routine understandable and responsive enough to justify extending it?
  - **Brief:** `P0-001 r1 - Shared Morning Routine` (`briefs/P0-001-shared-morning-routine.md`)

### LIKELY NEXT

- [ ] **Outcome:** A household can replace the evaluation identity harness with an approved authenticated setup, and children can make or request a minimal set of personal routine changes under server-enforced capabilities.
  - **Why likely:** This completes the identity and progressive-authority evidence intentionally deferred from the first technical slice.
  - **Do not over-specify yet:** Credential/recovery UX, detailed permission matrices, and the exact approval interaction should respond to P0-001 evaluation and Product direction.

### LATER

- [ ] Expand Today from one Morning Routine to multiple timed and untimed responsibilities, with completed/current/later hierarchy and contextual additions.
- [ ] Add retrospective completion, cover/reassignment, and explicit credit while retaining the original assignment.
- [ ] Support contextual schedule exceptions and concrete schedule previews without a global weekday/weekend classification.

## Milestone 1 - Core Value

- [ ] Generalize routine evidence into household responsibilities and personal work without cloning near-identical definitions.
- [ ] Add practical assignment patterns, helpers, and prospective schedule changes as evidence requires.

## Milestone 2 - Product Fit

- [ ] Add household exception/skip behavior that preserves critical work.
- [ ] Add optional chore-debt behavior, off by default.
- [ ] Explore longer-running personal work and homework organization after the daily responsibility loop is useful.

## Milestone 3 - Reliability and Refinement

- [ ] Establish production hosting, backup/restore, recovery, privacy, accessibility, and operational evidence for broader household use.
- [ ] Refine offline behavior and notifications based on observed connectivity and reminder needs.

## Later / Parking Lot

Ideas we like but are not committed to yet:

- Alternating households, temporary absence, household departure, and personal-data portability.
- Calendar/school context ingestion.
- Sibling cover requests, swaps, reciprocal promises, and any household-economy behavior.
- Meal planning, pet inventory, renovation projects, and other adjacent household domains.
