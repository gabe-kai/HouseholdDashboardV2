# Engineering Readiness Review - BRIEF P0-008A r1

**Brief revision reviewed:** 1  
**Review round:** Initial consolidated pass  
**Readiness:** READY  
**Repository/Git state checked:** YES  
**Current branch:** `member-management-first-run-setup` @ `9705e13`  
**Integrated code baseline inspected:** Clean `main` / `origin/main` at **`415d930`** (PR **#23**, C-3B merge)  
**Working tree at review:** Clean; planning commits add Product/Architecture docs and P0-008 briefs only — no A implementation under `src/`, `db/`, `tests/`, or `.github/`

> READY is the default when implementation can reasonably proceed. QUESTION/BLOCKER findings must be material, evidenced, and consolidated; ordinary implementation choices are not readiness gates.

## Verdict

**READY.** D-050, D-051, D-053 (lifecycle grant portion), and D-056 (required basics) are Active and agree with P0-008A r1. The brief’s **Current system** table matches integrated code at `415d930` / tip migrations through **017**: CLI bootstrap with optional seeded-manager reuse, hosted seeding forbidden, no installation-owner principal or setup-progress model, one long-lived DB handle with no replaceable active-database/lifecycle journal, activity-only clear (D-034), and outboxes keyed by membership/session with activity-generation fencing only. Required deltas are forward household migration(s) after 017, installation control persistence outside replaceable household data, owner/Welcome/setup/reset surfaces, runtime DB replacement with epoch fencing, explicit CI selection, and the AT1–12 evidence set—not B backup catalog, C member removal, or D’s full guided first day.

**No BLOCKER. No QUESTION.** This review does not authorize coding; await Architecture **ACCEPT / PROCEED**. B–D remain gated drafts. No live Railway inspection, deploy, or data mutation was performed.

## Decision alignment

| Decision | Brief use | Repo / conflict |
| --- | --- | --- |
| **D-050** | Owner-recovery principal; `INSTALLATION_OWNER_SECRET`; `/owner` invitation; no first-visitor claim; control metadata outside replaceable data | Active planned; absent in code (`config.ts` has no owner secret; route-policy is public/member/display only) |
| **D-051** | Installation ID/epoch/active DB/journal; prepare→activate→reopen; no unlink-then-rename online restore; recovery continuation; multi-household refuse | Active planned; `app.ts` closes over one `db`/`AppStore`; `restore.ts` still unlinks then renames `DB_PATH` |
| **D-053** | Add `household.lifecycle.manage`; backfill from enroll+structure; Manager bundle includes it; A recovery without assuming C’s access.manage | Active planned; grant enum/presets stop at existing closed set; no lifecycle grant |
| **D-056** | Persist required Account + Household basics; resume; no post-activity timezone relocation | Active planned; no setup-progress model; AuthScreen is claim/login only |
| **D-034** | Clear activity history remains scoped; full reset is separate | Implemented; `clearRoutineActivity` + environment gate unchanged by brief Do-not-change |
| **D-007 / D-043–D-049** | Preserve password policy, display principal, privacy, activity/outbox same-epoch behavior within an epoch | Implemented through `415d930`; brief preserves customizations |
| **D-052 / D-054 / D-055** | Backup catalog, departure, fixture remediation | B/C only; correctly out of A scope |

## Current-system claim check

| Claim | Evidence | Verdict |
| --- | --- | --- |
| Planning tip documents at `9705e13`; code matches `415d930`; migrations through 017 | `git log` / `git diff --stat 415d930..HEAD` (docs only); `db/migrations/017_*.sql` | Match (baseline SHA in brief body is older planning tip `4f07593`; code claim still holds) |
| CLI `auth:bootstrap` prints single-use claim; first claim may reuse pending enroll-capable membership | `scripts/bootstrap.ts`; `store.issueBootstrapClaim` / `claim` | Match |
| Browser enrollment requires token entry; no Welcome setup journey | `App.tsx` AuthScreen claim mode | Match |
| No installation-owner principal or setup-progress model | No `INSTALLATION_OWNER*`, `/owner`, or setup-progress tables/routes | Match |
| Hosted forbids `AUTO_SEED`; test bootstrap route only in development/test | `config.ts`; `app.ts` gated `/api/v1/test/bootstrap-claim` | Match |
| One long-lived DB connection; stores captured at construction; no replaceable handle / lifecycle journal | `app.ts` `openDatabase` → `AppStore`/`DisplayStore`; `onClose` closes same `db` | Match |
| Clear activity history is not full reset | `HouseholdSettings.tsx`; `store.clearRoutineActivity` | Match |
| Outboxes: membership / display-session keys; activity generation only; no installation epoch | `outbox.ts`; `display-outbox.ts` | Match |
| Closed grants; route principals public/member/display only | `schemas.ts` `GrantSchema`; `grants.ts` presets; `route-policy.ts` | Match |
| Restore script unlink-then-rename on `DB_PATH` | `scripts/restore.ts` | Match |
| Multiple households schema-allowed; no lifecycle multi-household refuse | `households` PK only; scripts/`ensureEmptyHousehold` use `LIMIT 1` | Match |
| Through-016 fixture exists; no through-017 populated upgrade helper | `tests/helpers/p016-fixture.ts`; no `p017-fixture` | Match (planned AT1 work) |
| CI aggregate includes through `e2e-phone-007c3b`; no 008A selection | `validate-pr.yml`; `package.json` phone scripts | Match |

No Current-system factual contradiction requiring Architecture revision.

## Focused attention areas

### Owner-protected setup and recovery (D-050)

**Repo today:** First manager still depends on CLI/test bootstrap claim. Hosted empty sites are not visitor-claimable via seeding, but there is no protected owner exchange. Sessions are human vs display only.

**Brief / AT2–AT6:** Provision owner secret once; `/owner` → expiring owner session → one-use setup invitation (fragment + same-origin POST); first account + household basics with server-side progress; resume across devices; replace lost invitation/session; rotate owner secret; recover sole manager password without erasing data; adoption path when no viable manager retains data.

**Disposition:** Clear contract. Ordinary choices: control-store file layout/env names beyond `INSTALLATION_OWNER_SECRET`, owner cookie naming, throttle tables, and exact setup-progress schema. **IMPORTANT** delivery care: never log/persist plaintext invitations; transactional consume-and-create; revoke legacy bootstrap when owner-gated setup is authoritative; bound CLI/restore so they cannot bypass installation state.

### Recoverable full reset and runtime DB replacement (D-051)

**Repo today:** Activity clear only. App cannot reopen stores against a new file. Offline restore unlinks the live path then renames—explicitly forbidden as the online path.

**Brief / AT7–AT9 / AT11:** Prepare empty migrated DB → durable activate reference+epoch+operation → reopen stores; recovery continuation bound to operation/initiator/source epoch; lost response recovers Welcome; replay cannot wipe newer data; crash yields intact old or completed new; no hidden pre-reset copy when backup off; truthful cleanup failures.

**Disposition:** Highest implementation risk, but specified well enough for READY. Ordinary Engineering ownership of journal representation and helper names stands. **IMPORTANT:** real process restart/fault injection with live handles (not mocked success); serialize writers/materialization; update backup/migrate/restore tooling to resolve the *active* image; refuse lifecycle ops when `COUNT(households) > 1`.

### Populated-database adoption

**Repo today:** Forward migrations preserve data; auto-seed is opt-in locally and forbidden hosted. Bootstrap may still attach the first claim to a pending fixture manager.

**Brief / AT1 / AT6 / contract §3/§11:** Adopt `DB_PATH` without wipe/reseed; initialize control state/epoch replay-safely; never reuse a canonical fixture person as a *new* first manager; preserve sessions when safely bindable; explicit retained-data recovery when no viable manager; second-household fixture refuses destructive lifecycle.

**Disposition:** Feasible. Build a through-017 populated fixture (extend `p016-fixture` patterns). Intentional delta vs today’s seeded-manager reuse is in-brief work, not a conflict.

### Old-client fencing

**Repo today:** Activity generation fences checklist outboxes and display stale bounds (D-034/D-045). No installation epoch on sessions, receipts, or queues.

**Brief / AT8 / AT10:** Advance installation epoch on full reset; bind sessions/responses/queued intentions/lifecycle receipts; reject stale before receipt replay; recheck authority/epoch after async password work; close old member/display sockets; retire claims/access; retire pre-A durable queue entries that cannot prove epoch with visible explanation; preserve within-epoch offline behavior and D-034 clear.

**Disposition:** Clear extension of existing generation-fencing patterns. **IMPORTANT:** both human and display outboxes need epoch (or equivalent incarnation) proof; member SyncHub today lacks a membership-wide revoke-close helper (display revoke closes exist)—add targeted closes for reset.

### Evidence and release checkpoints

**Repo today:** PR aggregate ends at C-3B thematic phone job; Vite deep-link smoke exists; no hosted owner fixture suite.

**Brief AT2/AT4/AT12:** Deterministic local hosted-profile/HTTPS fixtures; Chromium/WebKit + desktop; exact `validate:pr`/`validate:rc`; explicit A CI selection in the aggregate; Build Report includes no-terminal owner config guide and release checklist; hosted candidate evidence may be **NOT RUN**.

**Disposition:** Feasible. Add `e2e-phone-008a` (or equivalent grep), package script(s), Vite deep-link coverage as needed, bump hard-coded migration tip counts where migrations advance past 017. Hosted Railway proof remains a Project Lead release checkpoint, not a readiness blocker.

## Acceptance-test feasibility (AT1–12)

| AT | Feasible on baseline? | Notes |
| --- | --- | --- |
| 1 Through-017 adoption | Yes | New through-017 fixture; multi-household refuse case; tip-count bumps |
| 2 Hosted owner gate | Yes | Local `APP_PROFILE=hosted` + HTTPS origin fixtures; no test bootstrap route |
| 3 First account race | Yes | Concurrent setup contexts; claim consume patterns exist for similar races |
| 4 Required basics journey | Yes | Phone Chromium/WebKit + desktop; new Welcome/setup UI |
| 5 Interrupted setup | Yes | Restart/resume + protected mid-setup reset |
| 6 Owner recovery | Yes | Secret rotation, manager password recovery, no-manager adoption |
| 7 Reset without backup | Yes | Twice; cancel; activity-clear regression; backup-bytes unchanged |
| 8 Lost response/idempotency | Yes | Hold/drop after commit; continuation cookie; payload/epoch conflict |
| 9 Atomic replacement/faults | Yes | Requires injectable lifecycle hooks + real reopen; highest effort |
| 10 Old clients | Yes | Extend C-2/C-3A multi-context hold patterns with epoch |
| 11 Runtime/operations | Yes | Health/auth after reset; tooling active-path; log redaction |
| 12 Selection and release | Yes | Explicit CI; hosted candidate separately NOT RUN unless authorized |

## Scope confirmation

- **In:** Migrations after 017; installation control + owner/setup/reset routes and UI; lifecycle grant + backfill; runtime DB replacement/epoch fencing; outbox/session fencing; route-policy/PB/sync-matrix; operator script active-path resolution; A CI selection; local screenshots under ignored `reports/_local-screenshots/p0-008a-r1/`; Build Report ops guide.
- **Out:** B backup catalog/restore UI; C permissions/removal/invitations overhaul; D full five-step guided day; automatic live reset/deploy/fixture cleanup; widening D-034 clear; placeholder pages for unimplemented B–D; production data mutation.

## Status for Architecture

**Readiness: READY** for P0-008A revision 1 against integrated `main` @ `415d930` (planning tip `9705e13`).

Await **ACCEPT / PROCEED** before implementation. After that response, Engineering expects to build without another ordinary QUESTION/BLOCKER cycle unless a genuinely new repository fact appears. Suggested implementation branch after proceed: `brief/p0-008a-protected-first-run-reset` (per Architecture sequencing handoff).

## Suggested commit message (readiness writeback only; not committed by this review)

```
docs(P0-008A): record Engineering readiness READY for r1
```
