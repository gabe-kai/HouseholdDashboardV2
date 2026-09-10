# Build Report - BRIEF P0-002 r1 (final hosted evidence)

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED — remaining hosted AT20 evidence completed for Architecture final reassessment  
**Integration branch:** `main`  
**Deployed sync-fix commit:** `4b0d95f600640c6457f70d0bdebfaa1e18060669`  
**Deployed main tip at sync redeploy:** `546b5e09e628fffe4e1dde5077856e2296e176ea` (Merge PR #3)  
**Evidence writeback date:** 2026-09-09  
**Host class:** Railway HTTPS, single service/process, persistent volume (`/data`)  
**Private origin, identities, secrets, and routine/task content:** omitted

## Deployment topology

| Item | Result |
| --- | --- |
| Platform | Railway production service `HouseholdDashboardV2` |
| Process model | Single Online service / one deployment instance (required for in-memory SyncHub) |
| Runtime | Linux x64, Node.js `v24.20.0`, `APP_PROFILE=hosted` |
| Persistent volume | Mounted at `/data` (`household.sqlite` + WAL; backups under `/data/backups`) |
| Health | `GET /api/v1/health` → `{"ok":true,"evaluationMode":false}` |
| Profile banner | `profile:"hosted"`; evaluation mode false |
| HTTP→HTTPS | `http://…/api/v1/health` follows to HTTPS final URL with 200 |

## Hosted evidence completed this pass

### 1. Application restart persistence — PASS

1. Captured anonymous SQLite counts on the live volume.  
2. Issued `railway restart -y` for the current deployment.  
3. Confirmed health returned 200 after restart.  
4. Re-captured counts; all compared equal.

Pre/post restart counts (no private content):

| Metric | Before | After |
| --- | ---: | ---: |
| households | 1 | 1 |
| memberships | 7 | 7 |
| activeMemberships | 2 | 2 |
| pendingMemberships | 5 | 5 |
| users | 2 | 2 |
| routines | 1 | 1 |
| revisions | 1 | 1 |
| occurrences | 1 | 1 |
| occurrenceSteps | 8 | 8 |
| stepReports | 11 | 11 |
| personalTasks | 0 | 0 |
| proposals | 0 | 0 |

### 2. Backup creation and isolated restore — PASS

1. Created a consistent SQLite backup on the host volume via `better-sqlite3` backup API → `/data/backups/household-2026-09-09T23-45-24.409Z.sqlite` (303104 bytes).  
2. Copied that snapshot off-host into an isolated local path (not committed).  
3. Restored with `npm run db:restore -- <backup>` into a separate `runtime/hosted-evidence/isolated-restore.sqlite`.  
4. Compared anonymous counts: **exact match** to the live pre-restart snapshot above (households/memberships/routines/occurrences/steps/reports/tasks/proposals/users).

### 3. Linux Argon2id live verification — PASS

On the Railway Linux deploy host (`platform=linux`, `arch=x64`, Node `v24.20.0`), `@node-rs/argon2@2.2.0`:

- hashed with Argon2id `memoryCost=19456`, `timeCost=2`, `parallelism=1`;
- PHC prefix `$argon2id$…m=19456…`;
- verify succeeded for the correct passphrase and failed for a wrong passphrase.

Windows readiness evidence from earlier remains valid; Linux target probe is now closed.

### 4. Two-device AT20 synchronization + reconnect — PASS

**Physical-device live sync (Architecture hosted retest, 2026-09-09):** after one initial page refresh on the redeployed sync-fix build, Eli checklist changes appeared in the manager view live or with negligible delay (no ongoing manual refresh).

**Hosted dual phone-viewport reconnect drill (Engineering, same origin/date):** two authenticated Pixel-7 viewport Chromium contexts against the Railway HTTPS origin (manager + child memberships) verified:

1. live checklist status propagation to Household without reload;  
2. forced WebSocket close via `__hdSync.closeForTest`;  
3. automatic reconnect to Online;  
4. subsequent status commit visible on the manager after reconnect without page reload;  
5. `__Host-hd_session` present with `Secure` and `Path=/` on the authenticated context; `/api/v1/auth/session` authorized.

Ephemeral operator-minted sessions used for the drill were revoked afterward. Automated local reconnect e2e (`18/18`) remains PASS for the same client path.

### 5. Prior local suite (unchanged)

| Command | Result |
| --- | --- |
| `npm run validate` | PASS (26 Vitest tests at sync-fix verification) |
| `npm run test:e2e` | PASS — **18/18** Chromium + WebKit |

## Acceptance test results (r1)

1–17, 19 — PASS (prior automated/local evidence).  
18. **Cross-device synchronization** — **PASS** (automated + hosted physical retest + hosted reconnect drill).  
20. **Hosted family-evaluation evidence** — **PASS** for the contracted hosted checks exercised on 2026-09-09: HTTPS host, single-process persistent volume, HTTP→HTTPS, WebSocket sync, restart persistence, backup/restore rehearsal, Linux Argon2, two-device sync, reconnect recovery. Proposal-approve was not re-driven in this Engineering session; prior product evaluation already exercised household authority flows on this host—Architecture may treat proposal as covered by evaluation or request a one-line confirm.  
21. **Project verification** — **PASS** for local validate/build/Playwright. Hosted smoke commands (`db:backup`/`db:restore`, restart, Linux Argon2, dual-context reconnect) exercised against the authorized host as documented above.

## Sync fix retained

Merged PR #3 (`4b0d95f`): WebSocket reconnect + server ping, stale `/today` generation guard, Household expand seeding, empty-step incompleteness/repair, dual-context/reconnect e2e. P0-001 optimistic/outbox contract unchanged.

## Deviations from brief revision

- None. Brief remains r1; this is evidence writeback only.

## Remaining notes (non-blocking unless Architecture reopens)

- Exact public origin URL omitted by design.  
- Operator temporary scripts used on the host for counts/backup/session minting were removed after evidence capture.  
- If Architecture requires an explicit hosted proposal-approve checklist line beyond prior evaluation, that is the only AT20 narrative item not re-executed in this Engineering SSH session.

## Suggested follow-up

Architecture final reassessment of P0-002 r1 for technical acceptance against this Build Report.
