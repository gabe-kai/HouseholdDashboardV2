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

- A parent can create and manage multiple real household routines, including Morning, After School, and Bedtime, with independent people/groups, schedules, dayparts, steps, and history.
- Each member can execute every applicable routine rapidly on a phone; completing one routine does not complete another.
- Six people use distinct authenticated identities within one shared household.
- Household managers retain shared-routine authority while selected children can customize directly and others can propose changes for approval.
- Personal changes affect only the intended member and future occurrences; shared changes continue to flow without cloning the entire routine.
- Each person can create basic personal work, either private or household-visible.
- Shared status, history, and household-local dates remain trustworthy across devices.

## Core workflows

What do users or operators need to accomplish repeatedly?

1. A household manager opens Routines, creates a named routine, chooses its people/groups, weekdays and daypart, and adds ordered steps. Opening an existing routine shows a read-first summary; editing is explicit.
2. A member signs in, sees their own Today view, and checks off assigned routine items with immediate feedback.
3. A directly authorized member adds and orders personal items for a selected routine; a restricted member proposes an item for that routine and a manager approves or rejects it.
4. Any member creates and completes a basic personal task with private or household-visible scope.
5. A manager moves among their own Today view, household routine status, and pending approvals.
6. Household members inspect past occurrences without later routine, permission, or membership changes rewriting them.
7. A manager deletes accidental unused routines when safe, or ends a routine while preserving work already begun and its history.

## Product behavior

Record behavior that matters to users, including important states, decisions, feedback, and edge cases.

A routine is a household-owned, repeatable ordered checklist for selected people on certain days at a meaningful part of the day. Names are household-defined; Morning Routine is an ordinary instance, not a special routine type. Each routine has independent configuration and history. Group selections retain their relationship to the group; membership changes flow to every consuming routine starting on the next household day while today and history remain stable.

Personal routine content is layered over one selected routine for one membership rather than copied into an independent routine. For this milestone, inherited shared items remain protected; directly authorized members may add and reorder their own personal additions, and proposal-authorized members may request an addition. An approved proposal affects that member's future applicable occurrences of that routine only and retains proposer, decision maker, and decision time.

P0-005 uses Every day, Weekdays, Weekends, and Custom days, with Morning, After school, Evening, Bedtime, and Anytime dayparts. Dayparts convey order without requiring exact times. Creation follows four human questions: name, who, when, and steps. Routines opens to a compact list, with focused summary/create/edit states instead of stacked editors. Today must make every applicable routine independently executable; the richer next/later/urgency experience is subsequent work. The r3 routine lifecycle below supersedes the earlier archive-only workflow. Duplicate and restore conveniences are optional future work.

Today remains phone-first. Completed work is quiet, the current responsibility is actionable, and later work is visible without dominating the screen. Controls reflect the signed-in member's authority, but server authorization—not hidden controls—decides what is allowed. Checklist taps remain optimistic and durable through ordinary transient disconnection, with committed state reconciling across household devices.

Personal tasks are intentionally thin in P0-002: one owner, a title, open/completed state, and private or household-visible scope. Due dates, recurrence, reminders, projects, and generalized workflow are later concerns.

### P0-005 r3 - Cohesive routine management and Calm Household

Recorded by Architecture from the supplied Planning & Design r3 proposal as a recorder of Product intent. This is desired behavior; implementation and Product acceptance remain separate.

- **Today is editable until work begins.** Prospective/editable work includes applicable unstarted occurrences today and later, even when already generated. The first committed checklist action locks one person's occurrence permanently; undo does not unlock it. Different children may start independently. Started/completed work and historical records remain trustworthy.
- **Edit the current plan normally.** Save changes updates every applicable unstarted occurrence from today until the next intentional scheduled change. It must not require choosing an effective date for every edit or leave stale future work because it was generated early. Current detail shows how the routine works now, never an internal revision chain.
- **Schedule deliberately.** Schedule for later reveals Starting. Upcoming changes appear only when present; each can be edited repeatedly at the same date, moved, or deleted through ordinary UI. Date conflicts require an explicit choice. Deleting B between current A and later C lets A continue until C's unchanged start. No compensating revision is required to remove a mistake.
- **Correct and end routines.** A parent can delete an accidental/test routine when it has no protected execution/history. End routine stops prospective unstarted work and upcoming changes while retaining protected work/history. Infrequent actions live under More. Removing/reordering a checklist step is normal editing; locked copies retain it.
- **View normally. Edit intentionally.** Read-only detail uses quiet ordered rows, concise people/schedule summaries, and an explicit Edit action. The focused editor organizes Name, When, Who, Steps. Confirm consequential deletion/end and discarding unsaved edits; normal saves/step edits need no repeated confirmations. Feedback is compact and explains the actual effect on unstarted versus started people.
- **One coherent application.** Calm Household means warm, restrained, light surfaces; hierarchy through typography and spacing; consistent accents, controls, notices, focus, and touch behavior. Shared presentation reaches existing Today, Routines, Household, People & Groups, Approvals, History, and supporting screens. It is a modest reusable foundation, not a branding exercise or generic design-system package.
- **Navigation expresses purpose.** Today is daily execution; Routines manages plans; Household provides structure and oversight. Use compact phone navigation with secondary management destinations and no empty future tabs. Preserve existing personal work and authority paths. Do not build the full Multi-Responsibility Today hierarchy in r3.
- **Evaluate the connected experience.** Product judges whether the app feels coherent, routines are understandable without an admin form, mistakes are removable, today's unstarted work is easy to change, and destructive actions are available without dominating. Keep P0-005 CURRENT until that evaluation. Automated evidence and screenshots support, but do not replace, this judgment.

The full deferred inventory below remains preserved and unscheduled. Its future domains inform the shared visual/navigation foundation without becoming r3 implementation work.

### P0-006 - Household experience consolidation and contextual routines

Recorded by Architecture from Planning & Design's post-P0-005 proposal. This is one Product outcome delivered through bounded technical slices so each layer can be evaluated before the next depends on it.

- **P0-006A — Calm Household Experience Foundation:** Make the existing application compact, automatically responsive, visually consistent, and easier to navigate. Use Today / Plan / Household; quiet healthy chrome; integrated page-header Back; transient ordinary success feedback; compact read-first routine views; summary-first routine authoring; and touch-first ordering with an accessible alternative.
- **P0-006B — Contextual Routine Applicability:** Let routine steps apply in household contexts without cloning routines. Keep routine recurrence distinct from step applicability. Begin with a household-owned school calendar and explicit exceptions; determine School Night from calendar evidence rather than weekday assumptions. Preserve P0-005 locks and reconcile only governed unstarted occurrences.
- **P0-006C — Household Profiles and Useful History:** Use friendly household names while retaining full names, birthdays, optional email, token-based access, and capability-based authority. Support household display order. Present History as day -> person -> summarized work with drill-down evidence, and provide a manager-only evaluation-history clear operation that preserves household configuration.
- **Whole-outcome guardrails:** Do not add new responsibility domains, assignment engines, external calendar sync, notifications, homework, meals, multi-household behavior, or a generic rules/design platform. All saved household configuration remains server-backed; unsaved editor drafts need not synchronize across devices. Existing P0-005 routine lifecycle and trustworthy history remain protected.
- **Product evaluation:** Judge whether the application feels like one calm household product, whether phone and desktop layouts are intentional, whether common screens are understandable without initial scrolling, and whether later product domains can inherit the same interaction language without another navigation reset.

### P0-007 - Household Responsibilities & Multi-Responsibility Today

Recorded by Architecture as a writeback of the supplied Planning & Design proposal, not new Product policy. The complete outcome spans three technical slices; only the current brief authorizes implementation scope.

- **Product question:** Can ordinary shared household work join routines in one understandable day? Prove Kitchen, Cats, Bathroom, and Trash & Recycling with one configurable Household Responsibility concept. Avoid special-purpose chore types and a generic rule-builder UI.
- **Foundational distinction:** A Routine happens independently for each applicable person. A Household Responsibility happens once on its applicable household date and has one accountable person. Accountability, authenticated actor and actual performer remain distinct; helpers and Cover/Claim remain future work.
- **Creation and management:** Plan remains the home for routines and responsibilities, using focused summary-first Name/When/Assignment/Work editing, familiar names, accessible drag ordering, current edits and deliberate future changes. Recurrence and assignment are independent. A parent sees concrete upcoming names/dates rather than weights, predicates or rotation formulas.
- **Kitchen and Bathroom:** One responsibility contains daily base work and scheduled additional work, such as a weekly deep clean. Kitchen's unequal weekly pattern may favor older children, give a lighter day to a younger child, exclude the youngest, and alternate deep-clean ownership. Product prefers the deep-clean owner to own the entire combined Kitchen occurrence that day. An explicit repeating household pattern may be preferable to equal round-robin. Bathroom must use the same configurable model. Moving a future deep-clean day preserves historical expected work.
- **Cats and Trash:** Cats is daily pet care with one owner; rotation is wanted. Future Cats helpers may rotate independently. Trash is weekly-only work for a fixed person (for example, Tuesday Evening), with no artificial daily base occurrence. These examples must fit without domain special cases.
- **Trustworthy work:** Unstarted today remains editable. First execution fixes expected work and accountability; future rotation/group changes do not transfer started work. Delete unused setup; End used work while preserving history. No automatic incomplete-work rollover. All responsibility dates/dayparts use the household timezone, including on traveling devices.
- **Connected experience:** Keep Today / Plan / Household. Today combines applicable work by actionability/time, ultimately Completed / Next / Later / Anytime, with immediate durable checklist interaction. Household offers compact title/owner/progress rows and drill-down using neutral states. Responsibilities join existing date -> person -> summarized History with snapshotted work and execution facts; no separate Chore History.
- **Technical sequence:** A proves fixed-owner daily Cats and weekly Trash end to end, including minimum Today/Household/History integration. B proves the minimal understandable assignment patterns plus Kitchen/Bathroom scheduled work and ownership previews. C develops fuller unified Today and oversight presentation. Later briefs refine from evidence within this existing proposal; the sequence does not require Product to resubmit the same intent.
- **Boundaries:** Preserve Calm Household, phone/desktop behavior, profiles/order, contextual routine steps/school context, current/future edits, locks, durable outbox/realtime, authority/isolation, History, evaluation activity clearing, migrations and CI. Helpers, Cover/Claim, swaps/reassignment requests, chore debt (off by default), Skip Day, critical/non-skippable work, retrospective completion, advanced assignment, external calendars, notifications, inventories, meals/homework and multi-household behavior remain deferred.
- **Evaluation:** Automate ordinary UI creation/execution for all four examples across the completed P0-007 sequence, mixed routine/responsibility Today, compact Household and retained History. The Project Lead judges whether people can answer what needs attention and whose turn it is without understanding the implementation. No post-P0-007 feature sequence is committed before that evaluation.

The deferred inventory below continues to preserve helpers, original accountability versus performance credit, Cover/Claim, swaps, optional debt, Skip Day/critical work, retrospective facts, richer patterns, multi-day pet care, and schedule previews. Promotion of the bounded A/B/C outcomes does not authorize those adjacent features.

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
- Multiple independent shared base routines with per-member, per-routine future-effective personalization.
- A narrow propose/approve/reject flow for personal additions.
- Independent personal task creation for every authenticated member.
- Private and household-visible personal work.
- Practical secure access from multiple real phones.

## Explicitly out of the current implementation scope

These are deferrals, not rejected product ideas. The inventory below preserves their intended direction.

For P0-007, CURRENT is the bounded A brief. Responsibility patterns and scheduled additional work have been promoted into the approved B horizon above; they are no longer merely unscheduled ideas, but A does not implement them. Generalized variants and adjacent mechanics remain deferred.

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

## Deferred / Preserved Product Directions

Recorded from Product's P0-005 handoff by Architecture as a writeback of supplied product intent. These directions are wanted or intentionally preserved for future consideration; they are unscheduled unless separately promoted. They are not implementation briefs, promised sequence, target dates, issues, or instructions to build speculative abstractions. CURRENT and LIKELY NEXT live in `ROADMAP.md`.

P0-007 now promotes the ordinary-responsibility, bounded-pattern, scheduled-work and unified-day portions described above. The remaining details in this inventory retain their deferred status.

- **Contextual scheduling:** School mornings/nights, weekend mornings/nights, no-school tomorrow, holidays, and school-calendar exceptions. Friday morning may be school context while Friday evening is weekend context; Sunday evening may be school context while its morning is weekend context. Do not model one global context per date. School/work calendars may eventually inform these distinctions.
- **Exact times and timezones:** Responsibilities may have exact due times, dayparts, or no time. Household responsibilities stay anchored to the household timezone while devices travel; a future display may show both “6:00 PM home time” and “3:00 PM where you are.” Personal-task timezone policy remains separately resolvable.
- **Multi-Responsibility Today:** Completed/past work compact and quiet; next actionable work expanded; later work visible at intermediate detail; untimed work under Anytime Today; timed work in time order; a moving current-time indicator where appropriate; urgency communicated through more than color. Useful anchors include Morning, Before School, After School, Dinner, After Dinner, Bedtime, and Anytime Today.
- **Ordinary household responsibilities:** Kitchen, Bathroom, Cats, Cars, Lawn care, and Trash, described in family language. They must not require users to understand a rule engine.
- **Base checklists with contextual additions:** Kitchen's daily base plus Weekly Deep Clean on the appropriate day, without duplicated near-identical chores. Additions, overrides, or omissions can follow evidence. Future schedules must be easy to change, such as Friday summer deep cleaning moving to Saturday during school, while past occurrences retain prior rules.
- **Assignment patterns:** Fixed people, rotation, eligibility sets, exclusions, alternating patterns, and custom schedules. Recurrence and assignment are distinct: a routine may produce one occurrence per group member, while Cats occurs once for the household with a rotating accountable person.
- **Helpers:** One accountable person with one or more supporting people. On Eli's Cats day another child helps; helper rotation may differ from primary rotation.
- **Kitchen assignment example:** Most Kitchen days go to the oldest two children; a lighter day may go to a younger child; the youngest may be excluded; weekly deep clean alternates among selected older children. Preserve this example until real multi-responsibility use justifies assignment rules.
- **Critical work and Skip Day:** Preserve Required, As needed, and Optional, and consider a stronger non-skippable/critical concept for medication, essential pet care, and trash pickup. Parents should be able to suspend ordinary work for a family outing while critical work remains, with feedback such as “12 responsibilities skipped; 3 still require attention.” Exact terminology remains open.
- **Optional chore debt:** Unfinished work may roll forward, but this is off by default. Earlier experience showed that debt forgiveness can create excessive daily administration.
- **Swaps, reassignment, and approvals:** Members may exchange or reassign work with authority-dependent request/approval paths. Original assignment remains knowable.
- **Cover and performance credit:** Someone can do another person's work and receive credit. If Daniel was accountable for litter and Sarah cleaned it, both facts survive; do not rewrite original assignment.
- **Exploratory household economy:** Older children may request or record exchanges such as “I'll do X if you do Y.” This is exploratory and requires deliberate design before implementation.
- **Retrospective completion:** A person may report “I did that yesterday.” Preserve claimed performance time separately from recorded time; parents may allow direct claims or require approval per child. Do not algorithmically accuse users of dishonesty.
- **Rich execution history:** Retain expected work, originally accountable person, helpers, actual performers, step completion, claimed performance time, recorded time, and resulting state as distinct facts.
- **Growing authority:** Capability settings, not age, govern control. Younger children may propose changes; older children may manage their own routine or contribute to shared content; parents retain required obligations. Authority can grow without rebuilding identity.
- **Richer personal work:** Tasks, due dates, recurring personal routines, time-of-day work, reminders, laundry timers, renovation/project lists. Children remain active organizers rather than only recipients of assigned work.
- **Homework:** Due dates, multi-day progress, assignments, independent child entry, and appropriate privacy. Siblings do not automatically receive access to one another's homework.
- **Visibility and sharing:** Private/household-visible work may expand to selected people, permitted other households, or broader sharing. Visibility stays separate from ownership and assignment.
- **Pet care:** Preparation such as thawing frozen food the previous day, feeding, litter, flea/tick medication, food/litter quantity tracking, and multi-day dependencies beyond one daily checkbox.
- **Meals:** Meal scheduling/planning, recipes, family ratings, rankings, and preferences remain adjacent scope outside the current responsibility loop.
- **Presence across households:** Alternating mom/dad homes, college, temporary absence, custom presence schedules, backup responsibility, and participation in more than one household context.
- **Departure and portability:** Personal work should be able to follow a child leaving home or moving to college. Household-owned responsibilities stay with the originating household and may become unassigned; prior history remains trustworthy. General departure/archival is future work.
- **External calendar context:** School calendars, holidays, work schedules, and household calendar information may inform responsibilities without becoming the sole source of historical truth.
- **Notifications:** Routine and due-time reminders, timer completion, and push notifications should follow observed household need rather than blanket alerting.
- **Offline and installability:** Stronger offline-first behavior, offline first load, PWA/installability, and clearer retry visibility may extend the current durable-mutation foundation.
- **Broader-release operations:** Production-quality recovery, account recovery, stronger backup/restore confidence, privacy hardening, operational monitoring, and deployment reliability beyond current family-evaluation evidence.
- **Family privacy:** Children's identities, routines, personal tasks, homework, and completion history remain private family data. Intentional visibility must survive expansion; household membership does not imply every sibling sees all data.
- **Experience and tone:** Calm, native-feeling, phone-first, neither corporate nor childish, useful as children grow, with subtle personality/customization and satisfying checklists. No gamification unless deliberately chosen later.
- **Authoring conveniences:** Duplicate a routine as a starting point for a weekday/weekend variation, and restore an archived routine when a safe lifecycle is designed. These conveniences do not precede proving independent routine definitions.

## Evaluation discoveries

Record durable learning from users, operators, stakeholders, analytics, experiments, or other representative evidence. Technical acceptance does not imply product acceptance.

- P0-006A r2: after Architecture technical acceptance, the Project Lead reviewed the screenshots, tested the application, and reported satisfaction with the experience. This supplies the evaluation needed to proceed to the contextual-routine slice of the same P0-006 proposal; profiles and useful History remain the third slice.
- P0-001 technically proved append-only routine revisions, snapshotted dated occurrences, separate assignment/execution facts, optimistic IndexedDB-backed checklist intent, fast shared invalidation/reconciliation, and household-timezone authority in the merged application.
- In Project Lead evaluation, a long real-world Morning Routine could be created and confirmed, but the save left the evaluator without a useful next destination. Because the applicable date was not discoverable or adjustable from that flow, child execution could not be exercised immediately. The routine editor also appeared intentionally narrow, with no obvious advanced options or path to other responsibility types. P0-002 should supply a clear prospective effective date and future preview while leaving generalized scheduling and responsibility types out of scope.
- P0-001 is technically accepted. These observations are product evidence, not proof that the experience has received final Project Lead acceptance.
