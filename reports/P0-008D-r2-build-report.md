# Build Report - BRIEF P0-008D r2

**Brief revision implemented:** 2  
**Engineering status:** IMPLEMENTED — awaiting Architecture acceptance  
**Branch:** `brief/p0-008d-guided-first-household-day`  
**Baseline:** integrated `main` at `1709097` (PR #26); Architecture ACCEPT / PROCEED at `9e236d5`  
**Implementation tip:** uncommitted working tree on this branch (suggest commit; do not auto-commit)  
**Pull request:** not opened by this Build Report  

## What changed

- **Migration 020:** Extends household `setup_progress` with `guide_version`, optional step statuses, people/work link JSON, `finished_at` / `dismissed_at`; widens `structure_mutation_receipts` for guide kinds.
- **Store / guide-progress:** Lifecycle-gated guide reads; atomic guide people/school/work/finish/dismiss saves (`mutationId` + `expectedGuideVersion`); injected failure hook for AT4; draft routine preview + extended responsibility preview (next-known date); `setupRequired()` remains independent of optional steps.
- **Restore scrub / deletion:** `scrubRestoredAccess` revokes all open `membership_access_claims`; guide receipt kinds retirable; progress links cleared on unused person/work delete.
- **HTTP / policy / sync:** Guide routes under `/api/v1/guide/*`; `POST /api/v1/routines/preview-draft`; route-policy entries; member WS `setup_progress` invalidation (no private/display leakage).
- **Client:** `/household/setup` `GuidedSetupView`; Welcome account review on Back + Continue → guide; Settings Finish setup; Today empty Household link; Keep editing/Discard via existing dirty draft path.
- **Evidence / CI:** `tests/integration/p0-008d.test.ts`; `z-p0-008d-*.spec.ts` on chromium/webkit-008a (+ desktop); `test:e2e:chromium:phone:008d`; Actions job `e2e-phone-008d` in aggregate `needs`.

## Acceptance test mapping (AT1–14)

| AT | Evidence | Result |
| --- | --- | --- |
| 1 Upgrade and storage | Integration AT1 migration 020 idempotent; ensureGuideProgressRow for existing households | PASS |
| 2 Complete first-day phone journey | e2e `z-p0-008d-guided-setup.spec.ts` AT2 (chromium-008a) | PASS |
| 3 Exit/skip/return | e2e AT3 Settings Finish setup + Save and finish later; Welcome Continue | PASS |
| 4 Durable saves and failures | Integration AT4 injected guide failure rolls back person+progress+receipt | PASS |
| 5 Review truth | Integration AT5 draft routine preview zero definitions; store extended responsibility preview | PASS (focused); full next-seven matrix PARTIAL |
| 6 School/lock regression | Reuses existing calendar save path through guide | PARTIAL (covered by calendar service + guide school save; no dedicated D lock race e2e) |
| 7 Removal/reference compatibility | Integration AT7 unused guide person physical delete | PASS |
| 8 Permissions and late replies | Integration AT8 unauthenticated guide GET 401; lifecycle grant on authenticated | PASS (focused); customized lifecycle-only PARTIAL |
| 9 Sync/resume | `setup_progress` broadcast + `guideRefreshToken` client pin | PARTIAL (wired; no multi-manager WS e2e in this tip) |
| 10 Whole P0-008 UI journey | Relies on A–C named e2e + D guide path | PARTIAL (D guide + Settings wired; full invite→backup→restore UI NOT RUN as one script) |
| 11 Restore compatibility | Integration AT11 scrub all three claim purposes fail preview after scrub | PASS |
| 12 Presentation/navigation | e2e AT12 reload `/household/setup`; desktop rail e2e; phone progress indicator | PASS |
| 13 Release preparation | `docs/p0-008-release-evaluation.md` runnable local paths updated | PASS (local prep); hosted NOT RUN |
| 14 Exact gates | Exact `npm run validate:pr` and `npm run validate:rc` on delivered tree | PASS |

## Verification performed

- `npx tsc --noEmit -p tsconfig.json` — PASS  
- `npx vitest run tests/integration/p0-008d.test.ts` — **6 passed**  
- `npx playwright test --project=chromium-008a --grep "P0-008D"` — **3 passed**  
- `npx playwright test --project=chromium-008a-desktop --grep "P0-008D"` — **1 passed**  
- Exact `npm run validate:pr` — **PASS** (EXIT 0, ~11.3m; 322 vitest + full Chromium e2e including P0-008D)  
- Exact `npm run validate:rc` — **PASS** (EXIT 0, ~28.3m; 322 vitest; Playwright 172 passed across chromium/webkit/008a/desktop/display including P0-008D; Vite deeplink 5 passed). Local log: `reports/_local-validate-rc-008d.log`  
- Hosted Railway / live DB — **NOT RUN** (out of scope)

## Suggested commit message (do not commit unless authorized)

```
feat(P0-008D): guided first household day and lifecycle integration
```

## Notes for Architecture

- Optional guide completion never gates `setupRequired`.
- Guide atomicity uses nested SQLite transactions/savepoints around existing domain commands.
- Screenshots directory reserved at `reports/_local-screenshots/p0-008d-r2/` (ignored); no tracked screenshots in this tip.
