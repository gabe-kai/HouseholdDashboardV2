# Decisions

> Record decisions that future teams should not have to rediscover.

Use IDs like `D-001`, `D-002`, and so on.

For new decisions, copy `templates/DECISION_TEMPLATE.md` into this file and assign the next ID. This file is the durable decision log; the template file is the only template source.

---

## D-001 - Default target

**Status:** Active

**Decision:** The template assumes no particular platform, interface, framework, hosting model, or delivery channel. Architecture records those choices when product intent and repository evidence justify them.

**Reason:** The workflow must support applications, services, automations, data and AI systems, libraries, command-line tools, and games without importing one project type's architecture into every project.

**Implications:** Architecture and Engineering choose the simplest technical shape that satisfies the current outcome and record material conventions for later teams.

**Related briefs:**
- None
