# Engineering readiness — P0-006C r1

**Brief:** `briefs/p0-006c-household-profiles-useful-history.md` revision **1**  
**Compared against:** branch `brief/p0-006c-household-profiles-useful-history` @ `c2de2e9` (planning tip; parent merge `de552ab` = accepted P0-006B r1 on `main` via PR #13)  
**Disposition:** **READY**  
**Date:** 2026-09-17  
**Scope note:** Fresh review for **P0-006C revision 1** only. No re-review of A/B contracts except where C intentionally refines History reads and authorizes evaluation reset. Implementation waits for Architecture’s disposition of this review.

## Verdict

**READY.** D-032–D-034 and the r1 brief agree on a bounded third P0-006 slice: membership profiles + one saved family order, read-only History summaries with stored evidence drill-down, and one manager-authorized evaluation reset with generation-fenced rematerialization and outbox recovery. The accepted A/B foundation already supplies People & Groups focused drafts, OrderedList reorder, household shell/nav, school calendar editions, compose-then-filter occurrences, durable first-action outbox snapshots, and local PR/RC + Vite evidence tiers that this slice extends.

No material product ambiguity that would force Architecture to choose between competing interpretations of profile identity vs login, History side effects, retention table, or reset vs calendar-omission pending protection. The three highest-correctness surfaces—**History read isolation**, **checklist receipt ownership on clear**, and **reset/outbox recovery**—are specified tightly enough in sections 3–5 and D-033/D-034; remaining choices are ordinary Engineering discretion (SQL/route names, ownership backfill mechanics, module split).

Implementation must wait for Architecture’s ACCEPT/PROCEED (requested review-only). Branch already exists at this tip; Project Lead owns further Git.

## Repository baseline (evidence)

### Present on branch tip `c2de2e9` (accepted B + C planning)

| Surface | Verified fact |
| --- | --- |
| Migrations | Through `009_contextual_routine_applicability.sql`. **No** profile/order/activity-generation/reset tables or columns. |
| Memberships | `household_memberships`: `display_name`, `classification`, `version`, `user_id`, `status` — **no** full name / birthday / email / family-order fields (`002`/`003`). |
| Membership list | `Store.listMemberships` `ORDER BY display_name` (`src/server/store.ts`). `MemberPublic` has no profile extras (`src/shared/schemas.ts`). |
| People UI | `PeopleGroups.tsx`: structure.manage → Edit; enroll → access setup. Claim path updates `display_name` (and activates) **without** bumping `version` today (`Store.claim`). `OrderedList` exists but is **not** wired to people reorder. |
| History API | `GET /api/v1/history` → `historyForDate`; grant `routine.shared.manage`. **Past** dates: stored rows + `getOccurrenceView` only. **Today/future:** delegates to `materializeForDate` (write/reconcile capable). |
| History UI | `HistoryView` in `App.tsx` expands **every** occurrence’s steps; no summary-only projection; no `step_reports` evidence endpoint. Leaf under Household menu — **no** `/household/history` in `nav.ts`. |
| Occurrence names | `getOccurrenceView` joins **current** `hm.display_name` for `accountableMemberName` (presentation, not historical fact). |
| Checklist receipts | `mutation_receipts`: `mutation_id`, `response_json`, `created_at` only (`001`) — **no** `household_id` / occurrence FK. Payload embeds full `OccurrenceView` + report (`setStepStatus`). |
| Other receipts | `routine_mutation_receipts` / `calendar_mutation_receipts` carry `household_id`; `structure_mutation_receipts` does **not**; personal-task mutations key by `task_id`. |
| Clear / generation | **No** `household.activity.clear`, no Settings / Data & testing UI, no activity-generation column/API, no `ALLOW_EVALUATION_HISTORY_CLEAR` in `config.ts` / `.env.example`. |
| Outbox | `OutboxItem.occurrenceSnapshot` + `retainPendingOmittedOccurrences`; flush treats `NOT_FOUND` as rejected. Client “generation” refs are fetch counters only — **not** household activity epochs. |
| Fixtures | Populated through-008 (`tests/helpers/p008-fixture.ts`). **No** through-009 populated C fixture yet. |
| Grants | Manager preset has structure / enroll / schedule / shared.manage / … — **no** `household.activity.clear`. |
| Playwright desktop | `chromium-desktop` `testMatch` is only A calm-experience + geometry; new C desktop specs must be added explicitly. |
| Screenshots | Prior A/B dirs present; must remain zero-diff. New C evidence only under `reports/p0-006c-r1-screenshots/`. |

### Active decisions (r1-aligned)

- **D-032** — Profile facts on membership; friendly `display_name`; one household order; structure.manage; claim preserves profile/order.
- **D-033** — History is side-effect-free over stored evidence for **all** dates including today; future expectations stay Preview; keep `routine.shared.manage`.
- **D-034** — Explicit evaluation clear; preserve configuration; generation + floor + receipt atomic; receipt deletion scoped by verified ownership; outbox generation fence; B same-generation omit retention remains.
- **D-003 / D-023 / D-030** — Ordinary retention/locks/snapshots intact except the authorized reset exception.
- **D-027 / D-028** — Reuse shell, saved destinations, OrderedList reorder, dirty drafts, toast.

### Brief “Current system” claims

Accurate against `c2de2e9` for schema, History coupling, receipts, outbox, nav leaf, and migration tip. Soft baseline note only:

- Brief recorded inspected merge tip `de552ab`. **As of this review,** the C planning commit sits on top at `c2de2e9`. Implementation base is this branch tip (or equivalent after Lead commits); product Current-system facts still match `de552ab` code.

### Working-tree / Git note

Review performed on clean `brief/p0-006c-household-profiles-useful-history` @ `c2de2e9` (no uncommitted files). Do not absorb unrelated dirty work into an implementation commit. Project Lead manages commit/PR; agents suggest messages only.

## Focused r1 gap analysis (intentional contract deltas)

| Area | Current (`c2de2e9`) | r1 required | Severity |
| --- | --- | --- | --- |
| Profiles | Friendly name only | Optional full name / birthday / email; Friendly name label; detail not bulk list | IMPORTANT |
| Family order | Alphabetical `display_name` | Persisted household order + expected-order version; Reorder people draft; peer surfaces use order | IMPORTANT |
| Claim vs profile | Claim overwrites `display_name`, no `version++` | Preserve new profile facts/order; friendly-name claim allowed; version/sync updated | IMPORTANT |
| History isolation | Today/future History → `materializeForDate` (writes) | **All** History list/detail/count reads side-effect-free; no materialize/reconcile/lock; past never re-filtered from current plans/calendars | IMPORTANT |
| History UX / API | Expand-all steps; single `?date=`; leaf nav | Compact summaries; progressive filters/range ≤31d; detail + `step_reports` evidence; `/household/history` URLs | IMPORTANT |
| Checklist receipt ownership | `mutation_receipts` unscoped JSON | Clear deletes **only** this household’s checklist receipts via verified linkage or forward ownership backfill; preserve other receipt families | IMPORTANT |
| Evaluation reset | Absent | Settings → Data & testing; `household.activity.clear` + env gate; atomic delete/generation/floor/receipt; exact retention table | IMPORTANT |
| Outbox / generation | Snapshot omit retention only | Activity generation on commands/reads; retire old outbox on newer generation with visible explanation; no cross-identity wipe; B omit retention **within** generation | IMPORTANT |
| Migration / fixture | Through 009; no through-009 populated C baseline | Forward migration(s); generation zero; grant backfill from shared.manage only; disposable through-009 fixture | IMPORTANT |
| Evidence | A/B matrix | AT1–17; Chromium+WebKit multi-context reset journeys; desktop `testMatch` includes C; prior screenshots unchanged | IMPORTANT |

## Attention areas (requested)

### 1. History read isolation

**Current risk:** `historyForDate` for today/future calls `materializeForDate`, which can insert/reactivate/rewrite unstarted occurrences inside a write transaction. That conflicts with D-033 and AT6’s before/after DB snapshot requirement.

**Contract:** Deliberately replace today/future History materialization with stored-evidence queries only. Execution/fixture paths remain the only generators. Empty dates stay empty (not “missed obligations”). Future dates are rejected or redirected to Preview — not execution History. Compatibility: keep `?date=` one-day semantics or document a mapping for all internal consumers.

**Evidence obligation:** AT6 (no writes on read), AT7 (honest Complete/Incomplete + evidence), AT8 (URL/isolation), AT12 (no rematerialization of erased pre-floor dates via History).

Ordinary Engineering choices: query shapes for summary vs detail, whether today returns only already-persisted rows that Today materialization previously created, and filter-option endpoints.

### 2. Receipt ownership during clearing

**Current risk:** Checklist `mutation_receipts` have no household/occurrence FK; `response_json` embeds full occurrence snapshots. A naïve `DELETE FROM mutation_receipts` would destroy other households and break unrelated replay. `structure_mutation_receipts` are also unscoped by household_id but **must be preserved** (configuration receipts). Display-name string matching is forbidden by the brief.

**Contract:** Inventory all SQL/JSON references (AT10). Delete only target-household checklist receipts using **verified linkage or a forward ownership backfill**; keep structure/routine/calendar/personal-task/reset audit receipts; no hidden copy of erased step content in the reset audit; FK check clean after clear.

**Evidence obligation:** AT10 two-household table inventory; AT11 injective failure before reset receipt (graph/generation/floor/receipt roll back together).

Ordinary Engineering choices: migrate `household_id` (and optionally `occurrence_id`) onto checklist receipts with a one-time JSON/occurrence join backfill vs delete-by-occurrence-id set computed inside the clear transaction; exact reset-audit schema.

### 3. Reset / outbox recovery

**Current risk:** Durable `occurrenceSnapshot` + `retainPendingOmittedOccurrences` correctly keep omitted cards **within** a generation. Without an activity generation fence, a clear followed by rematerialized work could let old outbox/replay resurrect erased cards, apply old taps to new IDs, or treat calendar omission as reset.

**Contract:** Monotonic household activity generation (initial 0); commands/reads/session expose it; validate generation **before** receipt replay/write; old generation → distinct recoverable rejection, no report/lock/receipt; on newer generation, atomically retire **this membership’s** older pending/retrying/rejected items + snapshots, clear overlays, re-read Today, show dismissible explanation; reconnect/visibility/session establish generation before flush; B filtered-omit retention still passes **same-generation**.

**Evidence obligation:** AT11 races; AT12 rematerialization + floor; AT13 multi-context offline clear; AT14 missed/late/duplicate/legacy-zero recovery. Never infer reset from missing rows alone.

Ordinary Engineering choices: where generation lives (households column vs side table), sync resource name for reset invalidation, exact client error code/copy, IndexedDB migration for legacy outbox without generation.

## Ordinary implementation choices (Engineering will make if authorized)

1. SQL/column names for profile fields, household order + order version, activity generation, reset floor, reset audit/receipt.
2. Route spellings under `/api/v1` for profile update, order save, History summary/detail/evidence, clear command; History URL family `/household/history`.
3. Checklist receipt ownership strategy (forward backfill vs transactional delete-by-verified-occurrence set) within the brief’s “verified linkage or backfill” rule.
4. Module split for History query helpers, reset transaction, and client generation/outbox retirement without unrelated rewrites.
5. Exact `ALLOW_EVALUATION_HISTORY_CLEAR` wiring in `config.ts` / `.env.example` / meta advertisement (harmless availability metadata; server enforces grant ∧ setting).
6. Playwright: add C desktop specs to `chromium-desktop` `testMatch`; through-009 fixture layout; test-only injectable clear failure hook analogous to B’s calendar reconcile hook.

## Acceptance-test / regression notes

- AT1–17 are all required; UI journeys use ordinary UI for demonstrated writes; API for authority/race/isolation.
- Preserve P0-001–P0-006B protected behaviors except the intentional History read-only refinement and authorized reset.
- Extend route-policy inventory, protected-behaviors catalog, and sync matrix for profile/order/history/clear.
- New screenshots only under `reports/p0-006c-r1-screenshots/`; A/B (and earlier) dirs zero-diff.
- Destructive clear tests only on isolated/disposable DBs — never Project Lead `runtime/dev.sqlite` or hosted.
- Build Report must map each AT to evidence, record receipt-ownership and generation strategies, actual base commit, and NOT RUN items (hosted/physical out of scope).

## Material risks (not disposition changers)

1. **History/materialize decoupling** — highest correctness risk for AT6; treat as a first-class store contract change, not a late UI tweak.
2. **Unscoped checklist receipts** — AT10/AT11 hinge on a correct ownership inventory; fixture must include multi-household receipt JSON.
3. **Generation vs omit retention** — client must distinguish reset from B calendar omission; wrong inference would drop legitimate pending cards or resurrect ghosts (AT13/AT14).
4. **Claim + order + version** — existing claim without `version++` must be brought into the profile/order concurrency model without breaking enrollment UX (AT2/AT5).
5. **Evidence volume** — through-009 fixture + dual-browser reset journeys + desktop `testMatch` are critical path; brief checkpoints are advisory, not permission to ship API-only.

## Consolidated findings

| Severity | Item |
| --- | --- |
| BLOCKER | None |
| QUESTION | None — profile vs login, History side effects, retention table, generation fence, and grant/env dual gate are specified in the brief and D-032–D-034 |
| IMPORTANT | Add membership profile fields + saved family order with structure.manage, order version, and claim-safe preservation |
| IMPORTANT | Make **all** History reads side-effect-free; compact summaries + stored evidence detail; saved `/household/history` URLs |
| IMPORTANT | Inventory and scope checklist `mutation_receipts` deletion by verified household ownership (backfill or linkage); preserve configuration receipts |
| IMPORTANT | Atomic clear: activity graph + generation + floor + reset receipt; rematerialize only ≥ floor with fresh IDs |
| IMPORTANT | Generation-fenced outbox retirement with visible explanation; keep same-generation B omit retention |
| IMPORTANT | `household.activity.clear` + manager backfill from shared.manage; env default off for hosted / on for dev-test; Settings Data & testing UI |
| IMPORTANT | Through-009 populated fixture; AT1–17 evidence including multi-context Chromium/WebKit reset; include C specs in desktop project; prior screenshots unchanged |
| NOTE | Brief’s write-time base `de552ab` is the B merge; review tip is planning commit `c2de2e9` on the C branch |
| NOTE | Exact SQL/route/sync-resource/ownership-backfill/module names are Engineering discretion within the brief boundary |
| NOTE | Project Lead owns Git; suggest commit messages only; no commit/push/deploy from this review |

## Suggested commit message (readiness report only; do not commit)

```
P0-006C: record r1 Engineering readiness as READY

Repository-grounded review against C planning tip c2de2e9
(B merge de552ab); implementation awaits Architecture disposition.
```
