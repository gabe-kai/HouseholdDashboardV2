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

### CURRENT

- [ ] **Outcome: Recognize the family and understand its day.** Friendly household profiles and saved family order, compact day/person routine History with action detail, and one deliberate evaluation reset that preserves household setup.
  - **Brief:** `P0-006C r1 - Household Profiles and Useful History` (`briefs/p0-006c-household-profiles-useful-history.md`).
  - **Status:** READY; Engineering readiness returned READY with no blockers or material questions. Architecture has authorized implementation. Third/final technical slice of the existing approved P0-006 proposal.
  - **Evidence target:** Local profile/token/order and summarized History journeys; exact reset retention, atomicity/replay, and offline recovery; phone/desktop/touch/keyboard evidence with preserved regression coverage. Project Lead evaluates the connected experience after technical acceptance.

### LIKELY NEXT

- [ ] **Multi-Responsibility Today.** After the connected P0-006 experience is evaluated, use the preserved Product direction to choose the first ordinary household responsibility and completed/current/later/anytime presentation. Exact scope/brief waits for that evidence; no assignment engine or chore domain is pre-authorized by C.

### LATER

- Further ordinary household responsibilities such as Kitchen, Cats, and Bathroom, sequenced from the first Multi-Responsibility Today evidence.
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
