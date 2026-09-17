import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addHouseholdDays } from "../../src/domain/time.js";
import { migrate, openDatabase } from "../../src/server/db.js";
import { AppStore } from "../../src/server/store.js";
import {
  authHeaders,
  claimManager,
  createHttpHarness,
  enrollAndClaim,
  httpClaimManager,
  IDS,
  PASSPHRASE,
  sessionFromResponse,
} from "../helpers/auth-fixture.js";
import { openPopulatedP004BUpgradeDatabase, P004B_FIXTURE_IDS } from "../helpers/p004b-fixture.js";
import { openPopulatedP008UpgradeDatabase, P008_FIXTURE_IDS } from "../helpers/p008-fixture.js";

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
    `hd-006b-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  temps.push(dbPath);
  const db = openDatabase(dbPath);
  migrate(db);
  const store = new AppStore(db);
  store.seed("America/New_York");
  return { store, db, dbPath };
}

function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const day = utc.getUTCDay();
  return day === 0 ? 7 : day;
}

function yearPayload(
  startDate: string,
  endDate: string,
  usualWeekdays: number[],
  exceptions: Array<{ name: string; startDate: string; endDate: string }> = [],
) {
  return { startDate, endDate, usualWeekdays, exceptions };
}

describe("P0-006B contextual applicability", () => {
  it("AT1: through-008 fixture upgrades with Every-time default and schedule grant backfill", () => {
    const dbPath = path.join(os.tmpdir(), `hd-006b-p008-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openPopulatedP008UpgradeDatabase(dbPath);

    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '009_%'")
          .get() as { c: number }
      ).c,
    ).toBe(0);
    expect(
      (
        db
          .prepare(
            `SELECT 1 AS ok FROM membership_grants
             WHERE membership_id = ? AND grant_name = 'household.schedule.manage'`,
          )
          .get(P008_FIXTURE_IDS.morganId) as { ok: number } | undefined
      )?.ok,
    ).toBeUndefined();

    migrate(db);
    migrate(db); // idempotent re-apply

    const step = db
      .prepare(
        `SELECT applicability_json FROM revision_steps WHERE revision_id = ? LIMIT 1`,
      )
      .get(P008_FIXTURE_IDS.revisionId) as { applicability_json: string };
    expect(JSON.parse(step.applicability_json)).toEqual({ kind: "every_time" });

    const personal = db
      .prepare(
        `SELECT applicability_json FROM personal_additions WHERE personal_revision_id = ? LIMIT 1`,
      )
      .get(P008_FIXTURE_IDS.personalRevisionId) as { applicability_json: string };
    expect(JSON.parse(personal.applicability_json)).toEqual({ kind: "every_time" });

    const proposal = db
      .prepare(
        `SELECT applicability_json FROM routine_proposals WHERE id = ?`,
      )
      .get(P008_FIXTURE_IDS.proposalPendingId) as { applicability_json: string };
    expect(JSON.parse(proposal.applicability_json)).toEqual({ kind: "every_time" });

    const morganGrant = db
      .prepare(
        `SELECT 1 AS ok FROM membership_grants
         WHERE membership_id = ? AND grant_name = 'household.schedule.manage'`,
      )
      .get(P008_FIXTURE_IDS.morganId) as { ok: number } | undefined;
    expect(morganGrant?.ok).toBe(1);

    const averyGrant = db
      .prepare(
        `SELECT 1 AS ok FROM membership_grants
         WHERE membership_id = ? AND grant_name = 'household.schedule.manage'`,
      )
      .get(P008_FIXTURE_IDS.averyId) as { ok: number } | undefined;
    expect(averyGrant?.ok).toBeUndefined();

    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM school_calendar_editions")
          .get() as { c: number }
      ).c,
    ).toBe(0);

    const pastOcc = db
      .prepare(`SELECT id, started_at FROM occurrences WHERE id = ?`)
      .get(P008_FIXTURE_IDS.occurrencePastId) as { id: string; started_at: string | null };
    expect(pastOcc.id).toBe(P008_FIXTURE_IDS.occurrencePastId);
    const started = db
      .prepare(`SELECT started_at FROM occurrences WHERE id = ?`)
      .get(P008_FIXTURE_IDS.occurrenceStartedId) as { started_at: string | null };
    expect(started.started_at).toBeTruthy();
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) AS c FROM routine_mutation_receipts WHERE mutation_id = ?`)
          .get(P008_FIXTURE_IDS.receiptMutationId) as { c: number }
      ).c,
    ).toBe(1);

    expect(db.pragma("foreign_key_check") as unknown[]).toEqual([]);
  });

  it("AT1: P004B populated baseline also upgrades with Every-time defaults", () => {
    const dbPath = path.join(os.tmpdir(), `hd-006b-p004b-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openPopulatedP004BUpgradeDatabase(dbPath);
    migrate(db);

    const step = db
      .prepare(
        `SELECT applicability_json FROM revision_steps WHERE revision_id = ? LIMIT 1`,
      )
      .get(P004B_FIXTURE_IDS.revisionId) as { applicability_json: string };
    expect(JSON.parse(step.applicability_json)).toEqual({ kind: "every_time" });
    expect(db.pragma("foreign_key_check") as unknown[]).toEqual([]);
  });

  it("manager preset includes schedule.manage after seed", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    expect(manager.context.grants).toContain("household.schedule.manage");
  });

  it("AT2/AT3: school nights first-day, Saturday school Friday night, yesterday freeze", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.${Date.now().toString(36)}`,
      "Avery Reed",
    );

    const today = store.householdDateNow(manager.context);
    // First school day = next weekday at least tomorrow so the eve-before is materializable.
    let firstSchool = addHouseholdDays(today, 1);
    while (isoWeekday(firstSchool) > 5) {
      firstSchool = addHouseholdDays(firstSchool, 1);
    }
    const eveBeforeFirst = addHouseholdDays(firstSchool, -1);

    store.saveSchoolCalendar(manager.context, {
      mutationId: randomUUID(),
      expectedVersion: 0,
      years: [yearPayload(firstSchool, "2027-06-15", [1, 2, 3, 4, 5])],
    });

    store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Bedtime",
      daypart: "bedtime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      steps: [
        {
          text: "Pack school bag",
          obligation: "required",
          applicability: { kind: "school_nights" },
        },
        { text: "Brush teeth", obligation: "required", applicability: { kind: "every_time" } },
      ],
    });

    const eveRows = store.materializeForDate(manager.context, eveBeforeFirst);
    const bedFirst = eveRows.find((o) => o.title === "Bedtime");
    expect(bedFirst, `expected Bedtime on ${eveBeforeFirst} before ${firstSchool}`).toBeTruthy();
    expect(bedFirst!.steps.some((s) => /Pack school bag/i.test(s.text))).toBe(true);

    // Unusual Saturday school → Friday night includes school_nights.
    store.saveSchoolCalendar(manager.context, {
      mutationId: randomUUID(),
      expectedVersion: 1,
      years: [yearPayload("2026-01-01", "2027-12-31", [1, 2, 3, 4, 5, 6])],
    });
    let friday = today;
    while (isoWeekday(friday) !== 5) {
      friday = addHouseholdDays(friday, 1);
    }
    const fridayRows = store.materializeForDate(manager.context, friday);
    expect(
      fridayRows
        .find((o) => o.title === "Bedtime")
        ?.steps.some((s) => /Pack school bag/i.test(s.text)),
    ).toBe(true);

    // Yesterday snapshot freezes when tomorrow's exception changes.
    const yesterday = addHouseholdDays(today, -1);
    const tomorrow = addHouseholdDays(today, 1);
    store.saveSchoolCalendar(manager.context, {
      mutationId: randomUUID(),
      expectedVersion: 2,
      years: [yearPayload("2026-01-01", "2027-12-31", [1, 2, 3, 4, 5, 6, 7], [])],
    });
    store.materializeForDate(manager.context, yesterday);
    const beforeHist = store.historyForDate(manager.context, yesterday);
    const beforeBed = beforeHist.find((o) => o.title === "Bedtime");
    const beforeJson = beforeBed ? JSON.stringify(beforeBed.steps) : null;

    store.saveSchoolCalendar(manager.context, {
      mutationId: randomUUID(),
      expectedVersion: 3,
      years: [
        yearPayload("2026-01-01", "2027-12-31", [1, 2, 3, 4, 5, 6, 7], [
          { name: "Tomorrow off", startDate: tomorrow, endDate: tomorrow },
        ]),
      ],
    });
    const afterHist = store.historyForDate(manager.context, yesterday);
    const afterBed = afterHist.find((o) => o.title === "Bedtime");
    expect(afterBed ? JSON.stringify(afterBed.steps) : null).toBe(beforeJson);

    // Sunday before Monday holiday omits school-night item (future Sunday ≥ today).
    let sunday = today;
    while (isoWeekday(sunday) !== 7) {
      sunday = addHouseholdDays(sunday, 1);
    }
    const monday = addHouseholdDays(sunday, 1);
    store.saveSchoolCalendar(manager.context, {
      mutationId: randomUUID(),
      expectedVersion: 4,
      years: [
        yearPayload("2026-01-01", "2027-12-31", [1, 2, 3, 4, 5], [
          { name: "Monday holiday", startDate: monday, endDate: monday },
        ]),
      ],
    });
    const sundayAfter = store.materializeForDate(manager.context, sunday);
    const bedAfter = sundayAfter.find((o) => o.title === "Bedtime");
    expect(bedAfter?.steps.some((s) => /Pack school bag/i.test(s.text))).toBe(false);
    expect(bedAfter?.steps.some((s) => /Brush teeth/i.test(s.text))).toBe(true);
  });

  it("AT4: HTTP school-calendar authority, CSRF/Origin, and version conflict", async () => {
    const harness = await createHttpHarness();
    temps.push(harness.dbPath);
    try {
      const manager = await httpClaimManager(harness, `cal.mgr.${Date.now().toString(36)}`);
      const mgrHeaders = authHeaders(harness, manager);

      const unauth = await harness.app.inject({
        method: "GET",
        url: "/api/v1/school-calendar",
      });
      expect(unauth.statusCode).toBe(401);

      const enrollAvery = await harness.app.inject({
        method: "POST",
        url: "/api/v1/enrollment/claims",
        headers: mgrHeaders,
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
          loginName: `cal.avery.${Date.now().toString(36)}`,
          passphrase: PASSPHRASE,
          displayName: "Avery Reed",
        },
      });
      const avery = sessionFromResponse(harness, averyClaim);
      const averyHeaders = authHeaders(harness, avery);

      const readerGet = await harness.app.inject({
        method: "GET",
        url: "/api/v1/school-calendar",
        headers: averyHeaders,
      });
      expect(readerGet.statusCode).toBe(200);
      expect((readerGet.json() as { calendar: { configured: boolean } }).calendar.configured).toBe(
        false,
      );

      const readerPut = await harness.app.inject({
        method: "PUT",
        url: "/api/v1/school-calendar",
        headers: averyHeaders,
        payload: {
          mutationId: randomUUID(),
          expectedVersion: 0,
          years: [yearPayload("2026-09-01", "2027-06-15", [1, 2, 3, 4, 5])],
        },
      });
      expect(readerPut.statusCode).toBe(403);

      // Structure-only: strip grants, leave structure.manage.
      harness.db.prepare("DELETE FROM membership_grants WHERE membership_id = ?").run(IDS.avery);
      harness.db
        .prepare("INSERT INTO membership_grants (membership_id, grant_name) VALUES (?, ?)")
        .run(IDS.avery, "household.structure.manage");
      harness.db
        .prepare("INSERT INTO membership_grants (membership_id, grant_name) VALUES (?, ?)")
        .run(IDS.avery, "routine.execute.own");
      const structurePut = await harness.app.inject({
        method: "PUT",
        url: "/api/v1/school-calendar",
        headers: averyHeaders,
        payload: {
          mutationId: randomUUID(),
          expectedVersion: 0,
          years: [yearPayload("2026-09-01", "2027-06-15", [1, 2, 3, 4, 5])],
        },
      });
      expect(structurePut.statusCode).toBe(403);

      const missingCsrf = await harness.app.inject({
        method: "PUT",
        url: "/api/v1/school-calendar",
        headers: {
          cookie: manager.cookieHeader,
          origin: harness.origin,
        },
        payload: {
          mutationId: randomUUID(),
          expectedVersion: 0,
          years: [yearPayload("2026-09-01", "2027-06-15", [1, 2, 3, 4, 5])],
        },
      });
      expect(missingCsrf.statusCode).toBe(403);
      expect((missingCsrf.json() as { code: string }).code).toBe("CSRF");

      const foreignOrigin = await harness.app.inject({
        method: "PUT",
        url: "/api/v1/school-calendar",
        headers: {
          ...mgrHeaders,
          origin: "https://evil.example",
        },
        payload: {
          mutationId: randomUUID(),
          expectedVersion: 0,
          years: [yearPayload("2026-09-01", "2027-06-15", [1, 2, 3, 4, 5])],
        },
      });
      expect(foreignOrigin.statusCode).toBe(403);
      expect((foreignOrigin.json() as { code: string }).code).toBe("ORIGIN");

      const ok = await harness.app.inject({
        method: "PUT",
        url: "/api/v1/school-calendar",
        headers: mgrHeaders,
        payload: {
          mutationId: randomUUID(),
          expectedVersion: 0,
          years: [yearPayload("2026-09-01", "2027-06-15", [1, 2, 3, 4, 5])],
        },
      });
      expect(ok.statusCode).toBe(200);
      expect((ok.json() as { calendar: { version: number } }).calendar.version).toBe(1);

      const conflict = await harness.app.inject({
        method: "PUT",
        url: "/api/v1/school-calendar",
        headers: mgrHeaders,
        payload: {
          mutationId: randomUUID(),
          expectedVersion: 0,
          years: [yearPayload("2026-09-01", "2027-06-15", [1, 2, 3, 4, 5])],
        },
      });
      expect(conflict.statusCode).toBe(409);
      expect((conflict.json() as { code: string }).code).toBe("CONFLICT");
    } finally {
      await harness.close();
    }
  });

  it("AT6: preview empty message, unresolved context, hidden-anchor personal survives", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.p.${Date.now().toString(36)}`,
      "Avery Reed",
    );

    store.saveSchoolCalendar(manager.context, {
      mutationId: randomUUID(),
      expectedVersion: 0,
      years: [yearPayload("2026-01-01", "2027-12-31", [1, 2, 3, 4, 5])],
    });

    const schoolOnly = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "School-only",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      steps: [
        {
          text: "Only school",
          obligation: "required",
          applicability: { kind: "school_days" },
        },
      ],
    });

    const todayPreview = store.householdDateNow(manager.context);
    let emptyDate = todayPreview;
    while (isoWeekday(emptyDate) !== 6) {
      emptyDate = addHouseholdDays(emptyDate, 1);
    }
    const empty = store.previewComposition(
      manager.context,
      IDS.avery,
      schoolOnly.id,
      emptyDate,
    );
    expect(empty.runs).toBe(true);
    expect(empty.steps).toHaveLength(0);
    expect(empty.message).toBe("No steps apply on this date");

    // Remove editions so a live school_days preview reports unresolved context.
    db.exec(`
      DELETE FROM school_exceptions;
      DELETE FROM school_years;
      DELETE FROM school_calendar_editions;
      DELETE FROM calendar_mutation_receipts;
      UPDATE household_calendars SET version = 0;
    `);
    const unresolved = store.previewComposition(
      manager.context,
      IDS.avery,
      schoolOnly.id,
      todayPreview,
    );
    expect(unresolved.unresolvedContext).toBe(true);
    expect(unresolved.message).toMatch(/School calendar is not set up/i);

    store.saveSchoolCalendar(manager.context, {
      mutationId: randomUUID(),
      expectedVersion: 0,
      years: [yearPayload("2026-01-01", "2027-12-31", [1, 2, 3, 4, 5])],
    });

    const withAnchor = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Anchor routine",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      steps: [
        {
          text: "School pack",
          obligation: "required",
          applicability: { kind: "school_days" },
        },
        {
          text: "Everyday stretch",
          obligation: "required",
          applicability: { kind: "every_time" },
        },
      ],
    });
    const schoolLogical = withAnchor.scheduleEntries[0]!.revision.steps.find((s) =>
      s.text === "School pack",
    )!;
    expect(schoolLogical.applicability).toEqual({ kind: "school_days" });
    const personalFrom = addHouseholdDays(todayPreview, 1);
    store.savePersonalLayer(avery.context, {
      definitionId: withAnchor.id,
      effectiveDate: personalFrom,
      additions: [
        {
          text: "Personal after school pack",
          obligation: "optional",
          place: "after",
          anchorLogicalItemId: schoolLogical.logicalItemId,
          applicability: { kind: "every_time" },
        },
      ],
    });
    let weekend = personalFrom;
    while (isoWeekday(weekend) !== 6) {
      weekend = addHouseholdDays(weekend, 1);
    }
    const preview = store.previewComposition(
      manager.context,
      IDS.avery,
      withAnchor.id,
      weekend,
    );
    expect(preview.steps.map((s) => s.text)).toEqual([
      "Personal after school pack",
      "Everyday stretch",
    ]);
    expect(preview.excludedSteps?.map((s) => s.text)).toContain("School pack");
  });

  it("AT7: calendar exception updates both sides of schedule boundary without routine version bump", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.b.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    store.saveSchoolCalendar(manager.context, {
      mutationId: randomUUID(),
      expectedVersion: 0,
      years: [yearPayload("2026-01-01", "2027-12-31", [1, 2, 3, 4, 5, 6, 7])],
    });

    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Boundary Morning",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      steps: [
        {
          text: "Pack Lunchbox",
          obligation: "required",
          applicability: { kind: "school_days" },
        },
        { text: "Stretch", obligation: "required", applicability: { kind: "every_time" } },
      ],
    });
    const today = store.householdDateNow(manager.context);
    const boundary = addHouseholdDays(today, 3);
    const afterBoundary = addHouseholdDays(boundary, 1);
    store.createRevision(manager.context, routine.id, {
      mutationId: randomUUID(),
      title: "Boundary Upcoming",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      steps: [
        {
          text: "Pack Lunchbox",
          obligation: "required",
          applicability: { kind: "school_days" },
        },
        { text: "Stretch later", obligation: "required", applicability: { kind: "every_time" } },
      ],
      expectedVersion: routine.version,
      mode: "schedule",
      effectiveDate: boundary,
    });

    store.materializeForDate(manager.context, today);
    store.materializeForDate(manager.context, afterBoundary);
    const versionBefore = store.getRoutineById(manager.context.householdId, routine.id)!.version;

    store.saveSchoolCalendar(manager.context, {
      mutationId: randomUUID(),
      expectedVersion: 1,
      years: [
        yearPayload("2026-01-01", "2027-12-31", [1, 2, 3, 4, 5, 6, 7], [
          { name: "Break today", startDate: today, endDate: today },
          { name: "Break after", startDate: afterBoundary, endDate: afterBoundary },
        ]),
      ],
    });

    const todayOcc = store
      .materializeForDate(manager.context, today)
      .find((o) => o.definitionId === routine.id);
    const afterOcc = store
      .materializeForDate(manager.context, afterBoundary)
      .find((o) => o.definitionId === routine.id);
    expect(todayOcc?.steps.some((s) => /Pack Lunchbox/i.test(s.text))).toBe(false);
    expect(afterOcc?.steps.some((s) => /Pack Lunchbox/i.test(s.text))).toBe(false);
    expect(todayOcc?.steps.some((s) => /Stretch/i.test(s.text))).toBe(true);
    expect(afterOcc?.title).toBe("Boundary Upcoming");
    expect(store.getRoutineById(manager.context.householdId, routine.id)!.version).toBe(
      versionBefore,
    );
  });

  it("AT8: calendar edit updates only unstarted of two members", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.l.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    const jordan = await enrollAndClaim(
      store,
      manager.context,
      IDS.jordan,
      "direct_personalizer",
      `jordan.l.${Date.now().toString(36)}`,
      "Jordan Reed",
    );
    store.saveSchoolCalendar(manager.context, {
      mutationId: randomUUID(),
      expectedVersion: 0,
      years: [yearPayload("2026-01-01", "2027-12-31", [1, 2, 3, 4, 5, 6, 7])],
    });
    store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Shared Morning",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery, IDS.jordan],
      assigneeGroupIds: [],
      steps: [
        {
          text: "Pack Lunchbox",
          obligation: "required",
          applicability: { kind: "school_days" },
        },
        { text: "Stretch", obligation: "required", applicability: { kind: "every_time" } },
      ],
    });
    const today = store.householdDateNow(manager.context);
    const before = store.materializeForDate(manager.context, today);
    const averyOcc = before.find((o) => o.accountableMemberId === IDS.avery)!;
    const jordanOcc = before.find((o) => o.accountableMemberId === IDS.jordan)!;
    expect(averyOcc.steps.some((s) => /Pack Lunchbox/i.test(s.text))).toBe(true);

    store.setStepStatus(avery.context, averyOcc.id, averyOcc.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
    });
    const startedSteps = JSON.stringify(store.getOccurrenceById(averyOcc.id)!.steps);

    store.saveSchoolCalendar(manager.context, {
      mutationId: randomUUID(),
      expectedVersion: 1,
      years: [
        yearPayload("2026-01-01", "2027-12-31", [1, 2, 3, 4, 5, 6, 7], [
          { name: "No school today", startDate: today, endDate: today },
        ]),
      ],
    });

    const after = store.materializeForDate(manager.context, today);
    const averyAfter = after.find((o) => o.id === averyOcc.id)!;
    const jordanAfter = after.find((o) => o.id === jordanOcc.id)!;
    expect(JSON.stringify(averyAfter.steps)).toBe(startedSteps);
    expect(averyAfter.startedAt).toBeTruthy();
    expect(jordanAfter.steps.some((s) => /Pack Lunchbox/i.test(s.text))).toBe(false);
    expect(jordanAfter.steps.some((s) => /Stretch/i.test(s.text))).toBe(true);
    void jordan;
  });

  it("AT9: calendar version conflict, mutation replay, payload conflict, obsolete step", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.r.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    const years = [yearPayload("2026-01-01", "2027-12-31", [1, 2, 3, 4, 5])];
    const mutationId = randomUUID();
    const first = store.saveSchoolCalendar(manager.context, {
      mutationId,
      expectedVersion: 0,
      years,
    });
    expect(first.version).toBe(1);

    const replay = store.saveSchoolCalendar(manager.context, {
      mutationId,
      expectedVersion: 0,
      years,
    });
    expect(replay).toEqual(first);

    expect(() =>
      store.saveSchoolCalendar(manager.context, {
        mutationId,
        expectedVersion: 1,
        years: [yearPayload("2026-01-01", "2027-12-31", [1, 2, 3, 4, 5, 6])],
      }),
    ).toThrow(/couldn't be updated|conflict/i);

    expect(() =>
      store.saveSchoolCalendar(manager.context, {
        mutationId: randomUUID(),
        expectedVersion: 0,
        years,
      }),
    ).toThrow(/updated elsewhere|conflict/i);

    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Race Morning",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      steps: [
        {
          text: "Pack Lunchbox",
          obligation: "required",
          applicability: { kind: "school_days" },
        },
        { text: "Stretch", obligation: "required", applicability: { kind: "every_time" } },
      ],
    });
    const today = store.householdDateNow(manager.context);
    const occ = store
      .materializeForDate(manager.context, today)
      .find((o) => o.definitionId === routine.id)!;
    const obsoleteStepId = occ.steps.find((s) => /Pack Lunchbox/i.test(s.text))!.id;

    store.saveSchoolCalendar(manager.context, {
      mutationId: randomUUID(),
      expectedVersion: 1,
      years: [
        yearPayload("2026-01-01", "2027-12-31", [1, 2, 3, 4, 5], [
          { name: "Off", startDate: today, endDate: today },
        ]),
      ],
    });

    expect(() =>
      store.setStepStatus(avery.context, occ.id, obsoleteStepId, {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
      }),
    ).toThrow(/Step not found/i);

    // Rollback injection is not exposed on AppStore; gap noted in evidence summary.
  });

  it("AT6/AT8: filtered-empty omit from Today; past history snapshots stay frozen", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    store.saveSchoolCalendar(manager.context, {
      mutationId: randomUUID(),
      expectedVersion: 0,
      years: [yearPayload("2026-09-01", "2027-06-15", [1, 2, 3, 4, 5])],
    });

    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "School-only",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      steps: [
        {
          text: "Only school",
          obligation: "required",
          applicability: { kind: "school_days" },
        },
      ],
    });

    const saturday = "2026-09-12";
    const sat = store.materializeForDate(manager.context, saturday);
    expect(sat.find((o) => o.definitionId === routine.id)).toBeUndefined();

    const yesterday = addHouseholdDays(store.householdDateNow(manager.context), -1);
    store.materializeForDate(manager.context, yesterday);
    const before = store.historyForDate(manager.context, yesterday);
    const snap = before.find((o) => o.definitionId === routine.id);
    const beforeJson = snap ? JSON.stringify(snap.steps) : null;

    store.saveSchoolCalendar(manager.context, {
      mutationId: randomUUID(),
      expectedVersion: 1,
      years: [yearPayload("2026-09-01", "2027-06-15", [6, 7])],
    });
    const after = store.historyForDate(manager.context, yesterday);
    const snapAfter = after.find((o) => o.definitionId === routine.id);
    expect(snapAfter ? JSON.stringify(snapAfter.steps) : null).toBe(beforeJson);

    expect(db.pragma("foreign_key_check") as unknown[]).toEqual([]);
    void isoWeekday;
  });
});
