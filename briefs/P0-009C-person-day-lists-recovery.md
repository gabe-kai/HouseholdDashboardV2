# BRIEF P0-009C — Recover Each Person’s Lists on the Wall

**Revision:** 1
**Status:** FIX REQUIRED

**Product input:** `PRODUCT.md` → Immediate wall follow-up, 2026-11-10. The approved follow-up is committed on the brief branch at `82144ce`; unrelated Product edits remain outside the planning baseline.
**Inspected baseline:** `main` `a155169`, P0-009B r2 merged via PR #31 and reported deployed.
**Disposition:** urgent, temporary presentation/navigation recovery. Product acceptance of P0-009B remains pending; its technical acceptance stands.

## Why

The family needs an obvious way to find all of a person's named recurring lists now. The new pane's pinned task and repeated controls leave too little checklist space, and enlargement repeats that interface. The larger timeline redesign will be judged separately.

## Learning question

Can a person find, open and act on any of their lists without coaching, using a useful expanded view while the timeline is refined?

## Player experience

From each person's pane, a clearly named action such as **All my lists** opens that person's named recurring work for today. Completed, current and later lists remain reachable. Opening a list exposes its full checklist. The expanded view devotes meaningful space to navigating named lists and reading steps; it does not simply enlarge the existing repeated toolbar. Back returns to the same person and preserves safe sibling positions.

## Project card

**Card title:** Find all my lists on the family wall
**Suggested column:** In Progress
**Player-facing goal:** Find and open any of my routines or chores on the wall.
**Done when:** A person can reach and use their named lists, including finished and later work, from their pane and its expanded view.
**Tracking relationship:** Contributes to the family-wall outcome; visual timeline acceptance remains separate.

## Current system

- P0-009B is integrated and technically accepted; the Project Lead rejects its presentation and could not fairly judge function. `PRODUCT.md` contains the observed follow-up, committed at `82144ce`.
- `FamilyBoard` shares presentation between the display and `preview-frame.tsx`; `DisplayApp` owns display session/sync/outbox and `DisplayPreviewHost` owns member-authorized read-only preview.
- `getDisplayPersonDetail` returns current-day assigned recurring occurrences, including completed work, and household-visible personal tasks, including unpromoted ones. `PersonDetailView` renders recurring names and opens occurrence detail. The pane calls this route through **Shared personal work**, which does not communicate the recurring-list route.
- Enlarged panes currently reuse the same board controls. Existing person/occurrence routes, preview messaging, focus return and lifecycle fences are available for reuse; verify their actual behavior under this change.
- Current-day materialization, not arbitrary historical/future generation, governs the list. “Later” means later assigned work within the current household day.

## Behavioral contract

1. Every eligible person pane, including one with no current recommendation or pending sign-in, exposes an obvious, discoverable **All my lists** or equally clear action without requiring scrolling through a checklist. It opens that person's current-day assigned recurring routines and responsibilities, including completed and later occurrences; preserve named identity, truthful status and empty/loading/error states.
2. The list view can open each occurrence and its complete ordered checklist. On the wall, authorized Done, Reopen and Not needed use the existing display execution/outbox path. The preview offers the same navigation/content through its member-authorized read-only adapter, with no execution controls or display credential acquisition.
3. Enlarge provides genuinely easier list navigation: either open the focused person/list view directly or provide an immediately visible all-lists entry in a substantially usable expanded person view. Merely scaling the existing pinned task plus repeated section toolbar is insufficient. Back returns predictably to the originating pane and its safe section/scroll/focus; sibling browsing and pending/error cues remain independently reachable.
4. The personal-detail route may be reused as a **deliberate** all-lists action, including its existing household-visible personal-task section. Do not automatically fetch it on pane load or enlargement, and do not reveal unpromoted personal work on the resting board. Clearly separate recurring lists from personal tasks. No private task data enters wall/preview or sync.
5. Retain accepted day/generation/epoch/session/authority and withdrawal fences, status intent/receipt semantics, pending-first-action safety, local stale/retry recovery, and independent sibling behavior. Do not create a new display principal, domain scheduler or persistent UI state.

## Implementation boundary

- Prefer the existing person/list/occurrence presentation and scoped routes when they satisfy the whole contract; adjust presentation, navigation and preview adapter only as needed. Extend an existing authorized projection only if repository evidence shows it necessary; preserve allowlists and current-day scope.
- Keep display and preview entry/return behavior equivalent while preview remains read-only. Maintain protected-behavior and route policy records if touched. Temporary bridge can be retired after timeline evaluation.
- No live data, Railway operation, schema migration, new dependency, setup polish, assignment redesign, or implementation of the final timeline in this slice.

## Do not change

P0-009B's authorization, private/unpromoted visibility boundaries, execution provenance, outbox/idempotency, sync, history, structural locks, lifecycle fences and data. No reset, rollback or re-enrollment. No live School/Meals/Calendar or root-route work.

## Acceptance tests

Use disposable fictional data representing one person's **three distinct routines** and **rotating chores**, with completed, active and later current-day occurrences; include another person with an independently browsed pane and a pending-sign-in person. Record exact named checks and results. Preserve P0-009B's required Chromium/WebKit split where the same behavior applies; reuse exact existing security/lifecycle tests. Physical screen and Product judgment are separate.

| ID / assertion | Setup and action | Expected evidence | Type | Result |
| --- | --- | --- | --- | --- |
| AT1 — Find lists | Resting pane, including no current recommendation | Visible, named entry opens the correct person without checklist scrolling; pending-sign-in person is reachable | Chromium + WebKit UI | NOT RUN |
| AT2 — Complete day | Fictional three routines + rotating chores; one completed, one later | All assigned current-day list names, states and correct person appear, including completed/later; no duplicate or missing occurrence | Integration + UI | NOT RUN |
| AT3 — Open and act | Open completed and later lists, inspect steps | Ordered checklist accessible; Done/Reopen/Not needed affect the correct assigned occurrence with existing provenance and receipts | Integration + wall UI | NOT RUN |
| AT4 — Useful expanded path | Enlarge and navigate, at 1920×1080 and 3840×2160 | Named lists and readable checklist accessible in a substantially usable focused view; no repeated pinned-task/section-toolbar-only enlargement; capture fictional screenshots and geometry | Chromium UI + screenshots | NOT RUN |
| AT5 — Preview parity | Authorized selected-display preview navigates same person's list and detail | Same named current-day content and usable navigation; no action controls, display auth/session/outbox or device contact renewal | Integration + Chromium/WebKit UI | NOT RUN |
| AT6 — Deliberate privacy | Private, unpromoted and promoted tasks | Automatic pane/enlarge does not fetch deliberate person detail or expose unpromoted/private identifiers, titles or counts; intentional all-lists route keeps existing permitted household-visible section, private remains absent | Integration + UI/network | NOT RUN |
| AT7 — Return and siblings | One pane deliberately scrolled; sibling browsed; open list/detail and Back | Correct origin and safe focus/scroll/section restored; sibling position unchanged, no accidental completion from drag | Chromium UI | NOT RUN |
| AT8 — Pending and sync | Hold a wall action while navigating; remote authorized change | Original intent/cue remains reachable, settles once; remote update converges without reload, stale response cannot restore prior content | Multi-context UI + existing exact evidence | NOT RUN |
| AT9 — Authority and lifecycle | Revoke display/preview authority or replace generation while detail is open/response held | Existing global clearing and stale-read/write fencing remain effective; no old content resurrects | Reuse named inherited tests + targeted changed-route test | NOT RUN |
| AT10 — Gates | Final tree and explicit test selection | `validate:pr` and `validate:rc` exit 0; report named checks, skips and fixture screenshots | Exact local gates | NOT RUN |

## Dependencies

- P0-009B r2 on `main` at `a155169`; the reviewed Product direction is integrated on this brief branch at `82144ce`.
- Disposable local fixtures; no production data or hosted deployment required for implementation.

## Relevant decisions

D-041–D-049, D-051, D-054, D-057–D-061 remain active. Product's newer presentation direction supersedes D-061's provisional separate section controls as a lasting design; this brief does not weaken its authority or lifecycle guarantees.

## Known risks / assumptions

- The old person view exposes permitted unpromoted household-visible tasks. Reuse is acceptable only after deliberate navigation, not automatic enlargement.
- A global detail view may temporarily interrupt simultaneous sibling navigation. Preserve sibling state and pending actions; Product may refine simultaneous use in the separate timeline follow-up. Do not silently remove action or sync support.
- Screenshot readability and layout suitability require Project Lead review on the actual display; automated geometry is supporting evidence.

## Engineering readiness

**Reviewed revision:** 1
**Engineering readiness at review:** BLOCKER solely because the approved Product direction was uncommitted; see `reports/P0-009C-r1-engineering-readiness.md`. No other material blocker or question was identified.
**Architecture disposition:** ACCEPT / PROCEED. The cited Product prerequisite is resolved by `82144ce` on this brief branch. Engineering should verify the baseline, record its final readiness disposition, and implement r1 without another Architecture handoff unless a new material issue arises. The behavioral contract is unchanged.

## Technical acceptance

Architecture reviewed implementation `3611a31`: **FIX REQUIRED**, unchanged r1. See `reports/P0-009C-r1-architecture-review.md`. AT2/AT3 have sufficient combined evidence; close changed-route AT8 evidence and final exact PR/RC gates before acceptance. Product evaluation and the separate timeline design remain pending.

## Revision history

- **r1:** Initial emergency recovery brief.
