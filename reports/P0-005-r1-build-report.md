# Build Report - BRIEF P0-005 r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (FIX REQUIRED resolved)  
**Branch:** `brief/p0-005-multiple-household-routines`  
**Base:** `main` @ `93ef494` (planning commits `9cfb89e` / readiness `04ac851` / authorize `6deb34e`)  
**Implementation commits:** **uncommitted** at this report authoring (Project Lead manages Git)  
**Pull request:** N/A  

## Readiness

**READY** against r1; Architecture **ACCEPT / PROCEED**, then **FIX REQUIRED** against the same r1 (no contract or data-model change). This report covers the original implementation plus the post-save discovery UX correction.

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
- Replaced singular `RoutineEditor` with `Routines.tsx`: list, read-first detail, create/edit, audience picker, archived list, archive confirm.
- Today daypart ordering/labels; Personalize requires explicit active-routine choice.
- People & Groups “used by” multi-routine copy.

### FIX REQUIRED — post-save future-revision discovery
- Save status names the saved revision title and effective household date, and states that today’s checklist is unchanged until then.
- Read-first detail labels **Active today** (title, who, today’s steps) separately from each **Starting YYYY-MM-DD** block (future title, who, full steps + obligations).
- Active Routines list keeps today’s title as the primary name and adds `Starting DATE: {future title}` for the latest future-effective revision.
- No change to revision effective-date rules, immutability of today/history, identity, audience, schedule, daypart, personalization, archive, auth, or realtime.
- Browser regression: rename + step text/obligation edit with post-save discovery assertions; screenshots `07`/`08`.
- Durable screenshot helper for Windows overwrite locks during report PNG capture.

### Evidence / docs
- Integration `tests/integration/p0-005.test.ts`; e2e `tests/e2e/z-multiple-routines.spec.ts`.
- PB-25–27 + sync-matrix archive/definition scoping in `docs/protected-behaviors.md`.
- Ops note for 005 in `docs/ops-deploy.md`; architecture/project-state/brief status updates.

## Behavior delivered

Parents can maintain multiple independent named routines with weekday schedules and dayparts. After a prospective edit, list and detail make the saved future revision (title, steps, obligations, date) visible without reopening the editor, while today’s operative configuration remains clearly labeled and unchanged. Children get independent Today occurrences per routine. Group participation follows P0-004B prospectively. Personal layers and proposals bind to a definition. Archive uses a tomorrow cutoff with retained history.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate` | **PASS** — lint + typecheck + Vitest **84** tests / **20** files |
| `npm run validate:pr` | **PASS** — Chromium e2e **19/19** |
| `npm run validate:rc` | **PASS** — Chromium+WebKit e2e **38/38** |
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
| `reports/p0-005-r1-screenshots/07-future-edit-list.png` | List shows today title + Starting DATE rename |
| `reports/p0-005-r1-screenshots/08-future-edit-detail.png` | Detail shows Active today vs Starting DATE steps |

## Acceptance tests 1–18

| AT | Result | Evidence |
| --- | --- | --- |
| 1 Populated migration | **PASS** | `p004b-fixture` upgrade; Morning IDs/daypart preserved; proposals backfilled; orphan unresolved flag |
| 2 Migration safety | **PASS** | Idempotent migrate; FK/integrity after assignees rebuild; P0-001 path retained; disposable backup→migrate→restore rehearsal |
| 3 Phone creation journey | **PASS** | e2e `z-multiple-routines`; screenshots 01–04 |
| 4 Independent occurrences/completion | **PASS (integration)** | Three definitions; complete one occurrence leaves others open |
| 5 Independent revisions/dates | **PASS** | Cross-definition revise; stacked effective dates; **FIX REQUIRED** UI discovery of future title/steps |
| 6 Weekly/daypart rules | **PASS (partial)** | Daypart unit order; After School weekdays vs Bedtime daily; schedule-preset/DST matrix reuses prior time tests |
| 7 Group propagation | **PASS (reused + extended)** | P0-004B suites; dual-routine delete protection; e2e used-by / next-day feedback |
| 8 Future rows / immutable history | **PASS** | Prior guards; archive cutoff; today steps remain immutable after future edit |
| 9 Personal isolation | **PASS** | Layer scoped per definition; HTTP matrix requires `definitionId` |
| 10 Open proposal/preview journey | **PASS (reused/partial)** | Prior proposal-status e2e retained |
| 11 Archive | **PASS** | Integration cutoff + UI archive confirm; screenshot 06 |
| 12 Reference lifecycle | **PASS** | Group delete blocked while any of two routines still reference |
| 13 HTTP authority/isolation | **PASS (extended)** | `p0-002-http` definition-scoped personal/proposals |
| 14 Replay / concurrent edits | **PASS (extended)** | Archive mutationId replay; create/revise replay retained |
| 15 Multi-context invalidation | **PASS (adapted)** | Dual-view e2e for Routines list→detail |
| 16 Recovery / execution regression | **PASS (reused)** | Prior reconnect/outbox/visibility suites under validate:rc |
| 17 Phone/keyboard evidence | **PASS** | Chromium + WebKit; screenshots 01–08 including future-edit discovery |
| 18 Repository gates | **PASS** | Exact `validate:pr` / `validate:rc` PASS after FIX REQUIRED |

### FIX REQUIRED evidence map

| Correction | Evidence |
| --- | --- |
| Post-save status names title + effective date | `Routines.tsx` save status; e2e rename journey |
| Detail distinguishes today vs future (title/steps/obligations) | `routine-upcoming` sections; screenshots 08 |
| List shows latest future title beside today | `routine-card-upcoming`; screenshot 07 |
| Browser regression for rename + step/obligation | `z-multiple-routines` “rename and step edits…” |
| Screenshot overwrite resilience | `tests/helpers/durable-screenshot.ts` |

## Migration and compatibility findings

1. **Assignees FK drift:** Pre-005 `revision_assignees.member_id` referenced legacy `members`. **005 rebuilds assignees against `household_memberships`.**
2. **SQLite in-transaction `PRAGMA foreign_keys`:** Migrate runner toggles FKs around each file.
3. **Orphan proposals:** Remain `association_status=unresolved` when no unambiguous pre-upgrade routine exists.
4. **Receipts:** Legacy create/revise receipts may keep `definition_id` null; new commands bind definition + digest.
5. **UX (FIX REQUIRED):** Emphasizing only today’s revision after a successful future save made edits appear lost; list/detail must surface the saved future revision explicitly without mutating today.

## Deviations from brief revision

- None material. AT 6 / AT 10 still partly reuse prior suites. Data model and future-effective semantics unchanged for FIX REQUIRED.

## Discoveries for Architecture

- Legacy `members` FKs fail populated FK checks until retargeted.
- Read-first surfaces that only show today’s revision after a prospective save are indistinguishable from a failed save for rename/step edits.

## Known limitations

- Archive is one-way in r1 (no restore).
- Hosted/physical RC evidence not collected.
- Implementation remains uncommitted pending Project Lead Git.

## Suggested follow-up

Architecture re-acceptance of r1 after FIX REQUIRED. Commit the uncommitted set (message below). Optional PR + Actions confirmation.

## Suggested commit message

```
P0-005: surface future-effective edits on Routines list and detail

After a prospective save, name the revision and date, keep today
labeled separately, and show upcoming title/steps without reopening edit.
```
