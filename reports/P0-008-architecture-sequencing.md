# Architecture Assessment and Sequencing - P0-008

**Date:** 2026-10-02; successor-state refresh 2026-10-05
**Role:** Architecture
**Source:** Approved `PRODUCT.md`, P0-008 First-Run Setup and Household Member Management; Project Lead's handoff in this task.
**Original assessment baseline:** `member-management-first-run-setup` @ `4f07593`; `main` @ `415d930` (PR #23), through migration 017.
**Current inspected baseline:** merged `main` / `origin/main` @ `405c5db` (PR #24), through migration 018. A r1 is technically accepted and merged; B r2 is released for Engineering readiness; C/D remain gated drafts. No live-data operation or deployment performed by Architecture.

This report records reasoning, traceability and release preparation. The four brief files are the authoritative implementation contracts; this report is not a contract addendum.

## What the original assessment found

- React/Vite, Fastify and a single SQLite process; migrations through 017; accepted shared wall identity/execution/personal promotion now integrated.
- Hosted profile forbids demo seeding. Fixture-free CLI bootstrap is implemented, but the parent still needs an operator-issued claim. `claim` can consume a stored grant preset; independent role edits would be unsafe without changing that consumption rule.
- Member identity is separate from login and grants, but pending/active is the only membership status. There is no ordinary departure, sign-in revoke/restore, self password change or manager reset-link UI.
- D-017's canonical fixture cleanup deliberately refuses used/referenced people. The manifest records six member IDs and a household, not provenance for shared work later created under them.
- D-034 Clear activity history already scopes recurring activity deletion, preserves setup and advances household activity generation. It cannot serve as full reset or fence a database restored to an older generation.
- The existing backup script uses SQLite's backup API. Restore has no compatibility/catalog/credential sanitation layer and unlinks the destination before rename. App stores hold long-lived handles. Online restore cannot safely be a new button around that script.
- Screenshots are local-only evidence. Local PR/RC and thematic Actions selection remain the implementation gates; hosted testing is for verified release candidates.

These points describe the original pre-A baseline, not current code. A now supplies protected owner/setup access, an installation control store and epoch-fenced reset. Its control store has no backup catalog, and its pending-operation reconciler assumes reset results; B r2 must extend these seams. The actual populated Railway database, secrets and deployed SHA remain uninspected. Earlier conversation descriptions are useful context, not proof of its current schema or contents.

## Four observable slices

| Slice / authoritative file | Parent checkpoint | Release to Engineering |
| --- | --- | --- |
| **P0-008A r1** — `briefs/p0-008a-protected-first-run-reset.md` | Create first manager/household through protected browser access; reset repeatedly and recover Welcome after interruption | Technically ACCEPTED, merged via PR #24 at `405c5db`; hosted/Product evidence separate |
| **P0-008B r2** — `briefs/p0-008b-household-backups-in-app-restore.md` | Save a backup, reset with backup off, restore from protected Welcome or Settings | IN REVIEW for Engineering readiness against merged A; implementation awaits Architecture disposition |
| **P0-008C r1** — `briefs/p0-008c-member-access-removal.md` | Invite, edit permissions, maintain/revoke/restore sign-in, remove a used member, and clean selected sample people without losing real work | DRAFT until A/B accepted; refresh membership/backup baseline |
| **P0-008D r1** — `briefs/p0-008d-guided-first-household-day.md` | Complete the named setup steps and the uninterrupted setup→management→backup→reset→restore journey | DRAFT until A–C accepted; integrate their real records and flows |

All slices contribute to **Set up and manage my household without operator help**. The shared card is In Progress after accepted A and reaches Ready to Evaluate after all four technical contracts pass. Intermediate parent checkpoints supply evidence without declaring complete Product acceptance. Each later draft receives a source-baseline refresh and fresh Engineering readiness; materially changed contracts receive a new revision. No automatic bulk implementation is authorized.

Four slices keep two high-risk boundaries independently reviewable: replacement/recovery first, then backup compatibility; member authority/departure next; user-journey integration last. A prioritizes secure nontechnical first-manager access and repeatable hosted reset. Its deliberate interim limitation is reset without a new saved backup; B must close that limitation, and D must complete the approachable first-day journey. Neither disappears into a later parking lot.

## Product requirement coverage

| Approved requirement | Contract owner / acceptance evidence |
| --- | --- |
| One-time secure setup access, public takeover denial, lost owner access | A AT2/3/6; D-050 |
| Required account/household basics, no fixtures, timezone confirmation | A AT1/4/5; D AT1/2/6 |
| Five named steps, optional exits, saved cross-device progress and no duplicates | D AT1–3/6; builds on A's real identity |
| Family entry/default roles, school setup/skip, first routine and responsibility | C AT1/2; D AT1/2/4/5 |
| Actual next dates/people and review correction; children-only manager Today | D AT4; D-056 |
| Directory, profile vs role, current/custom permissions | C AT1–3; D-053 |
| Invitation link/QR, expiry/replacement/cancel, recipient's own Today | C AT2/4; D AT1 |
| Self password change, manager reset, owner recovery, revoke/restore sign-in | A AT6; C AT5/6 |
| Last active manager; old claims cannot restore old permissions | C AT4/7/14 |
| Ordinary unused and used member removal, immediate future eligibility | C AT8–10; D-054 |
| Locked owner/history preserved, wall cannot execute departed work | C AT10/12 |
| Private personal work withdrawal, enrolled wall survives creator removal | C AT11/12 |
| Repeatable full reset including incomplete setup and lost responses | A AT5/7–10 |
| Backup option off, no hidden pre-reset copy, requested failure recovery | A AT7/9; B AT1/2/7 |
| Backups survive reset; create/list/delete; Welcome and Settings restore | B AT1–4/8 |
| Supported upgrades, sanitized old access, rollback/restart safety | B AT5–9; D-051/D-052 |
| Safe already-populated Railway transition and canonical fixture remediation | A AT1/11/12; B AT3/6; C AT13 |
| Calm phone/desktop, accessible errors/keyboard/zoom, no dead ends | A AT4; C AT2/15; D AT8–10 |
| One uninterrupted hosted Product evaluation | D AT9/10; local automation first, Project Lead observation separate |

## Existing contracts reconciled

| Prior contract | P0-008 treatment |
| --- | --- |
| D-007 operator bootstrap claim | A replaces the household-facing entry with protected owner-issued browser access and recovery. Hosting secret provisioning happens once through the owner's GUI; no public first-visitor claim. |
| D-017 restricted fixture cleanup | Preserve the original CLI. C's provenance-aware reviewed batch uses ordinary departure and selective safe data cleanup; real or ambiguous work survives. |
| D-034 activity-only clear | Remains separate and scoped. Full reset/restore use a persistent installation epoch outside the replaceable database. |
| D-018 next-day group changes | Remain for ordinary group edits. C makes actual departure immediately ineligible today/future without destroying dated historical membership. |
| D-023/D-036 first-action/owner locks | Preserve snapshots/history on departure; surface unfinished work for attention, deny further execution by departed members or walls. No Cover/Claim introduced. |
| D-043 display identity | Household display enrollment survives its creator's departure. Full reset/restore retires its credentials while restore preserves historical device attribution. |
| D-048/D-049 owner-controlled privacy | Member management and fixture previews do not expose private tasks or transfer ownership. Departed personal work leaves live projections safely. |

## Safe Railway transition checkpoints

These are a release plan, not commands to run now. Authoritative transition requirements are in A/B/C.

1. **Establish facts privately:** Engineering identifies the deployed SHA, migration inventory, actual persistent paths, writable storage/headroom, single-process settings and existing backups. No real names, tokens, passwords or private contents enter tracked evidence. Migration 017 in this checkout does not imply Railway is already there.
2. **Preserve before upgrading:** Take an explicitly authorized deployment/migration safety backup through existing supported operations and rehearse forward adoption on an isolated copy. This operator release backup is distinct from the user-controlled reset checkbox; never silently make a reset backup after the user opts out. A's upgrade preserves all data, including fixtures.
3. **Provision protected ownership:** Through Railway's secret/settings UI, configure the owner secret and persistent installation-control location before exposing lifecycle actions. Mount control state, active household images and saved backups durably. Runtime operations resolve the active DB reference; do not assume the original `DB_PATH` remains the active filename after reset. If ownership configuration is absent, lifecycle entry stays closed while existing household use remains available.
4. **Choose using the actual data:** If the Project Lead confirms everything is disposable, they use the explicit A/B reset UI. If real people/work must survive, retain the dataset and proceed to C's reviewed canonical-ID remediation; do not run broad SQL/name-based deletes or reinterpret authorship as sample ownership. Activate a real successor manager before removing a canonical fixture identity currently acting as the only manager.
5. **Verify the installed candidate:** After local/CI acceptance, record the deployed SHA, secure-cookie/Origin behavior, protected first setup, repeated reset, response-loss recovery and persistence after service restart. B adds saved-backup reset/restore/restart checks. Destructive automated tests use disposable installations; live household reset/remediation remains the Project Lead's deliberate app action.
6. **Close the Product loop:** After D, run the documented uninterrupted manual journey on phone and desktop. Record readability, confidence, surprises and unmet intended behavior. Prior wall-density/authoring feedback remains available to Design but does not silently expand P0-008.

## Handoff for Engineering

> Acting as Engineering, perform one consolidated readiness review of **P0-008B revision 2 — Household Backups and In-App Restore** in `briefs/p0-008b-household-backups-in-app-restore.md` against merged `main` at `405c5db` (accepted A). Inspect A's control schema, active-image replacement, operation journal, current backup/restore scripts, auth and epoch boundaries. Identify only material blockers/questions; record repository-grounded findings in a P0-008B r2 Engineering readiness report and update the brief's readiness fields. Return READY or a consolidated concern set for Architecture disposition; do not implement until Architecture replies ACCEPT / PROCEED. Keep C/D out of scope. Use disposable data only; no Railway/live database operations or deployment. Suggest a commit message but do not commit.

Suggested implementation branch after the planning/readiness baseline is integrated: `brief/p0-008b-household-backups-in-app-restore`. Architecture has not created a branch.

## Verification of this planning package

The original planning package was documentation-only. B is now revision 2 against merged A; C/D remain revision 1 drafts. This refresh changes only Architecture-owned documentation and the B brief; application code and approved Product content are unchanged.

Application tests were not run because no production/test code changed. No release success or Product acceptance is claimed. Engineering must produce implementation evidence against each released revision.
