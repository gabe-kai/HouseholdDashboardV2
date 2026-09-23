# Engineering Readiness Review - BRIEF P0-007B r1

**Brief revision reviewed:** 1  
**Review round:** Initial consolidated pass  
**Readiness:** READY  
**Repository/Git state checked:** YES  
**Current branch:** `brief/p0-007b-assignment-patterns-scheduled-work` @ `262f73a` (planning tip)  
**Integrated baseline inspected:** merge-base / `main` parent **`51322e0`** (PR #15; accepted P0-007A)  
**Working tree at review:** clean vs branch HEAD for implementation sources; planning docs only beyond `51322e0`

> READY is the default when implementation can reasonably proceed. QUESTION/BLOCKER findings must be material, evidenced, and consolidated; ordinary implementation choices are not readiness gates.

## Verdict

**READY.** D-038, D-039, and D-040 agree with P0-007B r1 and with the approved P0-007 proposal in `PRODUCT.md`. The brief’s **Current system** table matches the integrated repository at `51322e0`. Required deltas (closed assignment forms, deterministic anchors, scheduled-work composition, explicit Unassigned storage, through-013 populated fixture, structural-intent/group reconcile extensions) are intentional contract work against accepted A, not contradictions or missing high-authority decisions.

**No BLOCKER. No QUESTION.** Implementation waits for Architecture **ACCEPT / PROCEED** per brief Dependencies (this review does not authorize coding). P0-007C remains outside this assignment.

## Decision alignment

| Decision | Brief use | Repo / conflict |
| --- | --- | --- |
| **D-038** | Fixed / Take turns / Weekly pattern; dated eligibility; opportunity-count cycles; Unassigned when empty | Active for B planning, not implemented; A is fixed-owner only via `resolveAccountableMembers("responsibility", …)` first direct member |
| **D-039** | Base + named scheduled additions; one owner-setting addition owns whole occurrence; overlap rejection | Active for B planning, not implemented; responsibility revisions store base steps only |
| **D-040** | Shared read-only resolution; nullable Unassigned for unstarted responsibilities; transactional reconcile; stronger structural intent | Active for B planning; A keeps `accountable_member_id NOT NULL` + migration 013 same-household triggers; intended structure is revision + owner + step logical IDs only |

Prior D-018/D-019/D-023–D-037 behaviors the brief preserves (dated groups, locks, lifecycle, side-effect-free History, generation fence, responsibility uniqueness) are present on the baseline.

## Current-system claim check (selected)

| Claim | Evidence | Verdict |
| --- | --- | --- |
| Baseline `51322e0`; migrations tip **013** | `git merge-base` / `db/migrations/013_definition_kind_and_owner_integrity.sql` | Match |
| Responsibility uniqueness by definition/date; immutable kind | Migrations 011–013; `p0-007a` integrity tests | Match |
| Strict fixed `accountableMemberId`; non-Every-time steps rejected | `CreateResponsibilityFieldsSchema` in `schemas.ts`; Zod `.strict()` | Match |
| Responsibility resolution bypasses group expansion | `participation.ts` `resolveAccountableMembers` responsibility branch | Match |
| Saved 7-day preview is read-only; no draft/additions contract | `previewResponsibilityNextDays` in `store.ts` | Match |
| Dated group versions; active refs via `revision_group_sources` only | `updateGroup` / `deleteGroup` / `listGroupRoutineReferences` | Match |
| Owner NOT NULL; 013 rejects foreign/missing owners | Migration 011 rebuild; 013 insert/update triggers | Match |
| First-action intended structure + outbox generation fence | `IntendedStructureSchema`; `setStepStatus`; `outbox.ts` | Match |
| Responsibility UI is fixed-owner/base-work | `Responsibilities.tsx` Who picker + single Work section | Match |
| Populated upgrade fixture still stops at **010** | `tests/helpers/p010-fixture.ts`; no p011–p013 helpers | Match (B AT1 deliverable) |
| Prior screenshot dirs exist and must stay unchanged | `reports/p0-007a-r1-screenshots/` (+ earlier P0-004–006 dirs) | Match |

No Current-system factual contradiction requiring Architecture revision.

## Focused attention areas

### Deterministic rotation and group ordering

**Repo today:** Groups have dated membership versions with next-household-day effect (D-018/D-019). Live and versioned member reads use `ORDER BY membership_id`. Family `sort_order` is presentation-only for Today/History. No cycle anchors, saved ring order, weekly maps, or opportunity counters exist. `updateGroup` does **not** reconcile responsibility occurrences.

**Brief / D-038:** Durable saved order (initially family order, then editable); filter + append entrants by first admission after that ordering with membership-ID tie-break; retain anchors across group changes; opportunity-count modulo; no cursor/debt.

**Disposition:** Intentional greenfield resolver work beside `participation.ts` / plan helpers. Exact table vs JSON representation is Engineering discretion. IMPORTANT only as scope: group membership edits must gain responsibility reconcile like calendar/plan refine paths.

### Scheduled-work ownership

**Repo today:** Responsibility plans are base steps only. Routine `personal_additions` are a different model (personal layer, `source: shared|personal`) and are not drop-in reusable for household scheduled work.

**Brief / D-039:** Named additions with weekdays, inherit vs own assignment, compose base-then-additions, one owner-setting addition owns the whole occurrence, reject overlapping owner-setting weekdays.

**Disposition:** Clear contract. Ordinary choices: storage layout, heading/provenance columns, addition editor chrome within existing focused-editor shell.

### Unassigned storage compatibility

**Repo today:** `occurrences.accountable_member_id TEXT NOT NULL`; 013 requires a same-household membership row; `getOccurrenceView` **JOIN**s memberships on owner; materialize **skips create** when `planOwner === null`; Today filters by session member; History/Household group by owner name; types use non-null `accountableMemberId` (preview day type already allows null for non-applicable days only).

**Brief / D-040:** Nullable accountability only for unstarted responsibilities; keep definition/date identity through Unassigned; Plan/Household/History visibility; no executor until repaired; forward migration refining 013 rather than editing applied files.

**Disposition:** Expected schema/projection/materialize delta. Audit all owner joins, cleanup, and serialized payloads during implementation. Not a blocker—the brief already names the forward-migration path.

### Populated through-013 migration

**Repo today:** Tip migration **013**. Upgrade helpers: `p001`, `p004b`, `p008`, `p009`, `p010` only. P0-007A AT1 upgrades a populated **010** database through 013 in-test.

**Brief AT1:** Add a populated through-013 baseline while retaining older fixtures; preserve A Cats/Trash IDs, snapshots, receipts, reset generation/floor; map fixed plans losslessly before richer/Unassigned writes.

**Disposition:** Required delivery item. Ordinary Engineering work; no missing decision.

### Structural-intent / reconciliation safety

**Repo today:** Intended structure = `revisionId` + `accountableMemberId` + `stepLogicalIds`. Server reconcile updates unstarted responsibility owners/work for plan/calendar ranges. Client `reconcile.ts` is pending-step overlay only. Group updates do not drive responsibility reconcile. Injectable failure hooks exist for calendar/step/family-order/clear paths.

**Brief / D-040:** Extend intent to effective owner/work/provenance (including independent group versions); both transaction orders for edit-vs-first-action; atomic plan/group + dependent rows + receipts; legacy A payloads cannot erase B content.

**Disposition:** Clear extension of A’s lock/receipt channel. Fingerprint/structure-version representation is Engineering discretion within the contract. IMPORTANT as evidence load (AT10–11), not as ambiguity.

## Findings

### 1. NOTE — Unassigned requires a broad but specified storage/projection pass

Nullable owner, softened 013 constraints, LEFT JOIN / Unassigned summaries, and materialize-create-when-unassigned (instead of skip) are deliberate B changes. Audit readers rather than UI-filter alone.

### 2. NOTE — Group-backed cycles need durable order + responsibility reconcile

`ORDER BY membership_id` and routine-only `listGroupRoutineReferences` are insufficient for B. Add saved ring/order, exclusion refs, used-by/deletion guards across base and addition sources, and next-day reconcile of unstarted responsibility rows.

### 3. NOTE — Controlled household-date seams must cover Saturday Kitchen and multi-day Cats evidence

AT4–6 require controlled dates and “advancing the server’s test date before execution.” Store `householdDateNow(ctx, now?)` accepts an optional instant, but most paths use wall-clock `new Date()`, and e2e historically backdates schedule/revision rows. Prefer a test-only controlled-date seam (or equivalent existing pattern) so assertions stay deterministic on any host weekday without weakening production behavior—same class of discipline as the P0-006B AT9 school-day stabilization.

### 4. NOTE — Acceptance surface is large but locally testable

AT1–16 demand Kitchen/Bathroom/Cats/Trash UI, Unassigned, races, outbox, live convergence, History/reset, PR/RC with prior screenshot dirs preserved. Use the brief’s checkpoints (migrate/resolver → Kitchen UI → Cats/Bathroom/Unassigned → full gates) inside one r1; do not treat checkpoints as permission to ship backend-only.

## What is not a readiness issue

- Exact assignment/addition table or JSON column names.
- Helper module naming (`assignment.ts` vs folding into `participation.ts`).
- Focused-control layout within existing Plan/editor primitives.
- Bounded request/preview limits.
- P0-007C Today/Household presentation (explicitly out of B).
- Weighted/fairness/helpers/Claim/Cover and other deferred Product scope.

## Implementation posture (after ACCEPT / PROCEED only)

1. Forward migration(s) after 013: assignment content/anchors/sources/exclusions, scheduled additions/provenance, nullable Unassigned for unstarted responsibilities with refined owner triggers; populated through-013 fixture.
2. Pure assignment/composition resolver shared by draft/saved preview, materialize, reconcile, and first-action validation; extend structural intent beyond revision ID alone.
3. Group next-day reconcile for consuming responsibilities; widen used-by/deletion/fixture-cleanup inventories.
4. Responsibilities UI: Fixed / Take turns / Weekly pattern, group+exclusions, scheduled-work editors, draft Upcoming, Unassigned warnings; Today headings; History Unassigned group; live invalidation paths.
5. Extend protected behaviors, sync matrix, route policy; `validate:pr` / `validate:rc`; new screenshots only under `reports/p0-007b-r1-screenshots/`; prior evidence byte-stable.

## Architecture response requested

**ACCEPT / PROCEED** on **P0-007B revision 1**, or name any material contract correction that increments the revision.

No product decision is required for readiness. No deployment is requested. Validation remains local.
