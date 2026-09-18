# Project State

> Fast orientation only. Keep this page short, factual, and current. The underlying briefs, reports, design, decisions, roadmap, and repository remain the real sources of truth.

## Project

- **Name:** Household Dashboard v2
- **One-line concept:** A phone-first shared household system for recurring responsibilities, personal work, and progressively granted independence.
- **Activation status:** Active
- **Current milestone:** First Useful Release
- **Primary platform/environment:** Responsive mobile/desktop web; local/LAN development plus a provider-neutral secure single-host release target
- **Primary interfaces:** Browser UI, versioned JSON API, household WebSocket synchronization, operator CLI commands
- **Engine/framework:** Node.js 24, TypeScript, React/Vite, Fastify, SQLite (`better-sqlite3`)
- **Repository status:** Existing
- **Version control:** Active
- **Integration branch:** `main`
- **Remote / PR workflow:** GitHub `origin` (`gabe-kai/HouseholdDashboardV2`); brief branches and pull requests
- **External project board:** None

## Current focus

**P0-007A r1 - Household Responsibility Foundation** is IN REVIEW on the integrated P0-006 baseline (`main` at `409d147`, PR #14). It is the first of three technical slices from the approved P0-007 proposal: fixed-owner Cats/Trash through Plan, Today, Household activity and History. B will address patterns/scheduled additional work; C will develop the fuller unified day. Only A is briefed. Engineering readiness is next; no P0-007 production implementation is asserted.

## Internal work status

| Work | Revision | State | Current team | Branch / PR | Waiting on |
| --- | ---: | --- | --- | --- | --- |
| P0-001 - Shared Morning Routine | r1 | ACCEPTED | Project Lead evaluation | Merged to `main` via PR #1 | Product acceptance/evaluation |
| P0-002 - Authenticated Household Authority | r1 | ACCEPTED | Project Lead evaluation | `brief/p0-002-authenticated-household-authority` | Product evaluation; future hosted release candidates require the hosted smoke/evidence gate |
| P0-003 - Regression Safety and Contract Hardening | r1 | ACCEPTED | Project Lead evaluation | Merged to `main` via PR #6 | Product evaluation; optional required-check configuration |
| P0-004A - People & Groups UX Completion | r3 | ACCEPTED | Project Lead evaluation | Merged to `main` via PR #8 | Product phone evaluation |
| P0-004B - Group-backed Morning Routine | r1 | ACCEPTED | Project Lead evaluation | Merged to `main` via PR #9 | Product evaluation |
| P0-005 - Cohesive Routine Management | r3 | ACCEPTED | Completed | Merged to `main` via PR #11 | P0-006 follow-up carries Product evaluation findings |
| P0-006A - Calm Household Experience Foundation | r2 | ACCEPTED | Completed | Merged to `main` at `7cba3a6` via PR #12 | None; Project Lead evaluation accepted |
| P0-006B - Contextual Routine Applicability | r1 | ACCEPTED | Project Lead/Product | Merged to `main` at `de552ab` | Evaluate the contextual routine experience |
| P0-006C - Household Profiles and Useful History | r1 | ACCEPTED | Project Lead evaluation | Merged to `main` at `409d147` via PR #14 | Product acceptance remains separate |
| P0-007A - Household Responsibility Foundation | r1 | IN REVIEW | Engineering readiness | Planned `brief/p0-007a-household-responsibility-foundation` | Consolidated readiness review; Architecture response before implementation |

Suggested states: DRAFT, IN REVIEW, BLOCKED, ESCALATED, READY, IMPLEMENTING, IMPLEMENTED, FIX REQUIRED, ACCEPTED, PRODUCT DECISION.

This table is the short repository-side coordination index. An external project board, if used, is a human-facing visibility layer and may use simpler card states.

## Recently completed

- P0-001 r1 was implemented, technically accepted by Architecture, and merged to `main` through PR #1.
- The P0-001 implementation provides a responsive Morning Routine evaluation build with immutable structural history, optimistic durable checklist intent, and household-scoped synchronization.
- P0-002 r1 added authenticated household authority, personal layers/proposals, scoped personal tasks, and hosted-operability evidence; Architecture technically accepted it on 2026-09-10.
- P0-003 r1 added protected-behavior traceability, route-policy completeness, focused regression evidence, local PR/RC validation tiers, and a successful GitHub Actions PR gate; Architecture technically accepted it on 2026-09-10.
- P0-004A r3 established focused People & Groups states, fixture-free normal bootstrap, canonical opt-in demo fixtures, and provenance-safe cleanup; Architecture technically accepted it on 2026-09-11 and it was merged through PR #8.
- P0-004B r1 added dated group-backed Morning Routine participation and was technically accepted after correction `ac41538`, then merged through PR #9.
- P0-005 r1/r2 established multiple routines and first-action locks; r2 implementation is `297b2fd`, merged to `main` at `5376b51`, and technically accepted. Product evaluation prompted r3's full routine lifecycle, current-plan ranges, and shared visual/navigation foundation.
- P0-005 r3 completed the routine lifecycle and Calm Household shell, was technically accepted after AT6 and long-lived-database receipt corrections, and merged through PR #11 at `31aad37`.
- P0-006A r2 completed the responsive Plan shell, focused editors, saved navigation, quiet feedback, and step ordering; required local evidence was closed and Architecture accepted it. The Project Lead then reviewed screenshots, tested, and reported satisfaction. A and B planning are integrated at `7cba3a6` via PR #12, including the A toast/CI correction.
- P0-006B r1 contextual applicability and school calendar were technically accepted after AT9 rollback and AT10/AT11 browser evidence closed at `8421b31`, then merged through PR #13 at `de552ab`. The Project Lead reported successful school-year/exception setup and chose to continue the approved proposal with C.

- P0-006C r1 profiles, saved family order, read-only summarized History and generation-fenced activity reset were technically accepted after correction `e8a93d5`, then merged via PR #14 at `409d147`. The next approved Product proposal is P0-007; its first brief is ready for Engineering review.

## Known blockers

- None known for A. Required-check branch protection is an external Project Lead setting and is not asserted as configured. B's pattern/eligibility details remain future brief work, not A blockers.

## Next Project Lead decision

- Record the P0-007A planning baseline and hand **P0-007A r1** to Engineering for readiness. Project Lead manages Git; agents suggest commit messages but do not commit. No deployment is required for this local development slice.

## Next likely handoff

Engineering reviews `briefs/p0-007a-household-responsibility-foundation.md` **revision 1** and returns one consolidated readiness report before implementation. The card **Give Cats and Trash one owner and a place in Today** is **Up Next**; no external board is configured. Architecture then resolves material findings and issues ACCEPT/PROCEED or revises the brief.

## Notes for all teams

- `TBD` is allowed. Resolve only what blocks the next meaningful usable slice.
- Check `DECISIONS.md` before inventing a new convention.
- Name brief revision numbers in handoffs.
- Use `CONTRIBUTING.md` for repository activation and branch/commit/PR policy.
- `ACCEPTED` means technical brief acceptance; user/product acceptance is separate.
- The Studio Coordinator keeps this summary synchronized with confirmed project state.
