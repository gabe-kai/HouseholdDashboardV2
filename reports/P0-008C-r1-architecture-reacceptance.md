# Architecture Reacceptance - P0-008C r1

**Date:** 2026-10-11  
**Disposition:** TECHNICALLY ACCEPTED  
**Brief:** `briefs/p0-008c-member-access-removal.md`, revision 1  
**Branch:** `brief/p0-008c-member-access-removal`  
**Original implementation:** `aedd416`  
**Correction tree:** uncommitted working-tree changes atop `7e879d6`  
**Baseline:** merged A/B at `f80d47b`  
**Build Report:** `reports/P0-008C-r1-build-report.md`  
**Prior review:** `reports/P0-008C-r1-architecture-review.md`

## Review result

Architecture re-reviewed the corrected source and named evidence against P0-008C r1. The contract is unchanged. All five prior FIX REQUIRED findings are closed. Architecture also ran the exact local `npm run validate:pr` and `npm run validate:rc` commands against the current correction working tree; both exited 0. No deployment, Railway operation, or live database remediation was performed.

## Findings closed

1. **AT9 / D-054 — removal preview and reconciliation.** The removal preview now returns a date-bound seven-household-day impact produced from the assignment/composition resolver, including affected routines, fixed/weekly/cyclic/group responsibility assignments, Unassigned outcomes and repair links. Removal and fixture-departure paths mark eligibility changed and reconcile affected ranges rather than blanket-canceling unstarted rows. The named integration evidence covers the preview, stale-preview rejection, and reconciliation while preserving started work and occurrence identity.
2. **AT10 — first action versus departure.** Integration evidence covers both action-first and departure-first orderings for member and display status paths. Started snapshots/history remain authoritative; a departed member cannot execute afterward or create a first-action lock/report by replaying stale intent.
3. **AT11 — display withdrawal.** Current display people and promoted-task projections exclude departed memberships. Removal broadcasts display invalidations for people and tasks; the two-display test checks live invalidation and confirms departed identity/task data and private task identifiers/titles are absent after removal.
4. **AT13/AT14 — fixture race and atomicity.** Tests exercise stale fixture-preview rejection, a delayed household write against optional backup/remediation, pre-remediation snapshot truth, idempotent receipt retry without duplicate backup, and injected mid-transaction removal failure with membership, claims, occurrence state and retry behavior checked.
5. **Build Report metadata/evidence.** The report now distinguishes the pinned original implementation commit from the uncommitted correction tree and states that no PR/deployment exists. Its remaining note that full PR/RC were not rerun is superseded by this Architecture-run evidence below.

## Verification

- `npm run validate:pr` — **PASS**, exit code 0, run by Architecture on the corrected working tree.
- `npm run validate:rc` — **PASS**, exit code 0, run by Architecture on the corrected working tree.
- The Build Report records 316 Vitest tests for this correction tree and maps the P0-008C AT evidence. Both full gates completed after the corrections; the local Vite deep-link sub-suite reported 5/5 passing in each.
- Hosted evaluation, Railway changes, and live-data remediation — **NOT RUN** and remain separately authorized Project Lead actions.

## Acceptance boundary and next step

P0-008C r1 satisfies its technical brief and is **ACCEPTED**. This is not Project Lead/Product acceptance of the full P0-008 journey. The shared card **Set up and manage my household without operator help** remains **In Progress** across A–D.

The correction set is still uncommitted. Project Lead owns the commit and subsequent push/PR/merge/cleanup. After C is integrated, Architecture should refresh P0-008D against merged A–C and the actual integrated repository baseline before sending it for Engineering readiness. No implementation authorization for D is implied here.

## Integration confirmation — 2026-10-12

The accepted correction set was committed as `90de153` and merged through PR #26 at `1709097`. Architecture inspected clean local `main` / `origin/main` at that merge. The preceding uncommitted-tree wording describes the acceptance-time snapshot; C integration is now complete. P0-008D is refreshed and released as r2 for a fresh readiness review against this baseline.
