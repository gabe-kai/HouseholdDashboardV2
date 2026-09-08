# Build Report - BRIEF P0-002 r1 (FIX REQUIRED response)

**Brief revision implemented:** 1  
**Engineering status:** IMPLEMENTED (provider-neutral; hosted evidence incomplete)  
**Branch:** `brief/p0-002-authenticated-household-authority`  
**Commits:** `c96133a` (initial implementation); `361be83` (FIX REQUIRED response); intervening report/metadata commits on branch  
**Pull request:** N/A (not opened)  
**Architecture disposition addressed:** FIX REQUIRED (2026-09-08)

## What changed in this FIX REQUIRED pass

1. **Origin enforcement:** `/api/v1/auth/login` and `/api/v1/auth/claim` independently require the configured allowed `Origin` (absent/foreign rejected). HTTP coverage added; test-only bootstrap remains absent in hosted mode.
2. **Migration logical IDs:** `backfill.ts` assigns one unique logical ID per checklist row with FIFO one-to-one continuity across revisions for duplicate/reordered text+obligation rows; integration coverage added.
3. **P0-001 regressions restored:** `tests/integration/p0-001.test.ts` ported to authenticated contexts (materialization idempotency, assignment/execution separation, future-effective history, household timezone).
4. **Evidence completion:** HTTP/WebSocket isolation, capability matrix, shared-base-after-personalization, required-item denial, effective-date preview, shared-browser outbox safety, dual-context sync, outbox-through-reload, and a11y e2e restored/expanded. Test-profile rate limits raised so dense e2e auth traffic is not throttled.

## Verification performed

Environment: Windows, Node.js `v24.16.0`.

| Command | Result |
| --- | --- |
| `npm run validate` | PASS (`lint` + `typecheck` + **25** Vitest tests) |
| `npm run build` | PASS (via e2e webServer) |
| `npm run test:e2e` | PASS — **16/16** (8 Chromium + 8 WebKit) |
| Linux Argon2 live probe | NOT RUN |
| Hosted HTTPS / physical phones | NOT RUN |

## Acceptance test results

1. **Populated migration** — PASS  
2. **Fresh/production startup** — PASS (hosted fail-closed + bootstrap unavailable). Live HTTPS `__Host-` cookie — NOT RUN  
3. **Six identities** — PASS (integration). Physical family checklist — NOT RUN  
4. **Credential controls** — PASS (policy, Argon2id PHC, throttle)  
5. **Claims and sessions** — PASS including Origin on login/claim. Hosted `__Host-` live — NOT RUN  
6. **Household isolation** — PASS (HTTP foreign IDs + WebSocket auth/origin isolation)  
7. **Capability matrix** — PASS (HTTP allow/deny matrix for enroll/manage/direct/propose/decide/execute/task)  
8. **Direct personalization** — PASS  
9. **Restricted proposal** — PASS  
10. **Prospective and historical integrity** — PASS (P0-001 regression + personalization snap)  
11. **Stable-base flow** — PASS (personalization then later shared revision compose preview)  
12. **Required structure** — PASS (API 403 + UI hides Routine for child)  
13. **Personal task visibility** — PASS  
14. **Authority-aware navigation** — PASS  
15. **Prospective feedback** — PASS (e2e effective date + read-only preview)  
16. **Optimistic execution regression** — PASS (Chromium + WebKit)  
17. **Shared-browser identity safety** — PASS (logout clears membership outbox; other membership empty)  
18. **Cross-device synchronization** — PASS (dual-context sync + reconnect refresh e2e)  
19. **Household time and accessibility** — PASS (timezone unit + phone a11y e2e)  
20. **Hosted family-evaluation evidence** — **NOT RUN** (no Project Lead-authorized HTTPS host; no physical phones)  
21. **Project verification** — PASS for validate/build/Playwright. Hosted-smoke on authorized origin — **NOT RUN**

## Deviations from brief revision

- None material. Hosted acceptance gaps remain explicit.

## Known limitations / evidence gaps

- Acceptance **20** and hosted portions of **21** remain **NOT RUN**.
- Linux Argon2 native verification remains deferred to an authorized host.

## Suggested follow-up

- Architecture reassessment of P0-002 r1 against this updated Build Report.
- Project Lead: provision HTTPS host for acceptance 20 / hosted 21.
