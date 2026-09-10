# Engineering Readiness Review - BRIEF P0-003 r1

**Brief revision reviewed:** 1  
**Review round:** Initial consolidated pass  
**Readiness:** READY  
**Repository/Git state checked:** YES  
**Current branch (if applicable):** `main` at `aa28f7e` (P0-002 r1 technically accepted; PR #5 merge). Working tree also holds uncommitted Architecture planning writebacks for P0-003 (`ARCHITECTURE.md`, `DECISIONS.md`, `PROJECT_STATE.md`, `ROADMAP.md`, untracked brief).

> READY is the default when implementation can reasonably proceed. QUESTION/BLOCKER findings must be material, evidenced, and consolidated; ordinary implementation choices are not readiness gates.

## Findings

### 1. NOTE - Merged P0-002 baseline matches the brief’s Current system

**Brief section:** Current system; Dependencies

**Repository finding:** Integrated `main` provides React/Vite + Fastify + SQLite, membership-namespaced IndexedDB outbox, WebSocket invalidation → authoritative reads, Vitest domain/integration suites, and ten Playwright scenarios × Chromium/WebKit (including the escaped proposal-status defect). Commands `npm run validate`, `npm run build`, `npm run test:e2e:chromium`, `npm run test:e2e`, `npm run dev`, and `npm run dev:lan` exist. No `.github` workflows and no protected-behavior / sync-matrix / route-policy inventory artifacts yet—exactly as the brief states.

**Why it matters:** P0-003 is an audit-and-extend slice on a real, accepted baseline, not a greenfield rewrite.

**Smallest correction or clarification:** None for readiness. Prefer committing Architecture’s P0-003 planning writeback on `main` before opening the implementation branch so Engineering does not absorb or disturb those docs (same hygiene as P0-002 readiness).

### 2. NOTE - Large share of acceptance evidence already exists; gaps are focused

**Brief section:** Behavioral contract §§1–10; Acceptance tests 1–9; Known risks — existing tests may already satisfy many catalog rows

**Repository finding (reuse vs missing):**

| Area | Status | Primary evidence / gap |
| --- | --- | --- |
| Escaped proposal-status defect | **PASS (retain)** | `tests/e2e/morning-routine.spec.ts` — manager approve → open Personalize shows Approved without reload |
| Cross-household HTTP + WS isolation | **PASS** | `tests/integration/p0-002-http.test.ts` |
| Grant / capability matrix (HTTP) | **PASS** | same file |
| Origin allow/deny (+ LAN) | **PASS** | `p0-002-http` + `src/server/origin.test.ts` |
| Step mutation-ID idempotency | **PASS** | `tests/integration/p0-001.test.ts` |
| Optimistic delayed checklist UI | **PASS** | e2e rapid checklist under delayed mutations |
| Outbox reload + logout discard | **PASS (partial vs AT6)** | e2e; membership keying exists; stronger “other identity does not drain foreign key without logout” still thin |
| WS reconnect + post-reconnect authoritative progress | **PASS (partial vs AT7)** | e2e reconnect; no explicit duplicate/missed invalidation or `visibilitychange` automated case |
| Pre-P0-002 populated migrate | **PASS (partial vs AT4)** | Inline fixture in `p0-002.test.ts` (`001` populate → `migrate`); logical-item path in `p0-002-http`; **idempotent re-apply** and fuller semantic asserts still needed |
| Personal-task visibility | **PARTIAL** | Private hide from non-owner in store/integration; household-visible list/filter + UI projection gaps |
| Stale / out-of-order response arbitration | **MISSING** | `src/domain/reconcile.ts` untested; no late-HTTP-cannot-clobber-newer-intent case |
| CSRF missing/wrong deny | **MISSING as focused AT** | CSRF enforced in `app.ts` preHandler; helpers always send valid tokens—no dedicated deny assertions |
| Route-policy inventory + completeness | **MISSING** | All `/api/v1` routes live in `src/server/app.ts` (~23 HTTP + 1 WS + conditional test bootstrap); no inventory module/test |
| Synchronization matrix artifact | **MISSING** | Broadcast map is reconstructible from `broadcast()` call sites; no durable `docs/` matrix |
| PR/RC npm scripts + GitHub Actions | **MISSING** | `validate` = lint+typecheck+vitest only; no `.github/` |

**Why it matters:** Success is meaningful contract evidence, not test count. Implementation should catalog and map first, then add only the missing rows—especially stale arbitration, sync-matrix completeness, route inventory, migration idempotency/semantics, personal-task visibility API, and duplicate/missed WS / visibility recovery.

**Smallest correction or clarification:** None required from Architecture. Engineering will treat the existing inline populated `001` fixture as the supported migration baseline named in the brief unless Architecture later changes that baseline by decision.

### 3. NOTE - Machine-checked route-policy inventory is feasible without a new framework

**Brief section:** Behavioral contract §6; Acceptance test 3; Implementation boundary

**Repository finding:** Every `/api/v1` HTTP and WebSocket handler is registered on the root Fastify instance inside `buildApp` (`src/server/app.ts`). Plugins (`cookie`, `websocket`, `helmet`, `rate-limit`, optional `static`) do not add API routes. Fastify 5 supports `onRoute` collection and `hasRoute({ method, url })` after `ready()`—sufficient for an automated completeness check. Policy dimensions today split across: preHandler (origin/CSRF/session for unsafe methods), WS handler (origin + session), store grants/ownership/visibility, and profile-gated registration of `POST /api/v1/test/bootstrap-claim`.

**Why it matters:** A TypeScript (or JSON) inventory adjacent to server/tests, plus a Vitest completeness assertion, satisfies the brief without a generalized auth framework. Public and test-only routes must be explicit inventory rows.

**Smallest correction or clarification:** None. Exact inventory file location and shape are ordinary Engineering discretion (prefer machine-checkable module over prose-only duplication).

### 4. NOTE - Synchronization matrix is maintainable from current broadcast surface

**Brief section:** Behavioral contract §§4–5; Acceptance test 2

**Repository finding:** Mutations that call `broadcast()` emit `household_change` with resources `occurrence | routine | proposal | personal_task | membership`. Intentional non-emitters include login, logout, bootstrap-claim, and reads. Proposal decide may emit `proposal` and conditionally `routine`. Client recovery paths (WS message → urgent supporting-data / Today refresh; reconnect; `visibilitychange`) already exist in `src/client/App.tsx` / `api.ts`.

**Why it matters:** A concise `docs/` matrix row per mutation-producing API is feasible and can stay in sync via review obligation + tests that assert broadcast side effects where missing. Duplicate/late/missed events remain invalidation-only; tests should prove safety and authoritative re-read, not event-as-state.

**Smallest correction or clarification:** None.

### 5. NOTE - Validation tiers and GitHub Actions are straightforward; PL owns required-check

**Brief section:** Behavioral contract §§11–12; Acceptance tests 10–12; Dependencies; D-011

**Repository finding:** Developer tier already matches `npm run validate`. Chromium-only and full e2e scripts exist (`test:e2e:chromium`, `test:e2e`). Playwright uses sequential `workers: 1`, Pixel 7 / iPhone 13 projects, isolated e2e SQLite ports, and installs browsers in the npm scripts (not during `npm ci`). No repository secrets are required for local or CI test runs. Active D-011 aligns with local/CI fixtures vs release-candidate hosted evidence. Branch protection “required check” is explicitly out of Engineering control (brief AT11).

**Why it matters:** Adding `validate:pr` / `validate:rc` (names discretionary) and a least-privilege Node 24 Actions workflow that runs the PR command is ordinary implementation. WebKit remains RC-tier per brief; Chromium is the PR browser. First CI run may need Playwright OS deps (`npx playwright install --with-deps chromium` or equivalent)—environment detail, not a contract question.

**Practical Chromium/WebKit note:** Current suite is 10 scenarios × 2 browsers, single-worker, long timeouts—acceptable for RC wall time on Actions if browsers are cached/installed once per job. Reliability risk is environmental (WebKit on Linux Actions) more than product logic; brief already allows Architecture to retier if measured cost/reliability demands it. Engineering will report RC WebKit results honestly if the runner is unreliable.

**Smallest correction or clarification:** None for coding. Architecture/PL should not treat “required check configured” as Engineering acceptance evidence until the Project Lead confirms repository settings.

### 6. IMPORTANT - Uncommitted P0-003 planning artifacts sit beside readiness

**Brief section:** Engineering readiness; Repository safety (AGENTS/CONTRIBUTING)

**Repository finding:** Alongside merged `main`, the working tree currently has modified `ARCHITECTURE.md`, `DECISIONS.md`, `PROJECT_STATE.md`, `ROADMAP.md`, and untracked `briefs/p0-003-regression-safety-contract-hardening.md` (this review’s authoritative brief path). Engineering inspected those contents for contract alignment and did not discard or absorb them into unrelated commits.

**Why it matters:** Not a contract BLOCKER. Implementation branch authorization should follow the Coordinator/Architecture commit of the planning baseline so readiness writebacks and implementation stay separable.

**Smallest correction or clarification:** Commit planning + this readiness report on the intended branch sequence Architecture prefers; then authorize `brief/p0-003-…` implementation.

## Consolidation check

- I inspected the relevant repository surface before returning this review: YES  
- These are all currently known material readiness concerns: YES  
- Any BLOCKER above cites concrete evidence: N/A (no BLOCKER)  
- Material QUESTIONS requiring Architecture choice before coding: NONE  

## Recommendation

**READY** for P0-003 r1.

No Questions or Blockers. The brief aligns with merged P0-002 repository truth and Active D-002–D-004, D-006, D-008, D-011. Machine-checked route inventory, sync matrix, catalog mapping, focused missing tests, PR/RC scripts, and GitHub Actions are all implementable with existing Vitest/Playwright/Fastify/SQLite tooling without new frameworks or hosted secrets.

**Ordinary implementation choices Engineering will make unless Architecture objects after this review:**

1. Durable catalog + sync matrix under `docs/`; route-policy as a TS module next to server/tests with an `onRoute`/`hasRoute` completeness test.  
2. Promote/reuse the existing populated `001` inline fixture as the named migration baseline; add idempotent re-migrate + semantic asserts.  
3. Add domain/integration coverage for `reconcileOccurrence` / stale response arbitration; strengthen outbox membership isolation, duplicate/missed WS + visibility recovery, personal-task visibility API (and light UI only if needed for AT9).  
4. Script names approximately `validate:pr` and `validate:rc`; Actions on `pull_request` + `push` to `main`, Node 24, lockfile, no deploy secrets.  
5. Refactor production code only if a demonstrated enforcement gap cannot be tested at the boundary; record any such refactor in the Build Report.

**Do not begin implementation until Architecture responds to this readiness review.**

## Durable discoveries

Repository facts Architecture may promote (if not already covered by the planning writeback):

- Fastify route completeness is practical via `onRoute` / `hasRoute`; no separate router registry exists today.  
- Supported pre-P0-002 migration baseline already lives as an inline populated `001` fixture in `tests/integration/p0-002.test.ts` (not a checked-in `.sqlite` dump).  
- CSRF deny paths and `reconcileOccurrence` lack dedicated automated evidence despite production enforcement/use.  
- GitHub Actions + required-check configuration remain split: Engineering supplies workflow; Project Lead enables “required” if desired.
