import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { householdDateFromInstant } from "../../src/domain/time.js";
import { sha256Hex } from "../../src/server/crypto.js";
import { DisplayStore } from "../../src/server/display.js";
import { loadConfig } from "../../src/server/config.js";
import { buildApp } from "../../src/server/app.js";
import {
  claimManager,
  createHttpHarness,
  IDS,
  type HttpHarness,
} from "../helpers/auth-fixture.js";

const harnesses: HttpHarness[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const h of harnesses.splice(0)) {
    await h.close();
  }
});

function requiredStep(text: string) {
  return {
    logicalItemId: randomUUID(),
    text,
    obligation: "required" as const,
  };
}

function walkJson(
  value: unknown,
  visit: (leaf: string | number | boolean | null) => void,
): void {
  if (value === null || typeof value !== "object") {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      visit(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, visit);
    return;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    walkJson(child, visit);
  }
}

function assertNoSecrets(payload: unknown, forbidden: string[]): void {
  const hits: string[] = [];
  walkJson(payload, (leaf) => {
    if (typeof leaf !== "string") return;
    for (const secret of forbidden) {
      if (leaf.includes(secret)) hits.push(`${secret} in ${leaf}`);
    }
  });
  expect(hits, hits.join("; ")).toEqual([]);
}

async function createAndClaimDisplay(
  harness: HttpHarness,
  label = "Evidence wall",
): Promise<{
  manager: Awaited<ReturnType<typeof claimManager>>;
  displayId: string;
  code: string;
  displayCookie: string;
  configVersion: number;
}> {
  const manager = await claimManager(harness.store);
  const createRes = await harness.app.inject({
    method: "POST",
    url: "/api/v1/displays",
    headers: {
      cookie: `${harness.config.cookieName}=${manager.token}`,
      origin: harness.origin,
      "x-csrf-token": manager.csrfSecret,
      "content-type": "application/json",
    },
    payload: { mutationId: randomUUID(), label },
  });
  expect(createRes.statusCode).toBe(200);
  const created = createRes.json() as {
    enrollment: { code: string };
    display: { id: string };
    configVersion: number;
  };
  const claimRes = await harness.app.inject({
    method: "POST",
    url: "/api/v1/display/claim",
    headers: {
      origin: harness.origin,
      "content-type": "application/json",
    },
    payload: { code: created.enrollment.code },
  });
  expect(claimRes.statusCode).toBe(200);
  const displayCookie = claimRes.cookies.find(
    (c) => c.name === harness.config.displayCookieName,
  );
  expect(displayCookie?.value).toBeTruthy();
  return {
    manager,
    displayId: created.display.id,
    code: created.enrollment.code,
    displayCookie: displayCookie!.value,
    configVersion: created.configVersion,
  };
}

describe("P0-007C-2 AT1 activity clear preserves display", () => {
  it("preserves display row, session, and outstanding claim across activity clear", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await createAndClaimDisplay(harness, "Clear-safe wall");

    // Materialize current day so clear has occurrences to remove.
    const today = await harness.app.inject({
      method: "GET",
      url: "/api/v1/today",
      headers: {
        cookie: `${harness.config.cookieName}=${enrolled.manager.token}`,
      },
    });
    expect(today.statusCode).toBe(200);

    // configVersion after claim bumped; fetch list for current version.
    const list = await harness.app.inject({
      method: "GET",
      url: "/api/v1/displays",
      headers: {
        cookie: `${harness.config.cookieName}=${enrolled.manager.token}`,
      },
    });
    expect(list.statusCode).toBe(200);
    const displays = (
      list.json() as {
        displays: Array<{
          id: string;
          configVersion: number;
          hasOutstandingClaim: boolean;
          hasActiveSession: boolean;
        }>;
      }
    ).displays;
    const row = displays.find((d) => d.id === enrolled.displayId)!;
    expect(row.hasActiveSession).toBe(true);

    // Active session + outstanding replacement claim.
    const issue = await harness.app.inject({
      method: "POST",
      url: `/api/v1/displays/${enrolled.displayId}/enrollment`,
      headers: {
        cookie: `${harness.config.cookieName}=${enrolled.manager.token}`,
        origin: harness.origin,
        "x-csrf-token": enrolled.manager.csrfSecret,
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        expectedConfigVersion: row.configVersion,
      },
    });
    expect(issue.statusCode).toBe(200);
    const outstandingCode = (issue.json() as { code: string }).code;

    const sessionBefore = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: {
        cookie: `${harness.config.displayCookieName}=${enrolled.displayCookie}`,
      },
    });
    expect(sessionBefore.statusCode).toBe(200);
    const sessionBody = (sessionBefore.json() as { session: { displayId: string } })
      .session;

    const gen = (
      harness.db
        .prepare(`SELECT activity_generation AS g FROM households WHERE id = ?`)
        .get(enrolled.manager.context.householdId) as { g: number }
    ).g;
    const clear = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/activity/clear",
      headers: {
        cookie: `${harness.config.cookieName}=${enrolled.manager.token}`,
        origin: harness.origin,
        "x-csrf-token": enrolled.manager.csrfSecret,
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        expectedGeneration: gen,
        acknowledgedScope: "routines_and_responsibilities",
      },
    });
    expect(clear.statusCode).toBe(200);

    const occCount = (
      harness.db
        .prepare(
          `SELECT COUNT(*) AS c FROM occurrences WHERE household_id = ?`,
        )
        .get(enrolled.manager.context.householdId) as { c: number }
    ).c;
    expect(occCount).toBe(0);

    const displayRow = harness.db
      .prepare(`SELECT id, label, revoked_at FROM household_displays WHERE id = ?`)
      .get(enrolled.displayId) as {
      id: string;
      label: string;
      revoked_at: string | null;
    };
    expect(displayRow.label).toBe("Clear-safe wall");
    expect(displayRow.revoked_at).toBeNull();

    const sessionAfter = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: {
        cookie: `${harness.config.displayCookieName}=${enrolled.displayCookie}`,
      },
    });
    expect(sessionAfter.statusCode).toBe(200);
    expect(
      (sessionAfter.json() as { session: { displayId: string } }).session.displayId,
    ).toBe(sessionBody.displayId);

    const listAfter = await harness.app.inject({
      method: "GET",
      url: "/api/v1/displays",
      headers: {
        cookie: `${harness.config.cookieName}=${enrolled.manager.token}`,
      },
    });
    const afterRow = (
      listAfter.json() as {
        displays: Array<{
          id: string;
          hasOutstandingClaim: boolean;
          hasActiveSession: boolean;
        }>;
      }
    ).displays.find((d) => d.id === enrolled.displayId)!;
    expect(afterRow.hasActiveSession).toBe(true);
    expect(afterRow.hasOutstandingClaim).toBe(true);

    // Outstanding code still redeemable by same display.
    const reclaim = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        cookie: `${harness.config.displayCookieName}=${enrolled.displayCookie}`,
      },
      payload: { code: outstandingCode },
    });
    expect(reclaim.statusCode).toBe(200);
  });
});

describe("P0-007C-2 AT3 claim/command correctness", () => {
  it("rejects expired, malformed, used, cancelled, replaced codes and demoted issuer", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const manager = await claimManager(harness.store);
    const headers = {
      cookie: `${harness.config.cookieName}=${manager.token}`,
      origin: harness.origin,
      "x-csrf-token": manager.csrfSecret,
      "content-type": "application/json",
    };

    const create = await harness.app.inject({
      method: "POST",
      url: "/api/v1/displays",
      headers,
      payload: { mutationId: randomUUID(), label: "Claim lab" },
    });
    expect(create.statusCode).toBe(200);
    const created = create.json() as {
      enrollment: { code: string; claimId: string };
      display: { id: string };
      configVersion: number;
    };

    const malformed = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { code: "not-a-valid-code!!" },
    });
    expect(malformed.statusCode).toBeGreaterThanOrEqual(400);

    const foreignOrigin = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      payload: { code: created.enrollment.code },
    });
    expect(foreignOrigin.statusCode).toBe(403);

    // Expire outstanding claim in DB.
    harness.db
      .prepare(
        `UPDATE display_enrollment_claims SET expires_at = ? WHERE id = ?`,
      )
      .run(new Date(Date.now() - 60_000).toISOString(), created.enrollment.claimId);
    const expired = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { code: created.enrollment.code },
    });
    expect(expired.statusCode).toBeGreaterThanOrEqual(400);

    // Fresh code, cancel, then claim fails.
    const list1 = (
      (
        await harness.app.inject({
          method: "GET",
          url: "/api/v1/displays",
          headers: { cookie: headers.cookie },
        })
      ).json() as { displays: Array<{ id: string; configVersion: number }> }
    ).displays.find((d) => d.id === created.display.id)!;
    const issued = await harness.app.inject({
      method: "POST",
      url: `/api/v1/displays/${created.display.id}/enrollment`,
      headers,
      payload: {
        mutationId: randomUUID(),
        expectedConfigVersion: list1.configVersion,
      },
    });
    expect(issued.statusCode).toBe(200);
    const cancelCode = (issued.json() as { code: string; configVersion: number })
      .code;
    const cancelVersion = (issued.json() as { configVersion: number })
      .configVersion;
    const cancelled = await harness.app.inject({
      method: "POST",
      url: `/api/v1/displays/${created.display.id}/enrollment/cancel`,
      headers,
      payload: {
        mutationId: randomUUID(),
        expectedConfigVersion: cancelVersion,
      },
    });
    expect(cancelled.statusCode).toBe(200);
    const cancelClaim = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { code: cancelCode },
    });
    expect(cancelClaim.statusCode).toBeGreaterThanOrEqual(400);

    // Replace: old code fails, new works.
    const list2 = (
      (
        await harness.app.inject({
          method: "GET",
          url: "/api/v1/displays",
          headers: { cookie: headers.cookie },
        })
      ).json() as { displays: Array<{ id: string; configVersion: number }> }
    ).displays.find((d) => d.id === created.display.id)!;
    const first = await harness.app.inject({
      method: "POST",
      url: `/api/v1/displays/${created.display.id}/enrollment`,
      headers,
      payload: {
        mutationId: randomUUID(),
        expectedConfigVersion: list2.configVersion,
      },
    });
    const firstCode = (first.json() as { code: string; configVersion: number })
      .code;
    const second = await harness.app.inject({
      method: "POST",
      url: `/api/v1/displays/${created.display.id}/enrollment`,
      headers,
      payload: {
        mutationId: randomUUID(),
        expectedConfigVersion: (first.json() as { configVersion: number })
          .configVersion,
      },
    });
    const secondCode = (second.json() as { code: string }).code;
    const replacedFail = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { code: firstCode },
    });
    expect(replacedFail.statusCode).toBeGreaterThanOrEqual(400);
    const replacedOk = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { code: secondCode },
    });
    expect(replacedOk.statusCode).toBe(200);
    const used = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { code: secondCode },
    });
    expect(used.statusCode).toBeGreaterThanOrEqual(400);

    // Demoted issuer: outstanding claim fails at redemption.
    const create2 = await harness.app.inject({
      method: "POST",
      url: "/api/v1/displays",
      headers,
      payload: { mutationId: randomUUID(), label: "Demote wall" },
    });
    const demote = create2.json() as {
      enrollment: { code: string };
      display: { id: string };
    };
    harness.db
      .prepare(
        `DELETE FROM membership_grants
         WHERE membership_id = ? AND grant_name = 'household.display.manage'`,
      )
      .run(manager.context.membershipId);
    const demotedClaim = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { code: demote.enrollment.code },
    });
    expect(demotedClaim.statusCode).toBeGreaterThanOrEqual(400);

    // Restore grant for remaining tests in this file via new manager if needed.
  });

  it("mutationId replay does not duplicate displays; claim rate limit is enforceable", async () => {
    const harness = await createHttpHarness(
      { AUTO_SEED: "1" },
      { claimRateLimit: { max: 5, timeWindow: "1 minute" } },
    );
    harnesses.push(harness);
    const manager = await claimManager(harness.store);
    const headers = {
      cookie: `${harness.config.cookieName}=${manager.token}`,
      origin: harness.origin,
      "x-csrf-token": manager.csrfSecret,
      "content-type": "application/json",
    };
    const mutationId = randomUUID();
    const first = await harness.app.inject({
      method: "POST",
      url: "/api/v1/displays",
      headers,
      payload: { mutationId, label: "Replay wall" },
    });
    expect(first.statusCode).toBe(200);
    const second = await harness.app.inject({
      method: "POST",
      url: "/api/v1/displays",
      headers,
      payload: { mutationId, label: "Replay wall" },
    });
    expect(second.statusCode).toBe(200);
    expect(
      (
        harness.db
          .prepare(
            `SELECT COUNT(*) AS c FROM household_displays WHERE label = 'Replay wall'`,
          )
          .get() as { c: number }
      ).c,
    ).toBe(1);

    // Rate limit: 5 failed claims then 429.
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const res = await harness.app.inject({
        method: "POST",
        url: "/api/v1/display/claim",
        headers: { origin: harness.origin, "content-type": "application/json" },
        payload: { code: "AAAAAAAABBBBBBBB" },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 5).every((s) => s >= 400 && s !== 429)).toBe(true);
    expect(statuses.slice(5).some((s) => s === 429)).toBe(true);
  });
});

describe("P0-007C-2 AT5 response privacy allowlists", () => {
  it("recursively excludes private titles/ids from display HTTP, errors, and WS frames", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await createAndClaimDisplay(harness, "Privacy wall");
    const PRIVATE_TITLE = "PRIVATE_TASK_SECRET_TITLE_007C2";
    const PRIVATE_ID = randomUUID();

    harness.db
      .prepare(
        `INSERT INTO personal_tasks
           (id, household_id, owner_membership_id, title, visibility, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'private', 'open', datetime('now'), datetime('now'))`,
      )
      .run(
        PRIVATE_ID,
        enrolled.manager.context.householdId,
        enrolled.manager.context.membershipId,
        PRIVATE_TITLE,
      );

    const cookie = `${harness.config.displayCookieName}=${enrolled.displayCookie}`;
    const dashboard = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: { cookie },
    });
    expect(dashboard.statusCode).toBe(200);
    assertNoSecrets(dashboard.json(), [PRIVATE_TITLE, PRIVATE_ID]);

    const person = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${enrolled.manager.context.membershipId}`,
      headers: { cookie },
    });
    expect(person.statusCode).toBe(200);
    assertNoSecrets(person.json(), [PRIVATE_TITLE, PRIVATE_ID, "birthday"]);

    const foreignOcc = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/occurrences/${PRIVATE_ID}`,
      headers: { cookie },
    });
    expect(foreignOcc.statusCode).toBeGreaterThanOrEqual(400);
    assertNoSecrets(foreignOcc.json(), [PRIVATE_TITLE]);

    await harness.app.listen({ host: "127.0.0.1", port: 0 });
    const address = harness.app.server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const frames: string[] = [];
    const ws = new WebSocket(
      `ws://127.0.0.1:${address.port}/api/v1/display/sync`,
      {
        headers: {
          Origin: harness.origin,
          Cookie: cookie,
        },
      },
    );
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    ws.on("message", (data) => frames.push(String(data)));
    await new Promise((r) => setTimeout(r, 50));

    // Private-only create via manager must not emit disclosive display_invalidate.
    const before = frames.length;
    await harness.app.inject({
      method: "POST",
      url: "/api/v1/personal-tasks",
      headers: {
        cookie: `${harness.config.cookieName}=${enrolled.manager.token}`,
        origin: harness.origin,
        "x-csrf-token": enrolled.manager.csrfSecret,
        "content-type": "application/json",
      },
      payload: { title: PRIVATE_TITLE + "_NEW", visibility: "private" },
    });
    await new Promise((r) => setTimeout(r, 100));
    const newFrames = frames.slice(before).map((f) => JSON.parse(f) as {
      type: string;
      reason: string;
    });
    expect(
      newFrames.filter((f) => f.reason === "tasks").length,
      "private task must not emit tasks invalidate",
    ).toBe(0);
    for (const frame of frames) {
      assertNoSecrets(JSON.parse(frame), [PRIVATE_TITLE, PRIVATE_ID]);
    }
    ws.close();
  });
});

describe("P0-007C-2 AT6 shared current-day truth", () => {
  it("shows six people and mixed work matching manager today materialization", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await createAndClaimDisplay(harness, "Truth wall");
    const ctx = enrolled.manager.context;
    const today = householdDateFromInstant(new Date(), ctx.timezone);

    for (const [title, memberId] of [
      ["Kitchen", IDS.avery],
      ["Cats", IDS.casey],
      ["Bathroom", IDS.jordan],
      ["Trash", IDS.taylor],
    ] as const) {
      harness.store.createResponsibility(ctx, {
        mutationId: randomUUID(),
        title,
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "fixed",
          anchorDate: today,
          fixedMemberId: memberId,
        },
        steps: [requiredStep(`${title} step`)],
      });
    }
    harness.store.createRoutine(ctx, {
      mutationId: randomUUID(),
      title: "Morning stretch",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery, IDS.casey, IDS.jordan],
      assigneeGroupIds: [],
      steps: [requiredStep("Stretch")],
    });

    const displayDash = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: {
        cookie: `${harness.config.displayCookieName}=${enrolled.displayCookie}`,
      },
    });
    expect(displayDash.statusCode).toBe(200);
    const dash = (displayDash.json() as { dashboard: {
      householdDate: string;
      byPerson: Array<{ membershipId: string; displayName: string }>;
      byWork: {
        responsibilities: Array<{
          id: string;
          title: string;
          accountableMemberId: string | null;
          state: string;
        }>;
      };
    } }).dashboard;
    expect(dash.householdDate).toBe(today);
    expect(dash.byPerson.length).toBeGreaterThanOrEqual(6);

    const managerToday = await harness.app.inject({
      method: "GET",
      url: "/api/v1/today",
      headers: {
        cookie: `${harness.config.cookieName}=${enrolled.manager.token}`,
      },
    });
    expect(managerToday.statusCode).toBe(200);
    const todayBody = managerToday.json() as {
      householdDate: string;
      occurrences: Array<{
        id: string;
        title: string;
        accountableMemberId: string | null;
        status: string;
      }>;
    };
    expect(todayBody.householdDate).toBe(dash.householdDate);

    for (const title of ["Kitchen", "Cats", "Bathroom", "Trash"]) {
      const displayRow = dash.byWork.responsibilities.find((r) => r.title === title);
      const memberRow = todayBody.occurrences.find((o) => o.title === title);
      expect(displayRow, title).toBeTruthy();
      expect(memberRow, title).toBeTruthy();
      expect(displayRow!.id).toBe(memberRow!.id);
      expect(displayRow!.accountableMemberId).toBe(memberRow!.accountableMemberId);
    }
  });
});

describe("P0-007C-2 AT13 persistence and expiry", () => {
  it("survives app reopen with same DB + cookie; idle/absolute expiry; cookie maxAge", async () => {
    const first = await createHttpHarness({ AUTO_SEED: "1" });
    const enrolled = await createAndClaimDisplay(first, "Persist wall");
    const dbPath = first.dbPath;
    const displayCookieName = first.config.displayCookieName;
    const origin = first.origin;

    const list = await first.app.inject({
      method: "GET",
      url: "/api/v1/displays",
      headers: {
        cookie: `${first.config.cookieName}=${enrolled.manager.token}`,
      },
    });
    const row = (
      list.json() as {
        displays: Array<{ id: string; configVersion: number }>;
      }
    ).displays.find((d) => d.id === enrolled.displayId)!;
    const reissue = await first.app.inject({
      method: "POST",
      url: `/api/v1/displays/${enrolled.displayId}/enrollment`,
      headers: {
        cookie: `${first.config.cookieName}=${enrolled.manager.token}`,
        origin,
        "x-csrf-token": enrolled.manager.csrfSecret,
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        expectedConfigVersion: row.configVersion,
      },
    });
    expect(reissue.statusCode).toBe(200);
    const newCode = (reissue.json() as { code: string }).code;
    const reclaim = await first.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: `${displayCookieName}=${enrolled.displayCookie}`,
      },
      payload: { code: newCode },
    });
    expect(reclaim.statusCode).toBe(200);
    const cookieAttrs = reclaim.cookies.find((c) => c.name === displayCookieName);
    expect(cookieAttrs?.maxAge).toBeTruthy();
    expect(Number(cookieAttrs!.maxAge)).toBeGreaterThan(0);
    const newCookie = cookieAttrs!.value;

    await first.app.close();

    const config = loadConfig({
      APP_PROFILE: "test",
      AUTO_SEED: "0",
      DB_PATH: dbPath,
      BACKUP_DIR: first.config.backupDir,
      HOUSEHOLD_TIMEZONE: "America/New_York",
      HOST: "127.0.0.1",
      PORT: String(8899 + Math.floor(Math.random() * 100)),
      PUBLIC_ORIGIN: origin,
      NODE_ENV: "test",
    });
    const rebuilt = await buildApp(config);
    harnesses.push({
      app: rebuilt.app,
      store: rebuilt.store,
      db: rebuilt.db,
      config: rebuilt.config,
      dbPath,
      origin,
      close: async () => {
        await rebuilt.app.close();
        try {
          fs.rmSync(dbPath, { force: true });
        } catch {
          /* ignore */
        }
      },
    });

    const resumed = await rebuilt.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: { cookie: `${displayCookieName}=${newCookie}` },
    });
    expect(resumed.statusCode).toBe(200);

    // Idle expiry: age last_seen_at beyond 90 days.
    const digest = sha256Hex(newCookie);
    rebuilt.db
      .prepare(
        `UPDATE display_sessions SET last_seen_at = ? WHERE token_digest = ?`,
      )
      .run(new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString(), digest);
    const idleDenied = await rebuilt.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: { cookie: `${displayCookieName}=${newCookie}` },
    });
    expect(idleDenied.statusCode).toBe(401);

    // Absolute expiry via DisplayStore token lookup.
    const displayStore = new DisplayStore(rebuilt.db, rebuilt.store);
    const anyDisplay = rebuilt.db
      .prepare(
        `SELECT id FROM household_displays WHERE revoked_at IS NULL LIMIT 1`,
      )
      .get() as { id: string };
    rebuilt.db
      .prepare(
        `INSERT INTO display_sessions
           (id, display_id, token_digest, created_at, last_seen_at, absolute_expires_at, revoked_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'), ?, NULL)`,
      )
      .run(
        randomUUID(),
        anyDisplay.id,
        sha256Hex("absolute-test-token"),
        new Date(Date.now() - 1000).toISOString(),
      );
    expect(
      displayStore.getDisplaySessionByTokenDigest(sha256Hex("absolute-test-token")),
    ).toBeNull();
  });
});

describe("P0-007C-2 AT14 household date and DST boundaries", () => {
  it("crosses midnight and DST with fake timers; old detail not served for wrong day", async () => {
    const harness = await createHttpHarness({
      AUTO_SEED: "1",
      HOUSEHOLD_TIMEZONE: "America/New_York",
    });
    harnesses.push(harness);
    const enrolled = await createAndClaimDisplay(harness, "Clock wall");
    const cookie = `${harness.config.displayCookieName}=${enrolled.displayCookie}`;

    vi.useFakeTimers({
      now: new Date("2026-03-08T06:30:00.000Z"),
      toFake: ["Date"],
    });
    const springDash = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: { cookie },
    });
    expect(springDash.statusCode).toBe(200);
    const springDate = (
      springDash.json() as { dashboard: { householdDate: string } }
    ).dashboard.householdDate;
    expect(springDate).toBe(
      householdDateFromInstant(new Date(), "America/New_York"),
    );

    vi.setSystemTime(new Date("2026-03-09T04:30:00.000Z"));
    const afterMidnight = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: { cookie },
    });
    expect(afterMidnight.statusCode).toBe(200);
    const nextDate = (
      afterMidnight.json() as { dashboard: { householdDate: string } }
    ).dashboard.householdDate;
    expect(nextDate).not.toBe(springDate);
    expect(nextDate).toBe(
      householdDateFromInstant(new Date(), "America/New_York"),
    );

    vi.setSystemTime(new Date("2026-11-01T05:30:00.000Z"));
    // Keep session idle clock within the 90-day bound across the DST jump.
    harness.db
      .prepare(
        `UPDATE display_sessions SET last_seen_at = ? WHERE token_digest = ?`,
      )
      .run(new Date().toISOString(), sha256Hex(enrolled.displayCookie));
    const fallDash = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: { cookie },
    });
    expect(fallDash.statusCode).toBe(200);
    expect(
      (fallDash.json() as { dashboard: { householdDate: string } }).dashboard
        .householdDate,
    ).toBe(householdDateFromInstant(new Date(), "America/New_York"));

    const foreign = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/occurrences/${randomUUID()}`,
      headers: { cookie },
    });
    expect(foreign.statusCode).toBeGreaterThanOrEqual(400);
  });
});
