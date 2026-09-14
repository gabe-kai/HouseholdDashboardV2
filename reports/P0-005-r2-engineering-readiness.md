# Engineering readiness — P0-005 r2

**Brief:** `briefs/p0-005-multiple-household-routines.md` revision **2**  
**Compared against:** branch `brief/p0-005-multiple-household-routines` @ `7704785` (r2 planning on top of committed r1 multi-routine implementation `cd887e9`/`2f37485`; integrated `main` baseline `93ef494`)  
**Disposition:** **READY**  
**Date:** 2026-09-14  
**Scope note:** Fresh review for r2 only. r1 readiness and Build Report do **not** certify r2.

## Verdict

**READY.** D-023 and the r2 brief agree on the user-visible lock and same-date edit contract. The branch already carries the multi-routine / daypart / archive / scoped personalization foundation from r1. Remaining work is a bounded structural-lock and same-intended-date supersession delta on that foundation, with clear AT19 evidence requirements and local PR/RC gates. No material product ambiguity that would force Architecture to choose between competing interpretations.

Implementation must wait for Architecture’s disposition of this review (requested review-only).

## Repository baseline (evidence)

### Already present (r1 foundation on this branch)
- Migration `005_multiple_household_routines.sql`: multi-definition, dayparts, archive cutoff, definition-scoped personal uniqueness, proposal `definition_id` / `association_status`, assignees retargeted to `household_memberships`.
- Store/API: `listRoutines` collection, explicit definition routes, archive, definition-scoped personal/proposals/preview, daypart-ordered materialize.
- Client: `Routines.tsx` list/detail/create/edit, Today dayparts, Personalize routine select, used-by multi-routine projections.
- Evidence seams: `tests/helpers/p004b-fixture.ts`, `tests/integration/p0-005.test.ts`, `tests/e2e/z-multiple-routines.spec.ts`, PB-25–27, `validate:pr` / `validate:rc`.

### Active decisions
- **D-023** Active and aligns with brief §1 / AT19 (first-action lock, per-person divergence, same-intended-date refine, atomic edit/action, pending first-action protection).
- **D-020 / D-021 / D-022** remain Active for identity, dayparts, archive; r2 does not reopen them.
- **D-003 / D-008** snapshot immutability for **started**/historical occurrences remains; D-023 explicitly carves unstarted reconcile / same-date supersession.

### Brief “Current system” table
Still describes clean `main` @ `93ef494` singleton facts. Accurate as the pre-P0-005 integration baseline; **stale as a description of this branch**, which already has multi-routine r1. Not a readiness blocker—implementation should extend the branch foundation, not re-derive singleton→multi from `main`.

## Focused r2 gap analysis (intentional contract deltas)

| Area | Current behavior (repo) | r2 required | Severity |
| --- | --- | --- | --- |
| Same-day / same-intended-date edits | `createRevision` floors `effectiveDate` at **tomorrow** and `nextFreeRevisionDate` drifts past occupied dates (`store.ts` ~1229–1233; client always passes next free date) | Unstarted today may absorb edits; repeated edits keep the **explicit intended date** without drifting | IMPORTANT |
| Unstarted occurrence structure | Materialize snapshots once; later definition edits do not rewrite occurrence rows | Unstarted applicable occurrence may reconcile **whole** structure (title/steps/order/obligations/daypart/audience/personal composition) | IMPORTANT |
| First-action lock | Any status write updates steps/reports; no started/locked marker; undo not distinguished for structure | First valid complete / as-needed complete / Not needed **monotonically** locks that occurrence; undo does not unlock | IMPORTANT |
| Per-person group divergence | One revision applies to all members’ materializations equally for a date | Lock is per definition × membership × date; unstarted peer may update while started peer stays frozen | IMPORTANT |
| Edit vs first-action race | Separate transactions; no combined ordering rule | Atomic resolve: either action commits on updated structure and locks, or edit leaves old occurrence locked and becomes effective later—**no mixed snapshot** | IMPORTANT |
| Pending outbox protection | Outbox overlays step **status** only (`reconcileOccurrence`); refresh can replace occurrence structure under the client | Pending first-execution intent ⇒ treat occurrence as locally started; never apply structural refresh over it | IMPORTANT |
| Reconnect / stale response | Existing reconnect/visibility/outbox suites; no lock-aware structural guard | Invalidation/re-read must re-evaluate per-occurrence lock and preserve local first-action protection | IMPORTANT |
| Save UX feedback | Future-effective messaging; list/detail show upcoming revisions | Household copy for started vs not-started people; intended date + who changes today vs protected | IMPORTANT |
| Revision uniqueness | `UNIQUE (definition_id, effective_date)` forces date drift or conflict on same-date rewrite | Same-intended-date refine needs replacement/supersession (Engineering choice: replace row, or versioned same-date like group membership) | NOTE |
| Group edit (Kids) vs routine edit | Group membership still next-day (P0-004B / §5) | Keep group next-day rule; do not conflate with routine structural absorb into unstarted today | NOTE |
| ARCHITECTURE older lines | Still state “never rewrites an existing occurrence” / default append-tomorrow in r1 narrative | r2 planned section + D-023 already record the override; factual writeback during implementation | NOTE |

No **BLOCKER**: prerequisites (Node 24, SQLite, PR/RC, D-023, multi-routine seams, AT fixtures) are available. No **QUESTION**: lock boundary, first-action set, per-person scope, same-date refine, and race outcomes are specified tightly enough that wrong interpretation is unlikely; remaining choices are local supersession/API/UI details.

## Ordinary implementation choices (Engineering will make if authorized)

1. **Started detection:** Derive from existence of any committed step report / non-open first action for that occurrence (or explicit `started_at` column if clearer for queries)—preserve monotonicity across undo.
2. **Same-date supersession:** Prefer replacing or version-superseding the shared/personal revision at the intended `effective_date` while reconciling only **unstarted** occurrence snapshots for that date; keep append-only history for started/historical rows.
3. **Today default:** When all applicable today’s occurrences are unstarted (or no rows yet), default edit target to **today**; if any relevant started members exist, surface who is protected and choose today-for-unstarted vs explicit later date per brief feedback rules.
4. **Atomic race:** Single SQLite transaction ordering edit vs `setStepStatus`; define conflict/replay digests to include intended date + lock-relevant identity.
5. **Client:** Extend outbox/reconcile so pending first action blocks structural apply; keep membership-isolated outbox; update Routines save feedback copy.
6. **Evidence:** New focused domain/integration/HTTP/browser coverage for AT19; screenshots under `reports/p0-005-r2-screenshots/` only; leave r1 screenshot dirs untouched; retain prior PB/regression gates.

## Acceptance-test / regression notes

- AT1–18 remain required; r1 suites are a starting point but **must be updated** where they encode tomorrow-only append / “never rewrite occurrence” assumptions that r2 deliberately changes for unstarted rows.
- **AT19** is new and non-optional: same-date refine while unstarted; lock on first valid action (all four first-action kinds); undo does not unlock; group-backed peer divergence; deliberate future date; pending outbox; reconnect; edit/action race.
- Preserve P0-001–004B isolation, grants, group next-day, archive cutoff, and multi-routine identity/scoping regressions under `validate:pr` / `validate:rc`.
- Local disposable DBs and controlled dates only; no deploy / host-clock / overnight wait.

## Consolidated findings

| Severity | Item |
| --- | --- |
| BLOCKER | None |
| IMPORTANT | Implement D-023 structural lock + unstarted whole-structure reconcile + same-intended-date refine (replace r1 tomorrow-floor / next-free drift for the editable cases). |
| IMPORTANT | Atomic edit↔first-action ordering and pending first-action outbox/reconnect protection (no mixed snapshots). |
| IMPORTANT | Per-definition × membership × date lock divergence for group-backed audiences; save/Today feedback in household terms. |
| IMPORTANT | Extend AT evidence (especially AT19) and adjust r1 tests that assert date-append-only behavior for unstarted edits; new screenshots under `p0-005-r2-screenshots/`. |
| NOTE | Supersession representation under `(definition_id, effective_date)` uniqueness is Engineering discretion within D-023. |
| NOTE | Brief “Current system” still narrates `main` singleton; Architecture may refresh that table to branch truth after acceptance. |
| NOTE | Hosted/physical evidence not required for readiness or implementation. |

## Disposition

**READY** for Architecture ACCEPT / PROCEED against P0-005 **r2**. Do not implement until disposition; do not treat r1 acceptance or FIX REQUIRED as r2 completion.
