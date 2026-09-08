# BRIEF P0-001 - Shared Morning Routine

**Revision:** 1
**Status:** ACCEPTED

Recommended lifecycle: DRAFT -> IN REVIEW -> READY -> IMPLEMENTING -> IMPLEMENTED -> ACCEPTED

A material contract change increments the revision and invalidates previous Engineering readiness.

`ACCEPTED` means Architecture has accepted the implementation against this technical contract. Project Lead/user acceptance of the experience is separate.

Keep one authoritative brief file for this stable ID. Do not create addenda or sidecar clarifications; fold material changes into this file and revision history.

## Why

The first implementation should prove the hard center of the product rather than merely scaffold a web project: a recurring household routine must become dated, actionable work; rapid execution must feel immediate and shared; and changing future expectations must not rewrite what was previously expected or done.

This slice deliberately uses a local evaluation identity harness so the studio can test that model before choosing production credentials, recovery, and detailed progressive-authority behavior.

## Learning question

Does a versioned routine definition, per-child occurrence snapshots, and optimistic shared checklist make one real Morning Routine understandable, responsive, and historically trustworthy enough to extend?

## Player experience

In a local evaluation build, a parent selects their evaluation profile and defines one Morning Routine by choosing its children, weekdays, and ordered required/as-needed/optional steps. On an applicable household morning, a child selects their profile and sees their routine ready to act on. Several step actions respond immediately even through a brief connection interruption. A parent or second household view sees committed progress shortly afterward.

Completed work becomes a quiet, collapsed summary that can be reopened. A parent can schedule a routine change for the next household day and then verify that today's and earlier occurrence details still show the expectations that applied at the time.

## Project card

**Card title:** Use a shared Morning Routine today

**Suggested column:** Up Next

**Player-facing goal:** Give each child a clear Morning Routine that responds instantly and lets the household see progress.

**Done when:** A parent can define the routine, a child can work through it rapidly on a phone, another open household view sees the progress, and a future change leaves prior history unchanged.

**Tracking relationship:** Standalone card

## Current system

- The repository is a clean Git repository on `main`, tracking `origin/main`, with one initial commit at the time this brief was authored.
- The repository contains studio process documents and empty artifact directories only. It has no application source, `package.json`, lockfile, database, migrations, application tests, or runnable product.
- The local planning environment reports Node.js 24.16.0 and npm 12.0.2; no repository file currently pins or validates those versions.
- `ARCHITECTURE.md` proposes the initial application shape and command contract; D-002 through D-005 are Active decisions for this brief.
- The supplied 2026-09-06 Product-to-Architecture handoff defines the Morning Routine intent. Repository `PRODUCT.md` remains the untouched template, so Product/Coordinator durable reconciliation is still needed; Engineering should implement this brief rather than invent missing product behavior.

## Behavioral contract

1. Engineering must create a single-package TypeScript application that can be installed, seeded, run, built, validated, and browser-tested through the root commands defined in `ARCHITECTURE.md`.
2. The application starts in an unmistakable evaluation mode. It provides fictional seed members including at least one parent-capable profile and two child/member profiles. Selecting a profile creates or changes an opaque server session; subsequent reads and writes derive household, member, and capabilities from that session rather than a client-supplied actor ID.
3. The server binds to loopback by default. Trusted-LAN exposure must require explicit configuration and show that the build uses evaluation identities rather than secure individual login.
4. The evaluation parent can create the household's one Morning Routine definition with a title, one or more selected child members, selected ISO weekdays, and ordered checklist steps. Every step has non-empty text and exactly one obligation meaning: required, as needed, or optional. At least one required step is necessary.
5. The household has one explicit IANA timezone supplied by evaluation setup/configuration. Applicability and displayed occurrence date use that household timezone even when the browser/device uses another timezone. P0-001 has a Morning anchor but does not invent an exact time or a global weekday/weekend context.
6. On each applicable household-local date, the server materializes exactly one occurrence per selected child. Materialization is safe under repeated or concurrent reads and snapshots the effective routine revision, title, Morning anchor, accountable child, step order/text, and obligation meanings.
7. A child Today view shows only that child's current Morning Routine and exposes the actionable checklist without requiring recurrence, permission, or data-model knowledge. An incomplete current occurrence is expanded by default. A completed occurrence is visually quiet and collapsed by default, with an accessible way to expand it again.
8. A required step can be open or completed. An as-needed step can be open, completed, or explicitly marked not needed today. An optional step can be open or completed and never blocks completion. The occurrence is complete only when every required step is completed and every as-needed step is completed or marked not needed; optional steps do not affect completion. Reopening a blocking step reopens the occurrence.
9. A checklist action changes its visible state synchronously in the interaction that triggered it. It does not wait for a response, reload the page, show a blocking spinner/dialog, disable unrelated steps, or run a blocking animation. Three rapid actions remain independently visible and queued.
10. Each checklist action is a desired-state command with a unique mutation ID. Pending commands survive a page refresh in IndexedDB, retry safely, and create at most one committed result per mutation ID. A transient disconnect after the app has loaded does not block additional checklist actions or silently discard them. Pending, offline, retrying, and rejected states are communicated in text or equivalent accessible semantics.
11. A committed step report retains the occurrence's original accountable child, the acting session member, the client-claimed performance instant, the server-recorded instant, and the resulting state as distinct values. In this slice, the server permits a child to execute only their own occurrence and permits the parent to observe rather than complete child work.
12. After a server commit, another connected client in the same household reconciles the change without manual refresh. Under ordinary local/trusted-LAN conditions, the committed state appears in the other open client within two seconds. A reconnect performs an authoritative read so missed WebSocket notifications cannot leave stale state indefinitely.
13. The parent view shows each selected child's Morning occurrence and current completion summary for the household date without exposing child-only controls as parent execution. The API enforces the same capability boundary; hiding controls in the UI is insufficient.
14. The parent can inspect occurrence history by household date. History shows the snapshotted title, accountable child, checklist order and obligation meanings, current step results, and completion summary for that occurrence.
15. Editing the routine creates a new immutable revision effective no earlier than the next household-local date. The new revision affects occurrence materialized for dates on or after its effective date. It does not change the current occurrence, prior occurrences, their checklist snapshots, their original assignments, or their execution records.
16. Refreshing Today or History, retrying a request, or opening two clients concurrently must not create duplicate routine revisions, occurrences, step snapshots, or execution reports.
17. Checklist status, completion, pending synchronization, and errors use visible text/icon/shape semantics in addition to any color. Primary controls have accessible names, visible focus, and touch targets suitable for a narrow phone viewport.

## Implementation boundary

- Establish the application and test structure documented in `ARCHITECTURE.md`: `src/client`, `src/server`, `src/domain`, `src/shared`, `db/migrations`, `db/seeds`, `tests/e2e`, and ignored `runtime` data.
- Implement a React/Vite phone-first client, Fastify JSON/WebSocket server, Node-24-compatible SQLite adapter, tracked migrations, runtime schema validation, and a durable browser outbox.
- Keep recurrence selection, materialization, completion semantics, time handling, and optimistic reconciliation independently testable outside UI components and route handlers.
- Implement only the API/UI needed for evaluation profile selection, one Morning Routine definition and future revision, child Today execution, parent same-day progress, and occurrence history.
- Use versioned JSON routes under `/api/v1`; use household-scoped committed-change notifications under `/api/v1/sync`; validate all boundary data.
- Use fictional committed seeds. Support explicit local configuration for an evaluation household timezone and database path without committing runtime data or access values.
- Add and document the root scripts listed in `ARCHITECTURE.md`, pin the validated Node 24 toolchain, commit the npm lockfile, and update the working-command facts in `ARCHITECTURE.md` if implementation evidence requires an exact correction.
- Engineering may choose local component names and equivalent helper structure. A material change to the single-process boundary, persistence strategy, history model, synchronization semantics, or evaluation-identity boundary requires Architecture review.

## Do not change

- Do not edit Product-owned behavior to fit implementation convenience. In particular, do not merge definition, assignment, acting member, performance time, and record time into one fact.
- Do not implement real authentication, invitation/recovery, an age/role matrix, child personalization, or approval requests in this brief. Do not describe the evaluation selector as secure login.
- Do not implement chore debt, retrospective-completion UI, cover/claim, swap/reassignment, helpers, contextual additions, critical/skip behavior, calendar ingestion, notifications, projects, homework workflows, or multi-household behavior.
- Do not add artificial clock times, global weekday/weekend labels, or device-timezone scheduling merely to simplify Today rendering.
- Do not add a managed backend, paid service, external account, analytics/telemetry service, or secret-bearing client configuration.
- Do not add PWA installation, offline first-load, push notifications, or background work after the browser closes. Preserve the narrower transient-disconnection contract.
- Do not create separate deployable services, npm workspaces, generalized rule engines, or speculative abstractions for Later roadmap items.
- Do not rewrite `PRODUCT.md`, `ROADMAP.md`, `DECISIONS.md`, or the behavioral contract in this brief as part of implementation. Return material conflicts to Architecture/Product through the readiness process.

## Acceptance tests

1. **Fresh setup and command contract:** From a clean checkout with the pinned Node line, `npm ci`, the documented local configuration/seed step, `npm run validate`, `npm run build`, `npm run start`, and `npm run test:e2e` succeed. No real personal data or secret is required.
2. **Routine definition and occurrence identity:** As the parent, create a weekday Morning Routine for two children with required, as-needed, and optional steps. On an applicable household date, both children receive one distinct occurrence. Repeated and concurrent Today reads produce no duplicate occurrence or steps.
3. **Obligation semantics:** In a child profile, verify optional steps do not block completion, an open as-needed step does block, marking it not needed satisfies it, all required steps must complete, and reopening a required/as-needed blocking step reopens the occurrence.
4. **Immediate rapid interaction:** With checklist mutation responses delayed by at least one second in a controlled browser test, act on three different steps rapidly. Each state changes before its response, all three remain independently represented, no reload/modal/spinner blocks input, and eventual server state matches the three intended states.
5. **Transient interruption and retry:** After Today is loaded, intercept API and WebSocket traffic while continuing to serve the static app shell, perform multiple checklist actions, and reload the page. Verify pending intent remains in IndexedDB and is visibly pending. Restore API/WebSocket traffic and verify each command commits once, the outbox clears, and authoritative state matches without manual re-entry. The test does not claim offline first-load support.
6. **Shared propagation and missed-event recovery:** Open child and parent views in independent browser contexts. Commit a child step and verify the parent view reflects it within two seconds under the controlled local test. Then interrupt the parent's WebSocket, commit another change, reconnect, and verify authoritative reconciliation restores the missed state without a page reload.
7. **Assignment/execution separation:** Inspect the API/database through an integration test and verify an execution stores original accountable child, acting member, claimed performance instant, server record instant, and mutation ID separately. Replay the mutation ID and verify no second execution record appears. Attempt a child write to another child's occurrence and verify server rejection.
8. **Prospective edit and trustworthy history:** Complete today's routine, create a revision effective tomorrow that renames/reorders a step and changes one obligation meaning, and inspect today again. Today's occurrence remains byte-for-byte equivalent in its snapshotted structure and retains execution history. Materializing tomorrow uses the new revision. Querying history after refresh/server restart produces the same result.
9. **Household timezone:** Run automated boundary cases with the browser/device timezone different from the configured household timezone, including an instant on opposite sides of household midnight and a daylight-saving transition. Occurrence date/applicability follows the household timezone and does not duplicate or skip the configured local date.
10. **Phone and accessible behavior:** Run the core child flow at a narrow phone viewport in Playwright Chromium and WebKit. Verify no horizontal page overflow, primary controls remain reachable, controls have accessible names and visible keyboard focus, and completion/pending/error states remain understandable with color removed.
11. **Focused physical-device evidence:** When an iOS or Android phone is available on a trusted LAN, load the explicitly exposed evaluation build, complete several steps rapidly, and observe progress in a second client. Record device/browser and observations in the Build Report. If no device is available, record this test as not performed rather than passed.

## Dependencies

- Node.js 24 LTS line and npm; Engineering must pin the exact validated toolchain range.
- Runtime packages consistent with D-002 and D-004: React, Fastify, a Node-24-compatible `better-sqlite3`, WebSocket support, and runtime schema validation. A small IndexedDB wrapper is permitted when it reduces correctness risk.
- Development packages for Vite, TypeScript, linting, Vitest, and Playwright.
- Network access to the npm registry during initial dependency installation.
- No paid service, external account, API key, or remote database.
- Product/Coordinator durable update to `PRODUCT.md` is pending but does not block Engineering readiness for this explicit contract.

## Relevant decisions

- D-001 - Default target
- D-002 - Single-process TypeScript web application for the first slice
- D-003 - Versioned definitions and snapshotted occurrences
- D-004 - Server-authoritative state with optimistic durable client intent
- D-005 - Evaluation identity is a temporary local boundary

## Known risks / assumptions

- **Assumption:** The Project Lead intends the supplied Product-to-Architecture handoff to authorize technical planning even though Product has not yet copied that intent into repository `PRODUCT.md`.
- **Evaluation-only identity:** Anyone with access to the evaluation UI can impersonate a seeded profile. This is visible, local/trusted-LAN-only, and not acceptable for internet deployment.
- **Native SQLite package:** Engineering must confirm the selected package release installs and runs on the pinned Node 24 environment before returning READY; a compatible release exists in current upstream package metadata, but repository evidence does not exist yet.
- **Mobile hardware:** Automated narrow-viewport tests cannot prove physical-device touch feel. Physical-device evidence is requested when available and must be reported honestly when unavailable.
- **Offline boundary:** The slice protects queued intent during transient interruption after load; it does not guarantee the application can launch from a cold offline browser.
- **Product terms:** UI copy for the obligation meaning may use `As needed`; any broader critical/non-skippable term remains Product TBD.

## Engineering readiness

**Reviewed revision:** 1
**Readiness:** READY

**Review round:** Initial consolidated pass (2026-09-06). Full write-up: `reports/P0-001-r1-engineering-readiness.md`.

No material Questions or Blockers. Greenfield repository matches the brief; Active D-002–D-005 align with the proposed React/Vite/Fastify/SQLite single-process shape. `better-sqlite3@13.0.3` installed and ran under Node.js `v24.16.0` on this host. Implementation awaits Architecture’s response to readiness. Coordinator/Architecture should commit untracked/uncommitted planning artifacts to `main` before Engineering opens `brief/p0-001-shared-morning-routine`.

**Architecture disposition:** ACCEPTED

Architecture accepts P0-001 r1 against the updated Build Report. Engineering fixed Playwright bootstrap (`npm run test:e2e` installs Chromium+WebKit for the lockfile revision), hardened e2e server lifecycle, and reported **8/8** Chromium+WebKit tests with clean exit `0`. The local Architecture checkout could not independently complete the browser download because the install remained network-bound in the sandbox; this is recorded as an environment limitation, not a contradictory application result. `npm run validate` and `npm run build` pass locally.

The physical-device check remains NOT RUN because no iOS or Android device was available. This is permitted by the brief and is not a technical acceptance blocker. Technical acceptance does not constitute Project Lead/product acceptance; the supplied hands-on usability observations should now return to Planning & Design.

## Revision history

- **r1:** Initial Architecture brief for the shared Morning Routine vertical slice.
- **r1 readiness:** Engineering returned READY; Architecture accepted the readiness result. Planning-baseline integration remains a coordination prerequisite before implementation begins.
- **r1 acceptance review:** FIX REQUIRED (browser suite evidence mismatch / missing WebKit). Engineering resolved Playwright bootstrap and re-verified 8/8; awaiting Architecture re-acceptance.
- **r1 re-acceptance:** ACCEPTED. Engineering corrected reproducible browser setup and reported 8/8 Chromium + WebKit with clean exit; physical-device evidence remains not run.
