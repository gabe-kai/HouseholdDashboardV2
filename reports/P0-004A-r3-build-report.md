# Build Report - BRIEF P0-004A r3

**Brief revision implemented:** 3  
**Engineering status:** IMPLEMENTED (FIX REQUIRED closed — awaiting Architecture re-acceptance)  
**Branch:** `brief/p0-004a-people-groups-access`  
**Commits:**  
- `b4256ac` — r3 implementation (focused UX + fixture-free bootstrap)  
- *correction pass uncommitted* — CSS/touch geometry, secret-safe screenshots, exhaustive cleanup inventory + tests (suggested message below)  
**Pull request:** N/A  

## Readiness

**READY** against r3 (see `reports/P0-004A-r3-engineering-readiness.md`). Architecture **ACCEPT / PROCEED**, then **FIX REQUIRED** (2026-09-11). This report covers the consolidated correction pass against the same revision 3 contract. No new readiness review. P0-004B, routing, generic member deletion, and Railway deployment were not implemented.

## What changed (correction pass)

1. **Choice-control CSS:** `.form-grid label.choice-row` wins over `.form-grid label { display: grid }`; radio/checkbox inputs no longer inherit text-field `min-height`/`padding`. Controls sit beside their text in full-row flex tap targets.
2. **Touch targets:** People & Groups secondary actions (`.button-row` and focused-state actions) meet `--touch` (44px). Geometry e2e asserts composed row layout vs oversized/stacked controls.
3. **Secret-safe access screenshot:** `04-person-access.png` is captured **before** issuance (Access: Not set up; Guided member selected). One-time setup material is exercised in the test but never written to report artifacts. Prior secret-bearing PNG removed.
4. **Exhaustive fixture cleanup inventory:** blocks on `auth_sessions`, legacy `sessions.member_id`, `enrollment_claims.membership_id`, `enrollment_claims.created_by_membership_id`, revision/occurrence/step/personal/proposal/group refs, and identity-bearing `structure_mutation_receipts` / `mutation_receipts` JSON. Exported `evaluateMembership` / `runFixtureCleanup` for tests; backup-failure injectable.
5. **Cleanup test matrix:** safe/renamed/same-name non-fixture, target claim, creator authorship, legacy session, structure/mutation receipts, group/personal/history, backup failure, post-dry-run changed state, idempotency (`tests/integration/p0-004a-cleanup.test.ts`).

## Behavior delivered

Unchanged player-facing r3 intent, with operable phone choice controls, safe Product evidence, and provenance-safe cleanup that refuses deletion when any inventoried durable reference remains.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate` | **PASS** (included in PR/RC) — lint/typecheck/Vitest **57** |
| `npm run validate:pr` | **PASS** — build + Chromium e2e **15/15** (includes geometry regression) |
| `npm run validate:rc` | **PASS** — Chromium + WebKit e2e **30/30** |
| Hosted / Railway | **NOT RUN** — not required |

### New vs reused evidence

**New (correction):** choice-row computed-style/geometry e2e; secret-safe access screenshot regeneration; exhaustive cleanup blockers + dedicated cleanup suite.  
**Reused:** r2/r3 domain contracts; focused-state UX from `b4256ac`; bootstrap fixture-free test; morning-routine activity navigation.

### Phone-width screenshots (fictional data; secret-safe)

| File | State |
| --- | --- |
| `reports/p0-004a-r3-screenshots/01-overview.png` | Compact overview |
| `reports/p0-004a-r3-screenshots/02-person-detail.png` | Person detail (Elizabeth) |
| `reports/p0-004a-r3-screenshots/03-person-edit.png` | Edit person (aligned role radios) |
| `reports/p0-004a-r3-screenshots/04-person-access.png` | Access setup **before issuance** (no one-time material) |
| `reports/p0-004a-r3-screenshots/05-group-detail.png` | Group detail |
| `reports/p0-004a-r3-screenshots/06-group-edit.png` | Edit group (aligned member checkboxes) |

### Fixture-remediation rehearsal

Prior disposable-copy rehearsal under `b4256ac` remains valid as operator procedure. Live `runtime/dev.sqlite` was **not** mutated in this correction pass. Cleanup apply still requires Project Lead instruction for the real local database.

## Deviations from brief revision

- None material. Correction commit SHA will land when the Project Lead/Coordinator commits the working tree; report names implementation SHA `b4256ac` now.

## Discoveries for Architecture

- `.form-grid label` specificity over `.choice-row` was the root cause of stacked/oversized radios; scoped `label.choice-row` + input-type resets are sufficient without a design-system rewrite.
- Structure/step mutation receipts store membership identity inside JSON and must be treated as durable references for cleanup safety.

## Known limitations

- P0-004B not implemented (by design).
- No router/URL deep links; Back is in-app only.
- No generic member deletion UI/API.
- Product Lead phone evaluation remains required after Architecture technical acceptance.

## Suggested commit message (not committed)

```
P0-004A: close r3 FIX REQUIRED for controls, secrets, and cleanup

Align choice-row tap targets, keep access screenshots secret-safe,
and exhaust fixture cleanup references with regression coverage.
```

## Suggested follow-up

Architecture re-acceptance of r3. After commit, append the correction SHA to this report’s Commits line if desired. Product evaluation using the regenerated screenshot set.
