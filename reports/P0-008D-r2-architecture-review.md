# Architecture Review - P0-008D r2

**Date:** 2026-10-12
**Disposition:** FIX REQUIRED
**Brief:** `briefs/p0-008d-guided-first-household-day.md`, revision 2
**Branch:** `brief/p0-008d-guided-first-household-day`
**Implementation reviewed:** `b90cd7f`
**Authorization:** `9e236d5`; integrated A–C baseline `1709097`
**Build Report:** `reports/P0-008D-r2-build-report.md`

## Evidence and acceptance boundary

Architecture inspected the committed source, migration 020, D tests, selection/CI changes and Build Report. The implementation working tree was clean. Two independent read-only reviews supported this consolidated review; their material findings were checked against source by Architecture.

- Engineering reports exact `validate:pr` and `validate:rc` EXIT 0 after the first lint-blocked attempt was corrected. This review does not treat the superseded lint attempt as a current gate failure. Full gates were not rerun by Architecture.
- Architecture reran `npx vitest run tests/integration/p0-008d.test.ts --silent`: **6/6 PASS**, exit 0.
- Two additional probes used the existing disposable HTTP harness and fictional data, with no tracked test/source edits. They reproduced changed-payload receipt acceptance and empty participants in a populated group-only routine preview, described below.
- No deployment, Railway access or live-data operation occurred. Hosted and human evaluation remain separate, pending checkpoints.

The delivered foundations are useful: migration/progress storage, nested transactions around domain saves, guide route authorization, optional progress separated from `setupRequired`, route/CI selection, and retirement of C access claims in the restore scrub. However, the parent journey is substantially narrower than r2, and several protected behaviors are violated. Green suites do not demonstrate the missing assertions. **P0-008D r2 is not technically accepted.**

## R1 — Complete the contracted guide, return paths and recap

**Contract:** behavioral 1/4/6/8/9/12; AT2/3/10/12.

`src/client/GuidedSetup.tsx:268` hardcodes daily weekdays, one required step, Morning for a routine, Anytime for a responsibility and a fixed owner. The form beginning at line 535 has no recurrence/daypart selection, ordered multi-step editing, applicability or secondary assignment/scheduled-work controls. Both creates two definitions from the same title/step but reviews only the routine (`runPreview`, line 216). This is not the approved first-work authoring outcome.

Returning is also incomplete. `initialStep` (line 31) sends completed/skipped work or any `finishedAt` straight to recap. Save and finish later calls `finishGuide(true)` (line 706), setting finished/dismissed rather than preserving an approachable return to unfinished choices. The rail is text and Back exits to Household. Thus reopening Settings after pausing in People cannot reach the unfinished School/Work steps. Saved people have no correction/removal/sign-in paths, saved work is not loaded for review/edit, and recap (line 645) lists statuses/people but no saved work, owners/participants or next dates. Settings Household details remains descriptive text without the specified safe correction.

**Required correction:** Deliver the existing r2 guide outcome using the normal domain forms/services. Allow either/both work kinds with actual recurrence/daypart, ordered steps and the specified secondary options; review all work being saved. Make saved and skipped steps revisit-able, provide existing person/work correction and sign-in paths, and show the saved work/next-date recap plus the small optional checklist/wall link. Save and finish later must leave a valid saved boundary and permit later completion; unfinished dirty entries require the existing Keep/Discard handling. Complete safe household detail correction and retain the timezone relocation boundary. No new Product proposal or broad editor redesign is requested.

## R2 — Preserve the school calendar and its conflict baseline

**Contract:** behavioral 5/10; AT3/6.

`GuidedSetup.tsx:103` loads only the first saved year. `saveSchool` (line 178) fetches the latest calendar version at Save and submits a replacement containing one year and `exceptions: []` (line 192). Opening an existing calendar and saving through the guide can erase other years and exceptions; a concurrent calendar edit can be overwritten using its newly fetched version rather than detected against the draft's baseline. When there is no calendar, lines 108–110 invent September/June dates from the device year, contrary to the explicit no-inferred-year-dates contract.

**Required correction:** Load and preserve the complete saved years/IDs/exceptions, or make deliberate edits through the existing calendar editor. Pin the original calendar version while editing; conflicts retain the draft and offer refresh/review. Leave unknown year dates empty for user entry. Not now must remain a progress choice without clearing an existing calendar. Prove preserved multi-year/exception data, competing saves, unknown context and the guide calendar/first-action lock race.

## R3 — Bind guide operation identity, authority and epoch; retain it across retry

**Contract:** behavioral 2/3/10/11; AT4/7/8/11; D-051/D-056.

Guide saves call `readStructureReceipt` before underlying command validation (`store.ts:1050`, `1112`, `1151`). The helper (`member-access.ts:790`) looks up only mutation ID and kind; there is no stored actor/household/epoch/payload comparison. Person creation and People completion even share `guide_people`. Replay may return an earlier successful action despite changed payload or loss of the underlying people/calendar/work capability. The new guide schema at `schemas.ts:916` carries no originating installation epoch, and guide receipts restored from a snapshot are not epoch-bound.

**Executed probe:** Save fictional person Probe Alex with mutation ID M, then send M with name Probe Blair and a different classification/version. The server returned Probe Alex successfully (`rejected: false`) instead of rejecting the changed command.

`GuidedSetup.tsx:135`, `179`, `271` generates fresh outer/inner mutation IDs on each submission. A save whose response is lost cannot recover by retrying the original identity; after a progress refresh another submission can become a new creation, or it conflicts instead of recovering the original save. Old drafts/commands can also be reused after a fresh sign-in to restored identical IDs/version: old-cookie denial alone does not fence that originating command.

**Required correction:** Bind each new guide operation to its distinct action, actor, household, originating installation epoch, normalized payload and expected versions. Check current action authority before replay as well as commit. Retain the same operation identity until an ambiguous result is resolved, and reject changed action/payload/scope. Retire or scope receipt/draft intent after restore and unused-target deletion so it cannot return stale deleted data or execute as a new action. Prove dropped-successful person/work response recovery, competing saves, changed-payload/action/actor rejection, lost underlying authority and both old-receipt-present/absent restore scenarios. Preserve the atomic save approach; it does not need replacing merely because it uses nested transactions.

## R4 — Make preview match execution and bind Save to the review

**Contract:** behavioral 3/7; AT5; D-029/D-040/D-056.

`previewDraftRoutine` uses normalized direct assignees alone (`store.ts:1317`). `normalizeRoutineAudience` removes direct people represented by selected groups (`store.ts:7588`); preview never unions the dated groups as normal execution does. The fallback next-date search (line 1345) checks whether that date is a school day rather than applying each actual rule. A school-night-only routine can therefore report the school day instead of the preceding evening.

**Executed probe:** A group containing two fictional fixture members was the sole routine audience. The first preview was `applicable: true` with `participantMemberIds: []` and `participantNames: []`.

The client review is only a first-date/count string, not ordered applicable work and the next-seven responsibility meaning. Changing a field after Review leaves `previewText` valid and Save enabled (`GuidedSetup.tsx:634`). `GuideWorkSaveSchema` (`schemas.ts:935`) accepts no reviewed source-version basis; `guideSaveWork` checks guide version and an optional date, then resolves current sources. A same-day calendar/group/eligibility change need not invalidate the reviewed consent. The client records `session.householdDate` rather than a current preview basis.

**Required correction:** Reuse the full dated audience/eligibility/applicability and assignment/composition evaluators, including beyond-window next dates. Review every definition/step/owner actually being saved. Invalidate review on local input changes, and require a date/source-version basis from authoritative preview that Save checks atomically. A changed source/day asks for renewed review with retained inputs. Prove group-only/future group dates, school-night and filtered-empty cases, fixed/cyclic/weekly/scheduled owner/Unassigned meaning, edited-after-review and source/midnight conflicts with zero preview side effects.

## R5 — Preserve dirty drafts and fence live/late results

**Contract:** behavioral 2/3/10/12; AT3/4/8/9.

The load effect (`GuidedSetup.tsx:85`) reruns on `guideRefreshToken` and unconditionally replaces step, audience, owner and school dates. A second manager's progress save can overwrite the first manager's dirty draft; the clean-draft helper at line 721 is unused. App's connected/visibility recovery (`App.tsx:946`, `955`) refreshes other resources but does not reread the guide after missed sync.

Save handlers apply results without session/epoch/request/version arbitration. `finishGuide` catches an error and resolves anyway; callers at lines 663/674/706 then navigate, concealing a failed Finish/Save-later operation. School fields and default work values also count as dirty without a saved baseline, which can produce discard prompts after valid saves.

**Required correction:** Pin actual clean/dirty baselines. Refresh clean projections on guide/domain events, real reconnect and visibility; retain dirty values with an actionable conflict. Arbitrate all load/save continuations by the existing authorization/epoch/request/version boundary. Navigate only after a known successful Finish/exit, or a deliberate discard; retain errors at the relevant step. Prove two-manager live updates, held older replies, dirty preservation, actual socket outage, failed finish, and permission/reset/restore changes while requests are pending.

## R6 — Close upgrade, deletion and real restore compatibility

**Contract:** behavioral 2/9/11; AT1/7/11.

`ensureGuideProgressRow` (`store.ts:1425`) stores the lifecycle membership creation time as both Account and Household completion for older households without progress. That timestamp is not evidence of either event, even though it came from a real row. Preserve ordinary use/adopted basics without fabricating historical completion times.

The test titled populated through-019 migration (`p0-008d.test.ts:163`) opens an empty DB and migrates all schemas; it is not a populated upgrade fixture. AT7 covers one unused person's deletion but not work deletion, post-delete replay or mixed references. AT11 (`line 279`) directly invokes `scrubRestoredAccess` and checks token preview only. It does not restore a staged snapshot, attempt redemption, verify fresh authorized links, or exercise saved guide progress/links and the untouched source backup.

**Required correction:** Add representative populated through-019 adoption with/without A progress and preserved grants/calendar/started/history/backup catalog. Preserve unknown completion history honestly. Prove unused guide people and both work kinds remain removable, old retries stay denied and used/departed/ended links render truthfully. Drive B's actual staged restore for older and D snapshots, checking saved progress/skips/dismissal, source immutability, fresh epoch/access, all three outstanding C purposes failing preview and redemption, and fresh-link recovery. Also check repeated/incomplete reset and activity-clear preservation. The claim-scrub code change itself is a valid repair; its full compatibility evidence is the missing part.

## R7 — Complete the required journey/evidence and correct report metadata

**Contract:** AT1–14 and implementation boundary; existing protected-behavior/CI conventions.

The report marks AT2 PASS, but the phone test (`z-p0-008d-guided-setup.spec.ts:51`) adds one child and skips both calendar and work. It never creates the contracted two-adult/four-child household, calendar, both work kinds or review correction. AT3's Account Back title (line 87) does not actually exercise Back. AT5/6/8/9/10 are disclosed as focused/partial, and the whole ordinary-UI lifecycle journey is NOT RUN. Desktop only asserts the rail is visible; the Vite suite has no guide-route addition. There is no new guide row in `docs/protected-behaviors.md` or its sync matrix. Actions' desktop job still selects the old desktop/display projects, not the new D test in `chromium-008a-desktop`.

The Build Report also calls the implementation uncommitted, whereas the reviewed work is committed at `b90cd7f`.

**Required correction:** After R1–R6, deliver the complete normal-UI AT2 and AT10 Chromium/WebKit journeys plus actual desktop/phone/zoom/keyboard/ordering/route evidence. Supply named deterministic tests for remaining required subcases; reuse A–C evidence only where it truly proves the D path. Wire D desktop and Vite selection into the required aggregate, and update protected behaviors/sync recovery traceability. Map PASS only to demonstrated subcases; preserve honest PARTIAL/NOT RUN until closed. Pin `b90cd7f` and distinguish the upcoming correction delta/commits accurately. Run exact PR/RC gates on the corrected tree. Hosted/Product NOT RUN remains appropriate and is not a local acceptance blocker.

## Disposition and handoff

**FIX REQUIRED — same P0-008D revision 2.** All R1–R7 are existing contract corrections; no new readiness cycle, Product decision or brief revision is requested. Engineering should retain useful foundations, correct these findings on the current branch, and return the updated evidence-mapped Build Report for re-review. This review changes no production code.

The card **Set up and manage my household without operator help** remains **In Progress**. No merge/deployment/live reset or Product acceptance follows from the reported green gates. Suggest a commit message but do not commit.
