import { afterEach, describe, expect, it } from "vitest";
import {
  IDS,
  authHeaders,
  createHttpHarness,
  httpClaimManager,
  sessionFromResponse,
} from "../helpers/auth-fixture.js";

const temps: string[] = [];

afterEach(async () => {
  /* harnesses close themselves */
});

describe("P0-003 contract hardening", () => {
  it("rejects mutating requests with missing or wrong CSRF tokens", async () => {
    const harness = await createHttpHarness();
    temps.push(harness.dbPath);
    try {
      const session = await httpClaimManager(harness);
      const missing = await harness.app.inject({
        method: "POST",
        url: "/api/v1/personal-tasks",
        headers: {
          origin: harness.origin,
          cookie: session.cookieHeader,
        },
        payload: { title: "No CSRF", visibility: "private" },
      });
      expect(missing.statusCode).toBe(403);
      expect((missing.json() as { code: string }).code).toBe("CSRF");

      const wrong = await harness.app.inject({
        method: "POST",
        url: "/api/v1/personal-tasks",
        headers: {
          origin: harness.origin,
          cookie: session.cookieHeader,
          "x-csrf-token": "not-the-session-csrf-secret",
        },
        payload: { title: "Bad CSRF", visibility: "private" },
      });
      expect(wrong.statusCode).toBe(403);
      expect((wrong.json() as { code: string }).code).toBe("CSRF");
    } finally {
      await harness.close();
    }
  });

  it("enforces personal-task visibility and owner-only status with idempotent mutationIds", async () => {
    const harness = await createHttpHarness();
    temps.push(harness.dbPath);
    try {
      const manager = await httpClaimManager(harness, `mgr.${Date.now().toString(36)}`);

      const enroll = await harness.app.inject({
        method: "POST",
        url: "/api/v1/enrollment/claims",
        headers: authHeaders(harness, manager),
        payload: {
          mutationId: crypto.randomUUID(),
          membershipId: IDS.avery,
          preset: "direct_personalizer",
        },
      });
      expect(enroll.statusCode).toBe(200);
      const claimToken = (enroll.json() as { claim: { token: string } }).claim.token;

      const childClaim = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/claim",
        headers: { origin: harness.origin },
        payload: {
          claimToken,
          loginName: `avery.${Date.now().toString(36)}`,
          passphrase: "unique-passphrase-ok!",
          displayName: "Avery Reed",
        },
      });
      expect(childClaim.statusCode).toBe(200);
      const child = sessionFromResponse(harness, childClaim);

      const privateTask = await harness.app.inject({
        method: "POST",
        url: "/api/v1/personal-tasks",
        headers: authHeaders(harness, child),
        payload: { title: "Private diary", visibility: "private" },
      });
      expect(privateTask.statusCode).toBe(200);
      const privateId = (privateTask.json() as { task: { id: string } }).task.id;

      const householdTask = await harness.app.inject({
        method: "POST",
        url: "/api/v1/personal-tasks",
        headers: authHeaders(harness, child),
        payload: { title: "Shared chore list", visibility: "household" },
      });
      expect(householdTask.statusCode).toBe(200);
      const householdId = (householdTask.json() as { task: { id: string } }).task.id;

      const managerList = await harness.app.inject({
        method: "GET",
        url: "/api/v1/personal-tasks",
        headers: { cookie: manager.cookieHeader },
      });
      expect(managerList.statusCode).toBe(200);
      const managerTasks = (managerList.json() as { tasks: Array<{ id: string }> }).tasks;
      expect(managerTasks.some((task) => task.id === privateId)).toBe(false);
      expect(managerTasks.some((task) => task.id === householdId)).toBe(true);

      const childList = await harness.app.inject({
        method: "GET",
        url: "/api/v1/personal-tasks",
        headers: { cookie: child.cookieHeader },
      });
      const childTasks = (childList.json() as { tasks: Array<{ id: string }> }).tasks;
      expect(childTasks.some((task) => task.id === privateId)).toBe(true);
      expect(childTasks.some((task) => task.id === householdId)).toBe(true);

      const foreignStatus = await harness.app.inject({
        method: "POST",
        url: `/api/v1/personal-tasks/${householdId}/status`,
        headers: authHeaders(harness, manager),
        payload: {
          mutationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          status: "completed",
        },
      });
      expect(foreignStatus.statusCode).toBe(403);

      const mutationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
      const first = await harness.app.inject({
        method: "POST",
        url: `/api/v1/personal-tasks/${privateId}/status`,
        headers: authHeaders(harness, child),
        payload: { mutationId, status: "completed" },
      });
      expect(first.statusCode).toBe(200);
      const second = await harness.app.inject({
        method: "POST",
        url: `/api/v1/personal-tasks/${privateId}/status`,
        headers: authHeaders(harness, child),
        payload: { mutationId, status: "open" },
      });
      expect(second.statusCode).toBe(200);
      expect((second.json() as { task: { status: string } }).task.status).toBe("completed");
      expect(
        (
          harness.db
            .prepare(
              "SELECT COUNT(*) as c FROM personal_task_mutations WHERE mutation_id = ?",
            )
            .get(mutationId) as { c: number }
        ).c,
      ).toBe(1);
    } finally {
      await harness.close();
    }
  });
});
