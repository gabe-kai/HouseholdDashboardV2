# Architecture Review — P0-008F r1

**Disposition:** ACCEPT / PROCEED for implementation  
**Brief:** P0-008F r1 — Keep a household intact through deployment  
**Engineering readiness:** READY  
**Integrated baseline:** `main` at `bd05ad0`  
**Planning checkout reviewed:** `refine-family-wall` at `815f20d`  
**Date:** 2026-10-26

## Review result

Architecture reviewed the brief, Engineering's consolidated readiness report, and the active-pointer/startup paths in the repository. The current-system claims match: hosted configuration does not require a persistent `INSTALLATION_CONTROL_PATH`; `InstallationControl.open` creates a missing control store; `ensureAdopt` can initialize epoch 1 against configured `DB_PATH`; startup reconciliation calls `cleanupOrphanEpochFiles`; and `resolveActiveHouseholdDbPath` falls back to `DB_PATH` when control is missing.

Engineering's readiness review also confirms the most important implementation conditions: inspect existing control state read-only before any create/migrate path; share the fail-closed guard with operator scripts; replace directory-wide epoch deletion with lifecycle-journal proof naming the specific superseded path; and test a fresh application runtime against the same persistent volume, including an epoch-selected active database. These conditions are within P0-008F r1's continuity and fail-closed contract. No new product decision or material brief revision is needed.

No BLOCKER or QUESTION remains. **P0-008F r1 is authorized to proceed.** The suggested implementation branch is `brief/p0-008f-hosted-installation-continuity`, cut from `main` at `bd05ad0`; do not implement on `refine-family-wall`.

## Acceptance boundaries

- This disposition authorizes local implementation and evidence collection only. It does not accept the eventual implementation.
- The Build Report must map AT1–AT13 independently and distinguish local process/container evidence from the Project Lead's Railway configuration checkpoint.
- AT13 remains for the Project Lead after local technical acceptance. Verify `DB_PATH=/data/household.sqlite`, `BACKUP_DIR=/data/backups`, `INSTALLATION_CONTROL_PATH=/data/installation-control.sqlite`, and the runtime mount boundary before rebuilding the household.
- Do not restore older snapshots, modify live Railway data, deploy, or rebuild the household under this brief.
- P0-009A family-wall work remains deferred and must stay off the F implementation branch.

## Evidence reviewed

- `reports/P0-008F-r1-engineering-readiness.md` — READY against `main` at `bd05ad0`.
- `briefs/P0-008F-hosted-installation-continuity.md` — r1 with assertion-level AT1–AT13.
- `src/server/config.ts` — hosted configuration requirements and control-path default.
- `src/server/installation-control.ts` — control-store creation and `ensureAdopt` behavior.
- `src/server/lifecycle-runtime.ts` — runtime startup/reconciliation, orphan cleanup, and active-database CLI resolution.

This is an Architecture readiness disposition, not implementation verification or evidence that the missing pre-redeploy household can be recovered.
