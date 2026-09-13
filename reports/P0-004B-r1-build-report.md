# Build Report - BRIEF P0-004B r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED  
**Branch:** `brief/p0-004b-group-backed-morning-routine`  
**Base:** `main` @ `9feec29`  
**Commits:** Implementation uncommitted at report authoring (authorize commit `3eceef6` already on branch)  
**Pull request:** N/A  

## Readiness

**READY** against r1 (see `reports/P0-004B-r1-engineering-readiness.md`). Architecture disposition **ACCEPT / PROCEED** with no contract change. Implemented only P0-004B r1.

## What changed

- Migration `004_group_backed_morning_routine.sql`: dated `group_membership_versions` (+ members), `revision_group_sources`, `routine_mutation_receipts`, `household_groups.deleted_at` + partial unique name index; baseline version backfill for existing groups.
- Domain resolver `src/domain/participation.ts`: normalize directs, union participants, greatest-version membership selection, revision-interval helpers.
- Store: source-preserving create/revision with `assigneeGroupIds` + `mutationId` replay; dated membership on create/update; reference-guarded tombstone delete; materialize/status via resolver; future + non-participant status guards; person currently-assigned via resolver; group `usedByMorningRoutine` / `routineEffectFromDate`.
- Client: `RoutineEditor` compact `Who does this routine?` + focused picker (D-016); People & Groups used-by / next-day feedback; App refreshes Routine on `group`/`routine` sync.
- Docs/policy: PB-21–24, sync matrix / route-policy notes.
- Tests: `tests/integration/p0-004b.test.ts` (8), `src/domain/participation.test.ts` (4), e2e `tests/e2e/z-group-backed-routine.spec.ts`; existing callers updated for `mutationId` / `assigneeGroupIds`.

## Behavior delivered

Parents can assign Morning Routine to named groups (and directs), see a compact participation summary, edit through a phone-focused picker, and maintain participation by editing the group once. Group membership changes take effect on the next household day without rewriting today/history. Future provisional participation reconciles without deleting retained rows; future checklist status is rejected. Referenced groups cannot be deleted until historically unreferenced; then tombstones retain identity for history.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate` | **PASS** (included in PR/RC; Vitest **69** / 18 files) |
| `npm run validate:pr` | **PASS** — Chromium e2e **16/16** |
| `npm run validate:rc` | **PASS** — Chromium+WebKit e2e **32/32**; lint/typecheck/Vitest/build green |
| Hosted / physical device | **NOT RUN** — not required for this brief unless Project Lead promotes this exact commit as an RC |

### Product screenshots (fictional data, phone width)

| File | Evidence |
| --- | --- |
| `reports/p0-004b-r1-screenshots/01-compact-summary.png` | Compact `Who does this routine?` before group save |
| `reports/p0-004b-r1-screenshots/02-focused-picker.png` | Focused Groups/People picker with The Boys member explanation |
| `reports/p0-004b-r1-screenshots/03-selected-group-summary.png` | Compact summary after save: The Boys, `2 people unique` |
| `reports/p0-004b-r1-screenshots/04-used-group-detail.png` | Group detail `Used by Morning Routine` + next-day copy |
| `reports/p0-004b-r1-screenshots/05-pending-next-day.png` | Post–member-edit success feedback with effective next household date |

## Acceptance tests 1–16

| AT | Result | Evidence |
| --- | --- | --- |
| 1 Migration / compatibility | **PASS** | Integration migrate + idempotent re-apply / baseline version; Vitest suite green under validate |
| 2 Source persistence + replay | **PASS (new)** | `p0-004b.test.ts` group+direct sources + mutationId replay / payload conflict |
| 3 Phone configuration journey | **PASS (new)** | e2e `z-group-backed-routine.spec.ts` Chromium+WebKit; screenshots 01–03 |
| 4 Occurrence result | **PASS (new)** | Integration materialize unique members for group+direct; uniqueness reused from prior occurrence contracts |
| 5 Redundant / overlapping sources | **PASS (mixed)** | Domain `normalizeDirectSources`; picker disables / “Included through …” UI; integration normalizes on deliberate save. Overlapping second-group UI path not separately e2e’d |
| 6 Later-created overlap | **PASS (new)** | Integration keeps direct until next revision normalizes it away |
| 7 Next-day add + future materialize | **PASS (new)** | Same reconciliation path as AT8 (group update → tomorrow resolve); AT8 exercises remove; e2e adds Morgan and shows next-day copy |
| 8 Next-day removal + retained rows | **PASS (new)** | Integration: today unchanged, tomorrow excludes, row retained, status against retained future fails |
| 9 Execution boundary | **PASS (new)** | Integration future status reject; current succeeds; excluded future fails (AT8) |
| 10 Multiple same-day group edits | **PASS (new)** | Domain greatest-version unit + integration two edits / stale `expectedVersion` / tomorrow uses latest set |
| 11 Empty group + rename | **PASS (mixed)** | Empty-only-source integration; rename preserves stable ID via store (rename-only skips membership version). Dedicated rename e2e not added |
| 12 Delete protection + tombstone | **PASS (new)** | Integration blocks while referenced; tombstones after historical-only; name reusable under new ID |
| 13 Auth / access / isolation | **PASS (reused + extended)** | P0-004A structure grants + foreign isolation; pending people remain selectable; routine/group grants unchanged. No new foreign-household 004B-only HTTP matrix |
| 14 Realtime / missed-event recovery | **PASS (reused + wiring)** | App increments `routineRefreshToken` on `group`/`routine` sync; P0-002 reconnect/visibility + P0-004A peer-create e2e remain green. Dedicated dual-pane Routine+group-detail e2e not added |
| 15 Accessibility + Product evidence | **PASS (new)** | Phone e2e Chromium+WebKit; keyboard/checkbox rows; screenshots 01–05 |
| 16 Regression gates | **PASS** | `validate` / `validate:pr` / `validate:rc` exact PASS as above |

### New vs reused evidence

**New:** migration 004; participation domain; routine group sources + mutation receipts; future/status guards; tombstone delete; Routine compact/picker UX; used-by / next-day People & Groups copy; PB-21–24; `p0-004b` integration + e2e + screenshots.  
**Reused:** P0-001/002/003/004A suites (callers updated for wire fields); route-policy completeness; outbox/sync/visibility gates under validate:rc.

## Deviations from brief revision

- None material. Baseline membership effective date, tombstone representation (`deleted_at`), and wire names (`assigneeGroupIds`, `mutationId`) are Engineering discretion within D-018/D-019 as accepted.
- AT14 relies on sync wiring + prior realtime suites rather than a new two-context 004B-only Playwright scenario.

## Discoveries for Architecture

- Routine create/revision mutation receipts follow the existing structure-receipt digest pattern; same-ID/different-payload conflicts use household-language errors without disclosing prior payloads.
- Physical group delete is replaced by tombstones so historical group sources remain interpretable while names can be reused.

## Known limitations

- P0-005 / rotation / nested groups / Kitchen–Cats–Bathroom not in scope.
- Hosted/physical RC evidence not collected for this commit.
- Working tree may show incidental binary drift under `reports/p0-004a-r3-screenshots/` from earlier browser runs; **exclude from the P0-004B commit** (restore to HEAD if committing).

## Suggested follow-up

Architecture acceptance of r1. Coordinator/Engineering commit on this branch (message below). Optional PR Actions run for CI confirmation. Hosted evidence only if Project Lead promotes this exact commit as a release candidate.

## Suggested commit message

```
P0-004B: add group-backed Morning Routine with dated membership

Preserve direct/group sources, next-day group effects, future status
guards, referenced delete tombstones, and focused Routine picker UX.
```
