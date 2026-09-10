# Build Report - BRIEF P0-003 r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED  
**Integration branch:** `brief/p0-003-regression-safety-contract-hardening`  
**Evidence date:** 2026-09-10  
**Host class:** Local Windows Node.js 24 (no hosted deploy in this slice)  
**Private origin, identities, secrets:** omitted

## Summary

P0-003 r1 adds durable contract cataloging, a machine-checked `/api/v1` route-policy inventory, focused regression evidence for previously thin contracts, `validate:pr` / `validate:rc` scripts, and a least-privilege GitHub Actions workflow. Accepted P0-001/P0-002 product behavior is unchanged.

## What changed

1. **`docs/protected-behaviors.md`** — protected-behavior catalog (PB-01…PB-15), synchronization matrix, validation tiers, escaped-defect rule, supported migration baseline.  
2. **`src/server/route-policy.ts`** + completeness test — every registered `/api/v1` route (excluding auto `HEAD`) must appear in the inventory; test-only bootstrap is explicit.  
3. **Focused new tests** — reconcile/stale overlay, SyncHub duplicate+isolation, outbox key identity, CSRF deny, personal-task visibility/owner/idempotency, migration semantics + idempotent reapply.  
4. **`tests/helpers/p001-fixture.ts`** — shared populated pre-P0-002 baseline.  
5. **`validate:pr` / `validate:rc`** npm scripts; **`.github/workflows/validate-pr.yml`** (Node 24, `npm ci`, no secrets, no deploy).  
6. **Docs** — `ARCHITECTURE.md`, `CONTRIBUTING.md`, `docs/ops-deploy.md` updated for tiers and escaped-defect rule.  
7. **Minimal production hook** — optional `onRoute` collector on `buildApp` so inventory completeness can observe registrations (testability only).  
8. **ESLint** — Node globals for `scripts/**` (unblocks `validate` after `dev-lan.mjs`).

## Acceptance tests (mapped)

| AT | Result | Evidence class |
| --- | --- | --- |
| 1 Catalog + mapping | **PASS** | `docs/protected-behaviors.md` maps PB-01…PB-15 to tests/tiers; ENV-* separated |
| 2 Sync matrix | **PASS** | Same doc; covers current mutation-producing APIs + intentional non-emitters |
| 3 Route-policy completeness + focused auth | **PASS** | `tests/integration/route-policy.test.ts` (**new**); origin/grants (**reused** `p0-002-http`); CSRF (**new** `p0-003-contracts`) |
| 4 Migration semantics | **PASS** | **New** `p0-003-migration.test.ts` + helper; prior migrate case **reused** |
| 5 Optimistic + stale/duplicate mutations | **PASS** | **New** `reconcile.test.ts`; step idempotency **reused** `p0-001`; delayed checklist e2e **reused**; task mutationId **new** |
| 6 Outbox identity / reload / logout | **PASS** | **New** `outbox.test.ts` keys; e2e reload + logout **reused** |
| 7 Duplicate/missed WS + recovery | **PASS** (with note) | **New** `sync-hub.test.ts`; reconnect e2e **reused**; visibility shares same client refresh path as reconnect (**no separate visibility e2e**) |
| 8 Escaped proposal-status defect | **PASS** | Existing e2e retained; Chromium+WebKit green this run |
| 9 Personal-task visibility | **PASS** (API) | **New** HTTP visibility/owner/idempotency; prior private hide **reused**; **no dedicated UI e2e** (UI uses same list endpoint) |
| 10 validate / validate:pr / validate:rc locally | **PASS** | `npm run validate` PASS (43 tests); build PASS; Chromium e2e **10/10**; WebKit e2e **10/10** |
| 11 GitHub Actions workflow | **SUPPLIED / CI RUN NOT YET OBSERVED** | Workflow file present; **no Actions run URL** until pushed/PR opened; **required-check not configured** (Project Lead) |
| 12 Documentation | **PASS** | protected-behaviors, ARCHITECTURE, CONTRIBUTING, ops-deploy |

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate` | PASS — lint, typecheck, Vitest **43/43** |
| `npm run build` | PASS |
| Playwright Chromium (PR tier body) | PASS — **10/10** |
| Playwright WebKit (RC body) | PASS — **10/10** |
| Full `npm run validate:pr` / `validate:rc` scripts | Equivalent commands run (browsers installed via `npx playwright install` rather than nesting install twice) |
| GitHub Actions run | **NOT RUN** — requires push/PR on GitHub |
| Required branch protection | **EXTERNAL / UNKNOWN** — Project Lead setting |

## Reused vs new evidence

**Reused (retained):** P0-001/P0-002 domain + integration suites; ten Playwright scenarios including proposal-status sync, outbox reload/logout, reconnect, optimistic delayed mutations, grant matrix, WS household isolation, origin checks.

**New:** catalog/matrix docs; route inventory + completeness; reconcile; sync-hub duplicate; outbox keys; CSRF deny; personal-task HTTP visibility; migration semantics helper/test; PR/RC scripts; Actions workflow; eslint scripts globals.

## Deviations from brief

- None material. Visibility recovery is covered by the same authoritative re-read path as reconnect rather than a dedicated `visibilitychange` Playwright case. Personal-task **UI** projection is not given a separate e2e; API boundaries are enforced.

## Remaining gaps

1. **CI run URL/result** — record after first GitHub Actions execution on this branch/PR.  
2. **Required-check branch protection** — Project Lead confirmation before claiming merge is mechanically blocked by CI.  
3. Optional later: dedicated `visibilitychange` e2e; personal-task UI smoke; occurrence-step logical-id backfill if product ever requires historical occurrence overlay continuity (current backfill targets revision steps).

## Suggested follow-up

Architecture acceptance of P0-003 r1 after reviewing this Build Report. Coordinator/PL: open PR, confirm Actions check appears, optionally mark it required.
