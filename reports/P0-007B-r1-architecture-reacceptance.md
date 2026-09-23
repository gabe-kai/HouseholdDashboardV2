# Architecture re-acceptance review - P0-007B r1

**Disposition:** ACCEPTED
**Reviewed branch:** `brief/p0-007b-assignment-patterns-scheduled-work`
**Baseline:** integrated `main` at `51322e0`
**Reviewed correction state:** same r1 branch after `d69ef33`; Engineering correction work remains uncommitted at review time
**Brief:** `briefs/p0-007b-assignment-patterns-scheduled-work.md`
**Build Report:** `reports/P0-007B-r1-build-report.md`
**Prior review:** `reports/P0-007B-r1-architecture-review.md` (FIX REQUIRED)

## Basis for acceptance

The corrected Build Report maps all previously withheld B-specific evidence to named automated evidence. AT1-AT16 are marked PASS, including the previously incomplete areas:

- AT2: deterministic assignment/date behavior, boundary moves, anchor preservation, DST/travel time zones, restart/reset, and group arbitration;
- AT7: group eligibility, exclusions, pending access, returnees, Unassigned repair, renames, and referenced deletion;
- AT9: scheduled-work lifecycle, removal, collisions, predecessor restoration, and started-history preservation;
- AT10: both race orders plus atomic plan/group rollback;
- AT11-AT12: offline replay, delayed/out-of-order handling, multi-manager convergence, reconnect/visibility recovery, stale responses, and dirty-draft conflict;
- AT13-AT14: mixed responsibility History/reset and authority/reference cleanup;
- AT15: B-specific browser/layout evidence at 360px, desktop width, 200% text, and WebKit-eligible journeys.

Independent Architecture verification also ran `npm test`: **189/189 tests passed across 30 files**. The Build Report records `validate:pr` and `validate:rc` passing, with Vite and WebKit evidence, and prior evidence directories unchanged. Hosted or physical-device evidence is not required by this brief.

No contract change, new readiness review, deployment, or production evidence is required for r1. The remaining evaluation is product-facing: whether Upcoming, Confirm-and-save, Unassigned repair, and the responsibility journeys are understandable in ordinary use.

## Disposition and next owner

P0-007B r1 is technically accepted. The Project Lead may commit the correction state, merge the branch, and perform the normal product evaluation. Do not treat this Architecture acceptance as product acceptance. P0-007C remains the next planned slice after B evaluation; it is not included in this acceptance.

**Suggested Architecture commit:**

```text
P0-007B: accept r1 after closing B-specific evidence

Record Architecture re-acceptance of assignment, scheduled-work,
offline, sync, History, authority, and cross-browser evidence.
```
