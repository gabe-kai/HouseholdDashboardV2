# Local Agent Entry Point - AI Development Studio Template v0.3.0

This repository uses the AI Development Studio Template workflow.

This file contains **additional rules for local/write-capable agents** that can inspect files, run commands, edit the repository, or use Git. Shared collaboration policy lives in `CONTRIBUTING.md`.

Do not automatically blend Product, Architecture, Engineering, QA, and User Feedback responsibilities. State which team you are acting as for the current task and follow that team's authority.

## Common first read

Read:
1. `STUDIO.md`
2. `PROJECT_STATE.md`
3. your role file in `teams/`

If you will modify or integrate repository content, also read `CONTRIBUTING.md`.

Then load only the additional context your role needs.

## Engineering context

If you are Engineering, also read:
- `CONTRIBUTING.md`;
- `ARCHITECTURE.md`;
- relevant entries in `DECISIONS.md`;
- the exact assigned brief and revision in `briefs/`;
- any Build Report or Engineering review directly related to that revision.

Inspect the actual repository before declaring readiness.

The repository is authoritative about current implementation state. The assigned brief revision is authoritative about the requested change. When they conflict, report the conflict instead of silently choosing one.

Before coding, perform the implementation-readiness review defined in `teams/ENGINEERING_TEAM.md`.

Readiness review is not an adversarial search for reasons to stop. READY is the default unless a concrete material issue prevents responsible implementation. Investigate facts you can inspect, make ordinary local implementation choices yourself, and return any material concerns in one consolidated pass. After Architecture responds, normally proceed; unresolved material disputes use ESCALATE rather than repeated QUESTION/BLOCKER ping-pong.

## Repository safety

Before making changes:
- inspect repository status and relevant files;
- identify existing uncommitted changes;
- treat uncommitted human or collaborator work as potentially valuable;
- do not discard, reset, overwrite, or silently absorb unrelated changes;
- do not use destructive Git operations merely to make the workspace easier to reason about.

Never run commands such as hard resets, destructive cleans, broad restores, or history rewrites unless the task explicitly requires them and their impact is understood.

If unrelated dirty work prevents safe isolation of the assigned task, report the conflict instead of erasing or stashing it without permission.

## Scope discipline

When implementing a brief:
- implement only the reviewed brief revision;
- stay within its implementation and do-not-change boundaries;
- do not opportunistically redesign unrelated systems;
- do not turn cleanup preferences into hidden scope;
- small local cleanup directly necessary for safe implementation is acceptable when it does not materially expand the contract;
- material scope expansion must return to Architecture.

Do not make a product decision just because a technical option is easier.

## Git behavior

Follow `CONTRIBUTING.md`.

Additional local-agent rules:
- inspect `git status` before branch/commit operations;
- never include unrelated working-tree changes in your commit;
- do not create a remote, publish a branch, open a PR, merge, or force-push unless the assignment/project workflow authorizes that action;
- if initializing Git for a new project is authorized, establish `main` and make the baseline commit there before creating any brief/feature branch;
- if branch creation is authorized, use the brief-aware naming policy in `CONTRIBUTING.md`;
- if commits are authorized, use coherent commits and brief-aware messages;
- report the branch, commits, and PR (if any) in the Build Report;
- Architecture acceptance is not the same as merge authorization unless the project says so;
- Architecture acceptance is also not the same as Project Lead/user acceptance of the experience.

When Git operations are not authorized, make the requested code changes safely and report what the Coordinator should do next rather than pretending the Git step occurred.

## Dependencies and environment

- Prefer existing dependencies and project-local tool versions.
- Do not assume a global tool when the repository defines a local/package-managed version.
- Avoid adding packages for trivial functionality.
- Explain new runtime dependencies and any deployment consequence.
- Do not introduce paid/external services, accounts, or secret-bearing APIs without explicit approval.
- Never place secrets in shipped client code, source control, logs, reports, or generated artifacts.

If you discover the correct install/run/build/test/lint commands, update `ARCHITECTURE.md` when your role permits or provide exact `FILE UPDATES` for Architecture/Coordinator.

## Validation before reporting success

Use the project's known commands from `ARCHITECTURE.md` when available.

Before claiming implementation is complete, run the relevant feasible checks, such as:
- build;
- automated tests;
- lint/typecheck;
- starting the product;
- focused manual behavior checks.

Do not blur different kinds of evidence. Report exactly what was and was not verified.

If a command cannot be run in the current environment, say so. Do not represent an unperformed check as passing.

## File hygiene

- Do not commit caches, dependency folders, logs, local secrets, or generated output that the project does not intentionally track.
- Respect `.gitignore` and existing repository conventions.
- Preserve line endings and text-file hygiene described by `.editorconfig` when possible.
- Do not replace source assets or code wholesale when a targeted change is safer and clearer.

## Durable writeback

If you can edit files, update artifacts owned by your team when required. If you cannot, return a `FILE UPDATES` section with exact changes for the Coordinator or another write-capable agent to apply.

## If your role is unclear

Do not guess at all roles. State the role you believe the task requires. If the task contains a product decision that Engineering or Architecture does not own, route that decision to Product / the Project Lead.
