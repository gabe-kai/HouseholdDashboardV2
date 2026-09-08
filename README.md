# Household Dashboard v2

A phone-first shared household system for trustworthy recurring responsibilities, personal work, and progressively granted independence.

This project uses the AI Development Studio Template v0.3.0 for human-directed, AI-assisted product discovery, planning, implementation, verification, and evaluation.

## Current state

- **Milestone:** First Useful Release
- **Current focus:** P0-002 — real household identity and progressive Morning Routine authority
- **Latest usable state:** P0-001 r1 is merged and technically accepted as a local/trusted-LAN Morning Routine evaluation build; Project Lead product evaluation remains separate.

For current coordination state, see `PROJECT_STATE.md`.

## Run or use it

Use Node.js 24 from the repository root:

```text
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Open the Vite URL printed by the development command. The current P0-001 build is evaluation-only and must not be exposed to the public internet. Exact install, build, test, and production-like commands are maintained in `ARCHITECTURE.md`.

## Current work

- **Active brief:** `P0-002 r1 - Authenticated Household Authority` (`briefs/P0-002-authenticated-household-authority.md`)
- **Project board:** None

## Project documents

- `PRODUCT.md` - desired user experience and product behavior.
- `ARCHITECTURE.md` - current technical shape, commands, and conventions.
- `ROADMAP.md` - outcome-oriented sequencing and learning goals.
- `DECISIONS.md` - durable decisions future teams should not have to rediscover.
- `PROJECT_STATE.md` - short current-state index.
- `START_HERE.md` - how the studio workflow operates.
