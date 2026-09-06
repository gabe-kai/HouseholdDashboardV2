# Studio Coordinator Guide

The Coordinator facilitates the conversation between teams. The Coordinator does not need to understand every technical detail and should avoid becoming the translation layer when a team's full message can be carried directly.

The Project Lead and Coordinator may be the same person. A new builder may use a more experienced collaborator as Coordinator while retaining product authority.

## The Coordinator's six jobs

1. **Route** - send each question to the team that owns it.
2. **Track** - keep `PROJECT_STATE.md` current enough that a fresh team can see who has the ball.
3. **Record** - make sure approved decisions, brief revisions, and durable discoveries reach project files.
4. **Protect authority** - technical teams do not make hidden product choices, and the Project Lead is not forced to decide low-level engineering details.
5. **Protect momentum** - readiness review exists to unlock building, not to reward teams for finding ever-smaller objections.
6. **Synchronize visibility** - when an external project board is used, keep it aligned with confirmed project state without turning it into a second source of truth.

Repository collaboration policy lives in `CONTRIBUTING.md`. The Coordinator does not need to make the Project Lead manage branches, commits, or PR mechanics.

## Routing guide

**We have an idea or want the product to feel different.**
-> Product

**We know what we want and need a technical plan.**
-> Architecture

**We have an exact brief revision that needs repository review or implementation.**
-> Engineering

**Something seems broken, disputed, risky, or regression-prone.**
-> QA when independent verification is useful

**A real user tried it and has reactions.**
-> User Feedback notes, then Product for experience changes or QA for DEFECT-LIKE observations

## Working-meeting protocol

### 1. Carry the message, not your interpretation

Prefer:

> Engineering reviewed P1-002 r2 and returned the following BLOCKER. Architecture, please evaluate it.

Avoid rewriting a technical explanation into your own version unless necessary.

### 2. Ask who owns the next decision

A good team handoff should make the next owner obvious.

If Engineering raises a repository conflict, Architecture owns the first technical response.

If Architecture says `REFER TO DESIGN`, only then does the product question go to Product / the Project Lead.

### 3. Keep revision identity intact

Always carry:
- brief ID;
- brief revision;
- readiness/build/acceptance status.

Do not say only "the import brief" when multiple revisions may exist.

### 4. Make the outcome durable

If a team changed something important but could not edit project files, look for its `FILE UPDATES` section and apply it directly or ask a write-capable agent to apply it as recorder.

Do not independently reinterpret those updates.

### 5. Update repository-side work state

After meaningful handoffs, keep `PROJECT_STATE.md` accurate enough to answer:
- what is being worked on;
- which revision;
- which team currently owns the next action;
- which branch/PR contains implementation work, if any;
- what it is waiting on.

### 6. Synchronize the external project board

When a project board is used, treat it as a visibility/learning layer derived from confirmed work state.

Recommended columns:

**Ideas / Backlog -> Up Next -> In Progress -> Ready to Evaluate -> Accepted**

Architecture defines the user-facing card in the implementation brief. The Coordinator normally applies board movement when the relevant handoff confirms a state change.

Typical movement:
- Architecture selects/briefs the near-term outcome -> **Up Next**;
- Engineering begins implementation -> **In Progress**;
- Architecture returns `FIX REQUIRED` -> remain in or return to **In Progress**;
- Architecture returns `ACCEPTED` and the result is working and observable -> **Ready to Evaluate**;
- Project Lead/user accepts the experience -> **Accepted**;
- planned work is deliberately deferred -> **Ideas / Backlog**.

Do not infer **Accepted** from technical acceptance alone.

At first, the Coordinator may maintain the board completely. As the Project Lead gains confidence with the workflow, they can gradually take ownership of choosing **Up Next**, evaluating results, moving accepted work, and creating cards.

### 7. Enforce the disagreement budget

Normal pre-implementation review gets one consolidated Engineering readiness pass and one Architecture response. Engineering's next normal disposition is READY and implementation begins.

If Engineering still has a genuinely material unresolved issue, it returns `ESCALATE` and names the owning authority. Do not shuttle the same brief back and forth indefinitely.

The Coordinator should intervene when:
- Engineering drip-feeds concerns that reasonably belonged in the first readiness pass;
- Architecture revises the brief for NOTES, stylistic preferences, or normal implementation details;
- a brief reaches r3 before any implementation attempt;
- teams are debating an uncertainty that a cheap implementation or evaluation could answer;
- Architecture begins fully briefing later roadmap items before the current slice has produced the evidence they depend on.

At r3 before first implementation, pause and identify the cause. At r4+ before first implementation, require an explicit exception and record why another revision is justified.

There are no contract addenda. One current brief file is authoritative; changes are folded into it and its revision history.

## Project activation and Git coordination

A new project should establish its identity and durable planning state before normal brief branches begin.

If Git initialization is explicitly authorized:

1. confirm the intended project root;
2. confirm the basic project identity/state files have been activated enough for a meaningful baseline;
3. initialize Git with `main` as the initial branch according to `CONTRIBUTING.md`;
4. create the first baseline commit on `main`;
5. only then create a brief/feature branch;
6. publish a remote only when explicitly requested, after local `main` is correct.

This ordering prevents a first brief branch from accidentally becoming the repository's historical/default root branch.

## Git and integration coordination

Git should support the studio process rather than become another meeting the Project Lead has to run.

For normal brief-driven work after activation:

1. Engineering or another authorized local contributor creates/uses the brief branch described in `CONTRIBUTING.md`, based on integrated `main`.
2. Engineering reports branch/commit/PR information in the Build Report.
3. Architecture accepts or rejects the exact brief revision based on the implementation evidence.
4. After `ACCEPTED`, the Coordinator or authorized contributor integrates the branch/PR into `main`.
5. Update `PROJECT_STATE.md`, synchronize the external board as appropriate, and delete the merged branch when practical.

If no remote exists, a pull request is not mandatory. A clean local branch/merge is enough for a small project.

Do not ask a web-based team to pretend it performed Git operations it cannot actually perform. It can review, decide, and provide `FILE UPDATES`; a local/write-capable contributor handles the mechanical operation.

### Dirty working tree

If a local agent reports unrelated uncommitted changes, do not instruct it to wipe, reset, or stash them merely for convenience. Preserve the work and decide how to isolate the task safely.

## Standard loops

### Engineering readiness returns QUESTION or BLOCKER

1. Confirm Engineering returned one consolidated review of all currently known material issues and cited repository evidence for any BLOCKER.
2. Carry the full review to Architecture.
3. Architecture returns ACCEPT, REVISE, REFER TO DESIGN, or DEFER using the smallest change needed to unlock implementation.
4. If REVISE materially changes the contract, Architecture increments the brief revision in the same authoritative brief file.
5. Carry Architecture's response/current revision back to Engineering for final disposition.
6. Engineering should normally return READY and implement. If a material dispute genuinely remains, it returns ESCALATE to the owning authority rather than another ordinary objection round.

### Architecture returns FIX REQUIRED

If the contract did not change:
1. Keep the same brief revision.
2. Return the acceptance findings directly to Engineering.
3. Keep the project card in **In Progress**.
4. Engineering fixes and returns an updated Build Report.

If the contract must change:
1. Architecture increments the brief revision.
2. Return to Engineering readiness review.

### Architecture returns ACCEPTED

1. Confirm acceptance names the implemented brief revision.
2. Integrate the branch according to the project workflow when authorized.
3. If the result is runnable/user-visible, move its external card to **Ready to Evaluate**.
4. Do not treat that board movement as user/product approval.

### Player says "this feels wrong"

1. Preserve the user's exact observation.
2. If it seems DEFECT-LIKE, QA can investigate.
3. If implementation matches the contract but the experience is undesirable, route it to Product.
4. Keep or move the card according to the actual next action; do not mark it **Accepted** merely because Engineering and Architecture completed their work.
5. Do not ask the user to prescribe code values.

## When to involve the Project Lead

Bring the Project Lead decisions about:
- what the product should do;
- which creative option is preferred;
- whether a tradeoff changes the experience enough to matter;
- what to prioritize next;
- whether a **Ready to Evaluate** result is valuable and worth retaining.

Do not bring the Project Lead questions such as file placement, signed velocity conventions, test organization, module boundaries, branch naming, or merge mechanics unless those choices materially alter the product experience.

## Copy/paste handoffs

### To Architecture

```text
Engineering reviewed [BRIEF ID] revision [N] and returned the feedback below.

Please respond as Architecture with one primary disposition: ACCEPT, REVISE, REFER TO DESIGN, or DEFER. Use the smallest clarification needed to unlock implementation; do not revise for NOTES or ordinary implementation preferences. If the contract changes materially, increment the brief revision in the same authoritative brief file. This is the Architecture response within the normal disagreement budget. Include FILE UPDATES if you cannot edit the shared files.

[PASTE ENGINEERING FEEDBACK]
```

### To Engineering

```text
Architecture has issued [BRIEF ID] revision [N].

Please perform one consolidated Engineering readiness review against the current repository. READY is the default unless a concrete material issue prevents responsible implementation. Resolve normal implementation details yourself and investigate repository facts before raising them. If READY, implement this exact revision and return a Build Report naming the revision. Follow CONTRIBUTING.md and AGENTS.md for repository/Git safety. If QUESTION or BLOCKER, return all currently known material readiness findings together for Architecture.
```

### To Product

```text
The technical teams need a product decision on the question below.

Please answer as Product, identify what the Project Lead must choose if a human choice is required, and preserve any durable design decision in PRODUCT.md or FILE UPDATES.

[PASTE QUESTION]
```
