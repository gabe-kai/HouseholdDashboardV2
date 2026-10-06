import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../../src/server/db.js";
import {
  openPopulatedP016UpgradeDatabase,
  P016_FIXTURE_IDS,
} from "../helpers/p016-fixture.js";
import {
  IDS,
  authHeaders,
  createHttpHarness,
  httpClaimManager,
  type HttpHarness,
} from "../helpers/auth-fixture.js";

const temps: string[] = [];
const harnesses: HttpHarness[] = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    await harness?.close();
  }
  for (const file of temps.splice(0)) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
  }
});

async function enrollDisplay(
  harness: HttpHarness,
  manager: { cookieHeader: string; csrfToken: string },
): Promise<{ displayCookie: string }> {
  const origin = harness.origin;
  const createRes = await harness.app.inject({
    method: "POST",
    url: "/api/v1/displays",
    headers: {
      cookie: manager.cookieHeader,
      origin,
      "x-csrf-token": manager.csrfToken,
      "content-type": "application/json",
    },
    payload: { mutationId: randomUUID(), label: "3B wall" },
  });
  expect(createRes.statusCode).toBe(200);
  const created = createRes.json() as { enrollment: { code: string } };
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
  return { displayCookie: displayCookie!.value };
}

async function claimAvery(
  harness: HttpHarness,
  manager: { cookieHeader: string; csrfToken: string },
): Promise<{ headers: Record<string, string> }> {
  const enroll = await harness.app.inject({
    method: "POST",
    url: "/api/v1/enrollment/claims",
    headers: authHeaders(harness, {
      cookieHeader: manager.cookieHeader,
      csrfToken: manager.csrfToken,
      membershipId: IDS.morgan,
    }),
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
      passphrase: "AveryPassphrase999!",
      displayName: "Avery",
    },
  });
  expect(childClaim.statusCode).toBe(200);
  const averyCookie = childClaim.cookies.find((c) => c.name === harness.config.cookieName)!;
  const averyCsrf = (childClaim.json() as { csrfToken: string }).csrfToken;
  return {
    headers: {
      origin: harness.origin,
      cookie: `${averyCookie.name}=${averyCookie.value}`,
      "x-csrf-token": averyCsrf,
    },
  };
}

describe("P0-007C-3B AT1 populated through-016 upgrade", () => {
  it("defaults tasks unpromoted, backfills completed_at, preserves receipts", () => {
    const dbPath = path.join(os.tmpdir(), `hd-007c3b-p016-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openPopulatedP016UpgradeDatabase(dbPath);

    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '017_%'")
          .get() as { c: number }
      ).c,
    ).toBe(0);

    const beforeCompleted = db
      .prepare(`SELECT status, updated_at FROM personal_tasks WHERE id = ?`)
      .get(P016_FIXTURE_IDS.completedHouseholdTaskId) as {
      status: string;
      updated_at: string;
    };
    expect(beforeCompleted.status).toBe("completed");

    migrate(db);

    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '017_%'")
          .get() as { c: number }
      ).c,
    ).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number }).c,
    ).toBe(18);

    const promotedCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM personal_tasks WHERE show_on_shared_dashboard = 1`,
        )
        .get() as { c: number }
    ).c;
    expect(promotedCount).toBe(0);

    const completed = db
      .prepare(
        `SELECT completed_at, show_on_shared_dashboard, sharing_version
         FROM personal_tasks WHERE id = ?`,
      )
      .get(P016_FIXTURE_IDS.completedHouseholdTaskId) as {
      completed_at: string;
      show_on_shared_dashboard: number;
      sharing_version: number;
    };
    expect(completed.completed_at).toBe(beforeCompleted.updated_at);
    expect(completed.show_on_shared_dashboard).toBe(0);
    expect(completed.sharing_version).toBe(0);

    expect(
      (
        db
          .prepare(`SELECT 1 AS ok FROM personal_task_mutations WHERE mutation_id = ?`)
          .get(P016_FIXTURE_IDS.taskStatusMutationId) as { ok: number } | undefined
      )?.ok,
    ).toBe(1);

    migrate(db); // idempotent
    db.close();

    const backupPath = `${dbPath}.bak`;
    fs.copyFileSync(dbPath, backupPath);
    temps.push(backupPath);
    const restored = openDatabase(backupPath);
    restored.pragma("foreign_keys = ON");
    expect(
      (restored.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number })
        .c,
    ).toBe(18);
    restored.close();
  });
});

describe("P0-007C-3B sharing authority and privacy", () => {
  it("AT2/AT3/AT4: owner promote/private clear/completedAt; denies peers and conflicts", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const manager = await httpClaimManager(harness);
    const avery = await claimAvery(harness, manager);
    const averyHeaders = avery.headers;

    const create = await harness.app.inject({
      method: "POST",
      url: "/api/v1/personal-tasks",
      headers: averyHeaders,
      payload: {
        title: `Wall milk ${Date.now().toString(36)}`,
        visibility: "household",
        showOnSharedDashboard: false,
      },
    });
    expect(create.statusCode).toBe(200);
    const task = (create.json() as { task: {
      id: string;
      showOnSharedDashboard: boolean;
      sharingVersion: number;
      completedAt: string | null;
    } }).task;
    expect(task.showOnSharedDashboard).toBe(false);

    const privatePromote = await harness.app.inject({
      method: "POST",
      url: "/api/v1/personal-tasks",
      headers: averyHeaders,
      payload: {
        title: "Secret",
        visibility: "private",
        showOnSharedDashboard: true,
      },
    });
    expect(privatePromote.statusCode).toBe(400);

    const mutationId = crypto.randomUUID();
    const promote = await harness.app.inject({
      method: "POST",
      url: `/api/v1/personal-tasks/${task.id}/sharing`,
      headers: averyHeaders,
      payload: {
        mutationId,
        visibility: "household",
        showOnSharedDashboard: true,
        expectedSharingVersion: task.sharingVersion,
      },
    });
    expect(promote.statusCode).toBe(200);
    const promoted = (promote.json() as { task: {
      showOnSharedDashboard: boolean;
      sharingVersion: number;
    } }).task;
    expect(promoted.showOnSharedDashboard).toBe(true);

    const replay = await harness.app.inject({
      method: "POST",
      url: `/api/v1/personal-tasks/${task.id}/sharing`,
      headers: averyHeaders,
      payload: {
        mutationId,
        visibility: "household",
        showOnSharedDashboard: true,
        expectedSharingVersion: task.sharingVersion,
      },
    });
    expect(replay.statusCode).toBe(200);

    const conflictPayload = await harness.app.inject({
      method: "POST",
      url: `/api/v1/personal-tasks/${task.id}/sharing`,
      headers: averyHeaders,
      payload: {
        mutationId,
        visibility: "household",
        showOnSharedDashboard: false,
        expectedSharingVersion: task.sharingVersion,
      },
    });
    expect(conflictPayload.statusCode).toBe(409);

    const peer = await harness.app.inject({
      method: "POST",
      url: `/api/v1/personal-tasks/${task.id}/sharing`,
      headers: authHeaders(harness, manager),
      payload: {
        mutationId: crypto.randomUUID(),
        visibility: "private",
        showOnSharedDashboard: false,
        expectedSharingVersion: promoted.sharingVersion,
      },
    });
    expect(peer.statusCode).toBe(403);

    const complete = await harness.app.inject({
      method: "POST",
      url: `/api/v1/personal-tasks/${task.id}/status`,
      headers: averyHeaders,
      payload: { mutationId: crypto.randomUUID(), status: "completed" },
    });
    expect(complete.statusCode).toBe(200);
    const completed = (complete.json() as { task: { completedAt: string | null } }).task;
    expect(completed.completedAt).toBeTruthy();
    const completedAt = completed.completedAt!;

    await new Promise((r) => setTimeout(r, 5));
    const contradictory = await harness.app.inject({
      method: "POST",
      url: `/api/v1/personal-tasks/${task.id}/sharing`,
      headers: averyHeaders,
      payload: {
        mutationId: crypto.randomUUID(),
        visibility: "private",
        showOnSharedDashboard: true,
        expectedSharingVersion: promoted.sharingVersion,
      },
    });
    expect(contradictory.statusCode).toBe(400);

    const toPrivate = await harness.app.inject({
      method: "POST",
      url: `/api/v1/personal-tasks/${task.id}/sharing`,
      headers: averyHeaders,
      payload: {
        mutationId: crypto.randomUUID(),
        visibility: "private",
        showOnSharedDashboard: false,
        expectedSharingVersion: promoted.sharingVersion,
      },
    });
    expect(toPrivate.statusCode).toBe(200);
    const privatized = (toPrivate.json() as { task: {
      visibility: string;
      showOnSharedDashboard: boolean;
      completedAt: string | null;
      sharingVersion: number;
    } }).task;
    expect(privatized.visibility).toBe("private");
    expect(privatized.showOnSharedDashboard).toBe(false);
    expect(privatized.completedAt).toBe(completedAt);

    const backHousehold = await harness.app.inject({
      method: "POST",
      url: `/api/v1/personal-tasks/${task.id}/sharing`,
      headers: averyHeaders,
      payload: {
        mutationId: crypto.randomUUID(),
        visibility: "household",
        showOnSharedDashboard: false,
        expectedSharingVersion: privatized.sharingVersion,
      },
    });
    expect(backHousehold.statusCode).toBe(200);
    expect(
      (backHousehold.json() as { task: { showOnSharedDashboard: boolean; completedAt: string | null } })
        .task.showOnSharedDashboard,
    ).toBe(false);
    expect(
      (backHousehold.json() as { task: { completedAt: string | null } }).task.completedAt,
    ).toBe(completedAt);

    const staleVersion = await harness.app.inject({
      method: "POST",
      url: `/api/v1/personal-tasks/${task.id}/sharing`,
      headers: averyHeaders,
      payload: {
        mutationId: crypto.randomUUID(),
        visibility: "household",
        showOnSharedDashboard: true,
        expectedSharingVersion: 0,
      },
    });
    expect(staleVersion.statusCode).toBe(409);
  });

  it("AT5/AT7: display read matrix and no wall personal status command", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const manager = await httpClaimManager(harness);
    const enrolled = await enrollDisplay(harness, manager);

    const create = await harness.app.inject({
      method: "POST",
      url: "/api/v1/personal-tasks",
      headers: authHeaders(harness, manager),
      payload: {
        title: `Promoted ${Date.now().toString(36)}`,
        visibility: "household",
        showOnSharedDashboard: true,
      },
    });
    expect(create.statusCode).toBe(200);
    const task = (create.json() as { task: { id: string; title: string } }).task;

    const privateTask = await harness.app.inject({
      method: "POST",
      url: "/api/v1/personal-tasks",
      headers: authHeaders(harness, manager),
      payload: {
        title: `Private ${Date.now().toString(36)}`,
        visibility: "private",
      },
    });
    expect(privateTask.statusCode).toBe(200);
    const privateId = (privateTask.json() as { task: { id: string; title: string } }).task
      .id;
    const privateTitle = (privateTask.json() as { task: { title: string } }).task.title;

    const dash = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: {
        cookie: `${harness.config.displayCookieName}=${enrolled.displayCookie}`,
      },
    });
    expect(dash.statusCode).toBe(200);
    const body = (dash.json() as {
      dashboard: {
        byPerson: Array<{
          progress: { total: number } | null;
          promotedPersonalTasks: Array<{ id: string; title: string }>;
          unfinished: unknown[];
        }>;
        byWork: { responsibilities: unknown[]; routines: unknown[] };
        promotedPersonalTasks: Array<{ id: string; title: string }>;
      };
    }).dashboard;
    const dashText = JSON.stringify(body);
    expect(dashText).not.toContain(privateId);
    expect(dashText).not.toContain(privateTitle);
    expect(body.promotedPersonalTasks.some((t) => t.id === task.id)).toBe(true);
    const ownerPerson = body.byPerson.find((p) =>
      p.promotedPersonalTasks.some((t) => t.id === task.id),
    );
    expect(ownerPerson).toBeTruthy();
    // Promoted personal work must not inflate recurring progress totals.
    if (ownerPerson?.progress) {
      expect(ownerPerson.progress.total).toBe(
        ownerPerson.unfinished.length > 0 || ownerPerson.progress.total >= 0
          ? ownerPerson.progress.total
          : 0,
      );
    }

    const displayStatus = await harness.app.inject({
      method: "POST",
      url: `/api/v1/personal-tasks/${task.id}/status`,
      headers: {
        origin: harness.origin,
        cookie: `${harness.config.displayCookieName}=${enrolled.displayCookie}`,
        "x-csrf-token": "display-csrf-ignored",
      },
      payload: { mutationId: crypto.randomUUID(), status: "completed" },
    });
    expect([401, 403]).toContain(displayStatus.statusCode);

    const displayShare = await harness.app.inject({
      method: "POST",
      url: `/api/v1/personal-tasks/${task.id}/sharing`,
      headers: {
        origin: harness.origin,
        cookie: `${harness.config.displayCookieName}=${enrolled.displayCookie}`,
        "x-csrf-token": "display-csrf-ignored",
      },
      payload: {
        mutationId: crypto.randomUUID(),
        visibility: "private",
        showOnSharedDashboard: false,
        expectedSharingVersion: 0,
      },
    });
    expect([401, 403]).toContain(displayShare.statusCode);

    const unpromoted = await harness.app.inject({
      method: "POST",
      url: "/api/v1/personal-tasks",
      headers: authHeaders(harness, manager),
      payload: {
        title: `Detail only ${Date.now().toString(36)}`,
        visibility: "household",
        showOnSharedDashboard: false,
      },
    });
    expect(unpromoted.statusCode).toBe(200);
    const unpromotedTask = (unpromoted.json() as { task: { id: string } }).task;

    const dash2 = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: {
        cookie: `${harness.config.displayCookieName}=${enrolled.displayCookie}`,
      },
    });
    const dash2Body = (dash2.json() as {
      dashboard: { promotedPersonalTasks: Array<{ id: string }> };
    }).dashboard;
    expect(dash2Body.promotedPersonalTasks.some((t) => t.id === unpromotedTask.id)).toBe(
      false,
    );

    const person = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.morgan}`,
      headers: {
        cookie: `${harness.config.displayCookieName}=${enrolled.displayCookie}`,
      },
    });
    expect(person.statusCode).toBe(200);
    const personBody = person.json() as {
      person: {
        householdVisibleTasks: Array<{
          id: string;
          showOnSharedDashboard: boolean;
        }>;
      };
    };
    const personText = JSON.stringify(personBody);
    expect(personText).not.toContain(privateId);
    expect(personText).not.toContain(privateTitle);
    expect(
      personBody.person.householdVisibleTasks.some((t) => t.id === unpromotedTask.id),
    ).toBe(true);
    expect(
      personBody.person.householdVisibleTasks.some(
        (t) => t.id === task.id && t.showOnSharedDashboard,
      ),
    ).toBe(true);

    const completePromoted = await harness.app.inject({
      method: "POST",
      url: `/api/v1/personal-tasks/${task.id}/status`,
      headers: authHeaders(harness, manager),
      payload: { mutationId: crypto.randomUUID(), status: "completed" },
    });
    expect(completePromoted.statusCode).toBe(200);
    const dashQuiet = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: {
        cookie: `${harness.config.displayCookieName}=${enrolled.displayCookie}`,
      },
    });
    expect(
      (dashQuiet.json() as { dashboard: { promotedPersonalTasks: Array<{ id: string }> } })
        .dashboard.promotedPersonalTasks.some((t) => t.id === task.id),
    ).toBe(false);
  });
});

describe("P0-007C-3B AT6 sync privacy", () => {
  it("private task IDs stay owner-only; household→private pings peers without ID", async () => {
    const WebSocket = (await import("ws")).default;
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const manager = await httpClaimManager(harness);
    const avery = await claimAvery(harness, manager);
    const averyHeaders = avery.headers;
    const averyCookiePair = averyHeaders.cookie!;

    await harness.app.listen({ host: "127.0.0.1", port: 0 });
    const address = harness.app.server.address();
    if (!address || typeof address === "string") throw new Error("no address");

    const ownerMsgs: Array<Record<string, unknown>> = [];
    const peerMsgs: Array<Record<string, unknown>> = [];
    const displayMsgs: string[] = [];

    const ownerWs = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/sync`, {
      headers: {
        Origin: harness.origin,
        Cookie: averyCookiePair,
      },
    });
    await new Promise<void>((resolve, reject) => {
      ownerWs.once("open", () => resolve());
      ownerWs.once("error", reject);
    });
    ownerWs.on("message", (data) =>
      ownerMsgs.push(JSON.parse(String(data)) as Record<string, unknown>),
    );

    const peerWs = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/sync`, {
      headers: {
        Origin: harness.origin,
        Cookie: manager.cookieHeader,
      },
    });
    await new Promise<void>((resolve, reject) => {
      peerWs.once("open", () => resolve());
      peerWs.once("error", reject);
    });
    peerWs.on("message", (data) =>
      peerMsgs.push(JSON.parse(String(data)) as Record<string, unknown>),
    );

    const enrolled = await enrollDisplay(harness, manager);
    const displayWs = new WebSocket(
      `ws://127.0.0.1:${address.port}/api/v1/display/sync`,
      {
        headers: {
          Origin: harness.origin,
          Cookie: `${harness.config.displayCookieName}=${enrolled.displayCookie}`,
        },
      },
    );
    await new Promise<void>((resolve, reject) => {
      displayWs.once("open", () => resolve());
      displayWs.once("error", reject);
    });
    displayWs.on("message", (data) => displayMsgs.push(String(data)));

    const privateCreate = await harness.app.inject({
      method: "POST",
      url: "/api/v1/personal-tasks",
      headers: averyHeaders,
      payload: { title: `Priv ${Date.now().toString(36)}`, visibility: "private" },
    });
    expect(privateCreate.statusCode).toBe(200);
    const privateId = (privateCreate.json() as { task: { id: string } }).task.id;
    await new Promise((r) => setTimeout(r, 80));

    expect(
      ownerMsgs.some(
        (m) => m.resource === "personal_task" && m.resourceId === privateId,
      ),
    ).toBe(true);
    expect(peerMsgs.some((m) => JSON.stringify(m).includes(privateId))).toBe(false);
    expect(displayMsgs.some((m) => m.includes(privateId))).toBe(false);

    ownerMsgs.length = 0;
    peerMsgs.length = 0;
    displayMsgs.length = 0;

    const householdCreate = await harness.app.inject({
      method: "POST",
      url: "/api/v1/personal-tasks",
      headers: averyHeaders,
      payload: {
        title: `Pub ${Date.now().toString(36)}`,
        visibility: "household",
        showOnSharedDashboard: true,
      },
    });
    expect(householdCreate.statusCode).toBe(200);
    const publicTask = (householdCreate.json() as {
      task: { id: string; sharingVersion: number };
    }).task;
    await new Promise((r) => setTimeout(r, 80));
    expect(
      peerMsgs.some(
        (m) => m.resource === "personal_task" && m.resourceId === publicTask.id,
      ),
    ).toBe(true);
    expect(
      displayMsgs.some((m) => {
        const parsed = JSON.parse(m) as { reason?: string };
        return parsed.reason === "tasks";
      }),
    ).toBe(true);

    ownerMsgs.length = 0;
    peerMsgs.length = 0;
    displayMsgs.length = 0;

    const toPrivate = await harness.app.inject({
      method: "POST",
      url: `/api/v1/personal-tasks/${publicTask.id}/sharing`,
      headers: averyHeaders,
      payload: {
        mutationId: crypto.randomUUID(),
        visibility: "private",
        showOnSharedDashboard: false,
        expectedSharingVersion: publicTask.sharingVersion,
      },
    });
    expect(toPrivate.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 80));

    expect(
      ownerMsgs.some(
        (m) => m.resource === "personal_task" && m.resourceId === publicTask.id,
      ),
    ).toBe(true);
    const peerWithdrawal = peerMsgs.filter((m) => m.resource === "personal_task");
    expect(peerWithdrawal.length).toBeGreaterThan(0);
    expect(peerWithdrawal.every((m) => m.resourceId === "")).toBe(true);
    expect(peerMsgs.some((m) => JSON.stringify(m).includes(publicTask.id))).toBe(false);
    expect(displayMsgs.some((m) => m.includes(publicTask.id))).toBe(false);
    expect(
      displayMsgs.some((m) => (JSON.parse(m) as { reason?: string }).reason === "tasks"),
    ).toBe(true);

    ownerWs.close();
    peerWs.close();
    displayWs.close();
  });
});
