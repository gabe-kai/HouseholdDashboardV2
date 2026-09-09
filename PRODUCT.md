# Product

> This document describes why the product should exist, who it serves, and what outcomes and behavior are intended. Avoid implementation detail unless it materially affects the product.

`TBD` is allowed. Fill only what is known or needed for the next useful outcome.

## Product promise

What useful change should this product create, in one sentence?

Help a household make recurring responsibilities and self-directed work clear, responsive, and trustworthy while giving each person an appropriate degree of control.

## Users and stakeholders

- **Primary users:** One household of six people: two parents and four children with different levels of routine authority.
- **Operators/maintainers:** The household's adult managers and the Project Lead during early evaluation.
- **Other stakeholders:** Household members who need reliable shared status or may later help, cover, or coordinate work.

## Problem and context

What problem, opportunity, or recurring situation are we addressing? What do people do today?

Household work is shared, but responsibility, execution, and authority are not identical. Parents need to define obligations and see progress without turning the system into surveillance or a slow approval bureaucracy. Children need a checklist that keeps up with real morning use and a path from assigned work toward independent planning. Existing informal reminders and one-size-fits-all task lists do not preserve history, explain who was responsible, or adapt cleanly to different levels of trust.

## Desired outcomes

Describe observable outcomes rather than implementation tasks.

- A real recurring Morning Routine remains easy to execute rapidly on a phone.
- Six people use distinct authenticated identities within one shared household.
- Household managers retain shared-routine authority while selected children can customize directly and others can propose changes for approval.
- Personal changes affect only the intended member and future occurrences; shared changes continue to flow without cloning the entire routine.
- Each person can create basic personal work, either private or household-visible.
- Shared status, history, and household-local dates remain trustworthy across devices.

## Core workflows

What do users or operators need to accomplish repeatedly?

1. A household manager defines and prospectively revises the shared Morning Routine.
2. A member signs in, sees their own Today view, and checks off assigned routine items with immediate feedback.
3. A directly authorized member adds and orders personal routine items; a restricted member proposes an item and a manager approves or rejects it.
4. Any member creates and completes a basic personal task with private or household-visible scope.
5. A manager moves among their own Today view, household routine status, and pending approvals.
6. Household members inspect past occurrences without later routine, permission, or membership changes rewriting them.

## Product behavior

Record behavior that matters to users, including important states, decisions, feedback, and edge cases.

The shared Morning Routine is a household-owned base. Personal routine content is layered over that base for one membership rather than copied into an independent routine. For this milestone, inherited shared items remain protected; directly authorized members may add and reorder their own personal additions, and proposal-authorized members may request an addition. An approved proposal affects future applicable occurrences only and retains proposer, decision maker, and decision time.

Today remains phone-first. Completed work is quiet, the current responsibility is actionable, and later work is visible without dominating the screen. Controls reflect the signed-in member's authority, but server authorization—not hidden controls—decides what is allowed. Checklist taps remain optimistic and durable through ordinary transient disconnection, with committed state reconciling across household devices.

Personal tasks are intentionally thin in P0-002: one owner, a title, open/completed state, and private or household-visible scope. Due dates, recurrence, reminders, projects, and generalized workflow are later concerns.

## Inputs, outputs, and interfaces

This may include a UI, API, CLI, scheduled job, report, dataset, model interaction, integration, device, or game controls.

- **Inputs:** Credentials, household enrollment claims, routine definitions, personal additions and ordering, approval decisions, checklist status intent, personal-task title and visibility.
- **Outputs:** Member-specific Today content, household progress, pending decisions, future-routine previews, stable historical occurrences, and personal-task views filtered by visibility.
- **Interfaces/channels:** Responsive mobile/desktop browser UI, same-origin JSON API, WebSocket change notifications, and narrow operator commands for initial bootstrap and backup/restore.

## Success and failure

- **Success:** Six distinct members can use one securely reachable household deployment; progressive authority is understandable; rapid checklist use remains immediate; changes remain member-scoped and prospective; and direct API bypass attempts are denied.
- **Failure/recovery:** Pending checklist intent remains visible and retryable after transient connection loss. Rejected or invalid changes explain what happened without silently disappearing. Sessions expire or can be revoked, and deployment data has a documented backup/restore path. Account recovery beyond operator-assisted evaluation recovery remains future work.

## Trust, safety, privacy, and accessibility

Record product-level expectations or risks. Technical controls belong in Architecture.

- Household membership, children's identities, routine content, personal tasks, and completion history are private family data.
- Private personal tasks are visible only to their owner; household-visible work is visible only inside the household.
- Authentication must be suitable for real family evaluation over HTTPS, and every read/write scope must be authorized on the server.
- Do not use real household identities or credentials in committed fixtures, reports, or logs.
- Primary flows must be usable with keyboard navigation, accessible names, visible focus, non-color state cues, and practical phone-sized touch targets.

## Quality attributes users notice

Examples include clarity, responsiveness, accuracy, reliability, explainability, tone, accessibility, or creative feel.

- Immediate checklist response even during rapid taps.
- Clear identity and authority: people can tell whose view they are using and why an action is or is not available.
- Trustworthy history and household-local dates.
- Fast, comprehensible shared-state updates across devices.
- A routine editor and post-save path that make the saved result easy to find and preview.

## Explicitly wanted

- Capability-based authority attached to household membership, not inferred from age.
- One shared base routine with per-member future-effective personalization.
- A narrow propose/approve/reject flow for personal additions.
- Independent personal task creation for every authenticated member.
- Private and household-visible personal work.
- Practical secure access from multiple real phones.

## Explicitly out of scope

- Generalized chore rotation, eligibility, helper assignment, swaps, cover, claims, or chore debt.
- Skip Days, retrospective completion, complete notifications, or calendar ingestion.
- Multiple-household switching, household splitting/departure workflows, or a universal permission editor.
- Generic approvals/workflow, enterprise SSO, social sign-in combinations, or MFA policy administration.
- Homework systems, projects, meal planning, pet inventory, or broad household-management expansion.
- Full recurrence, due dates, reminders, or privacy matrices for personal tasks.

## Open product questions

- What parent-approved language should replace technical obligation terms such as `as_needed`?
- When personal removal is introduced, which shared items may be removable and how should that be communicated?
- Which account-recovery experience is appropriate for adults and children after the first family evaluation?
- What should the product retain, export, or delete when a person eventually leaves a household?

## Evaluation discoveries

Record durable learning from users, operators, stakeholders, analytics, experiments, or other representative evidence. Technical acceptance does not imply product acceptance.

- P0-001 technically proved append-only routine revisions, snapshotted dated occurrences, separate assignment/execution facts, optimistic IndexedDB-backed checklist intent, fast shared invalidation/reconciliation, and household-timezone authority in the merged application.
- In Project Lead evaluation, a long real-world Morning Routine could be created and confirmed, but the save left the evaluator without a useful next destination. Because the applicable date was not discoverable or adjustable from that flow, child execution could not be exercised immediately. The routine editor also appeared intentionally narrow, with no obvious advanced options or path to other responsibility types. P0-002 should supply a clear prospective effective date and future preview while leaving generalized scheduling and responsibility types out of scope.
- P0-001 is technically accepted. These observations are product evidence, not proof that the experience has received final Project Lead acceptance.
