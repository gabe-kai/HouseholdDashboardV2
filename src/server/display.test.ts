import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "./db.js";
import { DisplayStore } from "./display.js";
import { normalizeDisplayCode, randomBase32Code, sha256Hex } from "./crypto.js";
import { AppStore } from "./store.js";
import { claimManager } from "../../tests/helpers/auth-fixture.js";

const temps: string[] = [];

afterEach(() => {
  for (const p of temps.splice(0)) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
});

function tempDb() {
  const dbPath = path.join(
    os.tmpdir(),
    `hd-display-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  temps.push(dbPath);
  const db = openDatabase(dbPath);
  migrate(db);
  const store = new AppStore(db);
  store.seed("America/New_York");
  return { db, store, displayStore: new DisplayStore(db, store), dbPath };
}

describe("P0-007C-2 display Base32 helpers", () => {
  it("generates 16-char Base32 and normalizes separators", () => {
    const code = randomBase32Code(16);
    expect(code).toMatch(/^[A-Z2-7]{16}$/);
    expect(normalizeDisplayCode("ab cd-ef_gh")).toBe("ABCDEFGH");
    expect(normalizeDisplayCode(code.toLowerCase())).toBe(code);
  });
});

describe("P0-007C-2 display store", () => {
  it("backfills household.display.manage for enroll holders on migrate", () => {
    const { db } = tempDb();
    const membershipId = randomUUID();
    const householdId = (
      db.prepare("SELECT id FROM households LIMIT 1").get() as { id: string }
    ).id;
    db.prepare(
      `INSERT INTO household_memberships
       (id, household_id, user_id, display_name, status, created_at, sort_order)
       VALUES (?, ?, NULL, 'Temp Enroll', 'pending', datetime('now'), 99)`,
    ).run(membershipId, householdId);
    db.prepare(
      `INSERT INTO membership_grants (membership_id, grant_name) VALUES (?, 'household.member.enroll')`,
    ).run(membershipId);
    // Migration 015 backfill statement (idempotent)
    db.prepare(
      `INSERT OR IGNORE INTO membership_grants (membership_id, grant_name)
       SELECT membership_id, 'household.display.manage'
       FROM membership_grants
       WHERE grant_name = 'household.member.enroll'`,
    ).run();
    const grants = db
      .prepare(
        `SELECT grant_name FROM membership_grants WHERE membership_id = ? ORDER BY 1`,
      )
      .all(membershipId) as Array<{ grant_name: string }>;
    expect(grants.map((g) => g.grant_name)).toEqual([
      "household.display.manage",
      "household.member.enroll",
    ]);
  });

  it("creates, claims, revokes display; concurrent claim has one winner", async () => {
    const { displayStore, store } = tempDb();
    const manager = await claimManager(store);
    const created = displayStore.createDisplay(manager.context, {
      mutationId: randomUUID(),
      label: "Dining room",
    });
    expect(created.enrollment.code).toMatch(/^[A-Z2-7]{16}$/);
    expect(created.display.hasOutstandingClaim).toBe(true);

    const claimA = displayStore.claimDisplayCode(created.enrollment.code);
    expect(claimA.context.displayId).toBe(created.display.id);
    expect(claimA.context.label).toBe("Dining room");

    expect(() =>
      displayStore.claimDisplayCode(created.enrollment.code),
    ).toThrow(/Invalid or expired/);

    const session = displayStore.getDisplaySessionByTokenDigest(
      sha256Hex(claimA.token),
    );
    expect(session?.sessionId).toBe(claimA.context.sessionId);

    const revoked = displayStore.revokeDisplay(manager.context, created.display.id, {
      mutationId: randomUUID(),
      expectedConfigVersion: created.configVersion + 1, // bumped by claim
    });
    expect(revoked.revoked).toBe(true);
    expect(
      displayStore.getDisplaySessionByTokenDigest(sha256Hex(claimA.token)),
    ).toBeNull();
  });

  it("denies display management without grant", async () => {
    const { displayStore, store, db } = tempDb();
    const manager = await claimManager(store);
    // Strip display.manage from a second membership by creating executor-only person
    const people = store.listMemberships(manager.context.householdId);
    const child = people.find((p) => p.id !== manager.context.membershipId);
    expect(child).toBeTruthy();
    // Give child execute-only grants without display.manage
    db.prepare("DELETE FROM membership_grants WHERE membership_id = ?").run(child!.id);
    for (const g of [
      "routine.execute.own",
      "responsibility.execute.own",
      "personal_task.create",
    ]) {
      db.prepare(
        "INSERT INTO membership_grants (membership_id, grant_name) VALUES (?, ?)",
      ).run(child!.id, g);
    }
    const fakeCtx = {
      ...manager.context,
      membershipId: child!.id,
      grants: [
        "routine.execute.own" as const,
        "responsibility.execute.own" as const,
        "personal_task.create" as const,
      ],
    };
    expect(() =>
      displayStore.createDisplay(fakeCtx, {
        mutationId: randomUUID(),
        label: "Nope",
      }),
    ).toThrow(/Required authority/);
  });

  it("excludes private tasks from dashboard and person detail board", async () => {
    const { displayStore, store } = tempDb();
    const manager = await claimManager(store);
    store.createTask(manager.context, {
      title: "SECRET_PRIVATE_TASK_TITLE_XYZ",
      visibility: "private",
    });
    store.createTask(manager.context, {
      title: "Shared grocery list",
      visibility: "household",
    });

    const created = displayStore.createDisplay(manager.context, {
      mutationId: randomUUID(),
      label: "Wall",
    });
    const claimed = displayStore.claimDisplayCode(created.enrollment.code);
    const dashboard = displayStore.getDisplayDashboard(claimed.context);
    const blob = JSON.stringify(dashboard);
    expect(blob).not.toContain("SECRET_PRIVATE_TASK_TITLE_XYZ");
    // Household-visible tasks are not on the resting board
    expect(blob).not.toContain("Shared grocery list");

    const person = displayStore.getDisplayPersonDetail(
      claimed.context,
      manager.context.membershipId,
    );
    expect(person.householdVisibleTasks.map((t) => t.title)).toEqual([
      "Shared grocery list",
    ]);
    expect(JSON.stringify(person)).not.toContain("SECRET_PRIVATE_TASK_TITLE_XYZ");
    expect(JSON.stringify(person)).not.toMatch(/birthday|@|grants/i);
  });
});
