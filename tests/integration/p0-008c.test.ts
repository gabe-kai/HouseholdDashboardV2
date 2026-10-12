import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../../src/server/db.js";
import { backfillAuthenticatedAuthority } from "../../src/server/backfill.js";
import { backfillGroupMembershipBaselines } from "../../src/server/backfill-group-membership.js";
import { createHttpHarness, tempDbPath, type HttpHarness } from "../helpers/auth-fixture.js";
import { MEMBER_DEFAULT_GRANTS, MEMBER_DIRECT_GRANTS } from "../../src/shared/grants.js";
import { SEED } from "../../src/server/seeds/evaluation.js";

const OWNER_SECRET = "test-owner-secret-with-enough-entropy-0123456789abcdef";
const PASSPHRASE = "Unique-passphrase-ok!999";
const NEW_PASSPHRASE = "Another-unique-passphrase-1!";
const RESET_PASSPHRASE = "Reset-unique-passphrase-ok-2!";

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
    `hd-c-backup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  temps.push(dir);
  return dir;
}

async function createCHarness(): Promise<HttpHarness> {
  const harness = await createHttpHarness({
    AUTO_SEED: "0",
    INSTALLATION_OWNER_SECRET: OWNER_SECRET,
    INSTALLATION_CONTROL_PATH: tempPath("hd-c-control"),
    BACKUP_DIR: backupDirForTest(),
  });
  harnesses.push(harness);
  return harness;
}

async function createSeededHarness(): Promise<HttpHarness> {
  const harness = await createHttpHarness({
    AUTO_SEED: "1",
    INSTALLATION_CONTROL_PATH: tempPath("hd-c-seed-control"),
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
  opts?: { withCsrf?: boolean },
) {
  const headers = a
    ? authHeaders(h, a, opts?.withCsrf ?? true)
    : { origin: h.origin, "content-type": "application/json" };
  if (method === "GET") delete (headers as Record<string, string>)["content-type"];
  return h.app.inject({
    method,
    url,
    headers,
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

/** Owner-gated first-household setup (same as P0-008B). */
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
    payload: { name: "Access Family", timezone: "America/New_York" },
  });
  expect(household.statusCode).toBe(200);

  return { cookie, csrf: session.csrfToken, membershipId: session.member.id, loginName };
}

type Person = {
  id: string;
  displayName: string;
  version: number;
  authorityVersion: number;
  grants: string[];
  accessState: string;
  roleLabel: string;
  departed: boolean;
  signInRevoked: boolean;
};

async function listPeople(h: HttpHarness, a: Auth): Promise<Person[]> {
  const res = await call(h, a, "GET", "/api/v1/people");
  expect(res.statusCode).toBe(200);
  return (res.json() as { people: Person[] }).people;
}

async function getPerson(h: HttpHarness, a: Auth, id: string): Promise<Person | undefined> {
  return (await listPeople(h, a)).find((p) => p.id === id);
}

async function addPerson(
  h: HttpHarness,
  a: Auth,
  displayName: string,
  classification: "adult" | "child" = "child",
): Promise<Person> {
  const res = await call(h, a, "POST", "/api/v1/people", {
    mutationId: randomUUID(),
    displayName,
    classification,
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { person: Person }).person;
}

async function issueClaim(
  h: HttpHarness,
  a: Auth,
  membershipId: string,
  purpose: "invitation" | "password_reset" | "restore_sign_in",
) {
  const res = await call(h, a, "POST", `/api/v1/people/${membershipId}/access-claims`, {
    mutationId: randomUUID(),
    purpose,
  });
  expect(res.statusCode).toBe(200);
  const claim = (res.json() as { claim: { token?: string; claimId: string } }).claim;
  expect(claim.token).toBeTruthy();
  return { token: claim.token!, claimId: claim.claimId };
}

async function redeemInvitation(
  h: HttpHarness,
  token: string,
  loginName: string,
  displayName: string,
  passphrase = PASSPHRASE,
) {
  return h.app.inject({
    method: "POST",
    url: "/api/v1/auth/access-claims/redeem",
    headers: { origin: h.origin, "content-type": "application/json" },
    payload: { claimToken: token, loginName, passphrase, displayName },
  });
}

function authFromSessionResponse(
  h: HttpHarness,
  res: Awaited<ReturnType<HttpHarness["app"]["inject"]>>,
): Auth {
  expect(res.statusCode).toBe(200);
  const body = res.json() as { csrfToken: string; member: { id: string } };
  const cookie = res.cookies.find((c) => c.name === h.config.cookieName)!.value;
  return { cookie, csrf: body.csrfToken, membershipId: body.member.id };
}

/** Add a person and complete invitation so they can sign in. */
async function enrollMember(
  h: HttpHarness,
  manager: Auth,
  displayName: string,
  loginName: string,
  classification: "adult" | "child" = "adult",
): Promise<{ person: Person; auth: Auth }> {
  const person = await addPerson(h, manager, displayName, classification);
  const { token } = await issueClaim(h, manager, person.id, "invitation");
  const redeemed = await redeemInvitation(h, token, loginName, displayName);
  const auth = authFromSessionResponse(h, redeemed);
  expect(auth.membershipId).toBe(person.id);
  return { person, auth };
}

async function login(h: HttpHarness, loginName: string, passphrase = PASSPHRASE) {
  return h.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: h.origin, "content-type": "application/json" },
    payload: { loginName, passphrase },
  });
}

async function savePermissions(
  h: HttpHarness,
  actor: Auth,
  person: Pick<Person, "id" | "authorityVersion">,
  body: {
    role: "manager" | "member";
    memberMode?: "approval" | "direct";
    secondaryGrants?: string[];
  },
  expectedAuthorityVersion = person.authorityVersion,
) {
  return call(h, actor, "POST", `/api/v1/people/${person.id}/permissions`, {
    mutationId: randomUUID(),
    expectedAuthorityVersion,
    role: body.role,
    memberMode: body.memberMode,
    secondaryGrants: body.secondaryGrants ?? [],
  });
}

async function sessionStatus(h: HttpHarness, a: Auth): Promise<number> {
  const res = await h.app.inject({
    method: "GET",
    url: "/api/v1/auth/session",
    headers: { cookie: `${h.config.cookieName}=${a.cookie}` },
  });
  return res.statusCode;
}

async function previewRemoval(h: HttpHarness, actor: Auth, person: Person) {
  return call(h, actor, "POST", `/api/v1/people/${person.id}/removal/preview`, {
    expectedAuthorityVersion: person.authorityVersion,
    expectedVersion: person.version,
  });
}

async function commitRemoval(
  h: HttpHarness,
  actor: Auth,
  person: Person,
  previewDigest: string,
  overrides: Record<string, unknown> = {},
) {
  return call(h, actor, "POST", `/api/v1/people/${person.id}/removal`, {
    mutationId: randomUUID(),
    expectedAuthorityVersion: person.authorityVersion,
    expectedVersion: person.version,
    passphrase: PASSPHRASE,
    previewDigest,
    confirmationText: "REMOVE",
    ...overrides,
  });
}

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("P0-008C member access and safe removal", () => {
  it("AT1: createPerson defaults Member (approval) grants; Adult/Child patch leaves grants and authority version alone", async () => {
    const h = await createCHarness();
    const mgr = await setupHousehold(h);

    const manager = (await getPerson(h, mgr, mgr.membershipId))!;
    expect(manager.grants).toEqual(
      expect.arrayContaining(["household.access.manage", "household.member.remove"]),
    );
    expect(manager.roleLabel).toBe("manager");

    const person = await addPerson(h, mgr, "Casey Child", "child");
    expect(sorted(person.grants)).toEqual(sorted(MEMBER_DEFAULT_GRANTS));
    expect(person.grants).toContain("routine.personalize.propose");
    expect(person.grants).not.toContain("routine.personalize.direct");
    expect(person.roleLabel).toBe("member");
    expect(person.accessState).toBe("not_set_up");

    const patchedAdult = await call(h, mgr, "PATCH", `/api/v1/people/${person.id}`, {
      displayName: "Casey Child",
      classification: "adult",
      expectedVersion: person.version,
    });
    expect(patchedAdult.statusCode).toBe(200);
    const afterAdult = (patchedAdult.json() as { person: Person }).person;
    expect(sorted(afterAdult.grants)).toEqual(sorted(person.grants));
    expect(afterAdult.authorityVersion).toBe(person.authorityVersion);

    const patchedChild = await call(h, mgr, "PATCH", `/api/v1/people/${person.id}`, {
      displayName: "Casey Child",
      classification: "child",
      expectedVersion: afterAdult.version,
    });
    expect(patchedChild.statusCode).toBe(200);
    const afterChild = (patchedChild.json() as { person: Person }).person;
    expect(sorted(afterChild.grants)).toEqual(sorted(person.grants));
    expect(afterChild.authorityVersion).toBe(person.authorityVersion);
  });

  it("AT1: migration 019 backfills access.manage + member.remove only for enroll+structure holders", async () => {
    const dbPath = tempDbPath("hd-c-migrate");
    temps.push(dbPath);
    const db = openDatabase(dbPath);
    try {
      // Apply schema through 018 exactly as migrate() would, then seed pre-019 holders.
      const migrationsDir = path.resolve(process.cwd(), "db/migrations");
      const through018 = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql") && f < "019_")
        .sort();
      db.exec(
        `CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);`,
      );
      for (const file of through018) {
        db.pragma("foreign_keys = OFF");
        try {
          db.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
          db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
            file,
            new Date().toISOString(),
          );
        } finally {
          db.pragma("foreign_keys = ON");
        }
        if (file.startsWith("002_")) backfillAuthenticatedAuthority(db);
        if (file.startsWith("004_")) backfillGroupMembershipBaselines(db);
      }
      expect(through018.length).toBeGreaterThanOrEqual(18);
      expect(through018.some((f) => f.startsWith("019_"))).toBe(false);

      const householdId = randomUUID();
      const ids = {
        both: randomUUID(),
        enrollOnly: randomUUID(),
        structureOnly: randomUUID(),
        neither: randomUUID(),
      };
      db.pragma("foreign_keys = OFF");
      db.prepare("INSERT INTO households (id, name, timezone) VALUES (?, 'Mig', 'UTC')").run(
        householdId,
      );
      const grantsByMember: Record<string, string[]> = {
        [ids.both]: ["household.member.enroll", "household.structure.manage"],
        [ids.enrollOnly]: ["household.member.enroll"],
        [ids.structureOnly]: ["household.structure.manage"],
        [ids.neither]: ["routine.execute.own"],
      };
      for (const [id, grants] of Object.entries(grantsByMember)) {
        db.prepare(
          `INSERT INTO household_memberships
             (id, household_id, display_name, status, classification, version, created_at)
           VALUES (?, ?, ?, 'pending', 'adult', 1, ?)`,
        ).run(id, householdId, `M-${id.slice(0, 4)}`, new Date().toISOString());
        for (const grant of grants) {
          db.prepare("INSERT INTO membership_grants (membership_id, grant_name) VALUES (?, ?)").run(
            id,
            grant,
          );
        }
      }
      db.pragma("foreign_keys = ON");

      migrate(db); // applies only 019 (+ any later migrations)

      const grantsOf = (id: string) =>
        (
          db
            .prepare("SELECT grant_name FROM membership_grants WHERE membership_id = ?")
            .all(id) as Array<{ grant_name: string }>
        ).map((r) => r.grant_name);

      expect(grantsOf(ids.both)).toEqual(
        expect.arrayContaining(["household.access.manage", "household.member.remove"]),
      );
      for (const id of [ids.enrollOnly, ids.structureOnly, ids.neither]) {
        const g = grantsOf(id);
        expect(g).not.toContain("household.access.manage");
        expect(g).not.toContain("household.member.remove");
      }
      const row = db
        .prepare(
          "SELECT authority_version, departed_at, sign_in_revoked_at FROM household_memberships WHERE id = ?",
        )
        .get(ids.both) as {
        authority_version: number;
        departed_at: string | null;
        sign_in_revoked_at: string | null;
      };
      expect(row).toEqual({ authority_version: 1, departed_at: null, sign_in_revoked_at: null });
    } finally {
      db.close();
    }
  });

  it("AT3: manager <-> member permission save; stale authority version conflicts", async () => {
    const h = await createCHarness();
    const mgr = await setupHousehold(h);
    const { person, auth: memberAuth } = await enrollMember(h, mgr, "Avery Adult", "avery.adult");

    const fresh = (await getPerson(h, mgr, person.id))!;
    expect(fresh.roleLabel).toBe("member");

    const toManager = await savePermissions(h, mgr, fresh, { role: "manager" });
    expect(toManager.statusCode).toBe(200);
    const asManager = (toManager.json() as { person: Person }).person;
    expect(asManager.roleLabel).toBe("manager");
    expect(asManager.grants).toEqual(
      expect.arrayContaining([
        "household.member.enroll",
        "household.structure.manage",
        "household.access.manage",
        "household.lifecycle.manage",
        "household.member.remove",
      ]),
    );
    expect(asManager.authorityVersion).toBe(fresh.authorityVersion + 1);

    // Stale expected authority version conflicts.
    const stale = await savePermissions(h, mgr, asManager, { role: "member" }, fresh.authorityVersion);
    expect(stale.statusCode).toBe(409);

    // Newly promoted manager can manage access; back to direct member afterwards.
    const demote = await savePermissions(h, mgr, asManager, { role: "member", memberMode: "direct" });
    expect(demote.statusCode).toBe(200);
    const asMember = (demote.json() as { person: Person }).person;
    expect(asMember.roleLabel).toBe("member");
    expect(asMember.grants).toContain("routine.personalize.direct");
    expect(asMember.grants).not.toContain("routine.personalize.propose");
    expect(asMember.grants).not.toContain("household.access.manage");
    expect(asMember.authorityVersion).toBe(asManager.authorityVersion + 1);

    // Original member session can no longer manage access.
    const denied = await savePermissions(h, memberAuth, asMember, { role: "manager" });
    expect(denied.statusCode).toBe(403);
  });

  it("AT4: invitation redeem proves current grants; preview does not consume; canceled claim fails", async () => {
    const h = await createCHarness();
    const mgr = await setupHousehold(h);

    const person = await addPerson(h, mgr, "Jordan Joiner", "adult");
    expect(person.grants).toContain("routine.personalize.propose");
    const { token } = await issueClaim(h, mgr, person.id, "invitation");

    // Change grants after issuing the claim (member -> direct member).
    const saved = await savePermissions(h, mgr, person, { role: "member", memberMode: "direct" });
    expect(saved.statusCode).toBe(200);

    // Preview is read-only and repeatable.
    for (let i = 0; i < 2; i += 1) {
      const preview = await h.app.inject({
        method: "GET",
        url: `/api/v1/auth/access-claims/preview?token=${encodeURIComponent(token)}`,
      });
      expect(preview.statusCode).toBe(200);
      const body = preview.json() as {
        preview: { householdName: string; personDisplayName: string; purpose: string };
      };
      expect(body.preview.personDisplayName).toBe("Jordan Joiner");
      expect(body.preview.householdName).toBe("Access Family");
      expect(body.preview.purpose).toBe("invitation");
    }

    const redeemed = await redeemInvitation(h, token, "jordan.joiner", "Jordan Joiner");
    expect(redeemed.statusCode).toBe(200);
    const body = redeemed.json() as { purpose: string; grants: string[] };
    expect(body.purpose).toBe("invitation");
    expect(sorted(body.grants)).toEqual(sorted(MEMBER_DIRECT_GRANTS));
    expect(body.grants).not.toContain("routine.personalize.propose");

    // Single use.
    const again = await redeemInvitation(h, token, "jordan.again", "Jordan Joiner");
    expect(again.statusCode).toBe(401);
    const previewAfter = await h.app.inject({
      method: "GET",
      url: `/api/v1/auth/access-claims/preview?token=${encodeURIComponent(token)}`,
    });
    expect(previewAfter.statusCode).toBe(401);

    // Canceled claim fails on preview and redeem.
    const other = await addPerson(h, mgr, "Taylor Canceled", "child");
    const canceledClaim = await issueClaim(h, mgr, other.id, "invitation");
    const cancel = await call(h, mgr, "POST", `/api/v1/people/${other.id}/access-claims/cancel`, {
      mutationId: randomUUID(),
      purpose: "invitation",
    });
    expect(cancel.statusCode).toBe(200);
    expect((cancel.json() as { accessState: string }).accessState).toBe("not_set_up");
    const canceledPreview = await h.app.inject({
      method: "GET",
      url: `/api/v1/auth/access-claims/preview?token=${encodeURIComponent(canceledClaim.token)}`,
    });
    expect(canceledPreview.statusCode).toBe(401);
    const canceledRedeem = await redeemInvitation(h, canceledClaim.token, "taylor.cancel", "Taylor");
    expect(canceledRedeem.statusCode).toBe(401);
    expect((await getPerson(h, mgr, other.id))!.accessState).toBe("not_set_up");
  });

  it("AT5: changeOwnPassword retires old sessions; password_reset claim redeems and invalidates old passphrase", async () => {
    const h = await createCHarness();
    const mgr = await setupHousehold(h);
    const { person, auth: memberAuth } = await enrollMember(h, mgr, "Riley Reset", "riley.reset");

    const wrong = await call(h, memberAuth, "POST", "/api/v1/auth/password", {
      mutationId: randomUUID(),
      currentPassphrase: "not-the-current-passphrase",
      newPassphrase: NEW_PASSPHRASE,
    });
    expect(wrong.statusCode).toBe(401);

    const changed = await call(h, memberAuth, "POST", "/api/v1/auth/password", {
      mutationId: randomUUID(),
      currentPassphrase: PASSPHRASE,
      newPassphrase: NEW_PASSPHRASE,
    });
    expect(changed.statusCode).toBe(200);
    const fresh = authFromSessionResponse(h, changed);
    expect(await sessionStatus(h, memberAuth)).toBe(401);
    expect(await sessionStatus(h, fresh)).toBe(200);
    expect((await login(h, "riley.reset", PASSPHRASE)).statusCode).toBe(401);
    expect((await login(h, "riley.reset", NEW_PASSPHRASE)).statusCode).toBe(200);

    // Manager-issued password_reset claim.
    const { token } = await issueClaim(h, mgr, person.id, "password_reset");
    const preview = await h.app.inject({
      method: "GET",
      url: `/api/v1/auth/access-claims/preview?token=${encodeURIComponent(token)}`,
    });
    expect(preview.statusCode).toBe(200);
    expect((preview.json() as { preview: { purpose: string } }).preview.purpose).toBe(
      "password_reset",
    );

    const weak = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/access-claims/redeem",
      headers: { origin: h.origin, "content-type": "application/json" },
      payload: { claimToken: token, newPassphrase: "short" },
    });
    expect(weak.statusCode).toBe(400);

    const redeem = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/access-claims/redeem",
      headers: { origin: h.origin, "content-type": "application/json" },
      payload: { claimToken: token, newPassphrase: RESET_PASSPHRASE },
    });
    expect(redeem.statusCode).toBe(200);
    expect(redeem.json()).toMatchObject({ purpose: "password_reset", ok: true });
    expect(await sessionStatus(h, fresh)).toBe(401);
    expect((await login(h, "riley.reset", NEW_PASSPHRASE)).statusCode).toBe(401);
    expect((await login(h, "riley.reset", RESET_PASSPHRASE)).statusCode).toBe(200);

    const reuse = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/access-claims/redeem",
      headers: { origin: h.origin, "content-type": "application/json" },
      payload: { claimToken: token, newPassphrase: "Yet-another-unique-pass-3!" },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it("AT6: revoke sign-in keeps the person; restore_sign_in claim re-enables access", async () => {
    const h = await createCHarness();
    const mgr = await setupHousehold(h);
    const { person, auth: memberAuth } = await enrollMember(h, mgr, "Morgan Member", "morgan.member");
    const before = (await getPerson(h, mgr, person.id))!;
    expect(before.accessState).toBe("access_set_up");

    // Restore is not issuable before revoke.
    const early = await call(h, mgr, "POST", `/api/v1/people/${person.id}/access-claims`, {
      mutationId: randomUUID(),
      purpose: "restore_sign_in",
    });
    expect(early.statusCode).toBe(409);

    const revoke = await call(h, mgr, "POST", `/api/v1/people/${person.id}/sign-in/revoke`, {
      mutationId: randomUUID(),
      expectedAuthorityVersion: before.authorityVersion,
    });
    expect(revoke.statusCode).toBe(200);
    const revoked = revoke.json() as Person;
    expect(revoked.signInRevoked).toBe(true);
    expect(revoked.accessState).toBe("access_revoked");
    expect(revoked.authorityVersion).toBe(before.authorityVersion + 1);

    expect(await sessionStatus(h, memberAuth)).toBe(401);
    expect((await login(h, "morgan.member")).statusCode).toBe(401);
    // Person remains in the household directory.
    expect((await getPerson(h, mgr, person.id))?.accessState).toBe("access_revoked");

    const { token } = await issueClaim(h, mgr, person.id, "restore_sign_in");
    const restored = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/access-claims/redeem",
      headers: { origin: h.origin, "content-type": "application/json" },
      payload: { claimToken: token },
    });
    expect(restored.statusCode).toBe(200);
    expect((restored.json() as { purpose: string }).purpose).toBe("restore_sign_in");
    const newAuth = authFromSessionResponse(h, restored);
    expect(newAuth.membershipId).toBe(person.id);
    expect(await sessionStatus(h, newAuth)).toBe(200);
    expect((await login(h, "morgan.member")).statusCode).toBe(200);
    expect((await getPerson(h, mgr, person.id))?.accessState).toBe("access_set_up");
  });

  it("AT7: last essential manager cannot be demoted, revoked, or removed", async () => {
    const h = await createCHarness();
    const mgr = await setupHousehold(h);
    const self = (await getPerson(h, mgr, mgr.membershipId))!;

    const demoteSelf = await savePermissions(h, mgr, self, { role: "member" });
    expect(demoteSelf.statusCode).toBe(403);
    expect((await getPerson(h, mgr, self.id))!.roleLabel).toBe("manager");

    const revokeSelf = await call(h, mgr, "POST", `/api/v1/people/${self.id}/sign-in/revoke`, {
      mutationId: randomUUID(),
      expectedAuthorityVersion: self.authorityVersion,
    });
    expect(revokeSelf.statusCode).toBe(403);

    const prev = await previewRemoval(h, mgr, self);
    expect(prev.statusCode).toBe(200);
    const removeSelf = await commitRemoval(
      h,
      mgr,
      self,
      (prev.json() as { previewDigest: string }).previewDigest,
    );
    expect(removeSelf.statusCode).toBe(403);
    expect(await sessionStatus(h, mgr)).toBe(200);

    // With a second manager, the first may step down; the survivor is then protected.
    const { person, auth: second } = await enrollMember(h, mgr, "Second Manager", "second.manager");
    const promoted = await savePermissions(h, mgr, person, { role: "manager" });
    expect(promoted.statusCode).toBe(200);
    const secondManager = (promoted.json() as { person: Person }).person;
    const demoteFirst = await savePermissions(h, mgr, self, { role: "member" });
    expect(demoteFirst.statusCode).toBe(200);

    // Session grants refresh server-side; `second` is now the sole essential manager.
    const demoteSecond = await savePermissions(h, second, secondManager, { role: "member" });
    expect(demoteSecond.statusCode).toBe(403);
    expect((await getPerson(h, second, secondManager.id))!.roleLabel).toBe("manager");
  });

  it("AT8: unused pending person is physically deleted; used person departs as a tombstone", async () => {
    const h = await createCHarness();
    const mgr = await setupHousehold(h);

    // Used: signed-in member departs.
    const { person: used } = await enrollMember(h, mgr, "Used Person", "used.person");
    const usedFresh = (await getPerson(h, mgr, used.id))!;
    const usedPreview = await previewRemoval(h, mgr, usedFresh);
    expect(usedPreview.statusCode).toBe(200);
    expect((usedPreview.json() as { impact: { mode: string } }).impact.mode).toBe("depart");
    const departed = await commitRemoval(
      h,
      mgr,
      usedFresh,
      (usedPreview.json() as { previewDigest: string }).previewDigest,
    );
    expect(departed.statusCode).toBe(200);
    expect(departed.json()).toMatchObject({ mode: "departed", membershipId: used.id });
    const tombstone = h.db
      .prepare("SELECT departed_at, departed_household_date FROM household_memberships WHERE id = ?")
      .get(used.id) as { departed_at: string | null; departed_household_date: string | null };
    expect(tombstone.departed_at).toBeTruthy();
    expect(tombstone.departed_household_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await getPerson(h, mgr, used.id)).toBeUndefined();

    // Unused: pending person whose only history is creation/profile/canceled-setup receipts.
    const createMutationId = randomUUID();
    const createPayload = {
      mutationId: createMutationId,
      displayName: "Unused Pending",
      classification: "child" as const,
    };
    const createdRes = await call(h, mgr, "POST", "/api/v1/people", createPayload);
    expect(createdRes.statusCode).toBe(200);
    const created = (createdRes.json() as { person: Person }).person;
    const canceledSetup = await issueClaim(h, mgr, created.id, "invitation");
    expect(
      (
        await call(h, mgr, "POST", `/api/v1/people/${created.id}/access-claims/cancel`, {
          mutationId: randomUUID(),
        })
      ).statusCode,
    ).toBe(200);
    const renamed = await call(h, mgr, "PATCH", `/api/v1/people/${created.id}`, {
      displayName: "Unused Renamed",
      classification: "child",
      expectedVersion: created.version,
    });
    expect(renamed.statusCode).toBe(200);
    const unused = (renamed.json() as { person: Person }).person;
    const unusedPreview = await previewRemoval(h, mgr, unused);
    expect(unusedPreview.statusCode).toBe(200);
    expect((unusedPreview.json() as { impact: { mode: string } }).impact.mode).toBe("delete");
    const deleted = await commitRemoval(
      h,
      mgr,
      unused,
      (unusedPreview.json() as { previewDigest: string }).previewDigest,
    );
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ mode: "deleted", membershipId: unused.id });
    expect(
      h.db.prepare("SELECT 1 AS ok FROM household_memberships WHERE id = ?").get(unused.id),
    ).toBeUndefined();
    expect(
      h.db.prepare("SELECT 1 AS ok FROM membership_access_claims WHERE membership_id = ?").get(
        unused.id,
      ),
    ).toBeUndefined();
    expect(h.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    // Old commands cannot resurrect or reveal the deleted profile.
    const replayCreate = await call(h, mgr, "POST", "/api/v1/people", createPayload);
    expect(replayCreate.statusCode).toBe(409);
    expect(replayCreate.body).not.toContain("Unused");
    expect(
      (
        await call(h, mgr, "PATCH", `/api/v1/people/${unused.id}`, {
          displayName: "Zombie",
          classification: "child",
          expectedVersion: unused.version + 1,
        })
      ).statusCode,
    ).toBe(404);
    expect((await redeemInvitation(h, canceledSetup.token, "zombie.login", "Zombie")).statusCode).toBe(
      401,
    );
    expect((await listPeople(h, mgr)).map((p) => p.id)).not.toContain(unused.id);
  });

  it("AT9/AT10: removal preview digest gates commit; departed member loses sessions and cannot own checklists", async () => {
    const h = await createCHarness();
    const mgr = await setupHousehold(h);
    const { person, auth: memberAuth } = await enrollMember(h, mgr, "Dana Departing", "dana.depart");
    const fresh = (await getPerson(h, mgr, person.id))!;

    const preview = await previewRemoval(h, mgr, fresh);
    expect(preview.statusCode).toBe(200);
    const { previewDigest, impact } = preview.json() as {
      previewDigest: string;
      impact: { displayName: string; mode: string; groups: unknown[] };
    };
    expect(previewDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(impact.displayName).toBe("Dana Departing");

    // Stale versions, wrong digest, bad passphrase, bad confirmation all refuse.
    const stalePreview = await call(h, mgr, "POST", `/api/v1/people/${fresh.id}/removal/preview`, {
      expectedAuthorityVersion: fresh.authorityVersion + 1,
      expectedVersion: fresh.version,
    });
    expect(stalePreview.statusCode).toBe(409);
    expect((await commitRemoval(h, mgr, fresh, "f".repeat(64))).statusCode).toBe(409);
    expect(
      (await commitRemoval(h, mgr, fresh, previewDigest, { passphrase: "wrong-passphrase-here" }))
        .statusCode,
    ).toBe(401);
    expect(
      (await commitRemoval(h, mgr, fresh, previewDigest, { confirmationText: "remove" })).statusCode,
    ).toBe(400);
    expect(await getPerson(h, mgr, fresh.id)).toBeDefined();

    const commit = await commitRemoval(h, mgr, fresh, previewDigest);
    expect(commit.statusCode).toBe(200);
    expect(commit.json()).toMatchObject({ mode: "departed" });

    expect(await getPerson(h, mgr, fresh.id)).toBeUndefined();
    expect(await sessionStatus(h, memberAuth)).toBe(401);
    expect((await login(h, "dana.depart")).statusCode).toBe(401);

    // Departed person cannot own a new checklist.
    const checklist = await call(h, mgr, "POST", "/api/v1/responsibilities", {
      mutationId: randomUUID(),
      title: "Departed owner checklist",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: fresh.id,
      steps: [{ logicalItemId: randomUUID(), text: "Step", obligation: "required" }],
    });
    expect(checklist.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("AT12: household display keeps working after a manager is removed while another manager exists", async () => {
    const h = await createCHarness();
    const mgr = await setupHousehold(h);

    const displayIssue = await call(h, mgr, "POST", "/api/v1/displays", {
      mutationId: randomUUID(),
      label: "Kitchen",
    });
    expect(displayIssue.statusCode).toBe(200);
    const code = (displayIssue.json() as { enrollment: { code: string } }).enrollment.code;
    const claim = await h.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { origin: h.origin, "content-type": "application/json" },
      payload: { code },
    });
    expect(claim.statusCode).toBe(200);
    const displayCookie = claim.cookies.find((c) => c.name === h.config.displayCookieName)!.value;
    const displayOk = async () =>
      (
        await h.app.inject({
          method: "GET",
          url: "/api/v1/display/dashboard",
          headers: { cookie: `${h.config.displayCookieName}=${displayCookie}` },
        })
      ).statusCode;
    expect(await displayOk()).toBe(200);

    const { person, auth: second } = await enrollMember(h, mgr, "Second Manager", "second.mgr");
    expect((await savePermissions(h, mgr, person, { role: "manager" })).statusCode).toBe(200);

    const self = (await getPerson(h, second, mgr.membershipId))!;
    const preview = await previewRemoval(h, second, self);
    expect(preview.statusCode).toBe(200);
    const removed = await commitRemoval(
      h,
      second,
      self,
      (preview.json() as { previewDigest: string }).previewDigest,
    );
    expect(removed.statusCode).toBe(200);
    expect(await sessionStatus(h, mgr)).toBe(401);

    // Display continuity is not tied to the removed manager's session.
    expect(await displayOk()).toBe(200);
  });

  it("AT13: fixture remediation preview on seeded household; renamed/claimed not preselected; backup needs lifecycle.manage", async () => {
    const h = await createSeededHarness();
    const boot = await h.app.inject({ method: "POST", url: "/api/v1/test/bootstrap-claim" });
    expect(boot.statusCode).toBe(200);
    const bootToken = (boot.json() as { token: string }).token;
    const claim = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/claim",
      headers: { origin: h.origin, "content-type": "application/json" },
      payload: {
        claimToken: bootToken,
        loginName: "morgan.seed",
        passphrase: PASSPHRASE,
        displayName: "Morgan Reed",
      },
    });
    const morgan = authFromSessionResponse(h, claim);
    expect(morgan.membershipId).toBe(SEED.members[0]!.id);

    type Candidate = { membershipId: string; preselected: boolean; disposable: boolean };
    const loadPreview = async (actor: Auth) => {
      const res = await call(h, actor, "GET", "/api/v1/fixtures/remediation");
      expect(res.statusCode).toBe(200);
      return res.json() as { candidates: Candidate[]; previewDigest: string };
    };
    const byId = (p: { candidates: Candidate[] }, id: string) =>
      p.candidates.find((c) => c.membershipId === id)!;

    const initial = await loadPreview(morgan);
    expect(initial.candidates).toHaveLength(SEED.members.length);
    expect(byId(initial, SEED.members[0]!.id).preselected).toBe(false); // claimed manager
    for (const m of SEED.members.slice(1)) {
      expect(byId(initial, m.id).preselected).toBe(true);
    }

    // Renamed fixture is no longer preselected.
    const casey = (await getPerson(h, morgan, SEED.members[3]!.id))!;
    const rename = await call(h, morgan, "PATCH", `/api/v1/people/${casey.id}`, {
      displayName: "Casey Renamed",
      classification: "child",
      expectedVersion: casey.version,
    });
    expect(rename.statusCode).toBe(200);
    const afterRename = await loadPreview(morgan);
    expect(byId(afterRename, casey.id).preselected).toBe(false);

    // A remover without lifecycle.manage cannot request the optional backup.
    const avery = (await getPerson(h, morgan, SEED.members[1]!.id))!;
    const grantRemove = await savePermissions(h, morgan, avery, {
      role: "member",
      memberMode: "direct",
      secondaryGrants: ["household.member.remove"],
    });
    expect(grantRemove.statusCode).toBe(200);
    const { token } = await issueClaim(h, morgan, avery.id, "invitation");
    const averyAuth = authFromSessionResponse(
      h,
      await redeemInvitation(h, token, "avery.seed", "Avery Reed"),
    );
    expect(averyAuth.membershipId).toBe(avery.id);
    const averyPreview = await loadPreview(averyAuth);
    const taylorId = SEED.members[4]!.id;
    const rowanId = SEED.members[5]!.id;
    const denied = await call(h, averyAuth, "POST", "/api/v1/fixtures/remediation/apply", {
      mutationId: randomUUID(),
      selectedMembershipIds: [taylorId, rowanId],
      previewDigest: averyPreview.previewDigest,
      passphrase: PASSPHRASE,
      saveBackupBefore: true,
      backupLabel: "Before samples",
      confirmationText: "REMOVE SAMPLES",
    });
    expect(denied.statusCode).toBe(403);
    expect(await getPerson(h, morgan, taylorId)).toBeDefined();

    // Manager with lifecycle.manage may save a backup first and removes the samples.
    const managerPreview = await loadPreview(morgan);
    const applied = await call(h, morgan, "POST", "/api/v1/fixtures/remediation/apply", {
      mutationId: randomUUID(),
      selectedMembershipIds: [taylorId, rowanId],
      previewDigest: managerPreview.previewDigest,
      passphrase: PASSPHRASE,
      saveBackupBefore: true,
      backupLabel: "Before samples",
      confirmationText: "REMOVE SAMPLES",
    });
    expect(applied.statusCode).toBe(200);
    const result = applied.json() as {
      results: Array<{ membershipId: string; mode: string }>;
      backup: { id: string; label: string | null } | null;
    };
    expect(result.results.map((r) => r.membershipId).sort()).toEqual([taylorId, rowanId].sort());
    expect(result.backup?.label).toBe("Before samples");
    expect(await getPerson(h, morgan, taylorId)).toBeUndefined();
    expect(await getPerson(h, morgan, rowanId)).toBeUndefined();
    expect(await getPerson(h, morgan, morgan.membershipId)).toBeDefined();
  }, 120_000);

  it("AT14: permission, access, and removal routes deny anonymous, CSRF-less, and under-privileged callers", async () => {
    const h = await createCHarness();
    const mgr = await setupHousehold(h);
    const { person, auth: member } = await enrollMember(h, mgr, "Plain Member", "plain.member");
    const target = (await getPerson(h, mgr, person.id))!;
    const base = `/api/v1/people/${target.id}`;

    const mutations: Array<{ url: string; body: Record<string, unknown> }> = [
      {
        url: `${base}/permissions`,
        body: {
          mutationId: randomUUID(),
          expectedAuthorityVersion: target.authorityVersion,
          role: "manager",
          secondaryGrants: [],
        },
      },
      {
        url: `${base}/access-claims`,
        body: { mutationId: randomUUID(), purpose: "password_reset" },
      },
      {
        url: `${base}/access-claims/cancel`,
        body: { mutationId: randomUUID() },
      },
      {
        url: `${base}/sign-in/revoke`,
        body: { mutationId: randomUUID(), expectedAuthorityVersion: target.authorityVersion },
      },
      {
        url: `${base}/removal/preview`,
        body: {
          expectedAuthorityVersion: target.authorityVersion,
          expectedVersion: target.version,
        },
      },
      {
        url: `${base}/removal`,
        body: {
          mutationId: randomUUID(),
          expectedAuthorityVersion: target.authorityVersion,
          expectedVersion: target.version,
          passphrase: PASSPHRASE,
          previewDigest: "a".repeat(64),
          confirmationText: "REMOVE",
        },
      },
      {
        url: "/api/v1/auth/password",
        body: {
          mutationId: randomUUID(),
          currentPassphrase: PASSPHRASE,
          newPassphrase: NEW_PASSPHRASE,
        },
      },
    ];

    for (const m of mutations) {
      // Anonymous
      expect((await call(h, null, "POST", m.url, m.body)).statusCode, `anon ${m.url}`).toBe(401);
      // Session without CSRF header
      expect(
        (await call(h, mgr, "POST", m.url, m.body, { withCsrf: false })).statusCode,
        `csrf ${m.url}`,
      ).toBe(403);
      // Wrong origin
      const badOrigin = await h.app.inject({
        method: "POST",
        url: m.url,
        headers: { ...authHeaders(h, mgr), origin: "http://evil.example" },
        payload: m.body,
      });
      expect(badOrigin.statusCode, `origin ${m.url}`).toBe(403);
    }

    // Plain member (no access.manage / member.remove) is forbidden on the grant-gated routes.
    for (const m of mutations.slice(0, 6)) {
      const res = await call(h, member, "POST", m.url, m.body);
      expect(res.statusCode, `member ${m.url}`).toBe(403);
    }

    // Redeem requires Origin but not CSRF; reads remain session-bound.
    const noOrigin = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/access-claims/redeem",
      headers: { "content-type": "application/json" },
      payload: { claimToken: "x".repeat(24), loginName: "nobody.here", passphrase: PASSPHRASE, displayName: "N" },
    });
    expect(noOrigin.statusCode).toBe(403);
    expect((await call(h, null, "GET", "/api/v1/fixtures/remediation")).statusCode).toBe(401);
    expect((await call(h, member, "GET", "/api/v1/fixtures/remediation")).statusCode).toBe(403);

    // Nothing above changed the target.
    const after = (await getPerson(h, mgr, target.id))!;
    expect(after.authorityVersion).toBe(target.authorityVersion);
    expect(after.roleLabel).toBe("member");
  });
});
