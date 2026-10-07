# Operations: bootstrap, backup, restore, and hosted packaging (P0-002)

Provider-neutral notes for one Node.js 24 process and a mounted SQLite/backup directory
behind HTTPS with WebSocket forwarding. Do not commit real origins, accounts, or secrets.

## Runtime profiles

- `APP_PROFILE=development` (default locally): loopback, no automatic fixture seed unless `AUTO_SEED=1`, distinct `hd_dev_session` cookie.
- `APP_PROFILE=test`: used by Playwright; allows `/api/v1/test/bootstrap-claim`.
- `APP_PROFILE=hosted`: fail-closed. Requires `PUBLIC_ORIGIN=https://…`, `DB_PATH`, `BACKUP_DIR`. Forbids `EVAL_LAN_ACCESS`, `ALLOW_EVAL_BYPASS`, and `AUTO_SEED=1`. Uses `__Host-hd_session` with `Secure; HttpOnly; SameSite=Strict; Path=/`.

## Commands

```bash
npm ci
npm run db:migrate
npm run db:seed          # opt-in — pending fictional Reed memberships, no passwords
npm run auth:bootstrap   # empty DB: minimum household + one-time claim only (no demo people)
npm run db:cleanup-fixtures -- [--db path] [--apply]  # dry-run default; exact fixture IDs only
npm run db:backup        # consistent backup into BACKUP_DIR
npm run db:restore -- path/to/backup.sqlite
npm run build
npm run start            # with APP_PROFILE=hosted and required env
```

Before applying a new migration on a populated database, run `npm run db:backup`.
P0-005 adds `005_multiple_household_routines.sql` (multi-routine/dayparts/archive), `006_occurrence_structural_lock.sql` (`occurrences.started_at`), `007_routine_schedule_lifecycle.sql` (schedule entries, immutable revision content, End/Delete lifecycle, occurrence soft-cancel), and `008_widen_routine_mutation_receipt_kinds.sql` (repairs receipt `kind` CHECK so schedule delete/move and End/Delete receipts are accepted on databases that applied an earlier 007 draft). Rehearse on disposable copies: backup → migrate → restore to an isolated path. Do not rewrite live household data as part of brief acceptance.

Normal local development uses `AUTO_SEED=0` (see `.env.example`). Explicit `npm run db:seed` or `AUTO_SEED=1` creates the canonical demo fixture. Fixture cleanup is operator-driven: dry-run by default, `--apply` after backup, and never runs on startup. Do not apply cleanup to a live household database without an explicit Project Lead decision.

## Reverse proxy expectations

- Terminate TLS at the edge; redirect HTTP→HTTPS.
- Forward `/` and `/api` to the Node process; enable WebSocket upgrade for `/api/v1/sync`.
- The client reconnects dropped sync sockets with backoff and re-reads `/api/v1/today` on reconnect and tab visibility; server ping frames help keep long-lived upgrades healthy through intermediaries.
- Mount persistent volumes for `DB_PATH` and `BACKUP_DIR`.
- Do not put passphrases, session tokens, enrollment tokens, or private task titles in logs.
- Keep a single Node process (in-memory sync fan-out is not multi-replica).

## Household backups and in-app restore (P0-008B)

Supported restore sources are **registered server-managed backups** under `BACKUP_DIR` (catalog files `catalog-<uuid>.sqlite`) plus owner-validated legacy `household-*.sqlite` operator files already in that directory. Compatibility covers through-017 household schemas and every schema in the P0-008 series (current tip through `018_household_lifecycle.sql`). Newer-than-app, corrupt, multi-household, and path-traversal candidates are rejected before active data changes.

Persistence layout:
- `INSTALLATION_CONTROL_PATH` — installation id, epoch, active DB pointer, owner/setup authority, lifecycle journal, **backup catalog** (control migration `001_household_backup_catalog.sql`)
- Active household image(s) under the configured DB directory (`*.epoch-N.sqlite` candidates during replacement)
- `BACKUP_DIR` — immutable cataloged snapshots (never inside the replaceable household image)

In-app Settings → Backups creates/lists/deletes/restores. Reset and restore each offer **Save a backup…** off by default. Protected Welcome can restore after owner authorization when no household account remains. `npm run db:restore` still refuses when installation control exists and is not a bypass for epoch/credential sanitation.

## Installation owner setup (P0-008A)

No-terminal deployment-owner configuration for protected first-manager setup and repeatable reset:

1. Generate a password-manager secret with at least 256 bits of randomness.
2. Set `INSTALLATION_OWNER_SECRET` in the host secret UI (never commit it).
3. Set durable paths on the same volume:
   - `DB_PATH` — initial household database (adopted; may change after reset)
   - `INSTALLATION_CONTROL_PATH` — small control SQLite outside household snapshots (default `runtime/installation-control.sqlite`)
   - `BACKUP_DIR` — operator/provider backups (survive A resets; A creates no new pre-reset backup)
4. Mount all three paths persistently. After reset, operator tools resolve the **active** household image via the control store (do not assume the original `DB_PATH` filename remains active).
5. Open `/owner` in the browser, exchange the secret for an owner session, issue a one-use setup invitation (fragment link), and complete Welcome: account → household.
6. **Reset household** in Settings requires `household.lifecycle.manage`, typing `RESET`, and recent password confirmation. Losing the response does not repeat the wipe; recovery uses the continuation cookie or `/owner`.

When `INSTALLATION_OWNER_SECRET` is missing, ordinary populated use continues but setup/reset/recovery stay closed. Legacy `auth:bootstrap` is bound when the owner secret is configured. Do not run live reset without Project Lead authorization.

### First-run / reset release checklist (disposable candidate)

1. Confirm control path + secret + volume layout on an isolated copy (never against production without authorization).
2. Owner invite → account/household → Today/Household; reload resumes unfinished basics.
3. Reset once; confirm Welcome returns, epoch advances, no demo seed, no new pre-reset backup file.
4. Reset again after re-setup; confirm repeatability and lost-response recovery if tested.
5. Restart the Node process; confirm control state and new household persist.
6. Record SHA and any NOT RUN hosted items in the Build Report (omit secrets).

## Hosted release-candidate checklist

Use only when a candidate is actually being released or deployed (not during the normal development loop):

1. Deploy the exact commit SHA behind HTTPS with WebSocket upgrade.
2. Configure installation owner secret + control/active/backup paths (above); complete browser setup without shell bootstrap when owner-gated.
3. Bootstrap/enroll on two physical phones only when still using legacy claim path; prefer owner-issued setup for new installations.
4. Restart persistence; optional backup → isolated restore rehearsal (B adds in-app restore).
5. Record evidence in the brief Build Report (omit private origins/secrets). Live reset remains a Project Lead deliberate app action.

A Project Lead-authorized public HTTPS origin with persistent storage and recoverable snapshots is required for those hosted checks. Until then, report them as NOT RUN.

Contract catalog and local/CI gates: `docs/protected-behaviors.md`.
