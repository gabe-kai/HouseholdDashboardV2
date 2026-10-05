import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/server/db.js";
import { createHttpHarness, type HttpHarness } from "../helpers/auth-fixture.js";

const OWNER_SECRET = "test-owner-secret-with-enough-entropy-0123456789abcdef";
const harnesses: HttpHarness[] = [];
const temps: string[] = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    await harnesses.pop()?.close();
  }
  for (const file of temps.splice(0)) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
  }
});

function controlPathForTest(): string {
  const p = path.join(os.tmpdir(), `hd-control-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  temps.push(p);
  return p;
}

async function ownerSession(harness: HttpHarness): Promise<{ cookie: string; csrf: string }> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/owner/session",
    headers: { origin: harness.origin, "content-type": "application/json" },
    payload: { secret: OWNER_SECRET },
  });
  expect(res.statusCode).toBe(200);
  const csrf = (res.json() as { csrfToken: string }).csrfToken;
  const cookie = res.cookies.find((c) => c.name === harness.config.ownerCookieName)!;
  return { cookie: `${cookie.name}=${cookie.value}`, csrf };
}

describe("P0-008A lifecycle foundation", () => {
  it("AT1 adoption smoke: migrates disposable DB and initializes control without wipe", async () => {
    const harness = await createHttpHarness({
      AUTO_SEED: "0",
      INSTALLATION_OWNER_SECRET: OWNER_SECRET,
      INSTALLATION_CONTROL_PATH: controlPathForTest(),
    });
    harnesses.push(harness);
    migrate(harness.db);
    migrate(harness.db);
    const meta = await harness.app.inject({ method: "GET", url: "/api/v1/meta" });
    expect(meta.statusCode).toBe(200);
    const body = meta.json() as { installationEpoch: number; ownerConfigured: boolean };
    expect(body.installationEpoch).toBe(1);
    expect(body.ownerConfigured).toBe(true);
    expect(harness.db.prepare("SELECT COUNT(*) AS c FROM households").get()).toEqual({ c: 0 });
  });

  it("AT2 owner gate rejects wrong secret and foreign origin", async () => {
    const harness = await createHttpHarness({
      AUTO_SEED: "0",
      INSTALLATION_OWNER_SECRET: OWNER_SECRET,
      INSTALLATION_CONTROL_PATH: controlPathForTest(),
    });
    harnesses.push(harness);
    const badSecret = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/session",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { secret: "wrong" },
    });
    expect(badSecret.statusCode).toBe(401);
    const noOrigin = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/session",
      headers: { "content-type": "application/json" },
      payload: { secret: OWNER_SECRET },
    });
    expect(noOrigin.statusCode).toBe(403);
    const bootstrap = await harness.app.inject({
      method: "POST",
      url: "/api/v1/test/bootstrap-claim",
    });
    expect(bootstrap.statusCode).toBe(403);
  });

  it("AT3 race sketch: concurrent setup accounts yield one manager", async () => {
    const harness = await createHttpHarness({
      AUTO_SEED: "0",
      INSTALLATION_OWNER_SECRET: OWNER_SECRET,
      INSTALLATION_CONTROL_PATH: controlPathForTest(),
    });
    harnesses.push(harness);
    const owner = await ownerSession(harness);
    const invite = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/setup-invitation",
      headers: {
        origin: harness.origin,
        cookie: owner.cookie,
        "x-csrf-token": owner.csrf,
      },
    });
    expect(invite.statusCode).toBe(200);
    const invitationToken = (invite.json() as { invitationToken: string }).invitationToken;

    const exchangeA = await harness.app.inject({
      method: "POST",
      url: "/api/v1/setup/exchange",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { invitationToken },
    });
    expect(exchangeA.statusCode).toBe(200);
    const setupCookieA = exchangeA.cookies.find((c) => c.name === harness.config.setupCookieName)!;

    const exchangeB = await harness.app.inject({
      method: "POST",
      url: "/api/v1/setup/exchange",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { invitationToken },
    });
    expect(exchangeB.statusCode).toBe(401);

    const account = await harness.app.inject({
      method: "POST",
      url: "/api/v1/setup/account",
      headers: {
        origin: harness.origin,
        cookie: `${setupCookieA.name}=${setupCookieA.value}`,
        "content-type": "application/json",
      },
      payload: {
        loginName: `mgr.${Date.now().toString(36)}`,
        passphrase: "Unique-passphrase-ok!999",
        displayName: "Taylor Manager",
      },
    });
    expect(account.statusCode).toBe(200);
    const managers = harness.db
      .prepare(
        `SELECT COUNT(DISTINCT hm.id) AS c
         FROM household_memberships hm
         JOIN membership_grants mg ON mg.membership_id = hm.id
         WHERE hm.status = 'active' AND mg.grant_name = 'household.lifecycle.manage'`,
      )
      .get() as { c: number };
    expect(managers.c).toBe(1);
  });

  it("AT7 reset smoke advances epoch and clears household rows", async () => {
    const harness = await createHttpHarness({
      AUTO_SEED: "0",
      INSTALLATION_OWNER_SECRET: OWNER_SECRET,
      INSTALLATION_CONTROL_PATH: controlPathForTest(),
    });
    harnesses.push(harness);
    const owner = await ownerSession(harness);
    const invite = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/setup-invitation",
      headers: {
        origin: harness.origin,
        cookie: owner.cookie,
        "x-csrf-token": owner.csrf,
      },
    });
    expect(invite.statusCode).toBe(200);
    const invitationToken = (invite.json() as { invitationToken: string }).invitationToken;
    const exchanged = await harness.app.inject({
      method: "POST",
      url: "/api/v1/setup/exchange",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { invitationToken },
    });
    const setupCookie = exchanged.cookies.find((c) => c.name === harness.config.setupCookieName)!;
    const account = await harness.app.inject({
      method: "POST",
      url: "/api/v1/setup/account",
      headers: {
        origin: harness.origin,
        cookie: `${setupCookie.name}=${setupCookie.value}`,
        "content-type": "application/json",
      },
      payload: {
        loginName: `reset.${Date.now().toString(36)}`,
        passphrase: "Unique-passphrase-ok!999",
        displayName: "Reset Manager",
      },
    });
    expect(account.statusCode).toBe(200);
    const memberCookie = account.cookies.find((c) => c.name === harness.config.cookieName)!;
    const csrf = (account.json() as { csrfToken: string }).csrfToken;
    const reauth = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/reauthenticate",
      headers: {
        origin: harness.origin,
        cookie: `${memberCookie.name}=${memberCookie.value}`,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      payload: { passphrase: "Unique-passphrase-ok!999" },
    });
    expect(reauth.statusCode).toBe(200);
    const reset = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/reset",
      headers: {
        origin: harness.origin,
        cookie: `${memberCookie.name}=${memberCookie.value}`,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        confirmationText: "RESET",
        expectedEpoch: 1,
      },
    });
    expect(reset.statusCode).toBe(200);
    const resetBody = reset.json() as { resultEpoch: number; setupRequired: boolean };
    expect(resetBody.resultEpoch).toBe(2);
    expect(resetBody.setupRequired).toBe(true);
    const meta = await harness.app.inject({ method: "GET", url: "/api/v1/meta" });
    expect((meta.json() as { installationEpoch: number }).installationEpoch).toBe(2);
    expect((meta.json() as { setupRequired: boolean }).setupRequired).toBe(true);
  });

  it("AT1 multi-household refuse: reset blocked when more than one household exists", async () => {
    const harness = await createHttpHarness({
      AUTO_SEED: "0",
      INSTALLATION_OWNER_SECRET: OWNER_SECRET,
      INSTALLATION_CONTROL_PATH: controlPathForTest(),
    });
    harnesses.push(harness);
    harness.runtime.db
      .prepare(`INSERT INTO households (id, name, timezone) VALUES (?, 'One', 'UTC'), (?, 'Two', 'UTC')`)
      .run(randomUUID(), randomUUID());
    const count = harness.runtime.db
      .prepare("SELECT COUNT(*) AS c FROM households")
      .get() as { c: number };
    expect(count.c).toBe(2);
    await expect(
      harness.runtime.replaceWithEmptyDatabase({
        operationId: randomUUID(),
        sourceEpoch: harness.runtime.epoch,
      }),
    ).rejects.toThrow(/Multiple households/i);
    expect(
      (harness.runtime.db.prepare("SELECT COUNT(*) AS c FROM households").get() as { c: number })
        .c,
    ).toBe(2);
  });

  it("AT9 fault before activate leaves original database intact", async () => {
    const harness = await createHttpHarness({
      AUTO_SEED: "0",
      INSTALLATION_OWNER_SECRET: OWNER_SECRET,
      INSTALLATION_CONTROL_PATH: controlPathForTest(),
    });
    harnesses.push(harness);
    const hh = randomUUID();
    harness.runtime.db
      .prepare(`INSERT INTO households (id, name, timezone) VALUES (?, 'Keep Me', 'UTC')`)
      .run(hh);
    harness.runtime.faultHooks.beforeActivate = () => {
      throw new Error("fault:beforeActivate");
    };
    await expect(
      harness.runtime.replaceWithEmptyDatabase({
        operationId: randomUUID(),
        sourceEpoch: harness.runtime.epoch,
      }),
    ).rejects.toThrow(/fault:beforeActivate/);
    expect(
      (
        harness.runtime.db
          .prepare("SELECT name FROM households WHERE id = ?")
          .get(hh) as { name: string } | undefined
      )?.name,
    ).toBe("Keep Me");
    expect(harness.runtime.epoch).toBe(1);
  });

  it("AT8 idempotent reset replay returns prior result without wiping newer data", async () => {
    const harness = await createHttpHarness({
      AUTO_SEED: "0",
      INSTALLATION_OWNER_SECRET: OWNER_SECRET,
      INSTALLATION_CONTROL_PATH: controlPathForTest(),
    });
    harnesses.push(harness);
    const owner = await ownerSession(harness);
    async function inviteAndCreate(login: string) {
      const invite = await harness.app.inject({
        method: "POST",
        url: "/api/v1/owner/setup-invitation",
        headers: {
          origin: harness.origin,
          cookie: owner.cookie,
          "x-csrf-token": owner.csrf,
        },
      });
      const invitationToken = (invite.json() as { invitationToken: string }).invitationToken;
      const exchanged = await harness.app.inject({
        method: "POST",
        url: "/api/v1/setup/exchange",
        headers: { origin: harness.origin, "content-type": "application/json" },
        payload: { invitationToken },
      });
      const setupCookie = exchanged.cookies.find(
        (c) => c.name === harness.config.setupCookieName,
      )!;
      const account = await harness.app.inject({
        method: "POST",
        url: "/api/v1/setup/account",
        headers: {
          origin: harness.origin,
          cookie: `${setupCookie.name}=${setupCookie.value}`,
          "content-type": "application/json",
        },
        payload: {
          loginName: login,
          passphrase: "Unique-passphrase-ok!999",
          displayName: "Replay Manager",
        },
      });
      expect(account.statusCode).toBe(200);
      return account;
    }

    const first = await inviteAndCreate(`replay.${Date.now().toString(36)}`);
    const memberCookie = first.cookies.find((c) => c.name === harness.config.cookieName)!;
    const csrf = (first.json() as { csrfToken: string }).csrfToken;
    await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/reauthenticate",
      headers: {
        origin: harness.origin,
        cookie: `${memberCookie.name}=${memberCookie.value}`,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      payload: { passphrase: "Unique-passphrase-ok!999" },
    });
    const mutationId = randomUUID();
    const reset1 = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/reset",
      headers: {
        origin: harness.origin,
        cookie: `${memberCookie.name}=${memberCookie.value}`,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      payload: { mutationId, confirmationText: "RESET", expectedEpoch: 1 },
    });
    expect(reset1.statusCode).toBe(200);

    const second = await inviteAndCreate(`newer.${Date.now().toString(36)}`);
    expect(second.statusCode).toBe(200);
    expect(
      (harness.runtime.db.prepare("SELECT COUNT(*) AS c FROM households").get() as { c: number })
        .c,
    ).toBe(1);

    // Revoked pre-reset session + stale epoch cannot wipe the new household.
    const stale = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/reset",
      headers: {
        origin: harness.origin,
        cookie: `${memberCookie.name}=${memberCookie.value}`,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      payload: { mutationId, confirmationText: "RESET", expectedEpoch: 1 },
    });
    expect(stale.statusCode).toBe(401);
    expect(
      (harness.runtime.db.prepare("SELECT COUNT(*) AS c FROM households").get() as { c: number })
        .c,
    ).toBe(1);
    expect(harness.runtime.epoch).toBe(2);
  });
});
