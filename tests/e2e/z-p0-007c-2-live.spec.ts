import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  type Route,
} from "@playwright/test";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const CASEY_ID = "22222222-2222-4222-8222-222222222204";
const AVERY_LOGIN = "e2e.avery";

function requestOrigin(): string {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("Playwright project baseURL is required");
  return new URL(base).origin;
}

async function csrf(request: APIRequestContext): Promise<string> {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  return ((await session.json()) as { csrfToken: string }).csrfToken;
}

async function mutatingHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  return {
    "x-csrf-token": await csrf(request),
    Origin: requestOrigin(),
  };
}

async function ensureManagerSession(request: APIRequestContext) {
  const origin = requestOrigin();
  const boot = await request.post("/api/v1/test/bootstrap-claim");
  if (boot.ok()) {
    const { token } = (await boot.json()) as { token: string };
    const claim = await request.post("/api/v1/auth/claim", {
      headers: { Origin: origin },
      data: {
        claimToken: token,
        loginName: MANAGER_LOGIN,
        passphrase: PASSPHRASE,
        displayName: "Morgan Reed",
      },
    });
    expect(claim.ok(), await claim.text()).toBeTruthy();
    return;
  }
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: origin },
    data: { loginName: MANAGER_LOGIN, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function claimAvery(request: APIRequestContext) {
  await ensureManagerSession(request);
  const enroll = await request.post("/api/v1/enrollment/claims", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      membershipId: AVERY_ID,
      preset: "direct_personalizer",
    },
  });
  if (enroll.ok()) {
    const token = ((await enroll.json()) as { claim: { token: string } }).claim.token;
    await request.post("/api/v1/auth/logout", {
      headers: await mutatingHeaders(request),
    });
    const claim = await request.post("/api/v1/auth/claim", {
      headers: { Origin: requestOrigin() },
      data: {
        claimToken: token,
        loginName: AVERY_LOGIN,
        passphrase: PASSPHRASE,
        displayName: "Avery Reed",
      },
    });
    expect(claim.ok(), await claim.text()).toBeTruthy();
    return;
  }
  await request.post("/api/v1/auth/logout", {
    headers: await mutatingHeaders(request),
  });
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: requestOrigin() },
    data: { loginName: AVERY_LOGIN, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function enrollWall(
  managerRequest: APIRequestContext,
  wall: Page,
  label: string,
  init?: () => void,
): Promise<{ displayId: string; code: string }> {
  await ensureManagerSession(managerRequest);
  const create = await managerRequest.post("/api/v1/displays", {
    headers: await mutatingHeaders(managerRequest),
    data: { mutationId: crypto.randomUUID(), label },
  });
  expect(create.ok(), await create.text()).toBeTruthy();
  const body = (await create.json()) as {
    enrollment: { code: string };
    display: { id: string };
  };
  if (init) {
    await wall.addInitScript(init);
  }
  await wall.goto("/display");
  await expect(wall.getByTestId("display-setup")).toBeVisible();
  await wall.getByTestId("display-claim-code").fill(body.enrollment.code);
  await wall.getByRole("button", { name: "Connect display" }).click();
  await expect(wall.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
  return { displayId: body.display.id, code: body.enrollment.code };
}

function syntheticDashboard(
  titleMarker: string,
  opts?: { householdDate?: string; serverTime?: string },
) {
  const householdDate = opts?.householdDate ?? "2099-06-15";
  return {
    dashboard: {
      householdDate,
      timezone: "America/New_York",
      serverTime: opts?.serverTime ?? new Date().toISOString(),
      activityGeneration: 1,
      byPerson: [
        {
          membershipId: AVERY_ID,
          displayName: titleMarker,
          sortOrder: 0,
          status: "active",
          recurringState: "In progress",
          progress: { done: 0, notNeeded: 0, open: 1, optionalOpen: 0, total: 1 },
          progressLabel: "0/1 done",
          unfinished: [
            {
              occurrenceId: crypto.randomUUID(),
              title: titleMarker,
              kind: "responsibility",
            },
          ],
        },
      ],
      byWork: {
        responsibilities: [
          {
            id: crypto.randomUUID(),
            definitionId: crypto.randomUUID(),
            householdDate,
            daypart: "anytime",
            title: titleMarker,
            accountableMemberId: AVERY_ID,
            accountableMemberName: "Avery Reed",
            completed: false,
            state: "Not started",
            progress: { done: 0, notNeeded: 0, open: 1, optionalOpen: 0, total: 1 },
            progressLabel: "0/1 done",
            pending: false,
          },
        ],
        routines: [],
      },
    },
  };
}

test.describe("P0-007C-2 live convergence and recovery", () => {
  test("AT9: routine/responsibility/order/task converge; open detail refreshes", async ({
    page,
    browser,
  }) => {
    const wallCtx = await browser.newContext();
    const wall = await wallCtx.newPage();
    await enrollWall(page.request, wall, `Live ${Date.now().toString(36)}`);

    await ensureManagerSession(page.request);
    const session = await page.request.get("/api/v1/auth/session");
    const sessionBody = (await session.json()) as {
      householdDate: string;
      familyOrderVersion?: number;
    };
    const householdDate = sessionBody.householdDate;

    const routineTitle = `Live routine ${Date.now().toString(36)}`;
    const createRoutine = await page.request.post("/api/v1/routines", {
      headers: await mutatingHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        title: routineTitle,
        daypart: "morning",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assigneeMemberIds: [AVERY_ID],
        assigneeGroupIds: [],
        steps: [
          {
            logicalItemId: crypto.randomUUID(),
            text: "Routine step live",
            obligation: "required",
          },
        ],
      },
    });
    expect(createRoutine.ok(), await createRoutine.text()).toBeTruthy();

    const respTitle = `Live feed ${Date.now().toString(36)}`;
    const createWork = await page.request.post("/api/v1/responsibilities", {
      headers: await mutatingHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        title: respTitle,
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "fixed",
          anchorDate: householdDate,
          fixedMemberId: AVERY_ID,
        },
        steps: [
          {
            logicalItemId: crypto.randomUUID(),
            text: "Feed cats live",
            obligation: "required",
          },
        ],
      },
    });
    expect(createWork.ok(), await createWork.text()).toBeTruthy();
    await page.request.get("/api/v1/today");

    await expect(wall.getByText(new RegExp(respTitle, "i"))).toBeVisible({
      timeout: 30_000,
    });
    await expect(wall.getByText(new RegExp(routineTitle, "i"))).toBeVisible({
      timeout: 30_000,
    });

    // Open Avery person detail before member completes work.
    await wall.locator(`#display-person-${AVERY_ID}`).click();
    await expect(wall.getByTestId("display-detail")).toBeVisible();

    const memberCtx = await browser.newContext();
    const member = await memberCtx.newPage();
    await claimAvery(member.request);
    const today = await member.request.get("/api/v1/today");
    expect(today.ok()).toBeTruthy();
    const todayBody = (await today.json()) as {
      activityGeneration: number;
      occurrences: Array<{
        id: string;
        title: string;
        kind: string;
        revisionId: string;
        accountableMemberId: string | null;
        steps: Array<{ id: string; status: string; logicalItemId?: string }>;
      }>;
    };
    const openResp = todayBody.occurrences.find(
      (o) => o.title === respTitle && o.steps.some((s) => s.status === "open"),
    );
    expect(openResp).toBeTruthy();
    const respStep = openResp!.steps.find((s) => s.status === "open")!;
    const openRoutine = todayBody.occurrences.find(
      (o) => o.title === routineTitle && o.steps.some((s) => s.status === "open"),
    );
    expect(openRoutine).toBeTruthy();
    const routineStep = openRoutine!.steps.find((s) => s.status === "open")!;

    const completeResp = await member.request.post(
      `/api/v1/occurrences/${openResp!.id}/steps/${respStep.id}/status`,
      {
        headers: await mutatingHeaders(member.request),
        data: {
          mutationId: crypto.randomUUID(),
          status: "completed",
          performedAt: new Date().toISOString(),
          activityGeneration: todayBody.activityGeneration,
          kind: openResp!.kind,
          intendedStructure: {
            revisionId: openResp!.revisionId,
            accountableMemberId: openResp!.accountableMemberId,
            stepLogicalIds: openResp!.steps
              .map((s) => s.logicalItemId)
              .filter((id): id is string => Boolean(id)),
          },
        },
      },
    );
    expect(completeResp.ok(), await completeResp.text()).toBeTruthy();

    const completeRoutine = await member.request.post(
      `/api/v1/occurrences/${openRoutine!.id}/steps/${routineStep.id}/status`,
      {
        headers: await mutatingHeaders(member.request),
        data: {
          mutationId: crypto.randomUUID(),
          status: "completed",
          performedAt: new Date().toISOString(),
          activityGeneration: todayBody.activityGeneration,
          kind: openRoutine!.kind,
          intendedStructure: {
            revisionId: openRoutine!.revisionId,
            accountableMemberId: openRoutine!.accountableMemberId,
            stepLogicalIds: openRoutine!.steps
              .map((s) => s.logicalItemId)
              .filter((id): id is string => Boolean(id)),
          },
        },
      },
    );
    expect(completeRoutine.ok(), await completeRoutine.text()).toBeTruthy();

    // Already-open detail refreshes toward completed/quiet state.
    await expect
      .poll(async () => wall.getByTestId("display-detail").innerText(), {
        timeout: 30_000,
      })
      .toMatch(/Done|Complete|completed|quiet|1\/1/i);

    await wall.getByRole("button", { name: "Back", exact: true }).click();
    await expect(wall.getByTestId("display-overview")).toBeVisible();

    // Manager family-order change updates wall person order.
    await ensureManagerSession(page.request);
    const people = await page.request.get("/api/v1/people");
    expect(people.ok()).toBeTruthy();
    const peopleBody = (await people.json()) as {
      people: Array<{ id: string; sortOrder: number }>;
      familyOrderVersion: number;
    };
    const ids = peopleBody.people.map((p) => p.id);
    const reversed = [...ids].reverse();
    const reorder = await page.request.put("/api/v1/people/order", {
      headers: await mutatingHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        expectedVersion: peopleBody.familyOrderVersion,
        membershipIds: reversed,
      },
    });
    expect(reorder.ok(), await reorder.text()).toBeTruthy();
    await expect
      .poll(async () => {
        return wall.locator(`#display-person-${reversed[0]}`).count();
      }, { timeout: 30_000 })
      .toBeGreaterThan(0);
    // First card should be the first id in the reversed family order.
    await expect(
      wall.getByTestId("display-by-person").locator("button.display-person-card").first(),
    ).toHaveAttribute("id", `display-person-${reversed[0]}`);

    // Reassign responsibility owner → wall updates.
    const listed = await page.request.get("/api/v1/responsibilities");
    const responsibilities = (
      (await listed.json()) as {
        responsibilities: Array<{ id: string; title: string; version: number }>;
      }
    ).responsibilities;
    const target = responsibilities.find((r) => r.title === respTitle);
    if (target) {
      const reassign = await page.request.post(
        `/api/v1/responsibilities/${target.id}/revisions`,
        {
          headers: await mutatingHeaders(page.request),
          data: {
            mutationId: crypto.randomUUID(),
            title: respTitle,
            daypart: "anytime",
            weekdays: [1, 2, 3, 4, 5, 6, 7],
            assignment: {
              mode: "fixed",
              anchorDate: householdDate,
              fixedMemberId: CASEY_ID,
            },
            steps: [
              {
                logicalItemId: crypto.randomUUID(),
                text: "Feed cats live",
                obligation: "required",
              },
            ],
            expectedVersion: target.version,
            mode: "current",
          },
        },
      );
      expect(reassign.ok(), await reassign.text()).toBeTruthy();
    }

    // Household-visible task appears in open Avery detail after create.
    await wall.locator(`#display-person-${AVERY_ID}`).click();
    await expect(wall.getByTestId("display-detail")).toBeVisible();
    const taskTitle = `Wall task ${Date.now().toString(36)}`;
    await claimAvery(member.request);
    const createTask = await member.request.post("/api/v1/personal-tasks", {
      headers: await mutatingHeaders(member.request),
      data: { title: taskTitle, visibility: "household" },
    });
    expect(createTask.ok(), await createTask.text()).toBeTruthy();
    await expect(wall.getByText(taskTitle)).toBeVisible({ timeout: 30_000 });
    await wall.getByRole("button", { name: "Back", exact: true }).click();
    await expect(wall.getByTestId("display-overview")).toBeVisible();
    await expect(wall.getByText(taskTitle)).toHaveCount(0);

    // Optional C-1 Household overview agreement on owner/status via manager today.
    await ensureManagerSession(page.request);
    const managerToday = await page.request.get("/api/v1/today");
    expect(managerToday.ok()).toBeTruthy();
    const managerOcc = (
      (await managerToday.json()) as {
        occurrences: Array<{
          title: string;
          accountableMemberId: string | null;
          completed: boolean;
        }>;
      }
    ).occurrences.find((o) => o.title === respTitle);
    const dash = await wall.request.get("/api/v1/display/dashboard");
    if (dash.ok() && managerOcc) {
      const wallRow = (
        (await dash.json()) as {
          dashboard: {
            byWork: {
              responsibilities: Array<{
                title: string;
                accountableMemberId: string | null;
                completed: boolean;
              }>;
            };
          };
        }
      ).dashboard.byWork.responsibilities.find((r) => r.title === respTitle);
      if (wallRow) {
        expect(wallRow.accountableMemberId).toBe(managerOcc.accountableMemberId);
        expect(wallRow.completed).toBe(managerOcc.completed);
      }
    }

    await wallCtx.close();
    await memberCtx.close();
  });

  test("AT10: barrier holds older dashboard until #2 queued; visibility recovers after WS close", async ({
    page,
    browser,
  }) => {
    const wallCtx = await browser.newContext();
    const wall = await wallCtx.newPage();

    const olderMarker = `OLDER_SNAP_${Date.now().toString(36)}`;
    const newerMarker = `NEWER_SNAP_${Date.now().toString(36)}`;
    let armed = false;
    let dashCount = 0;
    let releaseFirst: (() => void) | null = null;
    let firstQueued: Promise<void> | null = null;
    let secondStarted!: () => void;
    const secondStartedPromise = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });

    // Install route BEFORE wall load.
    await wall.route("**/api/v1/display/dashboard", async (route: Route) => {
      if (!armed) {
        await route.continue();
        return;
      }
      dashCount += 1;
      const n = dashCount;
      if (n === 1) {
        firstQueued = new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        await firstQueued;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(syntheticDashboard(olderMarker)),
        });
        return;
      }
      if (n === 2) {
        secondStarted();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(syntheticDashboard(newerMarker)),
        });
        return;
      }
      await route.continue();
    });

    await enrollWall(page.request, wall, `Order ${Date.now().toString(36)}`);
    armed = true;
    dashCount = 0;

    // Kick two refreshes: hold #1 until #2 has started.
    void wall.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await wall.waitForTimeout(50);
    void wall.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await Promise.race([
      secondStartedPromise,
      wall.waitForTimeout(5_000).then(() => {
        throw new Error("second dashboard request never started");
      }),
    ]);
    releaseFirst?.();

    await expect(wall.getByText(newerMarker).first()).toBeVisible({ timeout: 20_000 });
    await expect(wall.getByText(olderMarker)).toHaveCount(0);
    await wall.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);

    // Force socket loss, change authoritative state offline, then recover via online + visibility.
    await wallCtx.setOffline(true);
    await expect
      .poll(async () => wall.locator(".display-stale").count(), { timeout: 8_000 })
      .toBeGreaterThan(0);

    await ensureManagerSession(page.request);
    const session = await page.request.get("/api/v1/auth/session");
    const householdDate = (
      (await session.json()) as { householdDate: string }
    ).householdDate;
    const recoveryTitle = `Recover ${Date.now().toString(36)}`;
    const createWork = await page.request.post("/api/v1/responsibilities", {
      headers: await mutatingHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        title: recoveryTitle,
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "fixed",
          anchorDate: householdDate,
          fixedMemberId: AVERY_ID,
        },
        steps: [
          {
            logicalItemId: crypto.randomUUID(),
            text: "Recover step",
            obligation: "required",
          },
        ],
      },
    });
    expect(createWork.ok(), await createWork.text()).toBeTruthy();

    await wallCtx.setOffline(false);
    await wall.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(wall.getByText(recoveryTitle)).toBeVisible({ timeout: 40_000 });

    await wallCtx.close();
  });

  test("AT11: held pre-revoke response cannot restore; replacement denies old credential", async ({
    page,
    browser,
  }) => {
    const wallA = await browser.newContext();
    const wallB = await browser.newContext();
    const pageA = await wallA.newPage();
    const pageB = await wallB.newPage();

    const a = await enrollWall(
      page.request,
      pageA,
      `A ${Date.now().toString(36)}`,
    );
    const b = await enrollWall(
      page.request,
      pageB,
      `B ${Date.now().toString(36)}`,
    );
    expect(a.displayId).not.toBe(b.displayId);

    await ensureManagerSession(page.request);
    const list = await page.request.get("/api/v1/displays");
    expect(list.ok()).toBeTruthy();
    const displays = (
      (await list.json()) as {
        displays: Array<{ id: string; configVersion: number; label: string }>;
      }
    ).displays;
    const target = displays.find((d) => d.id === a.displayId)!;

    // Barrier: hold dashboard response in flight, THEN revoke, then release.
    let inFlight = false;
    let releaseHeld: (() => void) | null = null;
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    await pageA.route("**/api/v1/display/dashboard", async (route) => {
      if (!inFlight) {
        inFlight = true;
        await held;
      }
      await route.continue();
    });
    const fetchPromise = pageA.evaluate(async () => {
      try {
        await fetch("/api/v1/display/dashboard", { credentials: "include" });
      } catch {
        /* ignore */
      }
    });
    await expect
      .poll(() => inFlight, { timeout: 10_000 })
      .toBe(true);

    const revoke = await page.request.post(
      `/api/v1/displays/${a.displayId}/revoke`,
      {
        headers: await mutatingHeaders(page.request),
        data: {
          mutationId: crypto.randomUUID(),
          expectedConfigVersion: target.configVersion,
        },
      },
    );
    expect(revoke.ok(), await revoke.text()).toBeTruthy();
    releaseHeld?.();
    await fetchPromise;

    await expect(pageA.getByTestId("display-setup").or(pageA.getByText(/revoked|access ended|expired|Connection lost/i))).toBeVisible({
      timeout: 30_000,
    });
    await expect(pageA.getByTestId("display-overview")).toHaveCount(0);
    await expect(pageB.getByTestId("display-overview")).toBeVisible();

    // Replacement enrollment while B remains; claim from new context replacing credential.
    const list2 = await page.request.get("/api/v1/displays");
    const bRow = (
      (await list2.json()) as {
        displays: Array<{ id: string; configVersion: number }>;
      }
    ).displays.find((d) => d.id === b.displayId)!;
    const issue = await page.request.post(
      `/api/v1/displays/${b.displayId}/enrollment`,
      {
        headers: await mutatingHeaders(page.request),
        data: {
          mutationId: crypto.randomUUID(),
          expectedConfigVersion: bRow.configVersion,
        },
      },
    );
    expect(issue.ok(), await issue.text()).toBeTruthy();
    const newCode = ((await issue.json()) as { code: string }).code;

    const replacementCtx = await browser.newContext();
    const replacement = await replacementCtx.newPage();
    await replacement.goto("/display");
    await replacement.getByTestId("display-claim-code").fill(newCode);
    await replacement.getByRole("button", { name: "Connect display" }).click();
    await expect(replacement.getByTestId("display-overview")).toBeVisible({
      timeout: 20_000,
    });

    // Old context HTTP denied after replacement.
    const oldDash = await pageB.request.get("/api/v1/display/dashboard");
    expect(oldDash.ok()).toBeFalsy();
    await pageB.reload();
    await expect(pageB.getByTestId("display-setup")).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByTestId("display-overview")).toHaveCount(0);

    await wallA.close();
    await wallB.close();
    await replacementCtx.close();
  });

  test("AT12: real offline stale timer blanks; late response and Back cannot restore", async ({
    page,
    browser,
  }) => {
    const wallCtx = await browser.newContext();
    const wall = await wallCtx.newPage();
    await enrollWall(
      page.request,
      wall,
      `Stale ${Date.now().toString(36)}`,
      () => {
        // Long enough to observe stale-before-blank; reset last-auth just before offline.
        window.__HD_DISPLAY_STALE_MS = 6000;
      },
    );

    await expect(wall.getByTestId("display-overview")).toBeVisible();
    const visibleName = await wall
      .getByTestId("display-by-person")
      .locator(".display-person-name")
      .first()
      .innerText();

    let holdLate = false;
    let releaseLate: (() => void) | null = null;
    const lateHeld = new Promise<void>((resolve) => {
      releaseLate = resolve;
    });
    await wall.route("**/api/v1/display/dashboard", async (route) => {
      if (!holdLate) {
        await route.continue();
        return;
      }
      holdLate = false;
      await lateHeld;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(syntheticDashboard("SHOULD_NOT_APPEAR_LATE")),
      });
    });

    // Fresh authorized refresh so the stale clock starts now.
    await wall.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(wall.getByTestId("display-overview")).toBeVisible();
    await wall.waitForTimeout(200);

    // Start a late in-flight request, then go truly offline while authenticated.
    holdLate = true;
    void wall.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await wall.waitForTimeout(50);

    await wallCtx.setOffline(true);

    // Stale label while data still visible (age > bound/2, before blank).
    await expect(wall.locator(".display-stale")).toBeVisible({ timeout: 8_000 });
    await expect(wall.getByText(visibleName)).toBeVisible();

    // Past bound → blank/setup; household data cleared.
    await expect
      .poll(async () => {
        const overview = await wall.getByTestId("display-overview").count();
        const blank = await wall.getByText(/Connection lost|expired|Waiting|Offline/i).count();
        const setup = await wall.getByTestId("display-setup").count();
        return overview === 0 && (blank > 0 || setup > 0);
      }, { timeout: 12_000 })
      .toBe(true);

    // Revoke while wall is offline so resume cannot re-auth from cookie alone.
    await ensureManagerSession(page.request);
    const list = await page.request.get("/api/v1/displays");
    const displays = (
      (await list.json()) as {
        displays: Array<{ id: string; configVersion: number }>;
      }
    ).displays;
    for (const row of displays) {
      await page.request.post(`/api/v1/displays/${row.id}/revoke`, {
        headers: await mutatingHeaders(page.request),
        data: {
          mutationId: crypto.randomUUID(),
          expectedConfigVersion: row.configVersion,
        },
      });
    }

    releaseLate?.();
    await wall.waitForTimeout(400);
    await expect(wall.getByText("SHOULD_NOT_APPEAR_LATE")).toHaveCount(0);
    await expect(wall.getByTestId("display-overview")).toHaveCount(0);

    await wallCtx.setOffline(false);
    await wall.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(wall.getByTestId("display-overview")).toHaveCount(0);
    await expect(
      wall.getByTestId("display-setup").or(wall.getByText(/revoked|access ended|expired|Waiting|reconnect/i)),
    ).toBeVisible({ timeout: 20_000 });

    await wall.goBack().catch(() => undefined);
    await expect(wall.getByTestId("display-overview")).toHaveCount(0);

    await wall.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
    await wallCtx.close();
  });

  test("AT14: mismatched browser TZ/clock; midnight closes old detail", async ({
    page,
    browser,
  }) => {
    // Browser local TZ is Pacific while household is America/New_York.
    // Skew browser Date without Playwright clock fakes (those pause app timers).
    const wallCtx = await browser.newContext({
      timezoneId: "America/Los_Angeles",
    });
    const wall = await wallCtx.newPage();
    await wall.addInitScript(() => {
      const fixedMs = Date.parse("2020-01-01T12:00:00.000Z");
      Date.now = () => fixedMs;
    });

    await enrollWall(page.request, wall, `Clock ${Date.now().toString(36)}`);

    const session = await wall.request.get("/api/v1/display/session");
    expect(session.ok()).toBeTruthy();
    const info = (await session.json()) as {
      session: {
        householdDate: string;
        timezone: string;
        serverTime: string;
      };
    };
    expect(info.session.timezone).toBe("America/New_York");
    expect(info.session.householdDate).not.toBe("2020-01-01");

    const browserNowMs = await wall.evaluate(() => Date.now());
    expect(new Date(browserNowMs).toISOString().startsWith("2020-01-01")).toBeTruthy();

    const expectedWeekday = new Intl.DateTimeFormat("en-US", {
      timeZone: info.session.timezone,
      weekday: "long",
    }).format(new Date(info.session.serverTime));
    const expectedDate = new Intl.DateTimeFormat("en-US", {
      timeZone: info.session.timezone,
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(info.session.serverTime));

    const clock = wall.getByTestId("display-clock");
    await expect(clock).toContainText(expectedWeekday);
    await expect(clock).toContainText(expectedDate);
    await expect(clock.locator(".display-time")).not.toBeEmpty();

    // Skewed browser clock / Pacific local must not drive the wall date.
    await expect(clock).not.toContainText("January 1, 2020");
    const pacificDate = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(info.session.serverTime));
    if (pacificDate !== expectedDate) {
      await expect(clock).not.toContainText(pacificDate);
    }

    // Open a person detail on the current household day.
    await wall.locator(`#display-person-${AVERY_ID}`).click();
    await expect(wall.getByTestId("display-detail")).toBeVisible({ timeout: 20_000 });

    const nextDayMarker = `NEXT_DAY_${Date.now().toString(36)}`;
    const nextHouseholdDate = "2099-12-31";
    const nextServerTime = "2099-12-31T15:00:00.000Z";
    let dashHits = 0;
    await wall.route("**/api/v1/display/dashboard", async (route) => {
      dashHits += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          syntheticDashboard(nextDayMarker, {
            householdDate: nextHouseholdDate,
            serverTime: nextServerTime,
          }),
        ),
      });
    });

    // Cross "midnight" via refresh with a new household date snapshot.
    await wall.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => dashHits, { timeout: 10_000 }).toBeGreaterThan(0);

    await expect(wall.getByTestId("display-detail")).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(wall.getByTestId("display-overview")).toBeVisible();
    await expect(wall.getByText(nextDayMarker).first()).toBeVisible({
      timeout: 20_000,
    });
    const nextExpectedDate = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(nextServerTime));
    await expect(clock).toContainText(nextExpectedDate);
    await expect(clock).not.toContainText(expectedDate);

    await wall.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
    await wallCtx.close();
  });
});
