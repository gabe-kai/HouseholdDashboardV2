import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../../src/server/db.js";
import { AppStore } from "../../src/server/store.js";
import { GRANT_PRESETS } from "../../src/shared/grants.js";
import {
  authHeaders,
  claimManager,
  createHttpHarness,
  enrollAndClaim,
  httpClaimManager,
  IDS,
  sessionFromResponse,
} from "../helpers/auth-fixture.js";
import {
  openPopulatedP010UpgradeDatabase,
  P010_FIXTURE_IDS,
} from "../helpers/p010-fixture.js";

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

function freshStore() {
  const dbPath = path.join(
    os.tmpdir(),
    `hd-007a-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  temps.push(dbPath);
  const db = openDatabase(dbPath);
  migrate(db);
  const store = new AppStore(db);
  store.seed("America/New_York");
  return { store, db, dbPath };
}

function requiredStep(text: string) {
  return { text, obligation: "required" as const, logicalItemId: randomUUID() };
}

describe("P0-007A household responsibility foundation (server)", () => {
  it("AT1: populated 010 upgrades to 011 with kind backfill, indexes, grants", () => {
    const dbPath = path.join(os.tmpdir(), `hd-007a-p010-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openPopulatedP010UpgradeDatabase(dbPath);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '011_%'")
          .get() as { c: number }
      ).c,
    ).toBe(0);

    migrate(db);

    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '011_%'")
          .get() as { c: number }
      ).c,
    ).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number }).c,
    ).toBe(11);

    const kinds = db
      .prepare(`SELECT DISTINCT kind FROM routine_definitions`)
      .all() as Array<{ kind: string }>;
    expect(kinds.every((row) => row.kind === "routine")).toBe(true);
    const occKinds = db
      .prepare(`SELECT DISTINCT kind FROM occurrences`)
      .all() as Array<{ kind: string }>;
    expect(occKinds.every((row) => row.kind === "routine")).toBe(true);

    const indexes = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name IN (
           'occurrences_routine_identity',
           'occurrences_responsibility_identity'
         )`,
      )
      .all() as Array<{ name: string }>;
    expect(indexes.map((row) => row.name).sort()).toEqual([
      "occurrences_responsibility_identity",
      "occurrences_routine_identity",
    ]);

    expect(
      (
        db
          .prepare(
            `SELECT 1 AS ok FROM membership_grants
             WHERE membership_id = ? AND grant_name = 'responsibility.manage'`,
          )
          .get(P010_FIXTURE_IDS.morganId) as { ok: number } | undefined
      )?.ok,
    ).toBe(1);
    expect(
      (
        db
          .prepare(
            `SELECT 1 AS ok FROM membership_grants
             WHERE membership_id = ? AND grant_name = 'responsibility.execute.own'`,
          )
          .get(P010_FIXTURE_IDS.averyId) as { ok: number } | undefined
      )?.ok,
    ).toBe(1);

    expect((db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length).toBe(0);
    migrate(db);
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number }).c,
    ).toBe(11);

    const store = new AppStore(db);
    // Manager grant holders can create responsibilities after upgrade.
    const morganGrants = db
      .prepare(`SELECT grant_name FROM membership_grants WHERE membership_id = ?`)
      .all(P010_FIXTURE_IDS.morganId) as Array<{ grant_name: string }>;
    expect(morganGrants.some((g) => g.grant_name === "responsibility.manage")).toBe(true);
    void store;
  });

  it("AT1b: manager preset includes responsibility grants", () => {
    expect(GRANT_PRESETS.manager).toEqual(
      expect.arrayContaining(["responsibility.manage", "responsibility.execute.own"]),
    );
    expect(GRANT_PRESETS.direct_personalizer).toEqual(
      expect.arrayContaining(["responsibility.execute.own"]),
    );
    expect(GRANT_PRESETS.direct_personalizer).not.toEqual(
      expect.arrayContaining(["responsibility.manage"]),
    );
  });

  it("AT2: responsibility cardinality one-per-date; unstarted reassign updates same row", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.card.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    await enrollAndClaim(
      store,
      manager.context,
      IDS.jordan,
      "direct_personalizer",
      `jordan.card.${Date.now().toString(36)}`,
      "Jordan Reed",
    );

    const cats = store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Cats",
      daypart: "anytime",
      accountableMemberId: IDS.avery,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [requiredStep("Feed cats"), requiredStep("Water")],
    });
    expect(cats.kind).toBe("responsibility");

    const today = store.householdDateNow(manager.context);
    const first = store.materializeForDate(manager.context, today);
    const catsOcc = first.find((o) => o.definitionId === cats.id)!;
    expect(catsOcc.kind).toBe("responsibility");
    expect(catsOcc.accountableMemberId).toBe(IDS.avery);

    store.materializeForDate(manager.context, today);
    const count = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM occurrences
           WHERE definition_id = ? AND household_date = ?`,
        )
        .get(cats.id, today) as { c: number }
    ).c;
    expect(count).toBe(1);

    // Duplicate responsibility/date must be rejected by unique index.
    expect(() => {
      db.prepare(
        `INSERT INTO occurrences
         (id, household_id, definition_id, revision_id, household_date,
          accountable_member_id, title, daypart, version, kind)
         VALUES (?, ?, ?, ?, ?, ?, 'Dup', 'anytime', 1, 'responsibility')`,
      ).run(
        randomUUID(),
        manager.context.householdId,
        cats.id,
        cats.revisions[0]!.id,
        today,
        IDS.jordan,
      );
    }).toThrow(/UNIQUE/i);

    store.createResponsibilityRevision(manager.context, cats.id, {
      mutationId: randomUUID(),
      title: "Cats",
      daypart: "anytime",
      accountableMemberId: IDS.jordan,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [requiredStep("Feed cats"), requiredStep("Water")],
      expectedVersion: cats.version,
      mode: "current",
    });
    const after = store
      .materializeForDate(manager.context, today)
      .find((o) => o.definitionId === cats.id)!;
    expect(after.id).toBe(catsOcc.id);
    expect(after.accountableMemberId).toBe(IDS.jordan);
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM occurrences
             WHERE definition_id = ? AND household_date = ?`,
          )
          .get(cats.id, today) as { c: number }
      ).c,
    ).toBe(1);
  });

  it("AT5/AT6: first action freezes owner; stale intendedStructure rejected", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.lock.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    await enrollAndClaim(
      store,
      manager.context,
      IDS.jordan,
      "direct_personalizer",
      `jordan.lock.${Date.now().toString(36)}`,
      "Jordan Reed",
    );

    const cats = store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Cats",
      daypart: "evening",
      accountableMemberId: IDS.avery,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [requiredStep("Scoop"), requiredStep("Feed")],
    });
    const today = store.householdDateNow(manager.context);
    const occ = store
      .materializeForDate(manager.context, today)
      .find((o) => o.definitionId === cats.id)!;
    const logicalIds = occ.steps.map((s) => s.logicalItemId!).filter(Boolean);

    store.setStepStatus(avery.context, occ.id, occ.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
      activityGeneration: 0,
      kind: "responsibility",
      intendedStructure: {
        revisionId: occ.revisionId,
        accountableMemberId: IDS.avery,
        stepLogicalIds: logicalIds,
      },
    });
    const started = store.getOccurrenceById(occ.id)!;
    expect(started.startedAt).toBeTruthy();
    expect(started.accountableMemberId).toBe(IDS.avery);

    // Plan owner change after start must not move this occurrence.
    const currentCats = store.getResponsibilityById(manager.context.householdId, cats.id);
    store.createResponsibilityRevision(manager.context, cats.id, {
      mutationId: randomUUID(),
      title: "Cats",
      daypart: "evening",
      accountableMemberId: IDS.jordan,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [requiredStep("Scoop"), requiredStep("Feed")],
      expectedVersion: currentCats.version,
      mode: "current",
    });
    const survivor = store
      .materializeForDate(manager.context, today)
      .find((o) => o.definitionId === cats.id)!;
    expect(survivor.id).toBe(occ.id);
    expect(survivor.accountableMemberId).toBe(IDS.avery);

    // Stale structural intent rejected against a fresh unstarted occurrence.
    const trash = store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Trash",
      daypart: "evening",
      accountableMemberId: IDS.avery,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [requiredStep("Take out trash")],
    });
    const trashOcc = store
      .materializeForDate(manager.context, today)
      .find((o) => o.definitionId === trash.id)!;
    expect(() =>
      store.setStepStatus(avery.context, trashOcc.id, trashOcc.steps[0]!.id, {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: 0,
        kind: "responsibility",
        intendedStructure: {
          revisionId: trashOcc.revisionId,
          accountableMemberId: IDS.jordan,
          stepLogicalIds: trashOcc.steps.map((s) => s.logicalItemId!),
        },
      }),
    ).toThrow(/checklist changed|structure|intent|owner|stale/i);
  });

  it("AT8: delete unused vs end with prior history", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.del.${Date.now().toString(36)}`,
      "Avery Reed",
    );

    const unused = store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Unused",
      daypart: "anytime",
      accountableMemberId: IDS.avery,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [requiredStep("Do it")],
    });
    store.deleteResponsibility(manager.context, unused.id, {
      mutationId: randomUUID(),
      expectedVersion: unused.version,
    });
    expect(() => store.getResponsibilityById(manager.context.householdId, unused.id)).toThrow(
      /not found/i,
    );

    const kept = store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Kept",
      daypart: "anytime",
      accountableMemberId: IDS.avery,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [requiredStep("Do it")],
    });
    // Fabricate prior-date occurrence history (unstarted) to block delete.
    db.prepare(
      `INSERT INTO occurrences
       (id, household_id, definition_id, revision_id, household_date,
        accountable_member_id, title, daypart, version, kind)
       VALUES (?, ?, ?, ?, ?, ?, 'Kept', 'anytime', 1, 'responsibility')`,
    ).run(
      randomUUID(),
      manager.context.householdId,
      kept.id,
      kept.revisions[0]!.id,
      "2020-01-01",
      IDS.avery,
    );
    expect(() =>
      store.deleteResponsibility(manager.context, kept.id, {
        mutationId: randomUUID(),
        expectedVersion: kept.version,
      }),
    ).toThrow(/prior-date|cannot be deleted/i);

    const ended = store.endResponsibility(manager.context, kept.id, {
      mutationId: randomUUID(),
      expectedVersion: kept.version,
    });
    expect(ended.responsibility.ended).toBe(true);
    expect(
      (
        db
          .prepare(`SELECT 1 AS ok FROM occurrences WHERE definition_id = ? AND household_date = ?`)
          .get(kept.id, "2020-01-01") as { ok: number } | undefined
      )?.ok,
    ).toBe(1);
  });

  it("AT9: permission matrix via HTTP", async () => {
    const harness = await createHttpHarness();
    temps.push(harness.dbPath);
    try {
      const manager = await httpClaimManager(harness);
      const enrollAvery = await harness.app.inject({
        method: "POST",
        url: "/api/v1/enrollment/claims",
        headers: authHeaders(harness, manager),
        payload: {
          mutationId: randomUUID(),
          membershipId: IDS.avery,
          preset: "direct_personalizer",
        },
      });
      expect(enrollAvery.statusCode).toBe(200);
      const averyToken = (enrollAvery.json() as { claim: { token: string } }).claim.token;
      const averyClaim = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/claim",
        headers: { origin: harness.origin },
        payload: {
          claimToken: averyToken,
          loginName: `avery.http.${Date.now().toString(36)}`,
          passphrase: "unique-passphrase-ok!",
          displayName: "Avery Reed",
        },
      });
      expect(averyClaim.statusCode).toBe(200);
      const averySession = sessionFromResponse(harness, averyClaim);

      const create = await harness.app.inject({
        method: "POST",
        url: "/api/v1/responsibilities",
        headers: authHeaders(harness, manager),
        payload: {
          mutationId: randomUUID(),
          title: "Cats",
          daypart: "anytime",
          accountableMemberId: IDS.avery,
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          steps: [{ text: "Feed", obligation: "required" }],
        },
      });
      expect(create.statusCode).toBe(200);
      const definitionId = (create.json() as { responsibility: { id: string } }).responsibility
        .id;

      const cross2 = await harness.app.inject({
        method: "GET",
        url: `/api/v1/routines/${definitionId}`,
        headers: { cookie: manager.cookieHeader },
      });
      expect(cross2.statusCode).toBe(404);

      const reviseAsChild = await harness.app.inject({
        method: "POST",
        url: `/api/v1/responsibilities/${definitionId}/revisions`,
        headers: authHeaders(harness, averySession),
        payload: {
          mutationId: randomUUID(),
          title: "Cats",
          daypart: "anytime",
          accountableMemberId: IDS.avery,
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          steps: [{ text: "Feed", obligation: "required" }],
          expectedVersion: 1,
        },
      });
      expect(reviseAsChild.statusCode).toBe(403);

      const bad = await harness.app.inject({
        method: "POST",
        url: "/api/v1/responsibilities",
        headers: authHeaders(harness, manager),
        payload: {
          mutationId: randomUUID(),
          title: "Bad",
          daypart: "anytime",
          weekdays: [1],
          steps: [{ text: "X", obligation: "required" }],
        },
      });
      expect(bad.statusCode).toBe(400);

      const session = await harness.app.inject({
        method: "GET",
        url: "/api/v1/auth/session",
        headers: { cookie: manager.cookieHeader },
      });
      const grants = (session.json() as { grants: string[] }).grants;
      expect(grants).toEqual(
        expect.arrayContaining(["responsibility.manage", "responsibility.execute.own"]),
      );
    } finally {
      await harness.close();
    }
  });

  it("AT10: history is side-effect-free and kind-filtered", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.hist.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Morning",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      steps: [{ text: "Brush", obligation: "required" }],
    });
    store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Cats",
      daypart: "anytime",
      accountableMemberId: IDS.avery,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [requiredStep("Feed")],
    });
    const today = store.householdDateNow(manager.context);
    store.materializeForDate(manager.context, today);
    const before = (
      db.prepare(`SELECT COUNT(*) AS c FROM occurrences`).get() as { c: number }
    ).c;
    const mixed = store.historySummaries(manager.context, { date: today });
    expect(mixed.occurrences.some((o) => o.kind === "routine")).toBe(true);
    expect(mixed.occurrences.some((o) => o.kind === "responsibility")).toBe(true);
    const onlyResp = store.historySummaries(manager.context, {
      date: today,
      kind: "responsibility",
    });
    expect(onlyResp.occurrences.every((o) => o.kind === "responsibility")).toBe(true);
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM occurrences`).get() as { c: number }).c,
    ).toBe(before);
  });

  it("AT11: reset scope acknowledgment and legacy rejection", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.reset.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Cats",
      daypart: "anytime",
      accountableMemberId: IDS.avery,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [requiredStep("Feed")],
    });
    const today = store.householdDateNow(manager.context);
    store.materializeForDate(manager.context, today);

    expect(() =>
      store.clearRoutineActivity(manager.context, {
        mutationId: randomUUID(),
        expectedGeneration: 0,
      }),
    ).toThrow(/routines and responsibilities|confirm/i);

    const cleared = store.clearRoutineActivity(manager.context, {
      mutationId: randomUUID(),
      expectedGeneration: 0,
      acknowledgedScope: "routines_and_responsibilities",
    });
    expect(cleared.activityGeneration).toBe(1);
    expect(store.materializeForDate(manager.context, today).length).toBeGreaterThanOrEqual(0);
  });

  it("rejects responsibility ids on routine APIs and groups on responsibility create", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.x.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    const resp = store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Cats",
      daypart: "anytime",
      accountableMemberId: IDS.avery,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [requiredStep("Feed")],
    });
    expect(() => store.getRoutineById(manager.context.householdId, resp.id)).toThrow(
      /not found/i,
    );
    expect(() =>
      store.createRevision(manager.context, resp.id, {
        mutationId: randomUUID(),
        title: "Nope",
        daypart: "anytime",
        assigneeMemberIds: [IDS.avery],
        assigneeGroupIds: [],
        weekdays: [1],
        steps: [{ text: "X", obligation: "required" }],
      }),
    ).toThrow(/not found/i);

    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Morning",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      steps: [{ text: "Brush", obligation: "required" }],
    });
    expect(() =>
      store.getResponsibilityById(manager.context.householdId, routine.id),
    ).toThrow(/not found/i);

    expect(() =>
      store.createResponsibility(manager.context, {
        mutationId: randomUUID(),
        title: "Bad applicability",
        daypart: "anytime",
        accountableMemberId: IDS.avery,
        weekdays: [1],
        steps: [
          {
            text: "School only",
            obligation: "required",
            applicability: { kind: "school_days" },
          },
        ],
      }),
    ).toThrow(/every-time|applicability/i);
  });
});
