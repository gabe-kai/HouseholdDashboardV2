# Architecture Reassessment - P0-008D r2

**Date:** 2026-10-13
**Disposition:** FIX REQUIRED — same revision 2
**Reviewed correction:** `efc1f22` on `brief/p0-008d-guided-first-household-day`; clean working tree at inspection
**Prior implementation/review:** `b90cd7f` / `68f7578`
**Contract:** `briefs/p0-008d-guided-first-household-day.md`
**Build Report:** `reports/P0-008D-r2-build-report.md`

## Evidence and what improved

Architecture inspected the correction source, migration 021, integration/browser tests and report. Independently reran `npx vitest run tests/integration/p0-008d.test.ts --silent`: **8/8 PASS**, exit 0. Engineering reports exact PR/RC passes (324 Vitest; 109 Chromium / 172 RC Playwright; 6 Vite); Architecture inspected the local logs but did not rerun those full gates. No deployment or live database change occurred.

Useful corrections are retained: selectable guide rail, multi-person/calendar/both-work phone journey, calendar years/exceptions and pinned version, distinct actor/household/epoch-bound receipts, group-union routine preview, Finish error retention, honest adopted null timestamps, unused person/routine receipt retirement, protected-behavior rows, desktop CI selection and Vite route test. These are not requested to be rebuilt.

The claim that all R1–R7 are closed is not supported. There are remaining implementation defects, not just optional testing preferences. The Build Report itself discloses AT9 PARTIAL, AT10 NOT RUN and staged restore PARTIAL. Technical acceptance remains withheld under the existing r2 contract.

## Remaining corrections, consolidated against the original findings

### R1 — Saved-work return, usable assignment controls and recap

`GuidedSetup.tsx:211–264` resets First work to defaults and substitutes `Saved work <ID>…` for restored records. No saved-definition fetch/edit path exists in this component. Returning via the Work rail therefore authors another creation, not a correction of the saved definition. Recap after save lists titles only; after reload it lists ID fragments, without saved participants/owners/next-date truth.

The Weekly selector submits `weeklyMap: {}` (`438`, `509`) with no day-to-person editor. Take turns uses `audienceIds` but its audience picker is rendered only for routine/Both; standalone responsibility has no cycle-member picker. `audienceGroupIds` has no editing control. Steps have text/add only: no obligation, reorder/remove or applicability controls; every submission injects `DEFAULT_APPLICABILITY`. Scheduled additions are hardcoded empty. These still fail behavioral 6–8 and original R1/R4; a visible mode selector alone is not a usable assignment editor.

**Required:** Reuse the existing domain editing controls for the contracted secondary options; load/resolve linked saved work and edit the same definition under normal lock/range rules. Keep explicitly creating another item separate. Recap must resolve real saved work, people and next dates after reload, deletion/departure and restore. Preserve the improved direct-entry form and rail.

### R3 — Bind the complete command and recover the original command, not only its ID

`store.ts:1273–1296` omits `responsibility.scheduledAdditions` from the guide-work digest. A disposable direct-store probe using the existing HTTP harness saved a responsibility, then retried the same outer mutation ID with a new scheduled addition. **The changed command was accepted and returned the original receipt** (`changedScheduledAdditionRejected: false`, `sameReceiptReturned: true`). No tracked tests or live data were changed by this probe.

Client mutation refs improve identity retention, but `guard()` uses the current `progress.guideVersion` each attempt, and save handlers reconstruct payloads from current form values. A successful response lost while progress invalidation refreshes the guide can change the version/payload on retry of the retained ID. Source/epoch/load changes are not a substitute for recovering an immutable pending command. New commands after an explicit edit/conflict must not be confused with the unresolved original command.

**Required:** Digest every behavior-bearing input, including scheduled additions. Retain the exact normalized command, original expected versions and preview basis until the ambiguous result is resolved; distinguish retry from deliberately changed/new commands. Prove dropped-success person/work replies, changed addition/action/actor rejection, authority loss and restore epoch rejection with/without a restored receipt. Keep the new bound receipt table and pre-replay capability checks.

### R4 — Complete authoritative consent and preview truth

`GuideWorkSaveSchema` and `guideSaveWork` still allow a work creation with no preview basis. The same disposable probe successfully created work **without review**. A basis, when supplied, compares calendar version and only the first applicable routine participant set / first responsibility owner. It does not bind the complete reviewed seven-day assignment/audience/composition, group versions or work payload; a later-day participant/owner change can leave the first day unchanged. `audienceGroupIds` in the basis is not checked against a source version.

Client preview shows counts rather than ordered applicable steps, phase/scheduled-work meaning. `runPreview` uses the session's household date and has no draft-request arbitration: editing while Review is in flight can invalidate the current preview, then the old response can restore consent. Review/Save must use a coherent authoritative date/source basis, including beyond-window truth, not independently sampled calendar and draft results.

**Required:** Enforce the existing review-before-save contract for creation, bind the reviewed normalized draft and all relevant dated sources, invalidate on input/source/day changes, and fence held preview results. Complete AT5's controlled date/assignment/applicability matrix; retain the corrected group-union resolver and zero-materialization approach.

### R5 — Dirty/live/late-result protection is still bypassed

`loadGuide` checks dirty retention only when `!options.force` (`248`), but its effect calls `loadGuide({ force: true })` on **every** `guideRefreshToken`, member and epoch change (`268–270`). App increments that token on progress events, connect and visibility. Thus ordinary live/recovery refresh still resets dirty drafts instead of surfacing conflict. This is directly demonstrated by the source path; the comment claiming dirty retention does not change its behavior.

Only load-to-load responses use `loadGenerationRef`; save and preview continuations apply state without a shared session/epoch/request/version fence or invalidating older loads. Rail switches also change the active-step-based dirty calculation without Keep/Discard handling.

**Required:** Reserve forced replacement for deliberate discard/identity retirement; preserve dirty drafts and baseline under ordinary updates. Arbitrate reads, previews and saves together; do not allow an older read/result to regress progress or authorize a changed draft. Handle internal step navigation without hiding unsaved changes. Prove multi-manager live updates, actual socket outage/reconnect and visibility, held reads/previews, dirty conflict and authority/reset/restore retirement. Retain the corrected Finish-only-on-success behavior.

### R2 / R6 / R7 — Close the remaining required evidence without substituting narrower tests

- **AT1:** Current migration test starts from through-017 and manually inserts the null-timestamp progress row. It does not exercise real adoption of the required populated through-019 cases with/without A progress, C departures, custom grants, calendar/history and control catalog. Test the actual application adoption path and preservation/idempotency assertions, not a hand-constructed output row.
- **AT4/6/7/8/9:** Eight focused integration tests do not demonstrate the required lost-response/competing-save matrix, guide calendar versus first action, both work-kind deletion and used/departed/ended return, lifecycle-only/foreign/display/late-authority denial, or multi-manager recovery. R2's calendar preservation code is improved; retain it and add its competing-save/lock evidence.
- **AT10:** The complete ordinary-UI setup → invitation/redeem → permission/revoke/restore → unused/used removal → backup → reset with backup off → protected Welcome restore → fresh sign-in journey remains **NOT RUN**. It is an explicit local Chromium/WebKit acceptance test. A–C's lower-level matrices do not replace it, and no hosted deployment is needed.
- **AT11:** Direct `scrubRestoredAccess` coverage is useful but cannot prove staged through-017/018/019/D restore, progress/skips/dismissal, source immutability, old claim preview **and redemption** denial or fresh-link recovery. Drive the existing B replacement lifecycle on disposable snapshots; include reset/clear configuration preservation.
- **AT12:** Rail visibility/revisit and deep-link tests are useful, not the full desktop journey or guide-specific tablet/zoom/keyboard/touch/focus and authorization destination evidence. Reuse prior shell evidence only for unchanged shell assertions; supply the new guide assertions.
- **Report:** Pin correction `efc1f22` rather than calling committed work uncommitted. Mark each required subcase honestly; do not label an AT wholly PASS when its required edges remain partial. After substantive corrections, rerun exact PR/RC gates on the returned tree. No need to rerun solely for metadata.

## Disposition and next owner

**Engineering** closes these remaining original R1–R7 requirements directly on **P0-008D r2**, with no new readiness cycle or contract revision. Return named evidence for each remaining subcase and the updated Build Report. No production changes were made by Architecture. The shared card **Set up and manage my household without operator help** remains **In Progress**. Merge, hosted/reset work and Product acceptance are not authorized by this review. Suggest a commit message but do not commit.
