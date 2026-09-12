# Build Report - BRIEF P0-004A r3

**Brief revision implemented:** 3  
**Engineering status:** IMPLEMENTED  
**Branch:** `brief/p0-004a-people-groups-access`  
**Commits:** *uncommitted at report time* (suggested message below)  
**Pull request:** N/A  

## Readiness

**READY** against r3 (see `reports/P0-004A-r3-engineering-readiness.md`). Architecture **ACCEPT / PROCEED**. Implemented only r3; P0-004B, routing, and generic member deletion were not implemented. Accepted r2 security, authority, isolation, sync, replay, and historical-integrity contracts are preserved.

## What changed

- **Focused People & Groups UX (D-016):** exclusive in-app states for overview, person detail/add/edit/access, group detail/create/edit, and household activity; Back + focus-heading; compact directory without stacked editors/activity.
- **Household activity:** Morning Routine progress (same expandable occurrence DOM as prior manager progress) and household-visible personal tasks live only in the focused activity state; overview exposes a single `View household activity` action when authorized.
- **Fixture-free normal bootstrap (D-017):** development `AUTO_SEED` defaults off (`.env.example` `AUTO_SEED=0`); empty `auth:bootstrap` creates minimum household + claim only via `ensureEmptyHousehold` (no demo seed).
- **One canonical fixture manifest:** six Reed memberships `…201`–`…206` in `src/server/seeds/evaluation.ts`; store seeding uses that list only.
- **Cleanup command:** `npm run db:cleanup-fixtures` dry-run default / `--apply` with backup-first, exact manifest IDs, transactional re-check; not a generic deletion API/UI.
- **Tests/docs:** focused people-groups e2e + Chromium phone screenshots; morning-routine e2e opens household activity; integration coverage for bootstrap/cleanup; ops/ARCHITECTURE/protected-behaviors (PB-20) updates.

## Behavior delivered

A parent can open a compact People & Groups directory, drill into one person or group with clear Back navigation, manage access in a focused state, and open household activity without scrolling a composite admin page. A fresh empty database no longer invents demo people unless seeding is explicitly opted in.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate` | **PASS** (included in PR/RC) — lint/typecheck/Vitest **50** |
| `npm run validate:pr` | **PASS** — build + Chromium e2e **14/14** |
| `npm run validate:rc` | **PASS** — Chromium + WebKit e2e **28/28** |
| Hosted / Railway | **NOT RUN** — not required for this implementation review |

### New vs reused evidence

**New:** exclusive focused-state People & Groups UX; household activity placement; fixture-free bootstrap + `AUTO_SEED` default off; canonical six-member manifest; cleanup dry-run/apply integration; Chromium phone screenshots under `reports/p0-004a-r3-screenshots/`; PB-20.  
**Reused:** r2 people/access/group/authority/isolation/replay/sync suites remaining green under validate:rc; P0-001/P0-002/P0-003 gates; morning-routine sync/visibility scenarios updated only for activity navigation.

### Phone-width screenshots (fictional data)

| File | State |
| --- | --- |
| `reports/p0-004a-r3-screenshots/01-overview.png` | Compact overview |
| `reports/p0-004a-r3-screenshots/02-person-detail.png` | Person detail (Elizabeth) |
| `reports/p0-004a-r3-screenshots/03-person-edit.png` | Edit person |
| `reports/p0-004a-r3-screenshots/04-person-access.png` | Access setup (one-time material visible once) |
| `reports/p0-004a-r3-screenshots/05-group-detail.png` | Group detail |
| `reports/p0-004a-r3-screenshots/06-group-edit.png` | Edit group |

### Fixture-remediation rehearsal (disposable copy only)

- Copied `runtime/dev.sqlite` → disposable path; migrated the copy; ran dry-run then `--apply` against the copy only.
- **Real `runtime/dev.sqlite` was not mutated.**
- At rehearsal time the disposable copy evaluated **all six** manifest IDs (`…201`–`…206`) as candidates (no blockers); apply removed those six; re-run was idempotent (absent). This differs from the brief’s earlier inspection snapshot (then `…201` blocked) — predicates are re-evaluated at apply time, as required.
- Output reports IDs and blocker categories only; no private task/content/credentials.

## Deviations from brief revision

- None material. Local cleanup rehearsal candidate set reflected current disposable-copy state rather than the dated brief inspection note for live `dev.sqlite`.

## Discoveries for Architecture

- Seeded pending memberships intentionally omit classification until edited; overview correctly omits unset role.
- Manager progress sync e2e depends on the prior expandable occurrence markup (`Status: …`); the activity state preserves that DOM contract.

## Known limitations

- P0-004B group-backed Morning Routine / audience / rotation not implemented (by design).
- No router/URL deep links; Back is in-app only (D-016).
- No generic member deletion UI/API.
- Product Lead phone evaluation remains required after Architecture technical acceptance.

## Suggested commit message (not committed)

```
P0-004A: complete focused People & Groups UX and fixture-safe bootstrap

Exclusive mobile states, opt-in demo fixtures, provenance-safe cleanup,
and r3 validation evidence while preserving r2 authority contracts.
```

## Suggested follow-up

Architecture technical acceptance of r3. Product evaluation using the screenshot set and phone-width flows. Operator may later apply cleanup to live local DB only with explicit Project Lead instruction.
