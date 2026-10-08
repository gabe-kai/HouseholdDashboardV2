# Engineering Readiness Review - BRIEF P0-008C r1

**Brief revision reviewed:** 1  
**Review round:** Initial consolidated pass  
**Readiness:** READY  
**Repository/Git state checked:** YES  
**Current branch:** `brief/p0-008c-member-access-removal` @ `987cdc6`  
**Integrated code baseline inspected:** Clean `main` / `origin/main` at **`f80d47b`** (PR **#25**, accepted P0-008A r1 + P0-008B r2)  
**Working tree at review:** Branch tip `987cdc6` is docs-only (`docs(P0-008C): release r1…`) on top of `f80d47b` — no C implementation under `src/`, `db/`, `tests/`, or `.github/`

> READY is the default when implementation can reasonably proceed. QUESTION/BLOCKER findings must be material, evidenced, and consolidated; ordinary implementation choices are not readiness gates.

## Verdict

**READY.** D-053–D-055 and the brief’s member-access / departure / fixture-remediation contract agree with each other and with merged A/B at `f80d47b`. The brief’s **Current system** claims match the repository. Required deltas are forward extensions of existing seams—not parallel authority or restore stacks—and are specified tightly enough to implement.

**No BLOCKER. No QUESTION.** This review does not authorize coding; await Architecture **ACCEPT / PROCEED**. D remains out of scope. No Railway inspection, deploy, or live-database mutation was performed.

## Decision alignment

| Decision | Brief use | Repo / conflict |
| --- | --- | --- |
| **D-053** | Plain Manager/Member; `access.manage` / `member.remove`; current-grant claim redemption; last essential manager; revoke ≠ remove | Active planned; grants enum + claim preset path lack C capabilities; matches intended change |
| **D-054** | Immediate eligibility end; preserve started/history; unused physical delete vs used tombstone | Active planned; membership status still `pending`/`active` only; `isMemberEligible` = household membership exists |
| **D-055** | Conditional provenance remediation; optional B backup; keep D-017 CLI narrow | Active planned; CLI still backup-first/reference-blocking; no browser remediation |
| **D-050 / D-051 / D-052** | Preserve owner/setup/epoch/backup fences; remediation may reuse optional catalog backup under `lifecycle.manage` | Implemented in A/B; C must not widen backup authority via `member.remove` alone |
| **D-007 / D-023 / D-036 / D-038–D-040** | Session invalidation; first-action locks; assignment; no silent started reassignment | Implemented foundations; C overlays departure eligibility and commit guards |
| **D-017** | Operator fixture cleanup unchanged | Implemented; C must not loosen |

## Current-system claim check

| Claim | Evidence | Verdict |
| --- | --- | --- |
| Merged tip `f80d47b`; household migrations through 018; control catalog migration 001 | `git rev-parse main` = `f80d47b`; `db/migrations/018_household_lifecycle.sql`; control `001_household_backup_catalog.sql` | Match |
| Manager / personalizer presets; UI technical presets; no `access.manage` / `member.remove` | `src/shared/grants.ts`; `GrantSchema`; `PeopleGroups.tsx` preset options | Match |
| `issueEnrollmentClaim` stores preset; `claim()` reapplies `GRANT_PRESETS[claim.preset]` via `replaceGrants` | `store.ts` ~1220–1290, ~1079–1150, ~5810–5817 | Match (primary C invitation seam) |
| Pending person created with empty grants; claim targets pending + `user_id IS NULL` | `createPerson` inserts `[]`; claim membership filter | Match |
| Membership status pending/active only; no departure / access-revoked / authority version | `002_authenticated_authority.sql`; `AccessStateSchema`; profile `version` only | Match |
| Assignment eligibility = same-household identity (`isMemberEligible` → `membershipExists`) | `store.ts` ~6923–6928; group dated versions lack departed filter | Match |
| Started occurrences protected from audience rewrite; no departed-owner execute reject | Today merge of started rows; `applyChecklistStepStatus` lacks former-member guard | Match |
| Member WS keyed by membershipId without targeted close; display has session/device close | `sync-hub.ts` `closeDisplaySession` / `closeAllMembers` only | Match |
| Six Reed fixture IDs; cleanup blocks used/referenced; no shared-work provenance | `seeds/evaluation.ts`; `cleanup-fixtures.ts` | Match |
| B optional backup + catalog + exclusive lifecycle for reset/restore | `lifecycle-runtime.ts` `optionalPreBackup` / `withCatalogLock` / `withExclusive` | Match |

No Current-system factual contradiction requiring Architecture revision of r1.

## Focused attention areas

### Current-grant invitation redemption (contract §4–§6, AT2/AT4)

**Repo today:** Invitation issues with a captured `enrollment_claims.preset`. Redemption builds grants solely from that preset and `replaceGrants`s them onto the membership. Issuer `created_by_membership_id` is stored but **not** revalidated at consume (display claims already recheck `issuerStillAuthorized`). Pending people have empty grants until claim. Profile `version` is not grant authority.

**Brief:** Persist/version grants before enrollment; issuing never changes them; claim reads **current** grants; issuer must still hold enrollment authority; restore sign-in reuses same nondeparted user (pending-only claim path is insufficient).

**Disposition:** In-scope Engineering work. Mirror display issuer recheck; stop preset reapplication; default Member + approval at person create; add authority version + replay-bound permission saves. **Preserve** A owner/setup/`createFirstManagerForSetup`/`establishManagerForRetainedHousehold`/`resetSoleManagerPassword`/bootstrap paths as separate from ordinary person invitation. **IMPORTANT:** every permission/invitation/password mutation must re-read actor+target in the commit transaction and invalidate sessions/sockets under D-007.

### Last-manager and departure races (contract §3, §7–§9, AT6/AT7/AT14)

**Repo today:** Continuity helpers key largely on `household.lifecycle.manage` + active membership (e.g. sole-manager password reset). No `access.manage` / `member.remove`. No transactional “would leave zero essential managers” guard across concurrent demotions/removals/revokes. Membership has no departed/access-revoked state.

**Brief:** Essential manager = enrollment + structure + access.manage + lifecycle.manage, active, sign-in-enabled, nondeparted; pending/revoked/former do not count; reject transactions that would leave zero; race two self-demotions so one survives; backfill access/remove only onto enrollment+structure holders.

**Disposition:** Feasible with a single transactional continuity check shared by permission save, revoke, remove, and fixture batch. **IMPORTANT:** after backfill, align A sole-manager / `hasActiveLifecycleManager` style recovery predicates with the essential four-grant set so owner recovery and ordinary last-manager rules do not diverge; do not treat A/B reset/restore as exceptions inside member administration.

### Assignment / history preservation (contract §8–§11, AT8–AT12)

**Repo today:** `isMemberEligible` is household-existence only. Dated group membership versions can still list a departed ID until C filters. Started rows keep `accountable_member_id` and survive audience shrink; unstarted rows can be canceled/rewritten. Checklist commits do not reject departed owners once started. History is stored-only.

**Brief:** Immediate eligibility exclusion (exception to tomorrow-only group edits); atomic unstarted reconcile; never transfer/recompose started work; Former member / Needs attention; member and display status reject departed-owned work including lock races; unused pending may physically delete after reference inventory; used identities tombstone.

**Disposition:** Highest implementation risk, but contractually clear. Primary hooks already exist (`isMemberEligible`, started protection in materialization, composition override Unassigned semantics). **IMPORTANT (mandatory):**
1. Inventory every SQL/JSON assignee, picker, projection, and execute path—UI tombstone filters alone are insufficient (brief known risk).
2. Serialize first-action vs departure in both orders; reject stale outbox/receipt replay after departure.
3. Add targeted member socket close (display pattern exists); revoke alone is not enough for open tabs.
4. Keep displays household-owned when the enrolling manager departs; invalidate unused issuer-bound claims.

### Optional-backup boundary for fixture remediation (contract §12–§13, AT13)

**Repo today:** B’s `optionalPreBackup` runs inside exclusive reset/restore replacement. Catalog create uses `withCatalogLock` without quiescing ordinary reads/writes. D-017 CLI remains backup-first and reference-blocking. No browser remediation UI.

**Brief:** Conditional remediation when canonical IDs exist; claimed/renamed/used not preselected; optional B backup off by default requiring **lifecycle.manage**; serialize snapshot with selected batch so intervening acknowledged writes are included or force re-preview; backup failure leaves data unchanged; never delete on migration/startup; do not treat fixture-authored shared work as disposable without provenance.

**Disposition:** Feasible by composing B catalog backup + D-054 departure batch under a shared serialization/consent boundary **without** calling reset/restore activation. Ordinary choice: exclusive drain for backup+batch vs versioned preview digest + catalog lock—either can meet “same pre-change state / no silent loss.” **IMPORTANT:** C must not grant backup authority via `member.remove` alone; replay must not duplicate backups or partially apply the batch; keep D-017 CLI semantics unchanged.

## Implementation feasibility (ordinary Engineering discretion)

- Forward household migrations for departure/access/authority version + grant enum/backfill; additive, populated-safe.
- People Profile vs Sign-in & permissions UI; local QR dependency with license review.
- Route-policy / protected-behavior / sync inventories for new surfaces.
- Focused unit/integration/browser evidence + CI selection; ignored screenshots under `reports/_local-screenshots/p0-008c-r1/`.
- Large slice, but edges are specified; decomposition requires Architecture revision only if evidence later proves it necessary (brief known risk)—not a readiness stop.

## NOTES (non-blocking)

- Map friendly directory labels (Invitation ready / Access revoked) onto extended `AccessState` values.
- Claim’s current display-name overwrite at enrollment is account setup for a pending person; restore-sign-in must not create a replacement user.
- Unknown legacy grants: preserve and report honestly when introducing the secondary Permissions editor.
- Hosted/Railway populated remediation remains Project Lead–authorized; rehearsals on isolated copies only.

## Out of scope (confirmed)

- P0-008D guided setup; parental private-task override; arbitrary roles; email delivery; Cover/Claim; locked-work reassignment; automatic sample deletion on migrate/startup; Railway/live DB operation; Product acceptance.

## Suggested next step

Architecture **ACCEPT / PROCEED** on P0-008C r1 against `f80d47b`. Engineering then implements on `brief/p0-008c-member-access-removal` with an evidence-mapped Build Report. No deploy or live-database work is implied by READY.
