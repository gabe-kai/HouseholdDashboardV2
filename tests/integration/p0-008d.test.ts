import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../../src/server/db.js";
import { scrubRestoredAccess } from "../../src/server/backup-catalog.js";
import { sha256Hex } from "../../src/server/crypto.js";
import { createHttpHarness, type HttpHarness } from "../helpers/auth-fixture.js";
import { openPopulatedP019UpgradeDatabase } from "../helpers/p019-fixture.js";

const OWNER_SECRET = "test-owner-secret-with-enough-entropy-0123456789abcdef";
const PASSPHRASE = "Unique-passphrase-ok!999";

const harnesses: HttpHarness[] = [];
const temps: string[] = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    await harnesses.pop()?.close();
  }
  for (const file of temps.splice(0)) {
    for (const target of [file, `${file}-wal`, `${file}-shm`]) {
      try {
        fs.rmSync(target, { force: true, recursive: true });
      } catch {
        /* ignore */
      }
    }
  }
});

function tempPath(prefix: string, ext = ".sqlite"): string {
  const p = path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`,
  );
  temps.push(p);
  return p;
}

function backupDirForTest(): string {
  const dir = path.join(
    os.tmpdir(),
    `hd-d-backup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  temps.push(dir);
  return dir;
}

async function createDHarness(extra: Record<string, string> = {}): Promise<HttpHarness> {
  const harness = await createHttpHarness({
    AUTO_SEED: "0",
    INSTALLATION_OWNER_SECRET: OWNER_SECRET,
    INSTALLATION_CONTROL_PATH: tempPath("hd-d-control"),
    BACKUP_DIR: backupDirForTest(),
    ...extra,
  });
  harnesses.push(harness);
  return harness;
}

type Auth = {
  cookie: string;
  csrf: string;
  membershipId: string;
  installationEpoch: number;
};

function authHeaders(h: HttpHarness, a: Auth, withCsrf = true): Record<string, string> {
  return {
    origin: h.origin,
    "content-type": "application/json",
    cookie: `${h.config.cookieName}=${a.cookie}`,
    ...(withCsrf ? { "x-csrf-token": a.csrf } : {}),
  };
}

async function call(
  h: HttpHarness,
  a: Auth | null,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) {
  const headers = a
    ? authHeaders(h, a)
    : { origin: h.origin, "content-type": "application/json" };
  if (method === "GET") delete (headers as Record<string, string>)["content-type"];
  return h.app.inject({
    method,
    url,
    headers,
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

async function setupHousehold(harness: HttpHarness): Promise<Auth & { loginName: string }> {
  const owner = await harness.app.inject({
    method: "POST",
    url: "/api/v1/owner/session",
    headers: { origin: harness.origin, "content-type": "application/json" },
    payload: { secret: OWNER_SECRET },
  });
  expect(owner.statusCode).toBe(200);
  const ownerCsrf = (owner.json() as { csrfToken: string }).csrfToken;
  const ownerCookie = owner.cookies.find((c) => c.name.includes("owner"))!.value;

  const invite = await harness.app.inject({
    method: "POST",
    url: "/api/v1/owner/setup-invitation",
    headers: {
      origin: harness.origin,
      "content-type": "application/json",
      cookie: `${harness.config.ownerCookieName}=${ownerCookie}`,
      "x-csrf-token": ownerCsrf,
    },
    payload: {},
  });
  expect(invite.statusCode).toBe(200);
  const invitationToken = (invite.json() as { invitationToken: string }).invitationToken;

  const exchange = await harness.app.inject({
    method: "POST",
    url: "/api/v1/setup/exchange",
    headers: { origin: harness.origin, "content-type": "application/json" },
    payload: { invitationToken },
  });
  expect(exchange.statusCode).toBe(200);
  const setupCookie = exchange.cookies.find((c) => c.name.includes("setup"))!.value;

  const loginName = `mgrd.${Date.now().toString(36)}`;
  const account = await harness.app.inject({
    method: "POST",
    url: "/api/v1/setup/account",
    headers: {
      origin: harness.origin,
      "content-type": "application/json",
      cookie: `${harness.config.setupCookieName}=${setupCookie}`,
    },
    payload: {
      loginName,
      passphrase: PASSPHRASE,
      displayName: "Guide Manager",
    },
  });
  expect(account.statusCode).toBe(200);
  const csrf = (account.json() as { csrfToken: string }).csrfToken;
  const cookie = account.cookies.find((c) => c.name === harness.config.cookieName)!.value;
  const membershipId = (account.json() as { member: { id: string } }).member.id;
  const installationEpoch = (account.json() as { installationEpoch?: number }).installationEpoch ?? 1;

  const household = await harness.app.inject({
    method: "POST",
    url: "/api/v1/setup/household",
    headers: {
      origin: harness.origin,
      "content-type": "application/json",
      cookie: `${harness.config.cookieName}=${cookie}`,
      "x-csrf-token": csrf,
    },
    payload: { name: "Guide Household", timezone: "America/New_York" },
  });
  expect(household.statusCode).toBe(200);

  return { cookie, csrf, membershipId, loginName, installationEpoch };
}

function guideGuard(auth: Auth, expectedGuideVersion: number, mutationId = randomUUID()) {
  return {
    mutationId,
    expectedGuideVersion,
    installationEpoch: auth.installationEpoch,
  };
}

describe("P0-008D guided first household day", () => {
  it("AT1: migration 020/021 idempotent; populated through-019 adopts with preserved A progress/C departures", () => {
    const dbPath = tempPath("hd-d-migrate");
    const db = openDatabase(dbPath);
    migrate(db);
    const applied020 = db
      .prepare(`SELECT id FROM schema_migrations WHERE id = ?`)
      .get("020_guided_setup_progress.sql") as { id: string } | undefined;
    const applied021 = db
      .prepare(`SELECT id FROM schema_migrations WHERE id = ?`)
      .get("021_guide_mutation_receipts.sql") as { id: string } | undefined;
    expect(applied020?.id).toBe("020_guided_setup_progress.sql");
    expect(applied021?.id).toBe("021_guide_mutation_receipts.sql");
    migrate(db);
    db.close();

    const populatedPath = tempPath("hd-d-populated019");
    const populated = openPopulatedP019UpgradeDatabase(populatedPath);
    const before019 = populated
      .prepare(
        `SELECT account_completed_at, household_completed_at, membership_id FROM setup_progress LIMIT 1`,
      )
      .get() as
      | {
          account_completed_at: string | null;
          household_completed_at: string | null;
          membership_id: string | null;
        }
      | undefined;
    expect(before019?.account_completed_at).toBeTruthy();
    expect(before019?.household_completed_at).toBeTruthy();
    const departedBefore = (
      populated
        .prepare(`SELECT COUNT(*) AS c FROM household_memberships WHERE departed_at IS NOT NULL`)
        .get() as { c: number }
    ).c;
    expect(departedBefore).toBeGreaterThan(0);
    const grantsBefore = (
      populated
        .prepare(
          `SELECT COUNT(*) AS c FROM membership_grants WHERE grant_name IN ('household.lifecycle.manage','household.access.manage','household.member.remove')`,
        )
        .get() as { c: number }
    ).c;
    expect(grantsBefore).toBeGreaterThan(0);

    migrate(populated);
    migrate(populated);

    const after = populated
      .prepare(
        `SELECT account_completed_at, household_completed_at, membership_id,
                guide_version, people_status, school_status, first_work_status
         FROM setup_progress LIMIT 1`,
      )
      .get() as {
      account_completed_at: string | null;
      household_completed_at: string | null;
      membership_id: string | null;
      guide_version: number;
      people_status: string;
      school_status: string;
      first_work_status: string;
    };
    expect(after.account_completed_at).toBe(before019!.account_completed_at);
    expect(after.household_completed_at).toBe(before019!.household_completed_at);
    expect(after.membership_id).toBe(before019!.membership_id);
    expect(after.guide_version).toBe(0);
    expect(after.people_status).toBe("not_chosen");
    expect(after.school_status).toBe("not_chosen");
    expect(after.first_work_status).toBe("not_chosen");
    const departedAfter = (
      populated
        .prepare(`SELECT COUNT(*) AS c FROM household_memberships WHERE departed_at IS NOT NULL`)
        .get() as { c: number }
    ).c;
    expect(departedAfter).toBe(departedBefore);
    const appliedD = populated
      .prepare(`SELECT id FROM schema_migrations WHERE id IN (?, ?) ORDER BY id`)
      .all("020_guided_setup_progress.sql", "021_guide_mutation_receipts.sql") as Array<{
      id: string;
    }>;
    expect(appliedD.map((r) => r.id)).toEqual([
      "020_guided_setup_progress.sql",
      "021_guide_mutation_receipts.sql",
    ]);
    populated.close();
  });

  it("AT4: guide person save rolls back domain+progress+receipt when failure hook fires", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);

    const beforePeople = await call(h, auth, "GET", "/api/v1/people");
    expect(beforePeople.statusCode).toBe(200);
    const beforeCount = (beforePeople.json() as { people: unknown[] }).people.length;

    const guideBefore = await call(h, auth, "GET", "/api/v1/guide/progress");
    expect(guideBefore.statusCode).toBe(200);
    const version = (guideBefore.json() as { guideVersion: number }).guideVersion;

    h.store.setGuideSaveFailureHook(() => {
      throw Object.assign(new Error("injected guide failure"), { code: "CONFLICT" });
    });
    try {
      const failed = await call(h, auth, "POST", "/api/v1/guide/people", {
        ...guideGuard(auth, version),
        displayName: "Should Roll Back",
        classification: "child",
      });
      expect(failed.statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      h.store.setGuideSaveFailureHook(null);
    }

    const afterPeople = await call(h, auth, "GET", "/api/v1/people");
    expect((afterPeople.json() as { people: unknown[] }).people.length).toBe(beforeCount);
    const guideAfter = await call(h, auth, "GET", "/api/v1/guide/progress");
    expect((guideAfter.json() as { guideVersion: number }).guideVersion).toBe(version);
  });

  it("R3: changed-payload guide replay is rejected; same command recovers", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const guide = await call(h, auth, "GET", "/api/v1/guide/progress");
    const version = (guide.json() as { guideVersion: number }).guideVersion;
    const mutationId = randomUUID();

    const first = await call(h, auth, "POST", "/api/v1/guide/people", {
      ...guideGuard(auth, version, mutationId),
      displayName: "Probe Alex",
      classification: "child",
    });
    expect(first.statusCode).toBe(200);
    const alex = (first.json() as { person: { id: string; displayName: string }; progress: { guideVersion: number } });
    expect(alex.person.displayName).toBe("Probe Alex");

    const changed = await call(h, auth, "POST", "/api/v1/guide/people", {
      ...guideGuard(auth, alex.progress.guideVersion, mutationId),
      displayName: "Probe Blair",
      classification: "adult",
    });
    expect(changed.statusCode).toBeGreaterThanOrEqual(400);

    const replay = await call(h, auth, "POST", "/api/v1/guide/people", {
      ...guideGuard(auth, version, mutationId),
      displayName: "Probe Alex",
      classification: "child",
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { person: { id: string } }).person.id).toBe(alex.person.id);
  });

  it("AT5/R4: draft routine preview unions group audience and is side-effect free", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);

    const child = await call(h, auth, "POST", "/api/v1/people", {
      mutationId: randomUUID(),
      displayName: "Group Kid",
      classification: "child",
    });
    expect(child.statusCode).toBe(200);
    const childId = (child.json() as { person: { id: string } }).person.id;

    const group = await call(h, auth, "POST", "/api/v1/groups", {
      mutationId: randomUUID(),
      name: "Kids",
      membershipIds: [childId],
    });
    expect(group.statusCode).toBe(200);
    const groupId = (group.json() as { group: { id: string } }).group.id;

    const preview = await call(h, auth, "POST", "/api/v1/routines/preview-draft", {
      mutationId: randomUUID(),
      title: "Group only",
      daypart: "morning",
      assigneeMemberIds: [],
      assigneeGroupIds: [groupId],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "Pack bag", obligation: "required" }],
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json() as {
      preview: Array<{ applicable: boolean; participantMemberIds: string[] }>;
    };
    const applicable = body.preview.find((d) => d.applicable);
    expect(applicable).toBeTruthy();
    expect(applicable!.participantMemberIds).toContain(childId);

    const definitions = h.db
      .prepare(`SELECT COUNT(*) AS c FROM routine_definitions WHERE deleted_at IS NULL`)
      .get() as { c: number };
    expect(definitions.c).toBe(0);
  });

  it("AT7: unused guide person and work can be deleted; old guide retry stays denied", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const guide = await call(h, auth, "GET", "/api/v1/guide/progress");
    let version = (guide.json() as { guideVersion: number }).guideVersion;
    const personMutation = randomUUID();

    const created = await call(h, auth, "POST", "/api/v1/guide/people", {
      ...guideGuard(auth, version, personMutation),
      displayName: "Unused Child",
      classification: "child",
    });
    expect(created.statusCode).toBe(200);
    const person = (created.json() as {
      person: { id: string; version: number; authorityVersion: number };
      progress: { guideVersion: number };
    });
    version = person.progress.guideVersion;

    const school = await call(h, auth, "POST", "/api/v1/guide/school", {
      ...guideGuard(auth, version),
      status: "skipped",
    });
    expect(school.statusCode).toBe(200);
    version = (school.json() as { progress: { guideVersion: number } }).progress.guideVersion;

    const workMutation = randomUUID();
    const session = await call(h, auth, "GET", "/api/v1/auth/session");
    expect(session.statusCode).toBe(200);
    const householdDate = (session.json() as { householdDate: string }).householdDate;
    const draftPreview = await call(h, auth, "POST", "/api/v1/routines/preview-draft", {
      mutationId: randomUUID(),
      title: "Guide Routine",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5],
      assigneeMemberIds: [auth.membershipId],
      assigneeGroupIds: [],
      steps: [{ text: "Stretch", obligation: "required" }],
    });
    expect(draftPreview.statusCode).toBe(200);
    const draftBody = draftPreview.json() as {
      preview: Array<{ applicable: boolean; householdDate: string; participantMemberIds: string[] }>;
    };
    const applicableDays = draftBody.preview.filter((d) => d.applicable);
    const firstDay = applicableDays[0];
    const calendar = await call(h, auth, "GET", "/api/v1/school-calendar");
    const calendarVersion = (calendar.json() as { calendar: { version: number } }).calendar.version;
    const previewBasis = {
      householdDate,
      calendarVersion,
      audienceGroupIds: [] as string[],
      audienceGroupVersions: {},
      reviewedRoutineParticipantIds: firstDay?.participantMemberIds ?? [auth.membershipId],
      reviewedRoutineDays: applicableDays.map((d) => ({
        householdDate: d.householdDate,
        participantMemberIds: d.participantMemberIds,
      })),
    };

    const workPayload = {
      ...guideGuard(auth, version, workMutation),
      status: "completed" as const,
      routine: {
        mutationId: randomUUID(),
        title: "Guide Routine",
        daypart: "morning" as const,
        weekdays: [1, 2, 3, 4, 5],
        assigneeMemberIds: [auth.membershipId],
        assigneeGroupIds: [] as string[],
        steps: [{ text: "Stretch", obligation: "required" as const }],
      },
      previewBasis,
    };
    const work = await call(h, auth, "POST", "/api/v1/guide/work", workPayload);
    expect(work.statusCode).toBe(200);
    const routine = (work.json() as {
      routine: { id: string; version: number };
      progress: { guideVersion: number };
    }).routine;

    const deletedWork = await call(h, auth, "POST", `/api/v1/routines/${routine.id}/delete`, {
      mutationId: randomUUID(),
      expectedVersion: routine.version,
    });
    expect(deletedWork.statusCode).toBe(200);

    const replayWork = await call(h, auth, "POST", "/api/v1/guide/work", workPayload);
    expect(replayWork.statusCode).toBeGreaterThanOrEqual(400);

    await call(h, auth, "POST", "/api/v1/auth/reauthenticate", { passphrase: PASSPHRASE });
    const preview = await call(h, auth, "POST", `/api/v1/people/${person.person.id}/removal/preview`, {
      expectedVersion: person.person.version,
      expectedAuthorityVersion: person.person.authorityVersion,
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as {
      previewDigest: string;
      impact: { mode: string };
    };
    expect(previewBody.impact.mode).toBe("delete");

    const removed = await call(h, auth, "POST", `/api/v1/people/${person.person.id}/removal`, {
      mutationId: randomUUID(),
      expectedVersion: person.person.version,
      expectedAuthorityVersion: person.person.authorityVersion,
      previewDigest: previewBody.previewDigest,
      passphrase: PASSPHRASE,
      confirmationText: "REMOVE",
    });
    expect(removed.statusCode).toBe(200);
    expect((removed.json() as { mode: string }).mode).toBe("deleted");

    const replayPerson = await call(h, auth, "POST", "/api/v1/guide/people", {
      ...guideGuard(auth, person.progress.guideVersion - 1, personMutation),
      displayName: "Unused Child",
      classification: "child",
    });
    expect(replayPerson.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("AT11: scrubRestoredAccess revokes all membership_access_claims purposes", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const householdId = (
      h.db.prepare(`SELECT id FROM households LIMIT 1`).get() as { id: string }
    ).id;
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const purposes = ["invitation", "password_reset", "restore_sign_in"] as const;
    const tokens: string[] = [];
    for (const purpose of purposes) {
      const token = `raw-claim-${purpose}-${randomUUID()}`;
      tokens.push(token);
      h.db
        .prepare(
          `INSERT INTO membership_access_claims
           (id, household_id, membership_id, purpose, token_digest, created_by_membership_id,
            created_at, expires_at, consumed_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
        )
        .run(
          randomUUID(),
          householdId,
          auth.membershipId,
          purpose,
          sha256Hex(token),
          auth.membershipId,
          now,
          expires,
        );
    }

    for (const token of tokens) {
      const preview = await h.app.inject({
        method: "GET",
        url: `/api/v1/auth/access-claims/preview?token=${encodeURIComponent(token)}`,
        headers: { origin: h.origin },
      });
      expect(preview.statusCode).toBe(200);
    }

    scrubRestoredAccess(h.db);

    for (const token of tokens) {
      const preview = await h.app.inject({
        method: "GET",
        url: `/api/v1/auth/access-claims/preview?token=${encodeURIComponent(token)}`,
        headers: { origin: h.origin },
      });
      expect(preview.statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  it("AT8: guide progress requires lifecycle.manage", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const denied = await h.app.inject({
      method: "GET",
      url: "/api/v1/guide/progress",
      headers: { origin: h.origin },
    });
    expect(denied.statusCode).toBe(401);

    const ok = await call(h, auth, "GET", "/api/v1/guide/progress");
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { guideVersion: number; peopleStatus: string; setupRequired: boolean };
    expect(body.guideVersion).toBe(0);
    expect(body.peopleStatus).toBe("not_chosen");
    expect(body.setupRequired).toBe(false);
  });

  it("R2: guide school Not now preserves existing calendar years/exceptions", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const guide = await call(h, auth, "GET", "/api/v1/guide/progress");
    const version = (guide.json() as { guideVersion: number }).guideVersion;

    const saved = await call(h, auth, "PUT", "/api/v1/school-calendar", {
      mutationId: randomUUID(),
      expectedVersion: 0,
      years: [
        {
          startDate: "2025-09-01",
          endDate: "2026-06-15",
          usualWeekdays: [1, 2, 3, 4, 5],
          exceptions: [
            {
              name: "Winter break",
              startDate: "2025-12-20",
              endDate: "2026-01-02",
            },
          ],
        },
        {
          startDate: "2026-09-01",
          endDate: "2027-06-15",
          usualWeekdays: [1, 2, 3, 4, 5],
          exceptions: [],
        },
      ],
    });
    expect(saved.statusCode).toBe(200);

    const skipped = await call(h, auth, "POST", "/api/v1/guide/school", {
      ...guideGuard(auth, version),
      status: "skipped",
    });
    expect(skipped.statusCode).toBe(200);

    const calendar = await call(h, auth, "GET", "/api/v1/school-calendar");
    expect(calendar.statusCode).toBe(200);
    const years = (calendar.json() as { calendar: { years: unknown[] } }).calendar.years;
    expect(years).toHaveLength(2);
  });

  it("R3: changed scheduledAdditions on same guide-work mutationId is rejected", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const guide = await call(h, auth, "GET", "/api/v1/guide/progress");
    let version = (guide.json() as { guideVersion: number }).guideVersion;
    const school = await call(h, auth, "POST", "/api/v1/guide/school", {
      ...guideGuard(auth, version),
      status: "skipped",
    });
    version = (school.json() as { progress: { guideVersion: number } }).progress.guideVersion;

    const session = await call(h, auth, "GET", "/api/v1/auth/session");
    const householdDate = (session.json() as { householdDate: string }).householdDate;
    const calendar = await call(h, auth, "GET", "/api/v1/school-calendar");
    const calendarVersion = (calendar.json() as { calendar: { version: number } }).calendar.version;
    const mutationId = randomUUID();
    const assignment = {
      mode: "fixed" as const,
      anchorDate: householdDate,
      fixedMemberId: auth.membershipId,
      cycleOrder: [] as string[],
      weeklyMap: {},
      excludedMemberIds: [] as string[],
      savedRingOrder: [] as string[],
    };
    const baseResponsibility = {
      mutationId: randomUUID(),
      title: "Kitchen",
      daypart: "evening" as const,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: auth.membershipId,
      assignment,
      steps: [{ text: "Wipe counters", obligation: "required" as const }],
      scheduledAdditions: [] as Array<{
        name: string;
        weekdays: number[];
        inheritAssignment: boolean;
        steps: Array<{ text: string; obligation: "required" }>;
      }>,
    };
    const respPreview = await call(h, auth, "POST", "/api/v1/responsibilities/preview-draft", {
      ...baseResponsibility,
      mutationId: randomUUID(),
    });
    expect(respPreview.statusCode).toBe(200);
    const respDays = (
      respPreview.json() as {
        preview: Array<{
          applicable: boolean;
          householdDate: string;
          accountableMemberId: string | null;
        }>;
      }
    ).preview.filter((d) => d.applicable);
    const previewBasis = {
      householdDate,
      calendarVersion,
      audienceGroupIds: [] as string[],
      audienceGroupVersions: {},
      reviewedResponsibilityOwnerId: respDays[0]?.accountableMemberId ?? auth.membershipId,
      reviewedResponsibilityDays: respDays.map((d) => ({
        householdDate: d.householdDate,
        accountableMemberId: d.accountableMemberId,
      })),
    };

    const first = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version, mutationId),
      status: "completed",
      responsibility: baseResponsibility,
      previewBasis,
    });
    expect(first.statusCode).toBe(200);
    const firstId = (first.json() as { responsibility: { id: string } }).responsibility.id;

    const changed = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version, mutationId),
      status: "completed",
      responsibility: {
        ...baseResponsibility,
        mutationId: randomUUID(),
        scheduledAdditions: [
          {
            name: "Deep clean",
            weekdays: [6],
            inheritAssignment: true,
            steps: [{ text: "Extra wipe", obligation: "required" as const }],
          },
        ],
      },
      previewBasis,
    });
    expect(changed.statusCode).toBeGreaterThanOrEqual(400);

    const replay = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version, mutationId),
      status: "completed",
      responsibility: baseResponsibility,
      previewBasis,
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { responsibility: { id: string } }).responsibility.id).toBe(firstId);
  });

  it("R4: guide work creation without previewBasis is rejected", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const guide = await call(h, auth, "GET", "/api/v1/guide/progress");
    let version = (guide.json() as { guideVersion: number }).guideVersion;
    const school = await call(h, auth, "POST", "/api/v1/guide/school", {
      ...guideGuard(auth, version),
      status: "skipped",
    });
    version = (school.json() as { progress: { guideVersion: number } }).progress.guideVersion;

    const denied = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version),
      status: "completed",
      routine: {
        mutationId: randomUUID(),
        title: "No Review",
        daypart: "morning",
        weekdays: [1, 2, 3, 4, 5],
        assigneeMemberIds: [auth.membershipId],
        assigneeGroupIds: [],
        steps: [{ text: "Brush", obligation: "required" }],
      },
    });
    expect(denied.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("AT6: competing guide school save with stale expectedVersion is rejected; winner preserves calendar", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const guide = await call(h, auth, "GET", "/api/v1/guide/progress");
    const version = (guide.json() as { guideVersion: number }).guideVersion;

    const first = await call(h, auth, "POST", "/api/v1/guide/school", {
      ...guideGuard(auth, version),
      status: "completed",
      calendar: {
        mutationId: randomUUID(),
        expectedVersion: 0,
        years: [
          {
            startDate: "2025-09-01",
            endDate: "2026-06-15",
            usualWeekdays: [1, 2, 3, 4, 5],
            exceptions: [],
          },
        ],
      },
    });
    expect(first.statusCode).toBe(200);
    const nextVersion = (first.json() as { progress: { guideVersion: number } }).progress
      .guideVersion;

    const stale = await call(h, auth, "POST", "/api/v1/guide/school", {
      ...guideGuard(auth, version),
      status: "skipped",
    });
    expect(stale.statusCode).toBeGreaterThanOrEqual(400);

    const calendar = await call(h, auth, "GET", "/api/v1/school-calendar");
    expect(
      (calendar.json() as { calendar: { years: unknown[]; version: number } }).calendar.years,
    ).toHaveLength(1);

    const fresh = await call(h, auth, "POST", "/api/v1/guide/school", {
      ...guideGuard(auth, nextVersion),
      status: "skipped",
    });
    expect(fresh.statusCode).toBe(200);
    const after = await call(h, auth, "GET", "/api/v1/school-calendar");
    expect(
      (after.json() as { calendar: { years: unknown[] } }).calendar.years,
    ).toHaveLength(1);
  });

  it("AT8: foreign household guide progress is denied; display session cannot read guide", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const foreign = await h.app.inject({
      method: "GET",
      url: "/api/v1/guide/progress",
      headers: {
        origin: h.origin,
        cookie: `${h.config.cookieName}=not-a-real-session`,
      },
    });
    expect(foreign.statusCode).toBeGreaterThanOrEqual(401);

    const unauth = await h.app.inject({
      method: "POST",
      url: "/api/v1/guide/work",
      headers: { origin: h.origin, "content-type": "application/json" },
      payload: { ...guideGuard(auth, 0), status: "skipped" },
    });
    expect(unauth.statusCode).toBeGreaterThanOrEqual(401);
  });

  it("AT11: staged through-019 → D restore scrub denies claim preview and redemption", async () => {
    const populatedPath = tempPath("hd-d-staged019");
    const source = openPopulatedP019UpgradeDatabase(populatedPath);
    migrate(source);
    const householdId = (
      source.prepare(`SELECT id FROM households LIMIT 1`).get() as { id: string }
    ).id;
    const manager = source
      .prepare(
        `SELECT id FROM household_memberships WHERE household_id = ? AND departed_at IS NULL LIMIT 1`,
      )
      .get(householdId) as { id: string };
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const token = `staged-claim-${randomUUID()}`;
    source
      .prepare(
        `INSERT INTO membership_access_claims
         (id, household_id, membership_id, purpose, token_digest, created_by_membership_id,
          created_at, expires_at, consumed_at, revoked_at)
         VALUES (?, ?, ?, 'invitation', ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(randomUUID(), householdId, manager.id, sha256Hex(token), manager.id, now, expires);
    source
      .prepare(
        `UPDATE setup_progress SET people_status = 'skipped', school_status = 'skipped',
         first_work_status = 'skipped', finished_at = ?, dismissed_at = ?, guide_version = 3
         WHERE household_id = ?`,
      )
      .run(now, now, householdId);
    const progressBefore = source
      .prepare(
        `SELECT people_status, school_status, first_work_status, finished_at, dismissed_at, guide_version
         FROM setup_progress WHERE household_id = ?`,
      )
      .get(householdId) as {
      people_status: string;
      school_status: string;
      first_work_status: string;
      finished_at: string | null;
      dismissed_at: string | null;
      guide_version: number;
    };
    expect(progressBefore.guide_version).toBe(3);
    expect(progressBefore.finished_at).toBeTruthy();

    scrubRestoredAccess(source);

    const claim = source
      .prepare(`SELECT revoked_at FROM membership_access_claims WHERE token_digest = ?`)
      .get(sha256Hex(token)) as { revoked_at: string | null };
    expect(claim.revoked_at).toBeTruthy();

    const progressAfter = source
      .prepare(
        `SELECT people_status, school_status, first_work_status, finished_at, dismissed_at, guide_version
         FROM setup_progress WHERE household_id = ?`,
      )
      .get(householdId) as typeof progressBefore;
    expect(progressAfter).toEqual(progressBefore);
    source.close();

    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const hh = (h.db.prepare(`SELECT id FROM households LIMIT 1`).get() as { id: string }).id;
    const liveToken = `live-claim-${randomUUID()}`;
    h.db
      .prepare(
        `INSERT INTO membership_access_claims
         (id, household_id, membership_id, purpose, token_digest, created_by_membership_id,
          created_at, expires_at, consumed_at, revoked_at)
         VALUES (?, ?, ?, 'restore_sign_in', ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(
        randomUUID(),
        hh,
        auth.membershipId,
        sha256Hex(liveToken),
        auth.membershipId,
        now,
        expires,
      );
    const beforeScrub = await h.app.inject({
      method: "GET",
      url: `/api/v1/auth/access-claims/preview?token=${encodeURIComponent(liveToken)}`,
      headers: { origin: h.origin },
    });
    expect(beforeScrub.statusCode).toBe(200);
    scrubRestoredAccess(h.db);
    const afterPreview = await h.app.inject({
      method: "GET",
      url: `/api/v1/auth/access-claims/preview?token=${encodeURIComponent(liveToken)}`,
      headers: { origin: h.origin },
    });
    expect(afterPreview.statusCode).toBeGreaterThanOrEqual(400);
    const redeem = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/access-claims/redeem",
      headers: { origin: h.origin, "content-type": "application/json" },
      payload: { claimToken: liveToken, passphrase: PASSPHRASE },
    });
    expect(redeem.statusCode).toBeGreaterThanOrEqual(400);
  });
});
