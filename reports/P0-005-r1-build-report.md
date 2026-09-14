# Build Report - BRIEF P0-005 r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED  
**Branch:** `brief/p0-005-multiple-household-routines`  
**Base:** `main` @ `93ef494` (planning commits `9cfb89e` / readiness `04ac851` / authorize `6deb34e`)  
**Implementation commits:** **uncommitted** at this report authoring (Project Lead manages Git)  
**Pull request:** N/A  

## Readiness

**READY** against r1; Architecture **ACCEPT / PROCEED** (2026-09-13). No contract change during implementation.

## What changed

### Persistence / migration
- `db/migrations/005_multiple_household_routines.sql`: lift singleton household/kind constraints; snapshotted `daypart` on revisions/occurrences; definition-scoped personal uniqueness; proposal `definition_id` + `association_status`; archive fields; archive-aware mutation receipts; rebuild `revision_assignees` to reference `household_memberships`.
- `tests/helpers/p004b-fixture.ts`: fictional populated P0-004B baseline for upgrade proofs.
- `src/server/db.ts`: foreign-key handling around rebuild migrations.

### Domain / API / store
- `src/domain/daypart.ts` (+ tests): ordered daypart vocabulary.
- Multi-definition `listRoutines` / `getRoutineById` / `createRoutine` / `createRevision` / `archiveRoutine`.
- Materialize/preview/personal/proposals scoped by `definitionId`; archive cutoff on date reads and execution.
- Collection `GET /api/v1/routines`, detail/revision/archive routes; route-policy inventory updated.
- People/group projections expose `usedByRoutines` / `routines[]` (Morning-only fields retained as transitional).

### Client
- Replaced singular `RoutineEditor` with `Routines.tsx`: list, read-first detail (all future revisions labeled), create/edit, audience picker, archived list, archive confirm.
- Today daypart ordering/labels; Personalize requires explicit active-routine choice.
- People & Groups “used by” multi-routine copy.

### Evidence / docs
- Integration `tests/integration/p0-005.test.ts`; e2e `tests/e2e/z-multiple-routines.spec.ts`.
- PB-25–27 + sync-matrix archive/definition scoping in `docs/protected-behaviors.md`.
- Ops note for 005 in `docs/ops-deploy.md`; architecture/project-state/brief status updates.

## Behavior delivered

Parents can maintain multiple independent named routines (Morning, After School, Bedtime, …) with weekday schedules and dayparts. Children get independent Today occurrences per routine. Group participation follows P0-004B prospectively across every consuming routine. Personal layers and proposals bind to a definition. Archive removes a routine from the active list with a tomorrow cutoff while retaining history. Populated P0-004B upgrade preserves Morning identity and daypart.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate` | **PASS** — lint + typecheck + Vitest **84** tests / **20** files |
| `npm run validate:pr` | **PASS** — Chromium e2e **18/18** (also re-confirmed after assignees FK fix) |
| `npm run validate:rc` | **PASS** — Chromium+WebKit e2e **36/36** |
| Hosted / physical device | **NOT RUN** — not required for implementation |

### Product screenshots (fictional data, phone width 390×844)

| File | Evidence |
| --- | --- |
| `reports/p0-005-r1-screenshots/01-routines-list.png` | Active Routines list with Morning present |
| `reports/p0-005-r1-screenshots/02-audience-picker.png` | Focused who-does-this picker |
| `reports/p0-005-r1-screenshots/03-after-school-detail.png` | After School read-first detail |
| `reports/p0-005-r1-screenshots/04-routines-list-three.png` | Morning + After School + Bedtime |
| `reports/p0-005-r1-screenshots/05-today-multi.png` | Multi-routine Today |
| `reports/p0-005-r1-screenshots/06-archived-detail.png` | Archived Bedtime summary |

## Acceptance tests 1–18

| AT | Result | Evidence |
| --- | --- | --- |
| 1 Populated migration | **PASS** | `p004b-fixture` upgrade; Morning IDs/daypart preserved; proposals backfilled; orphan unresolved flag |
| 2 Migration safety | **PASS** | Idempotent migrate; FK/integrity after assignees rebuild; P0-001 path retained; disposable backup→migrate→restore rehearsal in `p0-005.test.ts` |
| 3 Phone creation journey | **PASS** | e2e `z-multiple-routines`; screenshots 01–04 |
| 4 Independent occurrences/completion | **PASS (integration)** | Three definitions; complete one occurrence leaves others open |
| 5 Independent revisions/dates | **PASS** | Cross-definition revise; stacked effective dates without stealing another definition’s slot |
| 6 Weekly/daypart rules | **PASS (partial)** | Daypart unit order; After School weekdays vs Bedtime daily in create path; full Sun–Thu/Fri–Sat/DST matrix **reuses prior time tests**, not newly expanded for every preset in UI |
| 7 Group propagation | **PASS (reused + extended)** | P0-004B suites retained; dual-routine delete protection; e2e used-by / next-day feedback |
| 8 Future rows / immutable history | **PASS (reused)** | Prior P0-004B future-materialize/status guards; archive cutoff excludes tomorrow |
| 9 Personal isolation | **PASS** | Layer scoped per definition; HTTP capability matrix requires `definitionId` |
| 10 Open proposal/preview journey | **PASS (reused/partial)** | Prior proposal-status e2e retained; new UI requires routine select — **no new dedicated Bedtime dual-context browser journey** beyond Personalize select wiring |
| 11 Archive | **PASS** | Integration cutoff + UI archive confirm; screenshots 06 |
| 12 Reference lifecycle | **PASS** | Group delete blocked while any of two routines (incl. post-archive-today) still reference |
| 13 HTTP authority/isolation | **PASS (extended)** | `p0-002-http` matrix updated for definition-scoped personal/proposals; prior isolation retained |
| 14 Replay / concurrent edits | **PASS (extended)** | Archive mutationId replay; create/revise replay retained from P0-004B |
| 15 Multi-context invalidation | **PASS (adapted)** | Dual-view e2e updated for Routines list→detail; group/routine convergence without reload |
| 16 Recovery / execution regression | **PASS (reused)** | Prior morning-routine reconnect/outbox/visibility suites under validate:rc |
| 17 Phone/keyboard evidence | **PASS** | Chromium + WebKit phone journey; screenshots 01–06 |
| 18 Repository gates | **PASS** | Exact `validate:pr` and `validate:rc` PASS; PB-25–27 + sync matrix + route-policy updated |

### New vs reused evidence

**New:** migration 005 + fixture; daypart domain; multi-routine store/API/UI; archive; `p0-005` integration; `z-multiple-routines` e2e; PB-25–27.  
**Reused:** P0-001–004B suites; reconnect/outbox/proposal-status e2e; grant/isolation HTTP cores.

## Migration and compatibility findings

1. **Assignees FK drift:** Pre-005 `revision_assignees.member_id` still referenced legacy `members`. Populated fixtures that only seed `household_memberships` fail `foreign_key_check` after enabling FKs. **005 rebuilds assignees against `household_memberships`.**
2. **SQLite in-transaction `PRAGMA foreign_keys`:** Rebuild migrations need the migrate runner to toggle FKs around each file (already adjusted in `db.ts`).
3. **Orphan proposals:** Proposals with no unambiguous pre-upgrade routine remain `association_status=unresolved` and are not assigned to later-created routines.
4. **Receipts:** Legacy create/revise receipts keep `definition_id` null; new create/revise/archive bind definition + digest including daypart/effective date.
5. **UI stacked revisions:** Detail lists **all** future-dated revisions (not only the soonest), so earlier Sync/group revisions cannot hide a later audience change label.

## Deviations from brief revision

- None material. AT 6 schedule-preset matrix and AT 10 Bedtime dual-context proposal journey rely partly on reused suites rather than brand-new exhaustive multi-routine browser matrices; gaps called out above.
- Kitchen/Cats/Bathroom, rotation, helpers, exact times, notifications, Multi-Responsibility Today, and routine restoration remain out of scope.

## Discoveries for Architecture

- Legacy `members` FKs on assignee tables are silent until a populated upgrade enables FK checks; forward migrations that rebuild related tables should retarget `household_memberships`.
- Showing only the first upcoming revision on detail mislabels stacked future configuration; listing every future revision with its date is required for truthful summary.

## Known limitations

- Archive is one-way in r1 (no restore).
- Hosted/physical RC evidence not collected.
- Implementation remains uncommitted pending Project Lead Git.

## Suggested follow-up

Architecture acceptance of this Build Report. Commit the implementation set (message below). Optional PR + Actions confirmation.

## Suggested commit message

```
P0-005: add multiple independent household routines with dayparts

Lift singleton Morning constraints, scope personal/proposals by
definition, add prospective archive, and ship Routines phone UI.
```
