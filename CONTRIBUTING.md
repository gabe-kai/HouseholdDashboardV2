# Contributing to This Project

This file is the shared repository-work policy for human contributors, web-based AI teams, and local coding agents.

`STUDIO.md` defines who owns product and technical decisions. This file defines how approved repository work should be changed, recorded, reviewed, and integrated.

Project-specific rules may override these defaults when they are recorded explicitly in `ARCHITECTURE.md` or `DECISIONS.md`.

## 1. Keep the repository understandable

Contributions should make the project easier, not merely more sophisticated.

Prefer:
- small coherent changes;
- existing project patterns;
- readable names and straightforward control flow;
- the smallest dependency surface that solves the real problem;
- comments that explain why, not comments that restate obvious code;
- preserving unrelated working behavior.

Avoid:
- unrelated refactors bundled into feature work;
- speculative infrastructure;
- replacing working systems merely because rebuilding them is easier for the current contributor;
- hidden product changes;
- generated or vendored bulk that does not belong in source control.

## 2. Git is the default version-control system

Use Git once source-code work begins unless the project explicitly opts out.

If the folder is not yet a Git repository, do not silently initialize it or connect a remote unless setup work explicitly authorizes that action.

`main` is the default integration branch and should represent the best known integrated/working state of the project.

Never force-push or rewrite shared `main` history simply to make it prettier.

### New repository activation

When Git initialization is explicitly authorized for a new project, establish `main` before any implementation branch exists.

Preferred sequence from the project root:

```text
git init -b main
git status
git add .
git commit -m "chore: initialize project"
```

If the installed Git version does not support `git init -b main`, use:

```text
git init
git branch -M main
git add .
git commit -m "chore: initialize project"
```

The important invariant is:

**The first baseline commit of a newly initialized project belongs to `main`. Brief/feature branches branch from that baseline; they do not become the accidental root/default branch of the repository.**

Do not create `brief/...`, `spike/...`, or other work branches before the baseline `main` commit exists.

The baseline should contain the project's initial durable state: template files plus the project identity/design/planning material already established during activation. It does not need to contain a finished design.

### Optional remote publishing

A remote is optional and must be created or connected intentionally.

After the local `main` baseline exists and is correct, a GitHub repository may be published with GitHub CLI when available and explicitly authorized:

```text
gh repo create PROJECT-NAME --private --source=. --remote=origin --push
```

Use `--public` only when public source is deliberate.

Alternatively, when a remote repository already exists:

```text
git remote add origin REMOTE-URL
git push -u origin main
```

Before publishing, verify the current branch and repository state. After publishing, verify the remote/default branch rather than assuming the hosting service inferred the intended branch correctly.

Do not create a remote, publish source, change repository visibility, or change a hosted default branch without explicit authorization.

## 3. Branches

Normal brief-driven implementation should happen on a short-lived branch rather than directly on `main`.

### Naming

Planned implementation brief:

```text
brief/p1-002-import-validation
```

Other allowed patterns:

```text
spike/controller-input
docs/update-setup-guide
chore/dependency-refresh
fix/reload-after-death
```

Use lowercase slugs. When work has a brief ID, include it in the branch name.

### Branch policy

- Branch from the current integrated `main` unless the project explicitly records another base.
- One implementation brief per branch by default.
- A new revision of the same brief normally stays on the same branch.
- Do not mix unrelated cleanup or another feature into the branch.
- Keep branches short-lived.
- Experimental `spike/` work is disposable until Architecture deliberately adopts its lessons.
- Delete merged branches when practical.
- Do not stash, reset, discard, or absorb another contributor's uncommitted work merely to create a clean branch.

For extremely small local projects, the Coordinator may explicitly choose direct-to-`main` work. That is an exception to the default, not something an agent should assume.

## 4. Commits

A commit is a meaningful project save point.

### Brief-aware messages

For brief work, prefer:

```text
P1-002: add validated record import
P1-002: cover invalid-record handling
P1-002: fix coyote timer reset
```

For non-brief work, concise prefixes are fine:

```text
docs: clarify controller assumptions
chore: update development dependency
fix: restore level reload after death
```

Full Conventional Commits are not required unless a project adopts them explicitly.

### Commit policy

- Commit coherent checkpoints rather than one giant undifferentiated change when natural checkpoints exist.
- Keep unrelated changes out of the commit.
- Do not commit secrets, credentials, local environment values, dependency caches, editor state, test output, logs, or generated build folders unless the project deliberately tracks them.
- Package-manager lockfiles are source-controlled when the project uses them.
- A commit should leave the repository in a reasonable state where practical.
- Do not rewrite commits that another collaborator may already depend on without a clear reason.

## 5. Pull requests and integration

Pull requests are recommended when the repository has a remote review workflow, when multiple contributors/agents are working concurrently, or when preserving review history is useful.

For a tiny local family project with no remote, the Coordinator may integrate an accepted branch locally instead.

### Default PR mapping

One accepted implementation brief normally maps to one pull request.

Suggested title:

```text
P1-002: Validated Record Import
```

Suggested description:

```text
Brief: P1-002 r2

What changed:
- ...

Verification:
- ...

Known issues:
- ...

Architecture acceptance:
- Pending
```

Opening a PR means Engineering believes the implementation is ready for review/integration. It does **not** mean Architecture has accepted the brief.

### Merge policy

Default order:

1. Engineering completes the reviewed brief revision and Build Report.
2. Required verification passes; QA is added when warranted.
3. Architecture returns `ACCEPTED` for that exact brief revision.
4. The Coordinator or authorized contributor integrates the branch/PR into `main`.
5. If the result is user-visible, it may still require Project Lead/evaluation acceptance before the project treats it as permanently **Accepted**.

Do not merge ordinary brief work into `main` while Architecture has returned `FIX REQUIRED`, unless the Coordinator explicitly records an exception.

The project may choose merge, squash, or rebase strategy. Do not rewrite shared history solely to satisfy style preferences.

## 6. Verification before declaring work complete

Run the checks the project actually defines in `ARCHITECTURE.md`.

When available, this normally includes some combination of:
- build;
- automated tests;
- lint/typecheck;
- starting the product;
- focused manual product use verification.

Be precise in reports:
- "build passed" is not the same as "behavior was manually verified";
- "tests passed" is not the same as "the outcome is valuable";
- "works in one environment" is not the same as supported-environment compatibility.

## 7. Dependencies

Before adding a dependency:

1. check whether the repository already solves the problem;
2. check whether the platform/runtime provides a simple built-in solution;
3. confirm the dependency materially improves clarity, capability, or maintainability;
4. record important runtime/deployment consequences.

Do not add paid services, external accounts, or API-key-dependent runtime services without explicit approval.

## 8. Secrets and local configuration

Never commit real secrets.

- Keep real `.env` values local.
- Use `.env.example` or equivalent for documented placeholders when environment configuration is necessary.
- Client-delivered code cannot safely contain private secrets.
- If a proposed feature requires a secret in client JavaScript, Architecture should reconsider the design.

## 9. Assets

Only add assets the project has a right to use.

Prefer original, procedurally generated, public-domain, or permissively licensed material. Record attribution requirements in a durable project location when needed.

Do not make a temporary hotlink or an asset of uncertain provenance the permanent shipping dependency.

## 10. Non-local and read-only contributors

A web-based AI team may be able to reason about the project without having shell, Git, or repository write access.

Such a contributor must not pretend it created branches, commits, pull requests, or file edits it could not actually perform.

Instead:
- provide the exact recommendation or review;
- identify the expected branch/brief/revision when relevant;
- provide a `FILE UPDATES` section for durable file changes;
- let a write-capable Coordinator or local agent perform mechanical Git/file operations.

Decision authority remains with the owning studio team; write access does not create authority.

## 11. Local coding agents

Local agents with filesystem, shell, and Git access must also follow `AGENTS.md`.

`AGENTS.md` adds execution-safety rules; it does not replace this shared contribution policy.
