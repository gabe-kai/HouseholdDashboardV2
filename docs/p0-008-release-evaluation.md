# P0-008 release and Project Lead evaluation

Prepared by Architecture on 2026-10-12 for **P0-008D r2**. This is the release/evaluation plan, not a record of completed checks. Engineering updates actual routes and records local evidence in its Build Report. Product/Project Lead owns hands-on judgment.

**Current evidence:** A–C are technically accepted and merged at `1709097`. D r2 implementation at `b90cd7f` is **FIX REQUIRED**; see `reports/P0-008D-r2-architecture-review.md`. Close local contract/evidence gaps before selecting a release candidate. Hosted adoption/reset/restore and the uninterrupted full Product session remain **NOT RUN**. The actual Railway dataset, storage layout and deployed commit have not been inspected for this release.

### Runnable local paths (after D r2 implementation)

| Surface | Path / command |
| --- | --- |
| Protected Welcome | `/welcome` |
| Guided first-day setup | `/household/settings` → Finish setup, or `/household/setup` after household basics |
| Settings grouping | Household details → Finish setup → Backups |
| Integration evidence | `npx vitest run tests/integration/p0-008d.test.ts` |
| Phone Chromium D | `npm run test:e2e:chromium:phone:008d` |
| Phone WebKit D | `npx playwright test --project=webkit-008a --grep "P0-008D"` |
| Desktop D | `npx playwright test --project=chromium-008a-desktop --grep "P0-008D"` |
| Exact gates | `npm run validate:pr` then `npm run validate:rc` |
| Local screenshots only | `reports/_local-screenshots/p0-008d-r2/` (gitignored) |

## 1. Complete local technical acceptance first

- Use isolated unseeded local/test installations for D's complete ordinary-UI setup and management journey, response-loss/concurrency/restore tests and populated through-019 upgrade rehearsal. Close the known staged-restore omission for C member-access claims, including unexpired links of all three purposes.
- Pass exact `npm run validate:pr` and `npm run validate:rc` on the delivered tree. Include D phone Chromium/WebKit, desktop setup/geometry, built/Vite guide routes and the Actions aggregate.
- Architecture accepts the exact brief revision. Project Lead integrates it through Git. Record the accepted source/candidate SHA and CI result before selecting a hosted candidate.

Implementation does not require deploying iterations. Local/LAN physical testing can reveal usability problems before any release.

## 2. Prepare the existing hosted installation safely

Engineering/operator checks, after the Project Lead authorizes the release:

1. Privately identify deployed SHA, actual schema and active database reference, persistent control/data/backup directories, owner configuration, disk space and single-process settings. Use the control store's active path rather than assuming the original `DB_PATH` still names active data.
2. Take a separately authorized migration safety backup and rehearse forward adoption on an isolated populated copy. Record that operator action distinctly from the app's default-off pre-reset/pre-restore choice. Verify supported older and current snapshots restore through the staged application pipeline; source files stay unchanged.
3. Provision/verify `INSTALLATION_OWNER_SECRET` through the host secret UI and durable `INSTALLATION_CONTROL_PATH`, household data and `BACKUP_DIR`. Missing ownership must leave lifecycle entry closed while ordinary populated use remains available.
4. Deploy the exact locally verified candidate behind HTTPS with WebSocket forwarding. Verify secure cookie/Origin behavior, protected owner entry and ordinary sign-in, then restart and confirm persistent data/control/catalog state.
5. Project Lead chooses whether current household data is disposable. For disposable data, the Project Lead deliberately uses Reset household in the app. If real data must remain, use C's reviewed canonical-ID remediation with conservative defaults and preserve ambiguous work; activate a real successor manager before removing a sample manager.

Use a disposable hosted installation for destructive automation. Planning/acceptance never authorizes clearing the populated Railway household. Do not place private origins, names, credentials, invitation fragments, screenshots of one-time material or raw household backup data in tracked reports.

## 3. Observe the complete parent journey

Project Lead evaluates phone and desktop against the accepted candidate, without terminal/database commands. Initial host-secret provisioning is the deployment-owner action above; the parent journey begins with protected browser setup access.

1. Start at protected Welcome, create the first account and confirm household name/timezone. Add family members; confirm the manager appears once. Configure School days or deliberately choose Not now.
2. Create a routine and a responsibility using the saved family. Correct one choice from review, then save. Explain who receives each checklist and the actual next applicable date. Open Today and Household; a manager assigned only children should understand their own empty Today.
3. Pause after a saved boundary, reload or resume on another device, and confirm the same records return. Skip/dismiss an optional choice and find Finish setup again in Settings without a forced login walkthrough.
4. Invite another person through Copy link or QR, redeem in a separate browser context, and recognize their identity/Today. Change permissions without changing the account; exercise password help and revoke/restore sign-in. Keep a real active essential manager throughout.
5. Remove a mistaken unused person and a used member after reviewing next-week consequences. Confirm retained History/started work and repaired or visible Unassigned work; former people and their personal tasks leave current summaries.
6. Create a labeled backup. Deliberately reset with Save a backup **off**, start again briefly, and confirm the saved backup remains with no unexpected new copy. Restore from protected Welcome, sign in securely to the restored manager and confirm saved guide choices, work and history. Old human/display/link access must stay retired; walls require fresh enrollment.
7. Restart the deployed service and confirm the restored household, guide and backup catalog persist. Record current identity, result messages and any recovery ambiguity.

The observer records friction and confidence as well as correctness: visibility of Back/exit/primary actions, compact family entry, review clarity, phone keyboard/touch comfort, desktop spacing, empty Today, and any explanation/coaching needed. Automated checks support these observations; they do not supply the human judgment.

## 4. Record outcomes and ownership

- **Engineering release evidence:** exact candidate/deployed SHA, environment/profile, schema/adoption rehearsal, persistence, default-off backup/reset/restore/restart, access sanitation and any PARTIAL/NOT RUN. Use the D Build Report or a linked concise release report.
- **Project Lead evaluation:** dated file in `evaluations/` using `templates/EVALUATION_REPORT_TEMPLATE.md` when useful; record actual KEEP/CHANGE/DEFER decision and observations. An agent may organize supplied feedback but cannot invent the session or approval.
- **Card:** `Set up and manage my household without operator help` moves to Ready to Evaluate at D technical acceptance and to Accepted only after Project Lead acceptance. Defects violating the brief return to Engineering; changes to intended experience go to Product/Design.

Pending hosted/manual evidence remains explicitly pending even when local technical acceptance passes. No current item above has been represented as a hosted PASS.
