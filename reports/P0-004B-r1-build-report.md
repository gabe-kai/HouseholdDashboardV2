# Build Report - BRIEF P0-004B r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (FIX REQUIRED resolved)  
**Branch:** `brief/p0-004b-group-backed-morning-routine`  
**Base:** `main` @ `9feec29`  
**Commits:** Implementation tip includes `116e345` (initial r1) and `89e9b8b` (prior correction attempt); FIX REQUIRED completion is **uncommitted** at this report authoring  
**Pull request:** N/A  

## Readiness

**READY** against r1; Architecture **ACCEPT / PROCEED**, then **FIX REQUIRED** against the same r1 (no contract change). This report covers the FIX REQUIRED corrections on the same revision.

## What changed (r1 + FIX REQUIRED)

### Original r1
- Migration `004_group_backed_morning_routine.sql`: dated membership versions, `revision_group_sources`, routine mutation receipts, group tombstones.
- Domain resolver, store source/replay/guards, Routine compact summary + focused picker, People & Groups used-by / next-day feedback, PB-21–24.

### FIX REQUIRED corrections
- **Household-local baseline dates:** SQL no longer uses UTC `substr(created_at)`; `backfillGroupMembershipBaselines` (migrate hook + repair) sets version-1 `effective_date` via `householdDateFromInstant(..., household.timezone)`. Regression: near-midnight America/New_York case where UTC date is the next calendar day.
- **Today vs tomorrow participation:** `GroupPublic.effectiveMembershipIds` + `membershipPendingFromDate`; revision `upcomingResolvedMemberIds` / `upcomingParticipationFromDate`. Routine summary/picker labels today’s effective members and separately labels configured changes that start on a future household date (`Starting YYYY-MM-DD…`).
- **Focused realtime e2e:** Dual authorized contexts (group detail + Routine summary) converge without reload on Routine-source assign and on group membership edit.
- **Hygiene:** Restored incidental binary drift under `reports/p0-004a-r3-screenshots/` (clean vs HEAD).
- Routine editor chooses the next free revision effective date when tomorrow is already occupied (keeps AT gates green across ordered e2e).

## Behavior delivered

Parents can assign Morning Routine to named groups, see today’s effective participants distinctly from tomorrow’s pending membership, maintain participation by editing the group once, and see open Routine/group views converge without reload. Migration baselines resolve current membership on the household-local creation date even when that instant’s UTC calendar day differs.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run validate` | **PASS** (Vitest **71** / 18 files) |
| `npm run validate:pr` | **PASS** — Chromium e2e **17/17** |
| `npm run validate:rc` | **PASS** — Chromium+WebKit e2e **34/34** |
| Hosted / physical device | **NOT RUN** — not required unless Project Lead promotes this exact commit as an RC |

### Product screenshots (fictional data, phone width)

| File | Evidence |
| --- | --- |
| `reports/p0-004b-r1-screenshots/01-compact-summary.png` | Compact `Who does this routine?` |
| `reports/p0-004b-r1-screenshots/02-focused-picker.png` | Focused picker with Today / pending group labels |
| `reports/p0-004b-r1-screenshots/03-selected-group-summary.png` | The Boys + `2 people unique today` |
| `reports/p0-004b-r1-screenshots/04-used-group-detail.png` | `Used by Morning Routine` |
| `reports/p0-004b-r1-screenshots/05-pending-next-day.png` | Pending next-day membership feedback |

## Acceptance tests 1–16

| AT | Result | Evidence |
| --- | --- | --- |
| 1 Migration / compatibility | **PASS (corrected)** | Household-local baseline backfill + near-midnight TZ regression in `p0-004b.test.ts`; idempotent migrate |
| 2 Source persistence + replay | **PASS** | Integration group+direct + mutationId replay |
| 3 Phone configuration journey | **PASS** | e2e phone journey; screenshots 01–03 |
| 4 Occurrence result | **PASS** | Integration materialize unique members |
| 5 Redundant / overlapping sources | **PASS** | Domain normalize + picker Included-through |
| 6 Later-created overlap | **PASS** | Integration preserves direct until deliberate save |
| 7 Next-day add + future materialize | **PASS** | Integration + e2e pending copy |
| 8 Next-day removal + retained rows | **PASS** | Integration retained row + status fail |
| 9 Execution boundary | **PASS** | Future status reject; current succeeds |
| 10 Multiple same-day group edits | **PASS** | Greatest-version unit + integration |
| 11 Empty group + rename | **PASS (mixed)** | Empty-source integration; rename-only skips membership version |
| 12 Delete protection + tombstone | **PASS** | Referenced delete blocked; tombstone + name reuse |
| 13 Auth / access / isolation | **PASS (reused)** | Prior grant/isolation suites + pending selectable |
| 14 Realtime / missed-event recovery | **PASS (corrected)** | New dual-context e2e in `z-group-backed-routine.spec.ts` (source assign + membership change); prior reconnect/visibility suites remain green |
| 15 Accessibility + Product evidence | **PASS** | Phone Chromium+WebKit; screenshots 01–05 |
| 16 Regression gates | **PASS** | `validate` / `validate:pr` / `validate:rc` exact PASS as above |

### FIX REQUIRED evidence map

| Correction | Evidence |
| --- | --- |
| Household-local migration baselines | `src/server/backfill-group-membership.ts`; migrate hook in `db.ts`; integration “near UTC midnight” |
| Today vs tomorrow in Routine UI/API | `effectiveMembershipIds` / `membershipPendingFromDate`; `upcomingResolvedMemberIds` / `upcomingParticipationFromDate`; RoutineEditor labels; integration “keeps today effective members distinct…” |
| Focused realtime dual-view | e2e “open Routine and group views converge…” |
| No p0-004a screenshot drift | `reports/p0-004a-r3-screenshots/` matches HEAD (not in dirty tree) |

### New vs reused evidence

**New (FIX REQUIRED):** TZ baseline backfill/repair; today/upcoming participation fields; dual-view 004B realtime e2e; updated screenshots.  
**Reused:** Prior r1 suites; P0-001/002/003/004A gates under validate:rc.

## Deviations from brief revision

- None material. Routine-source half of the dual-view e2e assigns via API on the next free effective date while both UIs stay open (proves invalidation/convergence); membership half is full UI.

## Discoveries for Architecture

- UTC `substr(created_at, 1, 10)` baselines are wrong for non-UTC households near midnight; household-local instant formatting is required.
- Presenting live configured group members as “current” Routine participation without an effective-date line is misleading after a same-day membership edit.

## Known limitations

- P0-005 / rotation / nested groups remain out of scope.
- Hosted/physical RC evidence not collected for this commit.

## Suggested follow-up

Architecture re-acceptance of r1 after FIX REQUIRED. Commit the uncommitted correction set (message below). Optional PR Actions run for CI confirmation.

## Suggested commit message

```
P0-004B: fix baseline TZ, today/upcoming summary, and realtime e2e

Use household-local migration baselines, distinguish pending group
membership in Routine UI, and prove dual-view sync without reload.
```
