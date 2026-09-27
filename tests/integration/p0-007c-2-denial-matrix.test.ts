import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  ROUTE_POLICY_INVENTORY,
  type RoutePolicyEntry,
} from "../../src/server/route-policy.js";
import {
  claimManager,
  createHttpHarness,
  type HttpHarness,
} from "../helpers/auth-fixture.js";

const harnesses: HttpHarness[] = [];
const SAMPLE_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    await h.close();
  }
});

function resolvePath(template: string): string {
  return template.replace(/:[A-Za-z][A-Za-z0-9]*/g, SAMPLE_UUID);
}

function defaultPayload(entry: RoutePolicyEntry): unknown {
  if (entry.method === "GET") return undefined;
  return {
    mutationId: randomUUID(),
    title: "Denied personal task",
    visibility: "private",
    status: "done",
    label: "Denied",
    code: "AAAAAAAAAAAAAAA",
    expectedConfigVersion: 1,
    expectedGeneration: 1,
    acknowledgedScope: "routines_and_responsibilities",
  };
}

async function enrollDisplay(
  harness: HttpHarness,
): Promise<{
  managerToken: string;
  managerCsrf: string;
  displayCookie: string;
  displayId: string;
  membershipId: string;
}> {
  const manager = await claimManager(harness.store);
  const origin = harness.origin;
  const createRes = await harness.app.inject({
    method: "POST",
    url: "/api/v1/displays",
    headers: {
      cookie: `${harness.config.cookieName}=${manager.token}`,
      origin,
      "x-csrf-token": manager.csrfSecret,
      "content-type": "application/json",
    },
    payload: { mutationId: randomUUID(), label: "Denial wall" },
  });
  expect(createRes.statusCode).toBe(200);
  const created = createRes.json() as {
    enrollment: { code: string };
    display: { id: string };
  };
  const claimRes = await harness.app.inject({
    method: "POST",
    url: "/api/v1/display/claim",
    headers: { origin, "content-type": "application/json" },
    payload: { code: created.enrollment.code },
  });
  expect(claimRes.statusCode).toBe(200);
  const displayCookie = claimRes.cookies.find(
    (c) => c.name === harness.config.displayCookieName,
  );
  expect(displayCookie?.value).toBeTruthy();
  return {
    managerToken: manager.token,
    managerCsrf: manager.csrfSecret,
    displayCookie: displayCookie!.value,
    displayId: created.display.id,
    membershipId: manager.context.membershipId,
  };
}

describe("P0-007C-2 AT4 principal denial matrix", () => {
  it("denies every member route with only a display cookie before side effects", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await enrollDisplay(harness);
    const displayOnly = `${harness.config.displayCookieName}=${enrolled.displayCookie}`;

    const tasksBefore = (
      harness.db.prepare("SELECT COUNT(*) AS c FROM personal_tasks").get() as {
        c: number;
      }
    ).c;
    const occStepsBefore = (
      harness.db
        .prepare(
          `SELECT COUNT(*) AS c FROM occurrence_steps WHERE status != 'pending'`,
        )
        .get() as { c: number }
    ).c;

    const memberRoutes = ROUTE_POLICY_INVENTORY.filter(
      (entry) => entry.principal === "member" && entry.origin !== "websocket",
    );
    expect(memberRoutes.length).toBeGreaterThan(40);

    for (const entry of memberRoutes) {
      const url = resolvePath(entry.path);
      const response = await harness.app.inject({
        method: entry.method,
        url,
        headers: {
          cookie: displayOnly,
          origin: harness.origin,
          "content-type": "application/json",
          "x-csrf-token": "not-a-member-csrf",
        },
        payload: defaultPayload(entry),
      });
      expect(
        [401, 403].includes(response.statusCode),
        `${entry.method} ${entry.path} → ${response.statusCode}`,
      ).toBe(true);
    }

    // Explicit mutation proofs: no personal task / step status side effects.
    const createTask = await harness.app.inject({
      method: "POST",
      url: "/api/v1/personal-tasks",
      headers: {
        cookie: displayOnly,
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": "x",
      },
      payload: {
        title: "SHOULD_NOT_EXIST_DISPLAY_DENIAL",
        visibility: "private",
      },
    });
    expect([401, 403]).toContain(createTask.statusCode);

    const stepStatus = await harness.app.inject({
      method: "POST",
      url: `/api/v1/occurrences/${SAMPLE_UUID}/steps/${SAMPLE_UUID}/status`,
      headers: {
        cookie: displayOnly,
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": "x",
      },
      payload: {
        mutationId: randomUUID(),
        status: "done",
        performedAt: new Date().toISOString(),
      },
    });
    expect([401, 403]).toContain(stepStatus.statusCode);

    const tasksAfter = (
      harness.db.prepare("SELECT COUNT(*) AS c FROM personal_tasks").get() as {
        c: number;
      }
    ).c;
    const occStepsAfter = (
      harness.db
        .prepare(
          `SELECT COUNT(*) AS c FROM occurrence_steps WHERE status != 'pending'`,
        )
        .get() as { c: number }
    ).c;
    expect(tasksAfter).toBe(tasksBefore);
    expect(occStepsAfter).toBe(occStepsBefore);
    expect(
      (
        harness.db
          .prepare(`SELECT 1 AS ok FROM personal_tasks WHERE title = ?`)
          .get("SHOULD_NOT_EXIST_DISPLAY_DENIAL") as { ok: number } | undefined
      )?.ok,
    ).toBeUndefined();
  });

  it("denies every display HTTP route with only a member cookie", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await enrollDisplay(harness);
    const memberOnly = `${harness.config.cookieName}=${enrolled.managerToken}`;

    const displayHttp = ROUTE_POLICY_INVENTORY.filter(
      (entry) =>
        entry.principal === "display" && entry.origin !== "websocket",
    );
    expect(displayHttp.length).toBe(4);

    for (const entry of displayHttp) {
      const url = resolvePath(entry.path);
      const response = await harness.app.inject({
        method: entry.method,
        url,
        headers: { cookie: memberOnly },
      });
      expect(
        response.statusCode,
        `${entry.method} ${entry.path}`,
      ).toBe(401);
    }
  });

  it("rejects display WS with member cookie and accepts with display cookie", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await enrollDisplay(harness);

    await harness.app.listen({ host: "127.0.0.1", port: 0 });
    const address = harness.app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    const base = `ws://127.0.0.1:${address.port}/api/v1/display/sync`;

    const memberClosed = await new Promise<number>((resolve) => {
      const ws = new WebSocket(base, {
        headers: {
          Origin: harness.origin,
          Cookie: `${harness.config.cookieName}=${enrolled.managerToken}`,
        },
      });
      ws.on("close", (code) => resolve(code));
      ws.on("error", () => resolve(4401));
    });
    expect(memberClosed).toBe(4401);

    const displayWs = new WebSocket(base, {
      headers: {
        Origin: harness.origin,
        Cookie: `${harness.config.displayCookieName}=${enrolled.displayCookie}`,
      },
    });
    const firstMessage = await new Promise<string>((resolve, reject) => {
      displayWs.once("open", () => {
        /* wait for hello */
      });
      displayWs.once("message", (data) => resolve(String(data)));
      displayWs.once("error", reject);
      displayWs.once("close", (code) =>
        reject(new Error(`display ws closed early: ${code}`)),
      );
    });
    const parsed = JSON.parse(firstMessage) as {
      type: string;
      reason: string;
    };
    expect(parsed.type).toBe("display_invalidate");
    expect(parsed.reason).toBe("work");
    displayWs.close();
  });
});
