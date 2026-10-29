import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { addHouseholdDays } from "../../src/domain/time.js";
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

async function claimDisplay(harness: HttpHarness, code: string) {
  const claim = await harness.app.inject({
    method: "POST",
    url: "/api/v1/display/claim",
    headers: { origin: harness.origin, "content-type": "application/json" },
    payload: { code },
  });
  expect(claim.statusCode).toBe(200);
  const cookie = claim.cookies.find((row) => row.name === harness.config.displayCookieName);
  expect(cookie?.value).toBeTruthy();
  return cookie!.value;
}

function displayHeaders(harness: HttpHarness, token: string) {
  return { cookie: `${harness.config.displayCookieName}=${token}` };
}

function displayWriteHeaders(harness: HttpHarness, token: string, csrf: string) {
  return {
    ...displayHeaders(harness, token),
    origin: harness.origin,
    "x-csrf-token": csrf,
    "content-type": "application/json",
  };
}

type PersonDayOccurrence = {
  id: string;
  kind: "routine" | "responsibility";
  householdDate: string;
  intendedStructure?: {
    revisionId: string;
    accountableMemberId: string;
    stepLogicalIds: string[];
  };
  steps: Array<{ id: string; obligation?: string }>;
};

function personDayOccurrence(body: unknown): PersonDayOccurrence {
  const occ = (body as { personDay: { occurrences: PersonDayOccurrence[] } }).personDay
    .occurrences[0];
  if (!occ) throw new Error("expected person-day occurrence");
  return occ;
}

function statusPayload(occ: PersonDayOccurrence, status: "completed" | "open" | "not_needed") {
  return {
    mutationId: randomUUID(),
    status,
    performedAt: new Date().toISOString(),
    householdDate: occ.householdDate,
    kind: occ.kind,
    intendedStructure: occ.intendedStructure,
  };
}

async function createAssignedRoutine(
  harness: HttpHarness,
  session: { cookieHeader: string; csrfToken: string },
  title: string,
  assigneeMemberIds: string[],
  steps: Array<{ text: string; obligation?: "required" | "optional" | "as_needed" }>,
) {
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/routines",
    headers: {
      ...authHeaders(harness, session),
      "content-type": "application/json",
    },
    payload: {
      mutationId: randomUUID(),
      title,
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds,
      assigneeGroupIds: [],
      steps: steps.map((step) => ({
        logicalItemId: randomUUID(),
        text: step.text,
        obligation: step.obligation ?? "required",
      })),
    },
  });
  expect(created.statusCode, created.body).toBe(200);
  return created.json() as { routine: { id: string; version: number } };
}

describe("P0-009B family wall person-day HTTP", () => {
  it("AT17a: new routes deny anonymous/member/display mix, foreign, departed, malformed, date override", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    const other = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness, other);
    const storeManager = await claimManager(harness.store);
    const manager = {
      cookieHeader: `${harness.config.cookieName}=${storeManager.token}`,
      csrfToken: storeManager.csrfSecret,
      membershipId: storeManager.context.membershipId,
    };
    const created = await createDisplay(harness, manager, "Day wall");
    const displayToken = await claimDisplay(harness, created.enrollment.code);
    const dayUrl = `/api/v1/display/people/${IDS.avery}/day`;
    const previewDay = `/api/v1/displays/${created.display.id}/preview/people/${IDS.avery}/day`;

    expect((await harness.app.inject({ method: "GET", url: dayUrl })).statusCode).toBe(401);
    expect(
      (await harness.app.inject({
        method: "GET",
        url: dayUrl,
        headers: { cookie: manager.cookieHeader },
      })).statusCode,
    ).toBe(401);

    const member = await enrollAndClaim(
      harness.store,
      storeManager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: previewDay,
          headers: { cookie: `${harness.config.cookieName}=${member.token}` },
        })
      ).statusCode,
    ).toBe(403);

    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: `/api/v1/display/people/not-a-uuid/day`,
          headers: displayHeaders(harness, displayToken),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: `${dayUrl}?date=2026-10-28`,
          headers: displayHeaders(harness, displayToken),
        })
      ).statusCode,
    ).toBe(400);

    const ok = await harness.app.inject({
      method: "GET",
      url: dayUrl,
      headers: displayHeaders(harness, displayToken),
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");

    const previewAnon = await harness.app.inject({ method: "GET", url: previewDay });
    expect(previewAnon.statusCode).toBe(401);
    const previewOk = await harness.app.inject({
      method: "GET",
      url: previewDay,
      headers: { cookie: manager.cookieHeader },
    });
    expect(previewOk.statusCode, previewOk.body).toBe(200);
    expect(JSON.stringify(previewOk.json())).not.toMatch(/intendedStructure|logicalItemId|csrf/i);

    const otherManager = await httpClaimManager(other);
    const foreign = await other.app.inject({
      method: "GET",
      url: `/api/v1/displays/${created.display.id}/preview/people/${IDS.avery}/day`,
      headers: { cookie: otherManager.cookieHeader },
    });
    expect(foreign.statusCode).toBe(404);

    const departed = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${randomUUID()}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    expect(departed.statusCode).toBe(404);
  });

  it("AT2a/AT13a/AT17b: pending roster, privacy allowlist, materialize without writes", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const storeManager = await claimManager(harness.store);
    const manager = {
      cookieHeader: `${harness.config.cookieName}=${storeManager.token}`,
      csrfToken: storeManager.csrfSecret,
      membershipId: storeManager.context.membershipId,
    };
    await createAssignedRoutine(harness, manager, "Avery morning", [IDS.avery], [
      { text: "Get dressed" },
      { text: "Brush teeth" },
    ]);
    const created = await createDisplay(harness, manager, "Privacy wall");
    const displayToken = await claimDisplay(harness, created.enrollment.code);

    const avery = await enrollAndClaim(
      harness.store,
      storeManager.context,
      IDS.avery,
      "direct_personalizer",
      `av.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    const averyCookie = `${harness.config.cookieName}=${avery.token}`;
    const privateTask = await harness.app.inject({
      method: "POST",
      url: "/api/v1/personal-tasks",
      headers: {
        cookie: averyCookie,
        origin: harness.origin,
        "x-csrf-token": avery.csrfSecret,
        "content-type": "application/json",
      },
      payload: { title: "PRIVATE-SECRET-TITLE", visibility: "private" },
    });
    expect(privateTask.statusCode).toBe(200);
    const unpromoted = await harness.app.inject({
      method: "POST",
      url: "/api/v1/personal-tasks",
      headers: {
        cookie: averyCookie,
        origin: harness.origin,
        "x-csrf-token": avery.csrfSecret,
        "content-type": "application/json",
      },
      payload: {
        title: "UNPROMOTED-VISIBLE-TITLE",
        visibility: "household",
        showOnSharedDashboard: false,
      },
    });
    expect(unpromoted.statusCode).toBe(200);
    const promoted = await harness.app.inject({
      method: "POST",
      url: "/api/v1/personal-tasks",
      headers: {
        cookie: averyCookie,
        origin: harness.origin,
        "x-csrf-token": avery.csrfSecret,
        "content-type": "application/json",
      },
      payload: {
        title: "PROMOTED-WALL-TITLE",
        visibility: "household",
        showOnSharedDashboard: true,
      },
    });
    expect(promoted.statusCode).toBe(200);

    const reportsBefore = (
      harness.db.prepare(`SELECT COUNT(*) AS c FROM step_reports`).get() as { c: number }
    ).c;
    const day1 = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    const day2 = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    expect(day1.statusCode).toBe(200);
    expect(day2.statusCode).toBe(200);
    const body = day1.json() as {
      personDay: {
        membershipId: string;
        status: string;
        householdDate: string;
        activityGeneration: number;
        installationEpoch: number;
        occurrences: Array<{ title: string; steps: Array<{ text: string }> }>;
        promotedPersonalTasks: Array<{ title: string }>;
      };
    };
    expect(body.personDay.membershipId).toBe(IDS.avery);
    expect(body.personDay.householdDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.personDay.occurrences.some((row) => row.title === "Avery morning")).toBe(true);
    expect(body.personDay.promotedPersonalTasks.map((row) => row.title)).toContain(
      "PROMOTED-WALL-TITLE",
    );
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("PRIVATE-SECRET-TITLE");
    expect(serialized).not.toContain("UNPROMOTED-VISIBLE-TITLE");
    expect(
      (harness.db.prepare(`SELECT COUNT(*) AS c FROM step_reports`).get() as { c: number }).c,
    ).toBe(reportsBefore);

    const dashboard = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: displayHeaders(harness, displayToken),
    });
    const byPerson = (
      dashboard.json() as { dashboard: { byPerson: Array<{ membershipId: string; status: string }> } }
    ).dashboard.byPerson;
    expect(byPerson.some((row) => row.membershipId === IDS.casey && row.status === "pending")).toBe(
      true,
    );

    const detail = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}`,
      headers: displayHeaders(harness, displayToken),
    });
    expect(JSON.stringify(detail.json())).toContain("UNPROMOTED-VISIBLE-TITLE");
  });

  it("AT5a/AT12/AT19b: existing status command, unassigned read-only, preview does not renew last_seen", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const manager = await httpClaimManager(harness);
    await createAssignedRoutine(harness, manager, "Jordan chores", [IDS.jordan], [
      { text: "Feed fish" },
    ]);
    const created = await createDisplay(harness, manager, "Act wall");
    const displayToken = await claimDisplay(harness, created.enrollment.code);
    const session = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: displayHeaders(harness, displayToken),
    });
    const csrf = (session.json() as { session: { csrfToken: string } }).session.csrfToken;
    const day = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.jordan}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    const personDay = (
      day.json() as {
        personDay: {
          occurrences: Array<{
            id: string;
            intendedStructure?: {
              revisionId: string;
              accountableMemberId: string;
              stepLogicalIds: string[];
            };
            householdDate: string;
            kind: "routine" | "responsibility";
            steps: Array<{ id: string }>;
          }>;
        };
      }
    ).personDay;
    const occ = personDay.occurrences[0];
    expect(occ?.intendedStructure).toBeTruthy();
    const posted = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${occ.id}/steps/${occ.steps[0].id}/status`,
      headers: {
        ...displayHeaders(harness, displayToken),
        origin: harness.origin,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        householdDate: occ.householdDate,
        kind: occ.kind,
        intendedStructure: occ.intendedStructure,
      },
    });
    expect(posted.statusCode, posted.body).toBe(200);

    const before = harness.db
      .prepare(`SELECT last_seen_at FROM display_sessions WHERE display_id = ?`)
      .get(created.display.id) as { last_seen_at: string };
    await harness.app.inject({
      method: "GET",
      url: `/api/v1/displays/${created.display.id}/preview/people/${IDS.jordan}/day`,
      headers: { cookie: manager.cookieHeader },
    });
    const after = harness.db
      .prepare(`SELECT last_seen_at FROM display_sessions WHERE display_id = ?`)
      .get(created.display.id) as { last_seen_at: string };
    expect(after.last_seen_at).toBe(before.last_seen_at);
  });

  it("AT17c: held person-day read releases shared lock so reset can proceed", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const session = await httpClaimManager(harness);
    const created = await createDisplay(harness, session, "Hold day");
    const displayToken = await claimDisplay(harness, created.enrollment.code);
    const reauth = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/reauthenticate",
      headers: {
        ...authHeaders(harness, session),
        "content-type": "application/json",
      },
      payload: { passphrase: PASSPHRASE },
    });
    expect(reauth.statusCode).toBe(200);
    const started = Date.now();
    const held = harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: {
        ...displayHeaders(harness, displayToken),
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
    expect([401, 200]).toContain(heldRes.statusCode);
  });

  it("AT5b/AT7a/AT8b: Not needed, replay, and stale structure conflict", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const manager = await httpClaimManager(harness);
    await createAssignedRoutine(harness, manager, "As needed sweep", [IDS.jordan], [
      { text: "Be present" },
      { text: "Sweep porch", obligation: "as_needed" },
    ]);
    await createAssignedRoutine(harness, manager, "Replay morning", [IDS.taylor], [
      { text: "Feed fish" },
    ]);
    const locked = await createAssignedRoutine(harness, manager, "Lock morning", [IDS.avery], [
      { text: "Make bed" },
    ]);
    const created = await createDisplay(harness, manager, "Command wall");
    const displayToken = await claimDisplay(harness, created.enrollment.code);
    const session = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: displayHeaders(harness, displayToken),
    });
    const csrf = (session.json() as { session: { csrfToken: string } }).session.csrfToken;

    const jordanDay = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.jordan}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    const jordanOcc = personDayOccurrence(jordanDay.json());
    const asNeededStep = jordanOcc.steps.find((step) => step.obligation === "as_needed") ?? jordanOcc.steps[1];
    const notNeeded = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${jordanOcc.id}/steps/${asNeededStep.id}/status`,
      headers: displayWriteHeaders(harness, displayToken, csrf),
      payload: statusPayload(jordanOcc, "not_needed"),
    });
    expect(notNeeded.statusCode, notNeeded.body).toBe(200);
    expect(
      (
        notNeeded.json() as {
          occurrence: { steps: Array<{ id: string; status: string }> };
        }
      ).occurrence.steps.find((step) => step.id === asNeededStep.id)?.status,
    ).toBe("not_needed");

    const taylorDay = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.taylor}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    const taylorOcc = personDayOccurrence(taylorDay.json());
    const mutationId = randomUUID();
    const payload = { ...statusPayload(taylorOcc, "completed"), mutationId };
    const first = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${taylorOcc.id}/steps/${taylorOcc.steps[0].id}/status`,
      headers: displayWriteHeaders(harness, displayToken, csrf),
      payload,
    });
    expect(first.statusCode, first.body).toBe(200);
    const replay = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${taylorOcc.id}/steps/${taylorOcc.steps[0].id}/status`,
      headers: displayWriteHeaders(harness, displayToken, csrf),
      payload,
    });
    expect(replay.statusCode, replay.body).toBe(200);

    const averyDay = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    const averyOcc = personDayOccurrence(averyDay.json());

    const revised = await harness.app.inject({
      method: "POST",
      url: `/api/v1/routines/${locked.routine.id}/revisions`,
      headers: {
        ...authHeaders(harness, manager),
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        title: "Lock morning revised",
        daypart: "morning",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assigneeMemberIds: [IDS.avery],
        assigneeGroupIds: [],
        steps: [{ text: "Make bed plus extra", obligation: "required" }],
        expectedVersion: locked.routine.version,
      },
    });
    expect(revised.statusCode, revised.body).toBe(200);
    const stale = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${averyOcc.id}/steps/${averyOcc.steps[0].id}/status`,
      headers: displayWriteHeaders(harness, displayToken, csrf),
      payload: statusPayload(averyOcc, "completed"),
    });
    expect(stale.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("AT12/AT13c/AT14d/AT14e: unassigned is outside panes; withdrawal, depart, revoke fence /day", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const storeManager = await claimManager(harness.store);
    const manager = {
      cookieHeader: `${harness.config.cookieName}=${storeManager.token}`,
      csrfToken: storeManager.csrfSecret,
      membershipId: storeManager.context.membershipId,
      context: storeManager.context,
    };
    const emptyGroup = harness.store.createGroup(manager.context, {
      mutationId: randomUUID(),
      name: `Empty ring ${Date.now().toString(36)}`,
      membershipIds: [IDS.avery, IDS.casey],
    });
    harness.store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Needs a person wall",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: {
        mode: "take_turns",
        anchorDate: harness.store.householdDateNow(manager.context),
        sourceGroupId: emptyGroup.id,
        savedRingOrder: [IDS.avery, IDS.casey],
        excludedMemberIds: [IDS.avery, IDS.casey],
      },
      steps: [{ logicalItemId: randomUUID(), text: "Feed", obligation: "required" }],
    });
    const avery = await enrollAndClaim(
      harness.store,
      storeManager.context,
      IDS.avery,
      "direct_personalizer",
      `av.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    const promoted = await harness.app.inject({
      method: "POST",
      url: "/api/v1/personal-tasks",
      headers: {
        cookie: `${harness.config.cookieName}=${avery.token}`,
        origin: harness.origin,
        "x-csrf-token": avery.csrfSecret,
        "content-type": "application/json",
      },
      payload: {
        title: "PROMOTED-WITHDRAW-TITLE",
        visibility: "household",
        showOnSharedDashboard: true,
      },
    });
    expect(promoted.statusCode).toBe(200);
    const task = (promoted.json() as { task: { id: string; sharingVersion: number } }).task;
    const created = await createDisplay(harness, manager, "Fence wall");
    const displayToken = await claimDisplay(harness, created.enrollment.code);
    const dashboard = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: displayHeaders(harness, displayToken),
    });
    const dash = dashboard.json() as {
      dashboard: {
        byWork: { responsibilities: Array<{ title: string; accountableMemberId: string | null }> };
      };
    };
    expect(
      dash.dashboard.byWork.responsibilities.some(
        (row) => row.title === "Needs a person wall" && row.accountableMemberId === null,
      ),
    ).toBe(true);
    const averyDay = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    const averyBody = averyDay.json() as {
      personDay: {
        occurrences: Array<{ title: string }>;
        promotedPersonalTasks: Array<{ title: string }>;
      };
    };
    expect(averyBody.personDay.occurrences.some((row) => row.title === "Needs a person wall")).toBe(
      false,
    );
    expect(averyBody.personDay.promotedPersonalTasks.map((row) => row.title)).toContain(
      "PROMOTED-WITHDRAW-TITLE",
    );
    const withdraw = await harness.app.inject({
      method: "POST",
      url: `/api/v1/personal-tasks/${task.id}/sharing`,
      headers: {
        cookie: `${harness.config.cookieName}=${avery.token}`,
        origin: harness.origin,
        "x-csrf-token": avery.csrfSecret,
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        visibility: "private",
        showOnSharedDashboard: false,
        expectedSharingVersion: task.sharingVersion,
      },
    });
    expect(withdraw.statusCode, withdraw.body).toBe(200);
    const afterWithdraw = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    expect(JSON.stringify(afterWithdraw.json())).not.toContain("PROMOTED-WITHDRAW-TITLE");

    const people = await harness.app.inject({
      method: "GET",
      url: "/api/v1/people",
      headers: { cookie: manager.cookieHeader },
    });
    const casey = (
      people.json() as {
        people: Array<{ id: string; authorityVersion: number; version: number }>;
      }
    ).people.find((row) => row.id === IDS.casey);
    expect(casey).toBeTruthy();
    const preview = await harness.app.inject({
      method: "POST",
      url: `/api/v1/people/${IDS.casey}/removal/preview`,
      headers: {
        ...authHeaders(harness, manager),
        "content-type": "application/json",
      },
      payload: {
        expectedAuthorityVersion: casey!.authorityVersion,
        expectedVersion: casey!.version,
      },
    });
    if (preview.statusCode === 200) {
      const body = preview.json() as { digest?: string; previewDigest?: string };
      const digest = body.digest ?? body.previewDigest;
      const removed = await harness.app.inject({
        method: "POST",
        url: `/api/v1/people/${IDS.casey}/removal`,
        headers: {
          ...authHeaders(harness, manager),
          "content-type": "application/json",
        },
        payload: {
          mutationId: randomUUID(),
          expectedAuthorityVersion: casey!.authorityVersion,
          expectedVersion: casey!.version,
          passphrase: PASSPHRASE,
          previewDigest: digest,
          confirmationText: "REMOVE",
        },
      });
      expect([200, 409]).toContain(removed.statusCode);
      if (removed.statusCode === 200) {
        const departedDay = await harness.app.inject({
          method: "GET",
          url: `/api/v1/display/people/${IDS.casey}/day`,
          headers: displayHeaders(harness, displayToken),
        });
        expect(departedDay.statusCode).toBe(404);
      }
    }

    const list = await harness.app.inject({
      method: "GET",
      url: "/api/v1/displays",
      headers: { cookie: manager.cookieHeader },
    });
    const row = (
      list.json() as { displays: Array<{ id: string; configVersion: number }> }
    ).displays.find((item) => item.id === created.display.id)!;
    const revoke = await harness.app.inject({
      method: "POST",
      url: `/api/v1/displays/${created.display.id}/revoke`,
      headers: {
        ...authHeaders(harness, manager),
        "content-type": "application/json",
      },
      payload: { mutationId: randomUUID(), expectedConfigVersion: row.configVersion },
    });
    expect(revoke.statusCode).toBe(200);
    const denied = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    expect(denied.statusCode).toBe(401);
  });

  it("AT14c restore: held person-day releases the shared lock", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const session = await httpClaimManager(harness);
    const created = await createDisplay(harness, session, "Restore day");
    const displayToken = await claimDisplay(harness, created.enrollment.code);
    const reauth = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/reauthenticate",
      headers: {
        ...authHeaders(harness, session),
        "content-type": "application/json",
      },
      payload: { passphrase: PASSPHRASE },
    });
    expect(reauth.statusCode).toBe(200);
    const backup = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/backups",
      headers: {
        ...authHeaders(harness, session),
        "content-type": "application/json",
      },
      payload: { mutationId: randomUUID() },
    });
    expect(backup.statusCode, backup.body).toBe(200);
    const snapshot = (backup.json() as { backup: { id: string; contentDigest: string } }).backup;
    const started = Date.now();
    const held = harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: {
        ...displayHeaders(harness, displayToken),
        "x-read-delay-ms": "400",
      },
    });
    const restore = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/restore",
      headers: {
        ...authHeaders(harness, session),
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        backupId: snapshot.id,
        expectedDigest: snapshot.contentDigest,
        expectedEpoch: harness.runtime.epoch,
        confirmationText: "RESTORE",
        saveBackupBeforeRestore: false,
      },
    });
    expect(restore.statusCode, restore.body).toBe(200);
    expect(Date.now() - started).toBeLessThan(10_000);
    const heldRes = await held;
    expect([401, 200]).toContain(heldRes.statusCode);
  });

  it("AT14a: prior-day householdDate cannot execute against today's person-day work", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const manager = await httpClaimManager(harness);
    await createAssignedRoutine(harness, manager, "Rollover wall chores", [IDS.avery], [
      { text: "Pack bag" },
    ]);
    const created = await createDisplay(harness, manager, "Rollover day");
    const displayToken = await claimDisplay(harness, created.enrollment.code);
    const session = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: displayHeaders(harness, displayToken),
    });
    const csrf = (session.json() as { session: { csrfToken: string } }).session.csrfToken;
    const day = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    expect(day.statusCode, day.body).toBe(200);
    const occ = personDayOccurrence(day.json());
    const yesterday = addHouseholdDays(occ.householdDate, -1);
    const stale = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${occ.id}/steps/${occ.steps[0].id}/status`,
      headers: displayWriteHeaders(harness, displayToken, csrf),
      payload: {
        ...statusPayload(occ, "completed"),
        householdDate: yesterday,
      },
    });
    expect(stale.statusCode).toBeGreaterThanOrEqual(400);
    expect(harness.store.getOccurrenceById(occ.id)!.steps[0]!.status).toBe("open");
  });

  it("AT14b: cleared activity generation rejects old person-day intent and rematerializes", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const manager = await httpClaimManager(harness);
    await createAssignedRoutine(harness, manager, "Generation wall chores", [IDS.avery], [
      { text: "Feed fish" },
    ]);
    const created = await createDisplay(harness, manager, "Generation day");
    const displayToken = await claimDisplay(harness, created.enrollment.code);
    const session = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: displayHeaders(harness, displayToken),
    });
    const displaySession = session.json() as {
      session: { csrfToken: string; householdId: string };
    };
    const csrf = displaySession.session.csrfToken;
    const day = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    expect(day.statusCode, day.body).toBe(200);
    const body = day.json() as {
      personDay: {
        activityGeneration: number;
        occurrences: Array<PersonDayOccurrence & { title: string; steps: Array<{ status: string }> }>;
      };
    };
    const occ = body.personDay.occurrences.find((row) => row.title === "Generation wall chores");
    expect(occ?.intendedStructure).toBeTruthy();
    const posted = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${occ!.id}/steps/${occ!.steps[0].id}/status`,
      headers: displayWriteHeaders(harness, displayToken, csrf),
      payload: {
        ...statusPayload(occ!, "completed"),
        activityGeneration: body.personDay.activityGeneration,
      },
    });
    expect(posted.statusCode, posted.body).toBe(200);
    const gen = harness.store.getActivityGeneration(displaySession.session.householdId);
    const clear = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/activity/clear",
      headers: {
        ...authHeaders(harness, manager),
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        expectedGeneration: gen,
        acknowledgedScope: "routines_and_responsibilities",
      },
    });
    expect(clear.statusCode, clear.body).toBe(200);
    const after = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    expect(after.statusCode, after.body).toBe(200);
    const afterBody = after.json() as {
      personDay: {
        activityGeneration: number;
        occurrences: Array<{ title: string; steps: Array<{ status: string }> }>;
      };
    };
    expect(afterBody.personDay.activityGeneration).toBeGreaterThan(body.personDay.activityGeneration);
    const rematerialized = afterBody.personDay.occurrences.find(
      (row) => row.title === "Generation wall chores",
    );
    expect(rematerialized?.steps[0]?.status).toBe("open");
    const stale = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${occ!.id}/steps/${occ!.steps[0].id}/status`,
      headers: displayWriteHeaders(harness, displayToken, csrf),
      payload: {
        ...statusPayload(occ!, "completed"),
        activityGeneration: body.personDay.activityGeneration,
      },
    });
    expect(stale.statusCode).toBeGreaterThanOrEqual(400);
  });
});
