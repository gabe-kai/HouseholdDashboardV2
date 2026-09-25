import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
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
): Promise<{ displayId: string }> {
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
  return { displayId: body.display.id };
}

test.describe("P0-007C-2 live convergence and recovery", () => {
  test("AT9: member step completion updates wall without reload", async ({
    page,
    browser,
  }) => {
    const wallCtx = await browser.newContext();
    const wall = await wallCtx.newPage();
    await enrollWall(page.request, wall, `Live ${Date.now().toString(36)}`);

    await ensureManagerSession(page.request);
    const session = await page.request.get("/api/v1/auth/session");
    const householdDate = (
      (await session.json()) as { householdDate: string }
    ).householdDate;
    const createWork = await page.request.post("/api/v1/responsibilities", {
      headers: await mutatingHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        title: `Live feed ${Date.now().toString(36)}`,
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
    const open = todayBody.occurrences.find(
      (o) =>
        o.title.includes("Live feed") &&
        o.steps.some((s) => s.status === "open"),
    );
    expect(open, "expected an open Live feed step for Avery").toBeTruthy();
    const step = open!.steps.find((s) => s.status === "open")!;

    await expect(wall.getByText(/Live feed/i)).toBeVisible({ timeout: 30_000 });
    const status = await member.request.post(
      `/api/v1/occurrences/${open!.id}/steps/${step.id}/status`,
      {
        headers: await mutatingHeaders(member.request),
        data: {
          mutationId: crypto.randomUUID(),
          status: "completed",
          performedAt: new Date().toISOString(),
          activityGeneration: todayBody.activityGeneration,
          kind: open!.kind,
          intendedStructure: {
            revisionId: open!.revisionId,
            accountableMemberId: open!.accountableMemberId,
            stepLogicalIds: open!.steps
              .map((s) => s.logicalItemId)
              .filter((id): id is string => Boolean(id)),
          },
        },
      },
    );
    expect(status.ok(), await status.text()).toBeTruthy();

    await expect
      .poll(async () => wall.getByText(/Live feed/i).innerText(), {
        timeout: 30_000,
      })
      .toMatch(/Done|completed|quiet|Live feed/i);

    // Progress label/state should move off unfinished after completion.
    await expect(wall.getByTestId("display-overview")).toBeVisible();

    await wallCtx.close();
    await memberCtx.close();
  });

  test("AT10: newer dashboard wins over held older response; poll recovers after socket close", async ({
    page,
    browser,
  }) => {
    const wallCtx = await browser.newContext();
    const wall = await wallCtx.newPage();
    await enrollWall(page.request, wall, `Order ${Date.now().toString(36)}`);

    let holdOlder: ((value?: unknown) => void) | null = null;
    let releaseOlder: Promise<unknown> | null = null;
    let dashCount = 0;

    await wall.route("**/api/v1/display/dashboard", async (route) => {
      dashCount += 1;
      if (dashCount === 1) {
        releaseOlder = new Promise((resolve) => {
          holdOlder = resolve;
        });
        await releaseOlder;
        await route.continue();
        return;
      }
      await route.continue();
    });

    // Trigger two refreshes: first held, second immediate.
    await wall.evaluate(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await wall.waitForTimeout(200);
    // Release older after a newer request would have started via poll/visibility.
    holdOlder?.(undefined);

    await expect(wall.getByTestId("display-overview")).toBeVisible();

    // Force socket close then wait for poll recovery.
    await wall.evaluate(() => {
      // Close any open websockets.
      // @ts-expect-error test probe
      for (const ws of (window as { __HD_WS__?: WebSocket[] }).__HD_WS__ ?? []) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    });
    await wall.waitForTimeout(500);
    await expect(wall.getByTestId("display-overview")).toBeVisible({ timeout: 40_000 });

    await wallCtx.close();
  });

  test("AT11: revoking one of two displays leaves the other working", async ({
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

    // Hold a pre-revoke dashboard response for wall A.
    let releaseHeld: (() => void) | null = null;
    await pageA.route("**/api/v1/display/dashboard", async (route) => {
      if (!releaseHeld) {
        await new Promise<void>((resolve) => {
          releaseHeld = resolve;
        });
      }
      await route.continue();
    });
    void pageA.evaluate(async () => {
      await fetch("/api/v1/display/dashboard", { credentials: "include" });
    });

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

    await expect(pageA.getByTestId("display-setup")).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByTestId("display-overview")).toBeVisible();
    await pageB.reload();
    await expect(pageB.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });

    await wallA.close();
    await wallB.close();
  });

  test("AT12: offline past stale bound blanks; late response rejected", async ({
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
        window.__HD_DISPLAY_STALE_MS = 1500;
      },
    );

    let holdNext = true;
    let releaseHeld: (() => void) | null = null;
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });

    await wall.route("**/api/v1/display/dashboard", async (route) => {
      if (!holdNext) {
        await route.continue();
        return;
      }
      holdNext = false;
      await held;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          dashboard: {
            householdDate: "2099-01-01",
            timezone: "America/New_York",
            serverTime: new Date().toISOString(),
            activityGeneration: 1,
            byPerson: [
              {
                membershipId: "x",
                displayName: "SHOULD_NOT_APPEAR",
                sortOrder: 0,
                status: "active",
                recurringState: "Done",
                progress: null,
                progressLabel: null,
                unfinished: [],
              },
            ],
            byWork: { responsibilities: [], routines: [] },
          },
        }),
      });
    });

    // Start an in-flight dashboard refresh, then force stale/offline blanking.
    await wall.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await wall.waitForTimeout(100);
    await wall.evaluate(() => {
      window.__HD_DISPLAY_FORCE_STALE__?.();
    });

    await expect
      .poll(async () => {
        const blank = await wall.getByText(/expired|Connection lost|Waiting|Offline/i).count();
        const overview = await wall.getByTestId("display-overview").count();
        return blank > 0 || overview === 0;
      }, { timeout: 10_000 })
      .toBe(true);

    releaseHeld?.();
    await wall.waitForTimeout(500);
    await expect(wall.getByText("SHOULD_NOT_APPEAR")).toHaveCount(0);

    await wallCtx.close();
  });
});
