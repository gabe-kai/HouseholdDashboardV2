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

P0-002 r1 code-level FIX REQUIRED items are addressed on the implementation branch. Architecture has no remaining code-level correction, but full technical acceptance is blocked on hosted family-evaluation evidence and a Linux Argon2 probe.

## Internal work status

| Work | Revision | State | Current team | Branch / PR | Waiting on |
| --- | ---: | --- | --- | --- | --- |
| P0-001 - Shared Morning Routine | r1 | ACCEPTED | Project Lead evaluation | Merged to `main` via PR #1 | Product acceptance/evaluation |
| P0-002 - Authenticated Household Authority | r1 | BLOCKED | Project Lead | `brief/p0-002-authenticated-household-authority` | HTTPS host/persistent snapshots, physical phones, Linux Argon2 probe, then Architecture final acceptance |

Suggested states: DRAFT, IN REVIEW, BLOCKED, ESCALATED, READY, IMPLEMENTING, IMPLEMENTED, FIX REQUIRED, ACCEPTED, PRODUCT DECISION.

This table is the short repository-side coordination index. An external project board, if used, is a human-facing visibility layer and may use simpler card states.

## Recently completed

- P0-001 r1 was implemented, technically accepted by Architecture, and merged to `main` through PR #1.
- The P0-001 implementation provides a responsive Morning Routine evaluation build with immutable structural history, optimistic durable checklist intent, and household-scoped synchronization.

## Known blockers

- P0-002 implementation and automated evidence are complete enough for hosted evaluation. Full technical acceptance requires a Project Lead-authorized internet-reachable HTTPS origin, persistent storage/backups, physical phones, and Linux Argon2 verification; no provider, account, or spend is authorized by the repository yet.

## Next Project Lead decision

- Approve or provide the single-host HTTPS environment used for family evaluation, including its public origin, persistent volume, and backup/snapshot facility. Architecture has deliberately kept the application package provider-neutral.

## Next likely handoff

Project Lead provisions the authorized HTTPS environment and physical-phone evaluation; then Engineering runs hosted tests 20–21 and returns the same P0-002 r1 to Architecture for final acceptance.

## Notes for all teams

- `TBD` is allowed. Resolve only what blocks the next meaningful usable slice.
- Check `DECISIONS.md` before inventing a new convention.
- Name brief revision numbers in handoffs.
- Use `CONTRIBUTING.md` for repository activation and branch/commit/PR policy.
- `ACCEPTED` means technical brief acceptance; user/product acceptance is separate.
- The Studio Coordinator keeps this summary synchronized with confirmed project state.
