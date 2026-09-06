# Template Changelog

## v0.3.0

Generalized the workflow from its Arcadium game-development origins into a project-neutral AI Development Studio Template.

- Established the consistent product name **AI Development Studio Template**.
- Replaced Game Design with Product and Player Council with User Feedback.
- Replaced game-specific acceptance and board language with **Ready to Evaluate** and **Accepted**.
- Expanded product discovery to cover users, stakeholders, workflows, trust, interfaces, and observable outcomes.
- Expanded architecture guidance to cover services, data, integrations, security, operations, deployment, AI systems, and non-UI projects.
- Removed browser, static-hosting, keyboard/mouse, 2D, and game-loop defaults.
- Generalized evaluation evidence beyond direct play to users, operators, stakeholders, analytics, experiments, and support evidence.
- Renamed game-specific files and prompts while preserving the brief revision model, evidence-gated planning, disagreement budget, durable writeback, and technical-versus-product acceptance boundary.

## v0.2.0

This release promotes lessons learned from the first sustained project use of the template.

### Added

- explicit project activation flow and a project-first root `README.md`;
- safe new-repository Git bootstrap with the first baseline commit on `main` before brief/feature branches;
- optional remote-publishing guidance after local `main` is established;
- optional external Project Board methodology with a simple five-column default;
- user-facing Project card fields in implementation briefs;
- explicit separation between Architecture technical acceptance and Project Lead/user acceptance;
- evidence-gated roadmap horizons: CURRENT, LIKELY NEXT, and LATER;
- a `Learning question` field for briefs when a slice is intended to reduce uncertainty;
- optional Project Lead disposition in evaluation reports.

### Changed

- reduced unnecessary template-name repetition so activated projects present primarily as themselves;
- clarified that roadmap outcomes may look ahead while detailed briefs should normally cover only the next evidence-producing slice;
- expanded Coordinator guidance for project-board synchronization and repository activation;
- generalized project-board wording so Trello, GitHub Projects, Jira, Monday, or a physical board can use the same model;
- corrected the Coordinator job-count heading and incorporated project visibility as an explicit responsibility.

### Compatibility

The v0.1.x authority model, brief revision model, readiness disagreement budget, QA policy, and core team boundaries remain intact. Existing projects can adopt v0.2.0 incrementally rather than migrating every artifact at once.
