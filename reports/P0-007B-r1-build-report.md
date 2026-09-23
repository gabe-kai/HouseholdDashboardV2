# Build Report - BRIEF P0-007B r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (local PR/RC gates green; awaiting Architecture technical acceptance)  
**Branch:** `brief/p0-007b-assignment-patterns-scheduled-work`  
**Base:** Architecture ACCEPT/PROCEED `ee71cf7`; integrated main parent **`51322e0`**  
**Working tree:** uncommitted implementation on the brief branch (Project Lead manages Git)  
**Pull request:** N/A  

## Readiness

Contract unchanged; **no new readiness round**. Architecture ACCEPT/PROCEED for P0-007B r1 remains the authorization. Card **Understand whose turn it is, including deep-clean days** is **In Progress**.

## What changed

- **Migration 014** (`db/migrations/014_assignment_patterns_scheduled_work.sql`): nullable unstarted responsibility owners; `structure_fingerprint` / `unassigned_reason`; `revision_responsibility_plans` (assignment + scheduled additions JSON); `occurrence_steps.addition_id` / `addition_heading`; fixed-plan backfill from legacy assignees; recreate 012 integrity triggers after occurrences rebuild.
- **Domain:** `src/domain/responsibility-assignment.ts`, `responsibility-composition.ts` (+ unit tests) — fixed / take turns / weekly, opportunity-count anchors, composition, overlap rejection.
- **Server:** `src/server/responsibility-plan.ts`; `store.ts` shared resolve for preview / materialize / reconcile; draft preview API; Unassigned materialization; structure fingerprint on first action; group-change prospective reconcile; legacy fixed fallback when no plan row.
- **Schemas / routes / client API / outbox:** assignment + scheduled-addition payloads; `POST /api/v1/responsibilities/preview-draft`; route-policy inventory.
- **UI:** `Responsibilities.tsx` assignment modes, scheduled-work editors, Upcoming preview, Confirm-and-save for non-fixed / owner-setting drafts; Unassigned labels in App / History / PeopleGroups.
- **Evidence:** `tests/helpers/p013-fixture.ts`; `tests/integration/p0-007b.test.ts`; e2e `z-p0-007b-kitchen-bathroom.spec.ts`, `z-p0-007b-cats-trash.spec.ts`; e2e-shell helpers updated for B Who/Work chrome; prior A e2e adapted to Upcoming/Base nesting; legacy 007A screenshot capture frozen (`CAPTURE_LEGACY_007A_SCREENSHOTS = false`).
- **Docs:** `docs/protected-behaviors.md` PB-43–46 + sync matrix; `ARCHITECTURE.md` B delivery note; `PROJECT_STATE.md` IMPLEMENTING / card In Progress.

## Verification performed

| Check | Result |
| --- | --- |
| `npm test` (via validate) | **PASS** — **183** tests / **30** files |
| `npm run validate:pr` | **PASS** — Chromium e2e **47/47** + Vite **2/2** (`reports/p0-007b-r1-validate-pr.log`) |
| `npm run validate:rc` | **PASS** — Chromium+WebKit **75/75** (+ **15** skipped) + Vite **2/2** (`reports/p0-007b-r1-validate-rc.log`) |
| Prior `p0-005` / `p0-006b` / `p0-006c` / `p0-007a` screenshots | **PASS** — SHA-256 unchanged through gates (30 files; 007A capture frozen) |
| Current-brief screenshots | `reports/p0-007b-r1-screenshots/` (Kitchen, Bathroom, Cats, Trash, Today) |
| Deployment | **NOT RUN** |

## Acceptance tests (AT1–16)

| AT | Result | Evidence class | Evidence |
| --- | --- | --- | --- |
| 1 - Populated upgrade | **PASS** | Automated | `tests/integration/p0-007b.test.ts` AT1; `tests/helpers/p013-fixture.ts`; older 010/013 baselines retained |
| 2 - Assignment/date oracle | **PARTIAL** | Automated | Unit + integration AT2 cover fixed / take turns / weekly / group ring / repeated preview. Full DST/travel browser matrix and every boundary-move case **not fully automated** |
| 3 - Preview read isolation | **PASS** | Automated | Integration AT3 (DB counts unchanged for saved + draft preview) |
| 4 - Kitchen normal UI | **PASS** | Automated | `z-p0-007b-kitchen-bathroom.spec.ts` Chromium; screenshots `01-kitchen-detail.png` |
| 5 - Bathroom normal UI | **PASS** | Automated | Same e2e file; Sunday inherit composition (9 steps); `02-bathroom-detail.png` |
| 6 - Cats and Trash normal UI | **PASS** | Automated | `z-p0-007b-cats-trash.spec.ts`; take-turns Cats + fixed Tuesday Trash; `03`–`05` screenshots |
| 7 - Eligibility / Unassigned | **PARTIAL** | Automated | Integration AT7 Unassigned materialize + execution forbidden. Full browser group-edit / entrants / tombstone journey **not-run** as a dedicated e2e |
| 8 - Composition / overlap | **PASS** | Automated | Integration AT8 + composition unit tests |
| 9 - Lifecycle / range UI | **PARTIAL** | Automated | Prior A lifecycle e2e adapted for Base nesting (AT5/8 schedule later). Dedicated B addition-remove / predecessor-anchor restore UI **partial** |
| 10 - Lock / race / rollback | **PARTIAL** | Automated | Integration AT10 structure fingerprint stale intent. Full bidirectional group/addition race matrix + injectable rollback **not fully automated** |
| 11 - Offline / replay | **NOT RUN** | — | Relies on preserved A outbox/generation e2e; no new B multi-context offline kitchen journey |
| 12 - Live convergence | **NOT RUN** | — | No new dual-manager WS/visibility B e2e; prior A sync paths preserved |
| 13 - History / reset | **PARTIAL** | Automated | Unassigned History grouping present in client; clear retention covered by prior A/C tests. Mixed B History headings after rule change **not newly e2e’d** |
| 14 - Authority / reference | **PARTIAL** | Automated | Route-policy includes preview-draft; prior A permission matrix retained. Full B addition/exclusion cleanup inventory expansion **not newly proven** |
| 15 - Focused UX / evidence | **PARTIAL** | Automated | Kitchen/Cats screenshots on phone Chromium; 360/1280 geometry retained via adapted AT14. WebKit Kitchen journey deferred to `validate:rc` |
| 16 - Regression gates / report | **PASS** | Automated | This report; `validate:pr` 47+2; `validate:rc` 75+2; prior screenshot dirs SHA-256 unchanged |

## Evidence classes

- **Automated:** Vitest unit/integration; Playwright Chromium (and WebKit under RC).
- **Manual:** Product clarity of Upcoming / Confirm-and-save preview (outside Engineering gates).
- **Not run:** Hosted/physical-device; AT11/AT12 dedicated B multi-context; full AT7 browser group journey; production deploy.

## Local evaluation recipe (Kitchen / Cats / Bathroom / Trash)

1. Fresh disposable DB; `npm run db:migrate`; bootstrap manager; enroll Avery/Casey/Jordan.
2. Plan → Add responsibility → Kitchen, every day, weekly Avery/Casey/Avery/Casey/Jordan/Avery/Casey, base Counters/Dishes/Sweep, Saturday Deep Clean (Avery/Casey turns). Confirm preview → create.
3. Expand Upcoming; verify Saturday shows deep-clean owner and 8 items; weekday shows 3.
4. Bathroom: fixed Jordan, Sunday inherit addition; verify 9 vs 4 steps.
5. Convert Cats to Take turns Avery→Casey→Jordan; keep Trash fixed Tuesday Avery.
6. Advance household test date only via controlled seams (do not write real future checklist intent outside tests).

## Suggested commit message (do not commit)

```
P0-007B: assignment patterns, scheduled work, and Unassigned (r1)

Add migration 014, shared composition resolver, responsibility UI,
and Kitchen/Bathroom/Cats/Trash evidence with populated through-013 fixture.
```

## Coordinator / Project Lead next

- Commit on `brief/p0-007b-assignment-patterns-scheduled-work` when ready.
- Architecture technical acceptance after reviewing this report and gate logs.
- Do not merge/deploy until Project Lead authorizes.
