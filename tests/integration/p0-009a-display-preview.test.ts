import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { householdDateFromInstant } from "../../src/domain/time.js";
import {
  IDS,
  PASSPHRASE,
  authHeaders,
  claimManager,
  createHttpHarness,
  enrollAndClaim,
  httpClaimManager,
  type HttpHarness,
} from "../helpers/auth-fixture.js";

const harnesses: HttpHarness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.close();
  }
});

function requiredStep(text: string) {
  return {
    logicalItemId: randomUUID(),
    text,
    obligation: "required" as const,
  };
}

function memberCookie(harness: HttpHarness, token: string) {
  return `${harness.config.cookieName}=${token}`;
}

async function createDisplay(
  harness: HttpHarness,
  session: { cookieHeader: string; csrfToken: string },
  label: string,
) {
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/displays",
    headers: {
      ...authHeaders(harness, session),
      "content-type": "application/json",
    },
    payload: { mutationId: randomUUID(), label },
  });
  expect(created.statusCode).toBe(200);
  return created.json() as {
    display: { id: string; label: string };
    enrollment: { code: string };
  };
}

function previewUrls(displayId: string) {
  return {
    dashboard: `/api/v1/displays/${displayId}/preview/dashboard`,
    person: (membershipId: string) =>
      `/api/v1/displays/${displayId}/preview/people/${membershipId}`,
    occurrence: (occurrenceId: string) =>
      `/api/v1/displays/${displayId}/preview/occurrences/${occurrenceId}`,
  };
}

describe("P0-009A display preview HTTP", () => {
  it("AT1a: authorized claimed and unclaimed displays preview without a device session", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const session = await httpClaimManager(harness);
    const unclaimed = await createDisplay(harness, session, "Never claimed wall");
    const claimed = await createDisplay(harness, session, "Claimed wall");
    const claim = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { code: claimed.enrollment.code },
    });
    expect(claim.statusCode).toBe(200);

    for (const display of [unclaimed.display, claimed.display]) {
      const urls = previewUrls(display.id);
      const dashboard = await harness.app.inject({
        method: "GET",
        url: urls.dashboard,
        headers: { cookie: session.cookieHeader },
      });
      expect(dashboard.statusCode, dashboard.body).toBe(200);
      expect(dashboard.headers["cache-control"]).toBe("no-store");
      const body = dashboard.json() as {
        displayId: string;
        label: string;
        householdDate: string;
        timezone: string;
        serverTime: string;
        activityGeneration: number;
        installationEpoch: number;
        dashboard: { byPerson: unknown[] };
      };
      expect(body.displayId).toBe(display.id);
      expect(body.label).toBe(display.label);
      expect(body.householdDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(body.timezone).toBe("America/New_York");
      expect(body.installationEpoch).toBe(harness.runtime.epoch);
      expect(Array.isArray(body.dashboard.byPerson)).toBe(true);
      expect(JSON.stringify(body)).not.toMatch(/csrf|intendedStructure|sessionId/i);

      const person = await harness.app.inject({
        method: "GET",
        url: urls.person(IDS.avery),
        headers: { cookie: session.cookieHeader },
      });
      expect(person.statusCode, person.body).toBe(200);
    }
  });

  it("AT1b: anonymous, display-only, owner-only, and member without grant are denied", async () => {
    const harness = await createHttpHarness({
      AUTO_SEED: "1",
      INSTALLATION_OWNER_SECRET: "owner-secret-with-enough-entropy-0123456789ab",
    });
    harnesses.push(harness);
    const storeManager = await claimManager(harness.store);
    const manager = {
      cookieHeader: `${harness.config.cookieName}=${storeManager.token}`,
      csrfToken: storeManager.csrfSecret,
      membershipId: storeManager.context.membershipId,
    };
    const created = await createDisplay(harness, manager, "Denied wall");
    const urls = previewUrls(created.display.id);

    const anonymous = await harness.app.inject({ method: "GET", url: urls.dashboard });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).not.toHaveProperty("dashboard");

    const claim = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { code: created.enrollment.code },
    });
    const displayCookie = claim.cookies.find(
      (cookie) => cookie.name === harness.config.displayCookieName,
    );
    const displayOnly = await harness.app.inject({
      method: "GET",
      url: urls.dashboard,
      headers: { cookie: `${displayCookie!.name}=${displayCookie!.value}` },
    });
    expect(displayOnly.statusCode).toBe(401);

    const owner = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/session",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { secret: "owner-secret-with-enough-entropy-0123456789ab" },
    });
    expect(owner.statusCode).toBe(200);
    const ownerCookie = owner.cookies.find(
      (cookie) => cookie.name === harness.config.ownerCookieName,
    );
    const ownerOnly = await harness.app.inject({
      method: "GET",
      url: urls.dashboard,
      headers: { cookie: `${ownerCookie!.name}=${ownerCookie!.value}` },
    });
    expect(ownerOnly.statusCode).toBe(401);

    const member = await enrollAndClaim(
      harness.store,
      storeManager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    const noGrant = await harness.app.inject({
      method: "GET",
      url: urls.dashboard,
      headers: { cookie: memberCookie(harness, member.token) },
    });
    expect(noGrant.statusCode).toBe(403);
    expect(noGrant.json()).not.toHaveProperty("dashboard");
  });

  it("AT1c: malformed, missing, revoked, and foreign IDs isolate without leaking names", async () => {
    const first = await createHttpHarness({ AUTO_SEED: "1" });
    const second = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(first, second);
    const managerA = await claimManager(first.store);
    const sessionA = {
      cookieHeader: `${first.config.cookieName}=${managerA.token}`,
      csrfToken: managerA.csrfSecret,
      membershipId: managerA.context.membershipId,
    };
    const sessionB = await httpClaimManager(second);
    const own = await createDisplay(first, sessionA, "Own wall");
    const foreign = await createDisplay(second, sessionB, "Foreign secret wall");
    const urls = previewUrls(own.display.id);

    const malformed = await first.app.inject({
      method: "GET",
      url: "/api/v1/displays/not-a-uuid/preview/dashboard",
      headers: { cookie: sessionA.cookieHeader },
    });
    expect(malformed.statusCode).toBe(400);

    const missing = await first.app.inject({
      method: "GET",
      url: previewUrls("33333333-3333-4333-8333-333333333333").dashboard,
      headers: { cookie: sessionA.cookieHeader },
    });
    expect(missing.statusCode).toBe(404);
    expect(JSON.stringify(missing.json())).not.toMatch(/Foreign|secret/i);

    const foreignRead = await first.app.inject({
      method: "GET",
      url: previewUrls(foreign.display.id).dashboard,
      headers: { cookie: sessionA.cookieHeader },
    });
    expect(foreignRead.statusCode).toBe(404);
    expect(JSON.stringify(foreignRead.json())).not.toMatch(/Foreign secret wall/);

    await first.app.inject({
      method: "POST",
      url: `/api/v1/displays/${own.display.id}/revoke`,
      headers: {
        ...authHeaders(first, sessionA),
        "content-type": "application/json",
      },
      payload: { mutationId: randomUUID(), expectedConfigVersion: 1 },
    });
    const revoked = await first.app.inject({
      method: "GET",
      url: urls.dashboard,
      headers: { cookie: sessionA.cookieHeader },
    });
    expect(revoked.statusCode).toBe(404);

    first.store.createRoutine(managerA.context, {
      mutationId: randomUUID(),
      title: "Preview stretch",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      steps: [requiredStep("Stretch")],
    });
    const live = await createDisplay(first, sessionA, "Live isolation");
    const dash = await first.app.inject({
      method: "GET",
      url: previewUrls(live.display.id).dashboard,
      headers: { cookie: sessionA.cookieHeader },
    });
    const occurrenceId = (
      dash.json() as {
        dashboard: {
          byPerson: Array<{ unfinished: Array<{ occurrenceId: string }> }>;
        };
      }
    ).dashboard.byPerson.flatMap((row) => row.unfinished)[0]?.occurrenceId;
    expect(occurrenceId).toBeTruthy();

    const foreignPerson = await first.app.inject({
      method: "GET",
      url: previewUrls(live.display.id).person("44444444-4444-4444-8444-444444444444"),
      headers: { cookie: sessionA.cookieHeader },
    });
    expect(foreignPerson.statusCode).toBe(404);

    const oldOccurrence = await first.app.inject({
      method: "GET",
      url: previewUrls(live.display.id).occurrence("55555555-5555-4555-8555-555555555555"),
      headers: { cookie: sessionA.cookieHeader },
    });
    expect(oldOccurrence.statusCode).toBe(404);
    expect(JSON.stringify(oldOccurrence.json())).not.toMatch(/Preview stretch/);
  });

  it("AT2a/AT2b: preview DTO matches wall projection and omits private/command fields", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const manager = await claimManager(harness.store);
    const session = {
      cookieHeader: `${harness.config.cookieName}=${manager.token}`,
      csrfToken: manager.csrfSecret,
      membershipId: manager.context.membershipId,
    };
    const created = await createDisplay(harness, session, "Parity wall");
    const claim = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { code: created.enrollment.code },
    });
    const displayCookie = claim.cookies.find(
      (cookie) => cookie.name === harness.config.displayCookieName,
    )!;

    harness.store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Shared morning",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery, IDS.casey],
      assigneeGroupIds: [],
      steps: [requiredStep("Avery variant pack"), requiredStep("Shared finish")],
    });
    harness.store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Kitchen composed",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: IDS.avery,
      steps: [requiredStep("Counters")],
    });
    harness.store.createTask(manager.context, {
      title: "Manager private secret",
      visibility: "private",
    });
    harness.store.createTask(manager.context, {
      title: "Promoted library",
      visibility: "household",
      showOnSharedDashboard: true,
    });
    harness.store.createTask(manager.context, {
      title: "Household but not promoted",
      visibility: "household",
      showOnSharedDashboard: false,
    });

    const wallDash = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: { cookie: `${displayCookie.name}=${displayCookie.value}` },
    });
    const previewDash = await harness.app.inject({
      method: "GET",
      url: previewUrls(created.display.id).dashboard,
      headers: { cookie: session.cookieHeader },
    });
    expect(previewDash.statusCode).toBe(200);
    const wall = (wallDash.json() as { dashboard: { byPerson: unknown; byWork: unknown } })
      .dashboard;
    const preview = (
      previewDash.json() as {
        dashboard: {
          byPerson: Array<{
            displayName: string;
            unfinished: Array<{ title: string; occurrenceId: string }>;
            promotedPersonalTasks: Array<{ title: string }>;
          }>;
          promotedPersonalTasks: Array<{ title: string }>;
        };
      }
    ).dashboard;
    expect(preview.byPerson.map((row) => row.displayName)).toEqual(
      (wall.byPerson as Array<{ displayName: string }>).map((row) => row.displayName),
    );
    expect(JSON.stringify(previewDash.json())).not.toMatch(/Manager private secret/);
    expect(JSON.stringify(previewDash.json())).not.toMatch(/intendedStructure/);
    expect(preview.promotedPersonalTasks.map((task) => task.title)).toContain(
      "Promoted library",
    );
    expect(preview.promotedPersonalTasks.map((task) => task.title)).not.toContain(
      "Household but not promoted",
    );

    const averyUnfinished = preview.byPerson.find((row) =>
      row.unfinished.some((item) => item.title === "Shared morning"),
    );
    const occurrenceId = averyUnfinished?.unfinished.find(
      (item) => item.title === "Shared morning",
    )?.occurrenceId;
    expect(occurrenceId).toBeTruthy();
    const wallOcc = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/occurrences/${occurrenceId}`,
      headers: { cookie: `${displayCookie.name}=${displayCookie.value}` },
    });
    const previewOcc = await harness.app.inject({
      method: "GET",
      url: previewUrls(created.display.id).occurrence(occurrenceId!),
      headers: { cookie: session.cookieHeader },
    });
    const wallDetail = (wallOcc.json() as { occurrence: { steps: unknown[]; intendedStructure?: unknown } })
      .occurrence;
    const previewDetail = (
      previewOcc.json() as { occurrence: { steps: Array<{ text: string; logicalItemId?: string }> } }
    ).occurrence;
    expect(previewDetail.steps.map((step) => step.text)).toEqual(
      (wallDetail.steps as Array<{ text: string }>).map((step) => step.text),
    );
    expect(previewDetail).not.toHaveProperty("intendedStructure");
    expect(previewDetail.steps.some((step) => step.logicalItemId)).toBe(false);

    const person = await harness.app.inject({
      method: "GET",
      url: previewUrls(created.display.id).person(manager.context.membershipId),
      headers: { cookie: session.cookieHeader },
    });
    const personBody = person.json() as {
      person: { householdVisibleTasks: Array<{ title: string; showOnSharedDashboard: boolean }> };
    };
    expect(personBody.person.householdVisibleTasks.map((task) => task.title)).toContain(
      "Household but not promoted",
    );
    expect(JSON.stringify(person.json())).not.toMatch(/Manager private secret/);
  });

  it("AT3a: preview does not refresh display last_seen or write display receipts", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const session = await httpClaimManager(harness);
    const created = await createDisplay(harness, session, "Presence wall");
    const claim = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { code: created.enrollment.code },
    });
    const displayCookie = claim.cookies.find(
      (cookie) => cookie.name === harness.config.displayCookieName,
    )!;
    await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: { cookie: `${displayCookie.name}=${displayCookie.value}` },
    });
    const before = harness.db
      .prepare(`SELECT last_seen_at FROM display_sessions WHERE display_id = ?`)
      .get(created.display.id) as { last_seen_at: string };
    const receiptCountBefore = (
      harness.db.prepare(`SELECT COUNT(*) AS c FROM display_command_receipts`).get() as {
        c: number;
      }
    ).c;

    await new Promise((resolve) => setTimeout(resolve, 20));
    await harness.app.inject({
      method: "GET",
      url: previewUrls(created.display.id).dashboard,
      headers: { cookie: session.cookieHeader },
    });
    const after = harness.db
      .prepare(`SELECT last_seen_at FROM display_sessions WHERE display_id = ?`)
      .get(created.display.id) as { last_seen_at: string };
    expect(after.last_seen_at).toBe(before.last_seen_at);
    expect(
      (harness.db.prepare(`SELECT COUNT(*) AS c FROM display_command_receipts`).get() as {
        c: number;
      }).c,
    ).toBe(receiptCountBefore);
  });

  it("AT4a: preview materializes only current day and rejects date override", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const manager = await claimManager(harness.store);
    const session = {
      cookieHeader: `${harness.config.cookieName}=${manager.token}`,
      csrfToken: manager.csrfSecret,
      membershipId: manager.context.membershipId,
    };
    const created = await createDisplay(harness, session, "Date wall");
    harness.store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Today only stretch",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      steps: [requiredStep("Today step")],
    });
    const today = householdDateFromInstant(new Date(), manager.context.timezone);
    const override = await harness.app.inject({
      method: "GET",
      url: `${previewUrls(created.display.id).dashboard}?date=2020-01-01`,
      headers: { cookie: session.cookieHeader },
    });
    expect(override.statusCode).toBe(400);
    const preview = await harness.app.inject({
      method: "GET",
      url: previewUrls(created.display.id).dashboard,
      headers: { cookie: session.cookieHeader },
    });
    const body = preview.json() as { householdDate: string };
    expect(body.householdDate).toBe(today);
    const dates = (
      harness.db
        .prepare(`SELECT DISTINCT household_date AS d FROM occurrences`)
        .all() as Array<{ d: string }>
    ).map((row) => row.d);
    expect(dates.every((date) => date === today)).toBe(true);
  });

  it("AT5c: grant loss and revocation fail subsequent preview reads", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const storeManager = await claimManager(harness.store);
    const session = {
      cookieHeader: `${harness.config.cookieName}=${storeManager.token}`,
      csrfToken: storeManager.csrfSecret,
      membershipId: storeManager.context.membershipId,
    };
    const created = await createDisplay(harness, session, "Loss wall");
    const ok = await harness.app.inject({
      method: "GET",
      url: previewUrls(created.display.id).dashboard,
      headers: { cookie: session.cookieHeader },
    });
    expect(ok.statusCode).toBe(200);

    await harness.app.inject({
      method: "POST",
      url: `/api/v1/displays/${created.display.id}/revoke`,
      headers: {
        ...authHeaders(harness, session),
        "content-type": "application/json",
      },
      payload: { mutationId: randomUUID(), expectedConfigVersion: 1 },
    });
    const revoked = await harness.app.inject({
      method: "GET",
      url: previewUrls(created.display.id).dashboard,
      headers: { cookie: session.cookieHeader },
    });
    expect(revoked.statusCode).toBe(404);

    const stillGranted = await createDisplay(harness, session, "Grant loss wall");
    harness.db
      .prepare(
        `DELETE FROM membership_grants
         WHERE membership_id = ? AND grant_name = 'household.display.manage'`,
      )
      .run(session.membershipId);
    const lostGrant = await harness.app.inject({
      method: "GET",
      url: previewUrls(stillGranted.display.id).dashboard,
      headers: { cookie: session.cookieHeader },
    });
    expect(lostGrant.statusCode).toBe(403);
  });

  it("AT5e: held preview releases shared lock so reset can proceed; old session fails", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const session = await httpClaimManager(harness);
    const created = await createDisplay(harness, session, "Hold wall");
    const reauth = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/reauthenticate",
      headers: {
        ...authHeaders(harness, session),
        "content-type": "application/json",
      },
      payload: { passphrase: PASSPHRASE },
    });
    expect(reauth.statusCode, reauth.body).toBe(200);
    const started = Date.now();
    const held = harness.app.inject({
      method: "GET",
      url: previewUrls(created.display.id).dashboard,
      headers: {
        cookie: session.cookieHeader,
        "x-read-delay-ms": "400",
      },
    });
    const reset = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/reset",
      headers: {
        ...authHeaders(harness, session),
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        confirmationText: "RESET",
        expectedEpoch: harness.runtime.epoch,
        saveBackupBeforeReset: false,
      },
    });
    expect(reset.statusCode, reset.body).toBe(200);
    expect(Date.now() - started).toBeLessThan(10_000);
    const heldRes = await held;
    expect(heldRes.statusCode).toBe(401);
    expect(heldRes.json()).not.toHaveProperty("dashboard");

    const after = await harness.app.inject({
      method: "GET",
      url: previewUrls(created.display.id).dashboard,
      headers: { cookie: session.cookieHeader },
    });
    expect(after.statusCode).toBe(401);
  });
});
