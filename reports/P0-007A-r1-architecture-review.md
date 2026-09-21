# Architecture acceptance review - P0-007A r1

**Disposition:** FIX REQUIRED  
**Reviewed implementation:** `9827d28`, committed by the Project Lead on `brief/p0-007a-household-responsibility-foundation`  
**Contract:** `briefs/p0-007a-household-responsibility-foundation.md`, revision **1**, unchanged  
**Build Report reviewed:** `reports/P0-007A-r1-build-report.md`  
**Next owner:** Engineering, same revision and branch; no new readiness round  
**Card:** **Give Cats and Trash one owner and a place in Today** remains **In Progress**.

This is an acceptance finding, not a new contract or a request for B/C features. The fixed-owner vertical slice exists, but correctness failures and overstated evidence prevent technical acceptance. The Build Report's `uncommitted` label predates the Project Lead's commit; it does not mean the implementation is missing.

## Independent checks

- `npm run validate`: **PASS**, lint/typecheck and **157 tests / 27 files**.
- Build: **PASS** during the isolated Playwright diagnostic's normal web-server startup.
- In-memory SQLite/store/schema probes: reproduced the receipt, storage and input-boundary findings below. No operator database was used.
- Focused Chromium diagnostic: **FAIL**, reproducing the dirty-draft version violation below. This was an intentionally contract-asserting diagnostic, not a failure of the existing submitted suite. Playwright's teardown did not promptly finish after the assertion; Architecture interrupted that diagnostic command after collecting its result.
- Full PR/RC/Vite gates: **not independently rerun** in this review. The reported gate results belong to Engineering. Architecture inspected the named test assertions; a passing script is not evidence for assertions absent from its tests.
- Temporary probes were removed. No production source, committed tests, historical screenshots, live household data, branches, commits or hosted deployment was changed by this review. Architecture writeback files are the only remaining changes.

## Required corrections

### R1 - Bind checklist replay and validate inside the execution transaction

**IMPORTANT - reproduced correctness failure; AT6/7/9.**

`src/server/store.ts::setStepStatus` (receipt lookup around line 3565) fetches a receipt by global `mutation_id` and checks only its occurrence kind before returning the saved payload. The target's household/owner checks do not establish ownership of the receipt. It does not compare receipt household, actor, occurrence, step or intended command.

In an isolated household, Architecture completed Avery's Cats with mutation ID M, then submitted Jordan's valid Trash command using M. The call returned **Avery's Cats occurrence and action report**, while Jordan's Trash remained Open. Reusing M on Cats with `status: open` also returned the earlier Completed result instead of conflicting. Cross-household receipt disclosure was not separately exercised; the unscoped lookup requires the explicit foreign-household regression already specified by r1.

Additionally, kind/owner/generation/cancellation/structure/step validation and receipt lookup occur **before** `db.transaction(...)`. Inside the transaction, the code only re-reads `started_at` for existence before using the earlier owner/step facts. This does not satisfy section 4's serialized-validation boundary. Architecture has not claimed a reproduced multi-process race from that source inspection.

**Close with:** exact authenticated scope/target/command replay binding, conflict without another resource's payload on mismatch, and validation at the serialized write boundary. Preserve legitimate legacy routine retry behavior. Prove exact replay once, changed command/step/occurrence/actor/household/kind/generation rejection, both orderings of edit/reassignment/End/Delete versus Complete/Not needed, monotonic undo, and injected rollback. Do not solve this by trusting the client-supplied kind or owner.

### R2 - Enforce kind/reference consistency and reject unsupported responsibility inputs

**IMPORTANT - reproduced storage and boundary failures; AT1/2/9.**

Migration `011_household_responsibilities.sql` adds two partial unique indexes selected by **occurrence.kind**, without a database constraint tying that kind to its definition. On the migrated database, Architecture inserted a `kind='routine'` occurrence for a responsibility definition/date already containing its responsibility occurrence. Both rows were accepted; `foreign_key_check` remained empty. A responsibility occurrence referencing a revision from another definition was also accepted with no FK error. Independent FKs do not establish the required relationship between these rows.

At the wire boundary, `CreateResponsibilityFieldsSchema` in `src/shared/schemas.ts` uses a stripping `z.object`. A valid fixed-owner payload plus `assigneeGroupIds: [uuid]` parsed successfully and silently lost the group field. The test named "rejects ... groups on responsibility create" never submits a group field; its last case checks non-default applicability instead.

**Close with:** storage enforcement of kind, definition/revision and household consistency, including updates and the responsibility/date uniqueness bypass. Preserve routine per-person identity and valid existing rows. Reject the unsupported assignment/scheduled-work inputs explicitly forbidden by section 2, instead of accepting a materially different plan after stripping them. Cover create and revise plus pending-access and foreign-member cases. Engineering chooses the mechanism. Since 011 has been committed and may already be applied, provide a forward correction for already-011 databases; editing 011 alone is insufficient. Use disposable upgrade fixtures, not the operator's data.

### R3 - Keep the editor's version bound to its draft

**IMPORTANT - reproduced browser lost-update failure; AT5/13.**

`Responsibilities.tsx::loadDetail` refreshes `detail` while editing (around lines 283-322); `saveEdit` then reads `detail?.version` (line 545) rather than the version from which the draft was made.

Architecture's Chromium diagnostic opened Cats at version **1**, changed its name in the focused editor, saved a competing plan through the authenticated API, waited for the live detail refresh, then clicked the UI Save. The old draft submitted `expectedVersion: 2`, not **1**. Read-only inspection of the disposable e2e database confirmed version **3** and the local draft persisted after the competing revision. The conflict was silently bypassed.

**Close with:** capture the baseline definition/version when beginning the outer current/upcoming draft. Live supporting refresh must neither replace draft content nor retarget that version. A conflicting Save retains the draft and exposes the established recovery path. Prove this via the normal UI with a second writer, including owner/work changes and upcoming entry edits, not only a name edit or API expected-version test.

### R4 - Complete view recovery and late-response arbitration

**IMPORTANT - source-traced gaps; AT5/10/12/13.**

- `App.tsx` refreshes Today/supporting data on WS reconnect and visibility, but the open responsibility Plan/detail/preview and History are driven by separate refresh tokens. Those tokens are advanced by selected notifications, not by these recovery paths. Missing a responsibility/occurrence notification can therefore leave those open views stale after reconnect/visibility.
- `History.tsx::HistorySummaryView.load` and `HistoryDetailView.load` apply responses without a request/selection guard or a lower-activity-generation rejection. The generation callback happens **after** setting the returned content. A delayed pre-clear or prior-selection response is not fenced out by those components.
- Responsibility detail has fetch-generation guards between GETs, but saves/upcoming deletion directly call `setDetail` without invalidating an already-started GET or enforcing a returned-version floor. `loadDetail` also clears preview state independently of the preview request. The accepted routine detail's stronger response arbitration was not carried across to this new path.

**Close with:** authoritative recovery for all affected open views, identity/selection/version/generation-aware response application and draft preservation. Deliberately hold and release old responses after a newer save/delete/reset, and deliberately miss notifications before reconnect/visibility. Prove correct detail/preview/History as well as Today; do not count navigating away and back as live recovery. These source findings were not independently browser-reproduced during this review and must be resolved or disproved with focused evidence.

### R5 - Replace unsupported PASS claims with contract-matching evidence

**IMPORTANT - acceptance evidence gap.**

The report marks every AT PASS, but several named tests cover only a small subset; some cited scenarios are absent altogether. Reusing shared tests is welcome where they actually prove an unchanged subcontract. It cannot replace expressly required new responsibility UI behavior.

| ATs | Observed evidence gap to close or substantiate with an exact existing test |
| --- | --- |
| 1 | `p010-fixture.ts` applies 010 over the older fixture but does not populate the requested reset receipts/nonzero generation-floor or representative new profile/order values. The upgrade test lacks backup/isolated restore, restart, legacy replay and post-upgrade responsibility-write proof. |
| 2 | Same-ID reassign and same-kind duplicate rejection are useful partial evidence. Add the R2 kind/reference boundary, pending-access, routine fan-out and concurrent/repeated-generation coverage. |
| 3-4 | Cats/Trash UI creation exists. The manager opens Household **after** the child acts and accepts `Complete|In progress`; that is not an already-open live completion assertion. Trash is not executed on a controlled Tuesday; household boundary/DST/travel and mixed-work ordering checks are not in that journey. Assert actual preview dates/owners and recorded detail facts. |
| 5, 8 | No responsibility normal-UI current/upcoming create/edit/move/delete/collision or Delete/End journey is supplied. Source code containing those controls is not evidence of their operation. Include range reconcile, re-include, predecessor restoration and started/history retention. |
| 6-7 | The lock test does Complete then reassignment and one fabricated stale structure. It does not exercise the claimed edit/End/Delete race matrix, Not needed/undo, injected rollback, mismatched replay, pending first action versus reassignment, rapid delayed taps or out-of-order responses. |
| 9 | The HTTP "matrix" checks combined-manager create, a legacy GET rejection, child revise denial and missing-owner validation. It does not construct independent routine-only/responsibility-only managers or the full new-resource isolation/authority matrix. Include new mutation Origin/CSRF/WS and shared History/filter/count/detail boundaries. |
| 10-11 | History counts and a kind filter are partial evidence, not full snapshot/read-isolation proof. The reset test checks legacy scope rejection and a generation increment, then asserts `length >= 0`; it contains no injected rollback despite that claim in the report. Supply normal confirmation/cancel, exact retained/deleted state, old/new reset replay, disabled/no-grant/foreign cases and mixed-kind rollback evidence. |
| 12-13 | The mixed pending-reset test does not deliberately miss WS or deliver an old response after clear. The Cats journey does not prove two-owner live reassign, scheduled change/delete, End, dropped-WS recovery or dirty draft conflict. Include those actual event orderings. |
| 14 | The "desktop geometry stub" visits routes without authenticating and only asserts `body` visible. It does not check product layout. The Cats journey does not reorder Work. Add responsibility pointer/Move-menu/touch Save-persistence/cancel and logical-ID/dirty/focus/360px/1280px/200%-text/target geometry assertions; capture the specified editor and reset states as well as the existing read views. |
| 15-16 | The Vite detail smoke is useful. Map the remaining built/signed-out/denied/identity cases, responsibility reference/receipt cleanup and new route/sync policies concretely. Prior screenshot tests still overwrite earlier artifacts through `durableScreenshot`; restoring them after a gate is not the brief's requirement that earlier evidence stay unchanged through test runs. Use non-durable test output or explicit current-brief capture for those runs. |

Update the Build Report to distinguish PASS, PARTIAL and NOT RUN honestly while work remains. Pin the reviewed implementation to **9827d28**, append subsequent correction evidence, and name the concrete tests/assertions behind each closed AT. Do not call test stubs, API-only substitutes for required UI paths, or wiring inspection end-to-end PASS.

## Return handoff

Engineering should correct **R1-R5 against P0-007A r1** on the existing branch, add failing-before/fixed-after regressions, and rerun exact `npm run validate:pr` and `npm run validate:rc` including Vite. Keep historical screenshot directories unchanged. Return the updated Build Report with truthful AT1-16 mapping and remaining limitations. No new readiness round, Product proposal, B/C implementation, hosted test or deployment is requested. Suggest a commit message but do not commit. Project Lead evaluation and merge remain separate from Architecture acceptance.
