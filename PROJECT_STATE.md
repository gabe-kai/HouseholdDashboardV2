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

Inspected 2026-10-28: integrated baseline remains `main` at **1acc4a1** (P0-008F, PR **#29**). P0-009A r2 implementation is on `brief/p0-009a-selected-display-preview-and-family-wall-proof` at **d4f313d**. Engineering reports exact local PR/RC gates passing; Architecture reviewed the named evidence and returned **FIX REQUIRED** against the unchanged r2 acceptance matrix. Consolidated findings: `reports/P0-009A-r2-architecture-review.md`. No hosted deployment, production-wall replacement, push, PR, or merge is asserted. Overall P0-008 Product acceptance remains separate, as does the reported `/` route anomaly.

**P0-008E r1** is technically **ACCEPTED** and integrated via PR #28 at `bd05ad0`. **P0-008F r1** is technically accepted and integrated via PR #29 at `1acc4a1`. P0-008's overall Product acceptance remains separate; the reported `/` anomaly remains a separate investigation.

P0-007C's outstanding physical/Product judgments remain distinct from its technical acceptance and from approval to begin P0-008. Old reports retain their inspected SHAs.

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
| P0-007C-2 - Household Display and Read-only Dashboard | r1 | ACCEPTED | Project Lead evaluation | Merged to `main` at `739f7e3` via PR #21 | Physical readability reported; full Product acceptance remains separate |
| P0-007C-3A - Complete Assigned Work at the Shared Display | r1 | ACCEPTED | Project Lead evaluation | Merged to `main` at `6510fb4` via PR #22 | Product evaluation remains separate; display density feedback recorded |
| P0-007C-3B - Owner-Controlled Personal Work on the Wall | r1 | ACCEPTED | Project Lead evaluation | Merged to `main` at `415d930` via PR #23 | Product evaluation of the changed wall remains separate |
| P0-008A - Protected First-Manager Setup and Repeatable Reset | r1 | ACCEPTED | Integrated foundation | Merged to `main` at `405c5db` via PR #24 | Hosted/Product evaluation remains separate |
| P0-008B - Household Backups and In-App Restore | r2 | ACCEPTED | Integrated foundation | Merged to `main` at `f80d47b` via PR #25 | Hosted and Product evaluation remain separate |
| P0-008C - Understandable Member Access and Safe Removal | r1 | ACCEPTED | Integrated foundation | Merged to `main` at `1709097` via PR #26; correction `90de153` | Hosted/Product evaluation remains separate |
| P0-008D - Guided Setup to the First Useful Household Day | r2 | ACCEPTED (technical) | Project Lead evaluation | Merged to `main` via PR #27 at `65e1949` | P0-008E integrated; overall P0-008 Product acceptance pending |
| P0-008E - Clear First Run and One-View Work Editing | r1 | ACCEPTED (technical) | Project Lead evaluation | Merged to `main` via PR #28 at `bd05ad0` | Hands-on Product evaluation; overall P0-008 Product acceptance remains separate |
| P0-008F - Keep a Household Intact Through Deployment | r1 | ACCEPTED (technical) | Project Lead evaluation | Merged to `main` via PR #29 at `1acc4a1` | Project Lead reports persistent control-store copy and new-household setup; prior-household recovery is not claimed |
| P0-009A - Preview a Display and Judge the Family Board | r2 | FIX REQUIRED | Engineering | `brief/p0-009a-selected-display-preview-and-family-wall-proof` @ `d4f313d` | Close named AT3b, AT5a–f, AT7a, AT8a, AT9a/b, AT10–11, AT12a, AT13, AT14a evidence; then Architecture re-review |

Suggested states: DRAFT, IN REVIEW, BLOCKED, ESCALATED, READY, IMPLEMENTING, IMPLEMENTED, FIX REQUIRED, ACCEPTED, PRODUCT DECISION.

This table is the short repository-side coordination index. An external project board, if used, is a human-facing visibility layer and may use simpler card states.

## Recently completed

- P0-008C r1 is integrated through PR #26 at `1709097`; accepted corrections in `90de153` cover resolver-based departure impact/reconciliation, display withdrawal and fixture backup/race/rollback evidence. Architecture independently ran exact local PR/RC gates before acceptance; the integration note is in `reports/P0-008C-r1-architecture-reacceptance.md`.
- P0-007C-3B r1 adds owner-controlled wall promotion, privacy-safe withdrawal sync, and compact promoted-task summaries. Architecture accepted the held-status correction at `57780ce`; integration is PR #23 at `415d930`. Engineering recorded local PR/RC passes; Project Lead physical evaluation remains separately tracked.
- P0-007C-3A r1 established restricted shared-display execution with truthful device provenance; technically accepted after AT11 correction and merged via PR #22 at `6510fb4`. Project Lead physical readability and usability observations are recorded in `evaluations/p0-007c-3a-project-lead-evaluation-2026-09-29.md`; the complete C experience has not been Product-accepted.
- P0-007C-2 r1 established the enrolled, revocable, privacy-filtered read-only Household Display; Architecture accepted it after AT6/AT9 and PR/RC evidence corrections, then it merged through PR #21 at `739f7e3`. The later Project Lead real-wall observation is recorded separately from technical acceptance.

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

## Open follow-ups

- Overall P0-008 Product acceptance and exact hosted deployed-SHA/operations record remain separate. The reported `/` anomaly remains open.

## Next likely handoff

Engineering: begin local implementation of P0-009A r2 under Architecture ACCEPT / PROCEED. Return the Build Report for technical acceptance; after acceptance, the Project Lead performs the same-viewport checkpoint. The later actionable-person-pane brief remains gated on that checkpoint. The root-route anomaly and live School/Meals/Calendar features are separate work.

## Notes for all teams

- `TBD` is allowed. Resolve only what blocks the next meaningful usable slice.
- Check `DECISIONS.md` before inventing a new convention.
- Name brief revision numbers in handoffs.
- Use `CONTRIBUTING.md` for repository activation and branch/commit/PR policy.
- `ACCEPTED` means technical brief acceptance; user/product acceptance is separate.
- The Studio Coordinator keeps this summary synchronized with confirmed project state.
