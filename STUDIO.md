# AI Development Studio Process v0.3.0

## Purpose

Projects built with this template are led by humans and coordinated across specialized AI teams. The process is designed to make multi-agent development understandable, repeatable, reviewable, and portable across project types.

The goal is not maximum process. The goal is clear communication while moving toward the next usable result.

## Core loop

1. **Discover** - Product explores the need, opportunity, constraint, or idea with the Project Lead.
2. **Define** - Product records the intended user or operational outcome.
3. **Plan** - Architecture converts approved intent into a small implementation brief.
4. **Review** - Engineering checks that exact brief revision against the real repository.
5. **Build** - Engineering implements when the revision is READY.
6. **Accept** - Architecture compares the Build Report to the same brief revision.
7. **Evaluate** - users, operators, stakeholders, or representative evidence test the result.
8. **Improve** - observations become product information, defects, or new work.

Independent QA is inserted when useful; it is not a mandatory toll booth for every tiny task.

Git branches, commits, pull requests, and an optional external project board support this loop behind the scenes. They should not become extra creative gates for the Project Lead.

## Human roles

### Project Lead / Product Owner

Owns product intent and final creative decisions.

### Studio Coordinator

Owns coordination state: who has the ball, what is waiting, whether durable outcomes reached shared project files, and whether any external project board reflects confirmed project state.

One person may perform both roles. A new builder may use a more experienced collaborator as Coordinator without giving up product authority.

## Team authority

### Product
Owns intended outcomes, users and stakeholders, workflows, behavior, constraints, value, and product questions.

### Architecture
Owns technical decomposition, implementation contracts, sequencing, technical conventions, user-facing project-card representation, and acceptance against technical contracts.

### Engineering
Owns repository-grounded readiness review, implementation, code quality, implementation verification, and factual reporting about current code.

### QA
Owns independent verification, reproduction, regression thinking, edge cases, and test-gap identification when requested.

### User Feedback
Owns observations from real-world evaluation: usefulness, clarity, friction, trust, performance as experienced, surprises, and new needs.

An AI may organize User Feedback notes or analyze supplied evidence, but it must not invent user research, stakeholder approval, operational results, or personal experience that did not happen.

## Source-of-truth hierarchy

Different questions have different authorities.

| Question | Authority |
| --- | --- |
| What experience do we want? | `PRODUCT.md` plus Active decisions |
| What currently exists in code? | The actual repository |
| What is Engineering being asked to change? | The current revision of the assigned brief |
| What technical conventions have we deliberately adopted? | `ARCHITECTURE.md` plus Active decisions |
| How should repository work be contributed and integrated? | `CONTRIBUTING.md`, unless explicitly overridden for this project |
| What work is underway or waiting? | Brief/report facts summarized by `PROJECT_STATE.md` |
| What outcomes are likely next? | `ROADMAP.md` |
| Does implementation satisfy the technical contract? | Architecture acceptance using implementation/QA evidence |
| Is the result useful, desirable, and worth retaining? | Project Lead using real evaluation evidence |

`PROJECT_STATE.md` is an index, not a substitute for the underlying artifacts.

An external project board is a visibility layer derived from these sources. It does not override them.

### Repository truth is descriptive, not conservative

The repository is authoritative about what exists now. It does not automatically decide what should remain.

If a brief intentionally changes existing behavior, Architecture may confirm that the difference is intentional. Engineering must report conflicts rather than silently assuming either the repository or the brief is wrong.

## Team boundary rule

A team may propose an answer outside its authority, but it must label it as a proposal and route the decision to the owning team.

Examples:
- Engineering may report that real-time synchronization is expensive, but may not replace it with manual refresh without Product approval.
- Architecture may identify two technically clean workflow options, but Product / the Project Lead chooses the intended experience.
- User Feedback may dislike behavior that correctly matches the brief; that is product feedback, not automatically a defect.

## Durable writeback rule

A conversation is not durable project memory by itself.

Each team should maintain the files it owns when it has write access. If it cannot edit the shared project files, it must end the handoff with a clearly labeled `FILE UPDATES` section containing the exact durable changes that need to be applied.

A write-capable Coordinator or agent may apply another team's explicit file updates as a recorder. Applying an already-decided update does not transfer decision authority.

Do not leave important conventions, approved decisions, brief revisions, or current-work changes trapped only in chat history.

## Artifact ownership

- Product maintains `PRODUCT.md`.
- Architecture maintains `ARCHITECTURE.md`, `ROADMAP.md`, brief content, brief revision numbers, and the user-facing project-card definition for each brief.
- Architecture records technical decisions in `DECISIONS.md`; Product records product decisions there when appropriate.
- Engineering maintains Engineering readiness reviews and Build Reports.
- QA maintains durable QA reports when one is needed.
- User Feedback / Coordinator maintains preserved evaluation notes when they are worth saving.
- The Studio Coordinator maintains `PROJECT_STATE.md` and synchronizes any external project board. If no separate Coordinator exists, any write-capable team may record confirmed state changes without inventing new decisions.

## Project-board model

An external board is optional. It may be Trello, GitHub Projects, Jira, Monday, a whiteboard, or another simple Kanban-style tool.

Its purpose is to make meaningful outcomes visible and, when useful, teach project tracking. It is not a duplicate technical backlog.

Recommended columns:

- **Ideas / Backlog** - a preserved or approved idea not scheduled next;
- **Up Next** - Architecture has selected the outcome for near-term work and the brief is being prepared/reviewed or is ready to start;
- **In Progress** - Engineering has begun implementation;
- **Ready to Evaluate** - Architecture has technically accepted a runnable/user-visible result and it is ready for Project Lead/user review;
- **Accepted** - the Project Lead has accepted the user-facing result and the project intends to retain it.

Project-card rules:
- describe user-visible outcomes rather than internal engineering tasks;
- use short language understandable without the technical brief;
- keep technical decomposition, file names, framework work, refactors, and infrastructure details off the external card unless they are meaningfully observable;
- normally represent one coherent user outcome with one card;
- attach enabling/infrastructure work to an existing user-facing card rather than inventing meaningless cards when practical;
- use observable `Done when` wording;
- avoid story points, velocity, sprint ceremony, and similar overhead unless the Coordinator deliberately introduces them for a learning purpose.

The Coordinator applies board movement from confirmed team state. If a team cannot update the external tool directly, it should state the exact card title and recommended movement.

## Technical acceptance vs. user acceptance

`ACCEPTED` in a brief lifecycle means Architecture has verified that the implementation satisfies the reviewed technical contract.

It does **not** mean the Project Lead has decided the resulting experience should remain in the product.

A technically accepted usable result normally becomes **Ready to Evaluate**. After evaluation, the Project Lead may:
- accept it into the product;
- ask Design to change the experience;
- defer it;
- reject it entirely.

A technically correct experiment that reveals an undesirable design is still useful evidence, not necessarily a technical failure.

## Brief revisions

Every implementation brief has a stable ID and an integer revision.

Example:

`P1-002 r2 - Import Validated Customer Records`

Rules:
- Architecture creates revision 1.
- Any material change to the behavioral contract, acceptance tests, implementation boundary, dependencies, or protected behavior increments the revision.
- Editorial corrections that do not change meaning do not require a new revision.
- An Engineering readiness result applies only to the revision it names.
- A Build Report must name the exact revision implemented.
- Architecture acceptance must compare the Build Report to that same revision.
- If Architecture changes the contract after a build, increment the revision and return to Engineering readiness review.
- There is one current authoritative brief file per brief ID. Do not create contract addenda, clarification sidecars, or chat-only supplements; fold material changes into the brief and revision history.
- A brief should normally reach its first implementation attempt by r1 or r2.
- If a brief reaches r3 before any implementation attempt, the Coordinator pauses the review loop and checks why implementation has not started.
- r4 or later before first implementation is an exception requiring explicit Coordinator authorization and a recorded reason.

## Brief lifecycle

Recommended happy path:

`DRAFT -> IN REVIEW -> READY -> IMPLEMENTING -> IMPLEMENTED -> ACCEPTED`

`BLOCKED` may temporarily replace `IN REVIEW` or `READY` when a material issue prevents implementation.

### Readiness loop

The goal of readiness review is to make implementation safe enough to begin, not to eliminate all uncertainty.

**READY is the default outcome.** Engineering should return QUESTION or BLOCKER only for a concrete material issue that cannot reasonably be resolved through normal implementation discretion, repository investigation, or a cheap implementation or evaluation experiment.

Engineering returns:
- **READY** - implementation can reasonably proceed. Minor ambiguity, style preferences, possible future improvements, and non-blocking risks become NOTES or Engineering decisions rather than gates.
- **QUESTION** - two or more materially different plausible interpretations remain, and choosing incorrectly is likely to cause meaningful rework or change user-visible behavior. Questions must be consolidated into the current review.
- **BLOCKER** - implementation cannot responsibly proceed because the brief is contradictory, conflicts with an Active decision, relies on an unavailable prerequisite, or would require Engineering to invent a significant product/architecture decision.
- **ESCALATE** - after the normal disagreement budget is exhausted, a remaining material dispute is routed to the team/person who owns that decision rather than starting another ordinary review cycle.

A QUESTION or BLOCKER must be evidenced. Engineering performs reasonable repository investigation first and does not externalize normal implementation decisions such as local naming, helper structure, or equivalent code organization.

Architecture responds to readiness feedback with one primary disposition:
- **ACCEPT** - Engineering's interpretation is correct; no contract change is needed.
- **REVISE** - update the brief. Increment revision if the contract materially changed.
- **REFER TO DESIGN** - a user/product decision is required.
- **DEFER** - valid concern, intentionally outside the current brief or within Engineering discretion.

Architecture should make the smallest clarification needed to unlock implementation. Do not revise a brief merely to absorb NOTES, preferences, wording polish, or implementation details that do not change the contract.

If a material brief revision occurs, previous readiness is no longer valid.

### Disagreement budget

Normal pre-implementation disagreement is limited to two handoff rounds:

1. **Engineering readiness pass** - Engineering inspects the whole relevant repository surface and returns one consolidated set of all currently known material readiness concerns.
2. **Architecture response** - Architecture resolves, revises, defers, or refers those concerns.
3. **Engineering final disposition** - Engineering normally returns READY and begins implementation. If a genuinely material issue still cannot be resolved within existing authority, return ESCALATE rather than opening another ordinary objection round.

Do not drip-feed newly noticed objections that reasonably could have been found in the first readiness pass. A newly discovered fact may still be raised later when it was not reasonably discoverable earlier.

When escalation is required, route the disputed decision to its owner:
- user-visible/product behavior -> Product / Project Lead;
- technical contract or convention -> Architecture;
- factual repository state -> Engineering demonstrates the fact from the repository;
- acceptance disagreement -> Architecture decides, optionally using QA evidence.

Teams may advise outside their authority, but they do not gain veto power over the owning team's decision.

When a small implementation or evaluation can resolve uncertainty more cheaply than another specification round, build the slice and learn from evidence.

### Acceptance and fix loop

Architecture returns:
- **ACCEPTED** - implementation satisfies the reviewed brief revision.
- **FIX REQUIRED** - implementation does not yet satisfy that revision.

If the contract has not changed, `FIX REQUIRED` returns directly to Engineering against the same revision; a new readiness review is not required.

If the proposed fix requires changing the contract, Architecture increments the brief revision and the normal readiness cycle starts again.

## Evidence-gated planning

`ROADMAP.md` may look several outcomes ahead, but later outcomes should stay intentionally lighter than current work.

Use three planning horizons:
- **CURRENT** - the next evidence-producing outcome; detailed enough to brief and implement;
- **LIKELY NEXT** - a plausible next outcome whose exact contract may depend on what CURRENT teaches;
- **LATER** - preserved direction or ideas that do not need technical detail yet.

A roadmap item is not an implementation contract.

Normally create or fully detail only the brief justified by current evidence. Do not pre-author a chain of speculative briefs merely because the likely sequence seems obvious. Let each runnable/usable slice teach the studio something before over-specifying later work.

## Issue severity

Use these severities inside team reports:
- **BLOCKER** - cannot responsibly continue; must cite the concrete fact or conflict that prevents progress.
- **IMPORTANT** - meaningful risk, ambiguity, or likely rework, but not automatically a reason to stop.
- **NOTE** - useful discovery with no required action for the current task.

IMPORTANT and NOTE findings do not become implementation gates merely because they are worth recording.

## QA policy

QA is independent verification, not a required stage for every brief.

Use QA when:
- the change is risky or regression-prone;
- acceptance is hard to observe;
- Engineering and Architecture disagree about behavior;
- a human evaluation reports something DEFECT-LIKE;
- a previous defect needs reproduction or regression verification;
- the Project Lead or Coordinator wants a second technical opinion.

Architecture may accept ordinary low-risk work without separate QA evidence.

## Brief sizing

Prefer briefs that:
- have one main behavioral outcome;
- move toward something usable or observable;
- can be reviewed independently;
- minimize unrelated refactoring;
- contain observable acceptance criteria;
- make dependencies explicit;
- are small enough that a failed implementation is easy to reason about.

Prefer vertical usable slices over infrastructure for its own sake.

For experimental or user-facing work, state a **Learning question** when useful: what uncertainty should building and evaluating this slice reduce? A brief may use `N/A` when no meaningful learning question exists.

## TBD is a valid state

Do not force every open question to resolution before work begins.

Resolve only what blocks the next meaningful usable slice. Preserve genuinely open questions as `TBD` or in the relevant open-questions section.

## No invisible decisions

Meaningful choices that affect future work should be captured in `DECISIONS.md`.

Good candidates include:
- data ownership and schema conventions;
- interface and API contracts;
- identity, permissions, and security boundaries;
- persistence, retention, and migration rules;
- naming and module conventions;
- runtime, deployment, and integration assumptions;
- supported environments and intentional non-support decisions.

## Human-friendly handoffs

The Coordinator should be able to carry a team's response to another team without translating its technical meaning.

Teams should:
- name the brief ID and revision they are discussing;
- use explicit statuses;
- separate required decisions from optional suggestions;
- say which team owns the next decision;
- state project-card movement when the external board should change;
- include `FILE UPDATES` when durable project files need changes but cannot be edited directly.

## Engineering philosophy

Prefer technology that leaves the product understandable to the people building it.

"Simple" does not always mean "fewest dependencies." A well-chosen application framework may be simpler to learn, debug, and modify than a home-grown replacement. Choose technology based on what makes this product easiest for this studio to understand, change, run, and host.

Do not solve hypothetical scale problems. Projects should earn complexity by needing it.

Favor:
- a fast path from opening the project to running and evaluating it;
- clear, modifiable code over clever abstraction;
- vertical usable slices over infrastructure completeness;
- existing project patterns over unnecessary rewrites;
- small dependency surfaces;
- local, deterministic behavior where practical;
- ordinary contemporary hardware rather than high-end assumptions.

## Default technical and product assumptions

The template is technically neutral. It does not assume a browser, graphical interface, backend, database, AI model, cloud provider, hosting model, or deployment target. Architecture derives those choices from product intent, repository reality, and explicit constraints.

Across project types, prefer these defaults:

- choose the simplest delivery model that satisfies the current outcome;
- preserve existing repository patterns unless there is evidence to change them;
- make the local run, test, and evaluation path short and documented;
- keep interfaces, data ownership, trust boundaries, and operational dependencies explicit;
- require approval for paid services, new external accounts, credential use, or consequential data handling;
- never expose secrets in client code, source control, logs, reports, or generated artifacts;
- minimize dependencies while using well-chosen frameworks when they make the system easier to understand and maintain;
- treat accessibility, privacy, security, licensing, data retention, migration, observability, and performance as project-specific concerns to resolve when relevant;
- optimize from measurements and observed constraints rather than hypothetical scale;
- record material platform and operational choices in `ARCHITECTURE.md` or `DECISIONS.md`.
