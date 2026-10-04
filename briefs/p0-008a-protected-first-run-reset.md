# BRIEF P0-008A - Protected First-Manager Setup and Repeatable Reset

**Revision:** 1
**Status:** READY

Engineering readiness against this revision is **READY**. Implementation follows Architecture ACCEPT / PROCEED. Technical acceptance and Project Lead acceptance are separate.

## Why

A parent currently needs an operator-issued bootstrap claim and cannot reset a hosted household to Welcome. The smallest useful first result is a protected browser journey that creates a real manager and household, then can deliberately start over repeatedly. It also establishes the security boundary needed for later restore: installation ownership and operation recovery cannot disappear with household data.

This is the first of four P0-008 briefs. It delivers required account/household setup and reset **without a new backup**. B adds the optional backup choice and in-app restore; C adds everyday member administration/removal; D completes the five-step guided first-day experience. Do not present A as the complete P0-008 outcome or offer an unimplemented backup control.

## Learning question

Can the Project Lead establish the first manager and repeatedly return a local or hosted installation to protected Welcome using the browser, including after an interrupted response, without a terminal or accidental public takeover?

## Player experience

The deployment owner obtains a short-lived setup invitation through a protected owner page and opens Welcome: **Set up your household**. The parent supplies their name, Username and Password, then names the household and confirms its timezone. Saved progress survives reload and signing in elsewhere. They can enter Today or Household after these two required steps; optional family/work guidance follows in D.

Household settings offers a deliberate **Reset household** action. After reading what will be erased and typing RESET, the initiator returns to protected Welcome and can create the next household. Saved backups, if already present, survive; this initial slice explicitly creates no pre-reset backup. Losing the response does not repeat the destructive action.

## Project card

**Card title:** Set up and manage my household without operator help
**Suggested column:** Up Next; In Progress when A begins
**Player-facing goal:** Create the first manager and safely start setup again in the browser.
**Done when:** The parent completes account/household setup, resets it twice, and can recover the resulting Welcome after reload without operator commands.
**Tracking relationship:** First enabling journey under the shared P0-008 card. The whole card becomes Ready to Evaluate after A–D; each slice receives its own hands-on checkpoint. No external board is configured.

## Current system

Inspected `member-management-first-run-setup` at `4f07593`; local `main` and `origin/main` are `415d930` (PR #23). Only `PRODUCT.md` differs from that integrated code baseline. Migrations end at 017. No production database was inspected or changed.

| Evidence | Fact / intentional delta |
| --- | --- |
| `src/server/scripts/bootstrap.ts`, `src/server/store.ts` (`ensureEmptyHousehold`, `issueBootstrapClaim`, `claim`) | CLI prints a single-use claim. First claim may reuse a pending seeded manager. Browser enrollment requires token entry. There is no installation-owner principal or setup-progress model. |
| `src/server/config.ts`, `src/server/app.ts` | Hosted seeding is already forbidden; normal local seeding is opt-in. Hosted bootstrap test route is absent. Authenticated HTTP/WS and separate display credentials already exist. |
| `src/server/app.ts`, `src/server/db.ts` | One long-lived database connection and stores are captured by app construction. Startup applies forward migrations. There is no replaceable active-database handle or durable lifecycle journal. |
| `src/client/HouseholdSettings.tsx`, `src/server/store.ts` (`clearRoutineActivity`) | Existing clear deletes recurring execution evidence only, advances household activity generation, and preserves configuration/access/personal tasks. This is not full reset. |
| `src/client/outbox.ts`, `src/client/display-outbox.ts` | Member queue keys use membership ID; display keys use session ID. Activity generation does not fence a restored database containing reused IDs/generations. |
| `src/shared/grants.ts`, `src/server/route-policy.ts` | Closed grants have no installation lifecycle authority. Route inventory models public/member/display principals only. |

## Behavioral contract

1. **Protected installation ownership (D-050).** Add a narrowly scoped owner-recovery principal, separate from member/display identity. Provision `INSTALLATION_OWNER_SECRET` once through the deployment's secret UI; use a password-manager-generated secret with at least 256 bits of randomness. The protected `/owner` browser path exchanges this proof for an expiring owner session and can issue a one-use setup invitation. This supplies setup without shell/database commands; the parent receives the invitation, not the deployment secret. No first-public-visitor claim, default password, shared demo credential, or localhost bypass on hosted origins. Missing configuration leaves ordinary populated use intact but setup/reset/recovery unavailable with a clear owner action; public Welcome remains closed.
2. **Secret lifecycle.** Owner sessions are digest-backed opaque cookies, separate from human/display cookies, with 15-minute idle and one-hour absolute limits. Setup invitations are random 256-bit single-use values with a 30-minute expiry. Use fragment-bearing links exchanged by same-origin POST and remove the fragment immediately; no secrets in query strings, logs, persisted UI state, receipts, or external QR/analytics services. Only issuance returns plaintext. Lost invitations are replaced through owner recovery; never recover a plaintext token from storage. Apply Origin checks, throttling, CSRF after exchange, no-store responses, secure hosted cookies, and transactional consume-and-create. These durations are Architecture choices, not claims about an external standard.
3. **One real first manager.** Persist setup state rather than inferring ownership from a count of users. Your account atomically creates one new real membership/user/credential and a provisional household, then Your household confirms name and a valid IANA timezone. Never reuse a canonical fixture person as a new first manager. First account receives the Manager bundle including lifecycle authority. Account/household steps have named progress, Back, accessible inline validation, password help/reveal/paste/autofill, and recoverable errors. First-manager creation, retries, racing setup invitations and lost responses cannot create duplicates or overwrite an established household. Required basics cannot be skipped; after they are saved, offer Today and Household. Confirm browser timezone suggestion rather than silently applying it. Do not change a populated household's timezone during adoption; post-activity timezone relocation is not introduced here.
4. **Resume and owner recovery.** Save completed steps/record IDs server-side without plaintext password drafts. Signing in on another device resumes unfinished required basics. A consumed setup invitation cannot create a second manager. A lost owner session/invitation can be replaced via `/owner`; a lost owner secret is replaced in the hosting secret UI, invalidating prior owner sessions/invitations. A locked-out existing manager can use owner proof to reset that manager's password, revoke prior sessions/access links, and then sign in normally without changing identity, grants or work. Existing data is never erased as a side effect of recovery. If adoption finds no viable manager, protected owner recovery explicitly establishes one for the existing household and reports that data is retained; this is not empty setup.
5. **Explicit member authority.** Add `household.lifecycle.manage` to the Manager preset. Backfill once only to memberships already holding **both** `household.member.enroll` and `household.structure.manage`; preserve every existing grant and identity. This capability owns household basics, full reset and B's backups/restore, independently of `household.activity.clear` and its environment gate. Require current capability and password reauthentication within five minutes for full reset. Owner-recovery access can reset incomplete setup and recover operations; it does not become a member session or browse private work. New principal/dual-cookie combinations must have explicit denial behavior.
6. **Reset scope and UI.** Settings separates Household details and the existing Clear activity history from Reset household. One confirmation names the household, lists accounts/access, people, plans/groups/calendar, personal work, execution/history, displays and pending actions as cleared, says saved backups survive, and requires exact RESET. A's confirmation explicitly says no new backup will be created. `Reset and start setup` replaces all household data with an empty, migrated database; no demo records appear. Reset is available after required setup and from protected incomplete-setup state, and can be repeated. Cancel has no effect. Name changes may be supported; do not invent post-activity timezone reinterpretation.
7. **Replacement boundary (D-051).** Maintain small durable installation control state outside household snapshots: installation ID, strictly increasing dataset epoch, active database reference, owner proof/session metadata, and redacted operation receipts/journal. Adopt the existing `DB_PATH` without replacing or reseeding it. Serialize lifecycle replacement with all database writers/materialization and in-flight privileged work. Prepare/checkpoint a new empty database, durably activate its reference plus new epoch and completed operation, then reopen stores and resume. Crash recovery must choose an intact old or fully prepared new database; never serve a partial replacement. Do not adapt the current unlink-then-rename restore script into an online operation. Engineering owns helper names and the exact journal representation; atomicity and restart behavior are acceptance requirements.
8. **A reset is exactly one operation.** Before destructive commit, establish a restricted, HttpOnly recovery continuation bound to operation ID, initiating authority, source epoch and payload. It survives human-session revocation and lets only that initiator discover the result and resume replacement setup. The journal and recovery lookup survive replacement. Replaying the completed operation returns its result; it cannot reset work created afterward. Reuse with another payload or source epoch conflicts. The continuation cannot reset a newer household or acquire unrestricted owner power. If it expires or its cookie is lost, protected owner recovery can recover the operation/setup. Never put plaintext recovery credentials in an idempotency receipt.
9. **Fence old clients and authority.** Full reset advances the installation epoch in addition to any household activity generation. Bind sessions, responses, queued intentions, and lifecycle receipts to the dataset incarnation. Reject stale commands before receipt replay and recheck authority/epoch at commit after async password/hash work. Close old member/display sockets; retire old claims and all display/human access. Client state and both outboxes reject delayed old responses and old work even after fresh sign-in using the same username or restored membership IDs later. Retire pre-A durable queue entries that cannot prove their epoch with a visible explanation, not blind replay. Preserve normal within-epoch transient-offline behavior and D-034 activity-only clear. Disconnected displays retain only the already accepted bounded stale exposure until revalidation/blanking.
10. **No hidden backup.** When backup is off, create no pre-reset database copy, export, snapshot, or content-bearing journal. The original active file may exist only until replacement commits and crash recovery can safely retire it; promptly remove that obsolete file and WAL/SHM companions or finish cleanup on restart. Saved operator/provider backups are outside the wipe and must be disclosed as retained. B will add intentional saved backups. A file retirement failure cannot silently claim all cleanup finished; report/retry cleanup without running reset again.
11. **Safe populated adoption.** Upgrade preserves real and sample records, IDs, credentials, grants, locks/history, displays and existing backups. Initialization of control state and epoch is replay-safe; it cannot infer consent to wipe. Preserve valid sessions where safely bindable to the adopted epoch; older clients must refresh before unfenced mutations. Revoke legacy first-manager bootstrap claims when owner-gated setup becomes authoritative. Disable/bound legacy bootstrap/restore commands so they cannot bypass installation state. Operator backup/migrate tooling must resolve the active database rather than an abandoned `DB_PATH`. More than one household in a database is an unsupported lifecycle state: refuse full-database reset/backup/restore rather than erase a neighbor. Ordinary reads remain available for recovery.
12. **Hosted release evidence, not hosted iteration.** Build and exercise deterministic local hosted-profile/HTTPS fixtures and normal PR/RC gates first. The Build Report must include a no-terminal deployment-owner configuration guide, active-path/volume layout, populated-copy rehearsal, and a short first-run/reset release checklist. An authorized hosted candidate must prove persistence of control state and new household through service restart and repeated browser reset. Live reset is performed only by the Project Lead's deliberate app action. Report unavailable hosted evidence as NOT RUN; it remains a release checkpoint, not permission to pretend the flow works on Railway.

## Implementation boundary

- Add forward household migration(s) after 017 and installation control persistence/lifecycle orchestration. Update `config.ts`, `db.ts`, app/store construction, session/Origin/CSRF dispatch, route-policy completeness, `SyncHub`, and operator scripts only as needed for safe active-database resolution.
- Add owner/Welcome/setup routes and focused views; integrate `App.tsx`, `main.tsx`, routing, `HouseholdSettings.tsx`, API types and both outboxes. Keep ordinary state ownership above view navigation.
- Extend protected behaviors/sync matrix, `.env.example`, operations documentation, deterministic disposable fixtures, fault injection, and explicit A browser/CI selection in the aggregate required check. Screenshots stay in ignored `reports/_local-screenshots/p0-008a-r1/`.

## Do not change

- No automatic live reset, fixture cleanup, deployment or Git integration. No production data is needed for tests.
- D-034 Clear activity history retains its scope/generation/floor/environment gate. No new backup when A reset says none.
- No B backup catalog/restore UI, C permissions/removal/invitations overhaul, or D full first-work walkthrough; no placeholder pages claiming they exist.
- Preserve private-task isolation, display actor truth, assignment/first-action locks, same-epoch outbox recovery, household dates, and opt-in demo fixtures.

## Acceptance tests

1. **Through-017 adoption:** Disposable populated fixture with real and canonical fixture people, active users/displays, plans/personal work and locked history; upgrade twice without data/identity/grant loss or automatic seeding. Verify FK/integrity checks, active-path resolution and existing backups unchanged. A second-household fixture refuses destructive lifecycle with neither household altered.
2. **Hosted owner gate:** Empty hosted-profile app is unclaimable by a visitor, display or ordinary member. Missing/wrong owner secret, foreign/absent Origin, CSRF, replay, brute-force limits and mixed credentials are tested through HTTP. No test bootstrap route exists in hosted mode. A correct owner exchanges a one-use setup invitation through normal UI.
3. **First account race:** Two setup contexts submit concurrently; exactly one first manager/household wins. Duplicate/lost-response retry resumes or signs in without another membership. Expired/replaced/consumed setup links fail without changing data.
4. **Required basics journey:** Phone Chromium/WebKit and desktop complete Account → Household, confirm timezone, navigate Back, see inline password/username errors, recover ordinary values, and reach Today/Household with no demo content. Password reveal/paste/autofill, focus and narrow keyboard layout are usable.
5. **Interrupted setup:** Restart after account save, resume via another device's normal sign-in, finish the same household. Reset partway through protected setup, then complete a new first manager. Public browsers cannot claim that gap.
6. **Owner recovery:** Replace lost setup access; rotate deployment owner secret; old owner tickets/sessions fail. Recover an existing sole manager without replacing that account/grants or erasing data. A legacy household with no active manager uses the explicitly retained-data recovery path.
7. **Reset without backup:** Confirm scope, cancel once, reset twice from populated then newly populated state. No pre-reset backup is created; old saved backup bytes remain unchanged. Required basics and demo people are absent each time. Existing activity-only clear still preserves configuration/access.
8. **Lost response/idempotency:** Hold/drop reset response after commit; reload initiator with its continuation, recover completed operation and protected Welcome. Create new data, retry the old command, and prove new data survives. Changed payload, other actor, expired continuation and stale source epoch cannot reuse reset authority.
9. **Atomic replacement/faults:** Inject failure before preparation, before activation, after durable activation and before response/cleanup. Close/reopen the real server/database handles. Each case yields intact original or completed replacement plus truthful status; never success for partial work. Verify no hidden data copy with backup off and cleanup recovery after an injected unlink failure.
10. **Old clients:** Queue human and display taps, hold reads and an async auth/config write, reset, restart, establish a new household with reused names, and release/reconnect all old contexts. No stale commands, sessions, receipts, claims, snapshots or responses act in/repopulate the replacement. Notice explains retired pending work; disconnected display blanking and normal same-epoch retries remain covered.
11. **Runtime/operations:** After reset, current health/auth/materialization use the new DB; backup/migration tooling resolves the same active image and legacy restore cannot overwrite around the control record. Restart uses persisted installation state. No secret-bearing result leaks to logs or operation-status readers.
12. **Selection and release:** Exact `validate:pr` and `validate:rc` PASS with A selected in Chromium/WebKit, built/Vite deep-link smoke and the Actions aggregate. Record hosted candidate SHA and browser setup/reset/restart evidence separately, including any NOT RUN. Product evaluates the A journey; this does not close P0-008.

## Dependencies

- Approved `PRODUCT.md` P0-008; integrated P0-007C-3B at `415d930`; no new service/account is required.
- Deployment owner configures the persistent control path/secret through hosting settings before the new setup/reset surface is used. The actual Railway schema/configuration is unverified here; inspect privately during the authorized release checkpoint.
- B–D are gated successor drafts. Do not implement them under A's readiness or acceptance.

## Relevant decisions

- D-007, D-017, D-034, D-043–D-049 remain protected except for the explicit scoped refinements in D-050–D-056.
- D-050/D-051/D-053/D-056 establish owner access, replacement fencing, lifecycle authority and saved setup identity.

## Known risks / assumptions

- Single Node process and one household per installation remain the supported deployment. SQLite control-state + data-image activation requires real restart/failure tests, not mocked success only.
- The deployment owner can keep/recover a secret using a password manager and host settings. No secure, publicly exposed first claim can be inferred from an empty database alone.
- A intentionally has no new saved-backup option; B completes that Product requirement before full lifecycle acceptance. All old backups survive A resets.

## Engineering readiness

**Reviewed revision:** 1  
**Readiness:** READY  
**Review report:** `reports/P0-008A-r1-engineering-readiness.md`  
**Inspected:** planning tip `9705e13` on `member-management-first-run-setup`; integrated code baseline `main`/`origin/main` @ `415d930` (migrations through 017). Working tree clean; docs/briefs only above that code baseline.

**Architecture disposition:** ACCEPT / PROCEED for implementation of A r1 after the planning baseline is integrated. Engineering identified no contract blocker or question. B–D remain gated; hosted destructive operations remain Project Lead actions.

**Engineering disposition:** READY — no BLOCKER, no QUESTION. D-050/D-051/D-053/D-056 align with r1; Current-system claims match the repository. Highest delivery care is runtime DB replacement with real restart/fault evidence, installation-epoch fencing of sessions/outboxes, and owner-gated setup without reusing fixture managers. B–D remain gated.

## Revision history

- **r1:** Initial repository-grounded setup/reset slice of approved P0-008; successor scopes explicitly retained.
