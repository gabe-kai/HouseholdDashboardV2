import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { addHouseholdDays } from "../../src/domain/time.js";
import { backfillAuthenticatedAuthority } from "../../src/server/backfill.js";
import { openDatabase } from "../../src/server/db.js";
import { SEED } from "../../src/server/seeds/evaluation.js";
import {
  IDS,
  PASSPHRASE,
  authHeaders,
  claimManager,
  createHttpHarness,
  enrollAndClaim,
  httpClaimManager,
  tempDbPath,
} from "../helpers/auth-fixture.js";

const temps: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

afterEach(async () => {
  for (const p of temps.splice(0)) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("P0-002 auth origin and hosted bootstrap", () => {
  it(
    "rejects login/claim without Origin or with a foreign Origin, and accepts the configured Origin",
    async () => {
    const harness = await createHttpHarness();
    temps.push(harness.dbPath);
    try {
      const boot = await harness.app.inject({
        method: "POST",
        url: "/api/v1/test/bootstrap-claim",
      });
      expect(boot.statusCode).toBe(200);
      const { token } = boot.json() as { token: string };

      const missing = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/claim",
        payload: {
          claimToken: token,
          loginName: "origin.missing",
          passphrase: PASSPHRASE,
          displayName: "Morgan Reed",
        },
      });
      expect(missing.statusCode).toBe(403);
      expect((missing.json() as { code: string }).code).toBe("ORIGIN");

      const foreign = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/claim",
        headers: { origin: "https://evil.example" },
        payload: {
          claimToken: token,
          loginName: "origin.foreign",
          passphrase: PASSPHRASE,
          displayName: "Morgan Reed",
        },
      });
      expect(foreign.statusCode).toBe(403);
      expect((foreign.json() as { code: string }).code).toBe("ORIGIN");

      const ok = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/claim",
        headers: { origin: harness.origin },
        payload: {
          claimToken: token,
          loginName: "origin.ok",
          passphrase: PASSPHRASE,
          displayName: "Morgan Reed",
        },
      });
      expect(ok.statusCode).toBe(200);

      const loginMissing = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { loginName: "origin.ok", passphrase: PASSPHRASE },
      });
      expect(loginMissing.statusCode).toBe(403);

      const loginForeign = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { origin: "https://evil.example" },
        payload: { loginName: "origin.ok", passphrase: PASSPHRASE },
      });
      expect(loginForeign.statusCode).toBe(403);

      const loginOk = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { origin: harness.origin },
        payload: { loginName: "origin.ok", passphrase: PASSPHRASE },
      });
      expect(loginOk.statusCode).toBe(200);
    } finally {
      await harness.close();
    }
  },
    20_000,
  );

  it("does not expose the test-only bootstrap endpoint in hosted mode", async () => {
    const dbPath = tempDbPath("hd-hosted");
    temps.push(dbPath);
    const harness = await createHttpHarness({
      APP_PROFILE: "hosted",
      AUTO_SEED: undefined,
      PUBLIC_ORIGIN: "https://family.example.invalid",
      DB_PATH: dbPath,
      BACKUP_DIR: tempDbPath("hd-hosted-bak").replace(/\.sqlite$/, ""),
      NODE_ENV: "production",
    });
    try {
      expect(harness.config.profile).toBe("hosted");
      const boot = await harness.app.inject({
        method: "POST",
        url: "/api/v1/test/bootstrap-claim",
      });
      expect(boot.statusCode).toBe(404);
    } finally {
      await harness.close();
    }
  });
});

describe("P0-002 migration logical-item identity", () => {
  it("assigns unique logical IDs for duplicate and reordered legacy steps", () => {
    const dbPath = tempDbPath("hd-logical");
    temps.push(dbPath);
    const db = openDatabase(dbPath);
    const sql001 = fs.readFileSync(path.join(repoRoot, "db/migrations/001_initial.sql"), "utf8");
    const sql002 = fs.readFileSync(
      path.join(repoRoot, "db/migrations/002_authenticated_authority.sql"),
      "utf8",
    );
    db.exec(sql001);
    db.exec(sql002);
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
      "001_initial.sql",
      new Date().toISOString(),
    );
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
      "002_authenticated_authority.sql",
      new Date().toISOString(),
    );
    db.prepare("INSERT INTO households (id, name, timezone) VALUES (?, ?, ?)").run(
      SEED.household.id,
      SEED.household.name,
      "America/New_York",
    );
    const defId = randomUUID();
    const rev1 = randomUUID();
    const rev2 = randomUUID();
    db.prepare("INSERT INTO routine_definitions (id, household_id, kind) VALUES (?, ?, 'morning')").run(
      defId,
      SEED.household.id,
    );
    db.prepare(
      `INSERT INTO routine_revisions (id, definition_id, effective_date, title, weekdays_json, created_at)
       VALUES (?, ?, '2026-09-01', 'Morning', ?, ?)`,
    ).run(rev1, defId, JSON.stringify([1, 2, 3, 4, 5, 6, 7]), new Date().toISOString());
    db.prepare(
      `INSERT INTO routine_revisions (id, definition_id, effective_date, title, weekdays_json, created_at)
       VALUES (?, ?, '2026-09-02', 'Morning', ?, ?)`,
    ).run(rev2, defId, JSON.stringify([1, 2, 3, 4, 5, 6, 7]), new Date().toISOString());

    const insertStep = db.prepare(
      `INSERT INTO revision_steps (id, revision_id, position, text, obligation)
       VALUES (?, ?, ?, ?, ?)`,
    );

    // rev1: duplicate "Make bed" rows
    const r1a = randomUUID();
    const r1b = randomUUID();
    const r1c = randomUUID();
    insertStep.run(r1a, rev1, 0, "Make bed", "required");
    insertStep.run(r1b, rev1, 1, "Make bed", "required");
    insertStep.run(r1c, rev1, 2, "Stretch", "optional");

    // rev2: reordered + same duplicate pair should continue one-to-one
    const r2a = randomUUID();
    const r2b = randomUUID();
    const r2c = randomUUID();
    insertStep.run(r2a, rev2, 0, "Stretch", "optional");
    insertStep.run(r2b, rev2, 1, "Make bed", "required");
    insertStep.run(r2c, rev2, 2, "Make bed", "required");

    backfillAuthenticatedAuthority(db);

    const ids1 = db
      .prepare(
        "SELECT id, position, logical_item_id FROM revision_steps WHERE revision_id = ? ORDER BY position",
      )
      .all(rev1) as Array<{ id: string; logical_item_id: string }>;
    const ids2 = db
      .prepare(
        "SELECT id, position, text, logical_item_id FROM revision_steps WHERE revision_id = ? ORDER BY position",
      )
      .all(rev2) as Array<{ id: string; text: string; logical_item_id: string }>;

    expect(ids1.every((row) => !!row.logical_item_id)).toBe(true);
    expect(new Set(ids1.map((row) => row.logical_item_id)).size).toBe(3);

    const bedIds = ids1
      .filter((_, index) => index < 2)
      .map((row) => row.logical_item_id);
    expect(bedIds[0]).not.toBe(bedIds[1]);

    const stretchId = ids1[2]!.logical_item_id;
    expect(ids2[0]!.logical_item_id).toBe(stretchId);
    expect(ids2[1]!.logical_item_id).toBe(bedIds[0]);
    expect(ids2[2]!.logical_item_id).toBe(bedIds[1]);
    expect(new Set(ids2.map((row) => row.logical_item_id)).size).toBe(3);
    db.close();
  });
});

describe("P0-002 HTTP isolation, grants, and composition", () => {
  it("isolates HTTP reads/writes and WebSocket events across households", async () => {
    const harness = await createHttpHarness();
    temps.push(harness.dbPath);
    try {
      const manager = await httpClaimManager(harness, "iso.manager");
      const foreignHousehold = "99999999-9999-4999-8999-999999999999";
      const foreignMembership = "99999999-9999-4999-8999-999999999991";
      const foreignRoutine = "99999999-9999-4999-8999-999999999992";
      const foreignOcc = "99999999-9999-4999-8999-999999999993";
      const foreignStep = "99999999-9999-4999-8999-999999999994";
      const foreignTask = "99999999-9999-4999-8999-999999999995";
      const foreignProposal = "99999999-9999-4999-8999-999999999996";

      harness.db
        .prepare("INSERT INTO households (id, name, timezone) VALUES (?, ?, ?)")
        .run(foreignHousehold, "Other", "UTC");
      harness.db
        .prepare(
          `INSERT INTO household_memberships
             (id, household_id, user_id, display_name, status, created_at)
           VALUES (?, ?, NULL, 'Foreign', 'pending', ?)`,
        )
        .run(foreignMembership, foreignHousehold, new Date().toISOString());
      harness.db
        .prepare("INSERT INTO routine_definitions (id, household_id, kind) VALUES (?, ?, 'morning')")
        .run(foreignRoutine, foreignHousehold);

      const headers = authHeaders(harness, manager);
      const rev = await harness.app.inject({
        method: "POST",
        url: `/api/v1/routines/${foreignRoutine}/revisions`,
        headers,
        payload: {
          title: "Hijack",
          weekdays: [1],
          assigneeMemberIds: [manager.membershipId],
          steps: [{ text: "Nope", obligation: "required" }],
        },
      });
      expect([403, 404]).toContain(rev.statusCode);

      const step = await harness.app.inject({
        method: "POST",
        url: `/api/v1/occurrences/${foreignOcc}/steps/${foreignStep}/status`,
        headers,
        payload: {
          mutationId: randomUUID(),
          status: "completed",
          performedAt: "2026-09-08T12:00:00.000Z",
        },
      });
      expect([403, 404]).toContain(step.statusCode);

      const task = await harness.app.inject({
        method: "POST",
        url: `/api/v1/personal-tasks/${foreignTask}/status`,
        headers,
        payload: { mutationId: randomUUID(), status: "completed" },
      });
      expect([403, 404]).toContain(task.statusCode);

      const decide = await harness.app.inject({
        method: "POST",
        url: `/api/v1/proposals/${foreignProposal}/decide`,
        headers,
        payload: { decision: "approved" },
      });
      expect([403, 404]).toContain(decide.statusCode);

      const memberships = await harness.app.inject({
        method: "GET",
        url: "/api/v1/memberships",
        headers: { cookie: manager.cookieHeader },
      });
      const listed = (memberships.json() as { memberships: Array<{ id: string }> }).memberships;
      expect(listed.some((m) => m.id === foreignMembership)).toBe(false);

      await harness.app.listen({ host: "127.0.0.1", port: 0 });
      const address = harness.app.server.address();
      if (!address || typeof address === "string") throw new Error("no address");
      const cookieName = harness.config.cookieName;
      const cookieValue = manager.cookieHeader.split("=")[1]!;

      const localMessages: string[] = [];
      const foreignMessages: string[] = [];
      const localWs = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/sync`, {
        headers: {
          Origin: harness.origin,
          Cookie: `${cookieName}=${cookieValue}`,
        },
      });
      await new Promise<void>((resolve, reject) => {
        localWs.once("open", () => resolve());
        localWs.once("error", reject);
      });
      localWs.on("message", (data) => localMessages.push(String(data)));

      // Foreign household has no session cookie that matches; closing with origin alone is unauthorized.
      const foreignWs = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/sync`, {
        headers: {
          Origin: harness.origin,
          Cookie: `${cookieName}=deadbeef`,
        },
      });
      const foreignClosed = await new Promise<number>((resolve) => {
        foreignWs.on("close", (code) => resolve(code));
        foreignWs.on("error", () => resolve(4401));
      });
      expect(foreignClosed).toBe(4401);

      const create = await harness.app.inject({
        method: "POST",
        url: "/api/v1/routines",
        headers,
        payload: {
          title: "Morning Routine",
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          assigneeMemberIds: [IDS.morgan, IDS.avery],
          steps: [{ text: "Make bed", obligation: "required" }],
        },
      });
      expect(create.statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 100));
      expect(
        localMessages.some((m) => {
          const parsed = JSON.parse(m) as { householdId: string; resource: string };
          return parsed.resource === "routine" && parsed.householdId !== foreignHousehold;
        }),
      ).toBe(true);
      expect(foreignMessages).toHaveLength(0);
      localWs.close();
    } finally {
      await harness.close();
    }
  });

  it("enforces an exhaustive capability matrix over HTTP", async () => {
    const harness = await createHttpHarness();
    temps.push(harness.dbPath);
    try {
      const manager = await httpClaimManager(harness, "cap.manager");
      const mgrHeaders = authHeaders(harness, manager);

      const enrollAvery = await harness.app.inject({
        method: "POST",
        url: "/api/v1/enrollment/claims",
        headers: mgrHeaders,
        payload: { membershipId: IDS.avery, preset: "direct_personalizer" },
      });
      expect(enrollAvery.statusCode).toBe(200);
      const averyToken = (enrollAvery.json() as { claim: { token: string } }).claim.token;
      const averyClaim = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/claim",
        headers: { origin: harness.origin },
        payload: {
          claimToken: averyToken,
          loginName: "cap.avery",
          passphrase: PASSPHRASE,
          displayName: "Avery Reed",
        },
      });
      const avery = {
        cookieHeader: `${harness.config.cookieName}=${averyClaim.cookies.find((c) => c.name === harness.config.cookieName)!.value}`,
        csrfToken: (averyClaim.json() as { csrfToken: string }).csrfToken,
        membershipId: IDS.avery,
      };

      const enrollCasey = await harness.app.inject({
        method: "POST",
        url: "/api/v1/enrollment/claims",
        headers: mgrHeaders,
        payload: { membershipId: IDS.casey, preset: "proposal_personalizer" },
      });
      const caseyToken = (enrollCasey.json() as { claim: { token: string } }).claim.token;
      const caseyClaim = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/claim",
        headers: { origin: harness.origin },
        payload: {
          claimToken: caseyToken,
          loginName: "cap.casey",
          passphrase: PASSPHRASE,
          displayName: "Casey Reed",
        },
      });
      const casey = {
        cookieHeader: `${harness.config.cookieName}=${caseyClaim.cookies.find((c) => c.name === harness.config.cookieName)!.value}`,
        csrfToken: (caseyClaim.json() as { csrfToken: string }).csrfToken,
        membershipId: IDS.casey,
      };

      const routine = await harness.app.inject({
        method: "POST",
        url: "/api/v1/routines",
        headers: mgrHeaders,
        payload: {
          title: "Morning Routine",
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          assigneeMemberIds: [IDS.avery, IDS.casey, IDS.morgan],
          steps: [
            { text: "Make bed", obligation: "required" },
            { text: "Stretch", obligation: "optional" },
          ],
        },
      });
      expect(routine.statusCode).toBe(200);
      const routineId = (routine.json() as { routine: { id: string } }).routine.id;

      // Allowed: manager enroll / shared manage / decide; Avery direct; Casey propose; tasks create
      expect(
        (
          await harness.app.inject({
            method: "POST",
            url: "/api/v1/enrollment/claims",
            headers: mgrHeaders,
            payload: { membershipId: IDS.jordan, preset: "direct_personalizer" },
          })
        ).statusCode,
      ).toBe(200);

      expect(
        (
          await harness.app.inject({
            method: "PUT",
            url: "/api/v1/personal-layer",
            headers: authHeaders(harness, avery),
            payload: {
              additions: [
                {
                  text: "Clean up breakfast",
                  obligation: "optional",
                  place: "end",
                },
              ],
            },
          })
        ).statusCode,
      ).toBe(200);

      const proposal = await harness.app.inject({
        method: "POST",
        url: "/api/v1/proposals",
        headers: authHeaders(harness, casey),
        payload: { text: "Pack soccer bag", obligation: "as_needed", place: "end" },
      });
      expect(proposal.statusCode).toBe(200);
      const proposalId = (proposal.json() as { proposal: { id: string } }).proposal.id;

      expect(
        (
          await harness.app.inject({
            method: "POST",
            url: `/api/v1/proposals/${proposalId}/decide`,
            headers: mgrHeaders,
            payload: { decision: "approved" },
          })
        ).statusCode,
      ).toBe(200);

      expect(
        (
          await harness.app.inject({
            method: "POST",
            url: "/api/v1/personal-tasks",
            headers: authHeaders(harness, casey),
            payload: { title: "Homework", visibility: "private" },
          })
        ).statusCode,
      ).toBe(200);

      // Denied for proposal personalizer
      expect(
        (
          await harness.app.inject({
            method: "POST",
            url: `/api/v1/routines/${routineId}/revisions`,
            headers: authHeaders(harness, casey),
            payload: {
              title: "Nope",
              weekdays: [1],
              assigneeMemberIds: [IDS.casey],
              steps: [{ text: "X", obligation: "required" }],
            },
          })
        ).statusCode,
      ).toBe(403);

      expect(
        (
          await harness.app.inject({
            method: "PUT",
            url: "/api/v1/personal-layer",
            headers: authHeaders(harness, casey),
            payload: {
              additions: [{ text: "Direct", obligation: "optional", place: "end" }],
            },
          })
        ).statusCode,
      ).toBe(403);

      expect(
        (
          await harness.app.inject({
            method: "POST",
            url: "/api/v1/enrollment/claims",
            headers: authHeaders(harness, casey),
            payload: { membershipId: IDS.taylor, preset: "direct_personalizer" },
          })
        ).statusCode,
      ).toBe(403);

      expect(
        (
          await harness.app.inject({
            method: "POST",
            url: "/api/v1/proposals",
            headers: authHeaders(harness, avery),
            payload: { text: "Should fail", obligation: "optional", place: "end" },
          })
        ).statusCode,
      ).toBe(403);

      // Avery cannot execute Casey's occurrence
      const today = await harness.app.inject({
        method: "GET",
        url: "/api/v1/today",
        headers: authHeaders(harness, manager),
      });
      const caseyOcc = (
        today.json() as { occurrences: Array<{ id: string; accountableMemberId: string; steps: Array<{ id: string }> }> }
      ).occurrences.find((o) => o.accountableMemberId === IDS.casey)!;
      expect(
        (
          await harness.app.inject({
            method: "POST",
            url: `/api/v1/occurrences/${caseyOcc.id}/steps/${caseyOcc.steps[0]!.id}/status`,
            headers: authHeaders(harness, avery),
            payload: {
              mutationId: randomUUID(),
              status: "completed",
              performedAt: "2026-09-08T12:00:00.000Z",
            },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await harness.close();
    }
  });

  it("keeps personalization across a later shared-base revision and exposes preview", async () => {
    const harness = await createHttpHarness();
    temps.push(harness.dbPath);
    try {
      const managerAuth = await claimManager(harness.store, "compose.mgr");
      const avery = await enrollAndClaim(
        harness.store,
        managerAuth.context,
        IDS.avery,
        "direct_personalizer",
        "compose.avery",
        "Avery Reed",
      );
      harness.store.createRoutine(managerAuth.context, {
        title: "Morning Routine",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assigneeMemberIds: [IDS.avery],
        steps: [
          { text: "Make bed", obligation: "required" },
          { text: "Stretch", obligation: "optional" },
        ],
      });
      const today = harness.store.householdDateNow(managerAuth.context);
      const occ = harness.store.materializeForDate(avery.context, today)[0]!;
      harness.store.savePersonalLayer(avery.context, {
        additions: [
          {
            text: "Clean up breakfast",
            obligation: "optional",
            anchorLogicalItemId: occ.steps[0]!.logicalItemId,
            place: "after",
          },
        ],
      });
      const routine = harness.store.getRoutine(managerAuth.context.householdId)!;
      const sharedIds = routine.revisions[0]!.steps.map((s) => s.logicalItemId);
      harness.store.createRevision(managerAuth.context, routine.id, {
        title: "Morning Routine+",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assigneeMemberIds: [IDS.avery],
        steps: [
          { text: "Make bed", obligation: "required", logicalItemId: sharedIds[0] },
          { text: "Brush teeth", obligation: "required" },
          { text: "Stretch", obligation: "optional", logicalItemId: sharedIds[1] },
        ],
      });
      const tomorrow = addHouseholdDays(today, 1);
      // Personal layer is next-day effective; shared revision also next-day — compose both.
      const preview = harness.store.previewComposition(avery.context, IDS.avery, tomorrow);
      expect(preview.steps.map((s) => s.text)).toEqual([
        "Make bed",
        "Clean up breakfast",
        "Brush teeth",
        "Stretch",
      ]);
      expect(preview.steps.filter((s) => s.source === "personal")).toHaveLength(1);

      // Child cannot create shared revision (required shared structure stays manager-only)
      expect(() =>
        harness.store.createRevision(avery.context, routine.id, {
          title: "Hijack",
          weekdays: [1],
          assigneeMemberIds: [IDS.avery],
          steps: [{ text: "Only me", obligation: "required" }],
        }),
      ).toThrow(/authority/i);
    } finally {
      await harness.close();
    }
  });
});
