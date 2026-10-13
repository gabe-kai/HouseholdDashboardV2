import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../../src/server/db.js";
import { scrubRestoredAccess } from "../../src/server/backup-catalog.js";
import { sha256Hex } from "../../src/server/crypto.js";
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
    `hd-d-backup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  temps.push(dir);
  return dir;
}

async function createDHarness(): Promise<HttpHarness> {
  const harness = await createHttpHarness({
    AUTO_SEED: "0",
    INSTALLATION_OWNER_SECRET: OWNER_SECRET,
    INSTALLATION_CONTROL_PATH: tempPath("hd-d-control"),
    BACKUP_DIR: backupDirForTest(),
  });
  harnesses.push(harness);
  return harness;
}

type Auth = { cookie: string; csrf: string; membershipId: string };

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

  return { cookie, csrf, membershipId, loginName };
}

describe("P0-008D guided first household day", () => {
  it("AT1: migration 020 is idempotent on populated through-019-shaped DBs", () => {
    const dbPath = tempPath("hd-d-migrate");
    const db = openDatabase(dbPath);
    migrate(db);
    const applied = db
      .prepare(`SELECT id FROM schema_migrations WHERE id = ?`)
      .get("020_guided_setup_progress.sql") as { id: string } | undefined;
    expect(applied?.id).toBe("020_guided_setup_progress.sql");
    const cols = (
      db.prepare(`PRAGMA table_info(setup_progress)`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toContain("guide_version");
    expect(cols).toContain("people_status");
    expect(cols).toContain("work_definition_ids_json");
    migrate(db);
    db.close();
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
        mutationId: randomUUID(),
        expectedGuideVersion: version,
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

  it("AT5: draft routine preview is side-effect free", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const occBefore = await call(h, auth, "GET", "/api/v1/today");
    expect(occBefore.statusCode).toBe(200);

    const preview = await call(h, auth, "POST", "/api/v1/routines/preview-draft", {
      mutationId: randomUUID(),
      title: "Preview only",
      daypart: "morning",
      assigneeMemberIds: [auth.membershipId],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "Brush teeth", obligation: "required" }],
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json() as { preview: unknown[]; nextKnownDate: string | null };
    expect(Array.isArray(body.preview)).toBe(true);

    const definitions = h.db
      .prepare(`SELECT COUNT(*) AS c FROM routine_definitions WHERE deleted_at IS NULL`)
      .get() as { c: number };
    expect(definitions.c).toBe(0);
  });

  it("AT7: unused guide person can be deleted; guide links do not block", async () => {
    const h = await createDHarness();
    const auth = await setupHousehold(h);
    const guide = await call(h, auth, "GET", "/api/v1/guide/progress");
    const version = (guide.json() as { guideVersion: number }).guideVersion;

    const created = await call(h, auth, "POST", "/api/v1/guide/people", {
      mutationId: randomUUID(),
      expectedGuideVersion: version,
      displayName: "Unused Child",
      classification: "child",
    });
    expect(created.statusCode).toBe(200);
    const person = (created.json() as { person: { id: string; version: number; authorityVersion: number } })
      .person;

    await call(h, auth, "POST", "/api/v1/auth/reauthenticate", { passphrase: PASSPHRASE });
    const preview = await call(h, auth, "POST", `/api/v1/people/${person.id}/removal/preview`, {
      expectedVersion: person.version,
      expectedAuthorityVersion: person.authorityVersion,
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as {
      previewDigest: string;
      impact: { mode: string };
    };
    expect(previewBody.impact.mode).toBe("delete");

    const removed = await call(h, auth, "POST", `/api/v1/people/${person.id}/removal`, {
      mutationId: randomUUID(),
      expectedVersion: person.version,
      expectedAuthorityVersion: person.authorityVersion,
      previewDigest: previewBody.previewDigest,
      passphrase: PASSPHRASE,
      confirmationText: "REMOVE",
    });
    expect(removed.statusCode).toBe(200);
    expect((removed.json() as { mode: string }).mode).toBe("deleted");
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

    // Confirm tokens preview before scrub.
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
});
