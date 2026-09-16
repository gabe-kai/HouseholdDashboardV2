# Engineering readiness — P0-006A r2

**Brief:** `briefs/p0-006a-calm-household-experience-foundation.md` revision **2**  
**Compared against:** integrated `main` @ `31aad37` (P0-005 r3 merge); planning branch `brief/p0-006a-calm-household-experience-foundation` @ `73641d9`  
**Disposition:** **READY**  
**Date:** 2026-09-15  
**Scope note:** Fresh review for **r2 only**. r1 is superseded and is not certified by this report. Implementation waits for Architecture’s response to this review.

## Verdict

**READY.** D-026 (refined by D-027), D-028, and the r2 brief agree on a bounded client UX slice: Plan-labeled shell, addressable saved views, focused routine drafts, transient vs durable feedback, and pointer/touch/keyboard ordering—without schema/API mutation changes or P0-006B/C scope. The merged P0-005 r3 baseline already owns session/outbox/WS above views, schedule lifecycle, locks, logical step IDs, Personalize anchors, enrollment-token durability in access, and Fastify SPA `index.html` fallback for production/hosted builds. Remaining work is a large but bounded presentation/navigation refactor with clear AT1–12 evidence rules. No material product ambiguity that would force Architecture to choose between competing interpretations of Plan vs Routines, draft ownership, or personal-order authority.

Implementation must wait for Architecture’s disposition of this review (requested review-only).

## Repository baseline (evidence)

### Present on `main` @ `31aad37`
- Migrations through `008_widen_routine_mutation_receipt_kinds.sql`; schedule entries; Delete/End; current-plan range reconcile; upcoming create/edit/move/delete.
- `App.tsx`: session restore, CSRF, outbox flush, `connectSync`, primary Today / Routines / Household state, Household nesting (People & Groups, activity, Approvals, History), Personalize/Preview from Today, Account menu (Sign out).
- `Routines.tsx`: list/detail/ended/create/edit/picker; draft with `logicalItemId` and schedule-entry edit; version-aware detail apply; dirty `confirmDiscard` inside Routines; Move up/down step reorder; upcoming section; More → End/Delete.
- `PeopleGroups.tsx`: focused person/group/access states; issued enrollment token held in access view (not toast-only).
- Direct Personalize: additions-only Move up/down; before/after/end anchors; inherited shared steps not movable.
- `styles.css`: Calm warm tokens; phone bottom / wide top nav; `--touch: 44px`; known `--line` alias conflict (`1.45` then overwritten by `var(--border)`); `body { overflow-x: hidden }`.
- Server: `setNotFoundHandler` serves built `index.html` for non-API GETs when production or hosted profile (`src/server/app.ts`).
- Evidence: P0-005 lifecycle/AT6 e2e, protected-behaviors, `validate:pr` / `validate:rc`; Playwright projects use phone device presets only (`Pixel 7` / `iPhone 13`).

### Active decisions (r2-aligned)
- **D-026** Active — Calm Household presentation (refined by D-027).
- **D-027** Active — Today / Plan / Household; automatic responsive shell; stable saved-destination IDs.
- **D-028** Active — drag handle + equivalent accessible path; Personalize additions only; distinct touch/pointer/keyboard evidence.
- **D-020 / D-023–D-025** Active — routine identity, locks, current-plan intervals, Delete/End (preserve; UI consolidates around them).
- **D-004 / D-011 / D-006 / D-008 / D-016** — server/outbox truth, membership authority, focused views (unchanged).

### Brief “Current system” claims
Accurate against `31aad37`: no client URL router; Plan still labeled Routines; Online + date/timezone in chrome; persistent status/`ChangeNotice`; flat editor with always-visible Move up/down; Schedule for later as a primary detail action; SPA fallback exists for built production/hosted serving; Playwright phone-only.

### Working-tree / Git note
Review performed on `brief/p0-006a-calm-household-experience-foundation` @ `73641d9` (r2 planning). Tip is based on `main` @ `31aad37`. No implementation code for P0-006A is present. Do not absorb unrelated dirty work into an implementation commit. Brief Dependencies ask that planning be committed before implementation; Project Lead manages that Git step.

## Focused r2 gap analysis (intentional contract deltas)

| Area | Current (`31aad37`) | r2 required | Severity |
| --- | --- | --- | --- |
| Primary destination label | Tab **Routines** | **Plan** opens Routines list headed Routines | IMPORTANT |
| Quiet healthy chrome | Persistent Online pill; date/tz in topbar; Account = Sign out only | Compact header; Account holds identity/date/tz/env; no healthy Online row; truthful Local indicator only in local | IMPORTANT |
| Addressable URLs | React local state only; reload loses destination | Required views reloadable in Vite **and** locally served built SPA; Back/Forward vs parent Back; signed-out resume; generic unavailable | IMPORTANT |
| Dirty navigation | Routines in-view discard only; App primary-tab switch unmounts without Keep/Discard; no `beforeunload` | Keep/Discard for primary nav, parent Back, browser Back; section Back ≠ outer discard; unload warning for document close | IMPORTANT |
| Focused editing | Single flat form; always-visible step text/select/delete/reorder | Name/When/Who/Steps summary + focused sections with Done/Cancel working copies; no confirm for ordinary field/reorder | IMPORTANT |
| Detail density / More | Schedule for later beside Edit; status notices persist | Edit primary; Schedule/End/Delete under More; reference 390×844 density; Show all for long lists | IMPORTANT |
| Reordering | Always-visible Move up/down on every row | Drag handle (pointer **and** touch) + compact non-drag alternative; Personalize additions only; cancel drag restores order | IMPORTANT |
| Feedback | Persistent `statusMessage` / `ChangeNotice` | ~5s success toast; durable errors/pending/protected-work/enrollment token | IMPORTANT |
| Evidence matrix | Phone Playwright projects; mouse at phone size | Chromium+WebKit at 390 touch-enabled and 1280 desktop; distinct touch-event drag vs pointer; 360/768/200% text checks | IMPORTANT |
| Token / overflow hygiene | `--line` conflict; body `overflow-x: hidden` | Normalize conflicting styles; inspect so overflow does not mask layout failures | IMPORTANT (local) |

## Ordinary implementation choices (Engineering will make if authorized)

1. **URL syntax and adapter** — path vs hash vs hybrid; History API adapter that works under Vite and Fastify SPA fallback (may need serving built assets whenever `clientDist` exists, not only production/hosted).
2. **Component extraction** — small local shell/nav/toast/reorder primitives vs keeping large files; domain logic stays out of presentation helpers.
3. **Drag implementation** — maintained dependency vs hand-rolled; document bundle/license if added (D-028).
4. **Playwright projects** — add desktop viewport/input project(s) and a real touch-event path (CDP/touch or WebKit touch); do not treat phone+mouse as touch evidence.
5. **Toast ownership** — one transient feedback owner above destinations so delayed responses cannot toast the wrong target after navigation.
6. **Dirty-guard plumbing** — lift a draft-dirty signal from Routines (and any other dirty editors) to App without moving session/outbox/sync ownership into route leaves.

## Acceptance-test / regression notes

- AT1–12 are all required; UI actions must drive new journeys; API may only support setup/assert.
- Preserve P0-001–P0-005 protected behaviors, especially upcoming-delete, receipt migration `008`, locks, and outbox/first-action.
- Update `docs/protected-behaviors.md` for navigation, drafts, feedback, ordering.
- New screenshots only under `reports/p0-006a-r2-screenshots/`; prior dirs zero-diff.
- Build Report must map ATs to named tests/artifacts and record dependency choices and NOT RUN checks.

## Material risks (not disposition changers)

1. **Stateful UI refactor** — highest risk is unmounting session/outbox owners or letting delayed fetches navigate/toast across destinations; keep App-level owners and key loads by session+target (brief §3, §5, §8).
2. **Vite vs built SPA reload** — today’s Fastify SPA fallback is gated on production/hosted; local built-app deep links need an explicit serve path so AT3 does not silently only pass under Vite.
3. **Dirty + browser Back** — History API + Keep editing must not create redirect loops; section Back must not trigger outer discard (brief §3 / §5).
4. **Personalize anchors** — shared drag pattern must not expose inherited shared-step reorder or rewrite anchor fields (D-028 / brief §6).
5. **Touch evidence** — without a dedicated touch-event harness, AT6 can be falsely greened by pointer-only tests.

## Consolidated findings

| Severity | Item |
| --- | --- |
| BLOCKER | None |
| QUESTION | None — URL/router/drag/test layout choices are Engineering discretion within D-027/D-028 |
| IMPORTANT | Implement Plan shell, quiet chrome/Account details, and responsive resize without remounting session/outbox/sync or discarding drafts |
| IMPORTANT | Add reloadable saved destinations with correct Back semantics and signed-out resume; keep identity isolation |
| IMPORTANT | Focused subsection drafts + outer Keep/Discard; preserve logical IDs and schedule-entry identity |
| IMPORTANT | Pointer **and** touch drag + compact accessible non-drag; Personalize additions-only with stable anchors |
| IMPORTANT | Transient success vs durable error/pending/protected-work/enrollment feedback |
| IMPORTANT | Expand Playwright to desktop + real touch-event coverage; retain P0-005 lifecycle/migration regressions |
| NOTE | Normalize `--line` / overflow; optional reorder dependency with documented cost |
| NOTE | Planning commit on `main` / implementation branch creation is Project Lead Git workflow before coding |

## Suggested commit message (planning / readiness only; do not commit)

```
P0-006A: record r2 Engineering readiness as READY

Repository-grounded review against main@31aad37; implementation awaits
Architecture disposition.
```
