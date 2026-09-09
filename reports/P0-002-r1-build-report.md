# Build Report - BRIEF P0-002 r1 (hosted sync retest writeback)

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED — hosted sync retest recorded; AT20 still partial  
**Integration branch:** `main`  
**Deployed sync-fix commit:** `4b0d95f600640c6457f70d0bdebfaa1e18060669` (`P0-002: harden hosted WebSocket sync and reconciliation`)  
**Deployed main tip (merge):** `546b5e09e628fffe4e1dde5077856e2296e176ea` (Merge PR #3 `brief/p0-002-hosted-sync-reconciliation`)  
**Pull request:** #3 (merged)  
**Architecture disposition addressed:** hosted sync retest evidence for r1 reassessment (2026-09-09)

## Hosted retest summary

Architecture reports the realtime synchronization fix was committed, merged, and redeployed to the Project Lead-authorized Railway HTTPS origin. During the hosted retest, after **one initial page refresh**, changes to Eli’s checklist were reflected in the manager view **live or with negligible delay**. Manual refresh is **not** required for ongoing checklist→manager updates after that initial load.

Private origin, real identities, secrets, and routine/task content are omitted per brief.

## Deployment evidence

| Item | Result |
| --- | --- |
| Host class | Railway HTTPS (Project Lead-authorized single-host evaluation) |
| Deployed commit | Feature `4b0d95f…80669`; `main` tip `546b5e0…176ea` |
| Replica topology | Architecture reports redeploy under the ops **single-replica / one Node process** packaging (required for in-memory SyncHub). Engineering did not re-query the Railway control plane in this writeback session. |
| Evidence date | 2026-09-09 |

## Synchronization evidence

| Check | Result | Basis |
| --- | --- | --- |
| Two-device hosted sync (Eli checklist → manager Household) | **PASS** | Architecture hosted retest after deploy of `4b0d95f` / `546b5e0`: live or negligible delay after one initial page refresh; no ongoing manual refresh |
| Dual-context create/assign → checklist without reload | **PASS** | Automated Playwright Chromium + WebKit |
| Forced socket drop → reconnect → authoritative read without page reload | **PASS (automated)** / **NOT RUN (hosted)** | e2e `__hdSync.closeForTest` path on Chromium + WebKit; Architecture retest did not separately record a hosted forced socket-drop drill |
| Cross-household isolation (HTTP/WS) | **PASS** | Prior integration evidence (unchanged) |

## Other hosted AT20 checks

| Check | Result |
| --- | --- |
| Application restart persistence (committed state survives restart) | **NOT RUN** — not reported in this hosted retest |
| Backup / restore rehearsal (counts + sampled records match on isolated restore) | **NOT RUN** — not reported in this hosted retest |
| Linux Argon2id live probe on deploy OS | **NOT RUN** — Windows readiness verified earlier (`@node-rs/argon2@2.2.0`); Linux target probe still outstanding |
| Persistent session reload on two physical phones | **PARTIAL** — sync retest implies authenticated multi-device use; full AT20 session-reload checklist not separately itemized here |
| Hosted proposal approve path | **NOT RUN** — not reported in this retest |
| HTTP→HTTPS redirect / `__Host-` cookie attributes on live origin | **NOT RUN** — not re-captured in this writeback |

## Local verification (unchanged from sync-fix pass)

Environment: Windows, Node.js `v24.16.0`.

| Command | Result |
| --- | --- |
| `npm run validate` | PASS (`lint` + `typecheck` + **26** Vitest tests) |
| `npm run build` | PASS (via e2e webServer) |
| `npm run test:e2e` | PASS — **18/18** (9 Chromium + 9 WebKit) |

## Acceptance test results (r1)

1–17, 19 — PASS as previously reported (automated / local), unless Architecture reopens.  
18. **Cross-device synchronization** — **PASS** (automated + hosted retest of live checklist→manager updates after deploy).  
20. **Hosted family-evaluation evidence** — **PARTIAL**. Live two-device WebSocket synchronization on Railway HTTPS after deploy of `4b0d95f`/`546b5e0` **PASS**. Remaining AT20 elements still open: restart persistence, backup/restore rehearsal, Linux Argon2 probe, proposal approval on host, and explicit HTTPS/`__Host-` live cookie capture.  
21. **Project verification** — PASS for local validate/build/Playwright. Hosted-smoke completeness still blocked on the open AT20 items above.

## Sync fix retained (repository)

Prior Engineering fix (merged via PR #3): WebSocket reconnect + ping, stale `/today` generation guard, Household expand seeding so live completion stays visible, empty-step incompleteness/repair, dual-context and reconnect e2e. P0-001 optimistic/outbox contract unchanged.

## Deviations from brief revision

- None. Evidence writeback only; brief remains r1.

## Remaining hosted acceptance gaps

1. Restart persistence on the Railway instance.  
2. Documented backup → isolated restore rehearsal with count/sample match.  
3. Linux Argon2id install/hash/verify on the deploy OS.  
4. Hosted proposal approve path (AT20).  
5. Explicit live capture of HTTP→HTTPS redirect and hosted `__Host-` cookie attributes (if not already filed elsewhere).  
6. Hosted forced WebSocket drop/reconnect drill (optional strengthening; automated coverage already PASS).

## Suggested follow-up

- Architecture reassessment of P0-002 r1 against this Build Report.  
- Project Lead/Engineering: close remaining AT20 gaps on the same Railway origin, then return for final technical acceptance.
