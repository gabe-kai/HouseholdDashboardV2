# BRIEF P0-007B - Assignment Patterns & Scheduled Work

**Revision:** 1
**Status:** IN REVIEW

One authoritative contract for P0-007B. Material changes increment the revision and invalidate prior readiness. Architecture technical acceptance and Project Lead acceptance of the experience are separate. This brief authorizes Engineering readiness review; implementation awaits Architecture ACCEPT / PROCEED.

## Why

P0-007A established one responsibility per household date with fixed accountability and trustworthy execution. The supplied Design proposal now asks for realistic turns and weekly additional work. The outcome is a parent setting up Kitchen once, understanding its upcoming owners, and changing future plans without rewriting work already begun. Cats rotation, Bathroom composition, and unchanged fixed Trash prove the same model generalizes.

This is the second of the three approved P0-007 slices. Keep one brief because assignment and scheduled-work ownership must produce one consistent Kitchen occurrence. Deliver through vertical implementation checkpoints; C's daily-information redesign remains separate.

## Learning question

Can a parent predict who will receive Kitchen and what it will contain by reading Upcoming, including deep-clean overrides and a group change, without understanding rotation arithmetic?

## Player experience

A parent opens Plan, creates Kitchen with daily base work, and assigns a repeating Monday-through-Sunday pattern. Upcoming shows friendly dates and names before Save. Adding Saturday Deep Clean adds its checklist to Kitchen; an Avery/Casey alternating deep-clean pattern determines the owner of the whole Saturday occurrence. The child receives one Kitchen checklist with understandable work headings. A parent can correct it until work begins and deliberately schedule later changes. Cats rotates among selected children; Bathroom uses the same base-plus-additions controls; weekly Trash stays simple.

## Project card

**Card title:** Understand whose turn it is, including deep-clean days

**Suggested column:** Up Next

**Player-facing goal:** Set up household turns and weekly extra work once, then trust the upcoming schedule.

**Done when:** Through ordinary screens, a parent sets Kitchen's weekly owners and alternating deep clean, sees the same owner and work on the actual day, and changes future plans while started work/history remain intact. Cats rotates, Bathroom uses the same controls, and fixed Trash still works.

**Tracking relationship:** Second card within P0-007 - Household Responsibilities & Multi-Responsibility Today. Implementation -> In Progress; technical acceptance -> Ready to Evaluate; Project Lead acceptance -> Accepted. No external board is configured.

## Current system

Inspected clean integrated `main` at **51322e0**, merge PR #15. P0-007A r1 was technically accepted at **bb21d74**; the supplied Design handoff retains A as the foundation and carries presentation feedback to C.

| Repository fact | Evidence / consequence for B |
| --- | --- |
| One Node/TypeScript package, React/Vite, Fastify, SQLite; existing local/LAN and PR/RC workflows | `package.json`, `ARCHITECTURE.md`; no hosting or new runtime service prerequisite. |
| Shared definitions/revisions/schedule entries and occurrence/step/report storage; immutable kind; responsibility uniqueness by definition/date | Migrations 011-013. Owner changes must keep that occurrence identity. |
| Responsibility input is strict: one `accountableMemberId`, weekdays, daypart, base steps; non-Every-time step applicability rejected | `src/shared/schemas.ts`; richer assignment and additions are new work, not existing options. |
| Responsibility resolution selects the first direct member and bypasses group expansion | `src/domain/participation.ts`, `src/server/store.ts`; B needs a dated single-owner resolver, not routine fan-out. |
| Saved-definition seven-day preview reads plans/protected rows without materializing; current preview has no additions or unsaved-draft contract | `previewResponsibilityNextDays`, `GET /api/v1/responsibilities/:definitionId/preview`; preserve read isolation and extend it to drafts. |
| Group membership has immutable dated versions, same-date version arbitration and next-household-day effects; active-reference deletion guard exists | `updateGroup`, `deleteGroup`, `src/domain/participation.ts`; responsibility consumers, ordering and dependent reconciliation must be added. |
| Occurrence owner is NOT NULL and migration 013 rejects foreign/missing owners | Migration 011 schema and 013 triggers; explicit Unassigned requires a forward change, including types/projections, not a fake membership. |
| First action, intended structure, scoped receipts, generation-fenced outbox, lifecycle ranges and stored-only History exist | `store.ts`, `src/client/outbox.ts`, `src/domain/reconcile.ts`; assignment/composition changes must use these protections. |
| Responsibility UI is fixed-owner/base-work with focused drafts, schedule lifecycle and preview refresh | `src/client/Responsibilities.tsx`; reusable shell/ordering exists, but B's focused pattern/addition editing does not. |
| Existing upgrade fixture stops at 010 | `tests/helpers/p010-fixture.ts`; add a populated through-013 baseline while retaining older tests. |

The accepted A report records 168 unit/integration tests, PR 45 Chromium + 2 Vite, and RC 71 Chromium/WebKit + 2 Vite. These are baseline evidence, not a claim that B has been built or tested.

## Behavioral contract

### 1. Closed assignment forms and explicit eligibility

- Recurrence remains selected ISO weekdays plus the existing daypart. Assignment chooses one person only on dates when the responsibility exists. No occurrence per eligible person.
- Offer **Fixed person**, **Take turns**, and **Weekly pattern**. Fixed selects one membership; Take turns stores an ordered list with each person once; Weekly pattern maps each of the seven ISO weekdays to one membership, allowing repeated names. Non-recurring weekdays do not produce work or consume a turn. Retaining all seven weekly choices makes later recurrence edits explicit; a new incomplete weekly map cannot save.
- An assignment uses either explicit selected people or one linked household group with explicit exclusions. Multiple-group unions, weighted cycles, predicates and fairness algorithms are outside B. Preserve linked group identity and exclusions; do not flatten them on Save. Show the resolved eligible names, including what starts tomorrow.
- Fixed/weekly choices must be eligible when the edited plan first takes effect. Unknown, foreign-household and malformed references fail validation. Pending-access members remain eligible; login, age, grants and classification never silently remove them or confer execution permission. Explicit selection is the simplest way to exclude a child without a group.
- A group-backed cycle initially uses the displayed, saved order (initialized from family order and editable). Retain that order as durable data. On later dated group changes, remove ineligible names from the resolved ring; append previously unranked entrants in deterministic first-admission-date order, breaking simultaneous admissions by stable membership ID. Admission means the first effective membership date in the selected group after that saved ordering, calculated from the winning versions for each date, not a transient superseded same-date set. Previously ranked returnees recover their ranked place. Exclusions remain excluded. Later family-order/name/access changes must not silently alter turns. Show the resulting order; no random/server-query-order fallback.
- A fixed/weekly slot whose named person becomes ineligible resolves **Unassigned**, with a repair warning identifying the affected day/person; do not skip to an arbitrary substitute. A cyclic pattern with no eligible candidates also resolves Unassigned. A group-backed cycle with an empty linked group is saveable with clear preview/warning; blank or corrupt explicit pattern input is not an empty group. New fixed/weekly choices still require eligible names; a group change may later make their saved slots unresolved.

### 2. Deterministic rotation and effective dates

- A cycle owns a durable household-date anchor. For date D, count applicable opportunities from the anchor through D, zero-based; choose that index modulo the number of eligible candidates on D. Base cycles count responsibility recurrence dates. Addition cycles count the intersection of parent recurrence and that addition's weekdays. A weekly deep clean advances once per applicable week, not daily.
- Counts depend on calendar facts, never page reads, generated rows, completion, missed work, or a mutable cursor. A base turn still advances on a date overridden by deep clean or resolved Unassigned. No catch-up/debt/fairness adjustment.
- Creation or a deliberate change to assignment mode, explicit people/order, source/exclusions, or governing recurrence starts the changed cycle from its first eligible person on the first applicable date on/after the intended effective date. Unchanged cycles retain anchors through title, checklist, daypart, or unrelated-addition edits. Changing parent recurrence resets affected base/addition opportunity sequences; changing one addition's weekdays/assignment resets that addition only. Explain the resulting dates in preview.
- A dated group-member change keeps the saved anchor and resolves against the new eligible ring; it does not create a new user plan or consume a turn. Same-date group edits use the final effective membership version. Preview must show the resulting prospective ownership, even if a different modulo result follows the new ring size.
- Ordinary Save governs unstarted today through the next intentional plan boundary; repeated edits do not drift dates. Schedule for later retains existing create/edit/move/delete and collision behavior. Moving a boundary that introduced a cycle moves that cycle's anchor with it; editing work-only content retains the anchor. Deleting that boundary restores the predecessor's sequence, not a newly reset one. Later independent boundaries keep their own plans/anchors.
- Group changes take effect on the next household day under D-018/D-019. Reconcile already-generated future unstarted responsibility rows from that boundary through all consuming plan intervals. Today, past dates and started rows are protected. Group rename/family-order edits alone do not reconcile ownership.

### 3. Base work plus scheduled additions

- A responsibility retains at least one base step. Add zero or more named **Scheduled work** additions, each with stable identity, selected weekdays, ordered steps and either **Use this responsibility's assignment** or its own fixed/cyclic assignment. Addition-level weekly grids, school-calendar conditions and arbitrary recurrence are deferred. Reuse Required / As needed / Optional and accessible step ordering.
- Addition weekdays intersect parent recurrence. An addition never creates a standalone occurrence on a non-recurring parent day. Reject an addition with no intersection in that plan and explain the mismatch. Recurrence edits validate all additions together.
- Compose base steps first, then applicable additions in their saved order, with each addition's steps in its saved order. Distinct stable logical step identities prevent text collisions; editing/reordering preserves surviving IDs, while remove/re-add is new identity. Store addition identity, heading, position and actual step expectations in the occurrence snapshot.
- Inherit-only additions leave the base owner unchanged. One applicable owner-setting addition replaces the accountable person for the **whole** composed occurrence. Its own Unassigned result makes the whole occurrence Unassigned; do not silently fall back to the base owner.
- Reject a plan in which two owner-setting additions could apply on the same recurring weekday, even if their present owners happen to match. Show the two additions and overlapping days so the parent can correct one schedule or choose inherited assignment. Multiple inherit-only additions may overlap and compose normally. There is no hidden priority or last-save-wins ownership.
- Add, edit, reorder and remove additions through focused normal UI inside the parent's single plan draft. Removing used scheduled work removes it prospectively from the governed range; immutable old versions and snapshotted history survive. The parent responsibility's existing Delete versus End rules remain intact. Upcoming whole-plan changes stay distinct from recurring Scheduled work; no separate child definition/lifecycle/Today card.

### 4. One resolution result, provisional occurrences and Unassigned

- Reuse one authoritative resolution path for saved/draft previews, materialization, reconciliation and first-action validation: effective parent plan -> recurrence -> dated eligibility/assignment -> applicable additions/override -> composed structure and final owner. Carry sufficient provenance to explain and protect the result. Exact table/helper names are Engineering discretion.
- Preview is read-only, including unsaved drafts and existing started work: no definitions, revisions, occurrences, receipts, locks or rotation advancement. Saved and draft previews cover at least seven consecutive household dates from today or the edited future boundary; show non-applicable days distinctly. An addition editor also shows its next three applicable dates so weekly alternation is visible before Save.
- Started stored occurrences take precedence for their dates; preview labels them as already started and shows the retained owner/work. With unchanged inputs, preview and subsequent materialization agree. Save validates the draft's pinned definition and relevant group versions; a concurrent source edit produces a recoverable conflict and refreshed preview while retaining the draft, not an unreviewed schedule overwrite.
- Keep one occurrence identity per definition/date through eligible owner changes, Unassigned transitions and structural reconciliation. Materialization does not make a future row permanent. Valid first Complete/Not needed atomically locks work and owner; undo never unlocks. Past stored rows remain historical even if never started. Started survivors remain visible to their original owner after pattern, group, addition or lifecycle changes.
- Represent an unassigned applicable responsibility explicitly, with nullable accountability only for unstarted responsibility occurrences. Routine ownership remains required; any non-null owner must belong to the occurrence household. Database/reference constraints preserve kind, revision, household and uniqueness integrity. No sentinel person and no silently omitted obligation.
- Unassigned work appears in Plan preview and existing Household activity with an understandable warning. It has no executable personal Today owner. If materialized, stored History retains it under an **Unassigned** summary group rather than dropping it. No one, including a manager, can submit checklist status until valid assignment is resolved; assignment alone grants no execution capability. Minimal repair is Edit assignment, not Claim/Cover. There is no new background history generator.

### 5. Transactions, structural intent, history and recovery

- Definition and addition edits, dated group updates affecting B, reconciled existing rows, versions and existing command receipts must commit atomically. Failures leave no partial plans/assignments/checklists/receipts and emit no committed-change notification. Use existing version/replay policy; bind administrative payloads to target definition/addition, intended boundary, patterns, exclusions, work and anchors. Retrying a command does not apply it again or reset rotation.
- Extend A's intended-structure protection to all effective B inputs. A plan revision ID alone is insufficient when group versions change independently. Owner, work, obligations, ordering and addition provenance changes must invalidate stale first actions even when logical step IDs survive. Use a durable occurrence structure version/fingerprint or equivalent checked inside the execution transaction. An unrelated group/name change that leaves effective work/owner unchanged need not invalidate intent.
- Exercise edit/group/update-versus-first-action in both transaction orders. The winning action preserves its owner/work; the winning configuration change rejects stale intent visibly. Retain pending first-action snapshots in the same generation through ordinary reassignment/omission, reload and reconnect. Never apply the old command to a new owner, structure or occurrence.
- Preserve valid legacy fixed-owner receipts/outbox retries without defaulting missing B fields into a rich plan. Legacy administrative input may update a still-simple fixed/base-only plan; it must be rejected with an upgrade/reload explanation if it would erase an existing pattern/addition. Old structural commands are accepted only when their captured A structure is still sufficient to verify unchanged fixed/base-only work; otherwise reject visibly, never guess.
- History reads only stored snapshots/provenance and reports, with existing per-kind grants, no current-rule reinterpretation and no writes. Completion considers the one composed checklist. Keep accountable/actor/performer and performed/recorded facts separate.
- Clear activity history retains patterns, anchors, sources/exclusions, additions, schedule entries, dated group facts and configuration receipts. It clears the existing activity graph with the shared generation/floor; clearing execution does not restart a rotation. Same-generation pending retention and cross-generation retirement remain distinct.
- Group used-by/deletion protection includes base and addition assignment references across active/future plan intervals, intersected with lifecycle cutoffs. Historical-only references permit a tombstone while retaining dated facts. Fixture cleanup must inspect every new membership/group/JSON reference, including exclusions and receipts; no generic person deletion is added.

### 6. Focused authoring and live connected views

- Retain Today / Plan / Household and existing URLs. Responsibility detail shows compact Upcoming (first few rows plus View all), recurrence, Work summaries, and deliberate Edit actions. Plan lists show the next applicable owner and any Unassigned warning. Use friendly names and Today/Tomorrow/weekday/date labels; actual dates remain available where useful.
- Fixed assignment stays a short person selection. Weekly pattern uses readable day/person controls; Take turns shows the ordered names. Group selection exposes exclusions and prospective eligibility. Assignment controls are behind Edit assignment/pattern; no permanent rule form. Before saving a non-fixed draft or ownership-affecting addition, show the resulting owner/date/work preview and any protected-started difference.
- Work detail summarizes Base and each scheduled addition (name, days, item count); selecting one opens its focused editor. Normal child execution and History drill-down show source headings within one responsibility. Retain single draft, Back/focus, dirty Keep/Discard, conflict recovery and accessible drag/Move controls. Addition/assignment section changes persist only through the outer Save; Cancel never writes.
- Extend existing household invalidation/reconnect/visibility recovery to open Plan list/detail/preview, old/new owner's Today and Household activity. Group changes must refresh every consuming responsibility's preview; a responsibility-only manager must also receive those invalidations. Preserve dirty drafts/baseline versions. Stale preview/detail/History responses cannot restore obsolete owners/work or cleared activity. Identity switches clear prior-household data.
- Configuration remains server-confirmed. Checklist taps keep the existing immediate durable behavior. Do not require navigation or manual reload for convergence. Avoid domain-specific Kitchen/Cats/Bathroom branches and fake times.

## Implementation boundary

- Forward migrations after 013: versioned closed assignment content, anchors/ordered sources, scheduled additions/provenance and explicit Unassigned storage/projections. Preserve immutable revision/schedule foundations and SQLite responsibility uniqueness; refine migration 013's owner constraint through a new migration rather than editing applied files.
- Cohesive pure assignment/composition helpers alongside existing date/plan/participation modules; integrate `src/server/store.ts`, `routine-plan.ts`, schemas, grants/routes/policy and group reference/reconcile paths. Shared snapshots/outbox/reconcile/History remain the execution infrastructure. Avoid a general rule engine or a wholesale store rewrite.
- `Responsibilities.tsx`, shared focused editors/ordering, Plan shell, API, Today checklist headings, PeopleGroups activity/references, History unassigned/grouped detail and existing recovery paths. New preview request shapes must use existing auth/household/validation conventions even when read-only.
- Extend `docs/protected-behaviors.md`, sync matrix, route-policy coverage, fixture-cleanup inventory and populated migration fixtures. Add a documented opt-in B evaluation fixture/journey using stable fictional friendly names without random suffixes; IDs may be generated internally. Normal bootstrap stays fixture-free. Do not seed or mutate the Project Lead's household.
- Readiness: `reports/P0-007B-r1-engineering-readiness.md`. Build Report: `reports/P0-007B-r1-build-report.md`. New Product screenshots only in `reports/p0-007b-r1-screenshots/`; earlier evidence stays byte-for-byte unchanged, including after gates. Update factual command/migration notes if implementation establishes new facts.

## Do not change

- Routine per-person cardinality, contextual steps/school calendar, dated audiences, personal layers/proposals, authority/privacy, profile/order behavior, authentication/enrollment and A's accepted lifecycle/outbox/History/reset contracts except the explicit B extensions.
- No full Completed / Next / Later / Anytime redesign or broad Household overview redesign. C owns those, including excessive expanded checklists and vertical density.
- No helpers, Cover/Claim, swaps/reassignment requests, debt, Skip Day, critical-work policy, retrospective UI, weighted/fairness/least-recent algorithms, expressions, pet dependencies, external calendars, notifications, meal/homework domains, exact times or multi-household assignment.
- No production deployment for normal development/evidence, external dependency/service prerequisite, live database reset or automatic fixture insertion.

## Acceptance tests

Every row is required. Use isolated fictional households and controlled household-date seams, including advancing the server's test date before execution; never authorize real future checklist writes for tests. API setup may support a journey but cannot replace its specified normal-UI configuration, Save or execution. Map each row to named evidence and state partial/not-run honestly.

| AT | Required evidence |
| --- | --- |
| 1 - Populated upgrade | Fresh install and populated through-013 upgrade, repeat migrate, restart, FK checks and backup/isolated restore. Preserve A fixed Cats/Trash IDs, owner/work snapshots, started/history/current/future/canceled rows, reports, valid receipts, routine/group/calendar/personal/profile/order data and nonzero reset generation/floor. Fixed plans map losslessly, no history recomposition; richer and Unassigned writes work afterward. Retain older baselines. |
| 2 - Assignment/date oracle | Table-driven fixed, daily cycle and explicit weekly cases; weekly repetition, skipped recurrence dates, first applicable anchor, owner override consuming base turns, group/exclusion changes and empty ring. Prove deterministic results across query order, repeated previews, restart, completion and reset; cover household midnight/DST and a traveling browser timezone. Work-only saves preserve phase; assignment/recurrence edits and upcoming move/delete follow section 2. |
| 3 - Preview read isolation/agreement | Compare DB state before/after saved, unsaved and addition previews, including invalid/unauthorized requests, empty eligibility and started snapshots. No writes, generated IDs/locks or turn consumption. Seven-day and three-addition-date outputs agree with later materialization under same inputs. Concurrent group/definition change while a draft is open produces a conflict with retained draft and refreshed explanation. |
| 4 - Kitchen normal UI | Chromium and WebKit: create daily Kitchen with three base steps and weekly Avery/Casey/Avery/Casey/Jordan/Avery/Casey assignment; inspect draft Upcoming, Save/reload. Add Saturday Deep Clean with five steps and Avery/Casey alternating ownership; preview at least three Saturdays and Save. On controlled Saturday, final owner receives exactly one Kitchen with all eight grouped steps; ordinary-day work has three. Start it, edit future assignment/addition, and prove retained started versus reconciled future work in execution and History. |
| 5 - Bathroom normal UI | Create daily Bathroom, four base steps and Sunday addition with five steps through the same UI, using inherited ownership. Save/reload; verify normal versus Sunday composed work and completion on one occurrence. No name/subtype special cases. |
| 6 - Cats and Trash normal UI | Convert fixed Cats to a three-person cycle through UI; verify preview and actual owners/cardinality over controlled dates, execute, change order/people, preserve started owner and update unstarted future rows. Retain a separate fixed Tuesday Trash journey through Today, Household and History; fixed configuration stays available and simple. |
| 7 - Eligibility and Unassigned | Integration plus browser group-edit journey: linked group, exclusions, pending-access people, next-day membership boundary, same-date edits, ordered entrants/returnees, family-order/name changes, referenced deletion/tombstones. Verify generated future rows update in place; fixed/weekly missing member warns without fallback; empty cycle and empty overriding addition yield one Unassigned responsibility. Household and stored History show it, personal Today has no executable owner; repair assignment reuses ID. Routine NULL/foreign ownership and duplicate responsibility/date remain rejected by storage. |
| 8 - Composition and overlap | Stable addition/step IDs across text/obligation/order changes, same-text different items, multiple inherit-only additions, no work on parent-off days, no-intersection validation. Conflicting owner-setting additions rejected atomically with named days; an empty overriding assignment does not use the base owner. Snapshot headings/order/obligations remain after later deletion/move. |
| 9 - Lifecycle/range UI | Repeated current corrections retain today; edit/move/delete an upcoming pattern/addition change and resolve occupied-date collision without losing draft. Inspect pre-generated unstarted future rows on both sides of boundaries; predecessor anchor/work restores after deletion, independent later plan remains. Remove a used addition prospectively. Preview/configuration alone does not bar parent Delete; started/past history requires End and remains completable/readable. |
| 10 - Lock/race/rollback | Integration: first Complete/Not needed versus pattern edit, group change, addition change and End, in both orders; undo never unlocks. Include surviving logical IDs but changed obligation/heading and independent group-version changes. Stale intent rejected, started structure/owner retained. Inject failures after reconciliation to prove full rollback of plan/group, dependent occurrences and receipt; no post-failure event. |
| 11 - Offline and replay | Multi-context browser: queued first action on composed Kitchen survives offline reload while owner/work changes or becomes Unassigned; reconnect yields explicit conflict or valid acknowledgment without moving intent to replacement work. Prove immediate rapid taps, delayed/out-of-order responses, same-command idempotency and mismatched target/payload/generation rejection. Preserve safe A outbox/receipt compatibility; old config payload cannot erase B content. |
| 12 - Live convergence | Two manager Plan/detail/preview contexts plus old/new owners: pattern/addition save and group membership edits converge without reload; started original-owner card stays. Suppress WS, then reconnect and visibility recovery. Hold/release an older preview/detail response; it cannot replace new authoritative schedule. Dirty drafts retain pinned versions and require explicit conflict recovery. |
| 13 - History/reset | Stored mixed History retains exact final owner, base/addition headings and expected steps, or Unassigned, after current rules change. All summary/detail reads stay side-effect-free. Clear mixed activity on disposable data: retain patterns/anchors/additions/groups/config receipts; shared generation/floor clears activity and retires old composed snapshots/outbox/late History responses. Recreated current/future assignment matches original schedule phase, no regenerated past. |
| 14 - Authority/reference matrix | Fixed/pattern/group/addition/preview/lifecycle/status API tests for responsibility manager, structure-only group editor, routine-only manager, own executor, no grant and foreign household. All IDs/provenance remain household/definition scoped; management/group participation never grants execution. Origin/CSRF and WS scope hold; routine/personal APIs cannot mutate B. New source/exclusion/addition/receipt references block unsafe fixture cleanup. |
| 15 - Focused UX and evidence | Ordinary UI Save/Cancel and dirty navigation, keyboard/focus, touch and Move-menu step/turn ordering persist through reload with stable identities. Stable readable fictional names in screenshots of Plan, weekly/cyclic draft preview, addition editor, Kitchen composed Today, Unassigned activity and History detail. Check 360px phone, 1280px desktop and 200% text for overflow/hidden actions. Existing saved links work in built local and Vite; no broader C redesign. |
| 16 - Regression gates/report | Exact `npm run validate:pr` and `npm run validate:rc`, including Vite; update contract/sync/route inventories with concrete B coverage. Prior evidence screenshots unchanged after gates. Build Report names base/commits, maps AT1-16 to tests/artifacts, distinguishes automated/manual/not-run, and gives a short local evaluation recipe for Kitchen/Cats/Bathroom/Trash. |

Hosted/physical-device evidence is not required for this brief. Product evaluates the preview's clarity and the connected local experience separately. Tests must be deterministic on any host weekday, not repaired by changing production dates or weakening assertions.

## Dependencies

- Integrated P0-007A r1 at `main` **51322e0**, the supplied P0-007B Design proposal recorded in `PRODUCT.md`, and existing Node 24/local tools. No new host/account/credential.
- Intended branch: `brief/p0-007b-assignment-patterns-scheduled-work`, from merged main with this planning change. Project Lead manages Git; suggest commit messages but do not commit, publish, merge or deploy.
- Engineering performs one consolidated readiness review of **P0-007B revision 1**, then waits for Architecture ACCEPT / PROCEED. B's proposed architecture below is not a claim of implementation readiness already established by Engineering.

## Relevant decisions

- D-018/D-019/D-023-D-025: dated groups, execution locks, plan ranges and lifecycle.
- D-027-D-034: shell/order, contextual routines, friendly profiles/order, stored History and generation reset.
- D-035-D-037: shared responsibility foundations, authority and connected execution.
- **D-038:** closed deterministic assignment forms and dated eligibility.
- **D-039:** versioned scheduled work and explicit single-owner composition.
- **D-040:** shared read-only resolution, Unassigned and transactional reconciliation.

## Known risks / assumptions

- B is a substantial behavioral slice. Suggested implementation checkpoints: migrate/resolver; Kitchen pattern/addition UI through real execution; Cats/Bathroom/group/Unassigned paths; full regression evidence. These are checkpoints within r1, not authorization to omit later ATs or ship a backend-only result.
- The proposal delegates anchors/effective boundaries to Architecture. r1 chooses opportunity-count cycles, preserved anchors for unrelated edits/group updates, reset for explicit pattern/recurrence edits, one group source, and overlap rejection. These choices must be visible through preview and evaluated; change the revision rather than silently changing them during implementation.
- Unassigned touches previously non-null storage and person-keyed views. Audit all readers, constraints, joins, cleanup and serialized payloads; do not rely solely on UI filtering. Applied migration/trigger repair must use a forward migration and populated baseline.
- Source ordering for future group entrants is durable technical ordering; family display order remains a presentation preference. Engineering chooses representation and bounded request limits, not different turn semantics. No departure workflow is added.
- No new material Product question is left to Engineering. Exact table/wire names, reusable helper extraction and control layout are ordinary implementation choices. Wider assignment forms and C's final prioritization remain deferred.

## Engineering readiness

**Reviewed revision:** NOT REVIEWED
**Readiness:** NOT REVIEWED
**Architecture disposition:** Awaiting consolidated Engineering review of r1; no implementation authorization yet.

## Revision history

- **r1:** First contract against merged A: fixed/cyclic/weekly assignment, dated group eligibility, deterministic anchors, scheduled-work ownership/composition, explicit Unassigned and connected local evidence. C stays LIKELY NEXT.
