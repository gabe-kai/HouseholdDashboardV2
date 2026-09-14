# Build Report - BRIEF P0-005 r2

**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED  
**Branch:** `brief/p0-005-multiple-household-routines`  
**Base:** r2 authorize `ea89035` atop planning `7704785`; multi-routine r1 `cd887e9` / `2f37485`; integrated `main` `93ef494`  
**Implementation commits:** **uncommitted** at this report authoring (Project Lead manages Git)  
**Pull request:** N/A  

## Readiness

**READY** against r2 (`reports/P0-005-r2-engineering-readiness.md`); Architecture **ACCEPT / PROCEED** for local implementation. This report covers the D-023 structural-lock / same-date refine delta only. r1 readiness and Build Report do not certify r2.

## What changed

### Persistence / migration
- `db/migrations/006_occurrence_structural_lock.sql`: `occurrences.started_at` plus backfill from locking `step_reports` (`completed` / `not_needed`).
- Migration count expectations updated through 006 (`p0-003-migration`, fixture checks).

### Domain / store / API
- `src/domain/occurrence-lock.ts` (+ tests): locking first-action statuses; monotonic started marker.
- `OccurrenceView.startedAt` on the wire (`src/shared/schemas.ts`).
- `createRevision`: default **today**; explicit intended date upserts without next-free drift; same txn reconciles **unstarted** occurrences for that date; started rows stay frozen.
- `setStepStatus`: locking statuses set `started_at = COALESCE(...)` inside the writer transaction (re-read for race safety); undo never clears the lock.
- Per definition × membership × date divergence for group-backed peers.
- Personal-layer effective-date floor remains tomorrow (unchanged P0-002 / group next-day semantics; not conflated with shared revise absorb).

### Client
- `mergeAuthoritativeOccurrence` / `hasPendingFirstAction`: pending locking outbox intent keeps local structure on Today refresh (`App.tsx` + `outboxRef`).
- Routines edit save targets `effectiveDate: today`; status/feedback prefer the intended-date revision (not latest future); same-day copy names who updated vs already started when Today is readable.
- Removed unused client `nextFreeRevisionDate` helper from `Routines.tsx`.

### Evidence / docs
- AT19 (+ race orderings) in `tests/integration/p0-005.test.ts`.
- New r2 screenshots only under `reports/p0-005-r2-screenshots/`.
- **Evidence hygiene:** prior screenshot directories `reports/p0-004a-r3-screenshots/`, `reports/p0-004b-r1-screenshots/`, and `reports/p0-005-r1-screenshots/` were restored to their committed HEAD versions. Regression e2e no longer rewrites those prior PNGs; behavioral asserts remain.
- PB-28 + sync-matrix rows for revise/status lock semantics; ops note for 006; factual ARCHITECTURE / PROJECT_STATE / brief status updates.
- Shared e2e hardening: Origin on Morning bootstrap; Kids conflict tolerance.

## Behavior delivered

Parents can refine an unstarted routine for **today** (or an explicit intended date via API) without date drift. The first committed locking checklist action freezes that person’s occurrence; undo does not unlock. Group peers may diverge on the same routine/date. A pending locking outbox action protects local structure across refresh/reconnect. Prior multi-routine, archive, group next-day, and P0-001–004B regressions remain under PR/RC gates.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate` (via `validate:pr`) | **PASS** — lint + typecheck + Vitest **90** tests / **21** files |
| `npm run validate:pr` (post evidence-hygiene) | **PASS** — Chromium e2e **19/19**; prior screenshot dirs remain clean vs HEAD |
| `npm run validate:rc` | **PASS** (pre-hygiene run) — Chromium+WebKit e2e **38/38**; behavior unchanged by screenshot restore |
| Hosted / physical device | **NOT RUN** — not required for implementation |

### Product screenshots (fictional data, phone width 390×844)

| File | Evidence |
| --- | --- |
| `reports/p0-005-r2-screenshots/01-same-day-edit-list.png` | List shows same-day renamed title after save |
| `reports/p0-005-r2-screenshots/02-same-day-edit-detail.png` | Detail Active today with updated steps/obligations |

Prior brief screenshot directories (`p0-004a-r3`, `p0-004b-r1`, `p0-005-r1`) remain at their committed contents and are not rewritten by r2 validation.

## Acceptance tests 1–19

| AT | Result | Evidence |
| --- | --- | --- |
| 1 Populated migration | **PASS** | Prior P0-005 fixture + 006 migration count |
| 2 Migration safety | **PASS** | Idempotent migrate; backup→migrate→restore rehearsal |
| 3 Phone creation journey | **PASS** | e2e `z-multiple-routines` (+ Origin bootstrap fix) |
| 4 Independent occurrences/completion | **PASS** | Integration multi-definition completion |
| 5 Independent revisions/dates | **PASS (r2-adapted)** | Same-intended-date upsert (no +1/+2 drift); future labels retained where future revisions exist |
| 6 Weekly/daypart rules | **PASS (partial reuse)** | Daypart unit + prior schedule evidence |
| 7 Group propagation | **PASS** | P0-004B + e2e; group next-day unchanged |
| 8 Future rows / immutable history | **PASS** | Started/history frozen; unstarted may absorb |
| 9 Personal isolation | **PASS** | Definition-scoped layers/proposals retained |
| 10 Open proposal/preview journey | **PASS (reused)** | Prior proposal-status e2e |
| 11 Archive | **PASS** | Integration + UI archive |
| 12 Reference lifecycle | **PASS** | Dual-routine delete protection |
| 13 HTTP authority/isolation | **PASS** | Prior HTTP matrix |
| 14 Replay / concurrent edits | **PASS** | mutationId replay retained |
| 15 Multi-context invalidation | **PASS** | Dual-view / sync suites |
| 16 Recovery / execution regression | **PASS** | Reconnect/outbox/visibility under validate:rc; merge protects pending first action |
| 17 Phone/keyboard evidence | **PASS** | Chromium + WebKit; new r2 screenshots 01–02 only (prior brief PNGs preserved at HEAD) |
| 18 Repository gates | **PASS** | Exact `validate:pr` / `validate:rc` |
| 19 Execution-start structural lock | **PASS** | See AT19 map below |

### AT19 evidence map

| Requirement | Evidence |
| --- | --- |
| Same-day / same-intended-date refine while unstarted | Integration AT19; e2e same-day rename/steps; store upsert |
| Lock on first valid action (complete / as-needed complete / Not needed) | `occurrence-lock` unit; AT19 complete; race test Not needed |
| Undo does not unlock | Integration AT19 |
| Group-backed peer divergence | Integration AT19 (Avery vs Jordan) |
| Deliberate future date refine (no drift) | Integration AT19 tomorrow upsert×2 → single revision |
| Pending first-execution outbox protection | `reconcile.test.ts` mergeAuthoritative; App refresh uses pending commands |
| Reconnect / stale structural refresh | Existing reconnect/visibility e2e (PB-06) + merge guard on refresh |
| Edit ↔ first-action race (no mixed snapshot) | Integration race orderings A/B; in-txn `started_at` re-read + same-txn revise reconcile |

## Migration and compatibility findings

1. **006 backfill:** Existing occurrences with locking reports receive `started_at` so history does not reopen for structure edits.
2. **Same-date upsert:** Replaces the shared revision at `(definition_id, effective_date)` rather than drifting; started occurrence rows are not rewritten.
3. **004B tests:** Prospective group/routine cases that still need tomorrow semantics must pass explicit `effectiveDate: tomorrow` (updated).
4. **UI vs API:** Editor defaults edits to today; API still accepts an explicit future intended date for deliberate future refine.

## Deviations from brief revision

- Routines editor does not yet expose a future intended-date picker; deliberate future refine is covered via API/integration. Default today matches the primary r2 correction path.
- Named save feedback is best-effort from a post-save Today read; if that read fails, generic household copy remains.

## Discoveries for Architecture

- Pre-existing future revisions on a definition can make “latest revision” feedback misleading after a same-day upsert; feedback must select the **intended** effective date.
- Shared e2e SQLite state can collide on fixed group names (`Kids`); conflict-tolerant setup avoids false P0-005 failures.

## Known limitations

- Archive remains one-way (no restore).
- Personal-layer effective dates remain tomorrow-floored (not part of D-023 shared revise absorb).
- Hosted/physical RC evidence not collected.
- Implementation remains uncommitted pending Project Lead Git.

## FIX REQUIRED

None remaining against the r2 contract.

**Evidence-hygiene correction (Architecture withhold):** prior screenshot PNGs under `p0-004a-r3`, `p0-004b-r1`, and `p0-005-r1` were restored to committed HEAD; regression e2e no longer overwrites them. Only `reports/p0-005-r2-screenshots/` is new r2 visual evidence.

## Suggested follow-up

1. Architecture technical acceptance of this Build Report.
2. Project Lead commit / PR when authorized.
3. Optional later: editor control for deliberate future intended date; richer refine receipt (`updated` / `protected` member IDs) from the revision API.

## Suggested commit message

```
P0-005 r2: lock occurrence structure on first action

Allow same-day refine for unstarted checklists, freeze started
members independently, and protect pending first-action outbox.
```
