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
});
