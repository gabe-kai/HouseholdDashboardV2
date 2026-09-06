# AI Development Studio Template v0.3.0 - Start Here

This folder is a reusable starting point for software, data, AI, automation, and game projects led by humans and supported by specialized AI teams.

Once activated, the project should present itself by its own name in `README.md`. The template name identifies the workflow, not the product.

The studio loop is:

**Discover -> Define -> Plan -> Review -> Build -> Accept -> Evaluate -> Improve**

The process is intentionally lightweight. Use only as much ceremony as helps the next useful, observable outcome get built clearly.

## 1. Human roles

### Project Lead / Product Owner

The Project Lead owns what the product becomes and why it matters.

The Project Lead:
- describes ideas, wishes, and reactions;
- chooses between meaningful creative options;
- approves product decisions;
- evaluates working results with users, operators, stakeholders, or representative evidence;
- decides whether a technically accepted result should be retained.

AI teams advise and execute. They do not quietly replace the Project Lead's intent with an easier product.

### Studio Coordinator

The Coordinator keeps the teams synchronized.

The Coordinator:
- routes messages to the team that owns the question;
- makes sure decisions and handoffs are recorded in project files;
- tracks who currently has the ball;
- keeps the optional external project board synchronized with confirmed project state;
- avoids translating technical meaning when a full team response can be carried directly;
- keeps repository integration work from becoming the Project Lead's problem.

The Project Lead and Coordinator may be the same person. A new builder may use a more experienced collaborator as Coordinator while retaining product authority.

See `COORDINATOR_GUIDE.md` for the working-meeting protocol.

## 2. Team rooms

Use whichever teams the project needs:

- **Product** - What should the product be like?
- **Architecture** - How should we build the next small slice?
- **Engineering** - Does the plan match the real repository, and can it be implemented safely?
- **QA** - Can we independently reproduce, verify, or break something important?
- **User Feedback** - What did users, operators, and stakeholders actually observe?

For a small project, Product and Architecture may be the same AI conversation as long as the conversation clearly switches roles.

## 3. Plain-language names

The same teams can be described as four rooms:

- **Design Room** = Product
- **Planning Room** = Architecture
- **Workshop** = Engineering
- **Evaluation Room** = real users and stakeholders, with QA helping investigate defect-like results

See `NEW_BUILDER_GUIDE.md`.

## 4. Three layers of project rules

Different kinds of guidance live in different places so agents do not have to guess which rule is authoritative.

### `STUDIO.md` - studio defaults and authority

Defines:
- team responsibilities;
- the brief/review/acceptance loop;
- default product and technical assumptions;
- project-board principles;
- what decisions belong to humans vs. teams.

### `CONTRIBUTING.md` - shared repository workflow

Defines:
- safe repository activation and initial Git history;
- Git branch naming;
- commit policy;
- pull request and merge policy;
- dependency, secret, asset, and verification rules;
- what read-only/web contributors should do when they cannot perform Git/file operations themselves.

Humans, web-based AI teams, and local agents should all follow it when they are planning, reviewing, changing, or integrating repository work.

### `AGENTS.md` - extra local-agent safety

Defines additional rules for agents with filesystem, shell, Git, or code-edit access.

It covers safe handling of dirty working trees, destructive commands, scope discipline, validation, and local execution behavior.

## 5. Technical neutrality

The template makes no default choice of platform, interface, framework, hosting model, data store, or delivery channel. Architecture chooses the simplest shape justified by product intent and the current repository. Record material choices in `ARCHITECTURE.md` or `DECISIONS.md` so later teams do not have to rediscover them.

## 6. Do not fill every blank first

`TBD` is allowed.

Do not turn project kickoff into a long questionnaire. Resolve only the questions needed to build the next interesting usable slice. Leave everything else open until it matters.

## 7. Activate a new project

Treat activation as the transition from a reusable template into a real named project.

1. Unzip this template directly into the intended project root.
2. Replace the project identity placeholders in `README.md` and the basic known fields in `PROJECT_STATE.md`.
3. Let Product talk with the Project Lead and capture enough intent in `PRODUCT.md` to identify a useful first outcome. Do not wait for the whole product to be specified.
4. Let Architecture inspect any existing repository context, record the current technical shape in `ARCHITECTURE.md`, and outline an outcome-oriented roadmap.
5. Record important durable choices in `DECISIONS.md`.
6. If Git will be used, initialize it according to `CONTRIBUTING.md`. A new repository's first baseline commit belongs to `main`; do not create a brief branch before that baseline exists.
7. If remote publishing is desired, publish the existing local `main` only after the baseline commit is correct. Remote creation is an explicit Coordinator/Project Lead action, not an automatic agent behavior.
8. Architecture creates the first implementation brief using `templates/BRIEF_TEMPLATE.md`. Only the next evidence-producing slice needs a detailed brief; later roadmap outcomes may remain intentionally lighter.
9. Engineering performs one consolidated readiness review of that exact brief revision against the actual repository. READY is the default when implementation can reasonably proceed.
10. If Architecture must answer readiness concerns, it responds once with the smallest clarification needed. Engineering then normally builds; unresolved material disputes are escalated to the owning authority rather than argued indefinitely.
11. For normal Git-managed work, implementation occurs on a brief branch created from the baseline/integrated `main` according to `CONTRIBUTING.md`.
12. After a build, Architecture performs technical acceptance. Independent QA is used when risk or uncertainty justifies it.
13. A technically accepted branch is integrated according to the project's Git/PR workflow.
14. Evaluation with real users, operators, stakeholders, or representative evidence determines what the team learned and whether the result should be retained, revised, deferred, or rejected.

## 8. Optional project board

A Trello-style board can make work visible and teach project tracking without becoming a second source of truth.

Recommended columns:

**Ideas / Backlog -> Up Next -> In Progress -> Ready to Evaluate -> Accepted**

Architecture defines the outcome-facing card for a planned slice. The Coordinator keeps the external board synchronized when one is used. Technical acceptance moves working results to **Ready to Evaluate**; Project Lead or stakeholder acceptance moves them to **Accepted**.

The repository, approved design, decisions, roadmap, briefs, and implementation evidence remain authoritative. See `STUDIO.md` and `COORDINATOR_GUIDE.md`.

## 9. Role-specific reading

Do not make every team re-read the whole project on every turn.

### Product
Read:
- `STUDIO.md`
- `PROJECT_STATE.md`
- `PRODUCT.md`
- relevant entries in `DECISIONS.md`
- `teams/PRODUCT_TEAM.md`

Read technical documents only when a technical constraint materially affects the user experience.

### Architecture
Read:
- `STUDIO.md`
- `PROJECT_STATE.md`
- `PRODUCT.md`
- `ARCHITECTURE.md`
- `DECISIONS.md`
- `ROADMAP.md`
- `teams/ARCHITECTURE_TEAM.md`
- relevant repository context

Read `CONTRIBUTING.md` when planning repository workflow, dependencies, integration, or constraints that affect a brief.

### Engineering
Read:
- `AGENTS.md`
- `CONTRIBUTING.md`
- `STUDIO.md`
- `PROJECT_STATE.md`
- `ARCHITECTURE.md`
- relevant entries in `DECISIONS.md`
- `teams/ENGINEERING_TEAM.md`
- the exact assigned brief and revision
- the actual repository

Read `PRODUCT.md` only when the brief leaves user intent unclear.

### QA
Read:
- `STUDIO.md`
- `PROJECT_STATE.md`
- the relevant brief and Build Report
- relevant decisions and architecture conventions
- `teams/QA_TEAM.md`

Read `CONTRIBUTING.md` if QA will change tests, fixtures, or repository files.

### Studio Coordinator
Read:
- `STUDIO.md`
- `PROJECT_STATE.md`
- `COORDINATOR_GUIDE.md`
- `CONTRIBUTING.md` when coordinating repository activation or branch/PR integration

## 10. The golden rule

**Solve problems that belong to your role. Route other problems to the team that owns them instead of guessing.**

Examples:
- "Should rejected records be shown or silently skipped?" -> Product
- "Where should import-validation state live?" -> Architecture
- "Revision 2 contradicts the repository's canonical customer schema." -> Engineering reports it to Architecture
- "The build matches the brief but users cannot tell what failed." -> User Feedback / Product
- "Should this PR merge before Architecture acceptance?" -> follow `CONTRIBUTING.md`; Coordinator handles integration exceptions

## 11. Useful entry points

- `README.md` - the project's own front door, current run path, and identity.
- `STUDIO.md` - durable operating rules and template defaults.
- `CONTRIBUTING.md` - shared Git/repository collaboration policy.
- `AGENTS.md` - extra safety/operation rules for local coding agents.
- `BOOTSTRAP_PROMPTS.md` - short prompts for opening or resuming team conversations.
- `COORDINATOR_GUIDE.md` - how to facilitate handoffs, board synchronization, and repository integration without becoming the technical translator.
- `NEW_BUILDER_GUIDE.md` - the same studio process in plainer language for new builders.
