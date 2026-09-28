import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  type Route,
} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { durableScreenshot } from "../helpers/durable-screenshot";
import { expectSignedInAs } from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const AVERY_LOGIN = "e2e.avery";
const SCREENSHOT_DIR = path.resolve("reports/_local-screenshots/p0-007c-3a-r1");

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

async function mutatingHeaders(
  request: APIRequestContext,
): Promise<Record<string, string>> {
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
    const token = ((await enroll.json()) as { claim: { token: string } }).claim
      .token;
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
): Promise<void> {
  await ensureManagerSession(managerRequest);
  const create = await managerRequest.post("/api/v1/displays", {
    headers: await mutatingHeaders(managerRequest),
    data: { mutationId: crypto.randomUUID(), label },
  });
  expect(create.ok(), await create.text()).toBeTruthy();
  const code = ((await create.json()) as { enrollment: { code: string } })
    .enrollment.code;

  await wall.goto("/display");
  await expect(wall.getByTestId("display-setup")).toBeVisible();
  await wall.getByTestId("display-claim-code").fill(code);
  await wall.getByRole("button", { name: "Connect display" }).click();
  await expect(wall.getByTestId("display-overview")).toBeVisible({
    timeout: 20_000,
  });
}

function syntheticDashboard(
  titleMarker: string,
  opts?: { householdDate?: string; serverTime?: string; activityGeneration?: number },
) {
  const householdDate = opts?.householdDate ?? "2099-06-15";
  return {
    dashboard: {
      householdDate,
      timezone: "America/New_York",
      serverTime: opts?.serverTime ?? new Date().toISOString(),
      activityGeneration: opts?.activityGeneration ?? 1,
      byPerson: [
        {
          membershipId: AVERY_ID,
          displayName: "Avery Reed",
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

test.describe("P0-007C-3A live recovery and date rollover", () => {
  test("AT10: household-date rollover retires prior-day pending with explanation", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Phone Chromium rollover journey",
    );
    test.setTimeout(180_000);
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    await ensureManagerSession(page.request);
    const title = `Rollover kitchen ${Date.now().toString(36)}`;
    const create = await page.request.post("/api/v1/responsibilities", {
      headers: await mutatingHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        title,
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        accountableMemberId: AVERY_ID,
        steps: [
          {
            logicalItemId: crypto.randomUUID(),
            text: "Counters",
            obligation: "required",
          },
        ],
      },
    });
    expect(create.ok(), await create.text()).toBeTruthy();

    const wallCtx = await browser.newContext();
    const wall = await wallCtx.newPage();
    await enrollWall(page.request, wall, `Rollover ${Date.now().toString(36)}`);

    await wall.getByTestId("display-org-by-work").click();
    await wall
      .getByTestId("display-by-work")
      .locator("button.display-work-row")
      .filter({ hasText: title })
      .click();
    await expect(wall.getByTestId("display-detail")).toBeVisible();

    // Queue a pending tap for the current household day.
    await wall.route("**/api/v1/display/occurrences/**/status", (route) =>
      route.abort(),
    );
    await wall.locator("[data-testid^=display-step-done-]").first().click();
    await expect(
      wall.getByRole("status").filter({ hasText: /pending|retry|Saving/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    const nextDayMarker = `NEXT_DAY_${Date.now().toString(36)}`;
    const nextHouseholdDate = "2099-12-31";
    let dashHits = 0;
    await wall.route("**/api/v1/display/dashboard", async (route) => {
      dashHits += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          syntheticDashboard(nextDayMarker, {
            householdDate: nextHouseholdDate,
            serverTime: "2099-12-31T15:00:00.000Z",
            activityGeneration: 1,
          }),
        ),
      });
    });

    await wall.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => dashHits, { timeout: 10_000 }).toBeGreaterThan(0);

    // Prior-day detail closes; retired pending is explained, not silently dropped.
    await expect(wall.getByTestId("display-detail")).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(wall.getByTestId("display-overview")).toBeVisible();
    await expect(wall.getByTestId("display-retired-notices")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      wall.getByText(/previous day|was not saved/i).first(),
    ).toBeVisible();
    await expect(wall.getByText(nextDayMarker).first()).toBeVisible();
    // Pending cue for the old day must not remain as still-retryable.
    await expect(wall.getByTestId("display-pending-cue")).toHaveCount(0);

    await durableScreenshot(
      wall,
      path.join(SCREENSHOT_DIR, "date-rollover-retired.png"),
    );

    await wall.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
    await wallCtx.close();
  });

  test("AT11: two displays + phone converge; WS loss recovers; delayed read cannot restore stale", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Phone Chromium multi-display journey",
    );
    test.setTimeout(240_000);
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    await ensureManagerSession(page.request);
    const title = `Dual wall kitchen ${Date.now().toString(36)}`;
    const create = await page.request.post("/api/v1/responsibilities", {
      headers: await mutatingHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        title,
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        accountableMemberId: AVERY_ID,
        steps: [
          {
            logicalItemId: crypto.randomUUID(),
            text: "Counters",
            obligation: "required",
          },
          {
            logicalItemId: crypto.randomUUID(),
            text: "Wipe",
            obligation: "as_needed",
          },
        ],
      },
    });
    expect(create.ok(), await create.text()).toBeTruthy();

    const wallACtx = await browser.newContext();
    const wallBCtx = await browser.newContext();
    const phoneCtx = await browser.newContext();
    const wallA = await wallACtx.newPage();
    const wallB = await wallBCtx.newPage();
    const phone = await phoneCtx.newPage();

    // Observe wall B sync sockets from creation so we can close the live one.
    const wallBSyncSockets: import("@playwright/test").WebSocket[] = [];
    wallB.on("websocket", (ws) => {
      if (ws.url().includes("/api/v1/display/sync")) wallBSyncSockets.push(ws);
    });

    await enrollWall(page.request, wallA, `Wall A ${Date.now().toString(36)}`);
    await enrollWall(page.request, wallB, `Wall B ${Date.now().toString(36)}`);

    await claimAvery(phone.request);
    await phone.goto("/today");
    await expectSignedInAs(phone, /Avery/);
    await expect(phone.getByText(title).first()).toBeVisible({ timeout: 20_000 });

    await wallA.getByTestId("display-org-by-work").click();
    await wallA
      .getByTestId("display-by-work")
      .locator("button.display-work-row")
      .filter({ hasText: title })
      .click();
    await expect(wallA.getByTestId("display-detail")).toBeVisible();
    await wallA.locator("[data-testid^=display-step-done-]").first().click();
    await expect(
      wallA.locator("[data-testid^=display-step-done-][aria-pressed=true]").first(),
    ).toBeVisible({ timeout: 20_000 });

    // Other display and phone converge without reload.
    // Require real "1/2 done" — "/done/" alone matches stale "0/2 done".
    await wallB.getByTestId("display-org-by-work").click();
    const wallBRow = wallB
      .getByTestId("display-by-work")
      .locator("button.display-work-row")
      .filter({ hasText: title });
    await expect
      .poll(
        async () => {
          if ((await wallBRow.count()) === 0) return false;
          return /1\/2\s*done/i.test(await wallBRow.first().innerText());
        },
        { timeout: 30_000 },
      )
      .toBeTruthy();
    const preOutageWallBText = await wallBRow.first().innerText();
    expect(preOutageWallBText).toMatch(/1\/2\s*done/i);

    await expect
      .poll(
        async () => {
          const text = await phone.locator("body").innerText();
          return /1\/2\s*done|Counters.*done|completed/i.test(text);
        },
        { timeout: 30_000 },
      )
      .toBeTruthy();

    // Close the live display sync socket (Playwright cannot call WebSocket.close()).
    // Abort sync upgrades + dashboard GETs so reconnect cannot apply the mid-outage write.
    await expect
      .poll(
        () => wallBSyncSockets.some((ws) => !ws.isClosed()),
        { timeout: 15_000 },
      )
      .toBeTruthy();
    const liveSync = [...wallBSyncSockets].reverse().find((ws) => !ws.isClosed());
    expect(liveSync, "wall B should have an open display sync socket").toBeTruthy();

    const socketClosed = new Promise<void>((resolve) => {
      liveSync!.on("close", () => resolve());
    });
    await wallB.route("**/api/v1/display/sync**", (route) => route.abort());
    await wallB.route("**/api/v1/display/dashboard**", (route) => {
      if (route.request().method() === "GET") return route.abort();
      return route.continue();
    });
    // Deterministic seam: close the live socket so client onclose drives reconnect.
    const closedBySeam = await wallB.evaluate(() => {
      if (typeof window.__HD_DISPLAY_CLOSE_SYNC__ !== "function") return false;
      window.__HD_DISPLAY_CLOSE_SYNC__();
      return true;
    });
    expect(closedBySeam, "__HD_DISPLAY_CLOSE_SYNC__ must be installed").toBe(true);
    await socketClosed;
    expect(liveSync!.isClosed()).toBe(true);

    // Checklist change from wall A while wall B's sync socket is down — must commit.
    // Scope to Wipe; nudge flush in case a prior in-flight flush skipped this queue.
    const wipeStep = wallA
      .locator("[data-testid^=display-step-]")
      .filter({ hasText: "Wipe" });
    const wipeNotNeeded = wipeStep.locator("[data-testid^=display-step-not-needed-]");
    await expect(wipeNotNeeded).toBeVisible({ timeout: 10_000 });
    await wipeNotNeeded.click();
    await expect(wipeNotNeeded).toHaveAttribute("aria-pressed", "true");
    await wallA.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    await expect
      .poll(
        async () => {
          const today = await phone.request.get("/api/v1/today");
          if (!today.ok()) return false;
          const body = (await today.json()) as {
            occurrences: Array<{
              title: string;
              steps: Array<{ text: string; status: string }>;
            }>;
          };
          const row = body.occurrences.find((entry) => entry.title === title);
          const wipe = row?.steps.find((step) => step.text === "Wipe");
          return wipe?.status === "not_needed";
        },
        { timeout: 30_000 },
      )
      .toBeTruthy();
    await expect(wipeStep.getByText(/Pending/i)).toHaveCount(0);
    await expect(wipeStep.locator(".display-work-meta")).toContainText(/Not needed/i);

    // Wall B must retain the frozen pre-outage snapshot (missed the invalidation).
    await expect(wallBRow).toBeVisible();
    await expect
      .poll(async () => (await wallBRow.innerText()) === preOutageWallBText, {
        timeout: 8_000,
      })
      .toBeTruthy();
    expect(await wallBRow.innerText()).toMatch(/1\/2\s*done/i);
    expect(await wallBRow.innerText()).not.toMatch(/not needed/i);

    // Restore sync + dashboard; no page reload — overview stays mounted.
    // Catch-up is HTTP refresh on visibility (WS will not replay the missed invalidate).
    await wallB.unroute("**/api/v1/display/sync**");
    await wallB.unroute("**/api/v1/display/dashboard**");
    const reconnectWs = wallB.waitForEvent("websocket", {
      predicate: (ws) =>
        ws.url().includes("/api/v1/display/sync") && !ws.isClosed(),
      timeout: 45_000,
    });
    const nudgeWallBRefresh = () =>
      wallB.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("pageshow"));
        window.dispatchEvent(new Event("online"));
      });
    // Clear abort-induced backoff and open immediately; HTTP visibility catches up the miss.
    await wallB.evaluate(() => {
      window.__HD_DISPLAY_RECONNECT_SYNC__?.();
    });
    await nudgeWallBRefresh();
    await reconnectWs;
    await expect(wallB.getByTestId("display-overview")).toBeVisible();
    await expect(wallB.getByTestId("display-setup")).toHaveCount(0);

    // Wall B converges to authoritative post-outage checklist state without reload.
    await expect
      .poll(
        async () => {
          await nudgeWallBRefresh();
          if ((await wallBRow.count()) === 0) return true;
          const text = await wallBRow.first().innerText();
          // Not-needed changes the label away from "N/M done".
          return (
            /not needed/i.test(text) ||
            (/complete/i.test(text) && !/1\/2\s*done/i.test(text)) ||
            /2\/2/i.test(text)
          );
        },
        { timeout: 40_000, intervals: [500, 1_000, 2_000] },
      )
      .toBeTruthy();
    if ((await wallBRow.count()) > 0) {
      const recovered = await wallBRow.first().innerText();
      expect(recovered).not.toBe(preOutageWallBText);
      expect(recovered).toMatch(/not needed|complete|2\/2/i);
    }

    // Delayed older occurrence read must not restore stale open step.
    let occArmed = false;
    let occCount = 0;
    let releaseFirst: (() => void) | null = null;
    let firstHeld: Promise<void> | null = null;
    let secondStarted!: () => void;
    const secondStartedPromise = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    await wallA.route("**/api/v1/display/occurrences/**", async (route: Route) => {
      if (route.request().method() !== "GET" || !occArmed) {
        await route.continue();
        return;
      }
      occCount += 1;
      const n = occCount;
      if (n === 1) {
        firstHeld = new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        await firstHeld;
        const response = await route.fetch();
        const body = await response.json();
        if (body?.occurrence?.steps?.[0]) {
          body.occurrence.steps[0].status = "open";
        }
        await route.fulfill({
          status: response.status(),
          contentType: "application/json",
          body: JSON.stringify(body),
        });
        return;
      }
      if (n === 2) {
        secondStarted();
        await route.continue();
        return;
      }
      await route.continue();
    });

    occArmed = true;
    occCount = 0;
    void wallA.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await wallA.waitForTimeout(80);
    void wallA.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await secondStartedPromise;
    await wallA.waitForTimeout(200);
    releaseFirst?.();
    await wallA.waitForTimeout(400);

    // Authoritative completed control must remain pressed (older open discarded).
    await expect(
      wallA.locator("[data-testid^=display-step-done-][aria-pressed=true]").first(),
    ).toBeVisible();

    await durableScreenshot(
      wallA,
      path.join(SCREENSHOT_DIR, "dual-display-converge.png"),
    );
    await durableScreenshot(
      wallB,
      path.join(SCREENSHOT_DIR, "dual-display-ws-recover.png"),
    );

    await wallA.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
    await wallB.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
    await wallACtx.close();
    await wallBCtx.close();
    await phoneCtx.close();
  });
});
