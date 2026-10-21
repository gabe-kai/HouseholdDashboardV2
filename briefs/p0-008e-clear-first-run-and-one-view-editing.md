# BRIEF P0-008E - Clear First Run and One-View Work Editing

**Revision:** 1  
**Status:** READY — Engineering reported READY on 2026-10-17; Architecture ACCEPT / PROCEED on 2026-10-17.
**Planning baseline:** integrated `main` at `65e1949` (P0-008D via PR #27). Current planning checkout is `p0-008-release-evaluation` at `770e975`, a documentation-only commit above that baseline. The Product follow-up is present as an uncommitted change in `PRODUCT.md`; preserve it and do not stage or rewrite it as part of implementation planning.

This brief follows the P0-008D hosted evaluation. It changes presentation and editing interactions, not the approved lifecycle/security contract. The reported `/` routing anomaly is separate Architecture/QA work and is intentionally excluded.

## Why

The Project Lead successfully completed setup, backup, reset, restore, and a container restart, but found setup, work editing, permission changes, and recap clumsy and visually rough. Replacing the successful lifecycle foundation would add risk without addressing the observed friction. This slice makes the first-run and household-management surfaces easier to understand while preserving their current domain services and authority rules.

## Learning question

Can a parent complete first-run setup, create or revise a routine/responsibility, understand its consequences, and manage a person's access without navigating nested edit/review screens or losing the calm visual language?

## Player experience

The installation owner can open the one-time setup invitation directly in the browser that issued it, while retaining copy/share options. A parent confirms a clearly labeled home timezone, adds people using the name they want shown in the app, and can optionally expand profile details. Routine and responsibility forms keep the whole item visible while its parts are edited inline. A readable preview and permission-change summary stay beside the controls; no separate Review detour is needed. Setup ends with a concise summary of the household's actual people and work, with a clear next action.

## Project card

**Card title:** Set up and manage my household without operator help  
**Suggested column:** Up Next for this bounded UX revision; move the shared card to In Progress when Engineering starts.  
**Player-facing goal:** Set up the household and edit its work confidently in one clear flow.  
**Done when:** A parent can use the direct setup action, confirm the home timezone, add people, edit a whole routine or responsibility in one view, understand previews and permission changes, and finish with a useful recap on phone and desktop.  
**Tracking relationship:** UX follow-up to the existing P0-008 card; does not claim overall Product acceptance.

## Current system

Repository facts inspected at integrated `main` `65e1949`; the current planning checkout adds documentation only.

| Surface | Current behavior and relevant implementation |
| --- | --- |
| Installation-owner invitation | `OwnerApp.tsx` issues a one-time fragment invitation and offers Copy link; it does not offer a primary Open setup action. Secret/session and single-use semantics are already implemented. |
| Required household setup | `WelcomeSetup.tsx` accepts an IANA timezone in a free-entry field, suggests the browser timezone, and requires explicit confirmation. Server validates the timezone. |
| People and profiles | `PeopleGroups.tsx` creates a person with display name and Adult/Child classification. Existing profile storage and update API already support optional full name, birthday, and email; creation does not expose them. Access role is managed separately. |
| Permission changes | `PeopleGroups.tsx` edits effective grants with authority-version checks. “Preview & save” reveals a separate save-preview panel before confirmation. |
| Guided first work | `GuidedSetup.tsx` contains routine/responsibility fields and a preview rendered as a scrollable `<pre>`, but the parent must activate Review before Save. |
| Routine authoring | `Routines.tsx` and shared focused editors move name, schedule, steps, and individual steps into separate focused states. |
| Responsibility authoring | `Responsibilities.tsx` uses focused states for name, schedule, assignment, base work, steps, and scheduled additions. |
| Visual system | `styles.css` defines Calm Household warm manila/green tokens and a `--radius` token; this focused change should restore rounded, composed styling on affected surfaces, not invent a new theme. |
| Lifecycle and authority | P0-008A–D services, migrations 018–021, session/outbox ownership, capability checks, current permission/version guards, reset/restore and epoch fencing are already integrated. No change to these contracts is requested. |

## Behavioral contract

1. **Direct setup invitation.** After an authorized installation owner issues the one-time invitation, make **Open setup** the primary action and open the existing same-origin invitation URL in the current browser context. Keep Copy link and existing sharing options. The invitation remains one-use, fragment-only, immediately exchanged and removed; do not persist or log the secret. Explain that installation-owner configuration is an installation prerequisite, not a step repeated for ordinary code deployments.

2. **Understandable household timezone.** Replace raw exact-format entry with a searchable human-readable IANA timezone choice. Suggest the current device timezone without silently selecting it as household truth; show a familiar region/place label and a sample household-local date/time that updates with the selection. Require explicit confirmation. Invalid or unsupported values cannot be saved. Preserve existing timezone-lock behavior once dated household data exists; do not introduce timezone relocation.

3. **Clear person creation.** Label the required field **Name shown in the app**. Keep **More details (optional)** collapsed by default; expose the existing full-name, birthday and email profile fields only when requested. These fields remain optional and are not credentials, access identifiers, or requirements for adding a person. Adult/Child remains descriptive and is visibly distinct from Manager/Member permissions. Use clear Add person, Save, and Cancel actions; support adding successive people without entering a nested detail flow. Do not add new profile attributes or require sensitive data.

4. **Permission consequences in context.** Show a concise plain-language before/after summary beside the permission controls and update it as the draft changes. Keep any necessary explicit confirmation in the same editor view; do not require a separate review page/panel. Preserve effective-grant semantics, unknown grants, optimistic authority-version checking, current actor authorization, and last-essential-manager protection. No save may silently grant or remove capabilities beyond the chosen controls.

5. **One-view routine and responsibility editing.** In guided first-work creation and the normal routine/responsibility create/edit surfaces, keep the complete work item and its Name, When, Who/assignment, and ordered Steps available within one editor view. Users edit fields inline or expand the selected section in place; do not navigate to successive focused pages or hide the rest of the item while editing a part. A phone may stack the same editor vertically and scroll normally; “one view” means one persistent editing context, not that every control must fit above the fold. Preserve all existing advanced options and work-specific controls.

6. **Live, legible preview without a Review detour.** Show a compact, human-readable preview inline with the editor and update it when relevant draft fields change. For routines, show selected people, ordered steps, applicability, and next applicable household dates. For responsibilities, show applicable dates, accountable owner/assignment pattern and scheduled work. Use the existing authoritative preview/resolver paths; do not use debug-like raw output or require a separate Review action before Save. Preview remains read-only and must not materialize occurrences, lock work, advance assignment, or write domain state. The existing server validation, preview-basis/version/date checks and normal Save contract remain authoritative.

7. **Useful finish summary.** The setup completion summary names only people and work actually saved, shows the next applicable work date where known, and distinguishes completed, skipped, and still-available optional setup. Make Go to Today the primary action and View household a clear alternative; preserve the quiet return to unfinished setup.

8. **Calm, cohesive presentation.** On the affected surfaces, restore rounded edges, soft separation, generous spacing, readable field text, and cohesive controls using the existing manila/green visual language and tokens. Keep phone-first touch/keyboard usability while composing desktop forms intentionally. This is not an app-wide redesign.

9. **Draft and saved-state safety.** Cancel/Back preserves the existing Keep editing/Discard behavior. Validation errors and stale-version conflicts retain the user's draft. No duplicate people, routine definitions, or responsibilities are created by preview, back navigation, or retry. Existing create/edit effective-date, current-plan, started-work, history, and assignment semantics remain unchanged.

## Implementation boundary

- UI/client changes in `OwnerApp.tsx`, `WelcomeSetup.tsx`, `GuidedSetup.tsx`, `PeopleGroups.tsx`, `Routines.tsx`, `Responsibilities.tsx`, their existing shared editor/profile helpers, and scoped `styles.css` rules.
- Add first-class profile-detail fields to person creation by reusing the existing profile model/API where possible. Any required server/API adjustment must be limited to those already-supported optional fields; no new personal-data schema is intended.
- Add or update focused component/unit and Playwright evidence for owner invitation action, timezone selection, people/profile creation, permission summary, one-view editing, live preview, finish recap, and responsive geometry.
- Use deterministic fictional fixtures. New screenshots, if captured, belong under ignored `reports/_local-screenshots/p0-008e/`.
- No migration or new dependency is expected. If inspection shows either is unavoidable, Engineering should report the concrete reason during readiness rather than silently expanding the contract.

## Do not change

- P0-008A–D installation-owner, invitation, session, capability, current-grant, last-manager, member-removal, backup, reset, restore, migration, and installation-epoch behavior.
- D-056 saved guide boundaries, atomic domain/progress/receipt behavior, idempotency, conflicts, cross-device recovery, and record identity.
- Routine/responsibility rules, assignment resolution, applicability, date/effective-date semantics, first-action locks, preview purity, history, checklist state, or sync/outbox authority.
- The `/` routing anomaly; it is separate Architecture/QA work.
- Required personal data, new profile fields beyond existing full name/birthday/email, new login/email delivery, new chore semantics, or an app-wide visual/navigation redesign.

## Acceptance tests

1. Owner can open a newly issued setup invitation from the issuing browser; Copy link remains available. Exercise single-use exchange and verify fragment removal, no query token, no durable secret storage, and no reuse after exchange.
2. Timezone control is searchable and human-readable, suggests but does not silently impose the device zone, updates a sample home date/time, requires explicit confirmation, and rejects invalid values. Confirm existing dated-household timezone lock remains intact.
3. Add a person with only **Name shown in the app**; save succeeds with optional details collapsed/blank. Add another with selected optional details; details survive reload and normal People edit. Adult/Child does not imply access role or grants.
4. Permission before/after summary changes beside the controls without opening a separate review surface. Save retains existing grants/version behavior; a last-manager-invalidating or stale-version save is denied with the draft preserved.
5. Guided first-work creation and normal Routine create/edit keep Name, When, Who and Steps within one persistent editor. Editing each part leaves the other draft values visible and intact; routine source, obligations, applicability and selected audience persist as chosen.
6. Guided first-work creation and normal Responsibility create/edit keep Name, When, assignment and Steps in one persistent editor. Fixed, take-turns/weekly, scheduled additions, and Unassigned options already supported by the normal editor remain available and unchanged.
7. Inline previews update when audience, date/recurrence, assignment or steps change; rendered output is readable and contains actual names/work/date meaning, not raw debug text. Save works without a Review action. Preview-only interaction produces no domain writes or occurrence/lock/assignment side effects.
8. Validation failure, Cancel/Back, same-command retry, stale preview basis and stale source/version retain or resolve drafts according to existing contracts; they do not create duplicate work or silently change its effective date.
9. Finish summary reflects only saved records and accurate completed/skipped/available states; Go to Today is primary, View household remains available, and unfinished setup can be reopened.
10. At phone 360×800, tablet 768×1024, desktop 1280×800, and 200% text/zoom, affected forms have no horizontal overflow, clipped preview, obscured primary action, or unusable page-level navigation. Keyboard focus, accessible labels, touch targets, and readable inline summaries pass focused checks.
11. Existing sign-in, permission, invitation, member removal, history, reset, backup, restore and epoch-fencing behavior remains covered by focused protected-behavior regression tests; UI changes do not weaken or bypass server authorization.
12. Exact repository `npm run validate:pr` and `npm run validate:rc` pass. Build Report maps every assertion to the test/checkpoint and marks each PASS, PARTIAL or NOT RUN. No hosted deployment is required for implementation acceptance.

### Acceptance evidence matrix

| ID / assertion | Initial state / fixture | Action | Exact expected result | Evidence type and planned evidence | Result |
| --- | --- | --- | --- | --- | --- |
| AT1a Invitation action | Authorized owner has issued a fresh one-use invitation | Choose Open setup | Existing same-origin fragment invitation opens in the browser; Copy link remains offered | Browser e2e, OwnerApp setup-invite journey | NOT RUN |
| AT1b Invitation security | Fresh invitation and then consumed invitation | Exchange; inspect URL/storage; retry | Fragment is removed immediately; no query/local persistence; second use is rejected | Integration + browser e2e, owner-invitation security cases | NOT RUN |
| AT2a Timezone selection | Fresh household; device timezone differs from chosen home timezone | Search/select, inspect sample date/time, confirm | Human-readable choice and local-time sample update; selection is explicit and not silently replaced by device zone | Component/unit + browser e2e, timezone setup | NOT RUN |
| AT2b Timezone safety | Invalid value and a household with dated dependencies | Attempt save or change locked timezone | Invalid input is rejected; existing lock prevents unsupported relocation | Integration/e2e, timezone validation and lock regression | NOT RUN |
| AT3a Optional profile | New household, one existing manager | Add a person with only app name; reload | Person saves; optional panel starts collapsed; blank details are accepted and remain blank | Browser e2e, person-creation journey | NOT RUN |
| AT3b Optional profile data | New person with full name, birthday, email provided | Save and reopen detail/edit | Only entered optional fields persist; no field is required to add the person | Browser e2e + existing profile integration test | NOT RUN |
| AT4 Permission summary | Person with known/custom grants and an authorized manager | Change role/grants | Before/after summary is adjacent and live; no separate review page; actual saved grants match the draft | Browser e2e + integration, permission-edit journey | NOT RUN |
| AT5 Permission safeguards | Last essential manager and a stale authority version | Attempt forbidden change/conflicting save | Server denies unsafe/stale save, keeps at least one essential manager, and client retains draft | Integration + browser e2e, existing last-manager/version cases | NOT RUN |
| AT6a Routine one-view edit | New and existing routine with audience, recurrence, ordered steps | Edit title, schedule, audience and steps | All sections remain in one editing context; values remain visible and are saved exactly once | Browser e2e, guided + normal routine journeys | NOT RUN |
| AT6b Responsibility one-view edit | Existing responsibility with assignment and scheduled addition | Edit name, schedule, assignment and steps | Same one-view rule; existing assignment/addition options and meaning are preserved | Browser e2e, responsibility create/edit journey | NOT RUN |
| AT7 Preview truth/purity | Controlled household date/calendar plus representative routine and responsibility drafts | Change draft inputs; view inline preview without Review; then Save | Preview updates with authoritative names/date/work; preview alone writes/materializes/locks/advances nothing; save still enforces preview/version basis | Domain integration + browser e2e, preview parity/purity | NOT RUN |
| AT8 Draft recovery | Dirty editor; validation error, cancel, retry, and stale basis cases | Exercise each transition | Draft is retained or deliberately discarded per existing prompt; retries do not duplicate or shift effective dates | Browser e2e + integration, draft/retry cases | NOT RUN |
| AT9 Completion | Saved, skipped, and unfinished setup records | Finish, navigate, reopen setup | Summary reflects saved reality and state distinctions; Go to Today is primary; return path works | Browser e2e, finish/reopen journey | NOT RUN |
| AT10 Responsive/accessibility | Fictional household at phone/tablet/desktop, keyboard and 200% text | Traverse and edit all affected surfaces | No horizontal overflow/clipped content; actions and focus remain usable; controls are readable and sufficiently targetable | Geometry + keyboard/touch e2e; local screenshots only | NOT RUN |
| AT11 Protected behavior regression | Existing populated through-021 fixtures and protected suites | Run focused regressions and PR/RC gates | Access, history, member removal, backup/reset/restore and epoch contracts remain unchanged and green | Existing integration/e2e suites plus `validate:pr` / `validate:rc` | NOT RUN |

## Dependencies

- Integrated P0-008A–D at `main` `65e1949`; D-056 saved guide, profile and work models are the source of truth.
- Existing IANA timezone validation and timezone lock, profile fields/API, invitation exchange, domain editors, authoritative draft preview services, and permission/version safeguards.
- Local disposable fixtures and browser testing only. Hosted deployment and Project Lead acceptance are later, separate checkpoints.

## Relevant decisions

- D-026 (Calm Household visual system), D-050–D-056 (installation owner, lifecycle, backups, access, departure, sample remediation, resumable guide); preserve D-006/D-007/D-053 permission and credential boundaries; preserve D-023–D-025 and D-027–D-034 routine/responsibility semantics.

## Known risks / assumptions

- Product explicitly authorizes optional full name, birthday and email fields; the repository already stores these. This brief adds no new profile field, external delivery, or data-sharing rule.
- Browser timezone enumeration and friendly region labels should use existing platform/runtime capabilities or a small local mapping; no external service or dependency is authorized.
- Normal routine and responsibility editors are independently composed; Engineering may share components where that reduces duplication, but must preserve their different domain contracts.
- The invitation is only available once after issue. Open setup must not imply that an already consumed or expired link can be recovered; existing reissue controls remain authoritative.
- The request covers several related screens. Keep implementation presentation-focused and use the assertion matrix; do not expand to unrelated setup steps or whole-app redesign.

## Engineering readiness

**Reviewed revision:** 1
**Readiness:** READY — Engineering found no material blocker. Architecture accepts the readiness disposition and authorizes implementation of r1. The optional-profile create-path adjustment is within the existing implementation boundary; no contract revision or new migration is required.

**Architecture implementation review:** FIX REQUIRED — the implementation has a responsibility-preview source mismatch while editing section drafts, and several required UI assertions in the evidence matrix are not demonstrated by named P0-008E tests. See `reports/P0-008E-r1-architecture-review.md`. Contract unchanged; Engineering should correct and re-evidence r1.

Implementation may begin on the Project Lead's brief branch. This disposition does not authorize deployment, merge, or Product acceptance.

## Revision history

- **r1:** Initial Architecture brief based on the Product follow-up proposed 2026-10-15 and Project Lead hosted evaluation. Separates route investigation; reuses existing person-detail fields and P0-008 lifecycle/domain contracts; focuses on one-view editing, contextual summaries and Calm Household presentation.
- **Readiness:** Engineering reported READY on 2026-10-17; Architecture ACCEPT / PROCEED with no contract change. `/` routing remains outside this brief.
- **Implementation review:** Architecture returned FIX REQUIRED against r1 on 2026-10-19; see `reports/P0-008E-r1-architecture-review.md`.
