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

**P0-007C-2 r1 - Household Display and Read-only Dashboard** is **technically ACCEPTED**. AT6/AT9 evidence and PR/RC gates are closed; Build Report pins third-review evidence commit **a6d3899** and was corrected in **7747626**. Card **See the family day from across the room** is ready for Project Lead integration. Product's physical-wall AT17 remains separate and does not block acceptance. Feature implementation: **a2b9e42**. C-3 remains out of scope.

Inspected clean integrated `main` at **ef39a89** on 2026-09-24 includes technically accepted **P0-007C-1 r1** via PR **#20**. The Project Lead confirmed merge/cleanup. C-1's card remains **Ready to Evaluate**; technical integration does not assert Product acceptance. Old reports retain historical SHAs; C-2 anchors to this inspected tree.

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
| P0-007A - Household Responsibility Foundation | r1 | ACCEPTED | Completed foundation | Merged to `main` at `51322e0` via PR #15 | None for A; Design carries presentation feedback to C |
| P0-007B - Assignment Patterns & Scheduled Work | r1 | ACCEPTED | Integrated foundation | Included in inspected `main` at `e8f59b4` | Product evaluation remains separate; C carries daily-presentation direction |
| P0-007C-1 - Actionable Today and Household Overview | r1 | ACCEPTED | Project Lead evaluation | Merged to `main` at `ef39a89` via PR #20 | Product speed-of-understanding evaluation |
| P0-007C-2 - Household Display and Read-only Dashboard | r1 | ACCEPTED | Project Lead integration | `brief/p0-007c-2-household-display-read-only-dashboard` | Push/merge/cleanup at Project Lead discretion; AT17 remains separate Product evidence |

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

- P0-006C r1 profiles, saved family order, read-only summarized History and generation-fenced activity reset were technically accepted after correction `e8a93d5`, then merged via PR #14 at `409d147`.
- P0-007A r1 was technically accepted at `bb21d74`, recorded in `7539fd0`, and merged via PR #15 at `51322e0`. The Project Lead confirmed merge/cleanup; the supplied Design proposal accepts A as the foundation and requests B next, preserving C's presentation feedback.

## Known blockers

- No technical blockers remain. `validate:pr` and `validate:rc` are reported PASS, the inspected AT6/AT9 evidence closes the final contract gaps, and the Build Report metadata is corrected. Product's actual-wall AT17 is separate and does not block technical acceptance. No deployment is required.

## Next Project Lead decision

- Project Lead may push/merge and clean up the accepted branch. Physical wall readability (AT17) can be evaluated separately; it is not a technical merge gate. No hosted deployment is required.

## Next likely handoff

Architecture technical acceptance is complete. Project Lead owns integration/cleanup and may coordinate Product evaluation of AT17 separately; do not deploy or claim physical readability based only on automation.

## Notes for all teams

- `TBD` is allowed. Resolve only what blocks the next meaningful usable slice.
- Check `DECISIONS.md` before inventing a new convention.
- Name brief revision numbers in handoffs.
- Use `CONTRIBUTING.md` for repository activation and branch/commit/PR policy.
- `ACCEPTED` means technical brief acceptance; user/product acceptance is separate.
- The Studio Coordinator keeps this summary synchronized with confirmed project state.
