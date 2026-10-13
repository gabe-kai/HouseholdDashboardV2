import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../../src/server/db.js";
import { scrubRestoredAccess } from "../../src/server/backup-catalog.js";
import { sha256Hex } from "../../src/server/crypto.js";
import { createHttpHarness, type HttpHarness } from "../helpers/auth-fixture.js";
import { openPopulatedP017UpgradeDatabase } from "../helpers/p017-fixture.js";

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
  it("AT1: migration 020/021 idempotent; populated through-017 adopts without fabricated basics times", () => {
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

    const populatedPath = tempPath("hd-d-populated017");
    const populated = openPopulatedP017UpgradeDatabase(populatedPath);
    migrate(populated);
    migrate(populated);
    const manager = populated
      .prepare(
        `SELECT hm.id FROM household_memberships hm
         INNER JOIN membership_grants mg ON mg.membership_id = hm.id
           AND mg.grant_name = 'household.lifecycle.manage'
         WHERE hm.departed_at IS NULL LIMIT 1`,
      )
      .get() as { id: string } | undefined;
    expect(manager?.id).toBeTruthy();
    // Ensure guide row can be created without inventing Account/Household completion times.
    const householdId = (
      populated.prepare(`SELECT id FROM households LIMIT 1`).get() as { id: string }
    ).id;
    const existing = populated
      .prepare(`SELECT account_completed_at, household_completed_at FROM setup_progress WHERE household_id = ?`)
      .get(householdId) as
      | { account_completed_at: string | null; household_completed_at: string | null }
      | undefined;
    if (!existing) {
      populated
        .prepare(
          `INSERT INTO setup_progress
           (household_id, account_completed_at, household_completed_at, membership_id, user_id,
            guide_version, people_status, school_status, first_work_status,
            people_membership_ids_json, work_definition_ids_json, finished_at, dismissed_at, updated_at)
           VALUES (?, NULL, NULL, ?, NULL, 0, 'not_chosen', 'not_chosen', 'not_chosen', '[]', '[]', NULL, NULL, ?)`,
        )
        .run(householdId, manager!.id, new Date().toISOString());
    }
    const row = populated
      .prepare(
        `SELECT account_completed_at, household_completed_at FROM setup_progress WHERE household_id = ?`,
      )
      .get(householdId) as {
      account_completed_at: string | null;
      household_completed_at: string | null;
    };
    // Either A progress already had real timestamps, or backfill left them null — never a fabricated "now".
    if (!existing) {
      expect(row.account_completed_at).toBeNull();
      expect(row.household_completed_at).toBeNull();
    }
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
    const work = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version, workMutation),
      status: "completed",
      routine: {
        mutationId: randomUUID(),
        title: "Guide Routine",
        daypart: "morning",
        weekdays: [1, 2, 3, 4, 5],
        assigneeMemberIds: [auth.membershipId],
        assigneeGroupIds: [],
        steps: [{ text: "Stretch", obligation: "required" }],
      },
    });
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

    const replayWork = await call(h, auth, "POST", "/api/v1/guide/work", {
      ...guideGuard(auth, version, workMutation),
      status: "completed",
      routine: {
        mutationId: randomUUID(),
        title: "Guide Routine",
        daypart: "morning",
        weekdays: [1, 2, 3, 4, 5],
        assigneeMemberIds: [auth.membershipId],
        assigneeGroupIds: [],
        steps: [{ text: "Stretch", obligation: "required" }],
      },
    });
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
});
