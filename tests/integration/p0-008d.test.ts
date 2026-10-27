import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate, openDatabase } from "../../src/server/db.js";
import { scrubRestoredAccess } from "../../src/server/backup-catalog.js";
import { hashPassphrase, sha256Hex } from "../../src/server/crypto.js";
import {
  InstallationControl,
  relativeDbPathFromConfig,
} from "../../src/server/installation-control.js";
import {
  addHouseholdDays,
  isoWeekdayForHouseholdDate,
} from "../../src/domain/time.js";
import { createHttpHarness, type HttpHarness } from "../helpers/auth-fixture.js";
import { P009_FIXTURE_IDS } from "../helpers/p009-fixture.js";
import { P013_FIXTURE_IDS } from "../helpers/p013-fixture.js";
import { P014_FIXTURE_IDS } from "../helpers/p014-fixture.js";
import { openPopulatedP019UpgradeDatabase } from "../helpers/p019-fixture.js";
import {
  createThrough017BackupFile,
  createThroughTipBackupFile,
} from "../helpers/through-017-backup-fixture.js";

const OWNER_SECRET = "test-owner-secret-with-enough-entropy-0123456789abcdef";
const PASSPHRASE = "Unique-passphrase-ok!999";

const harnesses: HttpHarness[] = [];
const temps: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
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
  loginName?: string;
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

async function setupHousehold(
  harness: HttpHarness,
): Promise<Auth & { loginName: string }> {
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

async function reauth(h: HttpHarness, auth: Auth): Promise<void> {
  const res = await call(h, auth, "POST", "/api/v1/auth/reauthenticate", {
    passphrase: PASSPHRASE,
  });
  expect(res.statusCode).toBe(200);
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
        stepTexts: (d as { stepTexts?: string[] }).stepTexts ?? ["Stretch"],
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

  it("AT8: foreign/display principals cannot read guide; unauthenticated write denied", async () => {
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

    const displayCreate = await call(h, auth, "POST", "/api/v1/displays", {
      mutationId: randomUUID(),
      label: "Guide Wall",
    });
    expect(displayCreate.statusCode).toBe(200);
    const code = (displayCreate.json() as { enrollment: { code: string } }).enrollment.code;
    const claim = await h.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { origin: h.origin, "content-type": "application/json" },
      payload: { code },
    });
    expect(claim.statusCode).toBe(200);
    const displayCookie = claim.cookies.find((c) =>
      c.name.includes("display"),
    )?.value;
    expect(displayCookie).toBeTruthy();
    const displayGuide = await h.app.inject({
      method: "GET",
      url: "/api/v1/guide/progress",
      headers: {
        origin: h.origin,
        cookie: `${h.config.displayCookieName}=${displayCookie}`,
      },
    });
    expect(displayGuide.statusCode).toBeGreaterThanOrEqual(401);
  });

  it("AT11: B restore of D household preserves guide progress, scrubs claims, keeps source bytes", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const guide = await call(h, auth, "GET", "/api/v1/guide/progress");
    let version = (guide.json() as { guideVersion: number }).guideVersion;
    const people = await call(h, auth, "POST", "/api/v1/guide/people/complete", {
      ...guideGuard(auth, version),
      status: "skipped",
    });
    version = (people.json() as { progress: { guideVersion: number } }).progress.guideVersion;
    const school = await call(h, auth, "POST", "/api/v1/guide/school", {
      ...guideGuard(auth, version),
      status: "skipped",
    });
    version = (school.json() as { progress: { guideVersion: number } }).progress.guideVersion;
    const work = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version),
      status: "skipped",
    });
    version = (work.json() as { progress: { guideVersion: number } }).progress.guideVersion;
    const finish = await call(h, auth, "POST", "/api/v1/guide/finish", {
      ...guideGuard(auth, version),
      dismiss: true,
    });
    expect(finish.statusCode).toBe(200);
    const progressBefore = finish.json() as {
      progress: {
        peopleStatus: string;
        schoolStatus: string;
        firstWorkStatus: string;
        finishedAt: string | null;
        dismissedAt: string | null;
        guideVersion: number;
      };
    };
    expect(progressBefore.progress.dismissedAt).toBeTruthy();
    expect(progressBefore.progress.firstWorkStatus).toBe("skipped");

    const hh = (h.db.prepare(`SELECT id FROM households LIMIT 1`).get() as { id: string }).id;
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const purposes = ["invitation", "password_reset", "restore_sign_in"] as const;
    const tokens: string[] = [];
    for (const purpose of purposes) {
      const token = `d-restore-${purpose}-${randomUUID()}`;
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
          hh,
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

    await reauth(h, auth);
    const created = await call(h, auth, "POST", "/api/v1/household/backups", {
      mutationId: randomUUID(),
      label: "D guide restore source",
    });
    expect(created.statusCode).toBe(200);
    const backup = (
      created.json() as { backup: { id: string; contentDigest: string; relativePath?: string } }
    ).backup;
    const listed = h.runtime.control.listBackups();
    const row = listed.find((b) => b.id === backup.id);
    expect(row).toBeTruthy();
    const abs = path.join(h.config.backupDir, row!.relativePath);
    const sourceBytes = fs.readFileSync(abs);

    const owner = await h.app.inject({
      method: "POST",
      url: "/api/v1/owner/session",
      headers: { origin: h.origin, "content-type": "application/json" },
      payload: { secret: OWNER_SECRET },
    });
    expect(owner.statusCode).toBe(200);
    const ownerCsrf = (owner.json() as { csrfToken: string }).csrfToken;
    const ownerCookie = owner.cookies.find((c) => c.name.includes("owner"))!.value;
    const meta = await h.app.inject({ method: "GET", url: "/api/v1/meta" });
    const epoch = (meta.json() as { installationEpoch: number }).installationEpoch;
    const restore = await h.app.inject({
      method: "POST",
      url: "/api/v1/household/restore",
      headers: {
        origin: h.origin,
        "content-type": "application/json",
        "x-csrf-token": ownerCsrf,
        cookie: `${h.config.ownerCookieName}=${ownerCookie}`,
      },
      payload: {
        mutationId: randomUUID(),
        backupId: backup.id,
        expectedDigest: backup.contentDigest,
        expectedEpoch: epoch,
        confirmationText: "RESTORE",
        saveBackupBeforeRestore: false,
      },
    });
    expect(restore.statusCode).toBe(200);
    expect(fs.readFileSync(abs)).toEqual(sourceBytes);

    const progressAfter = h.runtime.db
      .prepare(
        `SELECT people_status, school_status, first_work_status, finished_at, dismissed_at, guide_version
         FROM setup_progress LIMIT 1`,
      )
      .get() as {
      people_status: string;
      school_status: string;
      first_work_status: string;
      finished_at: string | null;
      dismissed_at: string | null;
      guide_version: number;
    };
    expect(progressAfter.people_status).toBe("skipped");
    expect(progressAfter.school_status).toBe("skipped");
    expect(progressAfter.first_work_status).toBe("skipped");
    expect(progressAfter.finished_at).toBeTruthy();
    expect(progressAfter.dismissed_at).toBeTruthy();
    expect(progressAfter.guide_version).toBe(progressBefore.progress.guideVersion);

    for (const token of tokens) {
      const preview = await h.app.inject({
        method: "GET",
        url: `/api/v1/auth/access-claims/preview?token=${encodeURIComponent(token)}`,
        headers: { origin: h.origin },
      });
      expect(preview.statusCode).toBeGreaterThanOrEqual(400);
      const redeem = await h.app.inject({
        method: "POST",
        url: "/api/v1/auth/access-claims/redeem",
        headers: { origin: h.origin, "content-type": "application/json" },
        payload: { claimToken: token, passphrase: PASSPHRASE },
      });
      expect(redeem.statusCode).toBeGreaterThanOrEqual(400);
    }

    // Fresh sign-in after restore; issue a new invitation claim that previews successfully.
    const login = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: h.origin, "content-type": "application/json" },
      payload: { loginName: auth.loginName, passphrase: PASSPHRASE },
    });
    expect(login.statusCode).toBe(200);
    const freshCookie = login.cookies.find((c) => c.name === h.config.cookieName)!.value;
    const freshCsrf = (login.json() as { csrfToken: string }).csrfToken;
    const freshAuth: Auth = {
      cookie: freshCookie,
      csrf: freshCsrf,
      membershipId: (login.json() as { member: { id: string } }).member.id,
      installationEpoch:
        (login.json() as { installationEpoch?: number }).installationEpoch ??
        h.runtime.epoch,
    };
    const child = await call(h, freshAuth, "POST", "/api/v1/people", {
      mutationId: randomUUID(),
      displayName: "Fresh Link Child",
      classification: "child",
    });
    expect(child.statusCode).toBe(200);
    const childId = (child.json() as { person: { id: string } }).person.id;
    await reauth(h, freshAuth);
    const issue = await call(h, freshAuth, "POST", `/api/v1/people/${childId}/access-claims`, {
      mutationId: randomUUID(),
      purpose: "invitation",
    });
    expect(issue.statusCode).toBe(200);
    const freshToken = (issue.json() as { claim: { token: string } }).claim.token;
    const freshPreview = await h.app.inject({
      method: "GET",
      url: `/api/v1/auth/access-claims/preview?token=${encodeURIComponent(freshToken)}`,
      headers: { origin: h.origin },
    });
    expect(freshPreview.statusCode).toBe(200);
  });

  it("AT1: no-A-progress adoption creates guide row with null account/household timestamps", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    h.db.prepare(`DELETE FROM setup_progress`).run();
    const before = h.db.prepare(`SELECT COUNT(*) AS c FROM setup_progress`).get() as {
      c: number;
    };
    expect(before.c).toBe(0);
    const guide = await call(h, auth, "GET", "/api/v1/guide/progress");
    expect(guide.statusCode).toBe(200);
    const row = h.db
      .prepare(
        `SELECT account_completed_at, household_completed_at, people_status, guide_version
         FROM setup_progress LIMIT 1`,
      )
      .get() as {
      account_completed_at: string | null;
      household_completed_at: string | null;
      people_status: string;
      guide_version: number;
    };
    expect(row.account_completed_at).toBeNull();
    expect(row.household_completed_at).toBeNull();
    expect(row.people_status).toBe("not_chosen");
    expect(row.guide_version).toBe(0);
  });

  it("AT5/R4: responsibility draft preview returns composed stepTexts and guideSaveWork compares them", async () => {
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

    const draft = await call(h, auth, "POST", "/api/v1/responsibilities/preview-draft", {
      mutationId: randomUUID(),
      title: "Composed Chore",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: auth.membershipId,
      steps: [{ text: "Base step", obligation: "required" }],
      scheduledAdditions: [
        {
          name: "Extra wipe",
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          inheritAssignment: true,
          steps: [{ text: "Wipe counters", obligation: "required" }],
        },
      ],
    });
    expect(draft.statusCode).toBe(200);
    const preview = (
      draft.json() as {
        preview: Array<{
          applicable: boolean;
          householdDate: string;
          accountableMemberId: string | null;
          stepTexts?: string[];
        }>;
      }
    ).preview.filter((d) => d.applicable);
    expect(preview.length).toBeGreaterThan(0);
    expect(preview[0]!.stepTexts).toEqual(["Base step", "Wipe counters"]);

    const basis = {
      householdDate,
      calendarVersion,
      audienceGroupIds: [] as string[],
      audienceGroupVersions: {},
      reviewedResponsibilityOwnerId: auth.membershipId,
      reviewedResponsibilityDays: preview.map((d) => ({
        householdDate: d.householdDate,
        accountableMemberId: d.accountableMemberId,
        stepTexts: d.stepTexts,
      })),
    };
    const staleBasis = {
      ...basis,
      reviewedResponsibilityDays: basis.reviewedResponsibilityDays.map((d) => ({
        ...d,
        stepTexts: ["Base step"],
      })),
    };
    const denied = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version),
      status: "completed",
      responsibility: {
        mutationId: randomUUID(),
        title: "Composed Chore",
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        accountableMemberId: auth.membershipId,
        steps: [{ text: "Base step", obligation: "required" }],
        scheduledAdditions: [
          {
            name: "Extra wipe",
            weekdays: [1, 2, 3, 4, 5, 6, 7],
            inheritAssignment: true,
            steps: [{ text: "Wipe counters", obligation: "required" }],
          },
        ],
      },
      previewBasis: staleBasis,
    });
    expect(denied.statusCode).toBeGreaterThanOrEqual(400);

    const ok = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version),
      status: "completed",
      responsibility: {
        mutationId: randomUUID(),
        title: "Composed Chore",
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        accountableMemberId: auth.membershipId,
        steps: [{ text: "Base step", obligation: "required" }],
        scheduledAdditions: [
          {
            name: "Extra wipe",
            weekdays: [1, 2, 3, 4, 5, 6, 7],
            inheritAssignment: true,
            steps: [{ text: "Wipe counters", obligation: "required" }],
          },
        ],
      },
      previewBasis: basis,
    });
    expect(ok.statusCode).toBe(200);
  });

  it("AT6: guide calendar change after first action preserves started occurrence history", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const guide = await call(h, auth, "GET", "/api/v1/guide/progress");
    let version = (guide.json() as { guideVersion: number }).guideVersion;
    const school = await call(h, auth, "POST", "/api/v1/guide/school", {
      ...guideGuard(auth, version),
      status: "completed",
      calendar: {
        mutationId: randomUUID(),
        expectedVersion: 0,
        years: [
          {
            startDate: "2020-01-01",
            endDate: "2030-12-31",
            usualWeekdays: [1, 2, 3, 4, 5, 6, 7],
            exceptions: [],
          },
        ],
      },
    });
    expect(school.statusCode).toBe(200);
    version = (school.json() as { progress: { guideVersion: number } }).progress.guideVersion;
    const session = await call(h, auth, "GET", "/api/v1/auth/session");
    const householdDate = (session.json() as { householdDate: string }).householdDate;
    const calendar = await call(h, auth, "GET", "/api/v1/school-calendar");
    const calendarVersion = (calendar.json() as { calendar: { version: number } }).calendar.version;
    const draftPreview = await call(h, auth, "POST", "/api/v1/routines/preview-draft", {
      mutationId: randomUUID(),
      title: "Lock Routine",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [auth.membershipId],
      assigneeGroupIds: [],
      steps: [{ text: "Stretch", obligation: "required" }],
    });
    const applicable = (
      draftPreview.json() as {
        preview: Array<{
          applicable: boolean;
          householdDate: string;
          participantMemberIds: string[];
          stepTexts?: string[];
        }>;
      }
    ).preview.filter((d) => d.applicable);
    const work = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version),
      status: "completed",
      routine: {
        mutationId: randomUUID(),
        title: "Lock Routine",
        daypart: "morning",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assigneeMemberIds: [auth.membershipId],
        assigneeGroupIds: [],
        steps: [{ text: "Stretch", obligation: "required" }],
      },
      previewBasis: {
        householdDate,
        calendarVersion,
        audienceGroupIds: [],
        audienceGroupVersions: {},
        reviewedRoutineParticipantIds: applicable[0]?.participantMemberIds ?? [auth.membershipId],
        reviewedRoutineDays: applicable.map((d) => ({
          householdDate: d.householdDate,
          participantMemberIds: d.participantMemberIds,
          stepTexts: d.stepTexts ?? ["Stretch"],
        })),
      },
    });
    expect(work.statusCode).toBe(200);
    version = (work.json() as { progress: { guideVersion: number } }).progress.guideVersion;
    const routineId = (work.json() as { routine: { id: string } }).routine.id;

    const today = await call(h, auth, "GET", `/api/v1/today?date=${householdDate}`);
    expect(today.statusCode).toBe(200);
    const occ = (
      today.json() as {
        occurrences: Array<{
          id: string;
          definitionId: string;
          householdDate: string;
          revisionId: string;
          steps: Array<{ id: string; logicalItemId: string; status: string; text: string }>;
        }>;
      }
    ).occurrences.find((o) => o.definitionId === routineId);
    expect(occ).toBeTruthy();
    const firstAction = await call(
      h,
      auth,
      "POST",
      `/api/v1/occurrences/${occ!.id}/steps/${occ!.steps[0]!.id}/status`,
      {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        householdDate: occ!.householdDate,
        kind: "routine",
        intendedStructure: {
          revisionId: occ!.revisionId,
          accountableMemberId: auth.membershipId,
          stepLogicalIds: occ!.steps.map((s) => s.logicalItemId),
        },
      },
    );
    expect(firstAction.statusCode).toBe(200);
    expect(
      (firstAction.json() as { occurrence: { startedAt: string | null } }).occurrence.startedAt,
    ).toBeTruthy();

    const calAfterAction = await call(h, auth, "GET", "/api/v1/school-calendar");
    const calVersion = (calAfterAction.json() as { calendar: { version: number } }).calendar
      .version;
    const schoolChange = await call(h, auth, "POST", "/api/v1/guide/school", {
      ...guideGuard(auth, version),
      status: "completed",
      calendar: {
        mutationId: randomUUID(),
        expectedVersion: calVersion,
        years: [
          {
            startDate: "2020-01-01",
            endDate: "2030-12-31",
            usualWeekdays: [1, 2, 3, 4, 5],
            exceptions: [],
          },
        ],
      },
    });
    expect(schoolChange.statusCode).toBe(200);

    const history = await call(h, auth, "GET", `/api/v1/history/occurrences/${occ!.id}`);
    expect(history.statusCode).toBe(200);
    const hist = history.json() as {
      occurrence: { startedAt: string | null; steps: Array<{ text: string; status: string }> };
    };
    expect(hist.occurrence.startedAt).toBeTruthy();
    expect(hist.occurrence.steps[0]?.text).toBe("Stretch");
    expect(hist.occurrence.steps[0]?.status).toBe("completed");
  });

  it("AT7: unused responsibility deletes; used enrolled person departs with history", async () => {
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
    const draft = await call(h, auth, "POST", "/api/v1/responsibilities/preview-draft", {
      mutationId: randomUUID(),
      title: "Guide Responsibility",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: auth.membershipId,
      steps: [{ text: "Do chore", obligation: "required" }],
    });
    const applicable = (
      draft.json() as {
        preview: Array<{
          applicable: boolean;
          householdDate: string;
          accountableMemberId: string | null;
          stepTexts?: string[];
        }>;
      }
    ).preview.filter((d) => d.applicable);
    const work = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version),
      status: "completed",
      responsibility: {
        mutationId: randomUUID(),
        title: "Guide Responsibility",
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        accountableMemberId: auth.membershipId,
        steps: [{ text: "Do chore", obligation: "required" }],
      },
      previewBasis: {
        householdDate,
        calendarVersion,
        audienceGroupIds: [],
        audienceGroupVersions: {},
        reviewedResponsibilityOwnerId: auth.membershipId,
        reviewedResponsibilityDays: applicable.map((d) => ({
          householdDate: d.householdDate,
          accountableMemberId: d.accountableMemberId,
          stepTexts: d.stepTexts ?? ["Do chore"],
        })),
      },
    });
    expect(work.statusCode).toBe(200);
    const responsibility = (
      work.json() as { responsibility: { id: string; version: number } }
    ).responsibility;
    const deleted = await call(
      h,
      auth,
      "POST",
      `/api/v1/responsibilities/${responsibility.id}/delete`,
      {
        mutationId: randomUUID(),
        expectedVersion: responsibility.version,
      },
    );
    expect(deleted.statusCode).toBe(200);

    const child = await call(h, auth, "POST", "/api/v1/people", {
      mutationId: randomUUID(),
      displayName: "Used Enrolled",
      classification: "adult",
    });
    expect(child.statusCode).toBe(200);
    const person = (
      child.json() as {
        person: { id: string; version: number; authorityVersion: number };
      }
    ).person;
    await reauth(h, auth);
    const claim = await call(h, auth, "POST", `/api/v1/people/${person.id}/access-claims`, {
      mutationId: randomUUID(),
      purpose: "invitation",
    });
    expect(claim.statusCode).toBe(200);
    const token = (claim.json() as { claim: { token: string } }).claim.token;
    const redeem = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/access-claims/redeem",
      headers: { origin: h.origin, "content-type": "application/json" },
      payload: {
        claimToken: token,
        displayName: "Used Enrolled",
        loginName: `used.${Date.now().toString(36)}`,
        passphrase: PASSPHRASE,
      },
    });
    expect(redeem.statusCode).toBe(200);
    await reauth(h, auth);
    const people = await call(h, auth, "GET", `/api/v1/people/${person.id}`);
    const fresh = (
      people.json() as {
        person: { id: string; version: number; authorityVersion: number };
      }
    ).person;
    const preview = await call(h, auth, "POST", `/api/v1/people/${fresh.id}/removal/preview`, {
      expectedVersion: fresh.version,
      expectedAuthorityVersion: fresh.authorityVersion,
    });
    expect(preview.statusCode).toBe(200);
    expect((preview.json() as { impact: { mode: string } }).impact.mode).toBe("depart");
    const removed = await call(h, auth, "POST", `/api/v1/people/${fresh.id}/removal`, {
      mutationId: randomUUID(),
      expectedVersion: fresh.version,
      expectedAuthorityVersion: fresh.authorityVersion,
      previewDigest: (preview.json() as { previewDigest: string }).previewDigest,
      passphrase: PASSPHRASE,
      confirmationText: "REMOVE",
    });
    expect(removed.statusCode).toBe(200);
    expect((removed.json() as { mode: string }).mode).toBe("departed");
  });

  it("AT8: enrolled member without lifecycle.manage cannot read guide", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const created = await call(h, auth, "POST", "/api/v1/people", {
      mutationId: randomUUID(),
      displayName: "Plain Member",
      classification: "adult",
    });
    expect(created.statusCode).toBe(200);
    const person = (
      created.json() as {
        person: { id: string; version: number; authorityVersion: number };
      }
    ).person;
    await reauth(h, auth);
    const claim = await call(h, auth, "POST", `/api/v1/people/${person.id}/access-claims`, {
      mutationId: randomUUID(),
      purpose: "invitation",
    });
    const token = (claim.json() as { claim: { token: string } }).claim.token;
    const loginName = `plain.${Date.now().toString(36)}`;
    const redeem = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/access-claims/redeem",
      headers: { origin: h.origin, "content-type": "application/json" },
      payload: {
        claimToken: token,
        displayName: "Plain Member",
        loginName,
        passphrase: PASSPHRASE,
      },
    });
    expect(redeem.statusCode).toBe(200);
    const memberCookie = redeem.cookies.find((c) => c.name === h.config.cookieName)!.value;
    const memberCsrf = (redeem.json() as { csrfToken: string }).csrfToken;
    const memberAuth: Auth = {
      cookie: memberCookie,
      csrf: memberCsrf,
      membershipId: (redeem.json() as { member: { id: string } }).member.id,
      installationEpoch: auth.installationEpoch,
    };
    const denied = await call(h, memberAuth, "GET", "/api/v1/guide/progress");
    expect(denied.statusCode).toBe(403);
  });

  it("AT11: through-017 aged snapshot B restore migrates forward and keeps source bytes", async () => {
    const h = await createDHarness();
    await setupHousehold(h);
    const fixture = await createThrough017BackupFile(h.config.backupDir);
    const owner = await h.app.inject({
      method: "POST",
      url: "/api/v1/owner/session",
      headers: { origin: h.origin, "content-type": "application/json" },
      payload: { secret: OWNER_SECRET },
    });
    expect(owner.statusCode).toBe(200);
    const ownerCsrf = (owner.json() as { csrfToken: string }).csrfToken;
    const ownerCookie = owner.cookies.find((c) => c.name.includes("owner"))!.value;
    const registered = await h.app.inject({
      method: "POST",
      url: "/api/v1/owner/backups/register",
      headers: {
        origin: h.origin,
        "content-type": "application/json",
        "x-csrf-token": ownerCsrf,
        cookie: `${h.config.ownerCookieName}=${ownerCookie}`,
      },
      payload: { fileName: fixture.fileName, label: "Through017-on-D" },
    });
    expect(registered.statusCode).toBe(200);
    const backup = (
      registered.json() as { backup: { id: string; contentDigest: string } }
    ).backup;
    const sourceBytes = fs.readFileSync(fixture.absPath);
    const meta = await h.app.inject({ method: "GET", url: "/api/v1/meta" });
    const epoch = (meta.json() as { installationEpoch: number }).installationEpoch;
    const restore = await h.app.inject({
      method: "POST",
      url: "/api/v1/household/restore",
      headers: {
        origin: h.origin,
        "content-type": "application/json",
        "x-csrf-token": ownerCsrf,
        cookie: `${h.config.ownerCookieName}=${ownerCookie}`,
      },
      payload: {
        mutationId: randomUUID(),
        backupId: backup.id,
        expectedDigest: backup.contentDigest,
        expectedEpoch: epoch,
        confirmationText: "RESTORE",
        saveBackupBeforeRestore: false,
      },
    });
    expect(restore.statusCode).toBe(200);
    expect(fs.readFileSync(fixture.absPath)).toEqual(sourceBytes);
    expect(
      (
        h.runtime.db.prepare(`SELECT name FROM households LIMIT 1`).get() as {
          name: string;
        }
      ).name,
    ).toBe("Through017 Household");
    const tip = (
      h.runtime.db
        .prepare(`SELECT id FROM schema_migrations WHERE id LIKE '02%' ORDER BY id DESC LIMIT 1`)
        .get() as { id: string } | undefined
    )?.id;
    expect(tip).toMatch(/^02/);
  });

  it("C1/AT1: populated through-019 upgrade preserves actual grants, history, calendar, and departures", async () => {
    const dbPath = tempPath("hd-d-c1");
    const db = openPopulatedP019UpgradeDatabase(dbPath);
    const customGrant = "custom.archive.review";
    db.prepare(
      `INSERT INTO membership_grants (membership_id, grant_name) VALUES (?, ?)`,
    ).run(P014_FIXTURE_IDS.morganId, customGrant);
    const exceptionId = "99999999-9999-4999-8999-999999999903";
    db.prepare(
      `INSERT INTO school_exceptions (id, year_id, name, start_date, end_date, position)
       VALUES (?, ?, 'Winter break', '2026-12-21', '2027-01-02', 0)`,
    ).run(exceptionId, P009_FIXTURE_IDS.calendarYearId);

    const before = {
      grants: db
        .prepare(
          `SELECT membership_id, grant_name FROM membership_grants ORDER BY membership_id, grant_name`,
        )
        .all(),
      departed: db
        .prepare(
          `SELECT id, departed_at, departed_household_date FROM household_memberships
           WHERE departed_at IS NOT NULL ORDER BY id`,
        )
        .all(),
      year: db
        .prepare(
          `SELECT id, start_date, end_date, usual_weekdays_json FROM school_years WHERE id = ?`,
        )
        .get(P009_FIXTURE_IDS.calendarYearId),
      exception: db
        .prepare(`SELECT id, name, start_date, end_date FROM school_exceptions WHERE id = ?`)
        .get(exceptionId),
      started: db
        .prepare(
          `SELECT id, title, started_at, accountable_member_id FROM occurrences WHERE id = ?`,
        )
        .get(P013_FIXTURE_IDS.catsOccStartedId),
      steps: db
        .prepare(
          `SELECT id, occurrence_id, text, status FROM occurrence_steps
           WHERE occurrence_id = ? ORDER BY id`,
        )
        .all(P013_FIXTURE_IDS.catsOccStartedId),
      reports: db
        .prepare(
          `SELECT occurrence_id, occurrence_step_id, resulting_state FROM step_reports
           WHERE occurrence_id = ? ORDER BY occurrence_step_id, resulting_state`,
        )
        .all(P013_FIXTURE_IDS.catsOccStartedId),
      people: db
        .prepare(
          `SELECT id, display_name, user_id FROM household_memberships ORDER BY id`,
        )
        .all(),
      progress: db
        .prepare(
          `SELECT account_completed_at, household_completed_at FROM setup_progress LIMIT 1`,
        )
        .get(),
    };
    expect((before.reports as unknown[]).length).toBeGreaterThan(0);
    expect((before.steps as unknown[]).length).toBeGreaterThan(0);
    expect(before.grants).toEqual(
      expect.arrayContaining([
        { membership_id: P014_FIXTURE_IDS.morganId, grant_name: customGrant },
      ]),
    );
    expect(before.departed.length).toBeGreaterThan(0);
    expect(before.year).toBeTruthy();
    expect(before.exception).toMatchObject({ name: "Winter break" });
    expect(before.started).toBeTruthy();
    expect(
      (before.progress as { account_completed_at: string | null }).account_completed_at,
    ).toBeTruthy();

    migrate(db);
    migrate(db);
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
    expect(
      db
        .prepare(
          `SELECT membership_id, grant_name FROM membership_grants ORDER BY membership_id, grant_name`,
        )
        .all(),
    ).toEqual(before.grants);
    expect(
      db
        .prepare(
          `SELECT id, departed_at, departed_household_date FROM household_memberships
           WHERE departed_at IS NOT NULL ORDER BY id`,
        )
        .all(),
    ).toEqual(before.departed);
    expect(
      db
        .prepare(
          `SELECT id, start_date, end_date, usual_weekdays_json FROM school_years WHERE id = ?`,
        )
        .get(P009_FIXTURE_IDS.calendarYearId),
    ).toEqual(before.year);
    expect(
      db
        .prepare(`SELECT id, name, start_date, end_date FROM school_exceptions WHERE id = ?`)
        .get(exceptionId),
    ).toEqual(before.exception);
    expect(
      db
        .prepare(
          `SELECT id, title, started_at, accountable_member_id FROM occurrences WHERE id = ?`,
        )
        .get(P013_FIXTURE_IDS.catsOccStartedId),
    ).toEqual(before.started);
    expect(
      db
        .prepare(
          `SELECT id, occurrence_id, text, status FROM occurrence_steps
           WHERE occurrence_id = ? ORDER BY id`,
        )
        .all(P013_FIXTURE_IDS.catsOccStartedId),
    ).toEqual(before.steps);
    expect(
      db
        .prepare(
          `SELECT occurrence_id, occurrence_step_id, resulting_state FROM step_reports
           WHERE occurrence_id = ? ORDER BY occurrence_step_id, resulting_state`,
        )
        .all(P013_FIXTURE_IDS.catsOccStartedId),
    ).toEqual(before.reports);
    expect(
      db
        .prepare(`SELECT id, display_name, user_id FROM household_memberships ORDER BY id`)
        .all(),
    ).toEqual(before.people);
    const progressAfter = db
      .prepare(
        `SELECT account_completed_at, household_completed_at, people_status, guide_version
         FROM setup_progress LIMIT 1`,
      )
      .get() as {
      account_completed_at: string | null;
      household_completed_at: string | null;
      people_status: string;
      guide_version: number;
    };
    expect(progressAfter.account_completed_at).toBe(
      (before.progress as { account_completed_at: string }).account_completed_at,
    );
    expect(progressAfter.household_completed_at).toBe(
      (before.progress as { household_completed_at: string }).household_completed_at,
    );
    expect(progressAfter.people_status).toBe("not_chosen");
    expect(progressAfter.guide_version).toBe(0);
    const phc = await hashPassphrase(PASSPHRASE);
    const managerUser = db
      .prepare(
        `SELECT u.id AS id, u.login_name AS login_name
         FROM users u
         INNER JOIN household_memberships hm ON hm.user_id = u.id
         WHERE hm.id = ?`,
      )
      .get(P014_FIXTURE_IDS.morganId) as { id: string; login_name: string };
    expect(managerUser.login_name).toBeTruthy();
    db.prepare(`UPDATE user_credentials SET passphrase_phc = ? WHERE user_id = ?`).run(
      phc,
      managerUser.id,
    );
    db.close();

    // Pre-populate installation-control catalog + non-default epoch BEFORE adopt.
    const controlPath = tempPath("hd-d-c1-control");
    const control = InstallationControl.open(controlPath);
    const relativeDb = relativeDbPathFromConfig(dbPath);
    control.ensureAdopt(relativeDb);
    control.activateCandidate(4, relativeDb);
    const preexistingBackup = {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      householdId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      householdName: "Pre-adoption Household",
      createdAt: "2026-01-15T12:00:00.000Z",
      label: "pre-adoption catalog",
      schemaManifest: JSON.stringify(["019_member_access_removal.sql"]),
      formatVersion: 1,
      byteSize: 12345,
      contentDigest: "a".repeat(64),
      relativePath: "pre-adoption.sqlite",
      source: "app" as const,
    };
    control.insertBackup(preexistingBackup);
    const catalogSnapshot = (rows: ReturnType<InstallationControl["listBackups"]>) =>
      rows
        .map((b) => ({
          id: b.id,
          householdId: b.householdId,
          householdName: b.householdName,
          createdAt: b.createdAt,
          label: b.label,
          schemaManifest: b.schemaManifest,
          formatVersion: b.formatVersion,
          byteSize: b.byteSize,
          contentDigest: b.contentDigest,
          relativePath: b.relativePath,
          source: b.source,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    const catalogBefore = catalogSnapshot(control.listBackups());
    const epochBefore = control.getState().datasetEpoch;
    expect(epochBefore).toBe(4);
    expect(catalogBefore).toEqual([
      {
        id: preexistingBackup.id,
        householdId: preexistingBackup.householdId,
        householdName: preexistingBackup.householdName,
        createdAt: preexistingBackup.createdAt,
        label: preexistingBackup.label,
        schemaManifest: preexistingBackup.schemaManifest,
        formatVersion: preexistingBackup.formatVersion,
        byteSize: preexistingBackup.byteSize,
        contentDigest: preexistingBackup.contentDigest,
        relativePath: preexistingBackup.relativePath,
        source: preexistingBackup.source,
      },
    ]);
    control.close();

    const h = await createHttpHarness({
      AUTO_SEED: "0",
      INSTALLATION_OWNER_SECRET: OWNER_SECRET,
      DB_PATH: dbPath,
      INSTALLATION_CONTROL_PATH: controlPath,
      BACKUP_DIR: backupDirForTest(),
    });
    harnesses.push(h);
    expect(h.runtime.epoch).toBe(epochBefore);
    expect(catalogSnapshot(h.runtime.control.listBackups())).toEqual(catalogBefore);
    migrate(h.db);
    migrate(h.db);
    expect(h.runtime.epoch).toBe(epochBefore);
    expect(catalogSnapshot(h.runtime.control.listBackups())).toEqual(catalogBefore);

    const login = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: h.origin, "content-type": "application/json" },
      payload: { loginName: managerUser.login_name, passphrase: PASSPHRASE },
    });
    expect(login.statusCode, login.body).toBe(200);
    const cookie = login.cookies.find((c) => c.name === h.config.cookieName)!.value;
    const csrf = (login.json() as { csrfToken: string }).csrfToken;
    const auth: Auth = {
      cookie,
      csrf,
      membershipId: P014_FIXTURE_IDS.morganId,
      installationEpoch: epochBefore,
    };
    const guide = await call(h, auth, "GET", "/api/v1/guide/progress");
    expect(guide.statusCode).toBe(200);
    const meta = await h.app.inject({ method: "GET", url: "/api/v1/meta" });
    expect((meta.json() as { setupRequired: boolean; installationEpoch: number }).setupRequired).toBe(
      false,
    );
    expect((meta.json() as { installationEpoch: number }).installationEpoch).toBe(epochBefore);
    expect(catalogSnapshot(h.runtime.control.listBackups())).toEqual(catalogBefore);
  });

  it("C1/AT1: through-019 without A progress does not invent completion timestamps", async () => {
    const dbPath = tempPath("hd-d-c1-noa");
    const db = openPopulatedP019UpgradeDatabase(dbPath);
    db.prepare(`DELETE FROM setup_progress`).run();
    migrate(db);
    migrate(db);
    expect(db.prepare(`SELECT COUNT(*) AS c FROM setup_progress`).get()).toEqual({ c: 0 });
    const phc = await hashPassphrase(PASSPHRASE);
    const managerUser = db
      .prepare(
        `SELECT u.id AS id, u.login_name AS login_name
         FROM users u
         INNER JOIN household_memberships hm ON hm.user_id = u.id
         WHERE hm.id = ?`,
      )
      .get(P014_FIXTURE_IDS.morganId) as { id: string; login_name: string };
    db.prepare(`UPDATE user_credentials SET passphrase_phc = ? WHERE user_id = ?`).run(
      phc,
      managerUser.id,
    );
    db.close();
    const controlPath = tempPath("hd-d-c1-noa-control");
    const seededControl = InstallationControl.open(controlPath);
    seededControl.ensureAdopt(relativeDbPathFromConfig(dbPath));
    seededControl.close();
    const h = await createHttpHarness({
      AUTO_SEED: "0",
      INSTALLATION_OWNER_SECRET: OWNER_SECRET,
      DB_PATH: dbPath,
      INSTALLATION_CONTROL_PATH: controlPath,
      BACKUP_DIR: backupDirForTest(),
    });
    harnesses.push(h);
    const login = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: h.origin, "content-type": "application/json" },
      payload: { loginName: managerUser.login_name, passphrase: PASSPHRASE },
    });
    expect(login.statusCode, login.body).toBe(200);
    const cookie = login.cookies.find((c) => c.name === h.config.cookieName)!.value;
    const csrf = (login.json() as { csrfToken: string }).csrfToken;
    const guide = await call(
      h,
      {
        cookie,
        csrf,
        membershipId: P014_FIXTURE_IDS.morganId,
        installationEpoch: h.runtime.epoch,
      },
      "GET",
      "/api/v1/guide/progress",
    );
    expect(guide.statusCode).toBe(200);
    const row = h.db
      .prepare(
        `SELECT account_completed_at, household_completed_at, people_status FROM setup_progress LIMIT 1`,
      )
      .get() as {
      account_completed_at: string | null;
      household_completed_at: string | null;
      people_status: string;
    };
    expect(row.account_completed_at).toBeNull();
    expect(row.household_completed_at).toBeNull();
    expect(row.people_status).toBe("not_chosen");
    const meta = await h.app.inject({ method: "GET", url: "/api/v1/meta" });
    expect((meta.json() as { setupRequired: boolean }).setupRequired).toBe(false);
  });

  it("C2/AT5: controlled-date preview agrees with saved work and stale consent conflicts", async () => {
    // Explicit harness household date (no production clock). Monday keeps weekday math stable.
    // Resolver internals for assignment/phase remain covered by P0-007B AT2.
    const CONTROLLED_TODAY = "2026-03-09";
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    vi.spyOn(h.store, "householdDateNow").mockReturnValue(CONTROLLED_TODAY);
    vi.spyOn(h.store, "householdDateNowForHousehold").mockReturnValue(CONTROLLED_TODAY);
    const today = CONTROLLED_TODAY;
    const weekday = isoWeekdayForHouseholdDate(today);
    expect(weekday).toBe(1);
    const other = 2;
    const counts = () => ({
      routines: (h.db.prepare(`SELECT COUNT(*) AS c FROM routine_definitions`).get() as { c: number }).c,
      occurrences: (h.db.prepare(`SELECT COUNT(*) AS c FROM occurrences`).get() as { c: number }).c,
      responsibilities: (
        h.db
          .prepare(`SELECT COUNT(*) AS c FROM routine_definitions WHERE kind = 'responsibility'`)
          .get() as { c: number }
      ).c,
    });

    type PreviewDay = {
      applicable: boolean;
      householdDate: string;
      participantMemberIds?: string[];
      accountableMemberId?: string | null;
      stepTexts?: string[];
    };

    async function calendarVersionNow(): Promise<number> {
      const calendar = await call(h, auth, "GET", "/api/v1/school-calendar");
      return (calendar.json() as { calendar: { version: number } }).calendar.version;
    }

    type SavedPreviewDay = {
      householdDate: string;
      applicable: boolean;
      accountableMemberId: string | null;
      stepCount?: number;
      stepTexts?: string[];
    };

    async function saveResponsibilityParity(input: {
      version: number;
      title: string;
      responsibility: Record<string, unknown>;
      reviewedDays: PreviewDay[];
      expectedOwner: string | null;
      expectedSteps: string[];
      expectedMode: string;
      /** When set, compare every draft applicable day to the saved definition preview. */
      requireDistinctOwners?: boolean;
    }): Promise<number> {
      const calVersion = await calendarVersionNow();
      const applicable = input.reviewedDays.filter((d) => d.applicable);
      const basis = {
        householdDate: today,
        calendarVersion: calVersion,
        audienceGroupIds: [] as string[],
        audienceGroupVersions: {},
        reviewedResponsibilityOwnerId: input.expectedOwner,
        reviewedResponsibilityDays: (applicable.length ? applicable : input.reviewedDays).map(
          (d) => ({
            householdDate: d.householdDate,
            accountableMemberId: d.accountableMemberId ?? null,
            stepTexts: d.stepTexts ?? [],
          }),
        ),
      };
      const saved = await call(h, auth, "POST", "/api/v1/guide/work", {
        ...guideGuard(auth, input.version),
        status: "completed",
        responsibility: input.responsibility,
        previewBasis: basis,
      });
      expect(saved.statusCode, saved.body).toBe(200);
      const body = saved.json() as {
        responsibility: { id: string };
        progress: { guideVersion: number };
      };
      const loaded = await call(h, auth, "GET", `/api/v1/responsibilities/${body.responsibility.id}`);
      expect(loaded.statusCode, loaded.body).toBe(200);
      const revision = (
        loaded.json() as {
          responsibility: {
            revisions: Array<{
              assignment?: { mode: string; fixedMemberId?: string | null };
              steps: Array<{ text: string }>;
              scheduledAdditions?: Array<{
                inheritAssignment: boolean;
                assignment?: { mode: string; fixedMemberId?: string | null };
                steps: Array<{ text: string }>;
              }>;
            }>;
          };
        }
      ).responsibility.revisions[0]!;
      expect(revision.assignment?.mode).toBe(input.expectedMode);
      const orderedSaved = [
        ...revision.steps.map((s) => s.text),
        ...(revision.scheduledAdditions ?? []).flatMap((addition) =>
          addition.steps.map((s) => s.text),
        ),
      ];
      expect(orderedSaved).toEqual(input.expectedSteps);
      const savedPreview = await call(
        h,
        auth,
        "GET",
        `/api/v1/responsibilities/${body.responsibility.id}/preview`,
      );
      expect(savedPreview.statusCode, savedPreview.body).toBe(200);
      const savedDays = (savedPreview.json() as { preview: SavedPreviewDay[] }).preview;
      if (input.requireDistinctOwners) {
        const draftOwners = [
          ...new Set(
            applicable.map((d) => d.accountableMemberId ?? null).filter((id) => id != null),
          ),
        ];
        expect(draftOwners.length).toBeGreaterThanOrEqual(2);
        expect(applicable.length).toBeGreaterThanOrEqual(2);
        for (const draftDay of applicable) {
          const savedDay = savedDays.find((d) => d.householdDate === draftDay.householdDate);
          expect(savedDay, draftDay.householdDate).toBeTruthy();
          expect(savedDay!.applicable).toBe(true);
          expect(savedDay!.accountableMemberId ?? null).toBe(draftDay.accountableMemberId ?? null);
          const orderedWork = draftDay.stepTexts ?? [];
          expect(orderedWork).toEqual(input.expectedSteps);
          expect(savedDay!.stepCount).toBe(orderedWork.length);
          if (savedDay!.stepTexts) {
            expect(savedDay!.stepTexts).toEqual(orderedWork);
          }
        }
      } else {
        const savedDay = savedDays.find((d) => d.applicable);
        expect(savedDay?.accountableMemberId ?? null).toBe(input.expectedOwner);
        expect(savedDay?.stepCount).toBe(input.expectedSteps.length);
      }
      return body.progress.guideVersion;
    }

    const child = await call(h, auth, "POST", "/api/v1/people", {
      mutationId: randomUUID(),
      displayName: "Only Child",
      classification: "child",
    });
    expect(child.statusCode).toBe(200);
    const childId = (child.json() as { person: { id: string } }).person.id;
    const before = counts();
    const routinePreview = await call(h, auth, "POST", "/api/v1/routines/preview-draft", {
      mutationId: randomUUID(),
      title: "Weekday Later",
      daypart: "morning",
      weekdays: [other],
      assigneeMemberIds: [childId],
      assigneeGroupIds: [],
      steps: [
        { text: "First", obligation: "required" },
        { text: "Second", obligation: "required" },
      ],
    });
    expect(routinePreview.statusCode).toBe(200);
    expect(counts()).toEqual(before);
    const body = routinePreview.json() as {
      preview: PreviewDay[];
      nextKnownDate: string | null;
    };
    const applicable = body.preview.filter((d) => d.applicable);
    expect(body.preview.find((d) => d.householdDate === today)?.applicable).toBe(false);
    expect(applicable.length > 0 || body.nextKnownDate != null).toBe(true);
    if (applicable[0]) {
      expect(applicable[0].participantMemberIds).toEqual([childId]);
      expect(applicable[0].stepTexts).toEqual(["First", "Second"]);
    }

    const guide = await call(h, auth, "GET", "/api/v1/guide/progress");
    let version = (guide.json() as { guideVersion: number }).guideVersion;
    const calendarVersion = await calendarVersionNow();
    const basis = {
      householdDate: today,
      calendarVersion,
      audienceGroupIds: [] as string[],
      audienceGroupVersions: {},
      reviewedRoutineParticipantIds: applicable[0]?.participantMemberIds ?? [],
      reviewedRoutineDays: (applicable.length ? applicable : body.preview).map((d) => ({
        householdDate: d.householdDate,
        participantMemberIds: d.participantMemberIds ?? [],
        stepTexts: d.stepTexts ?? [],
      })),
    };
    const staleDate = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version),
      status: "completed",
      routine: {
        mutationId: randomUUID(),
        title: "Weekday Later",
        daypart: "morning",
        weekdays: [other],
        assigneeMemberIds: [childId],
        assigneeGroupIds: [],
        steps: [
          { text: "First", obligation: "required" },
          { text: "Second", obligation: "required" },
        ],
      },
      previewBasis: { ...basis, householdDate: addHouseholdDays(today, -1) },
    });
    expect(staleDate.statusCode).toBeGreaterThanOrEqual(400);
    expect(counts().routines).toBe(before.routines);

    const absent = await call(h, auth, "POST", "/api/v1/routines/preview-draft", {
      mutationId: randomUUID(),
      title: "No Calendar",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [childId],
      assigneeGroupIds: [],
      steps: [{ text: "Pack", obligation: "required", applicability: { kind: "school_days" } }],
    });
    expect(absent.statusCode, absent.body).toBe(200);
    const absentBody = absent.json() as {
      preview: Array<{ applicable: boolean; householdDate: string }>;
      nextKnownDate: string | null;
      noKnownReason: string | null;
    };
    expect(absentBody.preview.every((d) => !d.applicable)).toBe(true);
    expect(absentBody.nextKnownDate).toBeNull();
    expect(absentBody.noKnownReason).toBe("No applicable date in the next four months");
    expect(counts()).toEqual(before);

    const schoolStart = addHouseholdDays(today, 10);
    const schoolEnd = addHouseholdDays(today, 40);
    const school = await call(h, auth, "POST", "/api/v1/guide/school", {
      ...guideGuard(auth, version),
      status: "completed",
      calendar: {
        mutationId: randomUUID(),
        expectedVersion: calendarVersion,
        years: [
          {
            startDate: schoolStart,
            endDate: schoolEnd,
            usualWeekdays: [1, 2, 3, 4, 5, 6, 7],
            exceptions: [],
          },
        ],
      },
    });
    expect(school.statusCode).toBe(200);
    version = (school.json() as { progress: { guideVersion: number } }).progress.guideVersion;
    const schoolPreview = await call(h, auth, "POST", "/api/v1/routines/preview-draft", {
      mutationId: randomUUID(),
      title: "School Later",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [childId],
      assigneeGroupIds: [],
      steps: [{ text: "Pack", obligation: "required", applicability: { kind: "school_days" } }],
    });
    expect(schoolPreview.statusCode, schoolPreview.body).toBe(200);
    const schoolBody = schoolPreview.json() as {
      preview: Array<{ applicable: boolean; householdDate: string }>;
      nextKnownDate: string | null;
      noKnownReason: string | null;
    };
    expect(schoolBody.preview.every((d) => !d.applicable || d.householdDate >= schoolStart)).toBe(
      true,
    );
    expect(schoolBody.nextKnownDate).toBe(schoolStart);
    expect(schoolBody.noKnownReason).toBeNull();
    vi.mocked(h.store.householdDateNow).mockReturnValue(schoolStart);
    vi.mocked(h.store.householdDateNowForHousehold).mockReturnValue(schoolStart);
    const schoolStartPreview = await call(h, auth, "POST", "/api/v1/routines/preview-draft", {
      mutationId: randomUUID(),
      title: "School Later",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [childId],
      assigneeGroupIds: [],
      steps: [{ text: "Pack", obligation: "required", applicability: { kind: "school_days" } }],
    });
    expect(schoolStartPreview.statusCode, schoolStartPreview.body).toBe(200);
    expect(
      (
        schoolStartPreview.json() as {
          preview: Array<{ householdDate: string; applicable: boolean }>;
        }
      ).preview.find((d) => d.householdDate === schoolStart)?.applicable,
    ).toBe(true);
    vi.mocked(h.store.householdDateNow).mockReturnValue(today);
    vi.mocked(h.store.householdDateNowForHousehold).mockReturnValue(today);

    const sibling = await call(h, auth, "POST", "/api/v1/people", {
      mutationId: randomUUID(),
      displayName: "Sibling Child",
      classification: "child",
    });
    expect(sibling.statusCode).toBe(200);
    const siblingId = (sibling.json() as { person: { id: string } }).person.id;

    const group = await call(h, auth, "POST", "/api/v1/groups", {
      mutationId: randomUUID(),
      name: "Empty ring",
      membershipIds: [childId],
    });
    expect(group.statusCode, group.body).toBe(200);
    const groupId = (group.json() as { group: { id: string } }).group.id;

    const rotateGroup = await call(h, auth, "POST", "/api/v1/groups", {
      mutationId: randomUUID(),
      name: "Two-child ring",
      membershipIds: [childId, siblingId],
    });
    expect(rotateGroup.statusCode, rotateGroup.body).toBe(200);
    const rotateGroupId = (rotateGroup.json() as { group: { id: string } }).group.id;

    const unassignedPayload = {
      mutationId: randomUUID(),
      title: "Unassigned Chore",
      daypart: "anytime" as const,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: {
        mode: "take_turns" as const,
        anchorDate: today,
        sourceGroupId: groupId,
        savedRingOrder: [childId],
        excludedMemberIds: [childId],
      },
      steps: [{ text: "Sweep", obligation: "required" as const }],
    };
    const unassigned = await call(
      h,
      auth,
      "POST",
      "/api/v1/responsibilities/preview-draft",
      unassignedPayload,
    );
    expect(unassigned.statusCode, unassigned.body).toBe(200);
    const unassignedDays = (
      unassigned.json() as { preview: PreviewDay[] }
    ).preview;
    const unassignedDay = unassignedDays.find((d) => d.applicable);
    expect(unassignedDay?.accountableMemberId ?? null).toBeNull();
    expect(unassignedDay?.stepTexts).toEqual(["Sweep"]);
    version = await saveResponsibilityParity({
      version,
      title: "Unassigned Chore",
      responsibility: unassignedPayload,
      reviewedDays: unassignedDays,
      expectedOwner: null,
      expectedSteps: ["Sweep"],
      expectedMode: "take_turns",
    });

    const cyclicPayload = {
      mutationId: randomUUID(),
      title: "Cyclic Chore",
      daypart: "anytime" as const,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: {
        mode: "take_turns" as const,
        anchorDate: today,
        sourceGroupId: rotateGroupId,
        savedRingOrder: [childId, siblingId],
        excludedMemberIds: [] as string[],
      },
      steps: [{ text: "Rotate", obligation: "required" as const }],
    };
    const cyclic = await call(h, auth, "POST", "/api/v1/responsibilities/preview-draft", cyclicPayload);
    expect(cyclic.statusCode, cyclic.body).toBe(200);
    const cyclicDays = (cyclic.json() as { preview: PreviewDay[] }).preview;
    const cyclicApplicable = cyclicDays.filter((d) => d.applicable);
    expect(cyclicApplicable.length).toBeGreaterThanOrEqual(2);
    const cyclicOwners = [
      ...new Set(cyclicApplicable.map((d) => d.accountableMemberId).filter(Boolean)),
    ];
    expect(cyclicOwners.sort()).toEqual([childId, siblingId].sort());
    expect(cyclicApplicable.every((d) => d.stepTexts?.join() === "Rotate")).toBe(true);
    version = await saveResponsibilityParity({
      version,
      title: "Cyclic Chore",
      responsibility: cyclicPayload,
      reviewedDays: cyclicDays,
      expectedOwner: cyclicApplicable[0]?.accountableMemberId ?? childId,
      expectedSteps: ["Rotate"],
      expectedMode: "take_turns",
      requireDistinctOwners: true,
    });

    const grouped = await call(h, auth, "POST", "/api/v1/routines/preview-draft", {
      mutationId: randomUUID(),
      title: "Child Group",
      daypart: "morning",
      weekdays: [weekday],
      assigneeMemberIds: [],
      assigneeGroupIds: [groupId],
      steps: [
        { text: "First", obligation: "required" },
        { text: "Second", obligation: "required" },
      ],
    });
    expect(grouped.statusCode, grouped.body).toBe(200);
    const groupedDays = (grouped.json() as { preview: PreviewDay[] }).preview;
    const groupedDay = groupedDays.find((d) => d.applicable);
    expect(groupedDay?.participantMemberIds).toEqual([childId]);
    expect(groupedDay?.participantMemberIds ?? []).not.toContain(auth.membershipId);
    expect(groupedDay?.stepTexts).toEqual(["First", "Second"]);
    {
      const calVersion = await calendarVersionNow();
      const groupedSave = await call(h, auth, "POST", "/api/v1/guide/work", {
        ...guideGuard(auth, version),
        status: "completed",
        routine: {
          mutationId: randomUUID(),
          title: "Child Group",
          daypart: "morning",
          weekdays: [weekday],
          assigneeMemberIds: [],
          assigneeGroupIds: [groupId],
          steps: [
            { text: "First", obligation: "required" },
            { text: "Second", obligation: "required" },
          ],
        },
        previewBasis: {
          householdDate: today,
          calendarVersion: calVersion,
          audienceGroupIds: [] as string[],
          audienceGroupVersions: {},
          reviewedRoutineParticipantIds: groupedDay?.participantMemberIds ?? [childId],
          reviewedRoutineDays: groupedDays
            .filter((d) => d.applicable)
            .map((d) => ({
              householdDate: d.householdDate,
              participantMemberIds: d.participantMemberIds ?? [],
              stepTexts: d.stepTexts ?? [],
            })),
        },
      });
      expect(groupedSave.statusCode, groupedSave.body).toBe(200);
      version = (groupedSave.json() as { progress: { guideVersion: number } }).progress.guideVersion;
      const groupedId = (groupedSave.json() as { routine: { id: string } }).routine.id;
      const loadedGroup = await call(h, auth, "GET", `/api/v1/routines/${groupedId}`);
      const groupRev = (
        loadedGroup.json() as {
          routine: {
            revisions: Array<{
              assigneeMemberIds: string[];
              assigneeGroupIds: string[];
              steps: Array<{ text: string }>;
            }>;
          };
        }
      ).routine.revisions[0]!;
      expect(groupRev.assigneeGroupIds).toEqual([groupId]);
      expect(groupRev.assigneeMemberIds).toEqual([]);
      expect(groupRev.steps.map((s) => s.text)).toEqual(["First", "Second"]);
      expect(groupedDay?.participantMemberIds).toEqual([childId]);
      expect(groupedDay?.stepTexts).toEqual(groupRev.steps.map((s) => s.text));
    }

    const fixedPayload = {
      mutationId: randomUUID(),
      title: "Fixed Chore",
      daypart: "anytime" as const,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: childId,
      assignment: { mode: "fixed" as const, anchorDate: today, fixedMemberId: childId },
      steps: [{ text: "Wipe", obligation: "required" as const }],
      scheduledAdditions: [
        {
          name: "Extra",
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          inheritAssignment: false,
          assignment: { mode: "fixed" as const, anchorDate: today, fixedMemberId: auth.membershipId },
          steps: [{ text: "Parent extra", obligation: "required" as const }],
        },
      ],
    };
    const fixed = await call(h, auth, "POST", "/api/v1/responsibilities/preview-draft", fixedPayload);
    expect(fixed.statusCode, fixed.body).toBe(200);
    const fixedDays = (fixed.json() as { preview: PreviewDay[] }).preview;
    const fixedDay = fixedDays.find((d) => d.applicable);
    expect(fixedDay?.stepTexts).toEqual(["Wipe", "Parent extra"]);
    // Day owner follows the composed review (base fixed child; independently assigned addition keeps own owner).
    expect(fixedDay?.accountableMemberId ?? null).not.toBeNull();
    version = await saveResponsibilityParity({
      version,
      title: "Fixed Chore",
      responsibility: fixedPayload,
      reviewedDays: fixedDays,
      expectedOwner: fixedDay?.accountableMemberId ?? null,
      expectedSteps: ["Wipe", "Parent extra"],
      expectedMode: "fixed",
    });
    {
      const listed = await call(h, auth, "GET", "/api/v1/guide/progress");
      const workIds = (listed.json() as { workDefinitionIds: string[] }).workDefinitionIds;
      const fixedId = workIds.at(-1)!;
      const loadedFixed = await call(h, auth, "GET", `/api/v1/responsibilities/${fixedId}`);
      const addition = (
        loadedFixed.json() as {
          responsibility: {
            revisions: Array<{
              scheduledAdditions?: Array<{
                inheritAssignment: boolean;
                assignment?: { fixedMemberId?: string | null };
                steps: Array<{ text: string }>;
              }>;
            }>;
          };
        }
      ).responsibility.revisions[0]!.scheduledAdditions?.[0];
      expect(addition?.inheritAssignment).toBe(false);
      expect(addition?.assignment?.fixedMemberId).toBe(auth.membershipId);
      expect(addition?.steps.map((s) => s.text)).toEqual(["Parent extra"]);
    }

    // Different owners on at least Mon (1) and Tue (2); remaining days alternate.
    const weeklyMap: Record<string, string> = {
      "1": childId,
      "2": siblingId,
      "3": childId,
      "4": siblingId,
      "5": childId,
      "6": siblingId,
      "7": childId,
    };
    const weeklyPayload = {
      mutationId: randomUUID(),
      title: "Weekly Chore",
      daypart: "anytime" as const,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: { mode: "weekly" as const, anchorDate: today, weeklyMap },
      steps: [{ text: "Weekly wipe", obligation: "required" as const }],
    };
    const weekly = await call(h, auth, "POST", "/api/v1/responsibilities/preview-draft", weeklyPayload);
    expect(weekly.statusCode, weekly.body).toBe(200);
    const weeklyDays = (weekly.json() as { preview: PreviewDay[] }).preview;
    const weeklyToday = weeklyDays.find((d) => d.householdDate === today);
    const weeklyTomorrow = weeklyDays.find((d) => d.householdDate === addHouseholdDays(today, 1));
    expect(weeklyToday?.accountableMemberId).toBe(childId);
    expect(weeklyTomorrow?.accountableMemberId).toBe(siblingId);
    expect(weeklyToday?.stepTexts).toEqual(["Weekly wipe"]);
    expect(weeklyTomorrow?.stepTexts).toEqual(["Weekly wipe"]);
    version = await saveResponsibilityParity({
      version,
      title: "Weekly Chore",
      responsibility: weeklyPayload,
      reviewedDays: weeklyDays,
      expectedOwner: childId,
      expectedSteps: ["Weekly wipe"],
      expectedMode: "weekly",
      requireDistinctOwners: true,
    });
    expect(
      (h.db.prepare(`SELECT COUNT(*) AS c FROM step_reports`).get() as { c: number }).c,
    ).toBe(0);

    const routinesBeforeWeekday = counts().routines;
    const sourceChanged = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version),
      status: "completed",
      routine: {
        mutationId: randomUUID(),
        title: "Weekday Later",
        daypart: "morning",
        weekdays: [other],
        assigneeMemberIds: [childId],
        assigneeGroupIds: [],
        steps: [
          { text: "First", obligation: "required" },
          { text: "Second", obligation: "required" },
        ],
      },
      previewBasis: basis,
    });
    expect(sourceChanged.statusCode).toBeGreaterThanOrEqual(400);
    expect(counts().routines).toBe(routinesBeforeWeekday);
    expect((await call(h, auth, "GET", "/api/v1/guide/progress")).json()).toMatchObject({
      guideVersion: version,
    });

    const freshVersion = await calendarVersionNow();
    const saved = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version),
      status: "completed",
      routine: {
        mutationId: randomUUID(),
        title: "Weekday Later",
        daypart: "morning",
        weekdays: [other],
        assigneeMemberIds: [childId],
        assigneeGroupIds: [],
        steps: [
          { text: "First", obligation: "required" },
          { text: "Second", obligation: "required" },
        ],
      },
      previewBasis: { ...basis, calendarVersion: freshVersion },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const savedBody = saved.json() as {
      routine: { id: string; version: number };
      progress: { guideVersion: number };
    };
    const routineId = savedBody.routine.id;
    const loadedRoutine = await call(h, auth, "GET", `/api/v1/routines/${routineId}`);
    const routineRev = (
      loadedRoutine.json() as {
        routine: {
          revisions: Array<{
            assigneeMemberIds: string[];
            steps: Array<{ text: string }>;
          }>;
        };
      }
    ).routine.revisions[0]!;
    expect(routineRev.assigneeMemberIds).toEqual([childId]);
    expect(routineRev.steps.map((s) => s.text)).toEqual(["First", "Second"]);
    expect(applicable[0]?.participantMemberIds ?? [childId]).toEqual(routineRev.assigneeMemberIds);
    expect(applicable[0]?.stepTexts ?? ["First", "Second"]).toEqual(
      routineRev.steps.map((s) => s.text),
    );

    const todayView = await call(h, auth, "GET", `/api/v1/today?date=${today}`);
    const occIds = (
      todayView.json() as { occurrences: Array<{ definitionId: string }> }
    ).occurrences.map((o) => o.definitionId);
    expect(occIds).not.toContain(routineId);

    const futureDate = addHouseholdDays(today, 1);
    const futureEdit = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, savedBody.progress.guideVersion),
      reviseTarget: {
        kind: "routine",
        definitionId: routineId,
        expectedVersion: savedBody.routine.version,
        mode: "schedule",
        effectiveDate: futureDate,
      },
      routine: {
        mutationId: randomUUID(),
        title: "Future Edit",
        daypart: "morning",
        weekdays: [other],
        assigneeMemberIds: [childId],
        assigneeGroupIds: [],
        steps: [
          { text: "First", obligation: "required" },
          { text: "Second", obligation: "required" },
        ],
      },
      previewBasis: { ...basis, calendarVersion: freshVersion },
    });
    expect(futureEdit.statusCode, futureEdit.body).toBe(200);
    const afterFuture = await call(h, auth, "GET", `/api/v1/routines/${routineId}`);
    const revisions = (
      afterFuture.json() as {
        routine: { revisions: Array<{ title: string; effectiveDate: string }> };
      }
    ).routine.revisions;
    const current = revisions
      .filter((revision) => revision.effectiveDate <= today)
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
      .at(-1);
    expect(current?.title).toBe("Weekday Later");
    expect(revisions.some((revision) => revision.title === "Future Edit" && revision.effectiveDate === futureDate)).toBe(
      true,
    );
    const todayAfter = await call(h, auth, "GET", `/api/v1/today?date=${today}`);
    expect(
      (todayAfter.json() as { occurrences: Array<{ definitionId: string }> }).occurrences.map(
        (o) => o.definitionId,
      ),
    ).not.toContain(routineId);
  });

  it("C4/AT11: through-018 and through-019 snapshots restore through B and keep source bytes", async () => {
    for (const tip of ["018_household_lifecycle.sql", "019_member_access_removal.sql"] as const) {
      const h = await createDHarness();
      await setupHousehold(h);
      const fixture = await createThroughTipBackupFile(h.config.backupDir, tip);
      expect(fixture.schemaManifest.at(-1)).toBe(tip);
      expect(fixture.schemaManifest.some((id) => id.startsWith("020_"))).toBe(false);
      const owner = await h.app.inject({
        method: "POST",
        url: "/api/v1/owner/session",
        headers: { origin: h.origin, "content-type": "application/json" },
        payload: { secret: OWNER_SECRET },
      });
      const ownerCsrf = (owner.json() as { csrfToken: string }).csrfToken;
      const ownerCookie = owner.cookies.find((c) => c.name.includes("owner"))!.value;
      const registered = await h.app.inject({
        method: "POST",
        url: "/api/v1/owner/backups/register",
        headers: {
          origin: h.origin,
          "content-type": "application/json",
          "x-csrf-token": ownerCsrf,
          cookie: `${h.config.ownerCookieName}=${ownerCookie}`,
        },
        payload: { fileName: fixture.fileName, label: tip },
      });
      expect(registered.statusCode, registered.body).toBe(200);
      const backup = (
        registered.json() as { backup: { id: string; contentDigest: string } }
      ).backup;
      const meta = await h.app.inject({ method: "GET", url: "/api/v1/meta" });
      const epoch = (meta.json() as { installationEpoch: number }).installationEpoch;
      const catalogBefore = h.runtime.control.listBackups().map((b) => b.id);
      const restore = await h.app.inject({
        method: "POST",
        url: "/api/v1/household/restore",
        headers: {
          origin: h.origin,
          "content-type": "application/json",
          "x-csrf-token": ownerCsrf,
          cookie: `${h.config.ownerCookieName}=${ownerCookie}`,
        },
        payload: {
          mutationId: randomUUID(),
          backupId: backup.id,
          expectedDigest: backup.contentDigest,
          expectedEpoch: epoch,
          confirmationText: "RESTORE",
          saveBackupBeforeRestore: false,
        },
      });
      expect(restore.statusCode, restore.body).toBe(200);
      expect(fs.readFileSync(fixture.absPath)).toEqual(fixture.sourceBytes);
      expect((h.runtime.db.prepare(`SELECT name FROM households LIMIT 1`).get() as { name: string }).name).toBe(
        fixture.householdName,
      );
      expect(
        (
          h.runtime.db
            .prepare(`SELECT id FROM schema_migrations WHERE id = ?`)
            .get("020_guided_setup_progress.sql") as { id: string } | undefined
        )?.id,
      ).toBe("020_guided_setup_progress.sql");
      expect(h.runtime.epoch).toBeGreaterThan(epoch);
      expect(h.runtime.control.listBackups().map((b) => b.id)).toEqual(
        expect.arrayContaining(catalogBefore),
      );
    }
  });

  it("C4/AT11: reset during incomplete guide leaves no carried progress", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const guide = await call(h, auth, "GET", "/api/v1/guide/progress");
    const version = (guide.json() as { guideVersion: number }).guideVersion;
    const skipped = await call(h, auth, "POST", "/api/v1/guide/people/complete", {
      ...guideGuard(auth, version),
      status: "skipped",
    });
    expect(skipped.statusCode).toBe(200);
    expect((skipped.json() as { progress: { peopleStatus: string } }).progress.peopleStatus).toBe(
      "skipped",
    );
    await reauth(h, auth);
    const meta = await h.app.inject({ method: "GET", url: "/api/v1/meta" });
    const reset = await call(h, auth, "POST", "/api/v1/household/reset", {
      mutationId: randomUUID(),
      confirmationText: "RESET",
      expectedEpoch: (meta.json() as { installationEpoch: number }).installationEpoch,
      saveBackupBeforeReset: false,
    });
    expect(reset.statusCode).toBe(200);
    const metaAfter = await h.app.inject({ method: "GET", url: "/api/v1/meta" });
    expect((metaAfter.json() as { setupRequired: boolean }).setupRequired).toBe(true);
    expect(
      (h.runtime.db.prepare(`SELECT COUNT(*) AS c FROM setup_progress`).get() as { c: number }).c,
    ).toBe(0);
  });

  it("C3/AT8: a guide command from the previous epoch cannot write", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const guide = await call(h, auth, "GET", "/api/v1/guide/progress");
    const version = (guide.json() as { guideVersion: number }).guideVersion;
    const denied = await call(h, auth, "POST", "/api/v1/guide/people/complete", {
      mutationId: randomUUID(),
      expectedGuideVersion: version,
      installationEpoch: auth.installationEpoch + 9,
      status: "skipped",
    });
    expect(denied.statusCode).toBeGreaterThanOrEqual(400);
    const after = await call(h, auth, "GET", "/api/v1/guide/progress");
    expect((after.json() as { guideVersion: number; peopleStatus: string }).guideVersion).toBe(
      version,
    );
    expect((after.json() as { peopleStatus: string }).peopleStatus).toBe("not_chosen");
  });

  it("C4/AT11: reset and clear activity leave the expected guide progress", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const guide = await call(h, auth, "GET", "/api/v1/guide/progress");
    let version = (guide.json() as { guideVersion: number }).guideVersion;
    const person = await call(h, auth, "POST", "/api/v1/guide/people", {
      ...guideGuard(auth, version),
      displayName: "Kept Child",
      classification: "child",
    });
    expect(person.statusCode).toBe(200);
    const personId = (person.json() as { person: { id: string }; progress: { guideVersion: number } })
      .person.id;
    version = (person.json() as { progress: { guideVersion: number } }).progress.guideVersion;
    const completed = await call(h, auth, "POST", "/api/v1/guide/people/complete", {
      ...guideGuard(auth, version),
      status: "completed",
    });
    expect(completed.statusCode).toBe(200);
    version = (completed.json() as { progress: { guideVersion: number } }).progress.guideVersion;
    const skipped = await call(h, auth, "POST", "/api/v1/guide/school", {
      ...guideGuard(auth, version),
      status: "skipped",
    });
    version = (skipped.json() as { progress: { guideVersion: number } }).progress.guideVersion;
    const finish = await call(h, auth, "POST", "/api/v1/guide/finish", {
      ...guideGuard(auth, version),
      dismiss: true,
    });
    expect(finish.statusCode).toBe(200);
    const session = await call(h, auth, "GET", "/api/v1/auth/session");
    const generation = (session.json() as { activityGeneration: number }).activityGeneration;
    const cleared = await call(h, auth, "POST", "/api/v1/household/activity/clear", {
      mutationId: randomUUID(),
      expectedGeneration: generation,
      acknowledgedScope: "routines_and_responsibilities",
    });
    expect(cleared.statusCode).toBe(200);
    const afterClear = await call(h, auth, "GET", "/api/v1/guide/progress");
    const progress = afterClear.json() as {
      peopleStatus: string;
      schoolStatus: string;
      dismissedAt: string | null;
      guideVersion: number;
      peopleMembershipIds: string[];
    };
    expect(progress.peopleStatus).toBe("completed");
    expect(progress.schoolStatus).toBe("skipped");
    expect(progress.peopleMembershipIds).toContain(personId);
    expect(progress.dismissedAt).toBeTruthy();

    await reauth(h, auth);
    const meta = await h.app.inject({ method: "GET", url: "/api/v1/meta" });
    const epoch = (meta.json() as { installationEpoch: number }).installationEpoch;
    const reset = await call(h, auth, "POST", "/api/v1/household/reset", {
      mutationId: randomUUID(),
      confirmationText: "RESET",
      expectedEpoch: epoch,
      saveBackupBeforeReset: false,
    });
    expect(reset.statusCode).toBe(200);
    const metaAfter = await h.app.inject({ method: "GET", url: "/api/v1/meta" });
    expect((metaAfter.json() as { setupRequired: boolean }).setupRequired).toBe(true);
    expect(
      (h.runtime.db.prepare(`SELECT COUNT(*) AS c FROM setup_progress`).get() as { c: number }).c,
    ).toBe(0);
  });

  it("C5/AT7: ended linked work stays truthful and a same-title definition is not adopted", async () => {
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
    const draft = await call(h, auth, "POST", "/api/v1/routines/preview-draft", {
      mutationId: randomUUID(),
      title: "Shared Title",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [auth.membershipId],
      assigneeGroupIds: [],
      steps: [{ text: "Original", obligation: "required" }],
    });
    const applicable = (
      draft.json() as {
        preview: Array<{
          applicable: boolean;
          householdDate: string;
          participantMemberIds: string[];
          stepTexts?: string[];
        }>;
      }
    ).preview.filter((d) => d.applicable);
    const workMutation = randomUUID();
    const work = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version, workMutation),
      status: "completed",
      routine: {
        mutationId: randomUUID(),
        title: "Shared Title",
        daypart: "morning",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assigneeMemberIds: [auth.membershipId],
        assigneeGroupIds: [],
        steps: [{ text: "Original", obligation: "required" }],
      },
      previewBasis: {
        householdDate,
        calendarVersion,
        audienceGroupIds: [],
        audienceGroupVersions: {},
        reviewedRoutineDays: applicable.map((d) => ({
          householdDate: d.householdDate,
          participantMemberIds: d.participantMemberIds,
          stepTexts: d.stepTexts ?? ["Original"],
        })),
      },
    });
    expect(work.statusCode).toBe(200);
    const routine = (work.json() as { routine: { id: string; version: number } }).routine;
    const ended = await call(h, auth, "POST", `/api/v1/routines/${routine.id}/end`, {
      mutationId: randomUUID(),
      expectedVersion: routine.version,
    });
    expect(ended.statusCode).toBe(200);
    const linked = await call(h, auth, "GET", `/api/v1/routines/${routine.id}`);
    expect((linked.json() as { routine: { ended: boolean; id: string } }).routine.ended).toBe(true);
    const other = await call(h, auth, "POST", "/api/v1/routines", {
      mutationId: randomUUID(),
      title: "Shared Title",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [auth.membershipId],
      assigneeGroupIds: [],
      steps: [{ text: "Different", obligation: "required" }],
    });
    expect(other.statusCode).toBe(200);
    const otherId = (other.json() as { routine: { id: string } }).routine.id;
    expect(otherId).not.toBe(routine.id);
    const progress = await call(h, auth, "GET", "/api/v1/guide/progress");
    expect((progress.json() as { workDefinitionIds: string[] }).workDefinitionIds).toContain(
      routine.id,
    );
    expect((progress.json() as { workDefinitionIds: string[] }).workDefinitionIds).not.toContain(
      otherId,
    );
    const beforeReplay = (
      h.db.prepare(`SELECT COUNT(*) AS c FROM routine_definitions`).get() as { c: number }
    ).c;
    const replay = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version, workMutation),
      status: "completed",
      routine: {
        mutationId: randomUUID(),
        title: "Shared Title",
        daypart: "morning",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assigneeMemberIds: [auth.membershipId],
        assigneeGroupIds: [],
        steps: [{ text: "Original", obligation: "required" }],
      },
      previewBasis: {
        householdDate,
        calendarVersion,
        audienceGroupIds: [],
        reviewedRoutineDays: applicable.map((d) => ({
          householdDate: d.householdDate,
          participantMemberIds: d.participantMemberIds,
          stepTexts: d.stepTexts ?? ["Original"],
        })),
      },
    });
    expect(
      (h.db.prepare(`SELECT COUNT(*) AS c FROM routine_definitions`).get() as { c: number }).c,
    ).toBe(beforeReplay);
    const still = await call(h, auth, "GET", `/api/v1/routines/${routine.id}`);
    expect(still.statusCode).toBe(200);
    expect((still.json() as { routine: { ended: boolean } }).routine.ended).toBe(true);
    if (replay.statusCode === 200) {
      expect((replay.json() as { routine: { id: string } }).routine.id).toBe(routine.id);
    } else {
      expect(replay.statusCode).toBeGreaterThanOrEqual(400);
    }

    const removed = await call(h, auth, "POST", `/api/v1/routines/${routine.id}/delete`, {
      mutationId: randomUUID(),
      expectedVersion: (still.json() as { routine: { version: number } }).routine.version,
    });
    expect(removed.statusCode).toBe(200);
    const afterDelete = await call(h, auth, "GET", "/api/v1/guide/progress");
    expect((afterDelete.json() as { workDefinitionIds: string[] }).workDefinitionIds).not.toContain(
      routine.id,
    );
    expect((afterDelete.json() as { workDefinitionIds: string[] }).workDefinitionIds).not.toContain(
      otherId,
    );
    const replayAfterDelete = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version, workMutation),
      status: "completed",
      routine: {
        mutationId: randomUUID(),
        title: "Shared Title",
        daypart: "morning",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assigneeMemberIds: [auth.membershipId],
        assigneeGroupIds: [],
        steps: [{ text: "Original", obligation: "required" }],
      },
      previewBasis: {
        householdDate,
        calendarVersion,
        audienceGroupIds: [],
        reviewedRoutineDays: applicable.map((d) => ({
          householdDate: d.householdDate,
          participantMemberIds: d.participantMemberIds,
          stepTexts: d.stepTexts ?? ["Original"],
        })),
      },
    });
    expect(
      (h.db.prepare(`SELECT COUNT(*) AS c FROM routine_definitions`).get() as { c: number }).c,
    ).toBe(beforeReplay - 1);
    const deletedRow = h.db
      .prepare(`SELECT deleted_at AS deletedAt FROM routine_definitions WHERE id = ?`)
      .get(routine.id) as { deletedAt: string | null } | undefined;
    expect(deletedRow == null || deletedRow.deletedAt != null).toBe(true);
    if (replayAfterDelete.statusCode === 200) {
      expect((replayAfterDelete.json() as { routine: { id: string } }).routine.id).toBe(routine.id);
    }
  });
});
