# Build Report - BRIEF P0-005 r3

**Brief revision implemented:** 3  
**Engineering status:** IMPLEMENTED  
**Branch:** `brief/p0-005-r3-cohesive-routine-management`  
**Base:** integrated `main` @ `5376b51` (r2 implementation `297b2fd`); planning `b0b966e` / readiness `0c832d3`; prior r3 commits `4184a21` / `b7cca75`  
**FIX REQUIRED close:** Architecture FIX REQUIRED for upcoming-delete (manual retest: HTTP 500 / “An unexpected error occurred”)  
**Implementation commits:** **uncommitted** at this report authoring (Project Lead manages Git)  
**Pull request:** N/A  

## Readiness

**READY** against r3; Architecture **ACCEPT / PROCEED**, then **FIX REQUIRED** (AT6, then upcoming-delete sticky/500). No new readiness review required. This report supersedes prior r3 Build Reports for the delete defect.

## Root cause (manual retest)

Long-lived `runtime/dev.sqlite` had `007_routine_schedule_lifecycle.sql` marked applied while `routine_mutation_receipts.kind` still used the pre-r3 CHECK (`routine_create|revision|archive` only). Scheduling writes `routine_revision` receipts (allowed); **Delete upcoming** inserts `routine_schedule_delete` and hit `SQLITE_CONSTRAINT` → HTTP **500** → client “An unexpected error occurred,” entry unchanged, action repeatable.

Fresh e2e databases applied the full current 007, so prior automated delete tests could not catch this. Reproduced against the live routine (`5b3ea1e9-…` / entry `bc30a83d-…`): POST `…/schedule-entries/…/delete` returned **500** before repair.

## What changed (this FIX REQUIRED delta)

- `db/migrations/008_widen_routine_mutation_receipt_kinds.sql`: rebuild receipts with full lifecycle kinds (idempotent repair for DBs that applied an earlier 007 draft).
- `writeRoutineMutationReceipt`: map CHECK failures to a clear CONFLICT (migrations required) instead of opaque INTERNAL.
- Integration regression: simulate narrow CHECK → prove delete fails → apply migrate → delete succeeds, prior plan governs, repeat throws not-found.
- Lifecycle e2e: assert no “unexpected error” / alert after confirm; upcoming removed; prior plan visible; Delete upcoming gone.
- Ops note + migration counts (8).

Applied `008` to local `runtime/dev.sqlite` via `npm run db:migrate`; store-level delete of the failing entry then succeeded (upcoming empty). **Restart the local server** if it was already running so it reopens the rebuilt table.

## Verification performed

| Check | Result |
| --- | --- |
| Manual reproduce (runtime DB) | **PASS after 008** — pre-fix: receipts CHECK lacked `routine_schedule_delete` + HTTP 500; post-migrate: delete removed upcoming |
| `npm run validate` (via PR/RC) | **PASS** — lint + typecheck + Vitest **102** tests / **22** files |
| `npm run validate:pr` | **PASS** — Chromium e2e **21/21** |
| `npm run validate:rc` | **PASS** — Chromium+WebKit e2e **42/42** |
| Hosted / physical device | **NOT RUN** — not required |
| Local validate logs | `reports/p0-005-r3-validate-pr.log` / `...-rc.log` (gitignored `*.log`) |

### Artifact hygiene

| Path | Status |
| --- | --- |
| Prior `p0-004*` / `p0-005-r1` / `p0-005-r2` screenshots | Untouched |
| `reports/p0-005-r3-screenshots/` | 01–09 retained |

## Acceptance tests 1–18 (delta notes)

| AT | Result | Evidence |
| --- | --- | --- |
| 1 Populated upgrade | **PASS** | Migration count **8**; 008 repair covered |
| 6 Move/collision/date boundary | **PASS** | Prior AT6 UI e2e retained |
| 7 Delete upcoming/fallback | **PASS** | Lifecycle e2e (no unexpected error; entry gone; prior plan; no repeat) + 008 repair integration |
| 18 Regression/artifact gates | **PASS** | Exact `validate:pr` / `validate:rc` |

Remaining AT rows unchanged from the prior r3 report (still PASS with the same evidence classes).

## Deviations / known limitations

- Operators with a long-lived DB that applied an incomplete 007 must run migrations (008) and restart the process.
- Hosted/physical RC not run.
- This FIX REQUIRED close remains **uncommitted**.

## FIX REQUIRED

None remaining for the Architecture-reported upcoming-delete 500 / unexpected-error failure. Architecture technical acceptance of this Build Report and Project Lead/product acceptance remain pending.

## Suggested commit message

```
P0-005 r3: repair receipt kinds so upcoming delete cannot 500

Add migration 008 to widen routine_mutation_receipts CHECK on
long-lived DBs, map constraint failures clearly, and regress delete.
```
