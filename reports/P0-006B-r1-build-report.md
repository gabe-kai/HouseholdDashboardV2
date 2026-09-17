# Build Report - BRIEF P0-006B r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (local; pending technical / Project Lead acceptance)  
**Branch:** `brief/p0-006b-contextual-routine-applicability`  
**Base:** integrated `main` @ `7cba3a6` (accepted P0-006A r2); readiness ACCEPT at `2d7cdd6`  
**Implementation commits:** `1fb192d`, `f6a4e6a`, and `8421b31` (committed locally; Project Lead manages integration)
**Pull request:** N/A  

## Readiness

**READY** against r1; Architecture previously **ACCEPT / PROCEED**, then **FIX REQUIRED** for AT9–11 evidence. This update closes that evidence against the same revision. Contract unchanged. Implementation covers AT1–14 locally without deployment.

## What changed

### Domain / migration (D-029–D-031)
- Closed applicability vocabulary in `src/domain/applicability.ts`; school-calendar draft validation in `src/domain/school-calendar.ts`.
- Compose retains per-item rules; store filters after compose (`insertOccurrenceSteps`, `previewComposition`).
- Forward migration `db/migrations/009_contextual_routine_applicability.sql`: applicability columns, occurrence provenance, calendar edition tables, `household.schedule.manage` backfill from `routine.shared.manage`.

### Server
- `GET`/`PUT` `/api/v1/school-calendar` (session household; grant + Origin/CSRF + expectedVersion + mutationId replay).
- Calendar save appends immutable edition effective household today; reconciles unstarted occurrences for today/future including school-night predecessors; atomic receipt.
- Injectable `AppStore.setCalendarSaveFailureHook` throws after reconcile and before receipt insert so the SQLite writer transaction rolls back editions, occurrence changes, and receipts together (AT9).
- Past `historyForDate` is snapshot-only (no rewrite). Filtered-empty unstarted omitted from Today; no empty-list repair.
- Digests bind applicability; omitted nondefault rules rejected on revise; proposals/personal layers persist rules.
- Sync invalidation resource `school_calendar`.

### Client
- Household → School calendar (`/household/school-calendar`); focused Edit/Save/Cancel dirty leave; toast on save.
- Focused step Applicability control; compact nondefault labels; dated plan preview with included/excluded reasons.
- Personalize/proposal `AdditionFields` applicability; WS `school_calendar` refreshes Today + calendar + open Plan preview without clobbering dirty drafts (`SchoolCalendar` skips reload while dirty; `Routines` re-fetches preview on `refreshToken`).
- `retainPendingOmittedOccurrences` keeps pending first-action cards when the server omits an empty occurrence.
- First-action outbox items store an `occurrenceSnapshot`; `previousOccurrencesFromOutbox` rebuilds prior cards across reload. Outbox flush treats `NOT_FOUND` as recoverable rejection (obsolete filtered step).

### Evidence / docs
- Fixture `tests/helpers/p008-fixture.ts`; integration `tests/integration/p0-006b.test.ts`; unit applicability/reconcile/outbox; e2e `tests/e2e/z-p0-006b-contextual-applicability.spec.ts` + multi-context `tests/e2e/z-p0-006b-live-context.spec.ts` (AT10/AT11).
- PB-34–36 + sync matrix row; `ARCHITECTURE.md` updated to implemented facts.
- Screenshots only under `reports/p0-006b-r1-screenshots/`. Prior A/earlier screenshot dirs **unchanged**.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate` (via PR/RC) | **PASS** — lint + typecheck + Vitest **134** tests / **24** files |
| `npm run validate:pr` | **PASS** — Chromium e2e **29/29** + Vite deep-link **1/1** (`reports/p0-006b-r1-validate-pr.log`) |
| `npm run validate:rc` | **PASS** — Chromium + WebKit e2e **54/54** (+ skipped geometry/touch on WebKit as before) + Vite deep-link **1/1** (`reports/p0-006b-r1-validate-rc.log`) |
| Focused AT9 | **PASS** — `npx vitest run tests/integration/p0-006b.test.ts -t "injectable reconcile"` |
| Focused AT10/AT11 Chromium | **PASS** — `npx playwright test tests/e2e/z-p0-006b-live-context.spec.ts --project=chromium` (`reports/p0-006b-r1-live-context-e2e.log`) |
| Prior `reports/p0-006a-r2-screenshots/` | **PASS** — restored to HEAD after e2e overwrite; working-tree zero-diff vs branch tip |
| New B screenshots | `reports/p0-006b-r1-screenshots/` (calendar, morning rules, dated preview, exception, bedtime; re-captured by journey e2e) |
| Deployment | **NOT RUN** (not required) |

## Acceptance tests (AT1–14)

| AT | Result | Evidence |
| --- | --- | --- |
| 1 Upgrade continuity | **PASS** | `p0-006b.test.ts` through-008 fixture + P004B upgrade; Every-time defaults; grant backfill without hand SQL; FK check; idempotent re-migrate |
| 2 Calendar truth | **PASS** | `applicability.test.ts` + school-calendar validate; inclusive years/exceptions/unconfigured; household-date helpers |
| 3 School nights | **PASS** | Unit + integration: eve before first school day; Saturday school → Friday night; yesterday freeze when tomorrow exception changes; Sunday before Monday holiday |
| 4 Calendar workflow/authority | **PASS** | UI e2e save/reload; HTTP AT4 unauth/reader/structure-only/manager/CSRF version conflict; route-policy inventory |
| 5 Applicability authoring | **PASS** | Focused editor + personal/proposal fields; e2e school_days / school_nights save; labels on detail |
| 6 Composition/empty | **PASS** | Preview empty message; unresolved after edition wipe; hidden-anchor personal survives weekend filter; Today omit filtered-empty |
| 7 Governed ranges | **PASS** | Integration: calendar exception both sides of schedule boundary without routine version bump |
| 8 Protected history/locks | **PASS** | Two-member start vs unstarted; past History frozen; yesterday freeze under night/exception edits |
| 9 Races/replay/rollback | **PASS** | Version conflict; same mutationId replay; payload conflict; obsolete step after calendar filter fails. **Injectable** `setCalendarSaveFailureHook` mid-tx after reconcile: calendar editions, occurrence steps, and `calendar_mutation_receipts` roll back together (`p0-006b.test.ts` “injectable reconcile failure…”) |
| 10 Pending intent | **PASS** | Multi-context Chromium `z-p0-006b-live-context.spec.ts`: child queues first action while occurrence mutations abort; manager adds no-school exception omitting the empty occurrence; child retains pending card across visibility refresh and full reload via outbox snapshot; reconnect shows recoverable rejection (`NOT_FOUND`) without silent drop |
| 11 Live context | **PASS** | Same multi-context spec: Avery Today + manager open dated preview update live on `school_calendar` save (no reload); dirty calendar End-date draft survives remote save and surfaces conflict on Save; muted WS + visibility recovery restores included school-day step |
| 12 Connected Product journey | **PASS** | `z-p0-006b-contextual-applicability.spec.ts` Chromium (+ WebKit via RC): calendar → Morning school-day → preview → exception → bedtime school night |
| 13 Presentation/navigation | **PASS** | Phone viewport 390×844 e2e + screenshots under `reports/p0-006b-r1-screenshots/`; calendar URL addressable |
| 14 Regression/report | **PASS** | validate:pr / validate:rc; this report; prior screenshots unchanged |

## Migration / replay choices

- Storage: JSON `applicability_json` on revision/personal/proposal/occurrence steps; `calendar_edition_id` + `calendar_provenance` on occurrences.
- Routes: `/api/v1/school-calendar` GET/PUT; sync resource name `school_calendar`.
- Calendar year/exception row primary keys are new per edition (avoids FK collisions with retained historical editions). Public payloads return the current edition’s ids after each save.
- Legacy omitted applicability defaults to Every time on new writes; existing nondefault cannot be cleared by omission.
- Populated through-008 disposable fixture for AT1; P004B retained. Migration-count assertions updated 8 → 9.
- AT9 failure injection is a test-only store hook (not an HTTP surface).

## Known limitations (not blockers)

- Hosted / physical phone / full SR certification: out of scope.

## Suggested commit message (do not commit)

```
P0-006B: close AT9–11 evidence for contextual applicability (r1)

Injectable calendar reconcile rollback, multi-context pending omit
retention with outbox snapshots, and live school_calendar sync proof.
```
