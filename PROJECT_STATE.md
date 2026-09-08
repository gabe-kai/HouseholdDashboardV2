# Project State

> Fast orientation only. Keep this page short, factual, and current. The underlying briefs, reports, design, decisions, roadmap, and repository remain the real sources of truth.

## Project

- **Name:** Household Dashboard v2
- **One-line concept:** A phone-first shared household system for recurring responsibilities, personal work, and progressively granted independence.
- **Activation status:** Active
- **Current milestone:** First Useful Release
- **Primary platform/environment:** Responsive mobile/desktop web; current trusted-network evaluation build, with secure single-host deployment targeted by P0-002
- **Primary interfaces:** Browser UI, versioned JSON API, household WebSocket synchronization, operator CLI commands
- **Engine/framework:** Node.js 24, TypeScript, React/Vite, Fastify, SQLite (`better-sqlite3`)
- **Repository status:** Existing
- **Version control:** Active
- **Integration branch:** `main`
- **Remote / PR workflow:** GitHub `origin` (`gabe-kai/HouseholdDashboardV2`); brief branches and pull requests
- **External project board:** None

## Current focus

Prepare `P0-002 r1 - Authenticated Household Authority` for Engineering readiness: replace evaluation profiles with six real household identities, add membership capabilities, future-effective personal routine layers and one approval flow, preserve P0-001 execution/history behavior, add thin personal tasks, and make the application deployable behind HTTPS for real-phone evaluation.

## Internal work status

| Work | Revision | State | Current team | Branch / PR | Waiting on |
| --- | ---: | --- | --- | --- | --- |
| P0-001 - Shared Morning Routine | r1 | ACCEPTED | Project Lead evaluation | Merged to `main` via PR #1 | Product acceptance/evaluation |
| P0-002 - Authenticated Household Authority | r1 | IN REVIEW | Engineering | No branch yet; planned `brief/p0-002-authenticated-household-authority` | Engineering readiness; Project Lead authorization/provisioning for the HTTPS host before deployed acceptance |

Suggested states: DRAFT, IN REVIEW, BLOCKED, ESCALATED, READY, IMPLEMENTING, IMPLEMENTED, FIX REQUIRED, ACCEPTED, PRODUCT DECISION.

This table is the short repository-side coordination index. An external project board, if used, is a human-facing visibility layer and may use simpler card states.

## Recently completed

- P0-001 r1 was implemented, technically accepted by Architecture, and merged to `main` through PR #1.
- The P0-001 implementation provides a responsive Morning Routine evaluation build with immutable structural history, optimistic durable checklist intent, and household-scoped synchronization.

## Known blockers

- P0-002 code planning is unblocked. Completing its secure real-device acceptance requires a Project Lead-authorized internet-reachable HTTPS origin, persistent storage, and backup capability; no provider, account, or spend is authorized by the repository yet.

## Next Project Lead decision

- Approve or provide the single-host HTTPS environment used for family evaluation, including its public origin, persistent volume, and backup/snapshot facility. Architecture has deliberately kept the application package provider-neutral.

## Next likely handoff

Engineering readiness review for exactly `P0-002 r1` in `briefs/P0-002-authenticated-household-authority.md`, followed by Architecture disposition before implementation begins.

## Notes for all teams

- `TBD` is allowed. Resolve only what blocks the next meaningful usable slice.
- Check `DECISIONS.md` before inventing a new convention.
- Name brief revision numbers in handoffs.
- Use `CONTRIBUTING.md` for repository activation and branch/commit/PR policy.
- `ACCEPTED` means technical brief acceptance; user/product acceptance is separate.
- The Studio Coordinator keeps this summary synchronized with confirmed project state.
