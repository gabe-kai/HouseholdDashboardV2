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

Inspected 2026-10-02: local `main` and `origin/main` are **415d930** (PR **#23**), integrating technically accepted **P0-007C-3B r1**. Current planning branch is `member-management-first-run-setup` at **4f07593**; its committed difference from main is the approved Product P0-008 direction in `PRODUCT.md`.

Architecture has prepared four evidence-gated P0-008 briefs. **P0-008A r1 — Protected First-Manager Setup and Repeatable Reset** is **IN REVIEW** for Engineering readiness. B (backups/restore), C (member access/removal) and D (complete guided first day) are **DRAFT**, gated on accepted predecessor evidence and a refreshed baseline. No P0-008 implementation or live Railway operation has occurred in this planning pass. The whole Product journey remains one card: **Set up and manage my household without operator help**.

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
| P0-008A - Protected First-Manager Setup and Repeatable Reset | r1 | IN REVIEW | Engineering readiness | Planning: `member-management-first-run-setup` | Consolidated readiness against exact A r1 |
| P0-008B - Household Backups and In-App Restore | r1 | DRAFT | Architecture | Successor draft | Accepted A evidence; baseline refresh and readiness release |
| P0-008C - Understandable Member Access and Safe Removal | r1 | DRAFT | Architecture | Successor draft | Accepted A/B evidence; baseline refresh and readiness release |
| P0-008D - Guided Setup to the First Useful Household Day | r1 | DRAFT | Architecture | Successor draft | Accepted A–C evidence; baseline refresh and readiness release |

Suggested states: DRAFT, IN REVIEW, BLOCKED, ESCALATED, READY, IMPLEMENTING, IMPLEMENTED, FIX REQUIRED, ACCEPTED, PRODUCT DECISION.

This table is the short repository-side coordination index. An external project board, if used, is a human-facing visibility layer and may use simpler card states.

## Recently completed

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

## Known blockers

- No unresolved Product choice blocks A readiness. Actual Railway schema, current volume layout, installed commit and backup inventory were not inspected; they are explicit release-preparation checks. No destructive transition is automatic.
- A deliberately provides reset without a new backup; B supplies the optional backup/restore choice. C/D preserve all remaining P0-008 member and guided-first-day requirements; no partial slice closes the shared Product outcome.

## Next Project Lead decision

- After Engineering readiness, Architecture releases A implementation. For an eventual hosted candidate, the Project Lead configures owner recovery through hosting settings and chooses whether all existing data is disposable (explicit reset) or real data must be retained (C's reviewed fixture remediation). That live choice is not inferred from prior resets or this planning request.

## Next likely handoff

Engineering reviews **P0-008A revision 1** in `briefs/p0-008a-protected-first-run-reset.md` and returns one consolidated READY / QUESTION / BLOCKER / ESCALATE disposition. Implementation awaits Architecture ACCEPT / PROCEED. B–D stay gated. The Project Lead owns commits/PR/merge and later hosted/Product evaluation. Detailed coverage and handoff: `reports/P0-008-architecture-sequencing.md`.

## Notes for all teams

- `TBD` is allowed. Resolve only what blocks the next meaningful usable slice.
- Check `DECISIONS.md` before inventing a new convention.
- Name brief revision numbers in handoffs.
- Use `CONTRIBUTING.md` for repository activation and branch/commit/PR policy.
- `ACCEPTED` means technical brief acceptance; user/product acceptance is separate.
- The Studio Coordinator keeps this summary synchronized with confirmed project state.
