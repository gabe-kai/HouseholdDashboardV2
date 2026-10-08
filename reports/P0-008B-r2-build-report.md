# Build Report - BRIEF P0-008B r2

**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED; awaiting Architecture technical re-review after remaining FIX REQUIRED findings  
**Branch:** `brief/p0-008b-household-backups-in-app-restore`  
**Baseline:** merged A at `405c5db` (PR #24); Architecture ACCEPT / PROCEED at `6dacc69`  
**Implementation commit:** `6545c5f` — `feat(P0-008B): household backup catalog and in-app restore`  
**Planning tip at first review:** `b3b34b7` — Architecture FIX REQUIRED findings recorded  
**Correction commit (first FIX REQUIRED pass):** `abe5fff` — `fix(P0-008B): close r2 FIX REQUIRED restore recovery and evidence`  
**HEAD at this report:** `abe5fff`  
**Working tree:** uncommitted second-pass evidence on top of `abe5fff` (AT2 household-write race + snapshot proof; AT6 newer/unknown/multi-household rejection fixtures; AT9 queued display taps + held stale reads; `x-mutation-delay-ms` / `x-read-delay-ms` on personal-tasks create and display dashboard/step routes). Dirty Architecture-owned docs (`ARCHITECTURE.md`, `PROJECT_STATE.md`, `ROADMAP.md`, brief, architecture reviews) are present and **not** absorbed into this Engineering change set.  
**Pull request:** N/A (not opened by this Build Report)

## What changed (original `6545c5f`)

- **Control catalog:** additive control migration `001_household_backup_catalog.sql` via `control_schema_migrations`; catalog rows store opaque id, household identity/name, UTC time, optional label, schema manifest, format version, size, digest, relative path, source.
- **Backup service:** SQLite backup API (+ live runtime handle), integrity + FK checks before catalog publish; create/delete/legacy-register serialized with reset/restore via catalog lock (does not quiesce ordinary reads).
- **Optional backup:** Reset/restore accept `saveBackupBefore*` default **false**; verified snapshot runs inside the exclusive replacement before activation; receipts bind the choice.
- **Restore:** Verify catalog file/digest/schema/single-household; stage copy; migrate; scrub sessions/claims; revoke control setup tickets; activate with **fresh installation epoch**; SyncHub `closeAll("restore")`; typed `household_restore` result (`setupRequired: false`, `signInRequired: true`).
- **Kind-aware reconcile:** Pending restore never completes as reset/`setupRequired: true`.
- **UI:** Settings → Backups (create/list/delete/restore + optional pre-reset/pre-restore); Welcome owner unlock + restore; public Welcome without owner cookie lists nothing.
- **Ops/CI:** `docs/ops-deploy.md` supported range/layout; PB-59/60; `e2e-phone-008b` + Playwright 008b selection on owner-gated 008a servers.

## FIX REQUIRED corrections

### First pass (committed `abe5fff`)

Closes the initial findings in `reports/P0-008B-r2-architecture-review.md` without changing the r2 contract. C/D remain out of scope. No Railway/live database/deploy work.

1. **AT7 typed restore across activation crash window** — progress persistence, same-epoch reconcile fields, revoke-before-exclusive; afterActivate + fault matrix evidence.
2. **AT2 optional-backup matrix** — off→zero / on→one; backup fail→proceed-without; activation-fail + non-duplicate replay.
3. **AT4 Settings restore e2e** — second-household preview + restore + original sign-in.
4. **AT5** — human / setup invitation / claimed display rejected after restore.
5. **AT6 through-017** — fixture restore + source-byte integrity + bad digest without epoch advance.
6. **Gates** — exact `validate:pr` / `validate:rc` recorded PASS under Verification (not re-run for this second evidence pass).

### Second pass (uncommitted on `abe5fff` HEAD)

Closes the Architecture re-review remaining findings (AT2 race, AT6 admission negatives, AT9 display fencing). Contract unchanged; C/D still out of scope.

1. **AT2 — real household-data write raced with backup/reset**
   - Delayed `POST /api/v1/personal-tasks` (`x-mutation-delay-ms`) across reset-with-backup.
   - Inspects the saved backup SQLite for the task title when status is 200; otherwise asserts rejection (`401`/`403`/`409`) and absence from the new active household.
   - Never accepts a successful response for a write absent from both snapshot and active.

2. **AT6 — newer / unknown-schema / multi-household rejection**
   - Disposable fixtures in `tests/helpers/admission-reject-backup-fixtures.ts`.
   - Owner register returns `400` / `UNSUPPORTED` for each; epoch, active household name, and catalog count unchanged.

3. **AT9 — queued display work + stale reads across restore**
   - Two walls with checklist work; held `display/dashboard` reads (`x-read-delay-ms`) and delayed display step taps (`x-mutation-delay-ms`) across restore.
   - Asserts reject statuses, zero `step_reports` for queued mutation ids, no pre-restore dashboard body resurfacing, reconnect session/dashboard/replay denied, and client outbox epoch retirement.

## Files changed (high level)

**Committed through `abe5fff`:** catalog/lifecycle/UI/e2e/ops as previously reported.

**Uncommitted second-pass (Engineering):**

- `src/server/app.ts` — test-only delay + revalidate on personal-tasks create, display dashboard read, display step status
- `tests/helpers/admission-reject-backup-fixtures.ts` (new)
- `tests/integration/p0-008b.test.ts` — AT2 race rewrite; AT6 rejection case; AT9 display fence expansion
- `reports/P0-008B-r2-build-report.md` (this file)

## Behavior delivered

Managers with `household.lifecycle.manage` manage a protected backup catalog and can restore from Settings. After reset, owner recovery at Welcome can restore a saved household and sign in with restored credentials. Optional pre-operation backup is off by default. Saved backups survive reset/restore. Offline `db:restore` still refuses when control exists. Activation-crash recovery reports truthful typed restore/backup metadata; failed same-digest retries do not duplicate optional backups. Acknowledged pre-switch household writes are snapshotted or rejected; unsupported images never enter the catalog or advance epoch; queued display work and held stale display reads cannot apply or resurface across restore.

## Acceptance test mapping (AT1–10)

| AT | Evidence | Result |
| --- | --- | --- |
| 1 Settings journey | Integration AT1 create/list/delete + unauthorized 401 | PASS |
| 2 Optional backup matrix | Integration AT2 off/on, household-write race + snapshot/reject proof, backup fail→proceed-without, activation-fail + non-duplicate replay | PASS |
| 3 Welcome restore | Integration AT3 + e2e AT3 backup→reset→restart→owner restore→signin | PASS |
| 4 Settings restore | e2e AT4 second-household preview + restore + original sign-in | PASS (see Verification e2e; recorded at `abe5fff`) |
| 5 Credential resurrection | Integration AT5 human/display/setup invitation after restore | PASS |
| 6 Compatibility | Control migration; legacy/corrupt; through-017 restore; newer/unknown/multi-household register rejected without epoch/active change | PASS |
| 7 Crash/concurrency | Kind-aware reconcile; afterActivate typed recovery; prepare/scrub/activate/cleanup fault matrix | PASS |
| 8 Recovery UX | Continuation cannot list backups (403); public list 401; Welcome owner path | PASS |
| 9 Stale clients | Integration AT9 dual-display held reads + queued taps across restore; reconnect denied; outbox epoch retirement; stale member write | PASS |
| 10 Gates/evaluation | Exact `validate:pr` / `validate:rc` below; CI `e2e-phone-008b` | PASS (local gates at `abe5fff`); hosted N/A |

## Verification performed

- `npx vitest run tests/integration/p0-008b.test.ts` — **15 passed** (second-pass evidence; includes new AT2/AT6/AT9 cases)
- Exact `npm run validate:pr` — **PASS** (EXIT 0), recorded at correction commit `abe5fff`: lint/typecheck; **295** unit/integration tests; production build; Chromium e2e **104 passed**; Vite deeplink e2e **5 passed** — **not re-run** for this evidence-only pass
- Exact `npm run validate:rc` — **PASS** (EXIT 0), recorded at `abe5fff`: full Playwright e2e **163 passed** (includes webkit-008a P0-008B AT3/AT4); Vite deeplink e2e **5 passed** — **not re-run** for this evidence-only pass
- Live database / Railway / deploy — **NOT RUN** (not authorized)

## Deviations / known limitations

- Dual-display stale-client coverage remains integration-level (held reads, queued taps, reconnect, outbox retirement), not a separate multi-browser Playwright matrix.
- C/D remain out of scope.
- Hosted/Railway backup–reset–restore Product evaluation remains a separate release checkpoint.

## Discoveries for Architecture

- Standalone backup create must not take the full exclusive shared-drain barrier while the SPA holds ordinary shared reads (deadlock/hang). Catalog lock serializes with reset/restore without quiescing reads.
- Prefer SQLite `backup()` from the live runtime DB handle rather than opening a second connection to the active image under Windows e2e load.
- Same-epoch reconcile must retain typed progress (`preOperationBackup` / `restoredBackup`) when failing interrupted ops; otherwise activation-failure retries cannot bind receipts without duplicating catalog entries.
- Revoke/closeAll must stay before the exclusive shared drain so in-flight holders revalidate as 401 (A AT10). After backup/activation faults, managers re-authenticate via login; household data remains active for retry/proceed-without.
- Settings restore can run while an owner invite cookie is still present; dual CSRF must fall through to member CSRF, and catalog access should prefer the lifecycle manager when both cookies exist.
- Test-only `x-mutation-delay-ms` / `x-read-delay-ms` on personal-tasks create and display dashboard/step routes (non-hosted profiles) are sufficient to prove snapshot-or-rejection and display fence semantics without broadening production behavior.

## Suggested follow-up

- Architecture technical re-review of this Build Report against remaining FIX REQUIRED findings.
- Project Lead: commit second-pass evidence on top of `abe5fff`, PR/merge, hosted backup/reset/restore checkpoint when authorized.

## Suggested commit message

```
test(P0-008B): close remaining AT2/AT6/AT9 restore evidence

Race a household write against optional backup, reject unsupported
backup admissions without epoch change, and fence queued display work
plus stale reads across restore.
```
