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
  daypart = "morning",
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
      daypart,
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
  it.each(["reset", "restore"] as const)("AT14c/AT17c: held authorized day and queued real status are fenced across %s", async (operation) => {
    let enterRead = () => undefined as void;
    let enterWrite = () => undefined as void;
    let releaseRead = () => undefined as void;
    let releaseWrite = () => undefined as void;
    const readEntered = new Promise<void>((resolve) => { enterRead = resolve; });
    const writeEntered = new Promise<void>((resolve) => { enterWrite = resolve; });
    const readHold = new Promise<void>((resolve) => { releaseRead = resolve; });
    const writeHold = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const harness = await createHttpHarness({ AUTO_SEED: "1" }, {
      testHooks: {
        afterDisplayDayReadRelease: async () => { enterRead(); await readHold; },
        beforeDisplayStatusShared: async () => { enterWrite(); await writeHold; },
      },
    });
    harnesses.push(harness);
    const manager = await httpClaimManager(harness);
    await createAssignedRoutine(harness, manager, "Old epoch action", [IDS.avery], [{ text: "Old epoch step" }]);
    const display = await createDisplay(harness, manager, "Lifecycle race");
    const token = await claimDisplay(harness, display.enrollment.code);
    const session = await harness.app.inject({ method: "GET", url: "/api/v1/display/session", headers: displayHeaders(harness, token) });
    const csrf = (session.json() as { session: { csrfToken: string } }).session.csrfToken;
    const dayUrl = `/api/v1/display/people/${IDS.avery}/day`;
    const day = await harness.app.inject({ method: "GET", url: dayUrl, headers: displayHeaders(harness, token) });
    expect(day.statusCode).toBe(200);
    const occurrence = personDayOccurrence(day.json());
    const step = occurrence.steps[0];
    expect(step).toBeTruthy();
    const reauth = await harness.app.inject({ method: "POST", url: "/api/v1/auth/reauthenticate", headers: { ...authHeaders(harness, manager), "content-type": "application/json" }, payload: { passphrase: PASSPHRASE } });
    expect(reauth.statusCode).toBe(200);
    let backup: { id: string; contentDigest: string } | undefined;
    if (operation === "restore") {
      const response = await harness.app.inject({ method: "POST", url: "/api/v1/household/backups", headers: { ...authHeaders(harness, manager), "content-type": "application/json" }, payload: { mutationId: randomUUID() } });
      expect(response.statusCode, response.body).toBe(200);
      backup = (response.json() as { backup: { id: string; contentDigest: string } }).backup;
    }
    const oldEpoch = harness.runtime.epoch;
    const heldRead = harness.app.inject({ method: "GET", url: dayUrl, headers: { ...displayHeaders(harness, token), "x-test-hold": "day" } });
    const heldWrite = harness.app.inject({ method: "POST", url: `/api/v1/display/occurrences/${occurrence.id}/steps/${step!.id}/status`, headers: { ...displayWriteHeaders(harness, token, csrf), "x-test-hold": "status" }, payload: statusPayload(occurrence, "completed") });
    await Promise.all([readEntered, writeEntered]);
    const replacement = await harness.app.inject({
      method: "POST", url: `/api/v1/household/${operation}`,
      headers: { ...authHeaders(harness, manager), "content-type": "application/json" },
      payload: operation === "reset"
        ? { mutationId: randomUUID(), confirmationText: "RESET", expectedEpoch: oldEpoch, saveBackupBeforeReset: false }
        : { mutationId: randomUUID(), confirmationText: "RESTORE", expectedEpoch: oldEpoch, backupId: backup!.id, expectedDigest: backup!.contentDigest, saveBackupBeforeRestore: false },
    });
    expect(replacement.statusCode, replacement.body).toBe(200);
    expect(harness.runtime.epoch).toBe(oldEpoch + 1);
    const before = {
      reports: (harness.runtime.db.prepare("SELECT COUNT(*) AS c FROM step_reports").get() as { c: number }).c,
      receipts: (harness.runtime.db.prepare("SELECT COUNT(*) AS c FROM display_command_receipts").get() as { c: number }).c,
      mutations: (harness.runtime.db.prepare("SELECT COUNT(*) AS c FROM mutation_receipts").get() as { c: number }).c,
    };
    releaseRead();
    releaseWrite();
    const [readResult, writeResult] = await Promise.all([heldRead, heldWrite]);
    expect(readResult.statusCode).toBe(401);
    expect(readResult.json()).not.toHaveProperty("personDay");
    expect(writeResult.statusCode).toBe(401);
    expect((harness.runtime.db.prepare("SELECT COUNT(*) AS c FROM step_reports").get() as { c: number }).c).toBe(before.reports);
    expect((harness.runtime.db.prepare("SELECT COUNT(*) AS c FROM display_command_receipts").get() as { c: number }).c).toBe(before.receipts);
    expect((harness.runtime.db.prepare("SELECT COUNT(*) AS c FROM mutation_receipts").get() as { c: number }).c).toBe(before.mutations);
  });

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
    const foreignPerson = await other.app.inject({
      method: "POST", url: "/api/v1/people",
      headers: { ...authHeaders(other, otherManager), "content-type": "application/json" },
      payload: { mutationId: randomUUID(), displayName: "Foreign person", classification: "child" },
    });
    expect(foreignPerson.statusCode, foreignPerson.body).toBe(200);
    const foreignId = (foreignPerson.json() as { person: { id: string } }).person.id;
    const foreignWallPerson = await harness.app.inject({ method: "GET", url: `/api/v1/display/people/${foreignId}/day`, headers: displayHeaders(harness, displayToken) });
    const foreignPreviewPerson = await harness.app.inject({ method: "GET", url: `/api/v1/displays/${created.display.id}/preview/people/${foreignId}/day`, headers: { cookie: manager.cookieHeader } });
    expect(foreignWallPerson.statusCode).toBe(404);
    expect(foreignPreviewPerson.statusCode).toBe(404);

    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: `${previewDay}?date=2026-10-28`,
          headers: { cookie: manager.cookieHeader },
        })
      ).statusCode,
    ).toBe(400);

    const extraPerson = await harness.app.inject({
      method: "POST",
      url: "/api/v1/people",
      headers: {
        ...authHeaders(harness, manager),
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        displayName: `Pat ${Date.now().toString(36)}`,
        classification: "child",
      },
    });
    expect(extraPerson.statusCode, extraPerson.body).toBe(200);
    const pat = (
      extraPerson.json() as {
        person: { id: string; authorityVersion: number; version: number };
      }
    ).person;
    const previewRemoval = await harness.app.inject({
      method: "POST",
      url: `/api/v1/people/${pat.id}/removal/preview`,
      headers: {
        ...authHeaders(harness, manager),
        "content-type": "application/json",
      },
      payload: {
        expectedAuthorityVersion: pat.authorityVersion,
        expectedVersion: pat.version,
      },
    });
    expect(previewRemoval.statusCode, previewRemoval.body).toBe(200);
    const digest = (previewRemoval.json() as { digest?: string; previewDigest?: string }).digest
      ?? (previewRemoval.json() as { digest?: string; previewDigest?: string }).previewDigest;
    const removed = await harness.app.inject({
      method: "POST",
      url: `/api/v1/people/${pat.id}/removal`,
      headers: {
        ...authHeaders(harness, manager),
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        expectedAuthorityVersion: pat.authorityVersion,
        expectedVersion: pat.version,
        passphrase: PASSPHRASE,
        previewDigest: digest,
        confirmationText: "REMOVE",
      },
    });
    expect(removed.statusCode, removed.body).toBe(200);
    const departedDay = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${pat.id}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    expect(departedDay.statusCode).toBe(404);
    const departedPreview = await harness.app.inject({
      method: "GET",
      url: `/api/v1/displays/${created.display.id}/preview/people/${pat.id}/day`,
      headers: { cookie: manager.cookieHeader },
    });
    expect(departedPreview.statusCode).toBe(404);
    const displays = await harness.app.inject({ method: "GET", url: "/api/v1/displays", headers: { cookie: manager.cookieHeader } });
    const selected = (displays.json() as { displays: Array<{ id: string; configVersion: number }> }).displays.find((row) => row.id === created.display.id);
    expect(selected).toBeTruthy();
    const revoked = await harness.app.inject({ method: "POST", url: `/api/v1/displays/${created.display.id}/revoke`, headers: { ...authHeaders(harness, manager), "content-type": "application/json" }, payload: { mutationId: randomUUID(), expectedConfigVersion: selected!.configVersion } });
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect((await harness.app.inject({ method: "GET", url: dayUrl, headers: displayHeaders(harness, displayToken) })).statusCode).toBe(401);
    expect((await harness.app.inject({ method: "GET", url: previewDay, headers: { cookie: manager.cookieHeader } })).statusCode).toBe(404);
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

    const sideEffectsBefore = {
      reports: (harness.db.prepare(`SELECT COUNT(*) AS c FROM step_reports`).get() as { c: number }).c,
      receipts: (
        harness.db.prepare(`SELECT COUNT(*) AS c FROM display_command_receipts`).get() as { c: number }
      ).c,
      mutations: (harness.db.prepare(`SELECT COUNT(*) AS c FROM mutation_receipts`).get() as { c: number }).c,
      started: (
        harness.db
          .prepare(`SELECT id, started_at FROM occurrences WHERE started_at IS NOT NULL ORDER BY id`)
          .all() as Array<{ id: string; started_at: string }>
      ),
    };
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
    const previewUrl = `/api/v1/displays/${created.display.id}/preview/people/${IDS.avery}/day`;
    const preview1 = await harness.app.inject({ method: "GET", url: previewUrl, headers: { cookie: manager.cookieHeader } });
    const preview2 = await harness.app.inject({ method: "GET", url: previewUrl, headers: { cookie: manager.cookieHeader } });
    expect(preview1.statusCode).toBe(200);
    expect(preview2.statusCode).toBe(200);
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
    const privateId = (privateTask.json() as { task: { id: string } }).task.id;
    const unpromotedId = (unpromoted.json() as { task: { id: string } }).task.id;
    for (const response of [day1, day2, preview1, preview2]) {
      const serialized = response.body;
      expect(serialized).not.toContain("PRIVATE-SECRET-TITLE");
      expect(serialized).not.toContain("UNPROMOTED-VISIBLE-TITLE");
      expect(serialized).not.toContain(privateId);
      expect(serialized).not.toContain(unpromotedId);
      const personDay = (response.json() as { personDay: { householdDate: string; activityGeneration: number; installationEpoch: number; promotedPersonalTasks: Array<{ title: string }> } }).personDay;
      expect(personDay.promotedPersonalTasks.map((task) => task.title)).toEqual(["PROMOTED-WALL-TITLE"]);
      expect(personDay.householdDate).toBe(body.personDay.householdDate);
      expect(personDay.activityGeneration).toBe(body.personDay.activityGeneration);
      expect(personDay.installationEpoch).toBe(body.personDay.installationEpoch);
    }
    expect(
      (harness.db.prepare(`SELECT COUNT(*) AS c FROM step_reports`).get() as { c: number }).c,
    ).toBe(sideEffectsBefore.reports);
    expect(
      (harness.db.prepare(`SELECT COUNT(*) AS c FROM display_command_receipts`).get() as { c: number }).c,
    ).toBe(sideEffectsBefore.receipts);
    expect((harness.db.prepare(`SELECT COUNT(*) AS c FROM mutation_receipts`).get() as { c: number }).c).toBe(sideEffectsBefore.mutations);
    expect(
      harness.db
        .prepare(`SELECT id, started_at FROM occurrences WHERE started_at IS NOT NULL ORDER BY id`)
        .all(),
    ).toEqual(sideEffectsBefore.started);

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

  it("AT17b: both day reads preserve populated history and a take-turns assignment", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const claimed = await claimManager(harness.store);
    const manager = { cookieHeader: `${harness.config.cookieName}=${claimed.token}`, csrfToken: claimed.csrfSecret, membershipId: claimed.context.membershipId };
    const group = harness.store.createGroup(claimed.context, { mutationId: randomUUID(), name: "Rotation readers", membershipIds: [IDS.avery, IDS.jordan] });
    harness.store.createResponsibility(claimed.context, {
      mutationId: randomUUID(), title: "Rotating history", daypart: "morning", weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: { mode: "take_turns", anchorDate: harness.store.householdDateNow(claimed.context), sourceGroupId: group.id, savedRingOrder: [IDS.avery, IDS.jordan], excludedMemberIds: [] },
      steps: [{ logicalItemId: randomUUID(), text: "Rotation step", obligation: "required" }],
    });
    const display = await createDisplay(harness, manager, "Read-only rotation");
    const token = await claimDisplay(harness, display.enrollment.code);
    const session = await harness.app.inject({ method: "GET", url: "/api/v1/display/session", headers: displayHeaders(harness, token) });
    const csrf = (session.json() as { session: { csrfToken: string } }).session.csrfToken;
    const dayUrl = `/api/v1/display/people/${IDS.avery}/day`;
    const day = await harness.app.inject({ method: "GET", url: dayUrl, headers: displayHeaders(harness, token) });
    expect(day.statusCode, day.body).toBe(200);
    const occurrence = personDayOccurrence(day.json());
    const write = await harness.app.inject({ method: "POST", url: `/api/v1/display/occurrences/${occurrence.id}/steps/${occurrence.steps[0].id}/status`, headers: displayWriteHeaders(harness, token, csrf), payload: statusPayload(occurrence, "completed") });
    expect(write.statusCode, write.body).toBe(200);
    const date = harness.store.householdDateNow(claimed.context);
    const historyBefore = harness.store.historyForDate(claimed.context, date);
    expect(historyBefore.some((row) => row.id === occurrence.id)).toBe(true);
    const assignmentBefore = harness.db.prepare("SELECT revision_id, assignment_json FROM revision_responsibility_plans ORDER BY revision_id").all();
    const ownersBefore = harness.db.prepare("SELECT id, accountable_member_id, started_at FROM occurrences ORDER BY id").all();
    const reportsBefore = harness.db.prepare("SELECT * FROM step_reports ORDER BY id").all();
    const receiptsBefore = harness.db.prepare("SELECT * FROM mutation_receipts ORDER BY mutation_id").all();
    const previewUrl = `/api/v1/displays/${display.display.id}/preview/people/${IDS.avery}/day`;
    for (let i = 0; i < 2; i += 1) {
      expect((await harness.app.inject({ method: "GET", url: dayUrl, headers: displayHeaders(harness, token) })).statusCode).toBe(200);
      expect((await harness.app.inject({ method: "GET", url: previewUrl, headers: { cookie: manager.cookieHeader } })).statusCode).toBe(200);
    }
    expect(harness.store.historyForDate(claimed.context, date)).toEqual(historyBefore);
    expect(harness.db.prepare("SELECT revision_id, assignment_json FROM revision_responsibility_plans ORDER BY revision_id").all()).toEqual(assignmentBefore);
    expect(harness.db.prepare("SELECT id, accountable_member_id, started_at FROM occurrences ORDER BY id").all()).toEqual(ownersBefore);
    expect(harness.db.prepare("SELECT * FROM step_reports ORDER BY id").all()).toEqual(reportsBefore);
    expect(harness.db.prepare("SELECT * FROM mutation_receipts ORDER BY mutation_id").all()).toEqual(receiptsBefore);
  });

  it("AT3a: wall and preview preserve scheduled-addition source and step order", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const claimed = await claimManager(harness.store);
    const manager = { cookieHeader: `${harness.config.cookieName}=${claimed.token}`, csrfToken: claimed.csrfSecret, membershipId: claimed.context.membershipId };
    harness.store.createResponsibility(claimed.context, {
      mutationId: randomUUID(), title: "Composed cleaning", daypart: "morning", weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: { mode: "fixed", anchorDate: harness.store.householdDateNow(claimed.context), fixedMemberId: IDS.avery },
      steps: [{ logicalItemId: randomUUID(), text: "Base step", obligation: "required" }],
      scheduledAdditions: [{ name: "Deep clean", weekdays: [1, 2, 3, 4, 5, 6, 7], inheritAssignment: true, steps: [{ logicalItemId: randomUUID(), text: "Scheduled step", obligation: "required" }] }],
    });
    const display = await createDisplay(harness, manager, "Source cues");
    const token = await claimDisplay(harness, display.enrollment.code);
    const wall = await harness.app.inject({ method: "GET", url: `/api/v1/display/people/${IDS.avery}/day`, headers: displayHeaders(harness, token) });
    const preview = await harness.app.inject({ method: "GET", url: `/api/v1/displays/${display.display.id}/preview/people/${IDS.avery}/day`, headers: { cookie: manager.cookieHeader } });
    for (const response of [wall, preview]) {
      expect(response.statusCode, response.body).toBe(200);
      const occurrence = (response.json() as { personDay: { occurrences: Array<{ title: string; steps: Array<{ text: string; additionHeading?: string }> }> } }).personDay.occurrences.find((row) => row.title === "Composed cleaning");
      expect(occurrence?.steps.map((step) => step.text)).toEqual(["Base step", "Scheduled step"]);
      expect(occurrence?.steps[1]?.additionHeading).toBe("Deep clean");
    }
  });

  it("AT3b: filtered school work is distinguishable from no assigned work on both reads", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const claimed = await claimManager(harness.store);
    const manager = { cookieHeader: `${harness.config.cookieName}=${claimed.token}`, csrfToken: claimed.csrfSecret, membershipId: claimed.context.membershipId };
    const today = harness.store.householdDateNow(claimed.context);
    const date = new Date(`${today}T12:00:00Z`);
    const weekday = date.getUTCDay() || 7;
    const year = today.slice(0, 4);
    harness.store.saveSchoolCalendar(claimed.context, {
      mutationId: randomUUID(), expectedVersion: 0,
      years: [{ startDate: `${year}-01-01`, endDate: `${year}-12-31`, usualWeekdays: [1, 2, 3, 4, 5, 6, 7].filter((day) => day !== weekday), exceptions: [] }],
    });
    harness.store.createRoutine(claimed.context, {
      mutationId: randomUUID(), title: "School only", daypart: "morning", weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery], assigneeGroupIds: [],
      steps: [{ logicalItemId: randomUUID(), text: "Pack for school", obligation: "required", applicability: { kind: "school_days" } }],
    });
    const display = await createDisplay(harness, manager, "Filtered work");
    const token = await claimDisplay(harness, display.enrollment.code);
    for (const memberId of [IDS.avery, IDS.jordan]) {
      const wall = await harness.app.inject({ method: "GET", url: `/api/v1/display/people/${memberId}/day`, headers: displayHeaders(harness, token) });
      const preview = await harness.app.inject({ method: "GET", url: `/api/v1/displays/${display.display.id}/preview/people/${memberId}/day`, headers: { cookie: manager.cookieHeader } });
      for (const response of [wall, preview]) {
        expect(response.statusCode, response.body).toBe(200);
        const day = (response.json() as { personDay: { occurrences: unknown[]; filteredOmission: boolean } }).personDay;
        expect(day.occurrences).toHaveLength(0);
        expect(day.filteredOmission).toBe(memberId === IDS.avery);
      }
    }
  });

  it("AT8b/AT14e: pending old-owner status is not transferred when a person departs", async () => {
    let enteredResolve = () => undefined as void;
    const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
    let releaseResolve = () => undefined as void;
    const held = new Promise<void>((resolve) => { releaseResolve = resolve; });
    const harness = await createHttpHarness({ AUTO_SEED: "1" }, {
      testHooks: { beforeDisplayStatusShared: async () => { enteredResolve(); await held; } },
    });
    harnesses.push(harness);
    const claimed = await claimManager(harness.store);
    const manager = { cookieHeader: `${harness.config.cookieName}=${claimed.token}`, csrfToken: claimed.csrfSecret, membershipId: claimed.context.membershipId };
    const person = await harness.app.inject({ method: "POST", url: "/api/v1/people", headers: { ...authHeaders(harness, manager), "content-type": "application/json" }, payload: { mutationId: randomUUID(), displayName: "Departing owner", classification: "child" } });
    expect(person.statusCode, person.body).toBe(200);
    const createdPat = (person.json() as { person: { id: string; authorityVersion: number; version: number } }).person;
    await enrollAndClaim(harness.store, claimed.context, createdPat.id, "direct_personalizer", `depart.${Date.now().toString(36)}`, "Departing owner");
    const people = await harness.app.inject({ method: "GET", url: "/api/v1/people", headers: { cookie: manager.cookieHeader } });
    const pat = (people.json() as { people: Array<{ id: string; authorityVersion: number; version: number }> }).people.find((row) => row.id === createdPat.id)!;
    const group = harness.store.createGroup(claimed.context, { mutationId: randomUUID(), name: "Departure rotation", membershipIds: [pat.id, IDS.jordan] });
    harness.store.createResponsibility(claimed.context, {
      mutationId: randomUUID(), title: "Reassigned pending work", daypart: "morning", weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: { mode: "take_turns", anchorDate: harness.store.householdDateNow(claimed.context), sourceGroupId: group.id, savedRingOrder: [pat.id, IDS.jordan], excludedMemberIds: [] },
      steps: [{ logicalItemId: randomUUID(), text: "Old owner step", obligation: "required" }],
    });
    const display = await createDisplay(harness, manager, "Departure wall");
    const token = await claimDisplay(harness, display.enrollment.code);
    const session = await harness.app.inject({ method: "GET", url: "/api/v1/display/session", headers: displayHeaders(harness, token) });
    const csrf = (session.json() as { session: { csrfToken: string } }).session.csrfToken;
    const oldDay = await harness.app.inject({ method: "GET", url: `/api/v1/display/people/${pat.id}/day`, headers: displayHeaders(harness, token) });
    expect(oldDay.statusCode, oldDay.body).toBe(200);
    const occurrence = personDayOccurrence(oldDay.json());
    expect(occurrence.intendedStructure?.accountableMemberId).toBe(pat.id);
    const mutation = statusPayload(occurrence, "completed");
    const oldWrite = harness.app.inject({ method: "POST", url: `/api/v1/display/occurrences/${occurrence.id}/steps/${occurrence.steps[0].id}/status`, headers: { ...displayWriteHeaders(harness, token, csrf), "x-test-hold": "status" }, payload: mutation });
    await entered;
    const preview = await harness.app.inject({ method: "POST", url: `/api/v1/people/${pat.id}/removal/preview`, headers: { ...authHeaders(harness, manager), "content-type": "application/json" }, payload: { expectedAuthorityVersion: pat.authorityVersion, expectedVersion: pat.version } });
    expect(preview.statusCode, preview.body).toBe(200);
    const digest = (preview.json() as { digest?: string; previewDigest?: string }).digest ?? (preview.json() as { previewDigest?: string }).previewDigest;
    const removed = await harness.app.inject({ method: "POST", url: `/api/v1/people/${pat.id}/removal`, headers: { ...authHeaders(harness, manager), "content-type": "application/json" }, payload: { mutationId: randomUUID(), expectedAuthorityVersion: pat.authorityVersion, expectedVersion: pat.version, passphrase: PASSPHRASE, previewDigest: digest, confirmationText: "REMOVE" } });
    expect(removed.statusCode, removed.body).toBe(200);
    expect((await harness.app.inject({ method: "GET", url: `/api/v1/display/people/${pat.id}/day`, headers: displayHeaders(harness, token) })).statusCode).toBe(404);
    const newDay = await harness.app.inject({ method: "GET", url: `/api/v1/display/people/${IDS.jordan}/day`, headers: displayHeaders(harness, token) });
    expect(newDay.statusCode, newDay.body).toBe(200);
    const reassigned = (newDay.json() as { personDay: { occurrences: Array<PersonDayOccurrence & { title: string }> } }).personDay.occurrences.find((row) => row.title === "Reassigned pending work");
    expect(reassigned?.intendedStructure?.accountableMemberId).toBe(IDS.jordan);
    releaseResolve();
    const oldResult = await oldWrite;
    expect(oldResult.statusCode).toBeGreaterThanOrEqual(400);
    expect((harness.db.prepare("SELECT COUNT(*) AS c FROM step_reports WHERE mutation_id = ?").get(mutation.mutationId) as { c: number }).c).toBe(0);
    const newAfter = await harness.app.inject({ method: "GET", url: `/api/v1/display/people/${IDS.jordan}/day`, headers: displayHeaders(harness, token) });
    const after = (newAfter.json() as { personDay: { occurrences: Array<PersonDayOccurrence & { title: string; steps: Array<{ id: string; status: string }> }> } }).personDay.occurrences.find((row) => row.title === "Reassigned pending work");
    expect(after?.steps[0]?.status).toBe("open");
  });

  it("AT5a/AT12/AT19b: existing status command, unassigned read-only, preview does not renew last_seen", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const manager = await httpClaimManager(harness);
    await createAssignedRoutine(harness, manager, "Jordan chores", [IDS.jordan], [
      { text: "Feed fish" },
    ]);
    const today = await harness.app.inject({
      method: "GET",
      url: "/api/v1/today",
      headers: { cookie: manager.cookieHeader },
    });
    expect(today.statusCode, today.body).toBe(200);
    const householdDate = (today.json() as { householdDate: string }).householdDate;
    const responsibility = await harness.app.inject({
      method: "POST",
      url: "/api/v1/responsibilities",
      headers: {
        ...authHeaders(harness, manager),
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        title: "Jordan dishes",
        daypart: "evening",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "fixed",
          anchorDate: householdDate,
          fixedMemberId: IDS.jordan,
        },
        steps: [{ logicalItemId: randomUUID(), text: "Wash plates", obligation: "required" }],
      },
    });
    expect(responsibility.statusCode, responsibility.body).toBe(200);
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
    const occs = personDay.occurrences.filter((row) => row.intendedStructure);
    expect(occs.length).toBeGreaterThanOrEqual(2);
    for (const occ of occs) {
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
      const reopened = await harness.app.inject({
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
          status: "open",
          performedAt: new Date().toISOString(),
          householdDate: occ.householdDate,
          kind: occ.kind,
          intendedStructure: occ.intendedStructure,
        },
      });
      expect(reopened.statusCode, reopened.body).toBe(200);
    }
    expect(occs.some((row) => row.kind === "routine")).toBe(true);
    expect(occs.some((row) => row.kind === "responsibility")).toBe(true);

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

  it("AT3a: person-day startedAt survives reopen and stays recommended over earlier unstarted", async () => {
    const { projectFamilyPane, toFamilyPaneOccurrence } = await import(
      "../../src/domain/family-wall-projection.js"
    );
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    const manager = await httpClaimManager(harness);
    await createAssignedRoutine(harness, manager, "Earlier open", [IDS.avery], [
      { text: "Morning first" },
    ]);
    await createAssignedRoutine(
      harness,
      manager,
      "Later started",
      [IDS.avery],
      [{ text: "Later first" }, { text: "Later second" }],
      "after_school",
    );
    const created = await createDisplay(harness, manager, "Started wall");
    const displayToken = await claimDisplay(harness, created.enrollment.code);
    const session = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: displayHeaders(harness, displayToken),
    });
    const csrf = (session.json() as { session: { csrfToken: string } }).session.csrfToken;
    const dayBefore = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    const occurrences = (
      dayBefore.json() as {
        personDay: {
          occurrences: Array<{
            id: string;
            title: string;
            startedAt: string | null;
            state: string;
            completed: boolean;
            definitionId: string;
            daypart: string;
            intendedStructure?: {
              revisionId: string;
              accountableMemberId: string;
              stepLogicalIds: string[];
            };
            householdDate: string;
            kind: "routine" | "responsibility";
            steps: Array<{ id: string; text: string; status: string; obligation?: string }>;
          }>;
        };
      }
    ).personDay.occurrences;
    const later = occurrences.find((row) => row.title === "Later started");
    expect(later?.intendedStructure).toBeTruthy();
    const first = later!.steps.find((step) => step.text === "Later first");
    const post = async (status: "completed" | "open") =>
      harness.app.inject({
        method: "POST",
        url: `/api/v1/display/occurrences/${later!.id}/steps/${first!.id}/status`,
        headers: {
          ...displayHeaders(harness, displayToken),
          origin: harness.origin,
          "x-csrf-token": csrf,
          "content-type": "application/json",
        },
        payload: {
          mutationId: randomUUID(),
          status,
          performedAt: new Date().toISOString(),
          householdDate: later!.householdDate,
          kind: later!.kind,
          intendedStructure: later!.intendedStructure,
        },
      });
    expect((await post("completed")).statusCode).toBe(200);
    expect((await post("open")).statusCode).toBe(200);
    const dayAfter = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    const afterOcc = (
      dayAfter.json() as { personDay: { occurrences: typeof occurrences } }
    ).personDay.occurrences;
    const laterAfter = afterOcc.find((row) => row.title === "Later started");
    expect(laterAfter?.startedAt).toBeTruthy();
    expect(laterAfter?.state).toBe("In progress");
    expect(laterAfter?.steps.every((step) => step.status === "open")).toBe(true);
    const projection = projectFamilyPane(afterOcc.map(toFamilyPaneOccurrence));
    expect(projection.recommendedFocusId).toBe(laterAfter?.id);
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
    const sessionInfo = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: displayHeaders(harness, displayToken),
    });
    const csrf = (sessionInfo.json() as { session: { csrfToken: string } }).session.csrfToken;
    const held = harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: {
        ...displayHeaders(harness, displayToken),
        "x-read-delay-ms": "400",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
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
    expect(heldRes.json()).not.toHaveProperty("personDay");
    const delayedWrite = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${randomUUID()}/steps/${randomUUID()}/status`,
      headers: displayWriteHeaders(harness, displayToken, csrf),
      payload: {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        householdDate: "2026-10-28",
        kind: "routine",
        intendedStructure: {
          revisionId: randomUUID(),
          accountableMemberId: IDS.avery,
          stepLogicalIds: [randomUUID()],
        },
      },
    });
    expect(delayedWrite.statusCode).toBe(401);
  });

  it("AT5b/AT7a/AT8b: Not needed, replay, and stale structure conflict", async () => {
    let enterOld = () => undefined as void;
    let releaseOld = () => undefined as void;
    const oldEntered = new Promise<void>((resolve) => { enterOld = resolve; });
    const oldHeld = new Promise<void>((resolve) => { releaseOld = resolve; });
    const harness = await createHttpHarness({ AUTO_SEED: "1" }, {
      testHooks: { beforeDisplayStatusShared: async () => { enterOld(); await oldHeld; } },
    });
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
    expect((harness.db.prepare("SELECT COUNT(*) AS c FROM mutation_receipts WHERE mutation_id = ?").get(mutationId) as { c: number }).c).toBe(1);
    expect((harness.db.prepare("SELECT COUNT(*) AS c FROM step_reports WHERE mutation_id = ?").get(mutationId) as { c: number }).c).toBe(1);
    expect((harness.db.prepare("SELECT COUNT(*) AS c FROM step_reports WHERE occurrence_id = ?").get(jordanOcc.id) as { c: number }).c).toBe(1);

    const averyDay = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    const averyOcc = personDayOccurrence(averyDay.json());
    const oldPayload = statusPayload(averyOcc, "completed");
    const pendingOld = harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${averyOcc.id}/steps/${averyOcc.steps[0].id}/status`,
      headers: { ...displayWriteHeaders(harness, displayToken, csrf), "x-test-hold": "status" },
      payload: oldPayload,
    });
    await oldEntered;

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
    releaseOld();
    const stale = await pendingOld;
    expect(stale.statusCode).toBeGreaterThanOrEqual(400);
    expect((harness.db.prepare("SELECT COUNT(*) AS c FROM step_reports WHERE mutation_id = ?").get(oldPayload.mutationId) as { c: number }).c).toBe(0);
    const revisedDay = await harness.app.inject({ method: "GET", url: `/api/v1/display/people/${IDS.avery}/day`, headers: displayHeaders(harness, displayToken) });
    expect(revisedDay.statusCode, revisedDay.body).toBe(200);
    expect(revisedDay.body).toContain("Make bed plus extra");
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
    const displaySession = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: displayHeaders(harness, displayToken),
    });
    const csrf = (displaySession.json() as { session: { csrfToken: string } }).session.csrfToken;
    const averyFull = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    const assigned = (
      averyFull.json() as {
        personDay: {
          occurrences: Array<
            PersonDayOccurrence & {
              steps: Array<{ id: string; status?: string; obligation?: string }>;
            }
          >;
        };
      }
    ).personDay.occurrences;
    for (const occ of assigned) {
      if (!occ.intendedStructure) continue;
      for (const step of occ.steps) {
        if (step.status && step.status !== "open") continue;
        const posted = await harness.app.inject({
          method: "POST",
          url: `/api/v1/display/occurrences/${occ.id}/steps/${step.id}/status`,
          headers: displayWriteHeaders(harness, displayToken, csrf),
          payload: statusPayload(
            occ,
            step.obligation === "as_needed" ? "not_needed" : "completed",
          ),
        });
        expect(posted.statusCode, posted.body).toBe(200);
      }
    }
    const afterAssigned = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: displayHeaders(harness, displayToken),
    });
    const afterDash = afterAssigned.json() as {
      dashboard: {
        byWork: { responsibilities: Array<{ title: string; accountableMemberId: string | null }> };
      };
    };
    expect(
      afterDash.dashboard.byWork.responsibilities.some(
        (row) => row.title === "Needs a person wall" && row.accountableMemberId === null,
      ),
    ).toBe(true);
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

    const extraPerson = await harness.app.inject({
      method: "POST",
      url: "/api/v1/people",
      headers: {
        ...authHeaders(harness, manager),
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        displayName: `Pat ${Date.now().toString(36)}`,
        classification: "child",
      },
    });
    expect(extraPerson.statusCode, extraPerson.body).toBe(200);
    const pat = (
      extraPerson.json() as {
        person: { id: string; authorityVersion: number; version: number };
      }
    ).person;
    const preview = await harness.app.inject({
      method: "POST",
      url: `/api/v1/people/${pat.id}/removal/preview`,
      headers: {
        ...authHeaders(harness, manager),
        "content-type": "application/json",
      },
      payload: {
        expectedAuthorityVersion: pat.authorityVersion,
        expectedVersion: pat.version,
      },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    const body = preview.json() as { digest?: string; previewDigest?: string };
    const digest = body.digest ?? body.previewDigest;
    const removed = await harness.app.inject({
      method: "POST",
      url: `/api/v1/people/${pat.id}/removal`,
      headers: {
        ...authHeaders(harness, manager),
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        expectedAuthorityVersion: pat.authorityVersion,
        expectedVersion: pat.version,
        passphrase: PASSPHRASE,
        previewDigest: digest,
        confirmationText: "REMOVE",
      },
    });
    expect(removed.statusCode, removed.body).toBe(200);
    const departedDay = await harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${pat.id}/day`,
      headers: displayHeaders(harness, displayToken),
    });
    expect(departedDay.statusCode).toBe(404);
    const departedPreview = await harness.app.inject({
      method: "GET",
      url: `/api/v1/displays/${created.display.id}/preview/people/${pat.id}/day`,
      headers: { cookie: manager.cookieHeader },
    });
    expect(departedPreview.statusCode).toBe(404);

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
    const sessionInfo = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: displayHeaders(harness, displayToken),
    });
    const csrf = (sessionInfo.json() as { session: { csrfToken: string } }).session.csrfToken;
    const held = harness.app.inject({
      method: "GET",
      url: `/api/v1/display/people/${IDS.avery}/day`,
      headers: {
        ...displayHeaders(harness, displayToken),
        "x-read-delay-ms": "400",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
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
    expect(heldRes.statusCode).toBe(401);
    expect(heldRes.json()).not.toHaveProperty("personDay");
    const delayedWrite = await harness.app.inject({
      method: "POST",
      url: `/api/v1/display/occurrences/${randomUUID()}/steps/${randomUUID()}/status`,
      headers: displayWriteHeaders(harness, displayToken, csrf),
      payload: {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        householdDate: "2026-10-28",
        kind: "routine",
        intendedStructure: {
          revisionId: randomUUID(),
          accountableMemberId: IDS.avery,
          stepLogicalIds: [randomUUID()],
        },
      },
    });
    expect(delayedWrite.statusCode).toBe(401);
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
