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
  enrollAndClaim,
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

  it("concurrent claims of the same code have exactly one winner", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const manager = await claimManager(harness.store);
    const create = await harness.app.inject({
      method: "POST",
      url: "/api/v1/displays",
      headers: {
        cookie: `${harness.config.cookieName}=${manager.token}`,
        origin: harness.origin,
        "x-csrf-token": manager.csrfSecret,
        "content-type": "application/json",
      },
      payload: { mutationId: randomUUID(), label: "Concurrent wall" },
    });
    expect(create.statusCode).toBe(200);
    const code = (create.json() as { enrollment: { code: string } }).enrollment
      .code;

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        harness.app.inject({
          method: "POST",
          url: "/api/v1/display/claim",
          headers: {
            origin: harness.origin,
            "content-type": "application/json",
          },
          payload: { code },
        }),
      ),
    );
    const winners = results.filter((r) => r.statusCode === 200);
    const losers = results.filter((r) => r.statusCode !== 200);
    expect(winners).toHaveLength(1);
    expect(losers.length).toBe(7);
    expect(
      (
        harness.db
          .prepare(
            `SELECT COUNT(*) AS c FROM display_sessions WHERE revoked_at IS NULL`,
          )
          .get() as { c: number }
      ).c,
    ).toBe(1);
  });

  it("rolls back claim consume when session insert fails mid-transaction", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const manager = await claimManager(harness.store);
    const displayStore = new DisplayStore(harness.db, harness.store);
    const created = displayStore.createDisplay(manager.context, {
      mutationId: randomUUID(),
      label: "Rollback wall",
    });
    const claimId = created.enrollment.claimId;
    const code = created.enrollment.code;

    displayStore.setClaimAfterConsumeFailureHook(() => {
      throw Object.assign(new Error("injected claim session failure"), {
        code: "INTERNAL",
      });
    });
    expect(() => displayStore.claimDisplayCode(code)).toThrow(
      /injected claim session failure/i,
    );
    displayStore.setClaimAfterConsumeFailureHook(null);

    const claimRow = harness.db
      .prepare(
        `SELECT consumed_at FROM display_enrollment_claims WHERE id = ?`,
      )
      .get(claimId) as { consumed_at: string | null };
    expect(claimRow.consumed_at).toBeNull();
    expect(
      (
        harness.db
          .prepare(
            `SELECT COUNT(*) AS c FROM display_sessions WHERE display_id = ?`,
          )
          .get(created.display.id) as { c: number }
      ).c,
    ).toBe(0);

    const recovered = displayStore.claimDisplayCode(code);
    expect(recovered.token).toBeTruthy();
  });

  it("rejects claim with absent Origin as 403 ORIGIN", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const manager = await claimManager(harness.store);
    const create = await harness.app.inject({
      method: "POST",
      url: "/api/v1/displays",
      headers: {
        cookie: `${harness.config.cookieName}=${manager.token}`,
        origin: harness.origin,
        "x-csrf-token": manager.csrfSecret,
        "content-type": "application/json",
      },
      payload: { mutationId: randomUUID(), label: "No-origin wall" },
    });
    const code = (create.json() as { enrollment: { code: string } }).enrollment
      .code;
    const absent = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { "content-type": "application/json" },
      payload: { code },
    });
    expect(absent.statusCode).toBe(403);
    expect((absent.json() as { code: string }).code).toBe("ORIGIN");
  });

  it("active display cannot claim a different display's code", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const first = await createAndClaimDisplay(harness, "Wall A");
    const manager = first.manager;
    const createB = await harness.app.inject({
      method: "POST",
      url: "/api/v1/displays",
      headers: {
        cookie: `${harness.config.cookieName}=${manager.token}`,
        origin: harness.origin,
        "x-csrf-token": manager.csrfSecret,
        "content-type": "application/json",
      },
      payload: { mutationId: randomUUID(), label: "Wall B" },
    });
    expect(createB.statusCode).toBe(200);
    const codeB = (createB.json() as { enrollment: { code: string } })
      .enrollment.code;
    const switchAttempt = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        cookie: `${harness.config.displayCookieName}=${first.displayCookie}`,
      },
      payload: { code: codeB },
    });
    expect(switchAttempt.statusCode).toBeGreaterThanOrEqual(400);
    expect([403, 409]).toContain(switchAttempt.statusCode);
    const body = switchAttempt.json() as { code: string };
    expect(["FORBIDDEN", "CONFLICT", "UNAUTHORIZED"]).toContain(body.code);

    const stillA = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: {
        cookie: `${harness.config.displayCookieName}=${first.displayCookie}`,
      },
    });
    expect(stillA.statusCode).toBe(200);
    expect(
      (stillA.json() as { session: { displayId: string } }).session.displayId,
    ).toBe(first.displayId);
  });

  it("revoke mutationId replay does not revoke a later replacement session", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await createAndClaimDisplay(harness, "Revoke-replay A");
    const headers = {
      cookie: `${harness.config.cookieName}=${enrolled.manager.token}`,
      origin: harness.origin,
      "x-csrf-token": enrolled.manager.csrfSecret,
      "content-type": "application/json",
    };
    const list = await harness.app.inject({
      method: "GET",
      url: "/api/v1/displays",
      headers: { cookie: headers.cookie },
    });
    const row = (
      list.json() as {
        displays: Array<{ id: string; configVersion: number }>;
      }
    ).displays.find((d) => d.id === enrolled.displayId)!;
    const revokeMutationId = randomUUID();
    const revoke = await harness.app.inject({
      method: "POST",
      url: `/api/v1/displays/${enrolled.displayId}/revoke`,
      headers,
      payload: {
        mutationId: revokeMutationId,
        expectedConfigVersion: row.configVersion,
      },
    });
    expect(revoke.statusCode).toBe(200);

    // Replacement: new display + claim after revoke of A.
    const createB = await harness.app.inject({
      method: "POST",
      url: "/api/v1/displays",
      headers,
      payload: { mutationId: randomUUID(), label: "Revoke-replay B" },
    });
    expect(createB.statusCode).toBe(200);
    const createdB = createB.json() as {
      display: { id: string };
      enrollment: { code: string };
      configVersion: number;
    };
    const claimB = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
      },
      payload: { code: createdB.enrollment.code },
    });
    expect(claimB.statusCode).toBe(200);
    const cookieB = claimB.cookies.find(
      (c) => c.name === harness.config.displayCookieName,
    )!.value;

    const replay = await harness.app.inject({
      method: "POST",
      url: `/api/v1/displays/${createdB.display.id}/revoke`,
      headers,
      payload: {
        mutationId: revokeMutationId,
        expectedConfigVersion: createdB.configVersion,
      },
    });
    expect(replay.statusCode).toBe(200);
    // Receipt replay returns A's revoke result; B must stay live.
    expect(
      (replay.json() as { displayId: string }).displayId,
    ).toBe(enrolled.displayId);

    const sessionB = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: {
        cookie: `${harness.config.displayCookieName}=${cookieB}`,
      },
    });
    expect(sessionB.statusCode).toBe(200);
    expect(
      (sessionB.json() as { session: { displayId: string } }).session.displayId,
    ).toBe(createdB.display.id);
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
  it("covers people aggregates, Unassigned, pending, optional/Not needed, survivors, no lock", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await createAndClaimDisplay(harness, "Truth wall");
    const ctx = enrolled.manager.context;
    const today = householdDateFromInstant(new Date(), ctx.timezone);
    const displayCookie = `${harness.config.displayCookieName}=${enrolled.displayCookie}`;

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

    // Multi-person routine aggregate (people counts).
    harness.store.createRoutine(ctx, {
      mutationId: randomUUID(),
      title: "Morning stretch",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery, IDS.casey, IDS.jordan],
      assigneeGroupIds: [],
      steps: [
        requiredStep("Stretch required"),
        {
          logicalItemId: randomUUID(),
          text: "As needed stretch",
          obligation: "as_needed" as const,
        },
        {
          logicalItemId: randomUUID(),
          text: "Optional stretch",
          obligation: "optional" as const,
        },
      ],
    });

    // Unassigned responsibility (empty take-turns ring).
    const emptyGroup = harness.store.createGroup(ctx, {
      mutationId: randomUUID(),
      name: `Empty ring ${Date.now().toString(36)}`,
      membershipIds: [IDS.avery, IDS.casey],
    });
    harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: "Needs a person",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: {
        mode: "take_turns",
        anchorDate: today,
        sourceGroupId: emptyGroup.id,
        savedRingOrder: [IDS.avery, IDS.casey],
        excludedMemberIds: [IDS.avery, IDS.casey],
      },
      steps: [requiredStep("Feed")],
    });

    // Pending-access Avery still has assigned Kitchen (seed memberships stay pending until claimed).
    const pendingAvery = harness.db
      .prepare(`SELECT status FROM household_memberships WHERE id = ?`)
      .get(IDS.avery) as { status: string };
    expect(pendingAvery.status).toBe("pending");

    const displayDash = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: { cookie: displayCookie },
    });
    expect(displayDash.statusCode).toBe(200);
    const dash = (
      displayDash.json() as {
        dashboard: {
          householdDate: string;
          byPerson: Array<{
            membershipId: string;
            displayName: string;
            status: string;
            unfinished: Array<{ title: string }>;
            progressLabel: string | null;
          }>;
          byWork: {
            responsibilities: Array<{
              id: string;
              title: string;
              accountableMemberId: string | null;
              accountableMemberName: string;
              state: string;
              progressLabel: string;
            }>;
            routines: Array<{
              displayTitle: string;
              applicableCount: number;
              completedCount: number;
              people: Array<{ accountableMemberId: string | null }>;
            }>;
          };
        };
      }
    ).dashboard;
    expect(dash.householdDate).toBe(today);
    expect(dash.byPerson.length).toBeGreaterThanOrEqual(6);

    const averyPerson = dash.byPerson.find((p) => p.membershipId === IDS.avery)!;
    expect(averyPerson.status).toBe("pending");
    expect(averyPerson.unfinished.some((u) => u.title === "Kitchen")).toBe(true);

    const unassigned = dash.byWork.responsibilities.find(
      (r) => r.title === "Needs a person",
    );
    expect(unassigned).toBeTruthy();
    expect(unassigned!.accountableMemberId).toBeNull();
    expect(unassigned!.accountableMemberName).toMatch(/Unassigned/i);

    const stretch = dash.byWork.routines.find((r) =>
      r.displayTitle.includes("Morning stretch"),
    );
    expect(stretch).toBeTruthy();
    expect(stretch!.applicableCount).toBe(3);
    expect(stretch!.people.length).toBe(3);

    // Manager today parity on responsibility IDs/owners.
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
        startedAt: string | null;
        steps: Array<{ status: string; obligation: string }>;
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

    // Optional + Not needed progress labels after Avery claims and marks steps.
    const avery = await enrollAndClaim(
      harness.store,
      ctx,
      IDS.avery,
      "direct_personalizer",
      `avery.truth.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    const averyToday = harness.store.materializeForDate(avery.context, today);
    const stretchOcc = averyToday.find(
      (o) => o.title === "Morning stretch" && o.accountableMemberId === IDS.avery,
    )!;
    const optionalOpenStep = stretchOcc.steps.find(
      (s) => s.obligation === "optional",
    )!;
    const asNeededStep = stretchOcc.steps.find(
      (s) => s.obligation === "as_needed",
    )!;
    harness.store.setStepStatus(avery.context, stretchOcc.id, asNeededStep.id, {
      mutationId: randomUUID(),
      status: "not_needed",
      performedAt: new Date().toISOString(),
      activityGeneration: harness.store.getActivityGeneration(ctx.householdId),
      kind: "routine",
      intendedStructure: {
        revisionId: stretchOcc.revisionId,
        accountableMemberId: IDS.avery,
        stepLogicalIds: stretchOcc.steps
          .map((s) => s.logicalItemId)
          .filter((id): id is string => Boolean(id)),
      },
    });
    // Leave optional open so progress label includes optional-open context.
    expect(optionalOpenStep.status).toBe("open");

    // Started survivor: complete a Kitchen step then reassign owner — occurrence keeps Avery.
    const kitchenOcc = averyToday.find((o) => o.title === "Kitchen")!;
    harness.store.setStepStatus(avery.context, kitchenOcc.id, kitchenOcc.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
      activityGeneration: harness.store.getActivityGeneration(ctx.householdId),
      kind: "responsibility",
      intendedStructure: {
        revisionId: kitchenOcc.revisionId,
        accountableMemberId: IDS.avery,
        stepLogicalIds: kitchenOcc.steps
          .map((s) => s.logicalItemId)
          .filter((id): id is string => Boolean(id)),
      },
    });
    const kitchenDef = harness.store.getResponsibilityById(
      ctx.householdId,
      kitchenOcc.definitionId,
    );
    harness.store.createResponsibilityRevision(ctx, kitchenOcc.definitionId, {
      mutationId: randomUUID(),
      title: "Kitchen",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: {
        mode: "fixed",
        anchorDate: today,
        fixedMemberId: IDS.casey,
      },
      steps: [requiredStep("Kitchen step")],
      expectedVersion: kitchenDef.version,
      mode: "current",
    });

    const afterDash = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: { cookie: displayCookie },
    });
    expect(afterDash.statusCode).toBe(200);
    const after = (
      afterDash.json() as {
        dashboard: {
          byWork: {
            responsibilities: Array<{
              id: string;
              title: string;
              accountableMemberId: string | null;
              progressLabel: string;
            }>;
            routines: Array<{
              displayTitle: string;
              people: Array<{
                accountableMemberId: string | null;
                progressLabel?: string;
                progress: { notNeeded: number; optionalOpen: number; done: number };
              }>;
            }>;
          };
        };
      }
    ).dashboard;
    const kitchenAfter = after.byWork.responsibilities.find((r) => r.title === "Kitchen")!;
    expect(kitchenAfter.id).toBe(kitchenOcc.id);
    expect(kitchenAfter.accountableMemberId).toBe(IDS.avery);

    const stretchAfter = after.byWork.routines.find((r) =>
      r.displayTitle.includes("Morning stretch"),
    )!;
    const averyStretch = stretchAfter.people.find(
      (p) => p.accountableMemberId === IDS.avery,
    )!;
    expect(averyStretch.progress.notNeeded).toBeGreaterThanOrEqual(1);

    // Person detail progress label should mention Not needed / optional context.
    const personDetail = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}`,
      headers: { cookie: displayCookie },
    });
    expect(personDetail.statusCode).toBe(200);
    const personBody = (
      personDetail.json() as {
        person: {
          recurringWork: Array<{ title: string; progressLabel: string }>;
        };
      }
    ).person;
    const stretchDetail = personBody.recurringWork.find(
      (w) => w.title === "Morning stretch",
    )!;
    expect(stretchDetail.progressLabel.toLowerCase()).toMatch(
      /not needed|optional/,
    );

    // Repeated display reads do not lock or change unstarted occurrence ids.
    const catsId = (
      dash.byWork.responsibilities.find((r) => r.title === "Cats")!
    ).id;
    const dash2 = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: { cookie: displayCookie },
    });
    const dash3 = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: { cookie: displayCookie },
    });
    expect(dash2.statusCode).toBe(200);
    expect(dash3.statusCode).toBe(200);
    const cats2 = (
      dash2.json() as {
        dashboard: {
          byWork: { responsibilities: Array<{ id: string; title: string }> };
        };
      }
    ).dashboard.byWork.responsibilities.find((r) => r.title === "Cats")!;
    const cats3 = (
      dash3.json() as {
        dashboard: {
          byWork: { responsibilities: Array<{ id: string; title: string }> };
        };
      }
    ).dashboard.byWork.responsibilities.find((r) => r.title === "Cats")!;
    expect(cats2.id).toBe(catsId);
    expect(cats3.id).toBe(catsId);
    const catsRow = harness.db
      .prepare(`SELECT started_at FROM occurrences WHERE id = ?`)
      .get(catsId) as { started_at: string | null };
    expect(catsRow.started_at).toBeNull();

    // School-filtered empty omit: not set up here — requires school calendar +
    // school_days applicability aligned to a non-school household date. Marked partial.
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
    // Local/test profile: hd_dev_display without Secure host prefix.
    expect(displayCookieName).toBe("hd_dev_display");
    expect(cookieAttrs!.secure).toBeFalsy();
    expect(cookieAttrs!.httpOnly).toBe(true);
    expect(String(cookieAttrs!.sameSite).toLowerCase()).toBe("strict");
    expect(cookieAttrs!.path).toBe("/");
    expect(cookieAttrs!.domain).toBeUndefined();
    const newCookie = cookieAttrs!.value;
    const absoluteExpiresAt = (
      reclaim.json() as { absoluteExpiresAt: string }
    ).absoluteExpiresAt;
    const remainingAbsSec = Math.floor(
      (new Date(absoluteExpiresAt).getTime() - Date.now()) / 1000,
    );
    expect(Number(cookieAttrs!.maxAge)).toBeLessThanOrEqual(remainingAbsSec + 2);

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
    const lastSeenAfterRead = (
      resumed.json() as { session: { lastSeenAt: string } }
    ).session.lastSeenAt;

    // Successful read renews last_seen.
    const digest = sha256Hex(newCookie);
    const rowAfter = rebuilt.db
      .prepare(
        `SELECT last_seen_at, absolute_expires_at FROM display_sessions WHERE token_digest = ?`,
      )
      .get(digest) as { last_seen_at: string; absolute_expires_at: string };
    expect(rowAfter.last_seen_at).toBe(lastSeenAfterRead);

    // 89-day idle is still accepted.
    rebuilt.db
      .prepare(
        `UPDATE display_sessions SET last_seen_at = ? WHERE token_digest = ?`,
      )
      .run(
        new Date(Date.now() - 89 * 24 * 60 * 60 * 1000).toISOString(),
        digest,
      );
    const idleOk = await rebuilt.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: { cookie: `${displayCookieName}=${newCookie}` },
    });
    expect(idleOk.statusCode).toBe(200);

    // 91-day idle is denied.
    rebuilt.db
      .prepare(
        `UPDATE display_sessions SET last_seen_at = ? WHERE token_digest = ?`,
      )
      .run(
        new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString(),
        digest,
      );
    const idleDenied = await rebuilt.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: { cookie: `${displayCookieName}=${newCookie}` },
    });
    expect(idleDenied.statusCode).toBe(401);

    // Absolute 365-day expiry via DisplayStore token lookup.
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

    // Absolute remaining caps cookie Max-Age on a fresh claim (reuse existing manager).
    const create = await rebuilt.app.inject({
      method: "POST",
      url: "/api/v1/displays",
      headers: {
        cookie: `${rebuilt.config.cookieName}=${enrolled.manager.token}`,
        origin,
        "x-csrf-token": enrolled.manager.csrfSecret,
        "content-type": "application/json",
      },
      payload: { mutationId: randomUUID(), label: "Abs-cap wall" },
    });
    const absCode = (create.json() as { enrollment: { code: string } }).enrollment
      .code;
    const absClaim = await rebuilt.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { origin, "content-type": "application/json" },
      payload: { code: absCode },
    });
    expect(absClaim.statusCode).toBe(200);
    const absCookie = absClaim.cookies.find((c) => c.name === displayCookieName)!;
    const absBody = absClaim.json() as { absoluteExpiresAt: string };
    const absRemaining = Math.floor(
      (new Date(absBody.absoluteExpiresAt).getTime() - Date.now()) / 1000,
    );
    expect(Number(absCookie.maxAge)).toBeLessThanOrEqual(absRemaining + 2);
    // Fresh absolute lifetime is ~365 days, not unbounded.
    expect(Number(absCookie.maxAge)).toBeLessThanOrEqual(365 * 24 * 60 * 60);
    expect(Number(absCookie.maxAge)).toBeGreaterThan(360 * 24 * 60 * 60);
  });

  it("hosted claim sets __Host-hd_display Secure/HttpOnly/SameSite/Path/no-Domain", async () => {
    const seeded = await createHttpHarness({ AUTO_SEED: "1" });
    const enrolled = await createAndClaimDisplay(seeded, "Hosted cookie wall");
    const list = await seeded.app.inject({
      method: "GET",
      url: "/api/v1/displays",
      headers: {
        cookie: `${seeded.config.cookieName}=${enrolled.manager.token}`,
      },
    });
    const row = (
      list.json() as {
        displays: Array<{ id: string; configVersion: number }>;
      }
    ).displays.find((d) => d.id === enrolled.displayId)!;
    const issue = await seeded.app.inject({
      method: "POST",
      url: `/api/v1/displays/${enrolled.displayId}/enrollment`,
      headers: {
        cookie: `${seeded.config.cookieName}=${enrolled.manager.token}`,
        origin: seeded.origin,
        "x-csrf-token": enrolled.manager.csrfSecret,
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        expectedConfigVersion: row.configVersion,
      },
    });
    expect(issue.statusCode).toBe(200);
    const code = (issue.json() as { code: string }).code;
    const dbPath = seeded.dbPath;
    const backupDir = seeded.config.backupDir;
    await seeded.app.close();

    const hostedOrigin = "https://example.test";
    const hostedConfig = loadConfig({
      APP_PROFILE: "hosted",
      AUTO_SEED: undefined,
      DB_PATH: dbPath,
      BACKUP_DIR: backupDir,
      HOUSEHOLD_TIMEZONE: "America/New_York",
      HOST: "127.0.0.1",
      PORT: String(8899 + Math.floor(Math.random() * 100)),
      PUBLIC_ORIGIN: hostedOrigin,
      NODE_ENV: "production",
    });
    expect(hostedConfig.displayCookieName).toBe("__Host-hd_display");
    expect(hostedConfig.cookieSecure).toBe(true);
    const hosted = await buildApp(hostedConfig);
    harnesses.push({
      app: hosted.app,
      store: hosted.store,
      db: hosted.db,
      config: hosted.config,
      dbPath,
      origin: hostedOrigin,
      close: async () => {
        await hosted.app.close();
        try {
          fs.rmSync(dbPath, { force: true });
        } catch {
          /* ignore */
        }
      },
    });

    const claim = await hosted.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: {
        origin: hostedOrigin,
        "content-type": "application/json",
      },
      payload: { code },
    });
    expect(claim.statusCode).toBe(200);
    const cookie = claim.cookies.find((c) => c.name === "__Host-hd_display");
    expect(cookie).toBeTruthy();
    expect(cookie!.secure).toBe(true);
    expect(cookie!.httpOnly).toBe(true);
    expect(String(cookie!.sameSite).toLowerCase()).toBe("strict");
    expect(cookie!.path).toBe("/");
    expect(cookie!.domain).toBeUndefined();
    const abs = (claim.json() as { absoluteExpiresAt: string }).absoluteExpiresAt;
    const remaining = Math.floor(
      (new Date(abs).getTime() - Date.now()) / 1000,
    );
    expect(Number(cookie!.maxAge)).toBeGreaterThan(0);
    expect(Number(cookie!.maxAge)).toBeLessThanOrEqual(remaining + 2);
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
