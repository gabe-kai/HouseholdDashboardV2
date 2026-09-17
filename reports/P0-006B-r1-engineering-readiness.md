# Engineering readiness — P0-006B r1

**Brief:** `briefs/p0-006b-contextual-routine-applicability.md` revision **1**  
**Compared against:** integrated `main` @ `7cba3a6` (P0-006A r2 merged via PR #12; includes toast/CI fix `8e57b09` and B planning commit `ceab5a5`)  
**Disposition:** **READY**  
**Date:** 2026-09-16  
**Scope note:** Fresh review for **P0-006B revision 1** against the accepted P0-006A foundation. No re-review of A or C. Implementation waits for Architecture’s disposition of this review.

## Verdict

**READY.** D-029–D-031 and the r1 brief agree on a bounded second P0-006 slice: closed step applicability, one household school calendar with retained editions, compose-then-filter evaluation, unstarted reconciliation without rewriting protected snapshots, explicit `household.schedule.manage`, and compatibility-preserving migration/replay. The accepted A foundation on `main` already supplies Plan shell, `/household/*` History API destinations, focused step drafts, toast/dirty navigation, OrderedList reorder, and local PR/RC+Vite evidence tiers that this slice extends rather than replaces.

No material product ambiguity that would force Architecture to choose between competing interpretations of School nights, unconfigured vs no-school, calendar vs shared-rule governed ranges, or History authority. Remaining work is large but contract-bounded; ordinary storage/route/module/sync-resource choices stay Engineering discretion.

Implementation must wait for Architecture’s disposition (requested review-only). Before coding, create `brief/p0-006b-contextual-routine-applicability` from this integrated `main` tip under the Project Lead’s Git workflow.

## Repository baseline (evidence)

### Present on `main` @ `7cba3a6` (accepted A + planning)

| Surface | Verified fact |
| --- | --- |
| Migrations | Through `008_widen_routine_mutation_receipt_kinds.sql`; **no** school-calendar tables or applicability columns. |
| Step schemas | `ChecklistStepInputSchema` = text / obligation / optional `logicalItemId` only (`src/shared/schemas.ts`). |
| Grants | `GrantSchema` has no `household.schedule.manage`; manager preset includes `routine.shared.manage` but not calendar authority (`src/shared/grants.ts`). |
| Sync | `SyncNotification.resource` union: occurrence / routine / proposal / personal_task / membership / group — **no** calendar resource. |
| Navigation | `nav.ts` has `/household`, people, groups; **no** `/household/school-calendar`. Household Approvals/History/Activity remain local leaves under `/household`. |
| Recurrence / time | `validateRoutineSteps` requires ≥1 Required shared step; `time.ts` supplies household-local dates and `addHouseholdDays` (calendar-day arithmetic). |
| Composition | `composeMorningRoutine` composes shared + anchored personal before any filter; used from store materialization/preview paths. |
| Reconciliation | `ensureOccurrence` / `rewriteUnstartedOccurrence` / `occurrenceSharedStepsMatchRevision` compare **full** shared lists; empty-step repair reinserts when length is 0. |
| History | `historyForDate` **delegates to** `materializeForDate` (not an isolated historical projection). |
| Client foundation (A) | Plan label, quiet chrome, focused `RoutineFocusedEditor`, More lifecycle, toast, dirty Keep/Discard, OrderedList drag/Move, Vite + built SPA deep-link evidence, geometry/touch specs. |
| Evidence | `validate:pr` / `validate:rc` with Chromium, desktop-scoped, WebKit, Vite smoke; populated P0-001 / P0-004B / P0-005 migration fixtures; **no** populated through-008 B baseline yet. |
| Screenshots | Prior A evidence under `reports/p0-006a-r2-screenshots/` present; must remain zero-diff. |

### Active decisions (r1-aligned)

- **D-029** — Closed applicability vocabulary + one household school calendar; School nights = next household date is a school day.
- **D-030** — Immutable calendar editions effective from household today; reconcile unstarted work; retain edition/provenance on occurrences; do not reinterpret past/started snapshots.
- **D-031** — `household.schedule.manage`; manager preset + backfill only for existing `routine.shared.manage` holders; forward migration defaults to Every time; populated through-008 fixture.
- **D-027 / D-028** — Reuse A shell, saved destinations, focused drafts, toast, accessible ordering.
- **D-021 / D-023–D-025** — Preserve recurrence/dayparts, locks, governed intervals, Delete/End except specified evaluation changes.
- **D-004 / D-011 / D-006 / D-008 / D-018 / D-020** — Authoritative shared state, durable intent, membership/group/personal anchors (unchanged authority model).

### Brief “Current system” claims

Accurate against `7cba3a6` for schema/store/client/sync facts. One **baseline update** relative to the brief’s write-time wording:

- Brief recorded inspected A tip `183bc41` and local `main` still `31aad37`. **As of this review,** A is merged to `main` at `7cba3a6` (PR #12). Dependencies’ “integrate A before implementation” prerequisite is satisfied for branching; do **not** implement B on a pre-A main tip.

### Working-tree / Git note

Review performed on clean `main` @ `7cba3a6` tracking `origin/main`. Planned implementation branch `brief/p0-006b-contextual-routine-applicability` is not yet created. Do not absorb unrelated dirty work into an implementation commit. Project Lead manages branch/commit/PR.

## Focused r1 gap analysis (intentional contract deltas)

| Area | Current (`7cba3a6`) | r1 required | Severity |
| --- | --- | --- | --- |
| Applicability model | No rule on shared/personal/proposal steps | Closed 7-way rule; default Every time; School nights via D+1 | IMPORTANT |
| School calendar | None | `/household/school-calendar`; years/exceptions; editions; unconfigured ≠ no-school | IMPORTANT |
| Authority | No calendar grant | `household.schedule.manage`; read for all active members; preset + selective backfill | IMPORTANT |
| Composition | Full list always shown/executed | Compose full order, then filter; keep personal relative to surviving neighbors | IMPORTANT |
| Empty / repair | Empty shared list reinserts revision steps | No false empty completion; no empty-list repair of filtered-out steps | IMPORTANT |
| History coupling | `historyForDate` → `materializeForDate` → may rewrite unstarted | Past snapshots (started **and** unstarted) authoritative; no calendar reinterpretation | IMPORTANT |
| Reconciliation span | Plan edits use D-024 ranges | Calendar edits cross definitions/intervals; School-night lookahead clipped at today | IMPORTANT |
| Sync | No calendar invalidation | New resource (or documented equivalent); refresh Today/preview/calendar without routine version bump | IMPORTANT |
| Digests / replay | Digests omit applicability | Bind rules; legacy Every-time replay compatibility; reject silent nondefault clears | IMPORTANT |
| Migration / fixture | Through 008; no through-008 populated B baseline | Forward migrations; Every-time default; disposable populated through-008 fixture | IMPORTANT |
| UI | Focused step editor has text/obligation only | Applicability in selected-step editor; dated plan preview with reasons; calendar focused Edit | IMPORTANT |
| Evidence | A matrix | AT1–14; Chromium+WebKit journey; Vite+SPA calendar deep links; prior screenshots unchanged | IMPORTANT |

## Ordinary implementation choices (Engineering will make if authorized)

1. **SQL/table/column names** for calendar years, exceptions, editions, step applicability, and occurrence provenance/snapshot fields.
2. **Route spellings and envelopes** for calendar read/write (session-derived household; version + mutationId); exact receipt kind strings.
3. **Sync resource name** (e.g. `household_calendar`) vs another documented equivalent extension of the invalidation union.
4. **Module split** — small pure evaluator(s) under `src/domain` using `time.ts` / plan / compose helpers; cohesive calendar helpers beside or extracted from `store.ts` without unrelated service rewrites.
5. **History read path** — isolate past-date loads from rewrite/reconcile (e.g. snapshot-only History vs materialize-for-execution), while still allowing dated preview of **non-stored** past dates via historical editions without inventing execution evidence.
6. **Preview UX ownership** — date-selectable routine plan preview from detail vs reuse/extend existing Personalize preview chrome; same evaluator and date semantics either way.
7. **Test organization** — unit evaluator suites, integration reconcile/authority/replay, e2e AT12 journey; fixture layout for populated through-008.

## Acceptance-test / regression notes

- AT1–14 are all required; UI writes for journeys must go through normal UI; API may support setup/assert and HTTP authority cases.
- Preserve P0-001–P0-006A protected behaviors (locks, outbox first-action merge, upcoming delete/receipts, A navigation/reorder/toast).
- Extend `docs/protected-behaviors.md` and the sync matrix for calendar mutations and applicability digests.
- New screenshots only under `reports/p0-006b-r1-screenshots/`; A (and earlier) dirs zero-diff.
- Build Report must map each AT to named evidence, record migration/replay choices, actual base commit, and any NOT RUN limitations (hosted/physical/SR out of scope).

## Material risks (not disposition changers)

1. **History/materialize coupling** — highest correctness risk: calendar edits + History reads of past unstarted rows must not rewrite structure. Treat as a first-class store contract change with AT8 evidence, not a late UI tweak.
2. **Full-list match / empty repair** — `occurrenceSharedStepsMatchRevision` and empty reinsert will fight filtered lists until both understand applicability-aware evaluated structure and provenance.
3. **Cross-definition calendar fan-out** — one Save can touch many routines/dates; prove transactional rollback (AT9), semantic no-op ID stability, and School-night predecessor clipping at today.
4. **Pending outbox vs omitted empty occurrence** — A’s `mergeAuthoritativeOccurrence` must continue to protect pending first-action cards when the server drops an all-filtered occurrence from Today (AT10).
5. **Sync without routine version bump** — clients holding Today/preview must refresh on calendar invalidation; dirty calendar/routine drafts must not be clobbered (AT11).
6. **Evidence volume** — AT1 populated through-008 fixture + AT12 dual-browser journey are the critical path; checkpoint order in the brief is advisory, not permission to ship API-only.

## Consolidated findings

| Severity | Item |
| --- | --- |
| BLOCKER | None |
| QUESTION | None — School nights, unconfigured vs no-school, calendar vs D-024 ranges, and History authority are specified in the brief and D-029–D-031 |
| IMPORTANT | Add closed applicability + school calendar persistence, editions, grant, and server validation |
| IMPORTANT | Compose-then-filter evaluator shared by execution, reconcile, and dated previews; no empty-completion / empty-repair regressions |
| IMPORTANT | Decouple History (and past snapshots) from rewrite paths; retain edition/applicability provenance on occurrences |
| IMPORTANT | Calendar reconcile across consuming routines/dates with atomic receipt + post-commit invalidation |
| IMPORTANT | Digest/replay compatibility for applicability; legacy Every-time; reject silent nondefault clears |
| IMPORTANT | Focused calendar + step applicability + plan preview UI on A shell; Vite and built SPA deep links |
| IMPORTANT | Populated through-008 migration fixture and AT1–14 evidence; keep prior screenshots unchanged |
| NOTE | Brief’s write-time “main still 31aad37” is obsolete; actual implementation base is `main` @ `7cba3a6` |
| NOTE | Create B brief branch from that tip before coding; Project Lead owns Git |
| NOTE | Exact SQL/route/sync-resource/module names are Engineering discretion within the brief boundary |

## Suggested commit message (readiness report only; do not commit)

```
P0-006B: record r1 Engineering readiness as READY

Repository-grounded review against main@7cba3a6 (accepted A);
implementation awaits Architecture disposition.
```
