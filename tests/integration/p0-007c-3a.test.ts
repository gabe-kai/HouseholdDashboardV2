/**
 * P0-007C-3A shared-display execution — integration evidence (AT1–AT7, AT9–AT10).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { householdDateFromInstant, addHouseholdDays } from "../../src/domain/time.js";
import { migrate } from "../../src/server/db.js";
import {
  claimManager,
  createHttpHarness,
  IDS,
  type HttpHarness,
} from "../helpers/auth-fixture.js";
import {
  openPopulatedP015UpgradeDatabase,
  P015_FIXTURE_IDS,
} from "../helpers/p015-fixture.js";

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

function requiredStep(text: string) {
  return {
    logicalItemId: randomUUID(),
    text,
    obligation: "required" as const,
  };
}

function asNeededStep(text: string) {
  return {
    logicalItemId: randomUUID(),
    text,
    obligation: "as_needed" as const,
  };
}

async function createAndClaimDisplay(
  harness: HttpHarness,
  label = "Execution wall",
  existingManager?: Awaited<ReturnType<typeof claimManager>>,
): Promise<{
  manager: Awaited<ReturnType<typeof claimManager>>;
  displayId: string;
  displayCookie: string;
  csrfToken: string;
  sessionId: string;
  householdDate: string;
  activityGeneration: number;
}> {
  const manager = existingManager ?? (await claimManager(harness.store));
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
  const sessionRes = await harness.app.inject({
    method: "GET",
    url: "/api/v1/display/session",
    headers: {
      cookie: `${harness.config.displayCookieName}=${displayCookie!.value}`,
    },
  });
  expect(sessionRes.statusCode).toBe(200);
  const session = (
    sessionRes.json() as {
      session: {
        csrfToken: string;
        sessionId: string;
        householdDate: string;
        activityGeneration: number;
      };
    }
  ).session;
  return {
    manager,
    displayId: created.display.id,
    displayCookie: displayCookie!.value,
    csrfToken: session.csrfToken,
    sessionId: session.sessionId,
    householdDate: session.householdDate,
    activityGeneration: session.activityGeneration,
  };
}

function displayWriteHeaders(
  harness: HttpHarness,
  displayCookie: string,
  csrfToken: string,
  extra: Record<string, string> = {},
) {
  return {
    cookie: `${harness.config.displayCookieName}=${displayCookie}`,
    origin: harness.origin,
    "x-csrf-token": csrfToken,
    "content-type": "application/json",
    ...extra,
  };
}

function intentFromOccurrence(occurrence: {
  revisionId: string;
  accountableMemberId: string | null;
  structureFingerprint?: string | null;
  steps: Array<{ logicalItemId?: string | null }>;
}) {
  expect(occurrence.accountableMemberId).toBeTruthy();
  return {
    revisionId: occurrence.revisionId,
    accountableMemberId: occurrence.accountableMemberId!,
    stepLogicalIds: occurrence.steps
      .map((s) => s.logicalItemId)
      .filter((id): id is string => Boolean(id)),
    ...(occurrence.structureFingerprint
      ? { structureFingerprint: occurrence.structureFingerprint }
      : {}),
  };
}

async function fetchDisplayOccurrence(
  harness: HttpHarness,
  displayCookie: string,
  occurrenceId: string,
) {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/display/occurrences/${occurrenceId}`,
    headers: {
      cookie: `${harness.config.displayCookieName}=${displayCookie}`,
    },
  });
  expect(res.statusCode).toBe(200);
  return (
    res.json() as {
      occurrence: {
        id: string;
        revisionId: string;
        kind: "routine" | "responsibility";
        householdDate: string;
        accountableMemberId: string | null;
        accountableMemberName: string;
        structureFingerprint?: string | null;
        intendedStructure?: {
          revisionId: string;
          accountableMemberId: string;
          stepLogicalIds: string[];
          structureFingerprint?: string;
        };
        steps: Array<{
          id: string;
          text: string;
          status: string;
          obligation: string;
          logicalItemId?: string;
        }>;
      };
    }
  ).occurrence;
}

describe("P0-007C-3A AT1 populated through-015 upgrade", () => {
  it("preserves human actor rows, fills csrf_secret, and accepts new display writes", async () => {
    const dbPath = path.join(os.tmpdir(), `hd-007c3a-p015-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openPopulatedP015UpgradeDatabase(dbPath);

    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '016_%'")
          .get() as { c: number }
      ).c,
    ).toBe(0);
    expect(
      (
        db
          .prepare(`SELECT 1 AS ok FROM step_reports WHERE id = ?`)
          .get(P015_FIXTURE_IDS.humanReportId) as { ok: number } | undefined
      )?.ok,
    ).toBe(1);

    migrate(db);

    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '016_%'")
          .get() as { c: number }
      ).c,
    ).toBe(1);

    const humanReport = db
      .prepare(
        `SELECT actor_class, acting_member_id, acting_display_id, accountable_member_id
         FROM step_reports WHERE id = ?`,
      )
      .get(P015_FIXTURE_IDS.humanReportId) as {
      actor_class: string;
      acting_member_id: string | null;
      acting_display_id: string | null;
      accountable_member_id: string;
    };
    expect(humanReport.actor_class).toBe("member");
    expect(humanReport.acting_member_id).toBeTruthy();
    expect(humanReport.acting_display_id).toBeNull();

    const humanReceipt = db
      .prepare(
        `SELECT actor_class, actor_membership_id, actor_display_id
         FROM mutation_receipts WHERE mutation_id = ?`,
      )
      .get(P015_FIXTURE_IDS.humanMutationId) as {
      actor_class: string | null;
      actor_membership_id: string | null;
      actor_display_id: string | null;
    };
    expect(humanReceipt.actor_class).toBe("member");
    expect(humanReceipt.actor_membership_id).toBeTruthy();
    expect(humanReceipt.actor_display_id).toBeNull();

    const session = db
      .prepare(`SELECT csrf_secret FROM display_sessions WHERE id = ?`)
      .get(P015_FIXTURE_IDS.displaySessionId) as { csrf_secret: string };
    expect(session.csrf_secret.length).toBeGreaterThan(16);

    // Idempotent second migrate.
    migrate(db);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '016_%'")
          .get() as { c: number }
      ).c,
    ).toBe(1);

    db.close();

    // Fresh harness: new display write creates actor_class=display rows.
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await createAndClaimDisplay(harness, "AT1 wall");
    const ctx = enrolled.manager.context;
    const today = householdDateFromInstant(new Date(), ctx.timezone);

    harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: "AT1 Cats",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [requiredStep("Feed")],
    });
    const occ = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.title === "AT1 Cats")!;
    const detail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      occ.id,
    );
    const mutationId = randomUUID();
    const write = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${detail.id}/steps/${detail.steps[0]!.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: {
        mutationId,
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: enrolled.activityGeneration,
        kind: "responsibility",
        householdDate: detail.householdDate,
        intendedStructure:
          detail.intendedStructure ?? intentFromOccurrence(detail),
      },
    });
    expect(write.statusCode).toBe(200);

    const displayReport = harness.db
      .prepare(
        `SELECT actor_class, acting_member_id, acting_display_id, acting_display_session_id,
                accountable_member_id, performer_member_id
         FROM step_reports WHERE mutation_id = ?`,
      )
      .get(mutationId) as {
      actor_class: string;
      acting_member_id: string | null;
      acting_display_id: string;
      acting_display_session_id: string;
      accountable_member_id: string;
      performer_member_id: string | null;
    };
    expect(displayReport.actor_class).toBe("display");
    expect(displayReport.acting_member_id).toBeNull();
    expect(displayReport.acting_display_id).toBe(enrolled.displayId);
    expect(displayReport.acting_display_session_id).toBe(enrolled.sessionId);
    expect(displayReport.accountable_member_id).toBe(IDS.avery);
    expect(displayReport.performer_member_id).toBeNull();

    const displayReceipt = harness.db
      .prepare(
        `SELECT actor_class, actor_display_id, actor_display_session_id, household_id
         FROM mutation_receipts WHERE mutation_id = ?`,
      )
      .get(mutationId) as {
      actor_class: string;
      actor_display_id: string;
      actor_display_session_id: string;
      household_id: string;
    };
    expect(displayReceipt.actor_class).toBe("display");
    expect(displayReceipt.actor_display_id).toBe(enrolled.displayId);
    expect(displayReceipt.actor_display_session_id).toBe(enrolled.sessionId);
    expect(displayReceipt.household_id).toBe(ctx.householdId);
  });
});

describe("P0-007C-3A AT2 authorization matrix", () => {
  it("allows display cookie on display status; denies member cookie, bad CSRF/Origin, revoked", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await createAndClaimDisplay(harness, "Auth wall");
    const ctx = enrolled.manager.context;
    const today = householdDateFromInstant(new Date(), ctx.timezone);

    harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: "Auth Cats",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [requiredStep("Feed")],
    });
    const occ = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.title === "Auth Cats")!;
    const detail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      occ.id,
    );
    const stepId = detail.steps[0]!.id;
    const url = `/api/v1/display/occurrences/${detail.id}/steps/${stepId}/status`;
    const basePayload = {
      mutationId: randomUUID(),
      status: "completed" as const,
      performedAt: new Date().toISOString(),
      activityGeneration: enrolled.activityGeneration,
      kind: "responsibility" as const,
      householdDate: detail.householdDate,
      intendedStructure:
        detail.intendedStructure ?? intentFromOccurrence(detail),
    };

    const ok = await harness.app.inject({
      method: "POST",
      url,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: basePayload,
    });
    expect(ok.statusCode).toBe(200);

    const memberDenied = await harness.app.inject({
      method: "POST",
      url,
      headers: {
        cookie: `${harness.config.cookieName}=${enrolled.manager.token}`,
        origin: harness.origin,
        "x-csrf-token": enrolled.manager.csrfSecret,
        "content-type": "application/json",
      },
      payload: { ...basePayload, mutationId: randomUUID() },
    });
    expect(memberDenied.statusCode).toBe(401);

    const wrongCsrf = await harness.app.inject({
      method: "POST",
      url,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        "wrong-csrf-token-value",
      ),
      payload: { ...basePayload, mutationId: randomUUID() },
    });
    expect(wrongCsrf.statusCode).toBe(403);
    expect((wrongCsrf.json() as { code: string }).code).toBe("CSRF");

    const foreignOrigin = await harness.app.inject({
      method: "POST",
      url,
      headers: {
        cookie: `${harness.config.displayCookieName}=${enrolled.displayCookie}`,
        origin: "https://evil.example",
        "x-csrf-token": enrolled.csrfToken,
        "content-type": "application/json",
      },
      payload: { ...basePayload, mutationId: randomUUID() },
    });
    expect(foreignOrigin.statusCode).toBe(403);
    expect((foreignOrigin.json() as { code: string }).code).toBe("ORIGIN");

    // Revoke then deny.
    const list = await harness.app.inject({
      method: "GET",
      url: "/api/v1/displays",
      headers: {
        cookie: `${harness.config.cookieName}=${enrolled.manager.token}`,
      },
    });
    const row = (
      list.json() as {
        displays: Array<{ id: string; configVersion: number }>;
      }
    ).displays.find((d) => d.id === enrolled.displayId)!;
    const revoke = await harness.app.inject({
      method: "POST",
      url: `/api/v1/displays/${enrolled.displayId}/revoke`,
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
    expect(revoke.statusCode).toBe(200);

    const revokedWrite = await harness.app.inject({
      method: "POST",
      url,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: { ...basePayload, mutationId: randomUUID() },
    });
    expect(revokedWrite.statusCode).toBe(401);
  });
});

describe("P0-007C-3A AT3/AT4 routine and responsibility journeys", () => {
  it("updates assigned routine/responsibility via display; peer untouched; unassigned denied", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await createAndClaimDisplay(harness, "Journey wall");
    const ctx = enrolled.manager.context;
    const today = householdDateFromInstant(new Date(), ctx.timezone);

    harness.store.createRoutine(ctx, {
      mutationId: randomUUID(),
      title: "Wall stretch",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery, IDS.casey],
      assigneeGroupIds: [],
      steps: [requiredStep("Stretch hard"), asNeededStep("Stretch soft")],
    });
    harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: "Kitchen wall",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [requiredStep("Counters"), asNeededStep("Wipe")],
    });
    const emptyGroup = harness.store.createGroup(ctx, {
      mutationId: randomUUID(),
      name: `Empty ring ${Date.now().toString(36)}`,
      membershipIds: [IDS.avery, IDS.casey],
    });
    harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: "Needs a person wall",
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

    const materialized = harness.store.materializeForDate(ctx, today);
    const averyRoutine = materialized.find(
      (o) =>
        o.title === "Wall stretch" && o.accountableMemberId === IDS.avery,
    )!;
    const caseyRoutine = materialized.find(
      (o) =>
        o.title === "Wall stretch" && o.accountableMemberId === IDS.casey,
    )!;
    const kitchen = materialized.find((o) => o.title === "Kitchen wall")!;
    const unassigned = materialized.find(
      (o) => o.title === "Needs a person wall",
    )!;

    const averyDetail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      averyRoutine.id,
    );
    const doneStep = averyDetail.steps.find((s) => s.obligation === "required")!;
    const softStep = averyDetail.steps.find((s) => s.obligation === "as_needed")!;

    const routineDone = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${averyDetail.id}/steps/${doneStep.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: enrolled.activityGeneration,
        kind: "routine",
        householdDate: averyDetail.householdDate,
        intendedStructure:
          averyDetail.intendedStructure ?? intentFromOccurrence(averyDetail),
      },
    });
    expect(routineDone.statusCode).toBe(200);

    const routineNn = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${averyDetail.id}/steps/${softStep.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: {
        mutationId: randomUUID(),
        status: "not_needed",
        performedAt: new Date().toISOString(),
        activityGeneration: enrolled.activityGeneration,
        kind: "routine",
        householdDate: averyDetail.householdDate,
        intendedStructure:
          averyDetail.intendedStructure ?? intentFromOccurrence(averyDetail),
      },
    });
    expect(routineNn.statusCode).toBe(200);

    expect(
      harness.store.getOccurrenceById(caseyRoutine.id)!.steps.every(
        (s) => s.status === "open",
      ),
    ).toBe(true);

    const kitchenDetail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      kitchen.id,
    );
    const kitchenWrite = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${kitchenDetail.id}/steps/${kitchenDetail.steps[0]!.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: enrolled.activityGeneration,
        kind: "responsibility",
        householdDate: kitchenDetail.householdDate,
        intendedStructure:
          kitchenDetail.intendedStructure ?? intentFromOccurrence(kitchenDetail),
      },
    });
    expect(kitchenWrite.statusCode).toBe(200);
    const kitchenAfter = harness.store.getOccurrenceById(kitchen.id)!;
    expect(kitchenAfter.accountableMemberId).toBe(IDS.avery);
    expect(kitchenAfter.steps[0]!.status).toBe("completed");

    const kitchenReport = harness.db
      .prepare(
        `SELECT actor_class, acting_member_id, performer_member_id, accountable_member_id
         FROM step_reports
         WHERE occurrence_id = ?
         ORDER BY recorded_at DESC LIMIT 1`,
      )
      .get(kitchen.id) as {
      actor_class: string;
      acting_member_id: string | null;
      performer_member_id: string | null;
      accountable_member_id: string;
    };
    expect(kitchenReport.actor_class).toBe("display");
    expect(kitchenReport.acting_member_id).toBeNull();
    expect(kitchenReport.performer_member_id).toBeNull();
    expect(kitchenReport.accountable_member_id).toBe(IDS.avery);

    // Unassigned: detail has no intendedStructure / no executable owner.
    const unassignedDetail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      unassigned.id,
    );
    expect(unassignedDetail.accountableMemberId).toBeNull();
    const unassignedWrite = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${unassignedDetail.id}/steps/${unassignedDetail.steps[0]!.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: enrolled.activityGeneration,
        kind: "responsibility",
        householdDate: unassignedDetail.householdDate,
        intendedStructure: {
          revisionId: unassignedDetail.revisionId,
          accountableMemberId: IDS.avery,
          stepLogicalIds: unassignedDetail.steps
            .map((s) => s.logicalItemId)
            .filter((id): id is string => Boolean(id)),
        },
      },
    });
    expect(unassignedWrite.statusCode).toBeGreaterThanOrEqual(400);
    expect(
      harness.store.getOccurrenceById(unassigned.id)!.steps[0]!.status,
    ).toBe("open");
  });
});

describe("P0-007C-3A AT5 current-day denial", () => {
  it("denies wrong householdDate and not_needed on required", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await createAndClaimDisplay(harness, "Denial wall");
    const ctx = enrolled.manager.context;
    const today = householdDateFromInstant(new Date(), ctx.timezone);

    harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: "Denial Cats",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [requiredStep("Feed required")],
    });
    const occ = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.title === "Denial Cats")!;
    const detail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      occ.id,
    );
    const intent =
      detail.intendedStructure ?? intentFromOccurrence(detail);

    const wrongDate = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${detail.id}/steps/${detail.steps[0]!.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: enrolled.activityGeneration,
        kind: "responsibility",
        householdDate: "2099-01-01",
        intendedStructure: intent,
      },
    });
    expect(wrongDate.statusCode).toBeGreaterThanOrEqual(400);

    const notNeededRequired = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${detail.id}/steps/${detail.steps[0]!.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: {
        mutationId: randomUUID(),
        status: "not_needed",
        performedAt: new Date().toISOString(),
        activityGeneration: enrolled.activityGeneration,
        kind: "responsibility",
        householdDate: detail.householdDate,
        intendedStructure: intent,
      },
    });
    expect(notNeededRequired.statusCode).toBeGreaterThanOrEqual(400);
    expect(
      harness.store.getOccurrenceById(occ.id)!.steps[0]!.status,
    ).toBe("open");
  });

  it("denies yesterday/tomorrow, school-filtered-out, ended-unstarted, canceled, removed-step, foreign; started survivor remains actionable", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await createAndClaimDisplay(harness, "Denial matrix wall");
    const ctx = enrolled.manager.context;
    const today = householdDateFromInstant(new Date(), ctx.timezone);
    const yesterday = addHouseholdDays(today, -1);
    const tomorrow = addHouseholdDays(today, 1);

    async function denyWrite(
      occurrenceId: string,
      stepId: string,
      payload: Record<string, unknown>,
    ) {
      const res = await harness.app.inject({
        method: "POST",
        url: `/api/v1/display/occurrences/${occurrenceId}/steps/${stepId}/status`,
        headers: displayWriteHeaders(
          harness,
          enrolled.displayCookie,
          enrolled.csrfToken,
        ),
        payload,
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      return res;
    }

    // --- Yesterday / tomorrow targeting ---
    harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: "Day Fence Cats",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [requiredStep("Feed")],
    });
    const todayOcc = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.title === "Day Fence Cats")!;
    const tomorrowOcc = harness.store
      .materializeForDate(ctx, tomorrow)
      .find((o) => o.title === "Day Fence Cats")!;
    const yesterdayOcc = harness.store
      .materializeForDate(ctx, yesterday)
      .find((o) => o.title === "Day Fence Cats");
    const todayDetail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      todayOcc.id,
    );
    const intent = todayDetail.intendedStructure ?? intentFromOccurrence(todayDetail);

    await denyWrite(todayDetail.id, todayDetail.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
      activityGeneration: enrolled.activityGeneration,
      kind: "responsibility",
      householdDate: yesterday,
      intendedStructure: intent,
    });
    await denyWrite(todayDetail.id, todayDetail.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
      activityGeneration: enrolled.activityGeneration,
      kind: "responsibility",
      householdDate: tomorrow,
      intendedStructure: intent,
    });
    await denyWrite(tomorrowOcc.id, tomorrowOcc.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
      activityGeneration: enrolled.activityGeneration,
      kind: "responsibility",
      householdDate: today,
      intendedStructure: intentFromOccurrence(tomorrowOcc),
    });
    if (yesterdayOcc) {
      await denyWrite(yesterdayOcc.id, yesterdayOcc.steps[0]!.id, {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: enrolled.activityGeneration,
        kind: "responsibility",
        householdDate: today,
        intendedStructure: intentFromOccurrence(yesterdayOcc),
      });
    }
    expect(
      harness.store.getOccurrenceById(todayOcc.id)!.steps[0]!.status,
    ).toBe("open");

    // --- School-filtered-out ---
    const calendar = harness.store.getSchoolCalendar(ctx);
    const endYear = Number(today.slice(0, 4)) + 1;
    harness.store.saveSchoolCalendar(ctx, {
      mutationId: randomUUID(),
      expectedVersion: calendar.version,
      years: [
        {
          startDate: `${today.slice(0, 4)}-01-01`,
          endDate: `${endYear}-12-31`,
          usualWeekdays: [1, 2, 3, 4, 5, 6, 7],
          exceptions: [],
        },
      ],
    });
    const schoolTitle = `School filter ${Date.now().toString(36)}`;
    harness.store.createRoutine(ctx, {
      mutationId: randomUUID(),
      title: schoolTitle,
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      steps: [
        {
          logicalItemId: randomUUID(),
          text: "Pack lunchbox",
          obligation: "required" as const,
          applicability: { kind: "school_days" as const },
        },
      ],
    });
    const schoolOcc = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.title === schoolTitle)!;
    const schoolDetail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      schoolOcc.id,
    );
    const calAfter = harness.store.getSchoolCalendar(ctx);
    harness.store.saveSchoolCalendar(ctx, {
      mutationId: randomUUID(),
      expectedVersion: calAfter.version,
      years: [
        {
          startDate: `${today.slice(0, 4)}-01-01`,
          endDate: `${endYear}-12-31`,
          usualWeekdays: [1, 2, 3, 4, 5, 6, 7],
          exceptions: [
            { name: "No school today", startDate: today, endDate: today },
          ],
        },
      ],
    });
    harness.store.materializeForDate(ctx, today);
    await denyWrite(schoolDetail.id, schoolDetail.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
      activityGeneration: enrolled.activityGeneration,
      kind: "routine",
      householdDate: today,
      intendedStructure:
        schoolDetail.intendedStructure ?? intentFromOccurrence(schoolDetail),
    });

    // --- Ended-unstarted / canceled ---
    const endTitle = `End unstarted ${Date.now().toString(36)}`;
    const endDef = harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: endTitle,
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [requiredStep("Wipe")],
    });
    const endOcc = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.definitionId === endDef.id)!;
    const endDetail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      endOcc.id,
    );
    const endCur = harness.store.getResponsibilityById(
      ctx.householdId,
      endDef.id,
    );
    harness.store.endResponsibility(ctx, endDef.id, {
      mutationId: randomUUID(),
      expectedVersion: endCur.version,
    });
    await denyWrite(endDetail.id, endDetail.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
      activityGeneration: enrolled.activityGeneration,
      kind: "responsibility",
      householdDate: today,
      intendedStructure:
        endDetail.intendedStructure ?? intentFromOccurrence(endDetail),
    });
    expect(
      harness.store.getOccurrenceById(endOcc.id)!.steps[0]!.status,
    ).toBe("open");

    // --- Removed step ---
    const reviseTitle = `Removed step ${Date.now().toString(36)}`;
    const keepLogical = randomUUID();
    const dropLogical = randomUUID();
    const reviseDef = harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: reviseTitle,
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [
        { logicalItemId: keepLogical, text: "Keep", obligation: "required" },
        { logicalItemId: dropLogical, text: "Drop", obligation: "required" },
      ],
    });
    let reviseOcc = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.definitionId === reviseDef.id)!;
    const reviseDetail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      reviseOcc.id,
    );
    const droppedStep = reviseDetail.steps.find(
      (s) => s.logicalItemId === dropLogical,
    )!;
    const reviseCur = harness.store.getResponsibilityById(
      ctx.householdId,
      reviseDef.id,
    );
    harness.store.createResponsibilityRevision(ctx, reviseDef.id, {
      mutationId: randomUUID(),
      title: reviseTitle,
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [
        { logicalItemId: keepLogical, text: "Keep", obligation: "required" },
      ],
      expectedVersion: reviseCur.version,
      mode: "current",
    });
    reviseOcc = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.definitionId === reviseDef.id)!;
    await denyWrite(reviseOcc.id, droppedStep.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
      activityGeneration: enrolled.activityGeneration,
      kind: "responsibility",
      householdDate: today,
      intendedStructure:
        reviseDetail.intendedStructure ?? intentFromOccurrence(reviseDetail),
    });

    // --- Foreign / unavailable occurrence ---
    await denyWrite(randomUUID(), randomUUID(), {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
      activityGeneration: enrolled.activityGeneration,
      kind: "responsibility",
      householdDate: today,
      intendedStructure: intent,
    });

    // --- Started survivor remains actionable ---
    const survivorTitle = `Survivor ${Date.now().toString(36)}`;
    const survivorDef = harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: survivorTitle,
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [requiredStep("Finish"), requiredStep("Confirm")],
    });
    const survivorOcc = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.definitionId === survivorDef.id)!;
    const survivorDetail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      survivorOcc.id,
    );
    const startWrite = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${survivorDetail.id}/steps/${survivorDetail.steps[0]!.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: enrolled.activityGeneration,
        kind: "responsibility",
        householdDate: today,
        intendedStructure:
          survivorDetail.intendedStructure ??
          intentFromOccurrence(survivorDetail),
      },
    });
    expect(startWrite.statusCode).toBe(200);
    const survivorCur = harness.store.getResponsibilityById(
      ctx.householdId,
      survivorDef.id,
    );
    harness.store.endResponsibility(ctx, survivorDef.id, {
      mutationId: randomUUID(),
      expectedVersion: survivorCur.version,
    });
    const afterEnd = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      survivorOcc.id,
    );
    const survivorWrite = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${afterEnd.id}/steps/${afterEnd.steps[1]!.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: enrolled.activityGeneration,
        kind: "responsibility",
        householdDate: today,
        intendedStructure:
          afterEnd.intendedStructure ?? intentFromOccurrence(afterEnd),
      },
    });
    expect(survivorWrite.statusCode).toBe(200);
    expect(
      harness.store.getOccurrenceById(survivorOcc.id)!.steps[1]!.status,
    ).toBe("completed");
  });
});

describe("P0-007C-3A AT6 edit/action race", () => {
  it("edit-first rejects stale intent; action-first locks; failure hook rolls back", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await createAndClaimDisplay(harness, "Race wall");
    const ctx = enrolled.manager.context;
    const today = householdDateFromInstant(new Date(), ctx.timezone);

    // --- Edit-first on responsibility ---
    const cats = harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: "Race Cats",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [requiredStep("Scoop"), requiredStep("Feed")],
    });
    let catsOcc = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.definitionId === cats.id)!;
    const staleIntent = intentFromOccurrence(catsOcc);

    const currentCats = harness.store.getResponsibilityById(
      ctx.householdId,
      cats.id,
    );
    harness.store.createResponsibilityRevision(ctx, cats.id, {
      mutationId: randomUUID(),
      title: "Race Cats",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.casey,
      steps: [requiredStep("Scoop"), requiredStep("Feed")],
      expectedVersion: currentCats.version,
      mode: "current",
    });
    catsOcc = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.definitionId === cats.id)!;

    const editFirst = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${catsOcc.id}/steps/${catsOcc.steps[0]!.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: enrolled.activityGeneration,
        kind: "responsibility",
        householdDate: today,
        intendedStructure: staleIntent,
      },
    });
    expect(editFirst.statusCode).toBeGreaterThanOrEqual(400);
    expect(harness.store.getOccurrenceById(catsOcc.id)!.startedAt).toBeNull();

    // --- Action-first locks owner ---
    const trash = harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: "Race Trash",
      daypart: "evening",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [requiredStep("Take out")],
    });
    const trashOcc = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.definitionId === trash.id)!;
    const trashDetail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      trashOcc.id,
    );
    const actionFirst = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${trashDetail.id}/steps/${trashDetail.steps[0]!.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: enrolled.activityGeneration,
        kind: "responsibility",
        householdDate: trashDetail.householdDate,
        intendedStructure:
          trashDetail.intendedStructure ?? intentFromOccurrence(trashDetail),
      },
    });
    expect(actionFirst.statusCode).toBe(200);
    const trashDef = harness.store.getResponsibilityById(
      ctx.householdId,
      trash.id,
    );
    harness.store.createResponsibilityRevision(ctx, trash.id, {
      mutationId: randomUUID(),
      title: "Race Trash",
      daypart: "evening",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.casey,
      steps: [requiredStep("Take out")],
      expectedVersion: trashDef.version,
      mode: "current",
    });
    const survivor = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.definitionId === trash.id)!;
    expect(survivor.id).toBe(trashOcc.id);
    expect(survivor.accountableMemberId).toBe(IDS.avery);

    // --- Failure hook rolls back ---
    const rollback = harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: "Race Rollback",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [requiredStep("Rollback step")],
    });
    const rollbackOcc = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.definitionId === rollback.id)!;
    const beforeStatus = (
      harness.db
        .prepare(`SELECT status FROM occurrence_steps WHERE id = ?`)
        .get(rollbackOcc.steps[0]!.id) as { status: string }
    ).status;
    const beforeReports = (
      harness.db
        .prepare(
          `SELECT COUNT(*) AS c FROM step_reports WHERE occurrence_id = ?`,
        )
        .get(rollbackOcc.id) as { c: number }
    ).c;
    harness.store.setStepStatusFailureHook(() => {
      throw Object.assign(new Error("injected display step status failure"), {
        code: "INTERNAL",
      });
    });
    try {
      expect(() =>
        harness.store.setStepStatusForDisplay(
          {
            sessionId: enrolled.sessionId,
            displayId: enrolled.displayId,
            householdId: ctx.householdId,
            label: "Race wall",
          },
          rollbackOcc.id,
          rollbackOcc.steps[0]!.id,
          {
            mutationId: randomUUID(),
            status: "completed",
            performedAt: new Date().toISOString(),
            activityGeneration: enrolled.activityGeneration,
            kind: "responsibility",
            householdDate: today,
            intendedStructure: intentFromOccurrence(rollbackOcc),
          },
        ),
      ).toThrow(/injected display step status failure/i);
    } finally {
      harness.store.setStepStatusFailureHook(null);
    }
    expect(
      (
        harness.db
          .prepare(`SELECT status FROM occurrence_steps WHERE id = ?`)
          .get(rollbackOcc.steps[0]!.id) as { status: string }
      ).status,
    ).toBe(beforeStatus);
    expect(
      (
        harness.db
          .prepare(
            `SELECT COUNT(*) AS c FROM step_reports WHERE occurrence_id = ?`,
          )
          .get(rollbackOcc.id) as { c: number }
      ).c,
    ).toBe(beforeReports);
  });
});

describe("P0-007C-3A AT7 replay / conflict", () => {
  it("replays same session mutation; conflicts on different payload or session", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await createAndClaimDisplay(harness, "Replay wall A");
    const ctx = enrolled.manager.context;
    const today = householdDateFromInstant(new Date(), ctx.timezone);

    harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: "Replay Cats",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [requiredStep("Feed")],
    });
    const occ = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.title === "Replay Cats")!;
    const detail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      occ.id,
    );
    const mutationId = randomUUID();
    const payload = {
      mutationId,
      status: "completed" as const,
      performedAt: "2026-09-26T18:00:00.000Z",
      activityGeneration: enrolled.activityGeneration,
      kind: "responsibility" as const,
      householdDate: detail.householdDate,
      intendedStructure:
        detail.intendedStructure ?? intentFromOccurrence(detail),
    };

    const first = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${detail.id}/steps/${detail.steps[0]!.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload,
    });
    expect(first.statusCode).toBe(200);

    const replay = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${detail.id}/steps/${detail.steps[0]!.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(
      (
        harness.db
          .prepare(
            `SELECT COUNT(*) AS c FROM step_reports WHERE mutation_id = ?`,
          )
          .get(mutationId) as { c: number }
      ).c,
    ).toBe(1);

    const differentPayload = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${detail.id}/steps/${detail.steps[0]!.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: { ...payload, status: "open" },
    });
    expect(differentPayload.statusCode).toBeGreaterThanOrEqual(400);

    // Second display session under same household (reuse manager).
    const second = await createAndClaimDisplay(
      harness,
      "Replay wall B",
      enrolled.manager,
    );
    const otherSession = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${detail.id}/steps/${detail.steps[0]!.id}/status`,
      headers: displayWriteHeaders(
        harness,
        second.displayCookie,
        second.csrfToken,
      ),
      payload,
    });
    expect(otherSession.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe("P0-007C-3A AT9 revoke vs commit ordering", () => {
  it("revoke-before-commit blocks; commit-before-revoke retains the report", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await createAndClaimDisplay(harness, "Revoke race wall");
    const ctx = enrolled.manager.context;
    const today = householdDateFromInstant(new Date(), ctx.timezone);

    harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: "Revoke race Cats",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [requiredStep("Feed A"), requiredStep("Feed B")],
    });
    const occ = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.title === "Revoke race Cats")!;
    const detail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      occ.id,
    );
    const stepA = detail.steps[0]!;
    const stepB = detail.steps[1]!;

    // Commit-before-revoke: successful write then revoke — report retained.
    const commitMutation = randomUUID();
    const committed = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${detail.id}/steps/${stepA.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: {
        mutationId: commitMutation,
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: enrolled.activityGeneration,
        kind: "responsibility",
        householdDate: detail.householdDate,
        intendedStructure:
          detail.intendedStructure ?? intentFromOccurrence(detail),
      },
    });
    expect(committed.statusCode).toBe(200);

    // Fresh session for revoke-before-commit race (prior revoke would kill cookie).
    const listBefore = await harness.app.inject({
      method: "GET",
      url: "/api/v1/displays",
      headers: {
        cookie: `${harness.config.cookieName}=${enrolled.manager.token}`,
      },
    });
    const rowBefore = (
      listBefore.json() as {
        displays: Array<{ id: string; configVersion: number }>;
      }
    ).displays.find((d) => d.id === enrolled.displayId)!;

    // Delayed write racing with revoke.
    const delayedPromise = harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${detail.id}/steps/${stepB.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
        { "x-mutation-delay-ms": "400" },
      ),
      payload: {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: enrolled.activityGeneration,
        kind: "responsibility",
        householdDate: detail.householdDate,
        intendedStructure:
          detail.intendedStructure ?? intentFromOccurrence(detail),
      },
    });

    await new Promise((r) => setTimeout(r, 80));
    const revoke = await harness.app.inject({
      method: "POST",
      url: `/api/v1/displays/${enrolled.displayId}/revoke`,
      headers: {
        cookie: `${harness.config.cookieName}=${enrolled.manager.token}`,
        origin: harness.origin,
        "x-csrf-token": enrolled.manager.csrfSecret,
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        expectedConfigVersion: rowBefore.configVersion,
      },
    });
    expect(revoke.statusCode).toBe(200);

    const delayed = await delayedPromise;
    expect(delayed.statusCode).toBeGreaterThanOrEqual(400);
    expect(
      harness.store.getOccurrenceById(occ.id)!.steps.find((s) => s.id === stepB.id)!
        .status,
    ).toBe("open");

    // Prior committed report still present after revoke.
    expect(
      (
        harness.db
          .prepare(
            `SELECT actor_class FROM step_reports WHERE mutation_id = ?`,
          )
          .get(commitMutation) as { actor_class: string }
      ).actor_class,
    ).toBe("display");
  });
});

describe("P0-007C-3A AT10 activity clear and generation fence", () => {
  it("clears display reports/receipts, preserves enrollment, rejects old generation", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await createAndClaimDisplay(harness, "Clear wall");
    const ctx = enrolled.manager.context;
    const today = householdDateFromInstant(new Date(), ctx.timezone);

    harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: "Clear Cats",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [requiredStep("Feed")],
    });
    const occ = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.title === "Clear Cats")!;
    const detail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      occ.id,
    );
    const writeMutation = randomUUID();
    const write = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${detail.id}/steps/${detail.steps[0]!.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: {
        mutationId: writeMutation,
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: enrolled.activityGeneration,
        kind: "responsibility",
        householdDate: detail.householdDate,
        intendedStructure:
          detail.intendedStructure ?? intentFromOccurrence(detail),
      },
    });
    expect(write.statusCode).toBe(200);

    const gen = harness.store.getActivityGeneration(ctx.householdId);
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

    expect(
      (
        harness.db
          .prepare(
            `SELECT COUNT(*) AS c FROM step_reports WHERE mutation_id = ?`,
          )
          .get(writeMutation) as { c: number }
      ).c,
    ).toBe(0);
    expect(
      (
        harness.db
          .prepare(
            `SELECT COUNT(*) AS c FROM mutation_receipts WHERE mutation_id = ?`,
          )
          .get(writeMutation) as { c: number }
      ).c,
    ).toBe(0);

    const displayRow = harness.db
      .prepare(
        `SELECT id, revoked_at FROM household_displays WHERE id = ?`,
      )
      .get(enrolled.displayId) as { id: string; revoked_at: string | null };
    expect(displayRow.revoked_at).toBeNull();

    const sessionAfter = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: {
        cookie: `${harness.config.displayCookieName}=${enrolled.displayCookie}`,
      },
    });
    expect(sessionAfter.statusCode).toBe(200);

    // Rematerialize and reject old-generation pending command.
    const rematerialized = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.title === "Clear Cats")!;
    const rematerializedDetail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      rematerialized.id,
    );
    const fenced = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${rematerializedDetail.id}/steps/${rematerializedDetail.steps[0]!.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: gen,
        kind: "responsibility",
        householdDate: rematerializedDetail.householdDate,
        intendedStructure:
          rematerializedDetail.intendedStructure ??
          intentFromOccurrence(rematerializedDetail),
      },
    });
    expect(fenced.statusCode).toBeGreaterThanOrEqual(400);
    expect(
      harness.store.getOccurrenceById(rematerialized.id)!.steps[0]!.status,
    ).toBe("open");
  });

  it("rejects prior-day householdDate against next-day work (date rollover fence)", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const enrolled = await createAndClaimDisplay(harness, "Rollover wall");
    const ctx = enrolled.manager.context;
    const today = householdDateFromInstant(new Date(), ctx.timezone);
    const tomorrow = addHouseholdDays(today, 1);

    harness.store.createResponsibility(ctx, {
      mutationId: randomUUID(),
      title: "Rollover Cats",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [requiredStep("Feed")],
    });
    const todayOcc = harness.store
      .materializeForDate(ctx, today)
      .find((o) => o.title === "Rollover Cats")!;
    const todayDetail = await fetchDisplayOccurrence(
      harness,
      enrolled.displayCookie,
      todayOcc.id,
    );
    const priorDayIntent =
      todayDetail.intendedStructure ?? intentFromOccurrence(todayDetail);

    // Simulate a queued prior-day tap arriving after the household date advances:
    // target tomorrow's rematerialized occurrence while still carrying yesterday's date.
    const nextDayOcc = harness.store
      .materializeForDate(ctx, tomorrow)
      .find((o) => o.title === "Rollover Cats")!;

    const rollover = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${nextDayOcc.id}/steps/${nextDayOcc.steps[0]!.id}/status`,
      headers: displayWriteHeaders(
        harness,
        enrolled.displayCookie,
        enrolled.csrfToken,
      ),
      payload: {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: enrolled.activityGeneration,
        kind: "responsibility",
        householdDate: today,
        intendedStructure: priorDayIntent,
      },
    });
    expect(rollover.statusCode).toBeGreaterThanOrEqual(400);
    expect(
      harness.store.getOccurrenceById(nextDayOcc.id)!.steps[0]!.status,
    ).toBe("open");
    expect(
      harness.store.getOccurrenceById(todayOcc.id)!.steps[0]!.status,
    ).toBe("open");
  });
});
