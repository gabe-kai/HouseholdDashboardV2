# Operations: bootstrap, backup, restore, and hosted packaging (P0-002)

Provider-neutral notes for one Node.js 24 process and a mounted SQLite/backup directory
behind HTTPS with WebSocket forwarding. Do not commit real origins, accounts, or secrets.

## Runtime profiles

- `APP_PROFILE=development` (default locally): loopback, auto-seed pending memberships, distinct `hd_dev_session` cookie.
- `APP_PROFILE=test`: used by Playwright; allows `/api/v1/test/bootstrap-claim`.
- `APP_PROFILE=hosted`: fail-closed. Requires `PUBLIC_ORIGIN=https://…`, `DB_PATH`, `BACKUP_DIR`. Forbids `EVAL_LAN_ACCESS`, `ALLOW_EVAL_BYPASS`, and `AUTO_SEED=1`. Uses `__Host-hd_session` with `Secure; HttpOnly; SameSite=Strict; Path=/`.

## Commands

```bash
npm ci
npm run db:migrate
npm run db:seed          # development/test only — pending fictional memberships, no passwords
npm run auth:bootstrap   # prints one single-use bootstrap claim token
npm run db:backup        # consistent backup into BACKUP_DIR
npm run db:restore -- path/to/backup.sqlite
npm run build
npm run start            # with APP_PROFILE=hosted and required env
```

Before applying a new migration on a populated database, run `npm run db:backup`.

## Reverse proxy expectations

- Terminate TLS at the edge; redirect HTTP→HTTPS.
- Forward `/` and `/api` to the Node process; enable WebSocket upgrade for `/api/v1/sync`.
- The client reconnects dropped sync sockets with backoff and re-reads `/api/v1/today` on reconnect and tab visibility; server ping frames help keep long-lived upgrades healthy through intermediaries.
- Mount persistent volumes for `DB_PATH` and `BACKUP_DIR`.
- Do not put passphrases, session tokens, enrollment tokens, or private task titles in logs.
- Keep a single Node process (in-memory sync fan-out is not multi-replica).

## Hosted acceptance gap

A Project Lead-authorized public HTTPS origin with persistent storage and recoverable snapshots is required for acceptance tests 20–21. Until then, report those checks as NOT RUN.
