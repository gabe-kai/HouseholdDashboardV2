# Build Report - BRIEF P0-006C r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (local; FIX REQUIRED AT4 evidence closed; pending technical / Project Lead acceptance)  
**Branch:** `brief/p0-006c-household-profiles-useful-history`  
**Base:** planning tip `ccd1c60` (ACCEPT/PROCEED); B merge parent `de552ab`  
**Implementation commits:** **uncommitted** (Project Lead manages Git; do not deploy)  
**Pull request:** N/A  
**Architecture disposition addressed:** FIX REQUIRED — AT4 normal UI Save persistence  

## Readiness

**READY** against r1; Architecture **ACCEPT / PROCEED**, then **FIX REQUIRED** for AT4 UI Save evidence. Contract unchanged. This report supersedes the prior r1 Build Report for AT4 only.

## FIX REQUIRED — root cause and close

### Root cause
Family-order **UI Save** was not equivalent to the AT4 contract because the journey cancelled the draft and persisted via `PUT /api/v1/people/order`. That workaround hid a real client race under full-suite shared-DB churn:

1. **Live `expectedVersion` retargeting** — `ReorderPeopleState` derived Save’s `expectedVersion` from live `props.familyOrderVersion` while dirty detection used a live people baseline. Mid-edit `membership` / supporting-data refreshes (common after earlier suite `createPerson` bumps to `family_order_version`) could advance the version the Save button would send without a coherent draft pin, producing intermittent `CONFLICT` (“Family order was updated elsewhere”).
2. **Async directory refresh after success** — Save success navigated to overview and only then kicked `refreshSupportingData`, so immediate post-Save directory assertions could still see the prior order even when the PUT succeeded.
3. **Incomplete order sync fan-out** — `createPerson` increments `family_order_version` but previously broadcast only `membership`, leaving order subscribers dependent on people refetch timing.

### Fix (r1, scoped)
- Pin draft baseline + `expectedVersion` at reorder open; adopt remote version only when clean; keep pinned version while dirty so Save surfaces a real conflict.
- Apply Save response `people` + `version` into App state immediately before overview refresh.
- Refresh supporting data when opening People & Groups; broadcast `family_order` from `createPerson`.
- E2e journey now proves Cancel, Move-menu → Save → reload, and CDP touch → Save → reload (no API persistence substitute).

## What changed

### Domain / migration (D-032–D-034)
- Profile validation in `src/domain/profile.ts` (friendly name, optional full name/birthday/email).
- Forward migration `010_household_profiles_useful_history.sql`: profile columns, `sort_order`, household `activity_generation` / `family_order_version` / `activity_reset_floor`, family-order + activity-reset receipts, checklist `mutation_receipts.household_id`/`occurrence_id` backfill from JSON, `household.activity.clear` grant backfill from `routine.shared.manage`.
- Deterministic initial family order: alphabetical `display_name` + id.

### Server
- Membership loaders expose `sortOrder`; person detail exposes profile fields; claim preserves profile/order and bumps version.
- `PUT /api/v1/people/order` with digest replay + injectable failure hook; `PATCH` people accepts profile fields.
- **History reads are side-effect-free** (`historyForDate` / `historySummaries` never call `materializeForDate`); compact summaries + detail with `step_reports`; future dates rejected toward Preview.
- `POST /api/v1/household/activity/clear` gated by `allowEvaluationHistoryClear` ∧ `household.activity.clear`; deletes step_reports → occurrence_steps → scoped checklist receipts → occurrences; advances generation + floor; digest replay; injectable rollback hook.
- `setStepStatus` validates `activityGeneration` before write/replay; receipts store household/occurrence ownership.
- Materialize/ensure refuse dates before reset floor; Today/session/meta expose generation + clear availability.
- Sync resources: `family_order`, `activity_reset`; `createPerson` also broadcasts `family_order`.

### Client
- Addressable `/household/history`, `/household/history/:occurrenceId`, `/household/settings`.
- People: Friendly name label, profile edit, Reorder people (`OrderedList`) with pinned order Save semantics and immediate Save-result apply.
- History summary/detail UI; Settings → Data & testing clear with strong confirmation.
- Outbox stamps `activityGeneration`; on newer generation retires this membership’s older commands/snapshots and shows dismissible banner; same-generation omit retention preserved.

### Evidence / docs
- Fixture `tests/helpers/p009-fixture.ts`; integration `tests/integration/p0-006c.test.ts`; e2e journey + reset-outbox + desktop geometry stub.
- PB-37–39 + sync matrix rows; `.env.example` documents `ALLOW_EVALUATION_HISTORY_CLEAR`.
- Screenshots under `reports/p0-006c-r1-screenshots/`. Prior A/B dirs restored to pre-gate hashes after validate overwrite.

## Verification performed

| Check | Result |
| --- | --- |
| Focused AT4 journey | **PASS** — `npx playwright test tests/e2e/z-p0-006c-profiles-history-clear.spec.ts --project=chromium` (`reports/p0-006c-r1-at4-focused.log`) |
| `npm run validate:pr` | **PASS** — unit **146/146**; Chromium e2e **34/34** + Vite **1/1** (`reports/p0-006c-r1-validate-pr.log`) |
| `npm run validate:rc` | **PASS** — unit **146/146**; Chromium+WebKit **59** passed + Vite **1/1** (`reports/p0-006c-r1-validate-rc.log`) |
| Prior `reports/p0-006a-r2-screenshots/` / `p0-006b-r1-screenshots/` | **PASS** — restored after gate overwrite; SHA-256 matches pre-gate snapshot |
| New C screenshots | `reports/p0-006c-r1-screenshots/` (directory, person-detail, history-summary, history-detail, clear-confirm) |
| Deployment | **NOT RUN** (not required) |

## Acceptance tests (AT1–17)

| AT | Result | Evidence |
| --- | --- | --- |
| 1 Populated upgrade | **PASS** | `p0-006c.test.ts` through-009 fixture → 010: unset profiles, generation 0, clear grant backfill, deterministic order, FK check, idempotent re-migrate |
| 2 Profiles and access | **PASS** | Integration profile update + validation; e2e edit Avery friendly/full/birthday/email + reload |
| 3 Profile authority/conflict | **PASS** | Stale version rejection; personalizer denied structure write (`Required authority is missing`) |
| 4 Saved family order | **PASS** | **UI Cancel** leaves order unchanged through reload; **Move-menu → Save → reload**; **CDP touch drag → Save → reload** in `z-p0-006c-profiles-history-clear.spec.ts` (no API substitute). Integration still covers command/replay. |
| 5 Order command safety | **PASS** | Missing IDs rejected; injectable failure rolls back order/version/receipt |
| 6 Read-only History | **PASS** | AT6: History today/past leaves occurrence/step counts unchanged; future rejected |
| 7 Honest summaries/evidence | **PASS** | Complete/Not needed counts + `step_reports` on detail |
| 8 History navigation/isolation | **PASS** | e2e summary → detail → Back; `/household/history` addressable (Vite + built via gates) |
| 9 Clear UI and policy | **PASS** | e2e cancel then confirm; HTTP 403 when `ALLOW_EVALUATION_HISTORY_CLEAR=0` |
| 10 Exact deletion/retention | **PASS** | Clear removes occurrences + scoped checklist receipts; people/routines/calendar retained |
| 11 Clear atomicity/replay/race | **PASS** | Injectable failure before receipt rolls back; same mutationId replay; stale generation rejected |
| 12 Rematerialization boundary | **PASS** | Fresh IDs after clear; pre-floor materialize returns empty; old occurrence commands fail |
| 13 Offline reset browser journey | **PASS** | `z-p0-006c-reset-outbox.spec.ts` Chromium (+ WebKit via RC): pending abort → clear → reload retires outbox |
| 14 Late/missed reset recovery | **PASS** | Same e2e + client generation fence on sync/visibility/session paths; same-generation omit retention still passes |
| 15 Live connected views | **PASS** | Sync `membership` / `family_order` / `activity_reset` wired; dirty profile/order drafts retained |
| 16 Product journeys and layout | **PASS** | Phone Chromium journey + screenshots; desktop project includes `z-p0-006c-geometry.spec.ts`; WebKit via RC |
| 17 Gates and handoff | **PASS** | validate:pr / validate:rc; this report; prior screenshots restored |

## Migration / replay choices

- Checklist receipt ownership: forward columns + JSON/`occurrence` join backfill; clear deletes by `household_id` or occurrence set.
- Activity generation starts at 0; omitted generation only compatible while generation remains 0.
- Clear delete order: `step_reports` → `occurrence_steps` → `mutation_receipts` → `occurrences` (FK-safe).
- History: stored nonempty visible rows only; current friendly names joined for presentation.

## Known limitations (not blockers)

- Hosted / physical phone / full SR certification: out of scope.

## Suggested commit messages (do not commit)

```
P0-006C: close AT4 with stable family-order UI Save (r1)

Pin reorder expectedVersion, apply Save results immediately,
prove Cancel / Move-menu / touch Save→reload, and re-gate.
```
