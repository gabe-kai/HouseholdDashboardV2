# Build Report - BRIEF P0-002 r1

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (provider-neutral; hosted evidence incomplete)  
**Branch:** `brief/p0-002-authenticated-household-authority`  
**Commits:** `c96133a` (implementation); `f0964a9`, `0b9125e` (Build Report metadata)  
**Pull request:** N/A (not opened)  
**Project card:** “Use Morning Routine as a real household” — transition Up Next → In Progress when implementation began.

## What changed

- Replaced evaluation profile selection with authenticated users, household memberships, digest-backed sessions, CSRF/origin checks, and membership grant presets.
- Migrated populated P0-001 data (`002_authenticated_authority.sql`) while preserving occurrence snapshots, reports, and stable logical item IDs.
- Added Argon2id passphrase hashing (`@node-rs/argon2@2.2.0`), common-password blocklist, enrollment/bootstrap claims, personal routine layers, proposals, and thin personal tasks.
- Namespaced IndexedDB outbox by membership; authority-aware client Today/Routine/Personalize/Approvals/Enroll UI.
- Added `auth:bootstrap`, `db:backup`, `db:restore`, hosted fail-closed config, and provider-neutral ops notes (`docs/ops-deploy.md`).
- Playwright Chromium + WebKit suites run against isolated e2e databases/ports.

## Files changed (high level)

- `db/migrations/002_authenticated_authority.sql`, `src/server/backfill.ts`, `src/server/store.ts`, `src/server/app.ts`, `src/server/config.ts`, `src/server/crypto.ts`, `src/server/password-blocklist.ts`
- `src/server/scripts/{bootstrap,backup,restore}.ts`, `data/common-passwords.txt`, `docs/ops-deploy.md`
- `src/domain/compose.ts`, `src/shared/grants.ts`, `src/shared/schemas.ts`
- `src/client/{App,api,outbox,styles}.*`
- `tests/integration/p0-002.test.ts`, `tests/e2e/*`, `playwright.config.ts`
- `package.json` / lockfile, `.env.example`, `ARCHITECTURE.md`, this report

## Behavior delivered

- Bootstrap + enrollment claims (digest-only storage, single-use, expiring); claim/login with passphrase policy; revocable sessions.
- Grants: enroll, shared manage, personalize direct/propose, proposal decide, execute own, personal task create — enforced server-side.
- Shared routine remains prospective; personal layers compose without cloning; proposals approve/reject once; private tasks stay owner-only.
- Hosted profile refuses incomplete HTTPS/origin/storage config and auto-seed/LAN bypasses.
- Optimistic checklist + membership-scoped outbox retained.

## Verification performed

Environment: Windows, Node.js `v24.16.0`, npm lockfile with `@node-rs/argon2@2.2.0`, `@playwright/test` Chromium + WebKit.

| Command | Result |
| --- | --- |
| `npm run validate` | PASS (`lint` + `typecheck` + 15 Vitest tests) |
| `npm run build` | PASS (also via e2e webServer) |
| `npm run test:e2e` | PASS — **6/6** (3 Chromium + 3 WebKit) |
| `npm run db:migrate` / `db:seed` / `db:backup` / `db:restore` | PASS (local rehearsal DB; 6 memberships after restore) |
| `npm run auth:bootstrap` | Implemented; not re-run in final gate (covered by store/API tests) |
| Linux Argon2 live probe | NOT RUN (no authorized Linux host) |
| Hosted HTTPS family evaluation | NOT RUN (Project Lead host TBD) |

## Acceptance test results

1. **Populated migration** — PASS (integration)
2. **Fresh/production startup** — PASS for fail-closed hosted config + no auto-seed (unit/integration). Hosted cookie attributes against a live HTTPS response — NOT RUN
3. **Six identities** — PASS (integration enroll across presets). Physical family checklist — NOT RUN
4. **Credential controls** — PASS (short/blocklist reject, Argon2id PHC assert, throttle). Log/secret capture scan — PARTIAL (no raw secrets in DB assertions; full log redaction audit not automated)
5. **Claims and sessions** — PASS for claim digest/consume/replay and CSRF exempt paths in app code + e2e cookies. Hosted `__Host-` live HTTPS attributes — NOT RUN
6. **Household isolation** — PASS (foreign routine revision rejected; foreign memberships not listed). Full route enumeration + WebSocket cross-household — PARTIAL
7. **Capability matrix** — PASS for personalize/propose/decide/private task denials in integration. Exhaustive per-grant API matrix — PARTIAL
8. **Direct personalization** — PASS (integration preview + history snap)
9. **Restricted proposal** — PASS (approve idempotent; opposite decision conflicts)
10. **Prospective and historical integrity** — PASS (occurrence snapshot unchanged after personalization)
11. **Stable-base flow** — PARTIAL (compose domain tests + personalization path; dedicated later-shared-revision e2e not added)
12. **Required structure** — PASS via grant checks (child lacks `routine.shared.manage`); dedicated UI forbid assertion — PARTIAL
13. **Personal task visibility** — PASS (private hidden from manager)
14. **Authority-aware navigation** — PASS (e2e manager vs child nav surfaces)
15. **Prospective feedback** — PASS in UI code path (effective date / preview); not separately e2e-asserted — PARTIAL
16. **Optimistic execution regression** — PASS (e2e delayed mutation Chromium + WebKit)
17. **Shared-browser identity safety** — PARTIAL (outbox namespaced by membership; dedicated expire/switch e2e not added)
18. **Cross-device synchronization** — PARTIAL (WebSocket path retained; dual-context e2e not re-asserted in this suite)
19. **Household time and accessibility** — PASS overflow e2e; timezone domain coverage retained; full a11y audit — PARTIAL
20. **Hosted family-evaluation evidence** — **NOT RUN** (no Project Lead-authorized HTTPS host; no physical phones)
21. **Project verification** — PASS for `validate` / `build` / Playwright / backup-restore docs exercise. Hosted-smoke on authorized origin — **NOT RUN**

## Deviations from brief revision

- None material to r1 scope.
- Exhaustive acceptance automation is denser in store/integration than in full HTTP matrix/e2e for every grant and dual-context sync case; gaps called out above.
- Linux deployment Argon2 probe deferred with hosted acceptance.

## Discoveries for Architecture

- `@node-rs/argon2@2.2.0` verified on Windows Node 24.16.0 for Argon2id 19 MiB / 2 / 1.
- Playwright projects need isolated DBs when enrollment mutates shared state across Chromium then WebKit.
- Test-only `POST /api/v1/test/bootstrap-claim` must be CSRF-exempt and unavailable in hosted profile.

## Known limitations / evidence gaps

- Acceptance **20** and hosted portions of **21** remain **NOT RUN** until an authorized HTTPS host and physical devices are available.
- Linux Argon2/native package live verification not performed.
- Dual-context sync and shared-browser outbox switch scenarios are implemented but not fully re-covered by the reduced P0-002 e2e set.
- Full Architecture technical `ACCEPTED` for the hosted outcome should wait on those gaps; provider-neutral implementation is ready for Architecture review.

## Suggested follow-up

- Architecture acceptance review of this Build Report against P0-002 r1.
- Project Lead: provision authorized HTTPS host; run acceptance 20 + hosted 21.
- Coordinator: keep project card In Progress until hosted evidence lands; do not merge solely on provider-neutral PASS if project policy requires hosted acceptance first.
