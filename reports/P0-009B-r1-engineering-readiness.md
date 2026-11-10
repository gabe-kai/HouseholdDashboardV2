# Engineering Readiness Review - BRIEF P0-009B r1

**Brief revision reviewed:** 1 (assigned)  
**Review round:** Initial consolidated pass  
**Readiness:** BLOCKER  
**Repository/Git state checked:** YES  
**Current branch:** `wall-refinements` @ `79fbb57` (`docs(P0-009B): tighten r2 wall contract and acceptance evidence`)  
**Integrated code baseline inspected:** `main` / `origin/main` at **`14af09e`** (PR **#30**, accepted P0-009A r2)  
**Working tree at review:** Clean. Docs-only delta from `14af09e` (P0-009B r2 brief, D-061, ARCHITECTURE / PROJECT_STATE / ROADMAP). No P0-009B implementation under `src/`, `db/`, `tests/`, or `.github/`.

> READY is the default when implementation can reasonably proceed. QUESTION/BLOCKER findings must be material, evidenced, and consolidated; ordinary implementation choices are not readiness gates.

## Verdict

**BLOCKER.** The assigned revision is **P0-009B r1**. That revision is not present as a complete implementation contract in this repository, was never committed as a recoverable brief file, and is explicitly superseded by **r2** before any Engineering readiness or implementation.

This review does **not** authorize implementation of r1 or r2. Await Architecture. This is also **not** a readiness disposition for r2; readiness does not carry across a material revision.

The P0-009A same-viewport checkpoint is **not** treated as a readiness or implementation blocker. The 3×2 layout remains provisional. Deployment, production-wall replacement, the root-route investigation, and live School/Meals/Calendar stay out of scope.

**No QUESTION.** The r1/r2 mismatch is a missing/superseded contract, not two equally implementable readings of one brief.

## Contract conflict (why r1 cannot proceed)

| Source | What it says |
| --- | --- |
| Assigned handoff | Review **P0-009B r1** against `main` `14af09e`; pending P0-009A same-viewport checkpoint is not a blocker; keep 3×2 provisional |
| `briefs/P0-009B-actionable-family-wall.md` | **Revision 2**, Status IN REVIEW. “Review and implement r2 only. r1 has not been reviewed or implemented; any earlier handoff naming r1 is superseded.” |
| Git history of that file | Only `79fbb57`. `git show 14af09e:briefs/P0-009B-actionable-family-wall.md` does not exist. r1 text is not recoverable from this repository. |
| D-061 | Introduced for r1, **refined for r2 before Engineering readiness**. Related brief: P0-009B r2. Active direction requires `GET …/people/:membershipId/day` (and the preview counterpart), not automatic use of the existing person-detail read. |
| `PROJECT_STATE.md` / `ROADMAP.md` / `ARCHITECTURE.md` | Next handoff is Engineering review of **r2**; r1 superseded before readiness/implementation |

r2’s revision history is the only remaining description of r1: “Initial production family-board brief; pending P0-009A visual checkpoint explicitly did not block functionality.” That is not a reviewable behavioral contract, route table, or evidence matrix.

Implementing from the assigned r1 handoff would contradict Active D-061 and the on-disk brief. Reconstructing r1 from memory would invent the contract.

## Decision alignment (inspected at 14af09e)

| Decision | Relevance to a family-board slice | Repo / conflict with assigned r1 |
| --- | --- | --- |
| **D-061** | Per-person automatic day reads, independent pane freshness, shared readonly preview adapter | Active as **r2**. Blocks implementing an r1 that reused existing person-detail for every pane. |
| **D-043–D-049** | Display principal, current-day projection, 60s stale, outbox/actor, promotion/privacy | Implemented. Existing person-detail includes unpromoted household-visible tasks (D-049/D-057 deliberate-detail rule). |
| **D-044** | Today-only materialize; no arbitrary-date API | Implemented (`materializeCurrentDayScope` → `materializeHouseholdDate`). |
| **D-045 / D-047** | 60s content/action lease from request start; minimal outbox | Implemented on the wall as one board-wide `lastAuthorizedAtRef`; preview has request-start fences. Per-pane leases are a required delta, not present today. |
| **D-057–D-059** | Member preview, fictional proof isolation, fixed target viewport | Implemented by P0-009A r2. Preview still uses one global `detail` and the existing person/occurrence preview routes. |
| **D-051 / D-054 / D-060** | Epoch, departure, hosted continuity | Out of scope except preservation. |

No new Active-decision contradiction was found **inside r2**. The contradiction is assigned **r1** vs Active D-061 / on-disk r2.

## Current-system claim check

The on-disk brief’s “Facts inspected at main 14af09e” table was verified against `14af09e` sources (same code on this docs-only branch). Claims match.

| Claim | Evidence | Verdict |
| --- | --- | --- |
| `DisplayApp.tsx` owns session/CSRF, one display sync, dashboard/detail recovery, display-session outbox; focused detail is global | `DisplayApp.tsx`: one `detail` / `personDetail` / `occurrenceDetail` / `pendingCue`; `display-outbox.ts` keyed by `hd-display-outbox-v1:${sessionId}` | Match |
| `display-presentation.tsx` shared by wall and preview; preview uses `DisplayPreviewHost` + isolated `preview-frame`, not credential-owning DisplayApp | Imports in `DisplayApp.tsx`, `DisplayPreviewHost.tsx`, `preview-frame.tsx`, `family-board-proof.tsx`; `main.tsx` mounts DisplayApp only for display session/path | Match |
| `GET /api/v1/display/dashboard` summaries; `GET /api/v1/display/people/:membershipId` recurring **and household-visible personal tasks including unpromoted**; occurrence detail has ordered steps + minimal `intendedStructure` | `display.ts` `getDisplayDashboard` / `getDisplayPersonDetail` (personal_tasks `visibility = 'household'`, **no** `show_on_shared_dashboard` filter) / `getDisplayOccurrenceDetail` | Match |
| Automatically calling existing person-detail for every pane would preload deliberate-detail content | Same person DTO is what `openDetail({ kind: "person" })` already fetches. Dashboard promoted list is filtered (`show_on_shared_dashboard = 1` and `status = 'open'`). | Match |
| Preview routes: member session + `household.display.manage` + same-household non-revoked display; execution intent stripped on occurrences | `route-policy.ts` principal `member`, grant `household.display.manage`; `requirePreviewDisplay` → `requireDisplayManage` + `requireActiveDisplay` (revoked/foreign → `NOT_FOUND`); `getPreviewOccurrenceDetail` strips `intendedStructure` | Match |
| Status POST retains display Origin/CSRF, mutation ID, current day/generation, kind, intended structure | `route-policy.ts` display POST status: `origin: mutation_when_configured`, `csrf: required`; `setDisplayStepStatus` | Match |
| `projectPersonalDay` ordering; `progress.ts` / `completion.ts` | `today-projection.ts` lines 86–92: in-progress non-Anytime, else daypart/definition/occurrence id; Anytime fallback | Match |
| Non-departed pending-sign-in people remain on the wall roster | `listHouseholdPeople`: `departed_at IS NULL`, status `'pending' \| 'active'`; dashboard `byPerson` maps that list | Match |
| D-045/D-047 60s; outbox stores minimal commands; P0-009A request-start freshness and held-response fences in preview | `staleMaxMs()` / `__HD_DISPLAY_FORCE_STALE__`; outbox item shape has no names/text; `deliverPreviewAfterHold` + `DisplayPreviewHost` `__HD_PREVIEW_*` seams | Match |
| P0-009A technically accepted at `14af09e` | PR #30 merge; `reports/P0-009A-r2-architecture-review.md` | Match |
| Project Lead dashboard-preview acceptance (r2 header / D-061) | Recorded in the r2 brief, D-061, ARCHITECTURE.md, PROJECT_STATE as 2026-10-28 direction. **Not** a measured viewport or physical-family-use result. | Match as a recorded Project Lead statement on this branch; not re-verified as a new checkpoint |

Person-detail **does not** carry household date / timezone / server time / activity generation / installation epoch. Those envelopes exist on dashboard and preview context objects. Occurrence detail carries `householdDate` plus `intendedStructure`.

Display `GET /dashboard` still uses in-handler `x-read-delay-ms` **without** `releaseSharedNow()`. Preview dashboard/person/occurrence use `deliverPreviewAfterHold` (read finishes, shared lease released, then delay + revalidate). Hosted profile ignores the delay header.

## Findings

### 1. BLOCKER - Assigned r1 is superseded and not a recoverable contract

**Brief section:** Assigned handoff (r1); on-disk brief header; Revision history; D-061; PROJECT_STATE.

**Repository finding:** The only P0-009B brief in git is Revision 2 at `79fbb57`. r1 was never committed. Active D-061 already encodes the r2 `/day` split, per-pane freshness, pending-sign-in roster, and preview counterpart.

**Why it matters:** Engineering cannot implement or accept-against a revision that is not in the repository. Choosing r2 silently would violate the assigned-revision rule. Implementing r1 from the handoff’s checkpoint-pending framing would violate the on-disk brief and D-061.

**Smallest correction:** Architecture confirms the assigned revision. If r2 is the contract, re-assign Engineering readiness against r2 (this inspection of `14af09e` facts can be reused; it is not itself an r2 READY). If r1 must be reviewed, restore a complete r1 brief as a numbered revision and reconcile it with D-061.

### 2. IMPORTANT - Existing person-detail cannot be the automatic pane read

**Brief section:** Current system → Display reads; r2 contract §12 (cited because r1 text is missing; this is the privacy fact at `14af09e`).

**Repository finding:** `getDisplayPersonDetail` returns every `visibility = 'household'` personal task for that owner, including unpromoted rows (`showOnSharedDashboard` is a field, not a filter). Private tasks are excluded. Resting dashboard summaries already omit unpromoted/private work.

**Why it matters:** Fan-out of the existing person route into six resting panes would put unpromoted household-visible titles/IDs/counts on the board without a deliberate shared-personal-detail action, contradicting D-049 / D-057. Occurrence-only fan-out (`GET …/occurrences/:id` per unfinished item) would avoid that leak but would not give a consistent per-person day envelope and would explode request count.

**Smallest correction:** Keep this as a contract requirement (r2 already names `GET /api/v1/display/people/:membershipId/day` and the preview counterpart). Do not “save a route” by auto-calling person-detail. Fastify can register `/people/:membershipId/day` beside `/people/:membershipId`; that is an ordinary implementation choice.

### 3. IMPORTANT - Wall freshness, pending cue, and detail are board-global today

**Brief section:** Current system → Display ownership; r2 contract §§7–11 (independent panes).

**Repository finding:** `DisplayApp` has one `detail` (overview XOR one panel), one `pendingCue`, one `lastAuthorizedAtRef`, and `markAuthorized()` on dashboard **or** detail success. A fresh dashboard poll therefore renews the whole wall’s 60s lease. Header “Saving checklist changes…” is not per person.

**Why it matters:** Independent sibling browsing, per-pane Retry/stale blanking, and “a fresh sibling cannot renew a failed pane” cannot be met by wiring six panes into the current focused-detail machine. This is a real implementation delta, not a product fork: keep **one** session/sync/outbox owner above new pane state.

**Smallest correction:** Per-pane request generation, error/retry, and request-start freshness; overlay outbox items by occurrence/step; preserve in-memory section/scroll keyed by membership/occurrence identity. Reuse P0-009A hold/fence patterns (`deliverPreviewAfterHold`, snapshot-then-fulfill in Playwright, `__HD_DISPLAY_FORCE_STALE__` / `__HD_PREVIEW_*`). Extend hosted-unavailable delay/fault seams onto the new day routes rather than holding the shared lifecycle lease across reset/restore.

### 4. NOTE - 3×2, idle, and the P0-009A checkpoint are not readiness gates

**Brief section:** Assigned handoff; D-059; r2 Why / composition / Product checkpoint.

**Repository finding:** Proof CSS already uses a 3×2 `.family-board-grid`. D-059 already says 3×2 is a design hypothesis, not a six-person cap. `DEFAULT_IDLE_MS = 90_000` exists on the wall. r2 records Project Lead preview acceptance dated 2026-10-28 without a measured viewport or physical-use result.

**Why it matters:** The assigned r1 handoff’s “checkpoint pending, not a blocker” agrees with D-059 and with r2’s statement that further visual refinement does not block local technical acceptance. Keep 3×2 provisional; record a reasoned alternative if six identities plus next instruction cannot fit without clipping at 3840 and 1920.

**Smallest correction:** None for readiness. Geometry evidence belongs in implementation (native wall at both CSS viewports; preview fit-scale only).

### 5. NOTE - Evidence, CI selection, and hold seams are implementable once a revision is assigned

**Brief section:** r2 acceptance matrix AT10–AT19 / implementation boundary (r1 matrix not in repo).

**Repository finding:** Playwright already splits phone `chromium`/`webkit` (`testIgnore **/z-p0-009a-*.spec.ts`), `chromium-display` 3840×2160, `chromium-preview`/`webkit-preview`, and Vite `vite-desktop`/`vite-touch`. Phone-core is `--grep-invert "P0-007|P0-009A"`. `x-read-delay-ms` exists; hosted ignores it. Display invalidation events carry `reason` only, not resource IDs.

**Why it matters:** A new `z-p0-009b-*.spec.ts` will run on phone-core unless ignored like 009A. Touch evidence must use `touchDragByCdp`, not `page.mouse`. Coalesced all-pane refetch is the available invalidation shape. WebKit coverage can follow the brief’s named subset; that split is a contract choice, not an evidence gap in the repo.

**Smallest correction:** When implementing an assigned revision, add explicit PR/RC/CI selection and keep wall-target tests off phone-core. Map every required matrix subrow in the Build Report; do not mark PASS from a suite name.

### 6. NOTE - Out of scope is already bounded in the repo

**Brief section:** Do not change; assigned out-of-scope list.

**Repository finding:** Live School/Meals/Calendar modules, `/` investigation, Railway deploy, and replacing the production wall are not required by D-061. The Vite fictional proof remains development-only (`family-board-proof.html` / `test:e2e:vite`). Small adaptation of shared presentation used by the proof is allowed by r2; rebuilding Family day is not.

**Why it matters:** Implementation must change the **production** wall presentation (that is the slice), but must not treat that as deploy authorization or live-household work.

**Smallest correction:** None.

## Consolidation check

- I inspected the relevant repository surface before returning this review: YES
- These are all currently known material readiness concerns: YES
- Any BLOCKER above cites concrete evidence: YES

Inspected: git status/log vs `14af09e`; `briefs/P0-009B-actionable-family-wall.md` r2; D-043–D-049, D-057–D-061; ARCHITECTURE.md P0-009A/B notes; `DisplayApp.tsx`, `display-presentation.tsx`, `DisplayPreviewHost.tsx`, `display-outbox.ts`, `display.ts` dashboard/person/occurrence/preview, `app.ts` display/preview routes and `deliverPreviewAfterHold`, `route-policy.ts` display/preview rows, `today-projection.ts`, `playwright.config.ts` / `validate-pr.yml` phone-core, proof CSS 3×2.

Did not run `validate:pr` / `validate:rc` (review-only; no implementation). Did not restore or invent r1 text. Did not inspect live Railway or household data.

## Recommendation

Return this **BLOCKER** to Architecture. Do not start P0-009B implementation on r1.

Architecture should either:

1. **Re-assign r2** as the implementation contract (on-disk brief, D-061, PROJECT_STATE already say this), then Engineering returns a dedicated r2 readiness. From this `14af09e` inspection, the r2 current-system claims match, the `/day` split is the correct privacy boundary, and no inspected repo fact would prevent a later READY once r2 is the assigned revision; or
2. **Restore a complete r1 brief** as a numbered file/revision and reconcile Active D-061 before asking for another r1 review.

Keep 3×2 provisional. Do not treat the pending P0-009A same-viewport checkpoint as an Engineering gate. Do not deploy, replace the live wall, investigate `/`, or add live School/Meals/Calendar in this slice.

## Durable discoveries

Repository facts Architecture already recorded in D-061 / the r2 brief; no additional decision is requested from this r1 pass:

- Existing `GET /api/v1/display/people/:membershipId` is the deliberate household-visible personal-task list, including unpromoted rows.
- Wall freshness and pending feedback are currently board-global in `DisplayApp`.
- Display invalidation is reason-only (`work` / `people` / `reset` / `restore` / `schedule` / `tasks`).
- Preview hold+revalidate already releases the shared lifecycle lease; wall dashboard delay currently does not.
