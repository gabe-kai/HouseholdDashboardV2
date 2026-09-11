# Build Report - BRIEF P0-004A r2

**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED  
**Branch:** `brief/p0-004a-people-groups-access`  
**Commits:** N/A (not committed; Project Lead manages Git)  
**Pull request:** N/A  

## Readiness

**READY** against r2 (see `reports/P0-004A-r2-engineering-readiness.md`). No blockers. Implemented only r2; P0-004B group-backed Morning Routine was not implemented.

## What changed

- Migration `003_people_groups_access.sql`: nullable classification, membership version, claim `revoked_at`, structure-grant backfill for enroll holders, groups + members, structure mutation receipts.
- Grant `household.structure.manage` added to schema and manager preset; applied on claim for manager preset only.
- Person create/edit APIs; person detail with access state, groups, and direct Morning Routine involvement (no occurrence materialization).
- Enrollment setup requires an existing unenrolled membership; replacement/cancellation revoke; plaintext returned once; mutation-ID replay never replays secrets.
- Group create/update/delete with case-folded unique names and expected-version conflicts.
- Sync resource `group`; route-policy inventory extended; protected-behavior catalog PB-16–19 + sync matrix rows.
- Household tab evolved to **People & Groups** (with preserved manager Morning Routine progress list).
- Tests: `tests/integration/p0-004a.test.ts`, `tests/e2e/people-groups.spec.ts`; existing enroll callers updated for `mutationId`.

## Behavior delivered

Parents can add unenrolled people, see `Classification not set` on migrated members, manage access setup lifecycle in person-centered language, and create/edit/delete structural groups without affecting grants, private tasks, or historical occurrence snapshots.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate` | **PASS** (included in RC) |
| `npm run validate:pr` | **PASS** (Chromium e2e 14/14 in prior run; RC supersedes) |
| `npm run validate:rc` | **PASS** — lint/typecheck/Vitest 48; build; Chromium+WebKit e2e **28/28** |
| Hosted / Actions URL | **NOT RUN** — local only |

### New vs reused evidence

**New:** migration classification/structure backfill; person/group/setup lifecycle; structure vs enroll HTTP authority; People & Groups phone e2e; peer sync person create.  
**Reused:** P0-001/P0-002/P0-003 suites (updated enroll payloads); route-policy completeness; proposal/outbox/visibility/historical gates remaining green under validate:rc.

## Deviations from brief revision

- None material. Manager household occurrence progress remains visible under People & Groups so P0-002 sync e2e and parental progress viewing are preserved while Enroll is no longer a primary nav destination.

## Discoveries for Architecture

- Pending memberships safely model unenrolled people; setup must not pre-apply grants (fixed in this slice).
- Preserving manager occurrence visibility inside People & Groups avoids regressing open-view progress sync when retiring the Enroll/Household primary token form.

## Known limitations

- P0-004B group-backed Morning Routine audience not implemented (by design).
- No member deletion/departure, nested groups, or granular grant editor.

## Suggested follow-up

Architecture acceptance of r2. After commit/push, optional PR Actions run confirms CI path; required-check remains Project Lead external setting.
