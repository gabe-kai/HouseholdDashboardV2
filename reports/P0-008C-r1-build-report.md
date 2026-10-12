# Build Report - BRIEF P0-008C r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED; exact PR/RC gates PASS — awaiting Architecture technical acceptance  
**Branch:** `brief/p0-008c-member-access-removal`  
**Baseline:** merged A/B at `f80d47b` (PR #25); Architecture ACCEPT / PROCEED at `21ec8dc`  
**Implementation:** uncommitted working tree on this branch (no Engineering commit requested yet)  
**Pull request:** N/A (not opened by this Build Report)

## What changed

- **Migration 019:** `authority_version`, `departed_at` / `departed_household_date`, `sign_in_revoked_at`; `membership_access_claims`; receipt kinds; backfill `household.access.manage` + `household.member.remove` only to enroll+structure holders.
- **Grants / schemas:** Manager preset includes access/remove; role derivation helpers; permission / access-claim / removal / fixture-remediation schemas; unknown legacy grants preserved.
- **Store / member-access:** Current-grant invitations; permission save with authority version + last-manager guard; invite / password-reset / restore-sign-in claims; self password change with fresh session; revoke/restore sign-in; removal preview/commit (physical delete unused vs depart tombstone); fixture remediation with exclusive optional B backup; eligibility/checklist guards for departed owners; `SyncHub.closeMembership`.
- **HTTP / policy:** Access, permission, password, removal, and fixture routes; CSRF/Origin exemptions for redeem; route-policy inventory completeness.
- **Client:** People directory shows Manager/Member/Customized + sign-in status; Profile vs Sign-in & permissions; Manager/Member + approval/direct + secondary Permissions editor with Save preview; Copy link / Show QR (`qrcode`); revoke/restore/removal; fixture remediation UI; `#access=` fragment redeem; outbox retirement on identity loss.
- **Evidence / CI:** Integration + unit + Chromium e2e; `e2e-phone-008c` aggregate job; npm script `test:e2e:chromium:phone:008c`.

## Files changed (high level)

- `db/migrations/019_member_access_removal.sql` (new)
- `src/shared/grants.ts`, `src/shared/grants.test.ts`, `src/shared/schemas.ts`
- `src/server/member-access.ts` (new), `src/server/store.ts`, `src/server/sync-hub.ts`, `src/server/app.ts`, `src/server/route-policy.ts`, `src/server/lifecycle-runtime.ts`
- `src/client/api.ts`, `src/client/PeopleGroups.tsx`, `src/client/App.tsx`, `src/client/outbox.ts`
- `tests/integration/p0-008c.test.ts`, `tests/e2e/z-p0-008c-people-access.spec.ts`
- Stale migration-count / default-grant / claim-grant expectations in older integration tests
- `package.json`, `package-lock.json` (`qrcode`), `playwright.config.ts`, `.github/workflows/validate-pr.yml`

## Behavior delivered

A manager can explain a person's authority role and sign-in status, edit permissions without replacing the account, issue a person-specific invitation/password/restore link (copy or local QR), revoke or restore sign-in without ending household membership, and remove a person after an impact preview while preserving started work and history. New people default to Member + approval. Current membership grants win at redeem. Last essential manager (enroll + structure + access.manage + lifecycle.manage) cannot be extinguished by ordinary admin actions. Canonical fixture remediation is available when seed IDs exist, with optional backup off by default requiring lifecycle.manage inside the exclusive barrier.

## Acceptance test mapping (AT1–15)

| AT | Evidence | Result |
| --- | --- | --- |
| 1 Upgrade and roles | Integration AT1 default Member grants + Adult/Child no-op; migration 019 backfill only for enroll+structure | PASS |
| 2 Normal person journey | e2e `z-p0-008c-people-access.spec.ts` (chromium-008a / webkit-008a via RC): add person, role/sign-in labels, Copy link / Show QR | PASS |
| 3 Permissions | Integration AT3 manager↔member + stale authority conflict | PASS |
| 4 Old links | Integration AT4 current-grant redeem; preview non-consuming; canceled claim fails | PASS |
| 5 Password help | Integration AT5 self-change + password_reset redeem; old passphrase/sessions fail | PASS |
| 6 Revoke and restore | Integration AT6 revoke keeps person; restore_sign_in re-enables | PASS |
| 7 Last manager | Integration AT7 demote/revoke/remove of sole essential manager rejected | PASS |
| 8 Unused/used removal | Integration AT8 physical delete unused pending; used → departed tombstone | PASS |
| 9 Next-week impact | Integration AT9/10 preview digest gates commit (impact groups + mode); deeper weekly/cyclic matrix partial vs brief | PARTIAL — digest/commit path covered; full assignment-pattern matrix not exhaustively replayed |
| 10 Started/history | Integration AT9/10 departed loses sessions; new checklist ownership for departed rejected | PARTIAL — started-work race orders and display-command matrix not fully covered |
| 11 Live privacy | Not a dedicated integration/e2e matrix in this tip | NOT RUN / GAP — reconnect/visibility privacy covered only by related prior briefs + SyncHub close |
| 12 Display independence | Integration AT12 wall remains after manager remove when another manager exists | PASS (continuity); authorship/issuer-claim edges lighter |
| 13 Fixture transition | Integration AT13 seeded preview; renamed/claimed not preselected; backup needs lifecycle.manage | PASS (core); full race-with-write matrix lighter than brief |
| 14 Denials and atomicity | Integration AT14 anonymous/CSRF/under-privileged denials | PASS (denial matrix); injected mid-tx fault matrix not expanded |
| 15 Regression and gates | Focused unit/integration/e2e PASS; exact `validate:pr` / `validate:rc` PASS; CI job `e2e-phone-008c` wired | PASS (local gates); hosted N/A |

## Verification performed

- `npx tsc -p tsconfig.json --noEmit` and `tsc -p tsconfig.server.json --noEmit` — PASS
- `npx vitest run` — **312 passed**
- `npx vitest run src/shared/grants.test.ts tests/integration/p0-008c.test.ts` — **16 passed**
- `npx playwright test --project=chromium-008a --grep "P0-008C"` — **1 passed**
- Exact `npm run validate:pr` — **PASS** (EXIT 0, ~9.3m): lint/typecheck; **312** unit/integration; production build; Chromium e2e **105 passed**; Vite deeplink e2e **5 passed** (`reports/_local-p0-008c-validate-pr.log`)
- Exact `npm run validate:rc` — **PASS** (EXIT 0, ~14.9m): lint/typecheck; **312** unit/integration; production build; full Playwright e2e **165 passed** (~13.9m, includes WebKit); Vite deeplink e2e **5 passed** (`reports/_local-p0-008c-validate-rc.log`)
- Live database / Railway / deploy — **NOT RUN** (out of scope)

## Deviations / known limitations

- AT9/10/11/12/13 are covered at core seams; exhaustive assignment-pattern, dual-display privacy, and family-order receipt retirement on unused delete remain thinner than the brief’s full matrix.
- Legacy `people-groups.spec.ts` still expects older “Set up access” wording and was not rewritten in this tip; C journey lives in `z-p0-008c-people-access.spec.ts`.
- P0-008D, hosted remediation, and Product acceptance remain out of scope.
- No Engineering git commit was created (Project Lead authorization required).

## Discoveries for Architecture

- Fixture remediation optional backup must call a backup helper that does **not** re-enter `withExclusive` while the apply route already holds the exclusive barrier (`createBackupWhileExclusive`).
- Unused-person physical delete must retire structure receipts owned solely by that membership; otherwise create/profile receipts make every new person undeletable.
- Sole essential manager must be blocked from self sign-in revoke as well as demotion/removal.

## Suggested follow-up

- Architecture technical acceptance against this Build Report.
- Project Lead commit/PR authorization with suggested messages:
  - `feat(P0-008C): member access, permissions, and safe removal`
  - `test(P0-008C): integration, e2e, and CI shard`
- Optional deeper AT9–AT11 matrices if Architecture requires them before ACCEPT.
- P0-008D readiness remains gated on accepted C.
