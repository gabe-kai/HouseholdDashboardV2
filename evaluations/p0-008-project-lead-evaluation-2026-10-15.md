# Project Lead Evaluation — P0-008 First-Run and Household Management

- **Related briefs:** P0-008A r1, P0-008B r2, P0-008C r1, P0-008D r2
- **Build/version/environment:** Railway production deployment auto-deployed after merge of P0-008D; exact deployed SHA was not independently recorded in the evaluation conversation. Integrated source at the time was main `65e1949`.
- **Date:** 2026-10-15
- **Evidence source:** Project Lead hands-on report and five supplied screenshots
- **Evaluator or population:** Project Lead
- **Method/context:** Hosted first-run/setup and management walkthrough, followed by in-app backup, reset, restore, and Railway container restart.

## Observations

- The deployment-owner secret was accepted. Welcome then showed the setup-link instruction and an empty saved-backup list. The owner issued a setup invitation; the Project Lead initially expected a clickable link rather than copying the URL and pasting it into the browser address bar.
- Household timezone is a free-entry field. The Project Lead found the expected exact format unhelpful and was concerned an otherwise reasonable entry could be rejected.
- Adding people worked, but the form layout/actions were awkward and their purposes were unclear. The Project Lead entered full names where the app expected the names they wanted displayed, then edited the people to replace them with preferred/friendly names. They would like optional additional person details to be collected at creation when useful.
- School-day setup worked without reported difficulty.
- First routine creation worked, but the form was described as ugly. The Review step was judged less clear than the form, obstructive, and of no benefit; its scrollbar reportedly did not work.
- Finish setup completed successfully, but its visual presentation was described as very ugly. Editing the account was not difficult, though still visually rough. Changing Becky’s permissions repeated the disliked review/panel pattern. Setting up the children otherwise worked.
- The backup flow requested a “passphrase”; the Project Lead discovered this meant the account password. Backup creation succeeded for a backup labeled **Test Backup**.
- Reset succeeded. Restore succeeded. The restored household continued to work after restarting the Railway container.
- With the deployment root URL `/`, the Project Lead saw “This view is unavailable” beneath the app header; using Today, Plan, or Household navigation then opened familiar views. This is a reported routing anomaly, not yet independently reproduced. Repository routing maps `/` to Today, so it should be checked separately from design feedback.
- A second browser tab was open during the setup warning “Someone else updated setup while you were editing.” The Project Lead does not recall making edits in both tabs. The observation is consistent with a multi-tab version conflict, but the exact triggering action is unknown.
- Overall, the Project Lead values the new functionality but wants the reset/first-run process made more attractive and easier to use. They asked to return the work to Design; final product acceptance is not recorded.

## Classification

### VALUABLE

- First-run account, household, people, school-day, and first-work setup completed.
- In-app backup, reset, restore, and post-restart persistence all succeeded in the reported Railway session.
- Account editing and child setup completed.

### CONFUSING

- Setup invitation is a copied URL rather than an obvious in-page “Continue setup” link/action.
- Timezone requires exact free-form input without an evident friendly selector or format guidance.
- “Full name” versus preferred/friendly display name was not clear at entry.
- The backup prompt’s use of “passphrase” did not make clear it meant the account password.
- People form actions and the purpose/value of Review were unclear; permissions reuse the same review pattern.

### FRICTION

- First-run people, work, permission-review, and completion surfaces felt awkward, visually rough, and less usable than the underlying functionality.
- Review output was reported harder to read than the editing form, with a non-working scrollbar.
- An unexpected concurrent-update warning appeared while another tab was open; whether there was a real concurrent write is unknown.

### DEFECT-LIKE

- Root `/` reportedly showed an unavailable view even though `/` is mapped to Today in the repository. Needs a focused route reproduction on the deployed build; do not classify as a confirmed production defect until reproduced.

### RISK

- Exact timezone entry could cause setup failure or an unintended household date/timezone if the accepted format is unclear.
- Review panels that obscure or degrade the draft may reduce confidence in high-impact work and permission changes.
- The setup warning may be misleading if it can appear without a real concurrent update; current evidence is inconclusive because a second tab was open.

### IDEA

- Explore friendlier display-name entry and optional additional person details, without assuming legal names or extra personal data are required.
- Explore making the owner-issued invitation behave like an explicit in-page link/action, while preserving its private, single-use security semantics.
- Reconsider whether review is needed for every setup action and, where it remains, make it useful and readable rather than a degraded duplicate of the editor.

## Evidence limits

- These are one Project Lead’s observations, not representative usability research.
- No exact Railway deployment SHA, active database path, migration-adoption rehearsal result, provider-volume snapshot result, restore credential/link revocation matrix, or restored-backup catalog count was recorded here.
- Reset/restore/restart success is reported; detailed checks such as “backup off created no extra backup” and old invite/display credential rejection were not explicitly reported.
- Root-route behavior has not been reproduced in a fresh session. The second-tab conflict warning has no confirmed cause.
- This report records Product feedback and an evaluation result; it is not independent QA or a claim that all hosted acceptance checkpoints passed.

## Product disposition

- **Status:** REVISE — Project Lead requests a Design pass on first-run and household-management usability; overall P0-008 product acceptance remains pending.
- **Authority:** Project Lead
- **Reason:** Core setup and lifecycle features worked, but the setup, review, permissions, and finish experience imposed avoidable friction and did not meet the Project Lead’s usability expectations.

## Routing

- **To Product/Design:** Propose a cohesive, lower-friction first-run/reset and management experience using the observations above. Preserve the approved security and lifecycle contracts unless the Project Lead explicitly changes product intent; in particular, distinguish the one-time deployment-owner configuration from the family’s setup flow. Define whether preferred display names and optional person details belong in this journey.
- **To QA/Architecture:** Reproduce `/` versus `/today` on the exact deployed build and classify the “view unavailable” result; inspect the multi-tab warning only if it recurs without a confirmed concurrent edit. These are separate from the visual redesign.
- **Coordinator/state update:** P0-008D remains technically ACCEPTED. The shared user-facing card is not Product-Accepted; route the P0-008 experience back to Design for a bounded UX proposal. Hosted backup/reset/restore/restart success is recorded as Project Lead-reported evidence, with the limits above.
