# Engineering Readiness Review - BRIEF P0-008B r2

**Brief revision reviewed:** 2  
**Review round:** Initial consolidated pass  
**Readiness:** READY  
**Repository/Git state checked:** YES  
**Current branch:** `backups-and-restore` @ `e34a846`  
**Integrated code baseline inspected:** Clean `main` / `origin/main` at **`405c5db`** (PR **#24**, accepted P0-008A r1)  
**Working tree at review:** Clean; tip `e34a846` is docs-only (`docs(P0-008B): release r2…`) on top of `405c5db` — no B implementation under `src/`, `db/`, `tests/`, or `.github/`

> READY is the default when implementation can reasonably proceed. QUESTION/BLOCKER findings must be material, evidenced, and consolidated; ordinary implementation choices are not readiness gates.

## Verdict

**READY.** D-050–D-052 and D-051’s restore/typed-journal extension agree with P0-008B r2. The brief’s **Current system** claims match merged A at `405c5db`: control SQLite with no backup catalog or control-schema migration history; exclusive `replaceWithEmptyDatabase` + shared/exclusive barrier; `reconcilePendingOperations` completing pending ops with a **reset-shaped** `setupRequired` response regardless of `kind`; unregistered `db:backup` / control-refusing legacy `db:restore`; Settings no-new-backup reset; epoch fencing on sessions/outboxes/SyncHub; no backup/restore routes or B CI selection.

Required deltas are forward extensions of A’s coordinator—not a parallel restore stack—and are specified tightly enough to implement: additive catalog migration on populated A control DBs, serialized optional verified backup before destructive activation, kind-aware pending recovery, Settings/Welcome restore UX, compatibility fixtures through-017 and through-018/A, and explicit B CI selection.

**No BLOCKER. No QUESTION.** This review does not authorize coding; await Architecture **ACCEPT / PROCEED**. C/D remain out of scope. No Railway inspection, deploy, or live-database mutation was performed (disposable-data posture only).

## Decision alignment

| Decision | Brief use | Repo / conflict |
| --- | --- | --- |
| **D-050** | Owner recovery authorizes Welcome restore / legacy register; reset continuation cannot enumerate backups; control outside snapshots | Implemented for setup/reset; owner/continuation scopes match; B adds backup surfaces under same principal rules |
| **D-051** | Extend exclusive prepare→activate→reopen; fresh installation epoch; typed journal; no parallel file-switch; multi-household refuse | Implemented for empty reset; `lifecycle_operations.kind` exists but reconciler ignores it; B must kind-discriminate |
| **D-052** | Immutable catalog, SQLite backup API, optional save off-by-default, integrity+FK admission, legacy `BACKUP_DIR` register, no private browse/download | Active planned; absent in code (scripts write unregistered files only) |
| **D-034 / D-045** | Activity clear unchanged; offline display stale bound retained | Implemented; brief preserves |
| **D-053–D-056** | Lifecycle grant already on Manager; C member admin / D guided day out of scope | Match; B uses existing `household.lifecycle.manage` |

## Current-system claim check

| Claim | Evidence | Verdict |
| --- | --- | --- |
| Merged tip `405c5db` / migrations through 018 | `git rev-parse main` = `405c5db`; `db/migrations/018_household_lifecycle.sql` | Match |
| Control store: identity/epoch/active path/owner/setup/journal/continuations; no catalog; no control migration history | `installation-control.ts` `CONTROL_SCHEMA` = `CREATE TABLE IF NOT EXISTS` only; no backup tables | Match |
| `activateCandidate` / `completeLifecycleOperation` separate | `InstallationControl.activateCandidate`, `completeLifecycleOperation` | Match |
| Shared barrier for ordinary `/api/v1`; exclusive replacement; only reset exempt from shared | `app.ts` skips shared for `/api/v1/household/reset`; `withExclusive` in `replaceWithEmptyDatabase` | Match |
| `reconcilePendingOperations` assumes reset | Completes `sourceEpoch < current` with `recoveredResetResponse` (`setupRequired: true`); ignores `op.kind` | Match (primary B seam) |
| No backup catalog / optional-backup / restore routes | `lifecycle-routes.ts`; `route-policy.ts` lifecycle block | Match |
| `backup.ts` → unregistered `BACKUP_DIR` file via SQLite backup API | `scripts/backup.ts` | Match |
| `restore.ts` refuses when control exists; else unlink/rename offline | `scripts/restore.ts` lines 20–24, 45–49 | Match |
| Settings Reset: no new backup; Welcome/owner lack restore | `HouseholdSettings.tsx`; `WelcomeSetup.tsx`; `OwnerApp.tsx` | Match |
| Epoch fencing on sessions/outboxes; SyncHub reset close + display `reason: "reset"` | `store.ts` / `display.ts` epoch checks; `sync-hub.ts`; outbox retire helpers | Match |
| Through-017 fixture exists; no through-018 backup fixture / B CI | `tests/helpers/p017-fixture.ts`; Playwright `*-008a` only; `validate-pr.yml` `e2e-phone-008a` | Match |

No Current-system factual contradiction requiring Architecture revision of r2.

## Focused attention areas

### Control catalog and additive upgrade (contract §1, AT6)

**Repo today:** Control opens with idempotent `CREATE IF NOT EXISTS`. Populated A installs already have that schema; new catalog tables/columns will not appear unless B adds a versioned, replay-safe control upgrade path.

**Brief:** Catalog outside replaceable household image; opaque ID, household identity/name, UTC time, optional label, schema/migration manifest, format version, size, digest; UI metadata only for `lifecycle.manage` or authenticated owner-recovery; reset continuation cannot list backups.

**Disposition:** In-scope Engineering work. Ordinary choices: control migration table naming, catalog column layout, file naming under `BACKUP_DIR`. **IMPORTANT:** upgrade must be safe/idempotent on existing A control files used by disposable harnesses and (later) hosted volumes.

### Serialized create/delete and optional backup-before-switch (contract §2–§3, AT2)

**Repo today:** Reset never creates a backup. Operator `db:backup` is unsynchronized with the lifecycle barrier. No delete/catalog APIs.

**Brief:** SQLite backup API + verify before catalog success; serialize create/delete with reset/restore activation; optional save default **off**; on failure leave active data and require Retry or a **new** proceed-without confirmation; success-then-failed-activation must report the saved backup truthfully without duplicate copies on replay.

**Disposition:** Feasible by extending exclusive lifecycle operations (and/or a catalog lock held across snapshot+publish). **IMPORTANT:** ordinary writes must not slip between optional snapshot and activation; receipt/payload digests must bind optional-backup choice and backup id/digest (A’s `findCompletedOperationByPayload(kind, digest, sourceEpoch)` pattern extends cleanly).

### Restore admission, scrub, and typed recovery (contract §4–§8, AT3–AT5, AT7)

**Repo today:** Empty-candidate reset path only. Candidate scrub N/A for empty DBs. Pending recovery always emits reset-shaped JSON. Shared-barrier exemption is reset-path-only. Client `HouseholdResetResult` / recovery UX assume `setupRequired`.

**Brief:** Verify digest/schema/integrity/FK/single-household; migrate a **copy**; scrub sessions/claims in staged image + applicable control records; allocate **fresh installation epoch** (never restore epoch from backup); activate via A’s coordinator; kind-correct pending recovery; initiator restricted result session until restored sign-in.

**Disposition:** Highest implementation risk, but contractually clear. Ordinary choices: restore route paths, scrub helper placement, operation `kind` string values, fault-hook coverage for scrub/migration boundaries. **IMPORTANT (mandatory, not optional polish):**
1. `reconcilePendingOperations` must discriminate `kind` and never complete a restore (or backup-create) as reset success with `setupRequired: true`.
2. Exclusive/shared-barrier wiring must cover restore (and any exclusive backup/reset-with-backup) routes the way reset is exempted today—avoid shared+exclusive deadlock.
3. Display/member retirement notices and invalidate reasons should be restore-aware where user-visible; epoch fence mechanics can stay.
4. Keep refusing offline `db:restore` when control exists; document in-app restore as the supported path.

### Legacy operator register and privacy (contract §5–§6, §9)

**Repo today:** `household-*.sqlite` files may already exist under `BACKUP_DIR` with no catalog row.

**Brief:** Owner-authorized scan/register inside configured root only; reject traversal/symlink/foreign/multi-household; no path/URL from browser; no private-task preview or raw download.

**Disposition:** Clear. Reuse owner CSRF/session patterns from `/owner`. Path confinement is ordinary Engineering hardening with AT6 rejection cases.

### Evidence, fixtures, CI (contract §10, AT1–AT10, AT10 gates)

**Repo today:** A Chromium/WebKit-008a projects, `e2e-phone-008a`, p017 upgrade helper, lifecycle fault hooks, e2e soft restart.

**Brief:** Through-017 and through-018/A backup fixtures; crash/concurrency matrix; stale multi-client restore journey; explicit B CI selection; hosted evidence separately NOT RUN unless Project Lead authorizes.

**Disposition:** Feasible by mirroring A’s Playwright/CI patterns (`*-008b`, grep, dedicated ports/DB/control paths). Hosted Railway proof remains a release checkpoint, not a readiness blocker.

## Acceptance-test feasibility (AT1–10)

| AT | Feasible on baseline? | Notes |
| --- | --- | --- |
| 1 Settings journey | Yes | New Backups UI + lifecycle.manage / display denial matrix |
| 2 Optional backup matrix | Yes | Extend exclusive ops + fault injection; race with delayed writes using A hold patterns |
| 3 Welcome restore | Yes | Owner proof + catalog after A reset/restart; p017/018 populated seed |
| 4 Settings restore | Yes | Second household then restore; preview identity checks |
| 5 Credential resurrection | Yes | Extend A AT10 cookie/queue capture across restore epoch |
| 6 Compatibility | Yes | Through-017 + through-018/A fixtures; control upgrade idempotency; legacy register + reject cases |
| 7 Crash and concurrency | Yes | Existing `LifecycleFaultHooks` + real reopen; **must** assert kind-correct reconcile |
| 8 Recovery UX | Yes | Continuation vs owner; public Welcome must not leak catalog |
| 9 Stale clients | Yes | Extend A/C-2 multi-context holds across restore |
| 10 Gates/evaluation | Yes | Explicit B CI; hosted/Product separately NOT RUN |

## Scope confirmation

- **In:** Control catalog + additive upgrade; create/delete/register; optional backup on reset/restore; Settings Backups + Welcome restore; typed lifecycle ops/recovery; candidate scrub + fresh epoch; route-policy/PB; operator-tool docs; through-017/018 fixtures; B CI selection; local screenshots under ignored `reports/_local-screenshots/p0-008b-r2/`.
- **Out:** C member admin/removal; D guided first day; email/external storage/uploads/schedules; automatic live restore/deploy; widening D-034; Railway/live DB operation; claiming hosted Product evaluation.

## Status for Architecture

**Readiness: READY** for P0-008B revision 2 against integrated `main` @ `405c5db` (planning tip `e34a846`).

Await **ACCEPT / PROCEED** before implementation. After that response, Engineering expects to build without another ordinary QUESTION/BLOCKER cycle unless a genuinely new repository fact appears. Suggested implementation branch after proceed: `brief/p0-008b-household-backups-in-app-restore`.

## Suggested commit message (readiness writeback only; not committed by this review)

```
docs(P0-008B): record Engineering readiness READY for r2
```
