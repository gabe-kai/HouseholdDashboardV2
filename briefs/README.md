# Briefs

Architecture places implementation briefs here.

Suggested naming keeps the stable brief ID in the filename:

- `P0-001-first-runnable.md`
- `P0-002-user-input.md`
- `P1-001-import-validation.md`

Do not create a new filename for every revision. Keep the stable brief ID and increment the `Revision` field plus revision history inside the brief.

Do not create contract addenda, clarification sidecars, or chat-only supplements. There is one current authoritative brief file per stable ID.

Briefs should normally reach first implementation by r1 or r2. r3 before first implementation triggers Coordinator review; r4+ before first implementation requires an explicit Coordinator exception and recorded reason.

`ROADMAP.md` may contain several future outcomes, but normally only the CURRENT evidence-producing slice should receive a fully detailed brief. Do not pre-create detailed briefs for speculative later work whose contract may change after the current evaluation/build evidence.

Copy `../templates/BRIEF_TEMPLATE.md` to start a new brief.

A readiness result and Build Report must name the exact brief revision they apply to.

For Git-managed implementation, the brief normally maps to a short-lived branch such as `brief/p1-001-import-validation`; see `../CONTRIBUTING.md`.
