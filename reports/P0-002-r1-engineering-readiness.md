# Engineering Readiness Review - BRIEF P0-002 r1

**Brief revision reviewed:** 1
**Review round:** Initial consolidated pass
**Readiness:** READY
**Repository/Git state checked:** YES
**Current branch (if applicable):** `main` at `8004959` (P0-001 r1 merged via PR #1; up to date with `origin/main`)

> READY is the default when implementation can reasonably proceed. QUESTION/BLOCKER findings must be material, evidenced, and consolidated; ordinary implementation choices are not readiness gates.

## Findings

### 1. NOTE - Merged P0-001 baseline matches the brief’s Current system

**Brief section:** Current system; Dependencies — Merged P0-001 r1

**Repository finding:** `main` is at `8004959` with the accepted Morning Routine application: `src/{client,server,domain,shared}`, `db/migrations/001_initial.sql`, evaluation session cookie `hd_eval_session`, capabilities `manage_routine` / `execute_own_occurrence` on `members.capabilities_json`, revision-local `revision_steps` IDs (no stable shared item ID yet), and a single IndexedDB outbox key `hd-outbox-v1`. Active decisions D-002–D-010 (working-tree Architecture updates) align with the brief.

**Why it matters:** Confirms greenfield-relative extension of a real baseline; no conflicting second stack.

**Smallest correction or clarification:** None for readiness. Implementation will add forward migrations after `001_initial.sql` and replace evaluation auth for normal use.

### 2. NOTE - Preferred Argon2id package verified on Node 24 Windows

**Brief section:** Implementation boundary; Known risks — Native package compatibility; Dependencies

**Repository finding:** Outside the project tree, `@node-rs/argon2@2.2.0` installed cleanly under Node.js `v24.16.0` on this Windows host. Hash/verify with Argon2id, `memoryCost: 19456` (~19 MiB), `timeCost: 2`, `parallelism: 1` produced a `$argon2id$` PHC string; verify succeeded for the correct passphrase and failed for a wrong one. Published optionalDependencies include `linux-x64-gnu` / `linux-x64-musl` (and arm64) prebuilds; this environment has no Project Lead-authorized Linux host to execute a live Linux probe yet.

**Why it matters:** Satisfies the brief’s readiness requirement for the preferred dependency on the Windows development host. Linux target verification remains Build Report / hosted-smoke evidence when a host exists, not a gate for non-deployment implementation.

**Smallest correction or clarification:** None. Pin the verified version during implementation; record Linux hash/verify when the authorized host (or an equivalent Linux CI job) is available.

### 3. NOTE - Migration, overlays, proposals, and isolation are implementable against current schema

**Brief section:** Behavioral contract §§1, 6–14, 16; Acceptance tests 1, 6–13, 17

**Repository finding:**
- Populated P0-001 DBs can be migrated forward: preserve household/member IDs (members → membership identities), routine/occurrence/step_report/mutation_receipt rows; revoke `sessions`; map or re-issue grants via enrollment presets rather than inventing age-based authority.
- Stable shared item IDs can be added on `revision_steps` (and composition metadata) without rewriting `occurrence_steps` snapshots.
- Personal layers, proposals/decisions, and personal tasks are net-new tables/services; domain composition stays in `src/domain/`.
- Current outbox is a single global key and must become membership-namespaced with logout discard / reauth resume semantics.
- Cross-household isolation and capability matrix tests are ordinary extensions of current session-derived authorization patterns.

**Why it matters:** No repository contradiction with D-003/D-004/D-006–D-010. Exact preset→grant bundles, stable-ID assignment for historical steps, and table naming remain Engineering discretion constrained by acceptance tests (manager / direct / proposal behaviors).

**Smallest correction or clarification:** None required from Architecture before coding.

### 4. NOTE - Hosted HTTPS provider remains an acceptance gap, not an implementation blocker

**Brief section:** Behavioral contract §17; Acceptance tests 20–21; Known risks — Host authorization; Architecture handoff

**Repository finding:** No host, public origin, or backup provider is configured. Brief and D-009 require provider-neutral packaging, fail-closed hosted config, backup/restore commands, and pre-migration backup. Architecture and Project State explicitly allow non-deployment implementation to proceed; hosted technical `ACCEPTED` waits on Project Lead-authorized HTTPS + persistent storage + snapshots, plus physical-phone evidence.

**Why it matters:** Engineering will implement artifacts/docs/tests that can run locally and fail closed without a host. Acceptance tests 20 and hosted portions of 21 will be reported as NOT RUN / gaps until authorization.

**Smallest correction or clarification:** None for readiness disposition.

### 5. IMPORTANT - P0-002 planning artifacts are not yet on integrated `main`

**Brief section:** Current system; planned branch `brief/p0-002-authenticated-household-authority`

**Repository finding:** Working tree has uncommitted modifications to `ARCHITECTURE.md`, `DECISIONS.md`, `PRODUCT.md`, `PROJECT_STATE.md`, `README.md`, `ROADMAP.md`, and untracked `briefs/P0-002-authenticated-household-authority.md`. Committed `main` already contains merged P0-001.

**Why it matters:** Not a contract defect. Before Engineering opens the planned brief branch, Coordinator/Architecture should commit these durable planning updates to `main` so implementation does not absorb or disturb Architecture writebacks.

**Smallest correction or clarification:** Commit the P0-002 planning baseline on `main`, then authorize branching after readiness ACCEPT.

## Consolidation check

- I inspected the relevant repository surface before returning this review: YES
- These are all currently known material readiness concerns: YES
- Any BLOCKER above cites concrete evidence: N/A (no BLOCKER)
- Material QUESTIONS requiring Architecture choice before coding: NONE

## Recommendation

**READY** for P0-002 r1.

No Questions or Blockers. Contract aligns with merged P0-001 repository truth and Active D-002–D-010. `@node-rs/argon2@2.2.0` is verified for Argon2id on Node 24 Windows. Hosted provider TBD does not block non-deployment implementation; hosted acceptance tests remain explicitly gated.

Per Architecture handoff, Engineering will **not** begin implementation until Architecture responds to this readiness result. When authorized:

1. Prefer integrating Architecture’s uncommitted P0-002 planning artifacts onto `main` first.
2. Create `brief/p0-002-authenticated-household-authority`.
3. Implement only the r1 contract; leave deferred SSO/email/MFA/multi-household/chore-debt/etc. out of scope.

## Durable discoveries

- `@node-rs/argon2@2.2.0` installs and hashes/verifies Argon2id (19 MiB / 2 / 1) under Node.js `v24.16.0` on Windows; Linux prebuilds are published and should be smoke-tested on the authorized deploy OS during Build Report evidence.
- Current client outbox key `hd-outbox-v1` is not membership-scoped; P0-002 must change this for shared-browser safety.
- `revision_steps` currently lack stable logical item IDs; migration must add them without rewriting occurrence snapshots.
