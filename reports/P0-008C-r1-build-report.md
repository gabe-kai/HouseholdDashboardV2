# Build Report - BRIEF P0-008C r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (FIX REQUIRED closed) — awaiting Architecture re-review  
**Branch:** `brief/p0-008c-member-access-removal`  
**Baseline:** merged A/B at `f80d47b` (PR #25); Architecture ACCEPT / PROCEED at `21ec8dc`  
**Implementation commit:** `aedd416` (`feat(P0-008C): member access, permissions, and safe removal`)  
**FIX REQUIRED remediation:** uncommitted working tree on this branch atop `7e879d6` (Architecture review commit); no new Engineering commit for this tip  
**Pull request:** branch tracks `origin/brief/p0-008c-member-access-removal`; no PR opened by this Build Report  
**Prior Architecture disposition:** FIX REQUIRED in `reports/P0-008C-r1-architecture-review.md` (no contract/revision change)

## What changed

### Original implementation (`aedd416`)

- **Migration 019:** `authority_version`, `departed_at` / `departed_household_date`, `sign_in_revoked_at`; `membership_access_claims`; receipt kinds; backfill `household.access.manage` + `household.member.remove` only to enroll+structure holders.
- **Grants / schemas:** Manager preset includes access/remove; role derivation helpers; permission / access-claim / removal / fixture-remediation schemas; unknown legacy grants preserved.
- **Store / member-access:** Current-grant invitations; permission save with authority version + last-manager guard; invite / password-reset / restore-sign-in claims; self password change with fresh session; revoke/restore sign-in; removal preview/commit (physical delete unused vs depart tombstone); fixture remediation with exclusive optional B backup; eligibility/checklist guards for departed owners; `SyncHub.closeMembership`.
- **HTTP / policy:** Access, permission, password, removal, and fixture routes; CSRF/Origin exemptions for redeem; route-policy inventory completeness.
- **Client:** People directory shows Manager/Member/Customized + sign-in status; Profile vs Sign-in & permissions; Manager/Member + approval/direct + secondary Permissions editor with Save preview; Copy link / Show QR (`qrcode`); revoke/restore/removal; fixture remediation UI; `#access=` fragment redeem; outbox retirement on identity loss.
- **Evidence / CI:** Integration + unit + Chromium e2e; `e2e-phone-008c` aggregate job; npm script `test:e2e:chromium:phone:008c`.

### FIX REQUIRED remediation (this tip, uncommitted)

- **AT9 / D-054:** `previewMemberRemoval` builds a resolver-based seven-day impact (`days`, `repairLinks`, version/date-bound digest). `commitMemberRemoval` / fixture depart paths call `reconcileOccurrenceRange` after `markMembershipDeparted` instead of blanket cancel. Routine materialize/reconcile/participant resolution filter by `isMemberEligible`.
- **AT10:** Integration covers action-first and departure-first for member and display status commands; started snapshots/history retained; post-departure execution rejected.
- **AT11:** Display `listHouseholdPeople` / promoted tasks exclude departed owners; removal and fixture apply invalidate display `tasks` (people already via membership/family_order broadcast). Two-display dashboard + WS invalidate evidence.
- **AT13 / AT14:** Fixture intervening-write stale digest; delayed write vs exclusive backup snapshot/idempotent receipt; injected mid-TX removal failure rolls back membership, claims, and occurrences together.
- **Client:** Removal confirm UI shows next-seven-day impact and Unassigned repair titles.

## Files changed (high level)

- `db/migrations/019_member_access_removal.sql` (new, at `aedd416`)
- `src/shared/grants.ts`, `src/shared/grants.test.ts`, `src/shared/schemas.ts`
- `src/server/member-access.ts`, `src/server/responsibility-plan.ts`, `src/server/store.ts`, `src/server/display.ts`, `src/server/sync-hub.ts`, `src/server/app.ts`, `src/server/route-policy.ts`, `src/server/lifecycle-runtime.ts`
- `src/client/api.ts`, `src/client/PeopleGroups.tsx`, `src/client/App.tsx`, `src/client/outbox.ts`
- `tests/integration/p0-008c.test.ts`, `tests/e2e/z-p0-008c-people-access.spec.ts`
- Stale migration-count / default-grant / claim-grant expectations in older integration tests
- `package.json`, `package-lock.json` (`qrcode`), `playwright.config.ts`, `.github/workflows/validate-pr.yml`
- `reports/P0-008C-r1-build-report.md` (this file)

## Behavior delivered

A manager can explain a person's authority role and sign-in status, edit permissions without replacing the account, issue a person-specific invitation/password/restore link (copy or local QR), revoke or restore sign-in without ending household membership, and remove a person after an authoritative seven-day resolver impact preview while preserving started work and history. Departure reconciles affected routine/responsibility unstarted work through the same assignment resolver used by Today. Departed people and their promoted personal tasks leave current display projections promptly. New people default to Member + approval. Current membership grants win at redeem. Last essential manager (enroll + structure + access.manage + lifecycle.manage) cannot be extinguished by ordinary admin actions. Canonical fixture remediation is available when seed IDs exist, with optional backup off by default requiring lifecycle.manage inside the exclusive barrier.

## Acceptance test mapping (AT1–15)

| AT | Evidence | Result |
| --- | --- | --- |
| 1 Upgrade and roles | Integration AT1 default Member grants + Adult/Child no-op; migration 019 backfill only for enroll+structure | PASS |
| 2 Normal person journey | e2e `z-p0-008c-people-access.spec.ts` (chromium-008a / webkit-008a via prior RC): add person, role/sign-in labels, Copy link / Show QR | PASS (prior tip; not re-run this tip) |
| 3 Permissions | Integration AT3 manager↔member + stale authority conflict | PASS |
| 4 Old links | Integration AT4 current-grant redeem; preview non-consuming; canceled claim fails | PASS |
| 5 Password help | Integration AT5 self-change + password_reset redeem; old passphrase/sessions fail | PASS |
| 6 Revoke and restore | Integration AT6 revoke keeps person; restore_sign_in re-enables | PASS |
| 7 Last manager | Integration AT7 demote/revoke/remove of sole essential manager rejected | PASS |
| 8 Unused/used removal | Integration AT8 physical delete unused pending; used → departed tombstone | PASS |
| 9 Next-week impact | Integration AT9: fixed/weekly/cycle/group seven-day preview + reconcile; stale digest/version gates; Unassigned repair links | PASS |
| 10 Started/history | Integration AT10: action-first and departure-first for member + display; history retained; post-departure commands rejected | PASS |
| 11 Live privacy | Integration AT11: two displays; departed person/promoted task withdrawn; private task IDs/titles absent; WS `people`/`tasks` invalidate | PASS |
| 12 Display independence | Integration AT12 wall remains after manager remove when another manager exists | PASS |
| 13 Fixture transition | Integration AT13 + AT13b: seeded preview; renamed/claimed not preselected; backup needs lifecycle.manage; intervening write CONFLICT; delayed write vs backup; receipt idempotency (no duplicate backup) | PASS |
| 14 Denials and atomicity | Integration AT14 denials + AT14b injected mid-TX removal rollback of membership/claims/occurrences | PASS |
| 15 Regression and gates | Focused unit/integration PASS this tip; prior tip exact `validate:pr` / `validate:rc` PASS at `aedd416`; CI job `e2e-phone-008c` wired | PASS (this tip: focused + full vitest/tsc); hosted N/A |

## Verification performed

### This tip (FIX REQUIRED remediation)

- `npx tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.server.json --noEmit` — PASS
- `npx vitest run tests/integration/p0-008c.test.ts` — **16 passed**
- `npx vitest run` — **316 passed** (45 files)
- Live database / Railway / deploy — **NOT RUN** (out of scope; no deploy authorized)

### Prior tip at `aedd416` (recorded; not re-run here)

- Exact `npm run validate:pr` — **PASS** (EXIT 0, ~9.3m)
- Exact `npm run validate:rc` — **PASS** (EXIT 0, ~14.9m)
- `npx playwright test --project=chromium-008a --grep "P0-008C"` — **1 passed**

## Deviations / known limitations

- Full `validate:pr` / `validate:rc` were not re-executed after this FIX REQUIRED tip; Architecture may request a fresh gate run before ACCEPT.
- Legacy `people-groups.spec.ts` still expects older “Set up access” wording; C journey lives in `z-p0-008c-people-access.spec.ts`.
- P0-008D, hosted remediation, and Product acceptance remain out of scope.
- FIX REQUIRED code changes remain uncommitted pending Project Lead authorization.

## Discoveries for Architecture

- Fixture remediation optional backup must call a backup helper that does **not** re-enter `withExclusive` while the apply route already holds the exclusive barrier (`createBackupWhileExclusive`).
- Unused-person physical delete must retire structure receipts owned solely by that membership; otherwise create/profile receipts make every new person undeletable.
- Sole essential manager must be blocked from self sign-in revoke as well as demotion/removal.
- Fixture candidate digests include per-member blockers: a write that flips a fixture member’s blocker set (e.g. first personal task) invalidates an in-flight remediation preview after backup; tests prime stable blockers before racing delayed writes.

## Suggested follow-up

- Architecture re-review / technical acceptance against this Build Report and the FIX REQUIRED findings.
- Project Lead commit authorization for the FIX REQUIRED tip (suggested message: `fix(P0-008C): resolver removal impact, display withdrawal, and AT evidence`).
- Optional fresh `validate:pr` / `validate:rc` if Architecture requires gate re-confirmation beyond focused vitest/tsc.
- P0-008D readiness remains gated on accepted C.
