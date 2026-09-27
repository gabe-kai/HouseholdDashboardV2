import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  claimManager,
  createHttpHarness,
  type HttpHarness,
} from "../../tests/helpers/auth-fixture.js";
import {
  openPopulatedP014UpgradeDatabase,
  P014_FIXTURE_IDS,
} from "../helpers/p014-fixture.js";
import { migrate, openDatabase } from "../../src/server/db.js";
import { evaluateMembership } from "../../src/server/scripts/cleanup-fixtures.js";

const harnesses: HttpHarness[] = [];
const temps: string[] = [];

afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    await h.close();
  }
  for (const file of temps.splice(0)) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("P0-007C-2 display HTTP principal boundaries", () => {
  it("rejects display endpoints with member cookie and member endpoints with display cookie", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
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
      payload: { mutationId: randomUUID(), label: "Kitchen wall" },
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
        origin,
        "content-type": "application/json",
      },
      payload: { code: created.enrollment.code },
    });
    expect(claimRes.statusCode).toBe(200);
    const displayCookie = claimRes.cookies.find(
      (c) => c.name === harness.config.displayCookieName,
    );
    expect(displayCookie?.value).toBeTruthy();

    // Display cookie cannot read member Today
    const todayDenied = await harness.app.inject({
      method: "GET",
      url: "/api/v1/today",
      headers: {
        cookie: `${harness.config.displayCookieName}=${displayCookie!.value}`,
      },
    });
    expect(todayDenied.statusCode).toBe(401);

    // Member cookie cannot read display dashboard
    const dashDenied = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: {
        cookie: `${harness.config.cookieName}=${manager.token}`,
      },
    });
    expect(dashDenied.statusCode).toBe(401);

    // Mixed cookies: display route uses display only
    const dashOk = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: {
        cookie: `${harness.config.cookieName}=${manager.token}; ${harness.config.displayCookieName}=${displayCookie!.value}`,
      },
    });
    expect(dashOk.statusCode).toBe(200);
    expect(dashOk.headers["cache-control"]).toBe("no-store");

    // Claim while signed in as human → 409
    const conflict = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: {
        origin,
        cookie: `${harness.config.cookieName}=${manager.token}`,
        "content-type": "application/json",
      },
      payload: { code: "AAAAAAAAAAAAAAA" },
    });
    expect(conflict.statusCode).toBe(409);
  });
});

describe("P0-007C-2 through-014 upgrade (AT1)", () => {
  it("AT1: populated through-014 upgrades through 015 with display grant backfill", () => {
    const dbPath = path.join(os.tmpdir(), `hd-007c2-p014-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openPopulatedP014UpgradeDatabase(dbPath);

    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '015_%'")
          .get() as { c: number }
      ).c,
    ).toBe(0);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '014_%'")
          .get() as { c: number }
      ).c,
    ).toBe(1);
    expect(
      (
        db
          .prepare(`SELECT title FROM personal_tasks WHERE id = ?`)
          .get(P014_FIXTURE_IDS.privateTaskId) as { title: string }
      ).title,
    ).toBe("PRIVATE_TASK_SECRET_TITLE");
    expect(
      (
        db
          .prepare(`SELECT 1 AS ok FROM auth_sessions WHERE id = ?`)
          .get(P014_FIXTURE_IDS.memberSessionId) as { ok: number } | undefined
      )?.ok,
    ).toBe(1);

    const preEnrollGrants = (
      db
        .prepare(`SELECT grant_name FROM membership_grants WHERE membership_id = ?`)
        .all(P014_FIXTURE_IDS.morganId) as Array<{ grant_name: string }>
    ).map((row) => row.grant_name);
    expect(preEnrollGrants).toContain("household.member.enroll");
    expect(preEnrollGrants).not.toContain("household.display.manage");

    const averyPre = (
      db
        .prepare(`SELECT grant_name FROM membership_grants WHERE membership_id = ?`)
        .all(P014_FIXTURE_IDS.averyId) as Array<{ grant_name: string }>
    ).map((row) => row.grant_name);
    expect(averyPre).not.toContain("household.member.enroll");
    expect(averyPre).not.toContain("household.display.manage");

    const catsId = P014_FIXTURE_IDS.catsOccStartedId;
    migrate(db);

    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '015_%'")
          .get() as { c: number }
      ).c,
    ).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number }).c,
    ).toBe(15);

    const morganGrants = (
      db
        .prepare(`SELECT grant_name FROM membership_grants WHERE membership_id = ?`)
        .all(P014_FIXTURE_IDS.morganId) as Array<{ grant_name: string }>
    ).map((row) => row.grant_name);
    expect(morganGrants).toContain("household.display.manage");

    const averyPost = (
      db
        .prepare(`SELECT grant_name FROM membership_grants WHERE membership_id = ?`)
        .all(P014_FIXTURE_IDS.averyId) as Array<{ grant_name: string }>
    ).map((row) => row.grant_name);
    expect(averyPost).not.toContain("household.display.manage");

    expect(
      (
        db
          .prepare(`SELECT title FROM personal_tasks WHERE id = ?`)
          .get(P014_FIXTURE_IDS.privateTaskId) as { title: string }
      ).title,
    ).toBe("PRIVATE_TASK_SECRET_TITLE");
    expect(
      (
        db
          .prepare(`SELECT 1 AS ok FROM occurrences WHERE id = ?`)
          .get(catsId) as { ok: number } | undefined
      )?.ok,
    ).toBe(1);
    expect(
      (
        db
          .prepare(`SELECT 1 AS ok FROM auth_sessions WHERE id = ?`)
          .get(P014_FIXTURE_IDS.memberSessionId) as { ok: number } | undefined
      )?.ok,
    ).toBe(1);
    expect(
      (
        db
          .prepare(`SELECT activity_generation FROM households WHERE id = ?`)
          .get(P014_FIXTURE_IDS.householdId) as { activity_generation: number }
      ).activity_generation,
    ).toBe(3);

    expect((db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length).toBe(0);

    migrate(db);
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number }).c,
    ).toBe(15);

    const displayId = randomUUID();
    db.prepare(
      `INSERT INTO household_displays
         (id, household_id, label, created_by_membership_id, created_at, config_version, revoked_at)
       VALUES (?, ?, 'Upgrade wall', ?, ?, 1, NULL)`,
    ).run(
      displayId,
      P014_FIXTURE_IDS.householdId,
      P014_FIXTURE_IDS.morganId,
      new Date().toISOString(),
    );

    const evaluation = evaluateMembership(
      db,
      P014_FIXTURE_IDS.morganId,
      P014_FIXTURE_IDS.householdId,
    );
    expect(evaluation.blockers).toContain("has_display_authorship");

    db.close();
    const restarted = openDatabase(dbPath);
    migrate(restarted);
    expect(
      (
        restarted
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '015_%'")
          .get() as { c: number }
      ).c,
    ).toBe(1);
    restarted.close();
  });
});
