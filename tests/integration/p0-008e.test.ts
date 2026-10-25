import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CreatePersonSchema } from "../../src/shared/schemas.js";
import { createHttpHarness, type HttpHarness } from "../helpers/auth-fixture.js";

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
    `hd-e-backup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  temps.push(dir);
  return dir;
}

type Auth = { cookie: string; csrf: string; membershipId: string };

function authHeaders(h: HttpHarness, a: Auth): Record<string, string> {
  return {
    origin: h.origin,
    cookie: `${h.config.cookieName}=${a.cookie}`,
    "x-csrf-token": a.csrf,
  };
}

async function call(h: HttpHarness, a: Auth, method: string, url: string, body?: unknown) {
  return h.app.inject({
    method,
    url,
    headers: {
      ...authHeaders(h, a),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    payload: body !== undefined ? body : undefined,
  });
}

async function setupHousehold(harness: HttpHarness): Promise<Auth> {
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
      "x-csrf-token": ownerCsrf,
      cookie: `${harness.config.ownerCookieName}=${ownerCookie}`,
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

  const loginName = `parent${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const account = await harness.app.inject({
    method: "POST",
    url: "/api/v1/setup/account",
    headers: {
      origin: harness.origin,
      "content-type": "application/json",
      cookie: `${harness.config.setupCookieName}=${setupCookie}`,
    },
    payload: { loginName, passphrase: PASSPHRASE, displayName: "Parent One" },
  });
  expect(account.statusCode).toBe(200);
  const session = account.json() as { csrfToken: string; member: { id: string } };
  const cookie = account.cookies.find((c) => c.name === harness.config.cookieName)!.value;

  const household = await harness.app.inject({
    method: "POST",
    url: "/api/v1/setup/household",
    headers: {
      origin: harness.origin,
      "content-type": "application/json",
      "x-csrf-token": session.csrfToken,
      cookie: `${harness.config.cookieName}=${cookie}`,
    },
    payload: { name: "008E Family", timezone: "America/New_York" },
  });
  expect(household.statusCode).toBe(200);

  return { cookie, csrf: session.csrfToken, membershipId: session.member.id };
}

describe("P0-008E create-path profile and schema", () => {
  it("AT3: CreatePersonSchema accepts optional profile fields and omits them", () => {
    const base = {
      mutationId: randomUUID(),
      displayName: "Alex",
      classification: "child" as const,
    };
    expect(CreatePersonSchema.safeParse(base).success).toBe(true);
    expect(
      CreatePersonSchema.safeParse({
        ...base,
        fullName: "Alex Example",
        birthday: "2015-06-01",
        email: "alex@example.test",
      }).success,
    ).toBe(true);
    expect(
      CreatePersonSchema.safeParse({
        ...base,
        fullName: null,
        birthday: null,
        email: null,
      }).success,
    ).toBe(true);
  });

  it("AT3: createPerson persists optional profile fields and blank defaults", async () => {
    const harness = await createHttpHarness({
      AUTO_SEED: "0",
      INSTALLATION_OWNER_SECRET: OWNER_SECRET,
      INSTALLATION_CONTROL_PATH: tempPath("hd-e-control"),
      BACKUP_DIR: backupDirForTest(),
    });
    harnesses.push(harness);
    const mgr = await setupHousehold(harness);

    const blank = await call(harness, mgr, "POST", "/api/v1/people", {
      mutationId: randomUUID(),
      displayName: "Blank Profile",
      classification: "child",
    });
    expect(blank.statusCode).toBe(200);
    const blankId = (blank.json() as { person: { id: string; roleLabel: string } }).person.id;
    expect((blank.json() as { person: { roleLabel: string } }).person.roleLabel).toBe("member");
    const blankDetail = await call(harness, mgr, "GET", `/api/v1/people/${blankId}`);
    expect(blankDetail.statusCode).toBe(200);
    const blankPerson = (blankDetail.json() as { person: Record<string, unknown> }).person;
    expect(blankPerson.displayName).toBe("Blank Profile");
    expect(blankPerson.fullName ?? null).toBeNull();
    expect(blankPerson.birthday ?? null).toBeNull();
    expect(blankPerson.email ?? null).toBeNull();

    const filled = await call(harness, mgr, "POST", "/api/v1/people", {
      mutationId: randomUUID(),
      displayName: "Shown Name",
      classification: "adult",
      fullName: "Full Legal Name",
      birthday: "1990-04-12",
      email: "shown@example.test",
    });
    expect(filled.statusCode).toBe(200);
    const filledId = (filled.json() as { person: { id: string; roleLabel: string } }).person.id;
    expect((filled.json() as { person: { roleLabel: string } }).person.roleLabel).toBe("member");

    const reload = await call(harness, mgr, "GET", `/api/v1/people/${filledId}`);
    expect(reload.statusCode).toBe(200);
    const reloaded = (reload.json() as { person: Record<string, unknown> }).person;
    expect(reloaded.displayName).toBe("Shown Name");
    expect(reloaded.fullName).toBe("Full Legal Name");
    expect(reloaded.birthday).toBe("1990-04-12");
    expect(reloaded.email).toBe("shown@example.test");
  });

  it("AT1b: consumed invitation cannot be exchanged again", async () => {
    const harness = await createHttpHarness({
      AUTO_SEED: "0",
      INSTALLATION_OWNER_SECRET: OWNER_SECRET,
      INSTALLATION_CONTROL_PATH: tempPath("hd-e-control"),
      BACKUP_DIR: backupDirForTest(),
    });
    harnesses.push(harness);
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
        "x-csrf-token": ownerCsrf,
        cookie: `${harness.config.ownerCookieName}=${ownerCookie}`,
      },
      payload: {},
    });
    expect(invite.statusCode).toBe(200);
    const invitationToken = (invite.json() as { invitationToken: string }).invitationToken;
    const first = await harness.app.inject({
      method: "POST",
      url: "/api/v1/setup/exchange",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { invitationToken },
    });
    expect(first.statusCode).toBe(200);
    const retry = await harness.app.inject({
      method: "POST",
      url: "/api/v1/setup/exchange",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { invitationToken },
    });
    expect(retry.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("AT2b: invalid timezone is rejected; dated work locks relocation", async () => {
    const harness = await createHttpHarness({
      AUTO_SEED: "0",
      INSTALLATION_OWNER_SECRET: OWNER_SECRET,
      INSTALLATION_CONTROL_PATH: tempPath("hd-e-control"),
      BACKUP_DIR: backupDirForTest(),
    });
    harnesses.push(harness);
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
        "x-csrf-token": ownerCsrf,
        cookie: `${harness.config.ownerCookieName}=${ownerCookie}`,
      },
      payload: {},
    });
    const invitationToken = (invite.json() as { invitationToken: string }).invitationToken;
    const exchange = await harness.app.inject({
      method: "POST",
      url: "/api/v1/setup/exchange",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { invitationToken },
    });
    expect(exchange.statusCode).toBe(200);
    const setupCookie = exchange.cookies.find((c) => c.name.includes("setup"))!.value;
    const account = await harness.app.inject({
      method: "POST",
      url: "/api/v1/setup/account",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        cookie: `${harness.config.setupCookieName}=${setupCookie}`,
      },
      payload: {
        loginName: `tzlock${Date.now().toString(36)}`,
        passphrase: PASSPHRASE,
        displayName: "Timezone Lock",
      },
    });
    expect(account.statusCode).toBe(200);
    const csrf = (account.json() as { csrfToken: string }).csrfToken;
    const cookie = account.cookies.find((c) => c.name === harness.config.cookieName)!.value;
    const membershipId = (account.json() as { member: { id: string } }).member.id;
    const mgr = { cookie, csrf, membershipId };

    const invalid = await call(harness, mgr, "POST", "/api/v1/setup/household", {
      name: "Bad Zone Home",
      timezone: "Not/AZone",
    });
    expect(invalid.statusCode).toBeGreaterThanOrEqual(400);

    const household = await call(harness, mgr, "POST", "/api/v1/setup/household", {
      name: "008E Lock Family",
      timezone: "America/New_York",
    });
    expect(household.statusCode).toBe(200);

    const created = await call(harness, mgr, "POST", "/api/v1/responsibilities", {
      mutationId: randomUUID(),
      title: "Lock Timezone",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: mgr.membershipId,
      steps: [{ text: "One", obligation: "required" }],
    });
    expect(created.statusCode).toBe(200);
    const detailsAfter = await call(harness, mgr, "GET", "/api/v1/household/details");
    expect(detailsAfter.statusCode).toBe(200);
    const locked = detailsAfter.json() as { timezone: string; timezoneLocked: boolean; name: string };
    expect(locked.timezoneLocked).toBe(true);
    expect(locked.timezone).toBe("America/New_York");
    const patched = await call(harness, mgr, "PATCH", "/api/v1/household/details", {
      mutationId: randomUUID(),
      expectedName: locked.name,
      name: locked.name,
      timezone: "America/Los_Angeles",
    });
    expect(patched.statusCode).toBe(200);
    const afterPatch = await call(harness, mgr, "GET", "/api/v1/household/details");
    expect((afterPatch.json() as { timezone: string }).timezone).toBe("America/New_York");
  });

  it("AT5: last essential manager cannot be demoted; stale authority version conflicts", async () => {
    const harness = await createHttpHarness({
      AUTO_SEED: "0",
      INSTALLATION_OWNER_SECRET: OWNER_SECRET,
      INSTALLATION_CONTROL_PATH: tempPath("hd-e-control"),
      BACKUP_DIR: backupDirForTest(),
    });
    harnesses.push(harness);
    const mgr = await setupHousehold(harness);
    const self = await call(harness, mgr, "GET", `/api/v1/people/${mgr.membershipId}`);
    expect(self.statusCode).toBe(200);
    const person = (self.json() as { person: { id: string; authorityVersion: number } }).person;
    const demote = await call(harness, mgr, "POST", `/api/v1/people/${person.id}/permissions`, {
      mutationId: randomUUID(),
      expectedAuthorityVersion: person.authorityVersion,
      role: "member",
      memberMode: "direct",
      secondaryGrants: [],
    });
    expect(demote.statusCode).toBe(403);
    const still = await call(harness, mgr, "GET", `/api/v1/people/${person.id}`);
    expect((still.json() as { person: { roleLabel: string } }).person.roleLabel).toBe("manager");

    const child = await call(harness, mgr, "POST", "/api/v1/people", {
      mutationId: randomUUID(),
      displayName: "Stale Child",
      classification: "child",
    });
    expect(child.statusCode).toBe(200);
    const childPerson = (
      child.json() as { person: { id: string; authorityVersion: number } }
    ).person;
    const winner = await call(harness, mgr, "POST", `/api/v1/people/${childPerson.id}/permissions`, {
      mutationId: randomUUID(),
      expectedAuthorityVersion: childPerson.authorityVersion,
      role: "member",
      memberMode: "direct",
      secondaryGrants: ["household.display.manage"],
    });
    expect(winner.statusCode).toBe(200);
    const stale = await call(harness, mgr, "POST", `/api/v1/people/${childPerson.id}/permissions`, {
      mutationId: randomUUID(),
      expectedAuthorityVersion: childPerson.authorityVersion,
      role: "member",
      memberMode: "direct",
      secondaryGrants: [],
    });
    expect(stale.statusCode).toBe(409);
  });

  it("AT7: preview-draft does not materialize, lock, or advance assignment", async () => {
    const harness = await createHttpHarness({
      AUTO_SEED: "0",
      INSTALLATION_OWNER_SECRET: OWNER_SECRET,
      INSTALLATION_CONTROL_PATH: tempPath("hd-e-control"),
      BACKUP_DIR: backupDirForTest(),
    });
    harnesses.push(harness);
    const mgr = await setupHousehold(harness);
    const session = await call(harness, mgr, "GET", "/api/v1/auth/session");
    expect(session.statusCode).toBe(200);
    const today = (session.json() as { householdDate: string }).householdDate;

    const child = await call(harness, mgr, "POST", "/api/v1/people", {
      mutationId: randomUUID(),
      displayName: "Preview Child",
      classification: "child",
    });
    expect(child.statusCode).toBe(200);
    const childId = (child.json() as { person: { id: string } }).person.id;

    const routine = await call(harness, mgr, "POST", "/api/v1/routines", {
      mutationId: randomUUID(),
      title: "Preview Routine",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [mgr.membershipId],
      assigneeGroupIds: [],
      steps: [{ text: "Stretch", obligation: "required" }],
    });
    expect(routine.statusCode).toBe(200);

    const created = await call(harness, mgr, "POST", "/api/v1/responsibilities", {
      mutationId: randomUUID(),
      title: "Rotate Preview",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: {
        mode: "take_turns",
        anchorDate: today,
        cycleOrder: [mgr.membershipId, childId],
      },
      steps: [{ text: "Sweep", obligation: "required" }],
    });
    expect(created.statusCode).toBe(200);
    const definition = (
      created.json() as {
        responsibility: {
          id: string;
          revisions: Array<{ assignment?: { mode: string; cycleOrder?: string[] } }>;
        };
      }
    ).responsibility;

    const todayBefore = await call(harness, mgr, "GET", `/api/v1/today?date=${today}`);
    expect(todayBefore.statusCode).toBe(200);
    const beforeOcc = (
      todayBefore.json() as {
        activityGeneration: number;
        occurrences: Array<{
          id: string;
          title: string;
          startedAt: string | null;
          accountableMemberId: string | null;
          version: number;
        }>;
      }
    ).occurrences;
    expect(beforeOcc.length).toBeGreaterThan(0);
    const beforeRows = harness.db
      .prepare(`SELECT id, started_at, version FROM occurrences ORDER BY id`)
      .all() as Array<{ id: string; started_at: string | null; version: number }>;
    const beforeAssignment = JSON.stringify(definition.revisions[0]?.assignment ?? null);

    const routinePreview = await call(harness, mgr, "POST", "/api/v1/routines/preview-draft", {
      mutationId: randomUUID(),
      title: "Unsaved Routine Preview",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [mgr.membershipId],
      assigneeGroupIds: [],
      steps: [{ text: "Unsaved stretch", obligation: "required" }],
    });
    expect(routinePreview.statusCode).toBe(200);

    const responsibilityPreview = await call(
      harness,
      mgr,
      "POST",
      "/api/v1/responsibilities/preview-draft",
      {
        mutationId: randomUUID(),
        title: "Unsaved Rotate Preview",
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "take_turns",
          anchorDate: today,
          cycleOrder: [mgr.membershipId, childId],
        },
        steps: [{ text: "Unsaved sweep", obligation: "required" }],
      },
    );
    expect(responsibilityPreview.statusCode).toBe(200);

    const routines = await call(harness, mgr, "GET", "/api/v1/routines");
    expect(
      ((routines.json() as { routines: unknown[] }).routines ?? []).length,
    ).toBe(1);
    const responsibilities = await call(harness, mgr, "GET", "/api/v1/responsibilities");
    expect(
      ((responsibilities.json() as { responsibilities: unknown[] }).responsibilities ?? []).length,
    ).toBe(1);

    const afterRows = harness.db
      .prepare(`SELECT id, started_at, version FROM occurrences ORDER BY id`)
      .all() as Array<{ id: string; started_at: string | null; version: number }>;
    expect(afterRows).toEqual(beforeRows);

    const todayAfter = await call(harness, mgr, "GET", `/api/v1/today?date=${today}`);
    expect(todayAfter.statusCode).toBe(200);
    const afterOcc = (
      todayAfter.json() as {
        occurrences: Array<{
          id: string;
          title: string;
          startedAt: string | null;
          accountableMemberId: string | null;
          version: number;
        }>;
      }
    ).occurrences;
    expect(
      afterOcc.map((row) => `${row.id}|${row.title}|${row.startedAt}|${row.accountableMemberId}|${row.version}`),
    ).toEqual(
      beforeOcc.map((row) => `${row.id}|${row.title}|${row.startedAt}|${row.accountableMemberId}|${row.version}`),
    );
    expect(afterOcc.some((row) => row.title.includes("Unsaved"))).toBe(false);
    expect(afterOcc.every((row) => row.startedAt === null)).toBe(true);

    const reloaded = await call(harness, mgr, "GET", `/api/v1/responsibilities/${definition.id}`);
    expect(reloaded.statusCode).toBe(200);
    const afterAssignment = JSON.stringify(
      (
        reloaded.json() as {
          responsibility: { revisions: Array<{ assignment?: { mode: string; cycleOrder?: string[] } }> };
        }
      ).responsibility.revisions[0]?.assignment ?? null,
    );
    expect(afterAssignment).toBe(beforeAssignment);
  });
});
