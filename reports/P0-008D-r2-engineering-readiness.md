# Engineering Readiness Review - BRIEF P0-008D r2

**Brief revision reviewed:** 2  
**Review round:** Initial consolidated pass  
**Readiness:** READY  
**Repository/Git state checked:** YES  
**Current branch:** `brief/p0-008d-guided-first-household-day` @ `0938980`  
**Integrated code baseline inspected:** Clean `main` / `origin/main` at **`1709097`** (PR **#26**, accepted P0-008A r1 + P0-008B r2 + P0-008C r1; C correction `90de153`)  
**Working tree at review:** Branch tip `0938980` is docs-only (`docs(P0-008D): release r2…`) on top of `1709097` — no D implementation under `src/`, `db/`, `tests/`, or `.github/`

> READY is the default when implementation can reasonably proceed. QUESTION/BLOCKER findings must be material, evidenced, and consolidated; ordinary implementation choices are not readiness gates.

## Verdict

**READY.** D-056 (r2 refinement) and the brief’s guided first-day / complete P0-008 lifecycle contract agree with each other and with merged A–C at `1709097`. The brief’s **Current system** claims match the repository. Required deltas are forward extensions of existing Welcome/`setup_progress`, domain editors, restore scrubbing, and CI selection patterns—not a parallel setup or backup stack—and are specified tightly enough to implement.

**No BLOCKER. No QUESTION.** This review does not authorize coding; await Architecture **ACCEPT / PROCEED**. Hosted/Railway inspection, deploy, and live-database mutation were not performed. Local/disposable harnesses are assumed for implementation evidence.

## Decision alignment

| Decision | Brief use | Repo / conflict |
| --- | --- | --- |
| **D-056** | Versioned household `setup_progress`; optional steps/skips/dismissal; real-record links; draft preview; lifecycle.manage for expanded guide; restore recovers guide; no email/fixtures | Active; A required basics only at `setup_progress`; D extends in-household DB |
| **D-050 / D-051 / D-052** | Preserve owner/setup/epoch/backup fences; restore sanitizes access; no second replacement system | Implemented in A/B; D must extend scrub for C claims |
| **D-053 – D-055** | Reuse C invitations, last-manager, departure, fixture remediation unchanged | Merged at `1709097`; guide must not weaken |
| **D-017 / D-023–D-025 / D-027–D-040** | Domain commands, locks, current/future, History, unused deletion | Implemented; guide reuses, does not reimplement |
| **D-045 / D-047** | Sync invalidation, outbox/epoch fences | Implemented foundations for progress invalidation |

No Active-decision contradiction requiring Architecture revision of r2.

## Current-system claim check

| Claim | Evidence | Verdict |
| --- | --- | --- |
| Merged tip `1709097`; household migrations through 019; control catalog 001 | `git rev-parse main` = `1709097`; `db/migrations/019_member_access_removal.sql`; 19 household migrations | Match |
| Welcome Account/Household/done only; Back from Household returns account-create form | `WelcomeSetup.tsx` steps `account`/`household`/`done`; Back → `setStep("account")` with create form | Match |
| `setup_progress` has account/household completion + membership/user links only | `018_household_lifecycle.sql`; `getSetupProgress` selects those four fields | Match |
| `setupRequired()` gates on household completion / empty install; independent of optional progress | `store.setupRequired()` — no optional-step columns yet | Match |
| `GET /api/v1/setup/progress` is member-session read; household save has no expected guide version | `lifecycle-routes.ts` progress GET + `completeSetupHousehold` (no mutationId/version) | Match |
| People/access/removal/sample remediation exist (C) | migration 019; `member-access.ts`; PeopleGroups UI | Match |
| School calendar versioned save exists; no onboarding wrapper / Not now | `SchoolCalendar.tsx` / `saveSchoolCalendar` | Match |
| Responsibility `previewDraftResponsibility` exists; routine draft preview missing (personal-layer preview ≠ unsaved first routine) | `POST /api/v1/responsibilities/preview-draft`; `GET /api/v1/personal-layer/preview` | Match (intentional D delta) |
| No `/household/setup` destination; Today empty copy lacks Household link | `nav.ts` has no setup path; `TodayView.tsx` “Nothing assigned to you…” | Match |
| Settings has Household details + Backups + Reset; no Finish setup entry | `HouseholdSettings.tsx` | Match |
| `scrubRestoredAccess` retires sessions + legacy `enrollment_claims` + display claims; **not** `membership_access_claims` | `backup-catalog.ts` `scrubRestoredAccess` | Match (known D repair) |
| Access-claim preview/redeem gate consumed/revoked/expiry; no stored epoch fence on claim rows | `findAccessClaimByToken` / `previewAccessClaimPayload` | Match |
| Playwright `chromium-008a` / `webkit-008a` / desktop-008a; CI `e2e-phone-008a/b/c`; no D selection | `playwright.config.ts`; `validate-pr.yml`; `package.json` | Match |
| Release checklist doc exists as plan, not completed hosted evidence | `docs/p0-008-release-evaluation.md` | Match |

No Current-system factual contradiction requiring Architecture revision of r2.

## Focused attention areas

### 1. Atomic domain/progress saves and retry recovery (contract §2–§3, AT4)

**Repo today:** Domain mutations commonly use stable `mutationId` receipts (`person_create`, routine/responsibility receipts). Some paths write the receipt after the domain transaction (e.g. `createPerson` commits membership then writes `person_create` outside the same SQLite `transaction()`). `completeSetupHousehold` updates household + `setup_progress.household_completed_at` together but has no mutation receipt or expected progress version. Account creation uniqueness is rechecked inside the write TX after passphrase hashing.

**Brief:** Guide save commits domain change + progress/link + bound receipt in one household transaction; ambiguous retry same mutation ID; revalidate actor/household/epoch/expected versions/preview basis inside the commit; lost Account response recovers without duplicate manager.

**Disposition:** Feasible. Extend `setup_progress` (forward migration after 019) with versioned optional choices, stable links, finish/dismissal; add guide command receipts and wrap domain+progress+receipt atomically. Prefer in-transaction receipt writes for new guide paths even where older seams write receipts after commit. Account recovery can reuse A’s existing first-manager uniqueness + normal sign-in/owner recovery. **IMPORTANT:** do not turn guide configuration into checklist-outbox work; keep `setupRequired` independent of optional completion.

### 2. Draft previews (contract §7, AT5)

**Repo today:** Responsibility draft preview is side-effect-free and resolver-based (`previewDraftResponsibility`, 7-day window). Routine “preview” for personal layers is saved-layer composition, not an unsaved shared first routine. Materialization/locks are separate from these reads.

**Brief:** Add narrow draft-routine preview; extend/reuse responsibility draft preview; show real names/next dates; zero domain side effects; Save rechecks source versions and household date.

**Disposition:** Intentional delta (brief Known risks). Reuse existing resolvers (`isDateApplicable`, composition deps, school applicability). Ordinary Engineering choice for response shape/UI wiring within the contract. **IMPORTANT:** Save must bind preview consent (versions + household date) so midnight/source change forces fresh review.

### 3. Deletion-reference compatibility (contract §2, AT7)

**Repo today:** Unused-person physical delete retires solely owned setup receipt kinds (`RETIRABLE_SETUP_RECEIPT_KINDS`) and otherwise blocks on `evaluateMembership` reference inventory including `structure_mutation_receipts`. Unused routine/responsibility delete paths exist with reference checks. `setup_progress` currently points only at the first manager membership/user.

**Brief:** Optional guide links/receipts must not make otherwise unused people/work undeletable; old guide retries cannot recreate deleted IDs; departed/ended work shown truthfully.

**Disposition:** Feasible by classifying new guide receipt kinds as retirable when they solely name the unused person/work, and resolving progress links against current memberships/definitions (omit/truthful missing). **IMPORTANT (mandatory):** inventory every new stable link/receipt column against physical member delete, unused work delete, fixture cleanup, and restore scrubbing before claiming AT7.

### 4. Retirement of all C access claims during restore (contract §11, AT11)

**Repo today:** `scrubRestoredAccess` updates `auth_sessions`, `display_sessions`, `enrollment_claims`, `display_enrollment_claims`, and bumps credential/access versions when present. It does **not** touch `membership_access_claims` (invitation / password_reset / restore_sign_in). Claim preview/redeem succeed for unconsumed, unrevoked, unexpired tokens by digest alone—no installation-epoch column on the claim table. After restore, a new epoch is published, but outstanding C tokens in the restored image remain redeemable unless scrubbed.

**Brief:** Extend staged restore sanitation to retire every C member-access claim purpose; old tokens fail preview and redemption; fresh authorized links work. Supported pre-D backups adopt safely.

**Disposition:** Concrete in-scope repair (brief Known risks; D-052). Add revoke/consume of all open `membership_access_claims` inside `scrubRestoredAccess` (table-exists guarded like other scrub steps). Prefer revoke-at scrub over relying solely on epoch columns; if an epoch fence is also stored, it must not leave pre-scrub tokens usable. **IMPORTANT (mandatory):** AT11 evidence must include unexpired tokens of all three purposes failing preview and redeem after restore, with source backup bytes unchanged.

### 5. Explicit D browser/CI selection (contract §12–§14, AT2/AT10/AT14)

**Repo today:** Owner-gated `chromium-008a` / `webkit-008a` / `chromium-008a-desktop` select `z-p0-008a/b/c` specs. CI aggregate requires `e2e-phone-008a`, `008b`, `008c`. Package script exists for C; none for D. Core Chromium/WebKit projects ignore 008\* specs.

**Brief:** Add `e2e-phone-008d` + project-local script; select D phone Chromium/WebKit, desktop setup/geometry, built/Vite guide routes; ensure older greps do not consume D; screenshots under ignored `reports/_local-screenshots/p0-008d-r2/`.

**Disposition:** Same delivery class as A–C readiness. Wire Playwright `testMatch` / grep titles, package script, Actions job, and aggregate `needs` in the same implementation tip. Prefer titles that do not collide with a bare `P0-008` umbrella.

## Implementation feasibility (ordinary Engineering discretion)

- Forward household migration after 019 for guide metadata on `setup_progress` (or tightly related household-scoped tables); keep metadata out of installation-control.
- Narrow Welcome/guide destination `/household/setup`, Settings Finish setup entry, Today empty-state Household link, nav/API/schemas.
- Reuse people/calendar/work forms and extract shared helpers only as needed; preserve ordinary Plan editors.
- Route-policy / protected-behavior / sync catalog updates for new guide surfaces and progress invalidation.
- Update `docs/p0-008-release-evaluation.md` runnable paths after implementation; hosted observations remain separately pending.
- Large integration slice, but edges are specified; decomposition requires Architecture revision only if evidence later proves it necessary—not a readiness stop.

## NOTES (non-blocking)

- Account Back review can load current session identity via existing session/progress reads rather than re-rendering the create form; password maintenance already has dedicated routes.
- Timezone becomes read-only once dated calendar/work/activity exists—detect via existing calendar/occurrence presence checks; no relocation feature in this slice.
- Customized lifecycle-only managers need honest unavailable sections for people/calendar/work lacking underlying grants.
- Dirty draft retention is client-local ordinary form state; pin baselines against progress/domain invalidation without storing passwords/tokens.
- `createPerson`’s post-TX receipt write is a pre-existing seam; new guide atomicity must not regress C’s unused-delete receipt retirement rules.

## Out of scope (confirmed)

- Hosted Railway inspection/deploy/live remediation; Product acceptance; email delivery; new grant/role system; Cover/Claim; multi-household setup; application-wide redesign; automatic example fixtures; timezone history relocation.

## Suggested next step

Architecture **ACCEPT / PROCEED** on P0-008D r2 against `1709097`. Engineering then implements on `brief/p0-008d-guided-first-household-day` with an evidence-mapped Build Report. No deploy or live-database work is implied by READY.

## Suggested commit message (do not commit)

```
docs(P0-008D): record r2 Engineering readiness READY

```
